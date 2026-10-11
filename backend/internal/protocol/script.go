package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

const MaxProviderScriptBytes = 64 << 10

// Each task gets its own adapter. Only the initial request is retained for
// ParseCreate, whose shared adapter interface does not carry a request context.
type scriptAdapter struct {
	provider        ManifestProvider
	capability      Capability
	program         *goja.Program
	metadata        Metadata
	resultAvailable bool
	mu              sync.Mutex
	request         GenerationRequest
}

func newScriptAdapter(provider ManifestProvider, capability Capability) (Adapter, error) {
	if len(provider.Script) > MaxProviderScriptBytes {
		return nil, fmt.Errorf("接口脚本不能超过 64 KB")
	}
	text := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(provider.Script), ";"))
	program, err := goja.Compile("接口配置.js", "\"use strict\"; ("+text+"\n)", false)
	if err != nil {
		return nil, fmt.Errorf("接口脚本语法错误：%w", err)
	}
	a := &scriptAdapter{provider: provider, capability: capability, program: program}
	resolved, _, err := a.evaluate(context.Background(), scriptExampleRequest(capability), "example-task", nil)
	if err != nil {
		return nil, err
	}
	delegate, err := ConfiguredProvider(resolved, capability)
	if err != nil {
		return nil, err
	}
	a.metadata = delegate.Metadata()
	a.resultAvailable = resolved.Result != nil
	return a, nil
}

func (a *scriptAdapter) Metadata() Metadata    { return a.metadata }
func (a *scriptAdapter) ResultAvailable() bool { return a.resultAvailable }

func (a *scriptAdapter) BuildCreate(ctx context.Context, c RequestContext) (RequestSpec, error) {
	a.mu.Lock()
	a.request = c.Request
	a.mu.Unlock()
	d, _, err := a.delegate(ctx, c.Request, "", nil)
	if err != nil {
		return RequestSpec{}, err
	}
	return d.BuildCreate(ctx, c)
}
func (a *scriptAdapter) ParseCreate(ctx context.Context, body []byte) (CreateResult, error) {
	a.mu.Lock()
	req := a.request
	a.mu.Unlock()
	d, transformed, err := a.parseDelegate(ctx, req, "", body)
	if err != nil {
		return CreateResult{}, err
	}
	return d.ParseCreate(ctx, transformed)
}
func (a *scriptAdapter) BuildPoll(ctx context.Context, c PollContext) (RequestSpec, error) {
	d, _, err := a.delegate(ctx, c.Request, c.TaskID, nil)
	if err != nil {
		return RequestSpec{}, err
	}
	return d.BuildPoll(ctx, c)
}
func (a *scriptAdapter) ParsePoll(ctx context.Context, c PollContext, body []byte) (PollResult, error) {
	d, transformed, err := a.parseDelegate(ctx, c.Request, c.TaskID, body)
	if err != nil {
		return PollResult{}, err
	}
	return d.ParsePoll(ctx, c, transformed)
}
func (a *scriptAdapter) BuildCancel(ctx context.Context, c PollContext) (RequestSpec, error) {
	d, _, err := a.delegate(ctx, c.Request, c.TaskID, nil)
	if err != nil {
		return RequestSpec{}, err
	}
	return d.BuildCancel(ctx, c)
}
func (a *scriptAdapter) BuildResult(ctx context.Context, c PollContext) (RequestSpec, error) {
	d, _, err := a.delegate(ctx, c.Request, c.TaskID, nil)
	if err != nil {
		return RequestSpec{}, err
	}
	return d.(ResultAdapter).BuildResult(ctx, c)
}
func (a *scriptAdapter) delegate(ctx context.Context, req GenerationRequest, taskID string, payload map[string]any) (Adapter, map[string]any, error) {
	provider, transformed, err := a.evaluate(ctx, req, taskID, payload)
	if err != nil {
		return nil, nil, err
	}
	d, err := ConfiguredProvider(provider, a.capability)
	return d, transformed, err
}
func (a *scriptAdapter) parseDelegate(ctx context.Context, req GenerationRequest, taskID string, body []byte) (Adapter, []byte, error) {
	if len(body) > 8<<20 {
		return nil, nil, fmt.Errorf("接口响应超过脚本处理上限 8 MB")
	}
	// Binary media responses pass through unchanged; their mapper is configured
	// in response.binaryPayload and does not execute response callbacks.
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		d, _, evalErr := a.delegate(ctx, req, taskID, nil)
		return d, body, evalErr
	}
	d, transformed, err := a.delegate(ctx, req, taskID, payload)
	if err != nil {
		return nil, nil, err
	}
	encoded, err := json.Marshal(transformed)
	return d, encoded, err
}

func (a *scriptAdapter) evaluate(ctx context.Context, req GenerationRequest, taskID string, payload map[string]any) (ManifestProvider, map[string]any, error) {
	vm := goja.New()
	vm.SetMaxCallStackSize(256)
	// No Go functions, files, environment, credentials or network clients are
	// exposed to this VM. The same time limit covers callback and JSON execution.
	timer := time.AfterFunc(200*time.Millisecond, func() { vm.Interrupt("接口脚本运行超时") })
	stopCancel := context.AfterFunc(ctx, func() { vm.Interrupt("接口脚本已取消") })
	defer timer.Stop()
	defer stopCancel()
	if err := ctx.Err(); err != nil {
		return ManifestProvider{}, nil, err
	}
	bindings := scriptVariables(req, taskID)
	for key, value := range bindings {
		if err := vm.Set(key, value); err != nil {
			return ManifestProvider{}, nil, err
		}
	}
	value, err := vm.RunProgram(a.program)
	if err != nil {
		return ManifestProvider{}, nil, fmt.Errorf("接口脚本执行失败：%w", err)
	}
	obj, ok := value.(*goja.Object)
	if !ok || obj.ClassName() != "Object" {
		return ManifestProvider{}, nil, fmt.Errorf("接口脚本必须返回配置对象")
	}
	for _, key := range obj.Keys() {
		switch key {
		case "create", "poll", "cancel", "result", "response", "requiresPublicMediaUrls":
		default:
			return ManifestProvider{}, nil, fmt.Errorf("不支持的接口配置字段：%s", key)
		}
	}
	responseValue := obj.Get("response")
	response, ok := responseValue.(*goja.Object)
	if !ok {
		return ManifestProvider{}, nil, fmt.Errorf("请配置 response 结果提取规则")
	}
	callbackPaths := map[string]string{}
	transformed := map[string]any{}
	for key, value := range payload {
		transformed[key] = value
	}
	internal := map[string]any{}
	for _, alias := range []string{"taskId", "status", "result", "error", "message", "base64"} {
		selector := response.Get(alias)
		if selector == nil || goja.IsUndefined(selector) || goja.IsNull(selector) {
			continue
		}
		if fn, ok := goja.AssertFunction(selector); ok {
			if payload != nil {
				result, err := fn(goja.Undefined(), vm.ToValue(payload))
				if err != nil {
					return ManifestProvider{}, nil, fmt.Errorf("response.%s 提取失败：%w", alias, err)
				}
				if async, ok := result.(*goja.Object); ok && async.Get("then") != nil && !goja.IsUndefined(async.Get("then")) {
					return ManifestProvider{}, nil, fmt.Errorf("结果提取函数必须同步返回")
				}
				if result != nil && !goja.IsUndefined(result) {
					internal[alias] = result.Export()
				}
			}
			callbackPaths[alias] = "_sealScript." + alias
		} else {
			path, ok := selector.Export().(string)
			if !ok || strings.TrimSpace(path) == "" {
				return ManifestProvider{}, nil, fmt.Errorf("response.%s 需要字段路径或同步函数", alias)
			}
			callbackPaths[alias] = path
		}
		if err := response.Delete(alias); err != nil {
			return ManifestProvider{}, nil, err
		}
	}
	transformed["_sealScript"] = internal
	if err := vm.Set("__sealConfig", obj); err != nil {
		return ManifestProvider{}, nil, err
	}
	encoded, err := vm.RunString("JSON.stringify(__sealConfig)")
	if err != nil {
		return ManifestProvider{}, nil, fmt.Errorf("接口配置不能转换成 JSON：%w", err)
	}
	text := encoded.String()
	if len(text) > 2<<20 {
		return ManifestProvider{}, nil, fmt.Errorf("展开后的接口配置不能超过 2 MB")
	}
	var provider ManifestProvider
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&provider); err != nil {
		return ManifestProvider{}, nil, fmt.Errorf("接口配置字段无效：%w", err)
	}
	provider.Auth = a.provider.Auth
	// Preserve literal strings and dollar-prefixed provider field names. They
	// are already evaluated JS data, not a second declarative expression program.
	for _, op := range []*ManifestOperation{&provider.Create, provider.Poll, provider.Cancel, provider.Result} {
		if op == nil {
			continue
		}
		if len(op.Fields) != 0 {
			return ManifestProvider{}, nil, fmt.Errorf("JavaScript 接口请直接填写 body，不使用 fields 映射")
		}
		if op.Body != nil {
			op.Body = map[string]any{"$literal": op.Body}
		}
		for key, value := range op.Query {
			op.Query[key] = map[string]any{"$literal": value}
		}
		for index := range op.Files {
			op.Files[index].Source = map[string]any{"$literal": op.Files[index].Source}
		}
	}
	for alias, path := range callbackPaths {
		switch alias {
		case "taskId":
			provider.Response.TaskIDPaths = []string{path}
		case "status":
			provider.Response.StatusPaths = []string{path}
		case "result":
			provider.Response.ResultURLPaths = []string{path}
		case "error":
			provider.Response.ErrorPaths = []string{path}
		case "message":
			provider.Response.MessagePaths = []string{path}
		case "base64":
			provider.Response.InlineBase64Paths = []string{path}
		}
	}
	return provider, transformed, nil
}

func scriptVariables(req GenerationRequest, taskID string) map[string]any {
	urls := func(refs []MediaReference) []string {
		values := make([]string, 0, len(refs))
		for _, ref := range refs {
			values = append(values, defaultValue(ref.URL, ref.DataURL))
		}
		return values
	}
	first, last := "", ""
	for _, ref := range req.Images {
		if ref.Role == "first_frame" || ref.Role == "first" {
			first = defaultValue(ref.URL, ref.DataURL)
		}
		if ref.Role == "last_frame" || ref.Role == "last" {
			last = defaultValue(ref.URL, ref.DataURL)
		}
	}
	return map[string]any{"request": manifestRequestValues(req), "model": req.Model, "prompt": req.Prompt, "seconds": req.Duration, "aspectRatio": req.AspectRatio, "resolution": req.Resolution, "quality": req.Quality, "count": req.ImageCount, "generateAudio": req.GenerateAudio, "watermark": req.Watermark, "images": urls(req.Images), "videos": urls(req.Videos), "audios": urls(req.Audios), "firstFrame": first, "lastFrame": last, "size": req.Extra["size"], "extra": req.Extra, "taskId": taskID}
}

func scriptExampleRequest(capability Capability) GenerationRequest {
	return GenerationRequest{Capability: capability, Model: "example-model", Prompt: "示例提示词", Duration: 5, AspectRatio: "16:9", Resolution: "720p", ImageCount: 1, Extra: map[string]any{"size": "1280x720"}, Images: []MediaReference{{URL: "https://example.com/image.png", Kind: "image"}}, Videos: []MediaReference{{URL: "https://example.com/video.mp4", Kind: "video"}}, Audios: []MediaReference{{URL: "https://example.com/audio.mp3", Kind: "audio"}}}
}

// PreviewProviderScript executes only translation with sample inputs. It never
// creates an HTTP client or submits a task, and exposes no real channel key.
func PreviewProviderScript(ctx context.Context, source string, request GenerationRequest, response json.RawMessage) (map[string]any, error) {
	adapter, err := ConfiguredProvider(ManifestProvider{Script: source, Auth: ManifestAuth{Type: "none"}}, request.Capability)
	if err != nil {
		return nil, err
	}
	created, err := adapter.BuildCreate(ctx, RequestContext{Request: request})
	if err != nil {
		return nil, err
	}
	output := map[string]any{"valid": true, "create": created}
	script := adapter.(*scriptAdapter)
	resolved, _, err := script.evaluate(ctx, request, "example-task", nil)
	if err != nil {
		return nil, err
	}
	pc := PollContext{Request: request, TaskID: "example-task", Model: request.Model}
	if resolved.Poll != nil {
		spec, err := adapter.BuildPoll(ctx, pc)
		if err != nil {
			return nil, err
		}
		output["poll"] = spec
	}
	if resolved.Cancel != nil {
		spec, err := adapter.BuildCancel(ctx, pc)
		if err != nil {
			return nil, err
		}
		output["cancel"] = spec
	}
	if resolved.Result != nil {
		spec, err := script.BuildResult(ctx, pc)
		if err != nil {
			return nil, err
		}
		output["result"] = spec
	}
	if len(response) > 0 {
		parsed, err := adapter.ParsePoll(ctx, pc, response)
		if err != nil {
			return nil, err
		}
		output["parsedResponse"] = parsed
	}
	return output, nil
}
