package app

import (
	"context"
	"encoding/json"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/mediareview"
	"infinite-canvas/backend/internal/model"
	"io"
	"path/filepath"
)

func (s *Service) AssistantMediaAssetIdentity(userID, projectID, assetID string) (string, string, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return "", "", err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return "", "", err
	}
	if asset.Status == model.AssetVersionStatusArchived {
		return "", "", kernel.BadAuthRequest("请先恢复归档素材")
	}
	return asset.Title, asset.Kind, nil
}

func (s *Service) assistantMediaResource(userID, projectID, assetID, nodeID string) (string, string, string, *model.Resource, io.ReadCloser, error) {
	bad := func(err error) (string, string, string, *model.Resource, io.ReadCloser, error) {
		return "", "", "", nil, nil, err
	}
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return bad(err)
	}
	var title, kind, storage string
	if assetID != "" && nodeID == "" {
		asset, err := s.repo.AssetForUser(userID, assetID)
		if err != nil {
			return bad(err)
		}
		if asset.Status == model.AssetVersionStatusArchived {
			return bad(kernel.BadAuthRequest("请先恢复归档素材"))
		}
		var payload struct {
			Data struct {
				StorageKey string `json:"storageKey"`
			} `json:"data"`
		}
		if json.Unmarshal([]byte(asset.PayloadJSON), &payload) != nil {
			return bad(kernel.BadAuthRequest("素材文件引用无效"))
		}
		title, kind, storage = asset.Title, asset.Kind, payload.Data.StorageKey
	} else if nodeID != "" && assetID == "" {
		raw, err := s.UserCanvasProject(userID, projectID)
		if err != nil {
			return bad(err)
		}
		var doc struct {
			Nodes []struct {
				ID       string `json:"id"`
				Type     string `json:"type"`
				Title    string `json:"title"`
				Metadata struct {
					StorageKey string `json:"storageKey"`
				} `json:"metadata"`
			} `json:"nodes"`
		}
		if json.Unmarshal(raw, &doc) != nil {
			return bad(kernel.BadAuthRequest("画布无法读取"))
		}
		found := false
		for _, node := range doc.Nodes {
			if node.ID == nodeID {
				title, kind, storage = node.Title, node.Type, node.Metadata.StorageKey
				found = true
				break
			}
		}
		if !found {
			return bad(kernel.BadAuthRequest("节点不属于当前画布"))
		}
	} else {
		return bad(kernel.BadAuthRequest("请选择一个素材或画布节点"))
	}
	if kind != "image" && kind != "video" && kind != "audio" {
		return bad(kernel.BadAuthRequest("请选择图片、视频或音频素材"))
	}
	id := assets.ResourceID(storage)
	if id == "" {
		return bad(kernel.BadAuthRequest("素材还未保存到本地资源库"))
	}
	resource, stream, err := s.OpenResource(userID, id)
	if err != nil {
		return bad(err)
	}
	if resource.Kind != kind {
		stream.Close()
		return bad(kernel.BadAuthRequest("素材与文件类型不一致"))
	}
	return title, kind, id, resource, stream, nil
}

func (s *Service) AssistantReadMedia(ctx context.Context, userID, projectID, assetID, nodeID string, frames bool, times []float64, count int) (map[string]any, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, err
	}
	title, kind, _, resource, stream, err := s.assistantMediaResource(userID, projectID, assetID, nodeID)
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	info, err := mediareview.Read(ctx, filepath.Join(s.dataDir, "cache", "media-review"), stream, resource.Size, kind, frames, times, count)
	if err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	return map[string]any{"assetId": assetID, "nodeId": nodeID, "title": title, "kind": kind, "info": info}, nil
}
