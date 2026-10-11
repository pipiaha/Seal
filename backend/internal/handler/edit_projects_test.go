package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/editruntime"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestEditingRoutesRequireTrustedUIOrOwnedOpenAssistantTurn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "local"}).Error; err != nil {
		t.Fatal(err)
	}
	svc := app.NewLocal(repository.New(db), t.TempDir())
	owner, err := svc.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"edit_canvas", "other_canvas"} {
		raw, _ := json.Marshal(map[string]any{"id": id, "title": id, "revision": 0, "nodes": []any{}, "connections": []any{}})
		if _, err := svc.UpsertUserCanvasProject(owner.ID, raw); err != nil {
			t.Fatal(err)
		}
	}
	turnID := strings.Repeat("a", 32)
	if _, err := svc.BeginAssistantTurn(owner.ID, "edit_canvas", turnID, app.AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BEEFTV_AGENT_HOST_TOKEN", "host-test")
	router := gin.New()
	router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{DesktopTrust: func(r *http.Request) bool {
		return r.Header.Get("X-Desktop-Token") == "launch" && r.Header.Get("X-Beeftv-UI-Bootstrap") == "ui"
	}, RequestCoordinator: &stubRequestCoordinator{allowed: true}}))
	RegisterEditProjectRoutes(router.Group("/api"), svc, nil)
	RegisterAssistantCreatorRoutes(router.Group("/api"), svc, nil)
	RegisterAssistantMediaRoutes(router.Group("/api"), svc)
	call := func(path string, headers map[string]string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:18090/api/edit-projects/"+path, strings.NewReader("{}"))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			request.Header.Set(key, value)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	validHost := map[string]string{assistantHostTokenHeader: "host-test", assistantTurnHeader: turnID}
	ui := map[string]string{"X-Desktop-Token": "launch", "X-Beeftv-UI-Bootstrap": "ui"}
	creatorCall := func(project, action string, headers map[string]string, bodies ...string) *httptest.ResponseRecorder {
		body := "{}"
		if len(bodies) > 0 {
			body = bodies[0]
		}
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:18090/api/assistant/projects/"+project+"/"+action, strings.NewReader(body))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			request.Header.Set(key, value)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	for _, probe := range []struct {
		project, action string
		headers         map[string]string
		status          int
	}{
		{"edit_canvas", "skills/list", nil, 403},
		{"edit_canvas", "skills/list", ui, 200},
		{"edit_canvas", "skills/list", validHost, 200},
		{"other_canvas", "skills/list", validHost, 403},
		{"edit_canvas", "skills/list", map[string]string{"X-Desktop-Token": "launch", "X-Beeftv-UI-Bootstrap": "ui", assistantTurnHeader: turnID}, 403},
		{"edit_canvas", "skills/list", map[string]string{assistantHostTokenHeader: "host-test", assistantTurnHeader: turnID, "X-Beeftv-Client": "external"}, 403},
		{"edit_canvas", "media/accept/any", validHost, 403},
		{"edit_canvas", "media/transcribe", validHost, 400},
		{"edit_canvas", "providers/read", nil, 403},
		{"edit_canvas", "providers/read", validHost, 200},
		{"other_canvas", "providers/read", validHost, 403},
		{"edit_canvas", "providers/save", validHost, 400},
	} {
		if result := creatorCall(probe.project, probe.action, probe.headers); result.Code != probe.status {
			t.Fatalf("creator %s %s: %d %s", probe.project, probe.action, result.Code, result.Body.String())
		}
	}
	channelEdit, _ := json.Marshal(map[string]any{"operationId": strings.Repeat("d", 64), "expectedRevision": 0, "name": "Assistant Channel", "baseUrl": "https://example.com/v1", "capability": "image", "model": "fixture-image", "apiKey": "synthetic-route-key", "script": `{create:{method:"POST",path:"/images",body:{model,prompt}},response:{result:"url"}}`})
	if result := creatorCall("edit_canvas", "providers/save", validHost, string(channelEdit)); result.Code != 200 || !strings.Contains(result.Body.String(), `"saved":true`) || !strings.Contains(result.Body.String(), `"needsCredential":false`) || strings.Contains(result.Body.String(), "synthetic-route-key") {
		t.Fatalf("assistant could not save channel: %d %s", result.Code, result.Body.String())
	}
	if result := creatorCall("edit_canvas", "providers/save", validHost, `{"secretKey":"forbidden"}`); result.Code != 400 {
		t.Fatal("assistant accepted unsupported credential fields")
	}
	for _, probe := range []struct {
		label, path string
		headers     map[string]string
		status      int
	}{
		{"untrusted loopback", "edit_canvas/production", nil, 403},
		{"launch token alone", "edit_canvas/production", map[string]string{"X-Desktop-Token": "launch"}, 403},
		{"trusted UI", "edit_canvas/production", ui, 503},
		{"host without a turn", "edit_canvas/production", map[string]string{assistantHostTokenHeader: "host-test"}, 403},
		{"host with an owned open turn", "edit_canvas/production", validHost, 503},
		{"host changes canvas", "other_canvas/production", validHost, 403},
		{"HyperFrames untrusted", "edit_canvas/edits/edit_test/hyperframes/candidate", nil, 403},
		{"HyperFrames owned turn", "edit_canvas/edits/edit_test/hyperframes/candidate", validHost, 503},
		{"HyperFrames wrong project", "other_canvas/edits/edit_test/hyperframes/export", validHost, 403},
		{"UI borrows turn", "edit_canvas/production", map[string]string{"X-Desktop-Token": "launch", "X-Beeftv-UI-Bootstrap": "ui", assistantTurnHeader: turnID}, 403},
		{"external client borrows UI", "edit_canvas/production", map[string]string{"X-Desktop-Token": "launch", "X-Beeftv-UI-Bootstrap": "ui", "X-Beeftv-Client": "client"}, 403},
	} {
		result := call(probe.path, probe.headers)
		if result.Code != probe.status {
			t.Fatalf("%s: %d %s", probe.label, result.Code, result.Body.String())
		}
	}
	if err := svc.FinalizeAssistantTurn(turnID); err != nil {
		t.Fatal(err)
	}
	if result := call("edit_canvas/production", validHost); result.Code != 403 {
		t.Fatalf("settled turn: %d %s", result.Code, result.Body.String())
	}
	if result := creatorCall("edit_canvas", "skills/list", validHost); result.Code != 403 {
		t.Fatal("closed creator turn accepted")
	}
	if result := creatorCall("edit_canvas", "providers/read", validHost); result.Code != 403 {
		t.Fatal("closed turn accessed provider tools")
	}

	// With a real supervisor object, admission failures must happen before
	// starting it, streaming an out-of-scope asset or overriding candidate CAS.
	secondTurn := strings.Repeat("b", 32)
	if _, err := svc.BeginAssistantTurn(owner.ID, "edit_canvas", secondTurn, app.AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	guarded := gin.New()
	RegisterEditProjectRoutes(guarded.Group("/api"), svc, editruntime.New(t.TempDir()))
	for _, asset := range []model.Asset{
		{ID: "owned_not_referenced", UserID: owner.ID, Kind: "image", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{"data":{}}`},
		{ID: "foreign_asset", UserID: "foreign", Kind: "image", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{"data":{}}`},
	} {
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, probe := range []struct {
		action, body, reason string
		status               int
	}{
		{"hypit/assets/import", `{"assetId":"owned_not_referenced","operationId":"op","expectedRevision":0}`, "素材还没有保存到本地资产库", 409},
		{"assets/import", `{"assetId":"owned_not_referenced","operationId":"op","expectedRevision":0}`, "素材还没有保存到本地资产库", 409},
		{"hypit/assets/import", `{"assetId":"foreign_asset","operationId":"op","expectedRevision":0}`, "asset_import_failed", 404},
		{"assets/import", `{"assetId":"foreign_asset","operationId":"op","expectedRevision":0}`, "asset_import_failed", 404},
		{"promote", `{"candidateId":"candidate","operationId":"op","expectedRevision":0}`, "candidate_review_required", 403},
		{"promote", `null`, "候选提交无效", 400},
	} {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:18090/api/edit-projects/edit_canvas/edits/edit_test/"+probe.action, strings.NewReader(probe.body))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(assistantHostTokenHeader, "host-test")
		request.Header.Set(assistantTurnHeader, secondTurn)
		response := httptest.NewRecorder()
		guarded.ServeHTTP(response, request)
		if response.Code != probe.status || !strings.Contains(response.Body.String(), probe.reason) {
			t.Fatalf("%s: %d %s", probe.action, response.Code, response.Body.String())
		}
	}
}
