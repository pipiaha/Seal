package protocol

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

const arrayProviderScript = `{
  requiresPublicMediaUrls: true,
  create: {method: "POST", path: "/generate", body: {
    model, params: [{text: prompt}, ...images.map(url => ({image: url}))],
    options: {seconds, aspect_ratio: aspectRatio}, literal: {"$ref": "supplier.field"}
  }},
  poll: {method: "GET", path: "/jobs/{task_id}"},
  cancel: {method: "DELETE", path: "/jobs/{task_id}"},
  response: {
    taskId: data => data.data.id,
    status: data => data.data.state,
    statusMap: {"0": "pending", "2": "succeeded"},
    result: data => data.data.results || [],
    error: data => data.error?.message || null
  }
}`

func TestProviderScriptArraysCallbacksAndSnapshot(t *testing.T) {
	ctx := context.Background()
	saved, err := json.Marshal(ManifestProvider{Script: arrayProviderScript, Auth: ManifestAuth{Type: "bearer"}})
	if err != nil {
		t.Fatal(err)
	}
	var provider ManifestProvider
	if err := json.Unmarshal(saved, &provider); err != nil {
		t.Fatal(err)
	}
	adapter, err := ConfiguredProvider(provider, CapabilityVideo)
	if err != nil {
		t.Fatal(err)
	}
	if !adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("lost media policy")
	}
	req := GenerationRequest{Model: "fixture", Prompt: "keep ${request.model} literal", Duration: 6, AspectRatio: "9:16", Images: []MediaReference{{URL: "https://example.com/a.png"}, {URL: "https://example.com/b.png"}}}
	spec, err := adapter.BuildCreate(ctx, RequestContext{Request: req})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	params := body["params"].([]any)
	if len(params) != 3 || params[0].(map[string]any)["text"] != req.Prompt || params[2].(map[string]any)["image"] != req.Images[1].URL || body["literal"].(map[string]any)["$ref"] != "supplier.field" || spec.Auth.Type != "bearer" {
		t.Fatalf("bad evaluated request: %#v", spec)
	}
	created, err := adapter.ParseCreate(ctx, []byte(`{"data":{"id":"job/1","state":0,"results":["https://example.com/placeholder.mp4"]}}`))
	if err != nil || created.TaskID != "job/1" || created.Status != StatusPending {
		t.Fatalf("bad receipt: %#v %v", created, err)
	}
	pc := PollContext{Request: req, TaskID: created.TaskID}
	poll, err := adapter.BuildPoll(ctx, pc)
	if err != nil || poll.Path != "/jobs/job%2F1" {
		t.Fatalf("unsafe task path: %#v %v", poll, err)
	}
	done, err := adapter.ParsePoll(ctx, pc, []byte(`{"data":{"state":2,"results":["https://example.com/final.mp4"]}}`))
	if err != nil || done.Status != StatusSucceeded || done.Result == nil || len(done.Result.Videos) != 1 {
		t.Fatalf("bad callback result: %#v %v", done, err)
	}
	cancel, err := adapter.BuildCancel(ctx, pc)
	if err != nil || cancel.Method != "DELETE" || cancel.Path != poll.Path {
		t.Fatalf("bad cancel: %#v %v", cancel, err)
	}
}

func TestProviderScriptPreviewMultipartAndBase64(t *testing.T) {
	source := `{
create: {method:"POST", path:"/images", contentType:"multipart/form-data", body:{prompt}, files:request.images.map(image => ({name:"image",source:image}))},
response: {base64: data => data.images.map(image => image.base64), inlineMime:"image/png"}
}`
	req := scriptExampleRequest(CapabilityImage)
	result, err := PreviewProviderScript(context.Background(), source, req, json.RawMessage(`{"images":[{"base64":"iVBORw0KGgo="}]}`))
	if err != nil {
		t.Fatal(err)
	}
	create := result["create"].(RequestSpec)
	if len(create.Files) != 1 || create.Files[0].Reference.URL != req.Images[0].URL || create.Auth.Type != "none" {
		t.Fatalf("bad preview: %#v", create)
	}
	parsed := result["parsedResponse"].(PollResult)
	if parsed.Status != StatusSucceeded || parsed.Result == nil || len(parsed.Result.Images) != 1 {
		t.Fatalf("bad inline result: %#v", parsed)
	}
}

func TestProviderScriptRejectsInvalidExecution(t *testing.T) {
	for name, source := range map[string]string{
		"syntax":           "{",
		"network":          `{create:fetch("https://example.com"),response:{result:"url"}}`,
		"environment":      `{create:{method:"POST",path:"/generate",body:process.env},response:{result:"url"}}`,
		"foreign endpoint": `{create:{method:"POST",path:"//evil.example/generate"},response:{result:"url"}}`,
		"headers":          `{create:{method:"POST",path:"/generate",headers:{Authorization:"x"}},response:{result:"url"}}`,
		"timeout":          `(() => {while(true){} })()`,
		"unknown field":    `{create:{method:"POST",path:"/generate"},response:{result:"url"},secret:"x"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ConfiguredProvider(ManifestProvider{Auth: ManifestAuth{Type: "none"}, Script: source}, CapabilityVideo); err == nil {
				t.Fatal("accepted invalid script")
			}
		})
	}
	if _, err := ConfiguredProvider(ManifestProvider{Script: strings.Repeat(" ", MaxProviderScriptBytes) + "{}"}, CapabilityImage); err == nil {
		t.Fatal("accepted oversized source")
	}
	adapter, err := ConfiguredProvider(ManifestProvider{Auth: ManifestAuth{Type: "none"}, Script: arrayProviderScript}, CapabilityVideo)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := adapter.BuildCreate(ctx, RequestContext{}); err == nil {
		t.Fatal("ignored cancellation")
	}
	async := `{create:{method:"POST",path:"/images"},response:{result: async data => data.url}}`
	adapter, err = ConfiguredProvider(ManifestProvider{Auth: ManifestAuth{Type: "none"}, Script: async}, CapabilityImage)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.ParseCreate(context.Background(), []byte(`{"url":"https://example.com/a.png"}`)); err == nil {
		t.Fatal("accepted async callback")
	}
}
