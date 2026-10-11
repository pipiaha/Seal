package protocol

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// ConfiguredProvider uses the same declarative contract as installed providers,
// scoped to the saved model configuration rather than a global plugin record.
func ConfiguredProvider(provider ManifestProvider, capability Capability) (Adapter, error) {
	if capability != CapabilityImage && capability != CapabilityVideo {
		return nil, fmt.Errorf("自定义接口仅支持图片和视频")
	}
	if strings.TrimSpace(provider.Script) != "" {
		return newScriptAdapter(provider, capability)
	}
	provider.ID = "custom-" + string(capability)
	provider.Label = "自定义" + string(capability)
	provider.Capabilities = []Capability{capability}
	provider.Scopes = []Surface{SurfaceCanvas, SurfaceCreation, SurfaceAgent, SurfaceUserCustomChannel}
	provider.BaseURL = ""
	if provider.Auth.Type != "none" && provider.Auth.Type != "bearer" && provider.Auth.Type != "header" {
		return nil, fmt.Errorf("自定义接口请选择无鉴权、Bearer 或请求头鉴权")
	}
	provider.Auth.Field = "apiKey"
	if provider.Auth.Type == "header" && strings.TrimSpace(provider.Auth.Header) == "" {
		return nil, fmt.Errorf("请求头鉴权需要填写头名称")
	}
	for _, op := range []*ManifestOperation{&provider.Create, provider.Poll, provider.Cancel, provider.Result} {
		if op == nil {
			continue
		}
		op.Path = strings.ReplaceAll(op.Path, "{task_id}", "{{taskId}}")
		if !strings.HasPrefix(op.Path, "/") || strings.HasPrefix(op.Path, "//") || op.PathTemplate != nil {
			return nil, fmt.Errorf("接口路径必须以 / 开头，不能替换渠道地址")
		}
		parsed, err := url.Parse(op.Path)
		if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.Fragment != "" || strings.ContainsAny(op.Path, "\\\r\n") {
			return nil, fmt.Errorf("接口路径无效")
		}
		if op.ContentTypeTemplate != nil || op.AudioStream != nil {
			return nil, fmt.Errorf("自定义图片和视频接口不支持动态 Content-Type 或音频流")
		}
		if len(op.Headers) != 0 {
			return nil, fmt.Errorf("自定义请求头请在渠道连接设置中填写")
		}
		if op.Body != nil && len(op.Fields) > 0 {
			mapped := map[string]any{}
			for key, source := range op.Fields {
				if !strings.HasPrefix(source, "request.") && source != "taskId" {
					return nil, fmt.Errorf("参数映射请引用 request 输入，固定参数在 JSON 模板填写")
				}
				setMapPath(mapped, key, map[string]any{"$ref": source})
			}
			op.Body = map[string]any{"$merge": []any{op.Body, mapped}}
			op.Fields = nil
		}
	}
	if provider.Result == nil && len(provider.Response.ResultURLPaths) == 0 && len(provider.Response.ResultPaths) == 0 && len(provider.Response.InlineBase64Paths) == 0 && provider.Response.Images == nil && provider.Response.Videos == nil {
		return nil, fmt.Errorf("请配置结果提取路径")
	}
	provider.Response.ResultKind = string(capability)
	if provider.Poll != nil && (len(provider.Response.TaskIDPaths) == 0 || len(provider.Response.StatusPaths) == 0) {
		return nil, fmt.Errorf("异步接口必须配置任务 ID 和状态路径")
	}
	statusMap := map[string]Status{}
	for key, value := range provider.Response.StatusMap {
		switch value {
		case StatusPending, StatusProcessing, StatusSucceeded, StatusFailed, StatusCancelled:
		default:
			return nil, fmt.Errorf("任务状态映射无效")
		}
		statusMap[strings.ToLower(strings.TrimSpace(key))] = value
	}
	provider.Response.StatusMap = statusMap
	manifest := Manifest{APIVersion: "beeftv.plugin/v1", Metadata: Metadata{ID: provider.ID, Name: provider.Label, Version: "1.0.0"}, Contributes: ManifestContributions{Providers: []ManifestProvider{provider}}}
	data, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}
	return LoadManifest(data)
}
