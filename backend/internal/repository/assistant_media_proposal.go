package repository

import (
	"errors"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) CreateAssistantMediaProposal(item *model.AssistantMediaProposal) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(item).Error
}
func (r *Repository) AssistantMediaProposal(userID, projectID, id string) (*model.AssistantMediaProposal, error) {
	var item model.AssistantMediaProposal
	err := r.db.Where("id = ? AND user_id = ? AND project_id = ?", id, userID, projectID).First(&item).Error
	return &item, err
}
func (r *Repository) AssistantMediaProposals(userID, projectID string) ([]model.AssistantMediaProposal, error) {
	items := []model.AssistantMediaProposal{}
	err := r.db.Where("user_id = ? AND project_id = ?", userID, projectID).Order("created_at DESC").Limit(100).Find(&items).Error
	return items, err
}
func (r *Repository) BindAssistantMediaTask(userID, projectID, id, taskID string) error {
	result := r.db.Model(&model.AssistantMediaProposal{}).Where("id = ? AND user_id = ? AND project_id = ? AND decision != 'rejected' AND (task_id = '' OR task_id = ?)", id, userID, projectID, taskID).Updates(map[string]any{"task_id": taskID, "decision": "approved"})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("assistant media task binding was rejected")
	}
	return nil
}

// Admission and rejection compete on one decision before a task can be created.
func (r *Repository) ApproveAssistantMedia(userID, projectID, id string, automatic bool) (bool, error) {
	query := r.db.Model(&model.AssistantMediaProposal{}).Where("id = ? AND user_id = ? AND project_id = ? AND task_id = '' AND decision IN ('', 'approved')", id, userID, projectID)
	if automatic {
		query = query.Where("auto_continue = ?", true)
	}
	result := query.Update("decision", "approved")
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) DecideAssistantMedia(userID, projectID, id, decision string) (bool, error) {
	result := r.db.Model(&model.AssistantMediaProposal{}).Where("id = ? AND user_id = ? AND project_id = ? AND task_id = '' AND (decision = '' OR decision = ?)", id, userID, projectID, decision).Update("decision", decision)
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) StopAssistantMediaSession(userID, projectID, sessionID string) error {
	return r.db.Model(&model.AssistantMediaProposal{}).Where("user_id = ? AND project_id = ? AND session_id = ? AND continuation_turn_id = ''", userID, projectID, sessionID).Update("auto_continue", false).Error
}

func (r *Repository) ClaimAssistantMediaContinuation(userID, projectID, sessionID, id, turnID string) (bool, error) {
	result := r.db.Model(&model.AssistantMediaProposal{}).Where("id = ? AND user_id = ? AND project_id = ? AND session_id = ? AND auto_continue = ? AND continuation_turn_id = ''", id, userID, projectID, sessionID, true).Update("continuation_turn_id", turnID)
	return result.RowsAffected == 1, result.Error
}
