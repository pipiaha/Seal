package workspace

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"golang.org/x/net/http/httpguts"

	"infinite-canvas/backend/internal/protocol"
)

// Agent edits one media model recipe and optionally a user-supplied API key.
// The canonical store still owns encryption, atomic writes and revision checks.
type AgentProviderEdit struct {
	OperationID      string              `json:"operationId"`
	ExpectedRevision *int64              `json:"expectedRevision"`
	ChannelID        string              `json:"channelId,omitempty"`
	Name             string              `json:"name,omitempty"`
	BaseURL          string              `json:"baseUrl,omitempty"`
	AuthType         string              `json:"authType,omitempty"`
	AuthHeader       string              `json:"authHeader,omitempty"`
	APIKey           *string             `json:"apiKey,omitempty"`
	Capability       protocol.Capability `json:"capability"`
	Model            string              `json:"model"`
	Script           string              `json:"script"`
	SetDefault       bool                `json:"setDefault,omitempty"`
}

func (s *ProviderConfig) AgentProviderChannels() (map[string]any, error) {
	effective, _, err := s.LoadEffectiveModelConfig()
	if err != nil {
		return nil, err
	}
	channels := []any{}
	for _, raw := range providerArray(effective.Config["channels"]) {
		channel, ok := raw.(map[string]any)
		if !ok || managedAgentChannel(channel) {
			continue
		}
		profiles := []any{}
		for _, rawProfile := range providerArray(channel["modelProfiles"]) {
			profile, ok := rawProfile.(map[string]any)
			if !ok {
				continue
			}
			item := map[string]any{"model": profile["model"], "capability": profile["capability"], "protocol": profile["protocol"]}
			// Scripts should contain no credentials. Suppress accidentally embedded
			// saved secrets rather than returning a channel's raw configuration.
			if provider, ok := profile["customProvider"].(map[string]any); ok {
				if script, ok := provider["script"].(string); ok {
					item["script"] = redactAgentProviderScript(script, channel)
				}
			}
			profiles = append(profiles, item)
		}
		base, _ := channel["baseUrl"].(string)
		if parsed, err := url.Parse(base); err == nil {
			parsed.User = nil
			parsed.RawQuery = ""
			parsed.Fragment = ""
			base = parsed.String()
		}
		channels = append(channels, map[string]any{"id": channel["id"], "name": channel["name"], "baseUrl": base, "enabled": channel["enabled"] != false, "authType": agentProviderAuthType(channel), "authHeader": channel["authHeader"], "hasApiKey": agentProviderHasKey(channel), "models": channel["models"], "modelProfiles": profiles})
	}
	return map[string]any{"revision": effective.Revision, "channels": channels}, nil
}

func (s *ProviderConfig) AgentProviderSave(ctx context.Context, edit AgentProviderEdit) (map[string]any, error) {
	if edit.ExpectedRevision == nil {
		return nil, errors.New("请先读取渠道配置，再携带 expectedRevision 保存")
	}
	opID, err := hex.DecodeString(edit.OperationID)
	if err != nil || len(opID) != 32 {
		return nil, errors.New("渠道配置缺少有效操作标识")
	}
	edit.Model = strings.TrimSpace(edit.Model)
	edit.Name = strings.TrimSpace(edit.Name)
	edit.BaseURL = strings.TrimRight(strings.TrimSpace(edit.BaseURL), "/")
	if edit.APIKey != nil {
		key := strings.TrimSpace(*edit.APIKey)
		if len(key) > 4096 || strings.ContainsAny(key, "\r\n\x00") || key == RedactedSecret {
			return nil, errors.New("API Key 格式无效，请提供真实密钥或省略此字段")
		}
		if key == "" {
			edit.APIKey = nil
		} else {
			edit.APIKey = &key
		}
	}
	if edit.Model == "" || len(edit.Model) > 200 || len(edit.Name) > 100 {
		return nil, errors.New("模型 ID 或渠道名称无效")
	}
	if edit.Capability != protocol.CapabilityImage && edit.Capability != protocol.CapabilityVideo {
		return nil, errors.New("助手渠道配置仅支持图片和视频")
	}
	if strings.TrimSpace(edit.Script) == "" {
		return nil, errors.New("请提供 JavaScript 接口配置")
	}
	if edit.APIKey != nil && strings.Contains(edit.Script, *edit.APIKey) {
		return nil, errors.New("API Key 请通过 apiKey 字段保存，不要写进接口脚本")
	}
	_, err = protocol.PreviewProviderScript(ctx, edit.Script, agentProviderSample(edit.Capability, edit.Model), nil)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadPrimaryDocument()
	if err != nil {
		return nil, err
	}
	effective, err := effectiveProviderState(document)
	if err != nil {
		return nil, err
	}
	config := effective.Config
	channels := providerArray(config["channels"])
	creating := edit.ChannelID == ""
	if creating {
		edit.ChannelID = "agent-" + edit.OperationID[:24]
	}
	var channel map[string]any
	for _, raw := range channels {
		if candidate, ok := raw.(map[string]any); ok && candidate["id"] == edit.ChannelID {
			channel = candidate
			break
		}
	}
	if channel == nil && !creating {
		return nil, errors.New("渠道不存在，请重新读取当前渠道")
	}
	if channel != nil && managedAgentChannel(channel) {
		return nil, errors.New("助手不能修改内置或托管渠道")
	}
	if channel == nil {
		if edit.Name == "" || edit.BaseURL == "" {
			return nil, errors.New("新增渠道需要名称和服务地址")
		}
		parsed, err := url.Parse(edit.BaseURL)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, errors.New("自定义渠道地址需为不含凭证和查询参数的 HTTPS 地址")
		}
		if edit.AuthType == "" {
			edit.AuthType = "bearer"
		}
		if edit.AuthType != "none" && edit.AuthType != "bearer" && edit.AuthType != "header" || edit.AuthType == "header" && !httpguts.ValidHeaderFieldName(edit.AuthHeader) {
			return nil, errors.New("鉴权方式或请求头名称无效")
		}
		channel = map[string]any{"id": edit.ChannelID, "name": edit.Name, "baseUrl": edit.BaseURL, "scope": "user", "apiFormat": "openai", "apiKey": "", "authType": edit.AuthType, "authHeader": edit.AuthHeader, "enabled": true, "models": []any{}, "modelProfiles": []any{}}
		channels = append(channels, channel)
	} else {
		// A tool cannot forward an existing secret to a newly supplied host.
		if edit.BaseURL != "" && strings.TrimRight(agentProviderString(channel["baseUrl"]), "/") != edit.BaseURL {
			return nil, errors.New("修改已有渠道的服务地址请在设置页操作；助手可另建无密钥渠道")
		}
		if edit.AuthType != "" && edit.AuthType != agentProviderAuthType(channel) || edit.AuthHeader != "" && edit.AuthHeader != agentProviderString(channel["authHeader"]) {
			return nil, errors.New("已有渠道的鉴权方式请在设置页修改")
		}
	}
	profiles := providerArray(channel["modelProfiles"])
	var profile map[string]any
	for _, raw := range profiles {
		if candidate, ok := raw.(map[string]any); ok && candidate["model"] == edit.Model {
			profile = candidate
			break
		}
	}
	if profile != nil && profile["capability"] != string(edit.Capability) {
		return nil, errors.New("同名模型属于其他能力类型，不能覆盖")
	}
	if profile != nil && strings.HasPrefix(agentProviderString(profile["protocol"]), "comfyui-") {
		return nil, errors.New("ComfyUI 工作流请在设置页配置，不能用 HTTP 脚本覆盖")
	}
	protocolID := "custom-" + string(edit.Capability)
	if edit.APIKey != nil && agentProviderAuthType(channel) == "none" {
		return nil, errors.New("无需鉴权的渠道不使用 API Key，请为新渠道选择 Bearer 或请求头鉴权")
	}
	defaultKey := "imageModel"
	if edit.Capability == protocol.CapabilityVideo {
		defaultKey = "videoModel"
	}
	if *edit.ExpectedRevision != document.Revision {
		if profile != nil && profile["protocol"] == protocolID {
			provider, _ := profile["customProvider"].(map[string]any)
			if provider["script"] == edit.Script && (edit.APIKey == nil || agentProviderString(channel["apiKey"]) == *edit.APIKey) && (edit.Name == "" || edit.Name == channel["name"]) && (!edit.SetDefault || config[defaultKey] == edit.ChannelID+"::"+edit.Model) {
				return agentProviderSaveResult(channel, edit, document.Revision, true), nil
			}
		}
		return nil, ErrProviderConfigRevisionConflict
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if profile == nil {
		profile = map[string]any{"model": edit.Model, "capability": string(edit.Capability)}
		profiles = append(profiles, profile)
	}
	authType := agentProviderAuthType(channel)
	provider := protocol.ManifestProvider{Script: edit.Script, Auth: protocol.ManifestAuth{Type: authType, Header: agentProviderString(channel["authHeader"]), Field: "apiKey"}}
	encoded, err := json.Marshal(provider)
	if err != nil {
		return nil, err
	}
	var recipe map[string]any
	if err = json.Unmarshal(encoded, &recipe); err != nil {
		return nil, err
	}
	profile["protocol"] = protocolID
	profile["customProvider"] = recipe
	delete(profile, "comfyui")
	channel["modelProfiles"] = profiles
	models := providerArray(channel["models"])
	exists := false
	for _, model := range models {
		if model == edit.Model {
			exists = true
		}
	}
	if !exists {
		models = append(models, edit.Model)
	}
	channel["models"] = models
	if edit.Name != "" {
		channel["name"] = edit.Name
	}
	if edit.APIKey != nil {
		channel["apiKey"] = *edit.APIKey
	}
	config["channels"] = channels
	if edit.SetDefault {
		config[defaultKey] = edit.ChannelID + "::" + edit.Model
	}
	body, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	if err = s.saveLocalModelConfig(body, document); err != nil {
		return nil, err
	}
	return agentProviderSaveResult(channel, edit, document.Revision+1, false), nil
}

func agentProviderSaveResult(channel map[string]any, edit AgentProviderEdit, revision int64, replayed bool) map[string]any {
	return map[string]any{"saved": true, "revision": revision, "channelId": edit.ChannelID, "channelName": channel["name"], "model": edit.Model, "capability": edit.Capability, "enabled": channel["enabled"] != false, "needsCredential": agentProviderAuthType(channel) != "none" && !agentProviderHasKey(channel), "replayed": replayed, "generated": false}
}

func providerArray(value any) []any {
	result, _ := value.([]any)
	if result == nil {
		return []any{}
	}
	return result
}
func agentProviderString(value any) string { result, _ := value.(string); return result }
func agentProviderAuthType(channel map[string]any) string {
	if value := agentProviderString(channel["authType"]); value != "" {
		return value
	}
	return "bearer"
}
func agentProviderHasKey(channel map[string]any) bool {
	return strings.TrimSpace(agentProviderString(channel["apiKey"])) != ""
}
func managedAgentChannel(channel map[string]any) bool {
	return channel["scope"] == "system" || channel["builtin"] == true || agentProviderString(channel["credentialRef"]) != "" || channel["id"] == "beefapi"
}
func redactAgentProviderScript(script string, channel map[string]any) string {
	for _, key := range []string{"apiKey", "secretKey"} {
		if value := agentProviderString(channel[key]); value != "" {
			script = strings.ReplaceAll(script, value, "[已隐藏凭据]")
		}
	}
	for _, raw := range providerArray(channel["headers"]) {
		if header, ok := raw.(map[string]any); ok {
			if value := agentProviderString(header["value"]); value != "" {
				script = strings.ReplaceAll(script, value, "[已隐藏请求头值]")
			}
		}
	}
	return script
}

func agentProviderSample(capability protocol.Capability, model string) protocol.GenerationRequest {
	return protocol.GenerationRequest{Capability: capability, Model: model, Prompt: "示例提示词", Duration: 5, AspectRatio: "16:9", Resolution: "720p", ImageCount: 1, Extra: map[string]any{"size": "1280x720"}, Images: []protocol.MediaReference{{URL: "https://example.com/image.png", Kind: "image"}}, Videos: []protocol.MediaReference{{URL: "https://example.com/video.mp4", Kind: "video"}}}
}

func (s *ProviderConfig) AgentProviderPreview(ctx context.Context, script string, capability protocol.Capability, model string, request *protocol.GenerationRequest, response json.RawMessage) (map[string]any, error) {
	sample := agentProviderSample(capability, model)
	if request != nil {
		sample = *request
		sample.Capability = capability
		sample.Model = model
	}
	return protocol.PreviewProviderScript(ctx, script, sample, response)
}
