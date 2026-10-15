package app

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/provider/comfyui"
)

func (s *Service) PreviewProviderScript(ctx context.Context, source string, request protocol.GenerationRequest, response json.RawMessage) (map[string]any, error) {
	if !s.IsLocalMode() {
		return nil, BadAuthRequest("接口脚本仅支持本地工作区")
	}
	result, err := protocol.PreviewProviderScript(ctx, source, request, response)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return result, nil
}

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
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := generation.InspectComfyUI(ctx, resolved)
	if err == nil {
		return result, nil
	}
	var httpErr generation.HTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, WrapAppError(http.StatusBadGateway, "ComfyUI 鉴权失败，请检查连接选项中的密钥", err)
		case http.StatusNotFound:
			return nil, WrapAppError(http.StatusBadGateway, "此地址未提供 ComfyUI 接口，请检查服务地址", err)
		default:
			return nil, WrapAppError(http.StatusBadGateway, "ComfyUI 服务返回错误，请检查服务运行状态", err)
		}
	}
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &netErr) && netErr.Timeout() {
		return nil, WrapAppError(http.StatusGatewayTimeout, "连接 ComfyUI 超时，请检查服务是否正常运行", err)
	}
	return nil, WrapAppError(http.StatusBadGateway, "无法连接 ComfyUI，请确认已启动，并检查服务地址与端口", err)
}
