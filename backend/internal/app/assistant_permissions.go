package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"regexp"
	"strings"
)

var assistantSessionID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

func assistantPermissionKey(userID, projectID, sessionID string) string {
	digest := sha256.Sum256([]byte(userID + "\x00" + projectID + "\x00" + sessionID))
	return "assist-perm:" + hex.EncodeToString(digest[:])
}
func (s *Service) AssistantPermissionMode(userID, projectID, sessionID string) (string, error) {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return "", err
	}
	if !assistantSessionID.MatchString(sessionID) {
		return "", kernel.BadAuthRequest("对话标识无效")
	}
	setting, err := s.repo.SystemSetting(assistantPermissionKey(userID, projectID, sessionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "ask", nil
	}
	if err != nil {
		return "", err
	}
	var mode string
	if json.Unmarshal([]byte(setting.ValueJSON), &mode) != nil || mode != "ask" && mode != "allow" {
		return "", kernel.BadAuthRequest("对话权限记录无效")
	}
	return mode, nil
}
func (s *Service) SetAssistantPermissionMode(userID, projectID, sessionID, mode string) error {
	if _, err := s.AssistantPermissionMode(userID, projectID, sessionID); err != nil {
		return err
	}
	if mode != "ask" && mode != "allow" {
		return kernel.BadAuthRequest("请选择请求批准或完全允许")
	}
	value, _ := json.Marshal(mode)
	return s.repo.SaveSystemSetting(&model.SystemSetting{Key: assistantPermissionKey(userID, projectID, sessionID), ValueJSON: string(value), UpdatedBy: userID})
}
func (s *Service) RejectAssistantMedia(userID, projectID, id string) error {
	if _, err := s.UserAssistantProject(userID, projectID); err != nil {
		return err
	}
	changed, err := s.repo.DecideAssistantMedia(userID, projectID, id, "rejected")
	if err != nil {
		return err
	}
	if !changed {
		return kernel.BadAuthRequest("方案已提交或已处理，不能再次拒绝")
	}
	return nil
}
func (s *Service) StopAssistantMediaSession(userID, projectID, sessionID string) error {
	if _, err := s.AssistantPermissionMode(userID, projectID, sessionID); err != nil {
		return err
	}
	if err := s.saveAssistantMediaStop(userID, projectID, sessionID, true); err != nil {
		return err
	}
	return s.repo.StopAssistantMediaSession(userID, projectID, sessionID)
}

func (s *Service) ResumeAssistantMediaSession(userID, projectID, sessionID string) error {
	if _, err := s.AssistantPermissionMode(userID, projectID, sessionID); err != nil {
		return err
	}
	return s.saveAssistantMediaStop(userID, projectID, sessionID, false)
}

func assistantMediaStopKey(userID, projectID, sessionID string) string {
	return "assist-stop:" + strings.TrimPrefix(assistantPermissionKey(userID, projectID, sessionID), "assist-perm:")
}

func (s *Service) saveAssistantMediaStop(userID, projectID, sessionID string, stopped bool) error {
	value, _ := json.Marshal(stopped)
	return s.repo.SaveSystemSetting(&model.SystemSetting{Key: assistantMediaStopKey(userID, projectID, sessionID), ValueJSON: string(value), UpdatedBy: userID})
}

func (s *Service) assistantMediaSessionStopped(userID, projectID, sessionID string) (bool, error) {
	setting, err := s.repo.SystemSetting(assistantMediaStopKey(userID, projectID, sessionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	var stopped bool
	if json.Unmarshal([]byte(setting.ValueJSON), &stopped) != nil {
		return true, kernel.BadAuthRequest("对话停止状态无效")
	}
	return stopped, nil
}
func (s *Service) AssistantMediaContinuationAssets(userID, projectID, sessionID, id string) ([]string, error) {
	item, err := s.repo.AssistantMediaProposal(userID, projectID, id)
	if err != nil {
		return nil, err
	}
	if sessionID == "" || item.SessionID != sessionID || !item.AutoContinue || item.ContinuationTurnID != "" {
		return nil, kernel.BadAuthRequest("制作结果已续接、已停止或不属于当前对话")
	}
	if item.Decision == "rejected" {
		return []string{}, nil
	}
	if item.TaskID == "" {
		return nil, kernel.BadAuthRequest("制作任务尚未提交")
	}
	task, err := s.AssistantMediaTask(userID, projectID, item.TaskID)
	if err != nil {
		return nil, err
	}
	if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled || strings.HasPrefix(task.ResultState, "FAILED") {
		return []string{}, nil
	}
	if task.Status != model.TaskStatusSucceeded || task.ResultState != "READY" {
		return nil, kernel.BadAuthRequest("制作结果尚未准备好")
	}
	ids := []string{}
	for _, output := range task.Outputs {
		if output.MaterializedAssetID != "" {
			ids = append(ids, output.MaterializedAssetID)
		}
	}
	if len(ids) == 0 {
		return nil, kernel.BadAuthRequest("任务没有可用素材")
	}
	return ids, nil
}
func (s *Service) ClaimAssistantMediaContinuation(userID, projectID, sessionID, id, turnID string) (bool, error) {
	return s.repo.ClaimAssistantMediaContinuation(userID, projectID, sessionID, id, turnID)
}
