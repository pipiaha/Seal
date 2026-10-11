package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/provider/comfyui"
	"infinite-canvas/backend/internal/provider/workflow"
)

type comfyClientKey struct{}

func comfyContext(ctx context.Context, config Config) (context.Context, error) {
	client, err := comfyui.HTTPClient(config.BaseURL, HTTPTimeout)
	if err != nil {
		return ctx, err
	}
	return context.WithValue(ctx, comfyClientKey{}, client), nil
}

func comfyRequest(ctx context.Context, config Config, kind, method, endpoint string, body []byte, contentType string) (data []byte, responseType string, err error) {
	ctx = WithRequestKind(ctx, kind)
	base, err := comfyui.ValidateURL(config.BaseURL)
	if err != nil {
		return nil, "", err
	}
	target := strings.TrimRight(base.String(), "/") + endpoint
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return nil, "", err
	}
	ApplyAuth(req, config)
	outbound.ApplyOutboundHeaders(req, config.Headers)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	started := time.Now()
	observation := TransportObservation{Request: req, StartedAt: started, ResponseLimitBytes: MaxResponseBytes}
	defer func() {
		observation.Body, observation.Err = data, err
		if runtime, ok := RuntimeFromContext(ctx); ok && runtime.Receipts != nil {
			runtime.Receipts.Observe(observation)
		}
	}()
	client, ok := ctx.Value(comfyClientKey{}).(*http.Client)
	if !ok {
		client, err = comfyui.HTTPClient(config.BaseURL, HTTPTimeout)
		if err != nil {
			return nil, "", err
		}
		defer client.CloseIdleConnections()
	}
	limit, err := GeneratedFileLimit(ctx)
	if err != nil {
		return nil, "", err
	}
	observation.ResponseLimitBytes = limit
	observation.Dispatched = true
	response, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	observation.StatusCode, observation.HTTPStatus, observation.DeclaredResponseBytes = response.StatusCode, response.StatusCode, response.ContentLength
	data, err = io.ReadAll(io.LimitReader(response.Body, limit+1))
	observation.ReceivedBytes = int64(len(data))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > limit {
		return nil, "", fmt.Errorf("ComfyUI 响应超过文件大小限制")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return data, "", HTTPError{StatusCode: response.StatusCode, Body: string(data)}
	}
	return data, response.Header.Get("Content-Type"), nil
}

func comfyJSON(ctx context.Context, config Config, kind, method, endpoint string, payload any, result any) error {
	var body []byte
	var err error
	if payload != nil {
		body, err = json.Marshal(payload)
		if err != nil {
			return err
		}
	}
	data, _, err := comfyRequest(ctx, config, kind, method, endpoint, body, "application/json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, result); err != nil {
		return fmt.Errorf("ComfyUI 返回了无效 JSON：%w", err)
	}
	return nil
}

// InspectComfyUI is read-only and never submits a prompt or installs a node.
func InspectComfyUI(ctx context.Context, config Config) (map[string]any, error) {
	ctx, err := comfyContext(ctx, config)
	if err != nil {
		return nil, err
	}
	defer ctx.Value(comfyClientKey{}).(*http.Client).CloseIdleConnections()
	var stats, nodes map[string]any
	if err := comfyJSON(ctx, config, "workflow-schema", http.MethodGet, "/system_stats", nil, &stats); err != nil {
		return nil, err
	}
	if err := comfyJSON(ctx, config, "workflow-schema", http.MethodGet, "/object_info", nil, &nodes); err != nil {
		return nil, err
	}
	return map[string]any{"stats": stats, "nodes": nodes}, nil
}

func RunComfyUITask(ctx context.Context, input Input) (map[string]any, error) {
	if err := requireTaskRuntime(ctx); err != nil {
		return nil, err
	}
	if err := ValidateConfiguredProvider(input.Mode, input.Config); err != nil {
		return nil, err
	}
	runtime, ok := RuntimeFromContext(ctx)
	if !ok || runtime.Resources == nil || !runtime.Resources.LocalMode() {
		return nil, fmt.Errorf("本地 ComfyUI 仅能在本地工作区运行")
	}
	ctx, err := comfyContext(ctx, input.Config)
	if err != nil {
		return nil, err
	}
	defer ctx.Value(comfyClientKey{}).(*http.Client).CloseIdleConnections()
	id := ResumedProviderRequestID(ctx)
	if id == "" {
		if runtime.Submission == nil {
			return nil, fmt.Errorf("ComfyUI 缺少持久任务回执")
		}
		if !hasComfyPromptBinding(input.Config.ComfyUI.Fields) {
			return nil, fmt.Errorf("请把工作流正向提示词绑定到提示词输入")
		}
		if err := runtime.Submission.Ready(ctx); err != nil {
			return nil, err
		}
		var info map[string]any
		if err := comfyJSON(ctx, input.Config, "workflow-schema", http.MethodGet, "/object_info", nil, &info); err != nil {
			return nil, err
		}
		for nodeID, raw := range input.Config.ComfyUI.Graph {
			node := raw.(map[string]any)
			class, _ := node["class_type"].(string)
			if _, exists := info[class]; !exists {
				return nil, fmt.Errorf("ComfyUI 缺少节点 %s（%s），请先在 ComfyUI 安装", nodeID, class)
			}
		}
		if len(input.ReferenceVideos) != 0 || len(input.ReferenceAudios) != 0 {
			return nil, fmt.Errorf("本地 ComfyUI 当前支持提示词和参考图片输入，视频／音频输入需要相应节点上传协议")
		}
		if err := HydrateMedia(ctx, runtime.Call.UserID, &input, MediaHydrationPolicy{}); err != nil {
			return nil, err
		}
		files := map[string]string{}
		workflowMedia := make([]workflow.Media, len(input.ReferenceImages))
		for index, media := range input.ReferenceImages {
			filename, err := uploadComfyImage(ctx, input.Config, media)
			if err != nil {
				return nil, err
			}
			mediaID := firstNonEmpty(media.ID, fmt.Sprintf("reference-%d", index))
			files[mediaID] = filename
			workflowMedia[index] = workflow.Media{ID: mediaID}
		}
		if input.Mask != nil {
			return nil, fmt.Errorf("当前 ComfyUI 连接未配置蒙版上传，请使用工作流内的蒙版节点")
		}
		bound, err := workflow.BindAPIGraph(workflow.Input{Mode: input.Mode, Prompt: input.Prompt, Config: workflow.Config{WorkflowJSON: input.Config.ComfyUI.Graph, WorkflowFields: input.Config.ComfyUI.Fields, Size: input.Config.Size, Count: input.Config.Count, VideoSeconds: input.Config.VideoSeconds, VQuality: input.Config.VQuality}, ReferenceImages: workflowMedia}, files)
		if err != nil {
			return nil, err
		}
		var response struct {
			ID         string         `json:"prompt_id"`
			Error      any            `json:"error"`
			NodeErrors map[string]any `json:"node_errors"`
		}
		err = comfyJSON(ctx, input.Config, "create", http.MethodPost, "/prompt", map[string]any{"prompt": bound, "client_id": uuid.NewString()}, &response)
		if err != nil {
			return nil, UncertainVideoSubmission(ctx, err)
		}
		id = strings.TrimSpace(response.ID)
		if id == "" {
			if response.Error != nil || len(response.NodeErrors) != 0 {
				return nil, fmt.Errorf("ComfyUI 工作流校验失败，请检查节点输入、已安装模型和必需依赖")
			}
			return nil, SubmissionUnknownError{Cause: fmt.Errorf("ComfyUI 未返回 prompt_id")}
		}
		if err := runtime.Submission.RecordAccepted(ctx, id, "submitted", nil); err != nil {
			return nil, SubmissionUnknownError{Cause: fmt.Errorf("ComfyUI 已受理任务 %s，但回执保存失败：%w", id, err)}
		}
	}
	ctx, cancel := context.WithDeadline(ctx, PollingDeadline(ctx))
	defer cancel()
	policy := DefaultVideoPollPolicy()
	policy.InitialDelay = 0
	policy.Interval = 2 * time.Second
	return RunVideoPollLoop(ctx, id, policy, func(ctx context.Context) (VideoPollOutcome, error) {
		result, status, err := QueryComfyUITask(ctx, input, id)
		if err == nil && result == nil && runtime.Stages != nil {
			err = runtime.Stages.SetStage(ctx, "ComfyUI · "+status)
		}
		if err == nil && result == nil && runtime.Submission != nil {
			next := time.Now().Add(policy.Interval)
			err = runtime.Submission.UpdateStage(ctx, id, status, &next)
		}
		return VideoPollOutcome{Done: result != nil, Result: result}, err
	})
}

func hasComfyPromptBinding(fields []WorkflowField) bool {
	for _, field := range fields {
		if (field.Enabled == nil || *field.Enabled) && (field.Source == "prompt" || field.BindPrompt) {
			return true
		}
	}
	return false
}

func uploadComfyImage(ctx context.Context, config Config, media Media) (string, error) {
	var data []byte
	var mediaType string
	var err error
	if strings.HasPrefix(firstNonEmpty(media.DataURL, media.URL), "data:") {
		data, mediaType, err = MediaBytes(media)
	} else {
		data, mediaType, err = GetExternalBinary(ctx, media.URL)
	}
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(mediaType, "image/") {
		return "", fmt.Errorf("参考图片 MIME 类型无效")
	}
	extensions, _ := mime.ExtensionsByType(strings.Split(mediaType, ";")[0])
	ext := ".png"
	if len(extensions) > 0 {
		ext = extensions[0]
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "seal-"+uuid.NewString()+ext)
	if err != nil {
		return "", err
	}
	if _, err = part.Write(data); err != nil {
		return "", err
	}
	_ = writer.WriteField("type", "input")
	_ = writer.WriteField("overwrite", "false")
	if err := writer.Close(); err != nil {
		return "", err
	}
	raw, _, err := comfyRequest(ctx, config, "upload", http.MethodPost, "/upload/image", body.Bytes(), writer.FormDataContentType())
	if err != nil {
		return "", err
	}
	var response struct {
		Name      string `json:"name"`
		Subfolder string `json:"subfolder"`
	}
	if err := json.Unmarshal(raw, &response); err != nil || response.Name == "" {
		return "", fmt.Errorf("ComfyUI 未返回上传文件名")
	}
	if !safeComfyFile(response.Name, response.Subfolder) {
		return "", fmt.Errorf("ComfyUI 上传文件路径无效")
	}
	if response.Subfolder != "" {
		return response.Subfolder + "/" + response.Name, nil
	}
	return response.Name, nil
}

func safeComfyFile(name, folder string) bool {
	return name != "" && path.Base(name) == name && !strings.ContainsAny(name, "\\") && !strings.Contains(folder, "..") && !strings.Contains(folder, "\\") && !strings.HasPrefix(folder, "/")
}

func QueryComfyUITask(ctx context.Context, input Input, id string) (map[string]any, string, error) {
	var history map[string]any
	if err := comfyJSON(ctx, input.Config, "poll", http.MethodGet, "/history/"+url.PathEscape(id), nil, &history); err != nil {
		return nil, "", err
	}
	entry, ok := history[id].(map[string]any)
	if !ok {
		var queue map[string]any
		if err := comfyJSON(ctx, input.Config, "poll", http.MethodGet, "/queue", nil, &queue); err != nil {
			return nil, "", err
		}
		for _, key := range []string{"queue_running", "queue_pending"} {
			items, _ := queue[key].([]any)
			for _, raw := range items {
				item, _ := raw.([]any)
				if len(item) > 1 && item[1] == id {
					if key == "queue_running" {
						return nil, "正在生成", nil
					}
					return nil, "排队中", nil
				}
			}
		}
		return nil, "", fmt.Errorf("ComfyUI 队列与历史中均找不到任务 %s，可能已清理；不会自动重新提交", id)
	}
	status, _ := entry["status"].(map[string]any)
	if status["status_str"] == "error" {
		return nil, "failed", fmt.Errorf("ComfyUI 工作流执行失败（任务 %s），请在 ComfyUI 查看节点错误", id)
	}
	if completed, _ := status["completed"].(bool); !completed {
		return nil, "正在生成", nil
	}
	outputs, _ := entry["outputs"].(map[string]any)
	node, _ := outputs[input.Config.ComfyUI.OutputNodeID].(map[string]any)
	items, _ := node[input.Config.ComfyUI.OutputField].([]any)
	if len(items) == 0 {
		return nil, "failed", fmt.Errorf("工作流完成，但输出节点 %s 的 %s 没有文件", input.Config.ComfyUI.OutputNodeID, input.Config.ComfyUI.OutputField)
	}
	artifacts := []any{}
	for _, raw := range items {
		file, _ := raw.(map[string]any)
		name, _ := file["filename"].(string)
		folder, _ := file["subfolder"].(string)
		kind, _ := file["type"].(string)
		if !safeComfyFile(name, folder) || (kind != "output" && kind != "temp") {
			return nil, "failed", fmt.Errorf("ComfyUI 输出文件描述无效")
		}
		query := url.Values{"filename": {name}, "subfolder": {folder}, "type": {kind}}
		data, contentType, err := comfyRequest(ctx, input.Config, "download", http.MethodGet, "/view?"+query.Encode(), nil, "")
		if err != nil {
			return nil, "", VideoDownloadError{TaskID: id, Cause: err}
		}
		if len(data) == 0 {
			return nil, "failed", fmt.Errorf("ComfyUI 输出文件为空")
		}
		mediaType := mime.TypeByExtension(strings.ToLower(path.Ext(name)))
		if mediaType == "" {
			mediaType = strings.Split(contentType, ";")[0]
		}
		if !strings.HasPrefix(mediaType, input.Mode+"/") {
			return nil, "failed", fmt.Errorf("输出 %s 的类型 %s 与%s任务不一致", name, mediaType, input.Mode)
		}
		artifacts = append(artifacts, map[string]any{"dataUrl": DataURL(mediaType, data), "mimeType": mediaType, "filename": name})
	}
	if input.Mode == "image" {
		return map[string]any{"mode": "image", "images": artifacts}, "succeeded", nil
	}
	return map[string]any{"mode": "video", "video": artifacts[0]}, "succeeded", nil
}

func CancelComfyUITask(ctx context.Context, config Config, id string) error {
	var result map[string]any
	err := comfyJSON(ctx, config, "cancel", http.MethodPost, "/api/jobs/"+url.PathEscape(id)+"/cancel", map[string]any{}, &result)
	if err == nil {
		if cancelled, _ := result["cancelled"].(bool); cancelled {
			return nil
		}
		return fmt.Errorf("ComfyUI 未确认取消，任务可能已经结束")
	}
	var httpErr HTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 404 {
		return err
	}
	var queue map[string]any
	if err := comfyJSON(ctx, config, "poll", http.MethodGet, "/queue", nil, &queue); err != nil {
		return err
	}
	pending, _ := queue["queue_pending"].([]any)
	for _, raw := range pending {
		item, _ := raw.([]any)
		if len(item) > 1 && item[1] == id {
			if err := comfyJSON(ctx, config, "cancel", http.MethodPost, "/queue", map[string]any{"delete": []string{id}}, &result); err != nil {
				return err
			}
			if err := comfyJSON(ctx, config, "poll", http.MethodGet, "/queue", nil, &queue); err != nil {
				return err
			}
			for _, key := range []string{"queue_pending", "queue_running"} {
				rows, _ := queue[key].([]any)
				for _, raw := range rows {
					row, _ := raw.([]any)
					if len(row) > 1 && row[1] == id {
						return fmt.Errorf("任务仍在 ComfyUI 队列中，未确认取消")
					}
				}
			}
			return nil
		}
	}
	return fmt.Errorf("该 ComfyUI 版本无法定向停止运行任务；已停止本地等待，不会全局中断其他任务")
}
