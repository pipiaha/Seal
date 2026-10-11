package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/generation"
	"net/http"
)

func RegisterConfiguredProviderRoutes(r *gin.RouterGroup, svc *app.Service) {
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
