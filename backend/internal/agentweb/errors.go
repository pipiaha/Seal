package agentweb

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"

	"infinite-canvas/backend/internal/kernel"
)

func searchError(status int, reason, message string) *kernel.AppError {
	err := kernel.NewAppError(status, message)
	err.Reason = kernel.ErrorReason(reason)
	return err
}

func searchNetworkError(provider string, cause error) error {
	if errors.Is(cause, context.Canceled) {
		return cause
	}
	var timeout net.Error
	if errors.Is(cause, context.DeadlineExceeded) || errors.As(cause, &timeout) && timeout.Timeout() {
		err := searchError(http.StatusGatewayTimeout, "web_search_timeout", provider+" 搜索响应超时，请检查网络或稍后再试")
		err.Cause = cause
		return err
	}
	err := searchError(http.StatusBadGateway, "web_search_network_failed", "无法连接 "+provider+" 搜索服务，请检查网络、代理或搜索接口地址")
	err.Cause = cause
	return err
}

func searchProviderError(provider string, status int) error {
	message := fmt.Sprintf("%s 搜索接口返回 HTTP %d，请检查接口地址和服务状态", provider, status)
	switch status {
	case 401, 403:
		message = provider + " 搜索密钥验证失败或没有访问权限，请检查密钥和搜索接口地址"
	case 402:
		message = provider + " 搜索服务余额不足，请检查供应商账户"
	case 400, 404, 422:
		message = provider + " 搜索接口不接受当前请求，请检查搜索模型和接口地址；普通聊天中转可能不支持原生搜索"
	case 429:
		message = provider + " 搜索请求受到频率或额度限制，请检查供应商账户或稍后再试"
	}
	return searchError(http.StatusBadGateway, "web_search_provider_rejected", message)
}
