package agentweb

import (
	"context"
	"crypto/x509"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"net"
	"net/url"
	"strings"
	"testing"
)

func TestReadNetworkErrorsKeepCauseCategoryWithoutURLSecrets(t *testing.T) {
	for _, item := range []struct {
		cause  error
		reason string
	}{
		{&net.DNSError{Err: "no such host", Name: "docs.example.com"}, "web_read_dns_failed"},
		{context.DeadlineExceeded, "web_read_timeout"},
		{x509.UnknownAuthorityError{}, "web_read_tls_failed"},
		{errors.New("connection reset"), "web_read_network_failed"},
	} {
		err := readNetworkError(&url.Error{Op: "Get", URL: "https://example.com/?key=synthetic-secret", Err: item.cause})
		var result *kernel.AppError
		if !errors.As(err, &result) || string(result.Reason) != item.reason {
			t.Fatalf("wrong network category: %v", err)
		}
		if strings.Contains(err.Error(), "synthetic-secret") {
			t.Fatal("request URL secret leaked")
		}
	}
	if !errors.Is(readNetworkError(context.Canceled), context.Canceled) {
		t.Fatal("cancellation must remain cancellation")
	}
}
