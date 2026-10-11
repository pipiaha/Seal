package handler

import (
	"infinite-canvas/backend/internal/app"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssistantWorkspaceRoutesRequireOwnedOpenTurn(t *testing.T) {
	env := newAssistantTestEnv(t, nil)
	env.router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{AssistantHost: env.assistantHost, DesktopTrust: func(r *http.Request) bool {
		return r.Header.Get("X-Desktop-Token") == "launch" && r.Header.Get("X-Beeftv-UI-Bootstrap") == "ui"
	}}))
	RegisterAssistantWorkspaceRoutes(env.router.Group("/api"), env.service, env.assistantHost)
	owner, _ := env.service.LocalWorkspaceOwner()
	turn := strings.Repeat("a", 32)
	if _, err := env.service.BeginAssistantTurn(owner.ID, env.canvasID, turn, app.AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body, turn string, host bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://127.0.0.1/api/"+path, strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("Content-Type", "application/json")
		if host {
			req.Header.Set(assistantHostTokenHeader, assistantTestHostToken)
			if turn != "" {
				req.Header.Set(assistantTurnHeader, turn)
			}
		} else {
			req.Header.Set("X-Desktop-Token", "launch")
			req.Header.Set("X-Beeftv-UI-Bootstrap", "ui")
		}
		out := httptest.NewRecorder()
		env.router.ServeHTTP(out, req)
		return out
	}
	path := "assistant/projects/" + env.canvasID + "/workspace/files"
	if r := call("POST", path, `{"action":"write","path":"draft.txt","text":"ok"}`, turn, true); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := call("POST", path, `{"action":"read","path":"draft.txt"}`, "", true); r.Code != 403 {
		t.Fatal("host used tools without open turn", r.Code)
	}
	if r := call("POST", path, `{"action":"read","path":"../private"}`, turn, true); r.Code != 400 {
		t.Fatal("path escaped", r.Code)
	}
	if r := call("POST", "assistant/projects/unknown/workspace/info", `{}`, turn, true); r.Code == 200 {
		t.Fatal("unknown project accepted")
	}
	if r := call("PUT", "assistant/web-settings", `{"enabled":true,"apiKey":"forged"}`, turn, true); r.Code != 403 {
		t.Fatal("host changed search credentials", r.Code)
	}
	if r := call("POST", "assistant/web-test", `{"query":"fixture"}`, turn, true); r.Code != 403 {
		t.Fatal("host used UI search test endpoint", r.Code)
	}
	if r := call("POST", "assistant/web-test", `{"query":"fixture"}`, "", false); r.Code == 200 || !strings.Contains(r.Body.String(), "启用搜索") {
		t.Fatal("UI test did not respect disabled search", r.Code, r.Body.String())
	}
	if r := call("PUT", "assistant/web-settings", `{"enabled":true,"apiKey":"fixture"}`, "", false); r.Code != 200 {
		t.Fatal("trusted UI rejected", r.Code, r.Body.String())
	}
	if r := call("GET", "assistant/web-settings", "", turn, true); r.Code != 200 || strings.Contains(r.Body.String(), "fixture") {
		t.Fatal("search key leaked", r.Code, r.Body.String())
	}
}
