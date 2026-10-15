package outbound

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// Desktop browsing can traverse a user's TUN Fake-IP proxy, but only with TLS
// validation against a named HTTPS origin. Hosted browsing stays strict.
var desktopPublicHTTPS = newOutboundTransportWithProxy(resolveDesktopPublicHost, false)

func DesktopPublicHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: desktopPublicTransport{
			https: desktopPublicHTTPS,
		},
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxOutboundRedirects {
				return errors.New("公开网页重定向次数过多")
			}
			_, err := ParsePublicURL(req.URL.String())
			return err
		},
	}
}

type desktopPublicTransport struct{ https *http.Transport }

func (t desktopPublicTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if _, err := ParsePublicURL(req.URL.String()); err != nil {
		return nil, err
	}
	if req.URL.Scheme == "https" {
		return t.https.RoundTrip(req)
	}
	// A redirect to plain HTTP loses the Fake-IP allowance, even if it uses
	// the same hostname. This route retains the original public DNS checks.
	return publicTransport.RoundTrip(req)
}

func resolveDesktopPublicHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	addresses, err := resolveOutboundHostWithPolicy(ctx, host, false)
	if err != nil {
		return nil, err
	}
	if err = validateDesktopPublicAddresses(host, addresses); err != nil {
		return nil, err
	}
	return addresses, nil
}

func validateDesktopPublicAddresses(host string, addresses []net.IP) error {
	for _, ip := range addresses {
		if !blockedCustomRelayIP(ip) {
			continue
		}
		address, valid := netip.AddrFromSlice(ip)
		if net.ParseIP(host) == nil && host != "localhost" && !strings.HasSuffix(host, ".localhost") && valid && searchFakeIPPrefix.Contains(address.Unmap()) {
			continue
		}
		return BadAuthRequest("不允许访问本机、内网或保留地址")
	}
	return nil
}
