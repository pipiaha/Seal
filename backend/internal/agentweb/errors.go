package agentweb

import (
	"context"
	"crypto/x509"
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

func readNetworkError(cause error) error {
	if errors.Is(cause, context.Canceled) {
		return context.Canceled
	}
	var policy *kernel.AppError
	if errors.As(cause, &policy) {
		return policy
	}
	var network net.Error
	if errors.Is(cause, context.DeadlineExceeded) || errors.As(cause, &network) && network.Timeout() {
		return searchError(http.StatusGatewayTimeout, "web_read_timeout", "网页读取超时，请检查网络或代理后再试")
	}
	var dns *net.DNSError
	if errors.As(cause, &dns) {
		return searchError(http.StatusBadGateway, "web_read_dns_failed", "网页域名解析失败，请检查网络或代理")
	}
	var certificate x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	if errors.As(cause, &certificate) || errors.As(cause, &hostname) || errors.As(cause, &invalid) {
		return searchError(http.StatusBadGateway, "web_read_tls_failed", "网页证书验证失败，请检查系统时间、证书或代理配置")
	}
	return searchError(http.StatusBadGateway, "web_read_network_failed", "无法连接网页，请检查网络或代理；不建议对同一地址反复改用下载或脚本")
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
