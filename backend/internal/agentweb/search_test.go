package agentweb

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestDeepSeekNativeSearchContractAndCitations(t *testing.T) {
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != DeepSeekSearchBaseURL+"/messages" || r.Header.Get("x-api-key") != "fixture-key" || r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Fatal("wrong native search request contract")
		}
		var body struct {
			Model string `json:"model"`
			Tools []struct {
				Type    string `json:"type"`
				MaxUses int    `json:"max_uses"`
			} `json:"tools"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.Model != DeepSeekSearchModel || len(body.Tools) != 1 || body.Tools[0].Type != "web_search_20250305" || body.Tools[0].MaxUses != 3 {
			t.Fatal("native search tool not requested")
		}
		data := `{"content":[{"type":"text","text":"Untrusted model prose must not become search output","citations":[{"url":"https://example.com/article","cited_text":"Real citation excerpt"}]},{"type":"web_search_tool_result","content":[{"type":"web_search_result","url":"https://example.com/article","title":"Example","page_age":"2026-10-01"},{"type":"web_search_result","url":"https://example.com/article","title":"Duplicate"},{"type":"web_search_result","url":"http://127.0.0.1/secret"},{"type":"web_search_result","url":"https://example.com/other"}]}]}`
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(data))}, nil
	})}
	result, err := SearchConfigured(t.Context(), client, SearchConfig{Provider: "deepseek", APIKey: "fixture-key", BaseURL: DeepSeekSearchBaseURL, Model: DeepSeekSearchModel, MaxResults: 1}, "Seal video editor")
	if err != nil || len(result) != 1 || result[0].Excerpt != "Real citation excerpt" || result[0].PublishedDate != "2026-10-01" || result[0].Title != "Example" {
		t.Fatal(result, err)
	}
}

func TestDeepSeekRejectsProseErrorsRedirectAndCancellation(t *testing.T) {
	for _, data := range []string{`{"content":[{"type":"text","text":"See https://example.com"}]}`, `{"content":[{"type":"web_search_tool_result","content":{"type":"web_search_tool_result_error","error_code":"unavailable"}}]}`, `{"content":[{"type":"web_search_tool_result","content":[{"type":"web_search_tool_result_error","error_code":"unavailable"}]}]}`} {
		if _, err := parseDeepSeekSources([]byte(data), 6); err == nil {
			t.Fatal("unsupported or failed search accepted", data)
		}
	}
	config := SearchConfig{Provider: "deepseek", APIKey: "fixture-key", BaseURL: DeepSeekSearchBaseURL, Model: DeepSeekSearchModel, MaxResults: 6}
	requests := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.Context().Err() != nil {
			return nil, r.Context().Err()
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://other.example/steal"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if _, err := SearchConfigured(t.Context(), client, config, "query"); err == nil || requests != 1 {
		t.Fatal("redirect followed", requests, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := SearchConfigured(ctx, client, config, "query"); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation lost", err)
	}
}
