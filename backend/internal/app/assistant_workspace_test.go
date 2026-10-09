package app

import (
	"bytes"
	"encoding/json"
	"infinite-canvas/backend/internal/editing"
	"infinite-canvas/backend/internal/model"
	"testing"
)

func TestAssistantWorkspaceOwnedAssetRoundTripAndSettings(t *testing.T) {
	if _, err := editing.ResolveFFmpegBinary(); err != nil {
		t.Skip("media integration requires FFmpeg")
	}
	fixture, db := newTimelineTaskTestService(t)
	s := NewLocal(fixture.repo, t.TempDir())
	defer s.Close()
	project := model.EditingProject{ID: "cut_workspace", UserID: "owner", Title: "Workspace"}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AssistantWorkspaceInfo("other", project.ID, "", ""); err == nil {
		t.Fatal("other owner entered workspace")
	}
	w, err := s.assistantWork("owner", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.Copy("output/test.wav", bytes.NewReader(assistantTestWAV()), 1024); err != nil {
		t.Fatal(err)
	}
	result, err := s.AssistantWorkspacePublish(t.Context(), "owner", project.ID, "output/test.wav", "Script result")
	if err != nil {
		t.Fatal(err)
	}
	id := result.(map[string]any)["assetId"].(string)
	raw, err := s.UserAsset("owner", id)
	if err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Data struct {
			Duration float64 `json:"duration"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &metadata) != nil || metadata.Data.Duration <= 0 {
		t.Fatal("actual media duration missing")
	}
	reused, err := s.AssistantWorkspacePublish(t.Context(), "owner", project.ID, "output/test.wav", "Script result")
	if err != nil || reused.(map[string]any)["assetId"] != id {
		t.Fatal("publication duplicated", err)
	}
	if _, err = s.AssistantWorkspaceAsset("owner", project.ID, id, "materials/copy.wav"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AssistantWorkspaceAsset("other", project.ID, id, "materials/stolen.wav"); err == nil {
		t.Fatal("asset stolen")
	}
	if _, err = s.AssistantAssetsSearch("owner", project.ID, "Script", "audio", 1); err != nil {
		t.Fatal(err)
	}
}

func TestAssistantWorkspaceSearchSettingsIsolation(t *testing.T) {
	fixture, _ := newTimelineTaskTestService(t)
	s := NewLocal(fixture.repo, t.TempDir())
	defer s.Close()
	settings, err := s.SaveAssistantWebSettings("owner", AssistantWebSettings{Enabled: true, APIKey: "fixture-secret"})
	if err != nil || !settings.Configured || settings.APIKey != "" {
		t.Fatal("key exposed", err)
	}
	row, _ := s.repo.SystemSetting(webSettingsKey("owner"))
	var stored map[string]any
	json.Unmarshal([]byte(row.ValueJSON), &stored)
	if stored["apiKey"] == "fixture-secret" {
		t.Fatal("key stored plaintext")
	}
	other, err := s.AssistantWebSettings("other")
	if err != nil || other.Configured {
		t.Fatal("cross-user key", err)
	}
	preserved, err := s.SaveAssistantWebSettings("owner", AssistantWebSettings{Enabled: false})
	if err != nil || !preserved.Configured {
		t.Fatal("blank save erased key", err)
	}
	cleared, err := s.SaveAssistantWebSettings("owner", AssistantWebSettings{ClearKey: true})
	if err != nil || cleared.Configured {
		t.Fatal("clear key failed", err)
	}
}
