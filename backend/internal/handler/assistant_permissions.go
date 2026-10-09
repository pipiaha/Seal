package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	"net/http"
)

func registerAssistantPermissionRoutes(api *gin.RouterGroup, svc *app.Service) {
	group := api.Group("/assistant/projects/:projectId")
	principal := func(c *gin.Context) (string, bool) {
		if c.GetHeader(assistantHostTokenHeader) != "" {
			fail(c, 403, app.BadAuthRequest("助手不能修改或批准自己的权限"))
			return "", false
		}
		user, _, valid := creatorScope(c, svc)
		return user, valid
	}
	for _, action := range []string{"read", "write", "stop", "resume"} {
		action := action
		group.POST("/permissions/"+action, func(c *gin.Context) {
			user, valid := principal(c)
			if !valid {
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
			var request struct {
				SessionID string `json:"sessionId"`
				Mode      string `json:"mode"`
			}
			if c.ShouldBindJSON(&request) != nil {
				fail(c, 400, app.BadAuthRequest("对话权限请求无效"))
				return
			}
			var err error
			if action == "write" {
				err = svc.SetAssistantPermissionMode(user, c.Param("projectId"), request.SessionID, request.Mode)
			}
			if action == "stop" {
				err = svc.StopAssistantMediaSession(user, c.Param("projectId"), request.SessionID)
			}
			if action == "resume" {
				err = svc.ResumeAssistantMediaSession(user, c.Param("projectId"), request.SessionID)
			}
			if err != nil {
				failService(c, err)
				return
			}
			mode, err := svc.AssistantPermissionMode(user, c.Param("projectId"), request.SessionID)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"mode": mode})
		})
	}
	group.POST("/media/reject/:proposalId", func(c *gin.Context) {
		user, valid := principal(c)
		if !valid {
			return
		}
		if err := svc.RejectAssistantMedia(user, c.Param("projectId"), c.Param("proposalId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"rejected": true})
	})
}
