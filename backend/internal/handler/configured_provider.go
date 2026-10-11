package handler

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/protocol"
)

func RegisterConfiguredProviderRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.POST("/workspace/providers/script/preview", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		var input struct {
			Script   string                     `json:"script"`
			Request  protocol.GenerationRequest `json:"request"`
			Response json.RawMessage            `json:"response,omitempty"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.PreviewProviderScript(c.Request.Context(), input.Script, input.Request, input.Response)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/workspace/providers/comfyui/inspect", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		var config generation.Config
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		if err := c.ShouldBindJSON(&config); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		config.InterfaceType = "comfyui-video"
		result, err := svc.InspectLocalComfyUI(c.Request.Context(), config)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
