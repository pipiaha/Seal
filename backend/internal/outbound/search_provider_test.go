package outbound

import (
	"net"
	"testing"
)

func TestSearchProviderFakeIPAllowanceIsNarrow(t *testing.T) {
	for _, host := range []string{"api.deepseek.com", "api.tavily.com"} {
		for _, ip := range []string{"198.18.0.68", "198.19.255.254"} {
			if !searchProviderAddressAllowed(host, net.ParseIP(ip)) {
				t.Fatal("official proxy DNS rejected", host, ip)
			}
		}
		for _, ip := range []string{"127.0.0.1", "192.168.1.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "0.0.0.0"} {
			if searchProviderAddressAllowed(host, net.ParseIP(ip)) {
				t.Fatal("private address permitted", host, ip)
			}
		}
	}
	for _, host := range []string{"evil.example", "api.deepseek.com.evil.example", "sub.api.deepseek.com", "localhost", "198.18.0.68"} {
		if searchProviderAddressAllowed(host, net.ParseIP("198.18.0.68")) {
			t.Fatal("arbitrary host inherited proxy grant", host)
		}
	}
	if !blockedCustomRelayIP(net.ParseIP("198.18.0.68")) {
		t.Fatal("public browsing policy was relaxed")
	}
}
