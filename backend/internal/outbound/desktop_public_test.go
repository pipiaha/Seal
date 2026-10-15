package outbound

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDesktopPublicFakeIPBoundary(t *testing.T) {
	for _, ip := range []string{"198.18.0.185", "198.19.255.254", "::ffff:198.18.0.185", "8.8.8.8"} {
		if err := validateDesktopPublicAddresses("docs.example.com", []net.IP{net.ParseIP(ip)}); err != nil {
			t.Fatalf("desktop proxy target %s rejected: %v", ip, err)
		}
	}
	for _, ip := range []string{"127.0.0.1", "::1", "192.168.1.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.1", "203.0.113.1"} {
		if err := validateDesktopPublicAddresses("docs.example.com", []net.IP{net.ParseIP("198.18.0.185"), net.ParseIP(ip)}); err == nil {
			t.Fatalf("mixed private DNS answer %s accepted", ip)
		}
	}
	for _, raw := range []string{"https://198.18.0.185/", "https://127.0.0.1/", "https://[::1]/", "http://192.168.1.1/", "https://localhost/", "file:///secret"} {
		request, _ := http.NewRequest(http.MethodGet, raw, nil)
		if _, err := DesktopPublicHTTPClient(time.Second).Transport.RoundTrip(request); err == nil {
			t.Fatalf("non-public URL accepted: %s", raw)
		}
	}
	if !blockedCustomRelayIP(net.ParseIP("198.18.0.185")) {
		t.Fatal("hosted public policy must remain strict")
	}
}

func TestDesktopPublicTransportRetainsTLSVerification(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("private data")) }))
	defer server.Close()
	transport := newOutboundTransportWithProxy(resolveDesktopPublicHost, false)
	defer transport.CloseIdleConnections()
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	client := DesktopPublicHTTPClient(3 * time.Second)
	client.Transport = desktopPublicTransport{https: transport}
	if response, err := client.Get("https://example.com/"); err == nil {
		response.Body.Close()
		t.Fatal("desktop proxy request accepted an untrusted TLS certificate")
	}
	for _, target := range []string{"https://127.0.0.1/", "http://169.254.169.254/latest/meta-data/"} {
		req, _ := http.NewRequest(http.MethodGet, target, nil)
		if err := client.CheckRedirect(req, nil); err == nil {
			t.Fatal("redirect to private target accepted")
		}
	}
}
