package handler

import (
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	"strings"
	"testing"
)

func TestAssistantMediaAdmissionChecksTypeScopeAndText(t *testing.T) {
	raw := json.RawMessage(`{"nodes":[{"id":"video-node","type":"video","title":"实际素材名"}]}`)
	valid := assistantMediaInput{ID: "one", Name: "伪造标题", Kind: "video", NodeID: "video-node"}
	items, err := normalizeAssistantMedia(nil, "owner", "project", raw, nil, []assistantMediaInput{valid})
	if err != nil || items[0].Name != "实际素材名" {
		t.Fatal("did not canonicalize actual node", err)
	}
	cases := []assistantMediaInput{
		{ID: "one", Name: "missing", Kind: "video", NodeID: "foreign-node"},
		{ID: "one", Name: "wrong-kind", Kind: "audio", NodeID: "video-node"},
		{ID: "one", Name: "unscoped", Kind: "video", AssetID: "not-referenced"},
		{ID: "one", Name: "both", Kind: "video", AssetID: "a", NodeID: "video-node"},
		{ID: "one", Name: "sample.pdf", Kind: "text", Content: "not parsed PDF"},
		{ID: "one", Name: "sample.txt", Kind: "text", Content: "binary\x00data"},
		{ID: "one", Name: "sample.txt", Kind: "text", Content: strings.Repeat("字", 16001)},
	}
	for _, item := range cases {
		if _, err := normalizeAssistantMedia(nil, "owner", "project", raw, nil, []assistantMediaInput{item}); err == nil {
			t.Fatalf("invalid input accepted: %s", item.Name)
		}
	}
	text := assistantMediaInput{ID: "subtitle", Name: "字幕.srt", Kind: "text", Content: "1\n00:00:00,000 --> 00:00:01,000\nSeal"}
	if _, err := normalizeAssistantMedia(nil, "owner", "project", raw, nil, []assistantMediaInput{text}); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeAssistantMedia(nil, "owner", "project", raw, nil, []assistantMediaInput{text, text}); err == nil {
		t.Fatal("duplicate file accepted")
	}
}

func TestAssistantMediaAssetAdmissionUsesAuthoritativeOwnedRecord(t *testing.T) {
	env := newAssistantTestEnv(t, nil)
	owner, err := env.service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	asset := model.Asset{ID: "media", UserID: owner.ID, Kind: "video", Title: "实际视频", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{"kind":"audio","title":"旧标题","status":"archived","data":{}}`}
	if err := env.service.Database().Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	refs := []assistantReference{{Kind: "asset", ID: "media"}}
	item := assistantMediaInput{ID: "attachment", Name: "伪造", Kind: "video", AssetID: "media"}
	result, err := normalizeAssistantMedia(env.service, owner.ID, env.canvasID, nil, refs, []assistantMediaInput{item})
	if err != nil || result[0].Name != "实际视频" {
		t.Fatal("did not use authoritative asset", err)
	}
	if _, err := normalizeAssistantMedia(env.service, "foreign", env.canvasID, nil, refs, []assistantMediaInput{item}); err == nil {
		t.Fatal("foreign asset accepted")
	}
	if err := env.service.Database().Model(&asset).Update("status", model.AssetVersionStatusArchived).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeAssistantMedia(env.service, owner.ID, env.canvasID, nil, refs, []assistantMediaInput{item}); err == nil {
		t.Fatal("archived asset accepted")
	}
}
