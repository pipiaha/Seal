package app

import (
	"context"
	"encoding/json"
	"errors"

	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/workspace"
)

func (s *Service) assistantChannelStore(userID, projectID string) (*workspace.ProviderConfig, error) {
	if !s.IsLocalMode() {
		return nil, Forbidden("助手渠道配置仅用于本地工作区")
	}
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, err
	}
	return workspace.NewProviderConfig(s.dataDir)
}

func (s *Service) AssistantProviderChannels(userID, projectID string) (map[string]any, error) {
	store, err := s.assistantChannelStore(userID, projectID)
	if err != nil {
		return nil, err
	}
	return store.AgentProviderChannels()
}

func (s *Service) AssistantProviderPreview(ctx context.Context, userID, projectID, script string, capability protocol.Capability, model string, request *protocol.GenerationRequest, response json.RawMessage) (map[string]any, error) {
	store, err := s.assistantChannelStore(userID, projectID)
	if err != nil {
		return nil, err
	}
	result, err := store.AgentProviderPreview(ctx, script, capability, model, request, response)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return result, nil
}

func (s *Service) AssistantProviderSave(ctx context.Context, userID, projectID string, edit workspace.AgentProviderEdit) (map[string]any, error) {
	store, err := s.assistantChannelStore(userID, projectID)
	if err != nil {
		return nil, err
	}
	result, err := store.AgentProviderSave(ctx, edit)
	if errors.Is(err, workspace.ErrProviderConfigRevisionConflict) {
		return nil, NewAppError(409, "模型配置已变化，请重新读取渠道后再保存")
	}
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return result, nil
}
