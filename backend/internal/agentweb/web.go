package agentweb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"golang.org/x/net/html"
	"infinite-canvas/backend/internal/outbound"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type Source struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	URL           string `json:"url"`
	Excerpt       string `json:"excerpt,omitempty"`
	PublishedDate string `json:"publishedDate,omitempty"`
}

func source(url, title, text, date string) Source {
	sum := sha256.Sum256([]byte(url))
	return Source{ID: "web_" + hex.EncodeToString(sum[:8]), Title: title, URL: url, Excerpt: text, PublishedDate: date}
}
func Client() *http.Client { return outbound.PublicHTTPClient(25 * time.Second) }

func Search(ctx context.Context, client *http.Client, key, query string) ([]Source, error) {
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("web_search_not_configured: configure Tavily in model settings")
	}
	if strings.TrimSpace(query) == "" || len(query) > 1000 {
		return nil, errors.New("web_query_invalid")
	}
	body, _ := json.Marshal(map[string]any{"query": query, "search_depth": "basic", "max_results": 6, "include_answer": false, "include_raw_content": false, "include_images": false})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.tavily.com/search", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	searchClient := *client
	searchClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := searchClient.Do(req)
	if err != nil {
		return nil, errors.New("web_search_network_failed")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("web_search_provider_rejected")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20+1))
	if err != nil || len(data) > 2<<20 {
		return nil, errors.New("web_search_response_invalid")
	}
	var result struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
			Date    string `json:"published_date"`
		} `json:"results"`
	}
	if json.Unmarshal(data, &result) != nil {
		return nil, errors.New("web_search_response_invalid")
	}
	sources := []Source{}
	for _, hit := range result.Results {
		if len(sources) >= 6 {
			break
		}
		if _, err := outbound.ParsePublicURL(hit.URL); err != nil {
			continue
		}
		excerpt := hit.Content
		if len(excerpt) > 5000 {
			excerpt = excerpt[:5000]
		}
		sources = append(sources, source(hit.URL, hit.Title, strings.ToValidUTF8(excerpt, "�"), hit.Date))
	}
	return sources, nil
}

func Open(ctx context.Context, raw string) (*http.Response, error) {
	u, err := outbound.ValidatePublicURLContext(ctx, raw)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", outbound.DefaultOutboundUserAgent)
	response, err := Client().Do(req)
	if err != nil {
		return nil, errors.New("web_read_network_failed")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, errors.New("web_read_http_failed")
	}
	return response, nil
}
func Read(ctx context.Context, raw string, offset int) (map[string]any, error) {
	response, err := Open(ctx, raw)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	contentType := response.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/") && !strings.Contains(contentType, "application/json") {
		return nil, errors.New("web_read_text_required: use web_download for binary assets")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 {
		return nil, errors.New("web_page_too_large")
	}
	title := ""
	text := ""
	if strings.Contains(contentType, "html") {
		doc, err := html.Parse(bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		var walk func(*html.Node, bool)
		var out strings.Builder
		walk = func(n *html.Node, inTitle bool) {
			if n.Type == html.ElementNode {
				switch n.Data {
				case "script", "style", "noscript", "svg", "nav", "footer":
					return
				}
				if n.Data == "title" {
					inTitle = true
				}
				switch n.Data {
				case "p", "div", "br", "li", "h1", "h2", "h3", "tr", "article", "section":
					out.WriteByte('\n')
				}
			}
			if n.Type == html.TextNode {
				trimmed := strings.TrimSpace(n.Data)
				if inTitle {
					title += trimmed
				} else if trimmed != "" {
					out.WriteString(trimmed)
					out.WriteByte(' ')
				}
			}
			for child := n.FirstChild; child != nil; child = child.NextSibling {
				walk(child, inTitle)
			}
		}
		walk(doc, false)
		text = out.String()
	} else {
		if !utf8.Valid(body) {
			return nil, errors.New("web_page_encoding_unsupported")
		}
		text = string(body)
	}
	if offset < 0 || offset > len(text) {
		return nil, errors.New("web_offset_invalid")
	}
	end := offset + 20000
	if end > len(text) {
		end = len(text)
	}
	for end < len(text) && !utf8.RuneStart(text[end]) {
		end++
	}
	page := source(response.Request.URL.String(), title, "", "")
	return map[string]any{"source": page, "text": text[offset:end], "offset": offset, "nextOffset": end, "truncated": end < len(text), "untrusted": true}, nil
}
