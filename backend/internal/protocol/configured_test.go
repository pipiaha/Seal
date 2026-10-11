package protocol

import (
	"context"
	"testing"
)

func TestConfiguredProviderMappingAndAsyncState(t *testing.T) {
	provider := ManifestProvider{
		Auth:     ManifestAuth{Type: "none"},
		Create:   ManifestOperation{Method: "POST", Path: "/create", Body: map[string]any{"preset": "cinema"}, Fields: map[string]string{"text": "request.prompt"}},
		Poll:     &ManifestOperation{Method: "GET", Path: "/tasks/{task_id}"},
		Response: ManifestResponse{TaskIDPaths: []string{"data.job"}, StatusPaths: []string{"data.state"}, StatusMap: map[string]Status{"0": StatusPending, "2": StatusSucceeded}, ResultURLPaths: []string{"data.result"}, ResultKind: "video"},
	}
	adapter, err := ConfiguredProvider(provider, CapabilityVideo)
	if err != nil {
		t.Fatal(err)
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://example.com/v1", Request: GenerationRequest{Prompt: "draw"}})
	if err != nil {
		t.Fatal(err)
	}
	body := create.Body.(map[string]any)
	if body["text"] != "draw" || body["preset"] != "cinema" {
		t.Fatalf("lost request fields: %#v", body)
	}
	state, err := adapter.ParseCreate(context.Background(), []byte(`{"data":{"job":"job-1","state":0,"result":"https://example.com/placeholder.mp4"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if state.TaskID != "job-1" || state.Status != StatusPending {
		t.Fatalf("premature success: %#v", state)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "job/1"})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Path != "/tasks/job%2F1" {
		t.Fatalf("task ID not safely interpolated: %s", poll.Path)
	}
	done, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "job-1"}, []byte(`{"data":{"state":2,"result":"https://example.com/done.mp4"}}`))
	if err != nil || done.Status != StatusSucceeded || len(done.Result.Videos) != 1 {
		t.Fatalf("bad final state: %#v %v", done, err)
	}
	provider.Create.Path = "//evil.example/create"
	if _, err := ConfiguredProvider(provider, CapabilityVideo); err == nil {
		t.Fatal("accepted foreign endpoint")
	}
}
