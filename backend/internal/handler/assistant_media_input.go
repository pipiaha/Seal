package handler

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/app"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type assistantMediaInput struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	AssetID string `json:"assetId,omitempty"`
	NodeID  string `json:"nodeId,omitempty"`
	Content string `json:"content,omitempty"`
}

func normalizeAssistantMedia(svc *app.Service, userID, projectID string, raw json.RawMessage, references []assistantReference, items []assistantMediaInput) ([]assistantMediaInput, error) {
	if len(items) > 8 {
		return nil, errors.New("一次最多附带或引用 8 项音视频和文字文件")
	}
	total := 0
	seen := map[string]bool{}
	assets := map[string]bool{}
	for _, ref := range references {
		if ref.Kind == "asset" {
			assets[ref.ID] = true
		}
	}
	var doc struct {
		Nodes []struct {
			ID    string `json:"id"`
			Type  string `json:"type"`
			Title string `json:"title"`
		} `json:"nodes"`
	}
	_ = json.Unmarshal(raw, &doc)
	out := make([]assistantMediaInput, 0, len(items))
	for _, item := range items {
		if item.ID == "" || len(item.ID) > 160 || seen[item.ID] || utf8.RuneCountInString(item.Name) > 240 || strings.ContainsAny(item.Name, "\r\n\x00") {
			return nil, errors.New("附件信息无效")
		}
		seen[item.ID] = true
		if item.Kind == "text" {
			ext := strings.ToLower(filepath.Ext(item.Name))
			if !strings.Contains("|.txt|.md|.json|.csv|.srt|.vtt|", "|"+ext+"|") || item.AssetID != "" || item.NodeID != "" || strings.ContainsRune(item.Content, '\x00') || utf8.RuneCountInString(item.Content) > 16000 {
				return nil, errors.New("文字附件须为 UTF-8 文字或字幕文件，最多 16000 字符")
			}
			total += utf8.RuneCountInString(item.Content)
			if total > 64000 {
				return nil, errors.New("文字附件合计不能超过 64000 字符")
			}
		} else {
			if item.Kind != "video" && item.Kind != "audio" || item.Content != "" || (item.AssetID == "") == (item.NodeID == "") {
				return nil, errors.New("音视频附件引用无效")
			}
			var kind, title string
			if item.AssetID != "" {
				if !assets[item.AssetID] {
					return nil, errors.New("附件未包含在本轮素材引用中")
				}
				actualTitle, actualKind, err := svc.AssistantMediaAssetIdentity(userID, projectID, item.AssetID)
				if err != nil {
					return nil, err
				}
				kind, title = actualKind, actualTitle
			} else {
				for _, node := range doc.Nodes {
					if node.ID == item.NodeID {
						kind, title = node.Type, node.Title
						break
					}
				}
			}
			if kind != item.Kind {
				return nil, errors.New("附件与当前工程的素材类型不一致")
			}
			item.Name = string([]rune(title)[:min(len([]rune(title)), 240)])
		}
		out = append(out, item)
	}
	return out, nil
}
