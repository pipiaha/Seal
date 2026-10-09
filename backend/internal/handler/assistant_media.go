package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	localtask "infinite-canvas/backend/internal/task"
	"net/http"
	"time"
)

func RegisterAssistantMediaRoutes(api *gin.RouterGroup, svc *app.Service) {
	registerAssistantPermissionRoutes(api, svc)
	group := api.Group("/assistant/projects/:projectId/media")
	group.POST("/read", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var request struct {
			AssetID string    `json:"assetId"`
			NodeID  string    `json:"nodeId"`
			Frames  bool      `json:"frames"`
			Times   []float64 `json:"times"`
			Count   int       `json:"count"`
		}
		if c.ShouldBindJSON(&request) != nil || (request.AssetID == "") == (request.NodeID == "") {
			fail(c, 400, app.BadAuthRequest("请选择一个素材或画布节点"))
			return
		}
		if request.Frames {
			provider, err := svc.ResolveAssistantProvider()
			if err != nil {
				failService(c, err)
				return
			}
			if provider.MaxImages <= 0 {
				c.JSON(400, gin.H{"code": 400, "reason": "image_input_invalid", "msg": "当前模型未开启图片输入，视频画面需要视觉模型"})
				return
			}
			if len(request.Times) > provider.MaxImages {
				fail(c, 400, app.BadAuthRequest("视频时间点超过模型图片数量限制"))
				return
			}
			if request.Count == 0 {
				request.Count = 3
			}
			request.Count = min(max(1, request.Count), provider.MaxImages)
		}
		result, err := svc.AssistantReadMedia(c.Request.Context(), userID, c.Param("projectId"), request.AssetID, request.NodeID, request.Frames, request.Times, request.Count)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/propose", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			OperationID string `json:"operationId"`
			Kind        string `json:"kind"`
			Prompt      string `json:"prompt"`
			Model       string `json:"model"`
			SessionID   string `json:"sessionId"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("生成方案无效"))
			return
		}
		proposal, err := svc.AssistantMediaPropose(userID, c.Param("projectId"), request.OperationID, request.Kind, request.Prompt, request.Model, request.SessionID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, proposal)
	})
	group.POST("/proposals", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		items, err := svc.AssistantMediaProposals(userID, c.Param("projectId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})
	group.POST("/task", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			TaskID string `json:"taskId"`
		}
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("生成任务无效"))
			return
		}
		item, err := svc.AssistantMediaTask(userID, c.Param("projectId"), request.TaskID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	group.POST("/accept/:proposalId", func(c *gin.Context) {
		// Host tools cannot admit billable generation using their launch token.
		if c.GetHeader(assistantHostTokenHeader) != "" || !requireTrustedDesktopWritePrincipal(c, "请在界面确认后开始生成") {
			if !c.Writer.Written() {
				fail(c, 403, app.BadAuthRequest("助手只能提出生成方案，不能代替界面确认"))
			}
			return
		}
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+userID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
		var request struct {
			localtask.CreateRequest
			Automatic bool `json:"automatic"`
		}
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("生成参数无效"))
			return
		}
		request.TraceID, request.RequestID = TraceID(c), RequestID(c)
		item, err := svc.AcceptAssistantMedia(userID, c.Param("projectId"), c.Param("proposalId"), request.CreateRequest, request.Automatic)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
}
