package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/agentworkspace"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/mediareview"
	"os"
	"path/filepath"
	"strings"
)

func (s *Service) StopAssistantWorkspace() {
	if s != nil && s.agentWorkspace != nil {
		s.agentWorkspace.Close()
	}
}

func (s *Service) assistantWork(user, project string) (*agentworkspace.Workspace, error) {
	if !s.IsLocalMode() {
		return nil, kernel.BadAuthRequest("脚本工具仅用于本地工作区")
	}
	if _, err := s.UserAssistantProject(user, project); err != nil {
		return nil, err
	}
	if s.agentWorkspace == nil {
		return nil, errors.New("workspace_runtime_unavailable")
	}
	return s.agentWorkspace.Workspace(user, project)
}
func (s *Service) AssistantWorkspaceInfo(user, project, node, python string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	info := w.Info()
	info["runtime"] = agentworkspace.Status(node, python)
	return info, nil
}
func (s *Service) AssistantWorkspaceFiles(user, project string, r agentworkspace.FilesRequest) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	return w.Files(r)
}
func (s *Service) AssistantWorkspaceRun(ctx context.Context, user, project string, r agentworkspace.RunRequest, node, python string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	return s.agentWorkspace.Run(ctx, w, r, node, python)
}
func (s *Service) AssistantWorkspaceRuns(user, project string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	return w.Runs()
}
func (s *Service) AssistantWorkspaceInstall(ctx context.Context, user, project, kind, id string, packages []string, node, python string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	return s.agentWorkspace.Install(ctx, w, kind, packages, id, node, python)
}
func (s *Service) AssistantWorkspaceSkill(user, project, name, hash string, roots map[string]string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	snapshot, err := s.SkillHubSnapshot(user, roots)
	if err != nil {
		return nil, err
	}
	for _, skill := range snapshot.Skills {
		if skill.Name == name && skill.ContentHash == hash {
			relative, err := w.CopySkill(skill.Name, skill.ContentHash, skill.Root)
			return map[string]any{"path": relative, "contentHash": skill.ContentHash, "canonicalUnchanged": true}, err
		}
	}
	return nil, kernel.BadAuthRequest("技能已停用或已更新，请重新读取当前技能")
}
func (s *Service) AssistantAssetsSearch(user, project, query, kind string, page int) (any, error) {
	if _, err := s.UserAssistantProject(user, project); err != nil {
		return nil, err
	}
	if len(query) > 256 || kind != "" && kind != "image" && kind != "video" && kind != "audio" && kind != "text" {
		return nil, kernel.BadAuthRequest("素材检索参数无效")
	}
	if page < 1 {
		page = 1
	}
	data, err := s.UserAssetsPage(user, page, 30, UserAssetPageFilter{Query: query, Kind: kind})
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, raw := range data.Assets {
		var asset struct {
			ID    string   `json:"id"`
			Kind  string   `json:"kind"`
			Title string   `json:"title"`
			Tags  []string `json:"tags"`
			Data  struct {
				Width    int     `json:"width"`
				Height   int     `json:"height"`
				Duration float64 `json:"duration"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &asset) != nil {
			return nil, errors.New("asset_metadata_invalid")
		}
		items = append(items, map[string]any{"id": asset.ID, "title": asset.Title, "kind": asset.Kind, "tags": asset.Tags, "width": asset.Data.Width, "height": asset.Data.Height, "duration": asset.Data.Duration})
	}
	return map[string]any{"assets": items, "page": data.Page, "hasMore": data.HasMore, "total": data.Total}, nil
}
func (s *Service) AssistantWorkspaceAsset(user, project, id, relative string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	title, kind, _, resource, stream, err := s.assistantMediaResource(user, project, id, "")
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	if resource.Size > 512<<20 {
		return nil, kernel.BadAuthRequest("素材超过 512 MiB，请使用原生素材接口")
	}
	hash, err := w.Copy(relative, stream, 512<<20)
	return map[string]any{"path": relative, "hash": hash, "assetId": id, "title": title, "kind": kind}, err
}

// Publish through resource validation and the owned asset library. Scripts never
// receive a database path or write the canonical editor project directly.
func (s *Service) AssistantWorkspacePublish(ctx context.Context, user, project, relative, title string) (any, error) {
	w, err := s.assistantWork(user, project)
	if err != nil {
		return nil, err
	}
	var result any
	err = w.ReadArtifact(relative, func(file *os.File) error {
		info, err := file.Stat()
		if err != nil {
			return err
		}
		if info.Size() > 512<<20 {
			return kernel.BadAuthRequest("导入文件超过 512 MiB")
		}
		kind := ""
		switch strings.ToLower(filepath.Ext(relative)) {
		case ".png", ".jpg", ".jpeg", ".webp", ".gif":
			kind = "image"
		case ".mp4", ".webm", ".mov":
			kind = "video"
		case ".mp3", ".wav", ".m4a", ".ogg", ".flac":
			kind = "audio"
		default:
			return kernel.BadAuthRequest("请导入图片、视频或音频；场景代码用候选场景接口")
		}
		hash := sha256.New()
		if _, err = file.WriteTo(hash); err != nil {
			return err
		}
		contentHash := hex.EncodeToString(hash.Sum(nil))
		if _, err = file.Seek(0, 0); err != nil {
			return err
		}
		idSum := sha256.Sum256([]byte(user + "\x00" + project + "\x00" + contentHash))
		id := "workspace_" + hex.EncodeToString(idSum[:])
		if existing, e := s.UserAsset(user, id); e == nil {
			result = map[string]any{"assetId": id, "asset": existing, "reused": true}
			return nil
		} else if !errors.Is(e, gorm.ErrRecordNotFound) {
			return e
		}
		metadata, err := mediareview.Read(ctx, filepath.Join(s.dataDir, "cache", "media-review"), file, info.Size(), kind, false, nil, 0)
		if err != nil {
			return kernel.BadAuthRequest(err.Error())
		}
		if _, err = file.Seek(0, 0); err != nil {
			return err
		}
		resource, err := s.UploadLocalResourceFile(user, filepath.Base(relative), info.Size(), kind, metadata.Width, metadata.Height, metadata.DurationMs, file, "agent-workspace:"+project+":"+contentHash)
		if err != nil {
			return err
		}
		if strings.TrimSpace(title) == "" {
			title = filepath.Base(relative)
		}
		data := map[string]any{"storageKey": "resource:" + resource.ID, "url": resource.PublicURL, "dataUrl": resource.PublicURL, "width": resource.Width, "height": resource.Height, "duration": float64(resource.DurationMs) / 1000, "bytes": resource.Size, "mimeType": resource.MimeType}
		payload, _ := json.Marshal(map[string]any{"id": id, "kind": kind, "title": title, "coverUrl": "", "tags": []string{}, "data": data})
		saved, err := s.UpsertUserAsset(user, payload)
		if err != nil {
			return err
		}
		result = map[string]any{"assetId": saved.ID, "resourceId": resource.ID, "kind": kind, "title": title, "storageKey": "resource:" + resource.ID, "nextStep": "Use existing edit asset import or canvas tools to place this owned asset."}
		return nil
	})
	return result, err
}
