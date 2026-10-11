package handler

import (
	"errors"
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/calllog"
	"net/http"
	"strconv"
)

func RegisterCallLogRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.GET("/call-logs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.Query("page"))
		limit, _ := strconv.Atoi(c.Query("limit"))
		data, err := svc.CallLogDomain().List(user.ID, calllog.Filter{Page: page, Limit: limit, Capability: c.Query("capability"), Status: c.Query("status"), Keyword: c.Query("keyword"), ChannelID: c.Query("channelId"), TaskID: c.Query("taskId")})
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, data)
	})
	r.GET("/call-logs/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.Query("page"))
		data, err := svc.CallLogDomain().Detail(user.ID, c.Param("id"), page)
		if err != nil {
			failCallLog(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, data)
	})
	r.GET("/call-logs/:id/requests/:requestId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		data, err := svc.CallLogDomain().Request(user.ID, c.Param("id"), c.Param("requestId"))
		if err != nil {
			failCallLog(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, data)
	})
}

func failCallLog(c *gin.Context, err error) {
	if errors.Is(err, calllog.ErrNotFound) {
		fail(c, http.StatusNotFound, err)
		return
	}
	failService(c, err)
}
