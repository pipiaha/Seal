package handler

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
)

type editWorkspaceContext struct {
	Mode          string          `json:"mode"`
	ProjectID     string          `json:"projectId"`
	EditID        string          `json:"editId"`
	Revision      int64           `json:"revision"`
	Selection     json.RawMessage `json:"selection"`
	Overview      json.RawMessage `json:"overview,omitempty"`
	RecentChanges json.RawMessage `json:"recentChanges,omitempty"`
}

func validateEditWorkspaceContext(c *gin.Context, canvasID string, requested *editWorkspaceContext) (*editWorkspaceContext, bool) {
	dependencies, _ := runtimeDependencies(c)
	if requested.Mode != "edit" || requested.ProjectID != canvasID || requested.EditID == "" || dependencies.EditHost == nil {
		c.JSON(400, gin.H{"code": 400, "reason": "invalid_edit_context", "msg": "剪辑任务的工程范围无效"})
		return nil, false
	}
	route := "/edits/" + url.PathEscape(requested.EditID) + "/context?projectId=" + url.QueryEscape(canvasID)
	data, status, err := dependencies.EditHost.Call(c.Request.Context(), http.MethodGet, route, nil)
	if err != nil {
		c.JSON(503, gin.H{"code": 503, "reason": "edit_host_unavailable", "msg": "无法读取剪辑工程"})
		return nil, false
	}
	var envelope struct {
		Code int                  `json:"code"`
		Data editWorkspaceContext `json:"data"`
	}
	if status != 200 || json.Unmarshal(data, &envelope) != nil || envelope.Code != 0 {
		c.Data(status, "application/json", data)
		return nil, false
	}
	if envelope.Data.Revision != requested.Revision {
		c.JSON(409, gin.H{"code": 409, "reason": "revision_conflict", "msg": "工程刚刚发生变化，请重新发送这条剪辑要求"})
		return nil, false
	}
	// Freeze the UI's selection snapshot, but obtain document ownership and revision from the runtime.
	envelope.Data.Mode = "edit"
	envelope.Data.Selection = requested.Selection
	return &envelope.Data, true
}
