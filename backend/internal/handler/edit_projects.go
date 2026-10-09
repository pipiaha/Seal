package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/editruntime"
)

func RegisterEditProjectRoutes(api gin.IRouter, svc *app.Service, host *editruntime.Host) {
	registerStandaloneEditingProjects(api, svc)
	owned := func(c *gin.Context) bool {
		if !isLoopbackRequest(c.Request) {
			c.JSON(403, gin.H{"code": 403, "reason": "forbidden", "msg": "编辑入口只接受本机界面请求"})
			return false
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return false
		}
		c.Set("agentUserId", user.ID)
		if _, err := svc.UserAssistantProject(user.ID, c.Param("canvasId")); err != nil {
			c.JSON(404, gin.H{"code": 404, "reason": "project_not_found", "msg": "工程不存在或不属于当前工作区"})
			return false
		}
		hostCall := isAssistantHostRequest(c, svc)
		if c.GetHeader("X-Beeftv-Client") != "" || !hostCall {
			if !requireTrustedDesktopWritePrincipal(c, "剪辑入口需要受信任的桌面界面") {
				return false
			}
		}
		if c.GetHeader(assistantHostTokenHeader) != "" && !hostCall {
			c.JSON(403, gin.H{"code": 403, "reason": "invalid_host_token", "msg": "助手宿主凭据无效"})
			return false
		}
		if turnID := c.GetHeader(assistantTurnHeader); turnID != "" || hostCall {
			if !hostCall {
				c.JSON(403, gin.H{"code": 403, "reason": "turn_identity_required", "msg": "轮次身份只能由内置助手出示"})
				return false
			}
			scope, active, err := svc.AssistantTurnScopeForHost(user.ID, turnID)
			if err != nil || !active || scope.CanvasID != c.Param("canvasId") {
				c.JSON(403, gin.H{"code": 403, "reason": "turn_scope_mismatch", "msg": "助手轮次与当前项目不匹配"})
				return false
			}
			c.Set("editingTurnAssets", scope.AssetIDs)
		}
		return true
	}
	call := func(c *gin.Context, method, route string, body []byte) {
		if host == nil {
			c.JSON(503, gin.H{"code": 503, "reason": "edit_host_unavailable", "msg": "编辑运行端未安装"})
			return
		}
		data, status, err := host.Call(c.Request.Context(), method, route, body)
		if err != nil {
			c.JSON(status, gin.H{"code": status, "reason": "edit_host_unavailable", "msg": err.Error()})
			return
		}
		c.Data(status, "application/json", data)
	}
	api.POST("/edit-projects/:canvasId/open", func(c *gin.Context) {
		if !owned(c) {
			return
		}
		var payload struct {
			ParentOrigin string `json:"parentOrigin"`
			Theme        string `json:"theme"`
		}
		if c.ShouldBindJSON(&payload) != nil {
			c.JSON(400, gin.H{"code": 400, "msg": "缺少编辑页来源"})
			return
		}
		if origin := c.GetHeader("Origin"); origin != "" && payload.ParentOrigin != origin {
			c.JSON(403, gin.H{"code": 403, "msg": "编辑页来源不匹配"})
			return
		}
		if payload.Theme != "light" {
			payload.Theme = "dark"
		}
		body, _ := json.Marshal(gin.H{"projectId": c.Param("canvasId"), "parentOrigin": payload.ParentOrigin, "theme": payload.Theme})
		call(c, http.MethodPost, "/open", body)
	})
	api.POST("/edit-projects/:canvasId/production", func(c *gin.Context) {
		if !owned(c) {
			return
		}
		body, _ := json.Marshal(gin.H{"projectId": c.Param("canvasId")})
		call(c, http.MethodPost, "/production/open", body)
	})
	api.Any("/edit-projects/:canvasId/edits/:editId/*action", func(c *gin.Context) {
		if !owned(c) {
			return
		}
		if host == nil {
			c.JSON(503, gin.H{"code": 503, "reason": "edit_host_unavailable", "msg": "编辑运行端未安装"})
			return
		}
		if c.Request.Method == http.MethodPost && (c.Param("action") == "/assets/import" || c.Param("action") == "/hypit/assets/import") {
			var payload app.ImportEditingAssetRequest
			if c.ShouldBindJSON(&payload) != nil {
				c.JSON(400, gin.H{"code": 400, "msg": "素材导入请求无效"})
				return
			}
			if assets, exists := c.Get("editingTurnAssets"); exists {
				allowed := false
				for _, id := range assets.([]string) {
					if id == payload.AssetID {
						allowed = true
						break
					}
				}
				if !allowed {
					c.JSON(403, gin.H{"code": 403, "reason": "asset_out_of_scope", "msg": "请在当前对话中引用该素材"})
					return
				}
			}
			importer := svc.ImportEditingAsset
			if c.Param("action") == "/hypit/assets/import" {
				importer = svc.ImportHypitAsset
			}
			data, status, err := importer(c.Request.Context(), c.GetString("agentUserId"), c.Param("canvasId"), c.Param("editId"), payload, host)
			if err != nil {
				c.JSON(status, gin.H{"code": status, "reason": "asset_import_failed", "msg": err.Error()})
				return
			}
			c.Data(status, "application/json", data)
			return
		}
		if c.Request.Method == http.MethodPost && c.Param("action") == "/transcribe" {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
			var input app.AssistantEditMediaRequest
			if c.ShouldBindJSON(&input) != nil || input.File == "" {
				fail(c, 400, app.BadAuthRequest("转写请求无效"))
				return
			}
			policy, available := loadRuntimePolicy(c, svc)
			if !available || !enforceRateLimit(c, "timeline-ts:"+c.GetString("agentUserId"), policy.Request.TaskCreatePerMinute, time.Minute) {
				return
			}
			task, media, err := svc.AssistantTranscribeEditMedia(c.Request.Context(), c.GetString("agentUserId"), c.Param("canvasId"), c.Param("editId"), input, host)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"taskId": task.ID, "status": task.Status, "stage": task.Stage, "progress": task.Progress, "media": media})
			return
		}
		if c.Request.Method == http.MethodGet && strings.HasPrefix(c.Param("action"), "/exports/") && strings.HasSuffix(c.Param("action"), "/file") {
			route := "/edits/" + url.PathEscape(c.Param("editId")) + c.Param("action") + "?projectId=" + url.QueryEscape(c.Param("canvasId"))
			response, err := host.OpenStream(c.Request.Context(), http.MethodGet, route, nil, nil)
			if err != nil {
				c.JSON(503, gin.H{"code": 503, "msg": err.Error()})
				return
			}
			defer response.Body.Close()
			c.DataFromReader(response.StatusCode, response.ContentLength, response.Header.Get("Content-Type"), response.Body, map[string]string{"Cache-Control": "no-store"})
			return
		}
		// The runtime verifies edit -> canvas ownership again before dispatching any action.
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, (32<<20)+1))
		if err != nil || len(body) > 32<<20 {
			c.JSON(413, gin.H{"code": 413, "msg": "编辑请求过大"})
			return
		}
		if c.Param("action") == "/promote" {
			var input map[string]json.RawMessage
			if json.Unmarshal(body, &input) != nil || input == nil {
				c.JSON(400, gin.H{"code": 400, "msg": "候选提交无效"})
				return
			}
			if _, override := input["expectedRevision"]; override && c.GetHeader(assistantTurnHeader) != "" {
				c.JSON(403, gin.H{"code": 403, "reason": "candidate_review_required", "msg": "已变化的工程请在制作任务中选择加入"})
				return
			}
			actor := "person"
			if c.GetHeader(assistantTurnHeader) != "" {
				actor = "agent"
			}
			input["actor"], _ = json.Marshal(actor)
			body, _ = json.Marshal(input)
		}
		route := "/edits/" + url.PathEscape(c.Param("editId")) + c.Param("action") + "?projectId=" + url.QueryEscape(c.Param("canvasId"))
		call(c, c.Request.Method, route, body)
	})
}
