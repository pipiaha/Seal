package app

import (
	"crypto/sha256"
	"encoding/hex"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	localtask "infinite-canvas/backend/internal/task"
	"strings"
)

func (s *Service) AssistantMediaPropose(userID, projectID, operationID, kind, prompt, selectedModel string, sessions ...string) (*model.AssistantMediaProposal, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, err
	}
	prompt = strings.TrimSpace(prompt)
	if len(operationID) != 64 || prompt == "" || len(prompt) > 20000 || kind != "image" && kind != "video" && kind != "audio" {
		return nil, kernel.BadAuthRequest("生成提议参数无效")
	}
	display, key, revision, mismatch, err := s.ResolveAssistantGenerationModel(kind, selectedModel)
	if err != nil {
		return nil, err
	}
	if mismatch || key == "" {
		return nil, kernel.BadAuthRequest("请先配置对应的图片、视频或配音模型")
	}
	display, key, revision, mismatch, err = s.ResolveAssistantGenerationModel(kind, key)
	if err != nil {
		return nil, err
	}
	if mismatch || key == "" {
		return nil, kernel.BadAuthRequest("当前生成模型未配置或已停用")
	}
	hash := sha256.Sum256([]byte(userID + "\x00" + projectID + "\x00" + operationID))
	item := &model.AssistantMediaProposal{ID: "media_" + hex.EncodeToString(hash[:]), UserID: userID, ProjectID: projectID, Kind: kind, Prompt: prompt, Model: display, ModelKey: key, ConfigRevision: revision}
	if len(sessions) > 0 && sessions[0] != "" {
		if !assistantSessionID.MatchString(sessions[0]) {
			return nil, kernel.BadAuthRequest("对话标识无效")
		}
		item.SessionID = sessions[0]
		item.AutoContinue = true
	}
	if err := s.repo.CreateAssistantMediaProposal(item); err != nil {
		return nil, err
	}
	// Read after insertion so an in-flight proposal arriving after Stop stays stopped.
	if item.SessionID != "" {
		stopped, err := s.assistantMediaSessionStopped(userID, projectID, item.SessionID)
		if err != nil {
			return nil, err
		}
		if stopped {
			if err := s.repo.StopAssistantMediaSession(userID, projectID, item.SessionID); err != nil {
				return nil, err
			}
		}
	}
	stored, err := s.repo.AssistantMediaProposal(userID, projectID, item.ID)
	if err != nil {
		return nil, err
	}
	if stored.Kind != kind || stored.Prompt != prompt || stored.ModelKey != key || stored.SessionID != item.SessionID {
		return nil, kernel.BadAuthRequest("生成提议标识已用于其他内容")
	}
	return stored, nil
}

func (s *Service) AssistantMediaProposals(userID, projectID string) ([]model.AssistantMediaProposal, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, err
	}
	return s.repo.AssistantMediaProposals(userID, projectID)
}

// Called by trusted UI after explicit approval or persisted allow mode. SDK tools cannot
// call this paid path. Existing admission, encrypted credentials, delivery and
// recovery remain authoritative; the proposal is a durable identity, not a worker.
func (s *Service) AcceptAssistantMedia(userID, projectID, proposalID string, request localtask.CreateRequest, automatic ...bool) (*model.Task, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return nil, err
	}
	proposal, err := s.repo.AssistantMediaProposal(userID, projectID, proposalID)
	if err != nil {
		return nil, err
	}
	if proposal.Decision == "rejected" || (len(automatic) > 0 && automatic[0] && !proposal.AutoContinue) {
		return nil, kernel.BadAuthRequest("方案已拒绝或自动制作已停止")
	}
	if len(automatic) > 0 && automatic[0] {
		mode, err := s.AssistantPermissionMode(userID, projectID, proposal.SessionID)
		if err != nil {
			return nil, err
		}
		if mode != "allow" {
			return nil, kernel.BadAuthRequest("当前对话需要你批准生成")
		}
		stopped, err := s.assistantMediaSessionStopped(userID, projectID, proposal.SessionID)
		if err != nil {
			return nil, err
		}
		if stopped {
			return nil, kernel.BadAuthRequest("自动制作已停止，请发送新的要求后继续")
		}
	}
	operationID := "assistant-media:" + proposal.ID
	if previous, err := s.repo.TaskByClientOperation(userID, operationID); err != nil {
		return nil, err
	} else if previous != nil {
		if previous.ProjectID != projectID || previous.Type != "canvas_"+proposal.Kind || previous.Prompt != proposal.Prompt {
			return nil, kernel.BadAuthRequest("生成提议的提交回执与工程内容不一致")
		}
		if err = s.repo.BindAssistantMediaTask(userID, projectID, proposal.ID, previous.ID); err != nil {
			return nil, err
		}
		return s.Task(userID, previous.ID)
	}
	_, key, revision, mismatch, err := s.ResolveAssistantGenerationModel(proposal.Kind, proposal.ModelKey)
	if err != nil {
		return nil, err
	}
	if mismatch || key != proposal.ModelKey || revision != proposal.ConfigRevision {
		return nil, kernel.BadAuthRequest("模型配置已变化，请让助手重新提出生成方案")
	}
	config, _ := request.Input["config"].(map[string]any)
	_, requestedModel := modelcatalog.SplitModelKey(request.Model)
	if request.Type != "canvas_"+proposal.Kind || request.Prompt != proposal.Prompt || request.Input["prompt"] != proposal.Prompt || request.Input["mode"] != proposal.Kind || requestedModel != proposal.Model {
		return nil, kernel.BadAuthRequest("提交内容与生成提议不一致")
	}
	if config == nil {
		return nil, kernel.BadAuthRequest("缺少现有渠道配置")
	}
	request.ProjectID = projectID
	request.PrepareOnly = false
	request.AdmissionID = ""
	metadata, _ := request.Input["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["clientOperationId"] = operationID
	metadata["source"] = "assistant_media"
	metadata["proposalId"] = proposal.ID
	metadata["assistantPermissionMode"] = "ask"
	if len(automatic) > 0 && automatic[0] {
		metadata["assistantPermissionMode"] = "allow"
	}
	request.Input["metadata"] = metadata
	approved, err := s.repo.ApproveAssistantMedia(userID, projectID, proposal.ID, len(automatic) > 0 && automatic[0])
	if err != nil {
		return nil, err
	}
	if !approved {
		return nil, kernel.BadAuthRequest("方案已拒绝、已停止或正在提交，请重新读取任务")
	}
	task, err := s.CreateLocalTask(userID, request)
	if err != nil {
		return nil, err
	}
	if err = s.repo.BindAssistantMediaTask(userID, projectID, proposal.ID, task.ID); err != nil {
		return nil, err
	}
	return task, nil
}

func (s *Service) AssistantMediaTask(userID, projectID, taskID string) (*model.Task, error) {
	items, err := s.AssistantMediaProposals(userID, projectID)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.TaskID == taskID {
			task, err := s.Task(userID, taskID)
			if err != nil {
				return nil, err
			}
			if task.ProjectID != projectID || task.Type != "canvas_"+item.Kind {
				return nil, kernel.BadAuthRequest("生成任务归属与方案不一致")
			}
			return task, nil
		}
	}
	return nil, kernel.BadAuthRequest("任务不属于当前工程的助手生成方案")
}
