package generation

import (
	"context"
	"fmt"
	"infinite-canvas/backend/internal/protocol"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestConfiguredHTTPExactEndpointAndResume(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	creates, polls := 0, 0
	receipt := &comfyReceipt{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("anonymous channel sent auth")
		}
		switch r.URL.Path {
		case "/my-api/create":
			creates++
			fmt.Fprint(w, `{"data":{"id":"job-1","state":"queued"}}`)
		case "/my-api/jobs/job-1":
			polls++
			if receipt.id != "job-1" {
				t.Error("missing durable receipt")
			}
			fmt.Fprint(w, `{"data":{"state":"done","image":"iVBORw0KGgo="}}`)
		default:
			t.Errorf("wrong configured path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	provider := protocol.ManifestProvider{Auth: protocol.ManifestAuth{Type: "none"}, Create: protocol.ManifestOperation{Method: "POST", Path: "/create", Fields: map[string]string{"prompt": "request.prompt"}}, Poll: &protocol.ManifestOperation{Method: "GET", Path: "/jobs/{task_id}"}, Response: protocol.ManifestResponse{TaskIDPaths: []string{"data.id"}, StatusPaths: []string{"data.state"}, StatusMap: map[string]protocol.Status{"queued": protocol.StatusPending, "done": protocol.StatusSucceeded}, InlineBase64Paths: []string{"data.image"}, InlineMIME: "image/png"}}
	adapter, err := protocol.ConfiguredProvider(provider, protocol.CapabilityImage)
	if err != nil {
		t.Fatal(err)
	}
	input := Input{Mode: "image", Prompt: "draw", Config: Config{BaseURL: server.URL + "/my-api", InterfaceType: "custom-image", AuthType: "none", Model: "fixture", CustomProvider: &provider}}
	runtime := taskRuntime(func(r *Runtime) { r.Submission = receipt })
	policy := DeclarativeProtocolPollPolicy("image")
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	result, err := RunProtocolAdapterTaskWithPolicy(WithRuntime(context.Background(), runtime), input, adapter, policy)
	if err != nil || result["mode"] != "image" {
		t.Fatalf("bad custom result %#v %v", result, err)
	}
	runtime.Call.ProviderRequestID = receipt.id
	if _, err := RunProtocolAdapterTaskWithPolicy(WithRuntime(context.Background(), runtime), input, adapter, policy); err != nil {
		t.Fatal(err)
	}
	if creates != 1 || polls != 2 {
		t.Fatalf("resume repeated submission: %d %d", creates, polls)
	}
}
