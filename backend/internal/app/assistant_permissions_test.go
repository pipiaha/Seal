package app

import (
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAssistantPermissionModesControlRealGenerationAndContinuation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var requests atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII="}]}`))
	}))
	defer upstream.Close()
	dir := t.TempDir()
	svc, db := openDBRuntimeMatrix(t, dir)
	defer func() { closeDBRuntimeMatrix(t, svc, db) }()
	for _, id := range []string{"cut_modes", "cut_other"} {
		if err := db.Create(&model.EditingProject{ID: id, UserID: "local", Title: id}).Error; err != nil {
			t.Fatal(err)
		}
	}
	config := map[string]any{"imageModel": "fixture::fixture-model", "channels": []any{map[string]any{"id": "fixture", "enabled": true, "baseUrl": upstream.URL + "/v1", "apiKey": "synthetic-only", "models": []string{"fixture-model"}, "modelProfiles": []any{map[string]any{"model": "fixture-model", "capability": "image", "protocol": "openai-image"}}}}}
	encoded, _ := json.Marshal(map[string]any{"schemaVersion": 1, "revision": 1, "config": config})
	if err := svc.SaveLocalModelConfig(encoded); err != nil {
		t.Fatal(err)
	}
	proposal, err := svc.AssistantMediaPropose("local", "cut_modes", strings.Repeat("a", 64), "image", "one image", "", "session1")
	if err != nil {
		t.Fatal(err)
	}
	request := localtask.CreateRequest{Type: "canvas_image", Prompt: proposal.Prompt, Model: proposal.ModelKey, Input: map[string]any{"mode": "image", "prompt": proposal.Prompt, "config": map[string]any{"baseUrl": upstream.URL + "/v1", "apiKey": "synthetic-only", "model": "fixture-model", "interfaceType": "openai-image"}}}
	if mode, err := svc.AssistantPermissionMode("local", "cut_modes", "session1"); err != nil || mode != "ask" {
		t.Fatal("new conversation did not require approval", err)
	}
	if _, err := svc.AcceptAssistantMedia("local", "cut_modes", proposal.ID, request, true); err == nil {
		t.Fatal("automatic generation bypassed approval")
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 0 || requests.Load() != 0 {
		t.Fatal("unapproved work was admitted")
	}
	if err := svc.SetAssistantPermissionMode("local", "cut_modes", "session1", "allow"); err != nil {
		t.Fatal(err)
	}
	for _, target := range []struct{ project, session string }{{"cut_modes", "session2"}, {"cut_other", "session1"}} {
		mode, err := svc.AssistantPermissionMode("local", target.project, target.session)
		if err != nil || mode != "ask" {
			t.Fatal("permission leaked across conversations/projects", err)
		}
	}
	if err := svc.SetAssistantPermissionMode("foreign", "cut_modes", "session1", "allow"); err == nil {
		t.Fatal("foreign permission was writable")
	}
	accepted, err := svc.AcceptAssistantMedia("local", "cut_modes", proposal.ID, request, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AssistantMediaContinuationAssets("local", "cut_modes", "session1", proposal.ID); err == nil {
		t.Fatal("queued work was treated as ready")
	}
	if err := svc.taskWorker().processNextTask(); err != nil {
		t.Fatal(err)
	}
	ids, err := svc.AssistantMediaContinuationAssets("local", "cut_modes", "session1", proposal.ID)
	if err != nil || len(ids) != 1 {
		t.Fatal("real generated asset not ready for continuation", err)
	}
	if _, err := svc.AssistantMediaContinuationAssets("local", "cut_modes", "session2", proposal.ID); err == nil {
		t.Fatal("result continued another conversation")
	}
	first, err := svc.ClaimAssistantMediaContinuation("local", "cut_modes", "session1", proposal.ID, strings.Repeat("b", 32))
	if err != nil || !first {
		t.Fatal("first continuation failed", err)
	}
	second, err := svc.ClaimAssistantMediaContinuation("local", "cut_modes", "session1", proposal.ID, strings.Repeat("c", 32))
	if err != nil || second {
		t.Fatal("same result resumed twice", err)
	}
	closeDBRuntimeMatrix(t, svc, db)
	svc, db = openDBRuntimeMatrix(t, dir)
	mode, err := svc.AssistantPermissionMode("local", "cut_modes", "session1")
	if err != nil || mode != "allow" {
		t.Fatal("permission not restored", err)
	}
	reused, err := svc.AcceptAssistantMedia("local", "cut_modes", proposal.ID, request, true)
	if err != nil || reused.ID != accepted.ID || requests.Load() != 1 {
		t.Fatal("reopening resubmitted paid work", err)
	}
	manual, err := svc.AssistantMediaPropose("local", "cut_modes", strings.Repeat("d", 64), "image", "manual approval", "", "session2")
	if err != nil {
		t.Fatal(err)
	}
	request.Prompt = manual.Prompt
	request.Input["prompt"] = manual.Prompt
	if _, err := svc.AcceptAssistantMedia("local", "cut_modes", manual.ID, request, false); err != nil {
		t.Fatal("explicit approval refused", err)
	}
	stopped, err := svc.AssistantMediaPropose("local", "cut_modes", strings.Repeat("e", 64), "image", "stop this", "", "session1")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.StopAssistantMediaSession("local", "cut_modes", "session1"); err != nil {
		t.Fatal(err)
	}
	request.Prompt = stopped.Prompt
	request.Input["prompt"] = stopped.Prompt
	if _, err := svc.AcceptAssistantMedia("local", "cut_modes", stopped.ID, request, true); err == nil {
		t.Fatal("stopped automatic work admitted")
	}
	late, err := svc.AssistantMediaPropose("local", "cut_modes", strings.Repeat("1", 64), "image", "late arrival after stop", "", "session1")
	if err != nil || late.AutoContinue {
		t.Fatal("late proposal rearmed stopped conversation", err)
	}
	if err := svc.ResumeAssistantMediaSession("local", "cut_modes", "session1"); err != nil {
		t.Fatal(err)
	}
	fresh, err := svc.AssistantMediaPropose("local", "cut_modes", strings.Repeat("2", 64), "image", "new user request", "", "session1")
	if err != nil || !fresh.AutoContinue {
		t.Fatal("new user request did not resume conversation", err)
	}
	rejected, err := svc.AssistantMediaPropose("local", "cut_modes", strings.Repeat("f", 64), "image", "reject this", "", "session2")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RejectAssistantMedia("local", "cut_modes", rejected.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptAssistantMedia("local", "cut_modes", rejected.ID, request, false); err == nil {
		t.Fatal("rejected proposal admitted")
	}
	if _, err := svc.AssistantMediaContinuationAssets("local", "cut_modes", "session2", rejected.ID); err != nil {
		t.Fatal("rejection could not continue without assets", err)
	}
}
