package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/agentworkspace"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/assistantruntime"
	"net/http"
	"os"
	"path/filepath"
)

func assistantInterpreters(host *assistantruntime.Host) (string, string) {
	node := ""
	if host != nil {
		config, _ := host.EffectiveConfig()
		node = config.HostCommand
	}
	python := os.Getenv("SEAL_PYTHON_RUNTIME")
	if python == "" {
		for _, file := range []string{filepath.Join(filepath.Dir(node), "python", "python.exe"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Python", "Python312", "python.exe")} {
			if i, e := os.Stat(file); e == nil && i.Mode().IsRegular() {
				python = file
				break
			}
		}
	}
	return node, python
}

func RegisterAssistantWorkspaceRoutes(api *gin.RouterGroup, svc *app.Service, host *assistantruntime.Host) {
	api.GET("/assistant/web-settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		settings, err := svc.AssistantWebSettings(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		node, python := assistantInterpreters(host)
		ok(c, gin.H{"settings": settings, "runtime": agentworkspace.Status(node, python)})
	})
	api.PUT("/assistant/web-settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !requireTrustedDesktopWritePrincipal(c, "需要受信任的本机界面修改联网配置") {
			return
		}
		if c.GetHeader(assistantHostTokenHeader) != "" {
			fail(c, 403, app.BadAuthRequest("助手不能修改搜索凭据"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var request app.AssistantWebSettings
		if c.ShouldBindJSON(&request) != nil {
			fail(c, 400, app.BadAuthRequest("联网配置无效"))
			return
		}
		result, err := svc.SaveAssistantWebSettings(user.ID, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group := api.Group("/assistant/projects/:projectId")
	for _, action := range []string{"workspace/info", "workspace/files", "workspace/run", "workspace/runs", "workspace/install", "workspace/skill", "workspace/asset", "workspace/publish", "assets/search", "web/search", "web/read", "web/download"} {
		group.POST("/"+action, func(c *gin.Context) {
			user, _, valid := creatorScope(c, svc)
			if !valid {
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 600<<10)
			var request struct {
				agentworkspace.FilesRequest
				Runtime        string   `json:"runtime"`
				Script         string   `json:"script"`
				Args           []string `json:"args"`
				Packages       []string `json:"packages"`
				TimeoutSeconds int      `json:"timeoutSeconds"`
				OperationID    string   `json:"operationId"`
				Name           string   `json:"name"`
				ContentHash    string   `json:"contentHash"`
				AssetID        string   `json:"assetId"`
				Title          string   `json:"title"`
				Kind           string   `json:"kind"`
				Page           int      `json:"page"`
				URL            string   `json:"url"`
			}
			if c.ShouldBindJSON(&request) != nil {
				fail(c, 400, app.BadAuthRequest("工作区工具参数无效"))
				return
			}
			project := c.Param("projectId")
			var result any
			var err error
			switch action {
			case "workspace/info":
				node, python := assistantInterpreters(host)
				result, err = svc.AssistantWorkspaceInfo(user, project, node, python)
			case "workspace/files":
				result, err = svc.AssistantWorkspaceFiles(user, project, request.FilesRequest)
			case "workspace/run":
				node, python := assistantInterpreters(host)
				result, err = svc.AssistantWorkspaceRun(c.Request.Context(), user, project, agentworkspace.RunRequest{Runtime: request.Runtime, Script: request.Script, Args: request.Args, TimeoutSeconds: request.TimeoutSeconds, OperationID: request.OperationID}, node, python)
			case "workspace/runs":
				result, err = svc.AssistantWorkspaceRuns(user, project)
			case "workspace/install":
				node, python := assistantInterpreters(host)
				result, err = svc.AssistantWorkspaceInstall(c.Request.Context(), user, project, request.Runtime, request.OperationID, request.Packages, node, python)
			case "workspace/skill":
				result, err = svc.AssistantWorkspaceSkill(user, project, request.Name, request.ContentHash, skillHubBuiltinRoots(host))
			case "workspace/asset":
				result, err = svc.AssistantWorkspaceAsset(user, project, request.AssetID, request.Path)
			case "workspace/publish":
				result, err = svc.AssistantWorkspacePublish(c.Request.Context(), user, project, request.Path, request.Title)
			case "assets/search":
				result, err = svc.AssistantAssetsSearch(user, project, request.Query, request.Kind, request.Page)
			case "web/search":
				result, err = svc.AssistantWebSearch(c.Request.Context(), user, project, request.Query)
			case "web/read":
				result, err = svc.AssistantWebRead(c.Request.Context(), user, project, request.URL, request.Offset)
			case "web/download":
				result, err = svc.AssistantWebDownload(c.Request.Context(), user, project, request.URL, request.Path)
			}
			if err != nil {
				fail(c, 400, app.BadAuthRequest(err.Error()))
				return
			}
			ok(c, result)
		})
	}
}
