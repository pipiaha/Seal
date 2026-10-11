package comfyui

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/outbound"
)

// A local connector permits only its configured loopback origin. It cannot
// redirect credentials to another service or weaken the web browsing policy.
func ValidateURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("ComfyUI 地址必须是完整的 HTTP(S) 服务地址")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		if _, err := outbound.ValidateOutboundURL(u.String()); err != nil {
			return nil, err
		}
	}
	return u, nil
}

func HTTPClient(raw string, timeout time.Duration) (*http.Client, error) {
	base, err := ValidateURL(raw)
	if err != nil {
		return nil, err
	}
	ip := net.ParseIP(base.Hostname())
	if base.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		client := outbound.OutboundHTTPClient(timeout)
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || req.URL.Scheme != base.Scheme || req.URL.Host != base.Host {
				return fmt.Errorf("ComfyUI 不允许跨服务重定向")
			}
			_, err := outbound.ValidateOutboundURL(req.URL.String())
			return err
		}
		return client, nil
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if host == "localhost" {
			host = "127.0.0.1"
		}
		addressIP := net.ParseIP(host)
		if addressIP == nil || !addressIP.IsLoopback() {
			return nil, fmt.Errorf("ComfyUI 本地连接只允许回环地址")
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(host, port))
	}
	return &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || req.URL.Scheme != base.Scheme || req.URL.Host != base.Host {
			return fmt.Errorf("ComfyUI 不允许跨服务重定向")
		}
		return nil
	}}, nil
}
