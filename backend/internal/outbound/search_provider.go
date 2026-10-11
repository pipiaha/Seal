package outbound

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"time"
)

var searchProviderTransport = newOutboundTransportWithProxy(resolveSearchProviderHost, false)
var searchFakeIPPrefix = netip.MustParsePrefix("198.18.0.0/15")

// Only fixed official HTTPS providers can use the synthetic DNS addresses used
// by local TUN proxies. TLS still validates the original provider hostname.
// Arbitrary page URLs and private addresses retain the public browsing policy.
func SearchProviderHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Transport: searchProviderTransport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func resolveSearchProviderHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	addresses, err := resolveOutboundHostWithPolicy(ctx, host, false)
	if err != nil {
		return nil, err
	}
	for _, ip := range addresses {
		if !searchProviderAddressAllowed(host, ip) {
			return nil, BadAuthRequest("搜索接口解析到了不允许访问的内网或保留地址")
		}
	}
	return addresses, nil
}

func searchProviderAddressAllowed(host string, ip net.IP) bool {
	if !blockedCustomRelayIP(ip) {
		return true
	}
	host = normalizeOutboundHost(host)
	if host != "api.deepseek.com" && host != "api.tavily.com" {
		return false
	}
	address, ok := netip.AddrFromSlice(ip)
	return ok && searchFakeIPPrefix.Contains(address.Unmap())
}
