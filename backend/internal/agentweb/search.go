package agentweb

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/outbound"
)

const DeepSeekSearchBaseURL = "https://api.deepseek.com/anthropic/v1"
const DeepSeekSearchModel = "deepseek-v4-flash"

type SearchConfig struct {
	Provider   string
	APIKey     string
	BaseURL    string
	Model      string
	MaxResults int
}

func SearchConfigured(ctx context.Context, client *http.Client, config SearchConfig, query string) ([]Source, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 1000 {
		return nil, searchError(400, "web_query_invalid", "请输入有效的搜索关键词（最多1000字节）")
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, searchError(400, "web_search_not_configured", "请在模型配置的联网搜索中配置搜索凭证")
	}
	if config.MaxResults < 1 || config.MaxResults > 10 {
		return nil, searchError(400, "web_search_result_limit_invalid", "搜索结果数量必须为1到10条")
	}
	switch config.Provider {
	case "tavily":
		return searchTavily(ctx, client, config, query)
	case "deepseek":
		return searchDeepSeek(ctx, client, config, query)
	default:
		return nil, searchError(400, "web_search_provider_invalid", "请选择 Tavily 或 DeepSeek 搜索服务")
	}
}

// DeepSeek exposes search through a separate Messages turn. Only native result
// blocks and their URL-keyed citation excerpts are returned to the main agent.
func searchDeepSeek(ctx context.Context, client *http.Client, config SearchConfig, query string) ([]Source, error) {
	u, err := outbound.ParsePublicURL(config.BaseURL)
	if err != nil || u.Scheme != "https" || u.RawQuery != "" || u.Fragment != "" {
		return nil, searchError(400, "web_search_endpoint_invalid", "DeepSeek 搜索基础地址无效，请填写公开 HTTPS 地址")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/messages"
	body, err := json.Marshal(map[string]any{
		"model": config.Model, "max_tokens": 4096,
		"messages": []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "Perform a web search for the query: " + query}}}},
		"tools":    []any{map[string]any{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}},
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("x-api-key", config.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	searchClient := *client
	searchClient.Timeout = 90 * time.Second
	searchClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := searchClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, searchNetworkError("DeepSeek", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, searchProviderError("DeepSeek", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil || len(data) > 2<<20 {
		return nil, searchError(502, "web_search_response_invalid", "DeepSeek 搜索响应无法读取或超过大小限制")
	}
	return parseDeepSeekSources(data, config.MaxResults)
}

func parseDeepSeekSources(data []byte, limit int) ([]Source, error) {
	var response struct {
		Content []struct {
			Type      string          `json:"type"`
			Content   json.RawMessage `json:"content"`
			Citations []struct {
				URL       string `json:"url"`
				CitedText string `json:"cited_text"`
			} `json:"citations"`
		} `json:"content"`
	}
	if json.Unmarshal(data, &response) != nil {
		return nil, searchError(502, "web_search_response_invalid", "DeepSeek 搜索返回了无效的数据格式")
	}
	excerpts := map[string]string{}
	for _, block := range response.Content {
		if block.Type == "text" {
			for _, cite := range block.Citations {
				if excerpts[cite.URL] == "" {
					excerpts[cite.URL] = cite.CitedText
				}
			}
		}
	}
	seen := map[string]bool{}
	sources := []Source{}
	found := false
	for _, block := range response.Content {
		if block.Type != "web_search_tool_result" {
			continue
		}
		found = true
		var hits []struct {
			Type    string `json:"type"`
			URL     string `json:"url"`
			Title   string `json:"title"`
			PageAge string `json:"page_age"`
		}
		if json.Unmarshal(block.Content, &hits) != nil {
			return nil, searchError(502, "web_search_native_failed", "DeepSeek 原生搜索失败，请检查接口是否支持搜索")
		}
		for _, hit := range hits {
			if hit.Type == "web_search_tool_result_error" {
				return nil, searchError(502, "web_search_native_failed", "DeepSeek 原生搜索返回错误，请稍后再试或检查供应商服务状态")
			}
			if hit.Type != "web_search_result" || seen[hit.URL] {
				continue
			}
			if _, err := outbound.ParsePublicURL(hit.URL); err != nil {
				continue
			}
			seen[hit.URL] = true
			excerpt := excerpts[hit.URL]
			if len(excerpt) > 5000 {
				excerpt = strings.ToValidUTF8(excerpt[:5000], "")
			}
			if len(sources) < limit {
				sources = append(sources, source(hit.URL, hit.Title, excerpt, hit.PageAge))
			}
		}
	}
	if !found {
		return nil, searchError(502, "web_search_no_native_results", "DeepSeek 接口未返回原生搜索结果；普通聊天接口或中转可能不支持此能力")
	}
	return sources, nil
}
