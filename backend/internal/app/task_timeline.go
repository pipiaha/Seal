package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/editing"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"
	"infinite-canvas/backend/internal/transcription"
	"net/http"
)

type timelineTranscriptionInput struct {
	ResourceID string `json:"resourceId"`
	Language   string `json:"language"`
	Route      string `json:"route"`
	RuntimeKey string `json:"runtimeKey"`
}

func (w *taskWorkerCoordinator) processTimelineTranscription(task *model.Task, ctx context.Context) error {
	s := w.service
	var input timelineTranscriptionInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || strings.TrimSpace(input.ResourceID) == "" {
		return w.failTimelineTask(task, "转写失败", "任务缺少有效的资源引用")
	}
	route, key, settings, err := transcription.ResolveConfiguredRoute(s.dataDir, input.Route)
	if err != nil {
		return w.failTimelineTask(task, "转写失败", err.Error())
	}
	if input.RuntimeKey != "" && key != input.RuntimeKey {
		return w.failTimelineTask(task, "转写配置变化", "识别运行包或服务配置已变化，请重新提交识别")
	}
	if err := s.RequireFeature(FeatureTimelineTranscription); err != nil {
		return w.failTimelineTask(task, "转写失败", "字幕转写暂未开放")
	}
	s.logInfo(task.UserID, task.ID, "时间线转写任务开始", "")

	executor := s.transcriptionExecutor(task.UserID, "")
	executor.Client = transcription.ConfiguredClient(route, settings)
	if route == "service" {
		ctx = s.bindGenerationRuntime(ctx, generation.CallMeta{UserID: task.UserID, TaskID: task.ID, ProjectID: task.ProjectID, TraceID: task.TraceID, RequestID: task.RequestID, ChannelID: "online-asr", Capability: "asr", Model: settings.Model, Operation: "transcribe", RequestKind: "create"})
		executor.Client.Observe = func(req *http.Request, started time.Time, status int, body []byte, requestErr error) {
			recordProviderRequest(s, req, started, status, body, requestErr)
		}
	}
	result, err := executor.Run(ctx, input.ResourceID, input.Language, func(stage string, percent int) error {
		return w.progress(task, stage, percent)
	})
	if err != nil {
		return w.failTimelineTask(task, "转写失败", err.Error())
	}

	payload, err := json.Marshal(result)
	if err != nil {
		return w.failTimelineTask(task, "转写失败", "转写结果序列化失败")
	}
	task.Status = model.TaskStatusSucceeded
	task.Stage = "转写完成"
	task.Progress = 100
	task.ResultJSON = string(payload)
	completedAt := time.Now()
	task.CompletedAt = &completedAt
	if err := s.repo.SaveTaskCompletion(task, model.TaskStatusRunning, nil); err != nil {
		return fmt.Errorf("写入转写完成态失败: %w", err)
	}
	s.logInfo(task.UserID, task.ID, fmt.Sprintf("时间线转写完成，段落 %d", len(result.Segments)), "")
	return nil
}

func (w *taskWorkerCoordinator) failTimelineTask(task *model.Task, stage string, message string) error {
	s := w.service
	done, err := s.repo.UpdateTaskTerminalState(task.ID, task.LeaseOwner, model.TaskStatusRunning, model.TaskStatusFailed, stage, message, time.Now())
	if err != nil {
		return fmt.Errorf("写入转写失败态失败: %w", err)
	}
	if !done {
		return fmt.Errorf("时间线任务状态或租约已变化：%w", repository.ErrTaskStateConflict)
	}
	s.logInfo(task.UserID, task.ID, fmt.Sprintf("时间线转写失败: %s", message), "")
	return nil
}

func (w *taskWorkerCoordinator) progress(task *model.Task, stage string, progress int) error {
	if err := w.service.repo.UpdateTaskProgressForLease(task.ID, task.LeaseOwner, stage, progress); err != nil {
		return fmt.Errorf("更新转写进度失败: %w", err)
	}
	return nil
}

func (s *Service) logInfo(userID string, taskID string, message string, extra string) {
	s.log(userID, taskID, "info", message, extra)
}

type TimelineTranscriptionCreateRequest = localtask.TimelineTranscriptionCreateRequest

func (s *Service) CreateTimelineTranscriptionTask(userID string, req TimelineTranscriptionCreateRequest) (*model.Task, error) {
	return s.taskDomain().CreateTimelineTranscriptionTask(userID, req)
}

type TimelineRenderCreateRequest = localtask.TimelineRenderCreateRequest

type timelineRenderInput struct {
	ProjectID string          `json:"projectId"`
	Timeline  editing.Project `json:"timeline"`
	Options   editing.Options `json:"options"`
}

type TimelineRenderPlanRequest struct {
	Timeline editing.Project      `json:"timeline"`
	Sources  []editing.SourceMeta `json:"sources"`
	Options  editing.Options      `json:"options"`
}

type timelineRenderResult struct {
	ResourceID  string `json:"resourceId"`
	FileName    string `json:"fileName"`
	Size        int64  `json:"size"`
	DurationMs  int64  `json:"durationMs"`
	SubtitleSRT string `json:"subtitleSrt,omitempty"`
}

func (s *Service) CreateTimelineRenderTask(userID string, req TimelineRenderCreateRequest) (*model.Task, error) {
	return s.taskDomain().CreateTimelineRenderTask(userID, req)
}

func (s *Service) CompileTimelineRenderPlan(userID string, req TimelineRenderPlanRequest) (*editing.Plan, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("未登录")
	}
	plan, err := editing.Compile(req.Timeline, req.Sources, req.Options)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return plan, nil
}
