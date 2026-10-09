package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssistantPermissionRoutesRejectHostSelfApproval(t *testing.T) {
	env := newAssistantTestEnv(t, nil)
	env.router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{DesktopTrust: func(r *http.Request) bool {
		return r.Header.Get("X-Desktop-Token") == "launch" && r.Header.Get("X-Beeftv-UI-Bootstrap") == "ui"
	}}))
	RegisterAssistantMediaRoutes(env.router.Group("/api"), env.service)
	call := func(action, body string, headers map[string]string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/assistant/projects/"+env.canvasID+"/permissions/"+action, strings.NewReader(body))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			request.Header.Set(key, value)
		}
		recorder := httptest.NewRecorder()
		env.router.ServeHTTP(recorder, request)
		return recorder
	}
	valid := map[string]string{"X-Desktop-Token": "launch", "X-Beeftv-UI-Bootstrap": "ui"}
	if response := call("write", `{"sessionId":"session1","mode":"allow"}`, valid); response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, action := range []string{"write", "stop", "read", "resume"} {
		if response := call(action, `{"sessionId":"session1","mode":"allow"}`, map[string]string{assistantHostTokenHeader: "host-test"}); response.Code != 403 {
			t.Fatal("host can grant its own permissions", response.Code)
		}
	}
	if response := call("write", `{"sessionId":"session1","mode":"allow"}`, nil); response.Code != 403 {
		t.Fatal("untrusted UI changed permissions")
	}
	owner, _ := env.service.LocalWorkspaceOwner()
	if mode, err := env.service.AssistantPermissionMode(owner.ID, env.canvasID, "session1"); err != nil || mode != "allow" {
		t.Fatal("UI grant lost", err)
	}
	if err := env.service.SetAssistantPermissionMode(owner.ID, env.canvasID, "session2", "invalid"); err == nil {
		t.Fatal("unknown mode accepted")
	}
}
