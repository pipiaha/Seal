package app

import (
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/beefapi"
	"infinite-canvas/backend/internal/workspace"
)

const managedBeefAPIRef = beefapi.CredentialRef

func (s *Service) SetBeefAPI(connection *beefapi.Service) {
	if s == nil {
		return
	}
	s.beefAPI = connection
}

func (s *Service) BeefAPI() *beefapi.Service {
	if s == nil {
		return nil
	}
	return s.beefAPI
}

func (s *Service) resolveManagedBeefAPISecrets(input map[string]any) (map[string]any, error) {
	config, _ := input["config"].(map[string]any)
	if workspace.IsRetiredChannel(stringValue(config["channelId"]), stringValue(config["credentialRef"])) {
		return nil, BadAuthRequest("原内置渠道已移除，请重新选择模型渠道")
	}
	return input, nil
}

func (s *Service) lookupBeefAPICredential() (apiKey, baseURL, accountID, tokenID string, err error) {
	return "", "", "", "", BadAuthRequest("原内置渠道已移除，请重新配置模型渠道")
}

func (s *Service) hasLegacyBeefAPIKey(channelID, baseURL string) bool { return false }

func (s *Service) resolveChannelModelsRequest(input *ChannelModelsRequest) error {
	if input != nil && workspace.IsRetiredChannel(input.ChannelID, input.CredentialRef) {
		return BadAuthRequest("原内置渠道已移除，请重新配置模型渠道")
	}
	return nil
}

func (s *Service) ResolveCustomRelayAPIKey(targetURL, incoming string) (string, error) {
	return incoming, nil
}

func (s *Service) resolveCustomRelayKey(targetURL, incoming string) (string, error) {
	return incoming, nil
}

func sameCredentialOrigin(targetURL, baseURL string) bool {
	target, targetErr := url.Parse(strings.TrimSpace(targetURL))
	base, baseErr := url.Parse(strings.TrimSpace(baseURL))
	if targetErr != nil || baseErr != nil || target.User != nil || base.User != nil || target.Host == "" || base.Host == "" {
		return false
	}
	if target.Scheme != "https" && target.Scheme != "http" {
		return false
	}
	return strings.EqualFold(target.Scheme, base.Scheme) && strings.EqualFold(target.Host, base.Host)
}

func (s *Service) noteBeefAPIProviderError(message string) {}
