package app

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
)

type ChannelModelsRequest struct {
	BaseURL       string           `json:"baseUrl"`
	APIKey        string           `json:"apiKey"`
	APIFormat     string           `json:"apiFormat"`
	ModelsURL     string           `json:"modelsUrl"`
	AuthType      string           `json:"authType"`
	AuthHeader    string           `json:"authHeader"`
	Headers       []OutboundHeader `json:"headers"`
	ChannelID     string           `json:"channelId"`
	CredentialRef string           `json:"credentialRef"`
}

func (s *Service) FetchChannelModels(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]string, error) {
	items, err := s.FetchChannelModelCatalog(ctx, actor, input)
	if err != nil {
		return nil, err
	}
	return modelcatalog.CatalogModelIDs(items), nil
}

func (s *Service) FetchChannelModelCatalog(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]ChannelModelCatalogItem, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if err := s.resolveChannelModelsRequest(&input); err != nil {
		return nil, err
	}
	headers, err := NormalizeOutboundHeaders(input.Headers)
	if err != nil {
		return nil, err
	}
	if input.AuthType != "" && input.AuthType != "none" && input.AuthType != "bearer" && input.AuthType != "header" {
		return nil, BadAuthRequest("模型目录鉴权方式无效")
	}
	if input.AuthType == "header" {
		if strings.TrimSpace(input.AuthHeader) == "" {
			return nil, BadAuthRequest("请填写鉴权请求头名称")
		}
		if _, err := NormalizeOutboundHeaders([]OutboundHeader{{Name: input.AuthHeader, Value: input.APIKey}}); err != nil {
			return nil, err
		}
	}
	fetcher := func(ctx context.Context, baseURL, apiFormat, apiKey string, headers []modelcatalog.ChannelHeader) ([]byte, error) {
		return fetchModelCatalogPages(ctx, baseURL, apiFormat, apiKey, headers, input.ModelsURL, input.AuthType, input.AuthHeader)
	}
	catalog, err := modelcatalog.LoadChannelModelCatalog(ctx, fetcher, input.BaseURL, input.APIFormat, input.APIKey, headers, s.catalogExtraSource(), input.AuthType == "none")
	if err != nil {
		return nil, mapChannelModelCatalogError(err)
	}
	return catalog, nil
}

func (s *Service) fetchChannelModelCatalogBytes(ctx context.Context, baseURL, apiFormat, apiKey string, headers []modelcatalog.ChannelHeader) ([]byte, error) {
	return fetchModelCatalogPages(ctx, baseURL, apiFormat, apiKey, headers, "", "bearer", "")
}

func (s *Service) catalogExtraSource() modelcatalog.CatalogExtraSource {
	if s == nil || !s.isPluginEnabled() {
		return nil
	}
	return extraChannelModelCatalogItems
}

func mapChannelModelCatalogError(err error) error {
	if err == nil {
		return nil
	}
	var fetchErr modelcatalog.CatalogFetchError
	if errors.As(err, &fetchErr) {
		return channelModelsUpstreamError(fetchErr.Cause)
	}
	var jsonErr modelcatalog.CatalogJSONError
	if errors.As(err, &jsonErr) {
		return WrapAppError(http.StatusBadGateway, jsonErr.Error(), jsonErr.Cause)
	}
	var rejected modelcatalog.CatalogUpstreamRejectedError
	if errors.As(err, &rejected) {
		return NewAppError(http.StatusBadGateway, rejected.Error())
	}
	return err
}

func channelModelsUpstreamError(err error) error {
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return authErr
	}
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return WrapAppError(http.StatusBadGateway, "连接模型服务失败，请检查渠道地址和网络", err)
	}
	switch httpErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return NewAppError(http.StatusBadGateway, "模型服务鉴权失败，请检查 API Key")
	case http.StatusNotFound, http.StatusMethodNotAllowed:
		return NewAppError(http.StatusBadGateway, "模型服务未提供该目录接口，可配置目录路径或手工添加模型")
	case http.StatusTooManyRequests:
		return NewAppError(http.StatusBadGateway, "模型服务请求过于频繁或额度不足")
	default:
		return WrapAppError(http.StatusBadGateway, httpErr.Error(), err)
	}
}
