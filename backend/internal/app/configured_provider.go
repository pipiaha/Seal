package app

import (
	"context"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/provider/comfyui"
)

func (s *Service) InspectLocalComfyUI(ctx context.Context, config generation.Config) (map[string]any, error) {
	if !s.IsLocalMode() {
		return nil, BadAuthRequest("ComfyUI 仅支持本地工作区")
	}
	if config.AuthType != "none" && config.AuthType != "bearer" && config.AuthType != "header" {
		return nil, BadAuthRequest("请选择 ComfyUI 鉴权方式")
	}
	if config.AuthType != "none" && config.APIKey == "" {
		return nil, BadAuthRequest("请填写 ComfyUI 密钥")
	}
	if config.AuthType == "header" && config.AuthHeader == "" {
		return nil, BadAuthRequest("请填写鉴权请求头名称")
	}
	if _, err := comfyui.ValidateURL(config.BaseURL); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	resolved, err := s.resolveProviderConfig(config)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return generation.InspectComfyUI(ctx, resolved)
}
