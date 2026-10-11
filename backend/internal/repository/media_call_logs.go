package repository

import (
	"errors"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/calllog"
	"infinite-canvas/backend/internal/model"
	"strings"
)

const mediaCapabilities = "api_call_logs.capability IN ('image','video','audio','asr')"
const mediaGroupMatch = "child.user_id = api_call_logs.user_id AND (child.task_id = api_call_logs.task_id AND COALESCE(api_call_logs.task_id, '') <> '' OR child.id = api_call_logs.id)"
const mediaGroupSelect = "api_call_logs.*, call_task.status AS current_task_status, call_task.stage AS task_stage, call_task.project_id AS project_id, (SELECT COUNT(*) FROM api_call_logs child WHERE " + mediaGroupMatch + " AND child.capability IN ('image','video','audio','asr')) AS request_count"
const mediaSummaryColumns = "api_call_logs.id, api_call_logs.channel_id, api_call_logs.task_id, api_call_logs.capability, api_call_logs.model, api_call_logs.status, api_call_logs.status_code, api_call_logs.method, api_call_logs.path, api_call_logs.upstream_url, api_call_logs.error, api_call_logs.error_code, api_call_logs.provider_request_id, api_call_logs.request_kind, api_call_logs.duration_ms, api_call_logs.started_at, api_call_logs.created_at"

func (r *Repository) mediaCallQuery(userID string) *gorm.DB {
	return r.db.Table("api_call_logs").Where("api_call_logs.user_id = ?", userID).Where(mediaCapabilities).
		Joins("LEFT JOIN tasks call_task ON call_task.id = api_call_logs.task_id AND call_task.user_id = api_call_logs.user_id")
}

func (r *Repository) ListMediaCallLogs(userID string, filter calllog.Filter) ([]calllog.Entry, int64, error) {
	query := func() *gorm.DB {
		q := r.mediaCallQuery(userID).Where("NOT EXISTS (SELECT 1 FROM api_call_logs child WHERE " + mediaGroupMatch + " AND child.capability IN ('image','video','audio','asr') AND (child.created_at < api_call_logs.created_at OR child.created_at = api_call_logs.created_at AND child.id < api_call_logs.id))")
		if filter.Capability != "" {
			q = q.Where("api_call_logs.capability = ?", filter.Capability)
		}
		if filter.ChannelID != "" {
			q = q.Where("api_call_logs.channel_id = ?", filter.ChannelID)
		}
		if filter.TaskID != "" {
			q = q.Where("api_call_logs.task_id = ?", filter.TaskID)
		}
		if filter.Keyword != "" {
			pattern := "%" + strings.ToLower(filter.Keyword) + "%"
			q = q.Where("EXISTS (SELECT 1 FROM api_call_logs child WHERE "+mediaGroupMatch+" AND (lower(child.model) LIKE ? OR lower(child.task_id) LIKE ? OR lower(child.channel_id) LIKE ? OR lower(child.upstream_url) LIKE ? OR lower(child.error) LIKE ? OR lower(child.provider_request_id) LIKE ?))", pattern, pattern, pattern, pattern, pattern, pattern)
		}
		switch filter.Status {
		case "uncertain":
			q = q.Where("call_task.stage = ?", "submission_unknown")
		case "running":
			q = q.Where("call_task.status IN ?", []string{"queued", "running"})
		case "failed":
			q = q.Where("COALESCE(call_task.status, api_call_logs.status) = 'failed' AND COALESCE(call_task.stage, '') <> 'submission_unknown'")
		case "succeeded":
			q = q.Where("COALESCE(call_task.status, api_call_logs.status) = 'succeeded'")
		}
		return q
	}
	var total int64
	if err := query().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []calllog.Entry{}
	err := query().Select(strings.Replace(mediaGroupSelect, "api_call_logs.*", mediaSummaryColumns, 1)).Order("api_call_logs.created_at DESC, api_call_logs.id DESC").Offset((filter.Page - 1) * filter.Limit).Limit(filter.Limit).Scan(&items).Error
	return items, total, err
}

func (r *Repository) MediaCallLogForUser(userID, id string) (calllog.Entry, error) {
	var entry calllog.Entry
	if userID == "" {
		return entry, calllog.ErrNotFound
	}
	result := r.mediaCallQuery(userID).Select(mediaGroupSelect).Where("api_call_logs.id = ?", id).Limit(1).Scan(&entry)
	if result.Error != nil {
		return entry, result.Error
	}
	if result.RowsAffected == 0 {
		return entry, calllog.ErrNotFound
	}
	return entry, nil
}

func (r *Repository) MediaCallLogRequests(userID string, root model.ApiCallLog, page, limit int) ([]model.ApiCallLog, int64, error) {
	query := func() *gorm.DB {
		q := r.db.Model(&model.ApiCallLog{}).Where("user_id = ? AND capability IN ('image','video','audio','asr')", userID)
		if root.TaskID != "" {
			return q.Where("task_id = ?", root.TaskID)
		}
		return q.Where("id = ?", root.ID)
	}
	var total int64
	if err := query().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	requests := []model.ApiCallLog{}
	err := query().Omit("RequestBody", "ResponseBody").Order("created_at ASC, id ASC").Offset((page - 1) * limit).Limit(limit).Find(&requests).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, 0, calllog.ErrNotFound
	}
	return requests, total, err
}
