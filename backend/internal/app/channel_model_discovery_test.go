package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/modelcatalog"
)

func TestModelCatalogURL(t *testing.T) {
	for _, example := range []struct{ base, format, override, want string }{
		{"https://api.example/v1", "openai", "", "https://api.example/v1/models"},
		{"https://api.example", "claude", "", "https://api.example/v1/models"},
		{"https://api.example/v1", "claude", "", "https://api.example/v1/models"},
		{"https://api.example", "gemini", "", "https://api.example/v1beta/models"},
		{"https://api.example/v1", "openai", "/catalog", "https://api.example/catalog"},
	} {
		got, err := modelCatalogURL(example.base, example.format, example.override)
		if err != nil || got != example.want {
			t.Fatalf("catalog URL = %q, %v", got, err)
		}
	}
	if _, err := modelCatalogURL("https://api.example/v1", "openai", "https://other.example/models"); err == nil {
		t.Fatal("cross-origin credential endpoint accepted")
	}
}

func TestModelCatalogClaudePagesAndAuth(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/v1/models" || r.Header.Get("x-api-key") != "test-only" || r.Header.Get("anthropic-version") == "" || r.Header.Get("Authorization") != "" {
			t.Error("wrong endpoint or auth")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("after_id") == "" {
			_, _ = w.Write([]byte(`{"data":[{"id":"first"}],"has_more":true,"last_id":"first"}`))
		} else {
			_, _ = w.Write([]byte(`{"data":[{"id":"second"}],"has_more":false}`))
		}
	}))
	defer server.Close()
	data, err := fetchModelCatalogPages(context.Background(), server.URL, "claude", "test-only", nil, "", "bearer", "")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := modelcatalog.ParseChannelModelCatalog(data, "claude")
	if err != nil || len(catalog) != 2 || requests != 2 || catalog[0].ModelType != "text" {
		t.Fatalf("catalog=%v err=%v requests=%d", catalog, err, requests)
	}
}

func TestModelCatalogHeaderAuthAndEmptyList(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Project-Key") != "test-only" || r.Header.Get("Authorization") != "" {
			t.Error("wrong header auth")
		}
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	data, err := fetchModelCatalogPages(context.Background(), server.URL, "openai", "test-only", nil, "", "header", "X-Project-Key")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := modelcatalog.ParseChannelModelCatalog(data, "openai")
	if err != nil || len(catalog) != 0 {
		t.Fatalf("empty catalog=%v err=%v", catalog, err)
	}
}

func TestModelCatalogGeminiPages(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models" || r.Header.Get("x-goog-api-key") != "test-only" {
			t.Error("wrong Gemini endpoint/auth")
		}
		if r.URL.Query().Get("pageToken") == "" {
			_, _ = w.Write([]byte(`{"models":[{"name":"models/first","displayName":"First"}],"nextPageToken":"next"}`))
		} else {
			_, _ = w.Write([]byte(`{"models":[{"name":"models/second","supportedGenerationMethods":["predictLongRunning"]}]}`))
		}
	}))
	defer server.Close()
	data, err := fetchModelCatalogPages(context.Background(), server.URL, "gemini", "test-only", nil, "", "bearer", "")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := modelcatalog.ParseChannelModelCatalog(data, "gemini")
	if err != nil || len(catalog) != 2 || catalog[0].DisplayName != "First" || catalog[1].ModelType != "video" {
		t.Fatalf("catalog=%v err=%v", catalog, err)
	}
}

func TestModelCatalogRejectsCredentialRedirect(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	leaked := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true; _, _ = w.Write([]byte(`{"data":[]}`)) }))
	defer other.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/models", http.StatusFound)
	}))
	defer server.Close()
	_, err := fetchModelCatalogPages(context.Background(), server.URL, "openai", "test-only", nil, "", "header", "X-Project-Key")
	if err == nil || leaked {
		t.Fatalf("redirect err=%v leaked=%v", err, leaked)
	}
}
