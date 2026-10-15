package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/outbound"
)

func modelCatalogURL(baseURL, apiFormat, override string) (string, error) {
	target := apiURL(baseURL, "/models")
	if apiFormat == "gemini" {
		target = strings.TrimSuffix(baseURL, "/v1beta") + "/v1beta/models"
	} else if apiFormat == "claude" {
		target = strings.TrimSuffix(baseURL, "/v1") + "/v1/models"
	}
	if strings.TrimSpace(override) != "" {
		base, err := url.Parse(strings.TrimRight(baseURL, "/") + "/")
		if err != nil {
			return "", BadAuthRequest("模型服务地址无效")
		}
		ref, err := url.Parse(strings.TrimSpace(override))
		if err != nil {
			return "", BadAuthRequest("模型目录地址无效")
		}
		target = base.ResolveReference(ref).String()
	}
	if !sameCredentialOrigin(target, baseURL) {
		return "", BadAuthRequest("模型目录接口必须与服务地址同站点，避免泄露渠道密钥")
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.User != nil || parsed.Fragment != "" {
		return "", BadAuthRequest("模型目录地址不能包含账号或片段")
	}
	if _, err := ValidateOutboundURL(target); err != nil {
		return "", err
	}
	return target, nil
}

func fetchModelCatalogPages(ctx context.Context, baseURL, apiFormat, apiKey string, headers []modelcatalog.ChannelHeader, override, authType, authHeader string) ([]byte, error) {
	target, err := modelCatalogURL(baseURL, apiFormat, override)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	var models []json.RawMessage
	var seen = map[string]bool{}
	for page := 0; page < 20; page++ {
		if seen[target] {
			return nil, BadAuthRequest("模型目录分页重复，请检查供应商接口")
		}
		seen[target] = true
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return nil, BadAuthRequest("模型服务地址无效")
		}
		if authType != "none" {
			if authType == "header" {
				request.Header.Set(authHeader, apiKey)
			} else if apiFormat == "gemini" {
				request.Header.Set("x-goog-api-key", apiKey)
			} else if apiFormat == "claude" {
				request.Header.Set("x-api-key", apiKey)
			} else {
				request.Header.Set("Authorization", "Bearer "+apiKey)
			}
		}
		if apiFormat == "claude" {
			request.Header.Set("anthropic-version", "2023-06-01")
		}
		ApplyOutboundHeaders(request, headers)
		data, err := fetchCatalogPage(request, baseURL)
		if err != nil {
			var httpErr providerHTTPError
			if errors.As(err, &httpErr) {
				return nil, modelcatalog.CatalogFetchError{StatusCode: httpErr.StatusCode, Cause: err}
			}
			return nil, modelcatalog.CatalogFetchError{Cause: err}
		}
		var payload struct {
			Data          []json.RawMessage `json:"data"`
			Models        []json.RawMessage `json:"models"`
			NextPageToken string            `json:"nextPageToken"`
			HasMore       bool              `json:"has_more"`
			LastID        string            `json:"last_id"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			return nil, modelcatalog.CatalogJSONError{Cause: err}
		}
		// Validate errors and response shape before following any pagination.
		if _, err := modelcatalog.ParseChannelModelCatalog(data, apiFormat); err != nil {
			return nil, err
		}
		if payload.Data != nil {
			models = append(models, payload.Data...)
		} else {
			models = append(models, payload.Models...)
		}
		next, _ := url.Parse(target)
		query := next.Query()
		if apiFormat == "gemini" && payload.NextPageToken != "" {
			query.Set("pageToken", payload.NextPageToken)
		} else if apiFormat == "claude" && payload.HasMore {
			if payload.LastID == "" {
				return nil, BadAuthRequest("模型目录分页缺少游标")
			}
			query.Set("after_id", payload.LastID)
		} else {
			if models == nil {
				models = []json.RawMessage{}
			}
			key := "data"
			if apiFormat == "gemini" {
				key = "models"
			}
			return json.Marshal(map[string]any{key: models})
		}
		next.RawQuery = query.Encode()
		target = next.String()
	}
	return nil, BadAuthRequest("模型目录超过分页上限，请缩小目录接口范围")
}

func fetchCatalogPage(request *http.Request, baseURL string) ([]byte, error) {
	client := outbound.OutboundHTTPClient(25 * time.Second)
	checkRedirect := client.CheckRedirect
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if !sameCredentialOrigin(next.URL.String(), baseURL) {
			return BadAuthRequest("模型目录不允许跨站点重定向")
		}
		return checkRedirect(next, via)
	}
	outbound.ApplyDefaultOutboundHeaders(request)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, providerHTTPError{StatusCode: response.StatusCode, Status: http.StatusText(response.StatusCode)}
	}
	const limit = 8 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > limit {
		return nil, BadAuthRequest("模型目录单页超过 8 MiB，请缩小接口范围")
	}
	return data, nil
}
