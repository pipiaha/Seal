package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/generation"
)

func TestComfyUIInspectClosedServiceHasActionableError(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := "http://" + listener.Addr().String()
	_ = listener.Close()
	s := NewLocal(nil, t.TempDir())
	_, err = s.InspectLocalComfyUI(context.Background(), generation.Config{BaseURL: address, InterfaceType: "comfyui-video", AuthType: "none"})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Message != "无法连接 ComfyUI，请确认已启动，并检查服务地址与端口" {
		t.Fatalf("unclassified inspect error: %T %v", err, err)
	}
}

func TestComfyUIInspectReadsNodesWithoutSubmitting(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("unexpected write %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/system_stats" {
			_, _ = w.Write([]byte(`{"system":{}}`))
		} else if r.URL.Path == "/object_info" {
			_, _ = w.Write([]byte(`{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["test.safetensors"]]}}}}`))
		} else {
			t.Errorf("unexpected route %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	s := NewLocal(nil, t.TempDir())
	result, err := s.InspectLocalComfyUI(context.Background(), generation.Config{BaseURL: server.URL, InterfaceType: "comfyui-video", AuthType: "none"})
	if err != nil {
		t.Fatal(err)
	}
	nodes, ok := result["nodes"].(map[string]any)
	if !ok || nodes["CheckpointLoaderSimple"] == nil {
		t.Fatalf("missing nodes: %v", result)
	}
}
