package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
	"infinite-canvas/backend/internal/transcription"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func (s *Service) AssistantTranscribeAsset(userID, projectID, assetID, language, route string) (*model.Task, error) {
	return s.AssistantTranscribeMedia(userID, projectID, assetID, "", language, route)
}

func (s *Service) AssistantTranscribeMedia(userID, projectID, assetID, nodeID, language, route string) (*model.Task, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, err
	}
	_, kind, resourceID, _, stream, err := s.assistantMediaResource(userID, projectID, assetID, nodeID)
	if err != nil {
		return nil, err
	}
	stream.Close()
	if kind != "video" && kind != "audio" {
		return nil, kernel.BadAuthRequest("请选择视频或音频素材")
	}
	return s.assistantTranscribeResource(userID, projectID, resourceID, language, route)
}

type AssistantEditMediaRequest struct {
	File             string `json:"file"`
	ExpectedRevision *int64 `json:"expectedRevision,omitempty"`
	Language         string `json:"language"`
	Route            string `json:"route"`
}

func (s *Service) AssistantTranscribeEditMedia(ctx context.Context, userID, projectID, editID string, input AssistantEditMediaRequest, host interface {
	Call(context.Context, string, string, []byte) (json.RawMessage, int, error)
}) (*model.Task, json.RawMessage, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, nil, err
	}
	body, _ := json.Marshal(input)
	data, status, err := host.Call(ctx, http.MethodPost, "/edits/"+url.PathEscape(editID)+"/media-info?projectId="+url.QueryEscape(projectID), body)
	if err != nil {
		return nil, nil, err
	}
	var response struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &response) != nil || status != 200 || response.Code != 0 {
		return nil, nil, kernel.BadAuthRequest(fmt.Sprintf("无法读取工程素材：%s", response.Msg))
	}
	var info struct {
		HasAudio bool `json:"hasAudio"`
		Source   *struct {
			ResourceID string `json:"resourceId"`
			AssetID    string `json:"assetId"`
			SHA256     string `json:"sha256"`
		} `json:"source"`
	}
	if json.Unmarshal(response.Data, &info) != nil || !info.HasAudio {
		return nil, nil, kernel.BadAuthRequest("该素材没有可转写的音轨")
	}
	if info.Source == nil || info.Source.ResourceID == "" || info.Source.AssetID == "" {
		return nil, nil, kernel.BadAuthRequest("请先把该素材保存到资产库并导入工程，再进行转写")
	}
	pinned, err := s.repo.HasEditingMediaReference(userID, projectID, editID, info.Source.AssetID, info.Source.ResourceID)
	if err != nil {
		return nil, nil, err
	}
	if !pinned {
		return nil, nil, kernel.BadAuthRequest("素材不是当前工程的已导入资源")
	}
	resource, stream, err := s.OpenResource(userID, info.Source.ResourceID)
	if err != nil {
		return nil, nil, err
	}
	digest := sha256.New()
	_, hashErr := io.Copy(digest, io.LimitReader(stream, resource.Size+1))
	stream.Close()
	if hashErr != nil || hex.EncodeToString(digest.Sum(nil)) != info.Source.SHA256 {
		return nil, nil, kernel.BadAuthRequest("工程文件与资产库原文件不一致，请先保存当前素材再转写")
	}
	if resource.Kind != "audio" && resource.Kind != "video" {
		return nil, nil, kernel.BadAuthRequest("请选择音频或视频素材")
	}
	task, err := s.assistantTranscribeResource(userID, projectID, info.Source.ResourceID, input.Language, input.Route)
	return task, response.Data, err
}

func (s *Service) assistantTranscribeResource(userID, projectID, resourceID, language, route string) (*model.Task, error) {
	language = strings.TrimSpace(language)
	if language == "auto" {
		language = ""
	}
	route, runtimeKey, settings, err := transcription.ResolveConfiguredRoute(s.dataDir, route)
	if err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	if language == "" {
		language = settings.Language
	}
	key := sha256.Sum256([]byte(userID + "\x00" + projectID + "\x00" + resourceID + "\x00" + language + "\x00" + runtimeKey))
	return s.CreateTimelineTranscriptionTask(userID, localtask.TimelineTranscriptionCreateRequest{ResourceID: resourceID, ProjectID: projectID, Language: language, Route: route, RuntimeKey: runtimeKey, ClientOperationID: "asr_" + hex.EncodeToString(key[:])})
}
