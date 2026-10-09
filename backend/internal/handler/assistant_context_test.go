package handler

import (
	"encoding/json"
	"infinite-canvas/backend/internal/app"
	"net/http"
	"strings"
	"testing"
)

func TestAssistantContextOverviewExcludesBodies(t *testing.T) {
	raw := json.RawMessage(`{"title":"Demo","revision":3,"nodes":[{"id":"a","type":"video","title":"clip","content":"private-body","url":"data:secret"},{"id":"b","type":"text","data":{"title":"selected"}}],"connections":[{}]}`)
	summary := assistantContextOverview(raw, []string{"b"})
	encoded, _ := json.Marshal(summary)
	if strings.Contains(string(encoded), "private-body") || strings.Contains(string(encoded), "data:secret") || strings.Contains(string(encoded), "clip") {
		t.Fatal("overview leaked unselected bodies")
	}
	if !strings.Contains(string(encoded), "selected") || summary["nodeCount"] != 2 || summary["edgeCount"] != 1 {
		t.Fatalf("bad overview: %s", encoded)
	}
}

func TestAssistantSteerRequiresAnOwnedOpenTurn(t *testing.T) {
	hits := 0
	env := newAssistantTestEnv(t, func(env *assistantTestEnv) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/steer" {
				hits++
				_, _ = w.Write([]byte(`{"state":"queued"}`))
				return
			}
			_, _ = w.Write([]byte(`{}`))
		})
	})
	owner, err := env.service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.service.BeginAssistantTurn(owner.ID, env.canvasID, "abcd1234", app.AssistantTurnInput{}); err != nil {
		t.Fatal(err)
	}
	body := `{"canvasId":"` + env.canvasID + `","sessionId":"owned-session","turnId":"abcd1234","instructionId":"i1","message":"white subtitles"}`
	if response := env.call(t, http.MethodPost, "/assistant/steer", body); response.Code != 200 || hits != 1 {
		t.Fatalf("steer rejected: %d %s", response.Code, response.Body.String())
	}
	invalid := strings.Replace(body, "abcd1234", "abcd9999", 1)
	if response := env.call(t, http.MethodPost, "/assistant/steer", invalid); response.Code != 409 || hits != 1 {
		t.Fatal("unknown turn forwarded")
	}
	if response := env.callWithHeaders(t, http.MethodPost, "/assistant/steer", body, map[string]string{"X-Beeftv-Ui-Session": "expired"}); response.Code != 403 || hits != 1 {
		t.Fatal("unauthenticated steering accepted")
	}
	if err := env.service.FinalizeAssistantTurn("abcd1234"); err != nil {
		t.Fatal(err)
	}
	if response := env.call(t, http.MethodPost, "/assistant/steer", body); response.Code != 409 || hits != 1 {
		t.Fatal("settled turn forwarded")
	}
}
