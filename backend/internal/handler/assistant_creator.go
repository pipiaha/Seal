package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/assistantruntime"
	"infinite-canvas/backend/internal/skills"
	"infinite-canvas/backend/internal/transcription"
	"net/http"
	"time"
)

// New tools keep the existing trusted desktop/open-turn ownership contract.
func creatorScope(c *gin.Context, svc *app.Service) (string, *agentops.AssistantScope, bool) {
	if !isLoopbackRequest(c.Request) {
		fail(c, 403, app.BadAuthRequest("仅接受当前本机工作区请求"))
		return "", nil, false
	}
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return "", nil, false
	}
	if _, err := svc.UserAssistantProject(user.ID, c.Param("projectId")); err != nil {
		fail(c, 404, app.BadAuthRequest("工程不属于当前工作区"))
		return "", nil, false
	}
	hostCall := isAssistantHostRequest(c, svc)
	if (c.GetHeader("X-Beeftv-Client") != "" || !hostCall) && !requireTrustedDesktopWritePrincipal(c, "需要受信任的本机界面或助手") {
		return "", nil, false
	}
	if c.GetHeader(assistantHostTokenHeader) != "" && !hostCall {
		fail(c, 403, app.BadAuthRequest("助手身份无效"))
		return "", nil, false
	}
	scope, _, err := assistantScopeForRequest(c, svc, user.ID, hostCall)
	if err != nil || hostCall && (scope == nil || scope.CanvasID != c.Param("projectId")) {
		fail(c, 403, app.BadAuthRequest("助手轮次与当前工程不匹配"))
		return "", nil, false
	}
	return user.ID, scope, true
}

func RegisterAssistantCreatorRoutes(api *gin.RouterGroup, svc *app.Service, host *assistantruntime.Host) {
	api.GET("/assistant/asr", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		status, err := transcription.StatusFor(svc.DataDir())
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	api.PUT("/assistant/asr", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		if !requireTrustedDesktopWritePrincipal(c, "需要受信任的本机界面修改 ASR 配置") {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var request transcription.Settings
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("ASR 配置无效"))
			return
		}
		if _, err := transcription.SaveSettings(svc.DataDir(), request); err != nil {
			fail(c, 400, app.BadAuthRequest(err.Error()))
			return
		}
		status, err := transcription.StatusFor(svc.DataDir())
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	group := api.Group("/assistant/projects/:projectId")
	registerAssistantChannelRoutes(group, svc)
	group.POST("/media/asr-status", func(c *gin.Context) {
		if _, _, valid := creatorScope(c, svc); !valid {
			return
		}
		status, err := transcription.StatusFor(svc.DataDir())
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	group.POST("/skills/list", func(c *gin.Context) {
		userID, _, okScope := creatorScope(c, svc)
		if !okScope {
			return
		}
		result, err := svc.SkillHubList(userID, skillHubBuiltinRoots(host))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skills": result})
	})
	group.POST("/skills/file", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			ID   string `json:"id"`
			File string `json:"file"`
		}
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("技能文件请求无效"))
			return
		}
		result, err := svc.SkillHubFile(userID, request.ID, request.File)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/skills/author", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 24<<20)
		var request skills.HubAuthorRequest
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("技能创作请求无效"))
			return
		}
		result, err := svc.SkillHubAuthor(userID, skillHubBuiltinRoots(host), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/skills/search", func(c *gin.Context) {
		_, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			Query string `json:"query"`
		}
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("搜索词无效"))
			return
		}
		result, err := svc.SkillHubSearch(c.Request.Context(), request.Query)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": result})
	})
	group.POST("/skills/download", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request skills.HubDownloadRequest
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("技能来源无效"))
			return
		}
		result, err := svc.SkillHubDownload(c.Request.Context(), userID, skillHubBuiltinRoots(host), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/media/transcribe", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			AssetID  string `json:"assetId"`
			NodeID   string `json:"nodeId"`
			Language string `json:"language"`
			Route    string `json:"route"`
		}
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("请选择音视频素材"))
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "timeline-ts:"+userID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		task, err := svc.AssistantTranscribeMedia(userID, c.Param("projectId"), request.AssetID, request.NodeID, request.Language, request.Route)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"taskId": task.ID, "status": task.Status, "stage": task.Stage, "progress": task.Progress})
	})
	group.POST("/media/transcription", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			TaskID string `json:"taskId"`
		}
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("识别任务无效"))
			return
		}
		task, err := svc.Task(userID, request.TaskID)
		if err != nil {
			failService(c, err)
			return
		}
		if task.ProjectID != c.Param("projectId") || task.Type != "timeline_transcription" {
			fail(c, 403, app.BadAuthRequest("识别任务与当前工程不匹配"))
			return
		}
		ok(c, gin.H{"taskId": task.ID, "status": task.Status, "stage": task.Stage, "progress": task.Progress, "resultJson": task.ResultJSON, "error": task.Error})
	})
}
