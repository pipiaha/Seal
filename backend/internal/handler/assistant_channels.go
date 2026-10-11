package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/workspace"
)

func registerAssistantChannelRoutes(group *gin.RouterGroup, svc *app.Service) {
	group.POST("/providers/read", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		result, err := svc.AssistantProviderChannels(userID, c.Param("projectId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/providers/preview", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request struct {
			Script     string                      `json:"script"`
			Capability protocol.Capability         `json:"capability"`
			Model      string                      `json:"model"`
			Request    *protocol.GenerationRequest `json:"request,omitempty"`
			Response   json.RawMessage             `json:"response,omitempty"`
		}
		if !readAgentChannelRequest(c, &request) {
			return
		}
		result, err := svc.AssistantProviderPreview(c.Request.Context(), userID, c.Param("projectId"), request.Script, request.Capability, request.Model, request.Request, request.Response)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/providers/save", func(c *gin.Context) {
		userID, _, valid := creatorScope(c, svc)
		if !valid {
			return
		}
		var request workspace.AgentProviderEdit
		if !readAgentChannelRequest(c, &request) {
			return
		}
		result, err := svc.AssistantProviderSave(c.Request.Context(), userID, c.Param("projectId"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

func readAgentChannelRequest(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		fail(c, 400, app.BadAuthRequest("渠道配置参数无效；仅支持指定渠道字段和可选 apiKey，不接受全量配置或请求头值"))
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(c, 400, app.BadAuthRequest("渠道配置只接受一个 JSON 对象"))
		return false
	}
	return true
}
