package generation

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type comfyResources struct{}

func (comfyResources) LocalMode() bool { return true }
func (comfyResources) Lookup(string, string) (ResourceInfo, error) {
	return ResourceInfo{}, fmt.Errorf("unused")
}
func (comfyResources) Open(string, string) (ResourceInfo, io.ReadCloser, error) {
	return ResourceInfo{}, nil, fmt.Errorf("unused")
}
func (comfyResources) PublicURL(ResourceInfo, time.Time) (string, error) {
	return "", fmt.Errorf("unused")
}
func (comfyResources) HTTPSPublicURL(ResourceInfo, time.Time) (string, error) {
	return "", fmt.Errorf("unused")
}

type comfyReceipt struct{ id string }

func (r *comfyReceipt) Ready(context.Context) error { return nil }
func (r *comfyReceipt) RecordAccepted(_ context.Context, id, stage string, _ *time.Time) error {
	r.id = id
	return nil
}
func (r *comfyReceipt) UpdateStage(context.Context, string, string, *time.Time) error { return nil }

func TestComfySubmissionUploadAndResume(t *testing.T) {
	creates, uploads := 0, 0
	receipt := &comfyReceipt{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/object_info":
			fmt.Fprint(w, `{"TextEncoder":{},"LoadImage":{},"SaveImage":{}}`)
		case "/upload/image":
			uploads++
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
			}
			file, _, err := r.FormFile("image")
			if err != nil {
				t.Error(err)
			} else {
				file.Close()
			}
			fmt.Fprint(w, `{"name":"ref.png","subfolder":"seal"}`)
		case "/prompt":
			creates++
			var request struct {
				Prompt map[string]map[string]any `json:"prompt"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			text := request.Prompt["1"]["inputs"].(map[string]any)
			image := request.Prompt["2"]["inputs"].(map[string]any)
			if text["text"] != "test scene" || image["image"] != "seal/ref.png" {
				t.Errorf("bad bindings: %#v", request)
			}
			fmt.Fprint(w, `{"prompt_id":"comfy-job"}`)
		case "/history/comfy-job":
			if receipt.id != "comfy-job" {
				t.Error("polled before durable receipt")
			}
			fmt.Fprint(w, `{"comfy-job":{"status":{"completed":true,"status_str":"success"},"outputs":{"3":{"images":[{"filename":"out.png","subfolder":"","type":"output"}]}}}}`)
		case "/view":
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte{137, 80, 78, 71, 13, 10, 26, 10})
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	input := Input{Mode: "image", Prompt: "test scene", Config: Config{InterfaceType: "comfyui-image", AuthType: "none", BaseURL: server.URL, Model: "workflow", ComfyUI: &ComfyWorkflow{Graph: map[string]any{"1": map[string]any{"class_type": "TextEncoder", "inputs": map[string]any{"text": "original"}}, "2": map[string]any{"class_type": "LoadImage", "inputs": map[string]any{"image": "original.png"}}, "3": map[string]any{"class_type": "SaveImage", "inputs": map[string]any{"images": []any{"2", 0}}}}, Fields: []WorkflowField{{NodeID: "1", FieldName: "text", Source: "prompt"}, {NodeID: "2", FieldName: "image", Source: "referenceImage"}}, OutputNodeID: "3", OutputField: "images"}}, ReferenceImages: []Media{{ID: "ref", DataURL: "data:image/png;base64,iVBORw0KGgo="}}}
	runtime := taskRuntime(func(r *Runtime) { r.Resources = comfyResources{}; r.Submission = receipt })
	result, err := Execute(WithRuntime(context.Background(), runtime), input)
	if err != nil {
		t.Fatal(err)
	}
	if result["mode"] != "image" || creates != 1 || uploads != 1 {
		t.Fatalf("unexpected result %#v", result)
	}
	runtime.Call.ProviderRequestID = receipt.id
	if _, err := Execute(WithRuntime(context.Background(), runtime), input); err != nil {
		t.Fatal(err)
	}
	if creates != 1 || uploads != 1 {
		t.Fatal("resume resubmitted or reuploaded")
	}
}

func TestComfyCancelNeverGloballyInterrupts(t *testing.T) {
	removed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/jobs/job/cancel", "/api/jobs/other/cancel":
			w.WriteHeader(404)
		case "/queue":
			if r.Method == "POST" {
				removed = true
				fmt.Fprint(w, `{}`)
			} else if removed {
				fmt.Fprint(w, `{"queue_pending":[],"queue_running":[]}`)
			} else {
				fmt.Fprint(w, `{"queue_pending":[[0,"job"]],"queue_running":[]}`)
			}
		default:
			t.Errorf("unexpected cancel endpoint %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	config := Config{BaseURL: server.URL, AuthType: "none"}
	if err := CancelComfyUITask(context.Background(), config, "job"); err != nil {
		t.Fatal(err)
	}
	if err := CancelComfyUITask(context.Background(), config, "other"); err == nil || !strings.Contains(err.Error(), "不会全局中断") {
		t.Fatalf("unsupported cancel lied: %v", err)
	}
}
