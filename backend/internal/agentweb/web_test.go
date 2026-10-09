package agentweb

import (
	"infinite-canvas/backend/internal/outbound"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (t transport) RoundTrip(r *http.Request) (*http.Response, error) { return t(r) }
func TestSearchKeepsSourcesAndProtectsKey(t *testing.T) {
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.tavily.com/search" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Fatal("provider credentials contract")
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"include_raw_content":false`) {
			t.Fatal("unbounded content requested")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"results":[{"title":"Example","url":"https://example.com/","content":"Actual excerpt"},{"title":"Private","url":"http://127.0.0.1/private"}]}`))}, nil
	})}
	results, err := Search(t.Context(), client, "fixture-key", "fixture")
	if err != nil || len(results) != 1 || results[0].URL != "https://example.com/" || results[0].ID == "" {
		t.Fatal(results, err)
	}
	if _, err = Search(t.Context(), client, "", "q"); err == nil {
		t.Fatal("missing key accepted")
	}
}
func TestPublicBrowsingIgnoresPrivateDevelopmentGrants(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "localhost,127.0.0.1")
	for _, u := range []string{"http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://192.168.0.1/", "file:///secret", "https://user:password@example.com/"} {
		if _, err := outbound.ValidatePublicURL(u); err == nil {
			t.Fatalf("private URL accepted: %s", u)
		}
	}
}
