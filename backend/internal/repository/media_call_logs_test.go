package repository

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/calllog"
	"infinite-canvas/backend/internal/model"
)

func TestMediaCallLogsGroupRequestsAndScopeDetails(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "logs.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	if err := db.AutoMigrate(&model.ApiCallLog{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "video-task", UserID: "owner", Status: model.TaskStatusFailed, Stage: "submission_unknown"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	rows := []model.ApiCallLog{
		{ID: "create", UserID: "owner", TaskID: task.ID, Capability: "video", RequestKind: "create", Status: model.ApiCallStatusSucceeded, CreatedAt: now, RequestBody: `{"api_key":"secret-value","prompt":"cat"}`},
		{ID: "poll", UserID: "owner", TaskID: task.ID, Capability: "video", RequestKind: "poll", Status: model.ApiCallStatusFailed, CreatedAt: now.Add(time.Second), Error: "missing", ResponseBody: `{"error":"missing"}`, UpstreamURL: "https://example.com/tasks/1?key=secret-query&view=full"},
		{ID: "text", UserID: "owner", Capability: "text", CreatedAt: now},
		{ID: "other", UserID: "another", Capability: "image", CreatedAt: now},
		{ID: "standalone", UserID: "owner", Capability: "audio", Status: model.ApiCallStatusSucceeded, CreatedAt: now},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	svc := calllog.Service{Store: New(db)}
	page, err := svc.List("owner", calllog.Filter{Keyword: "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != "create" || page.Items[0].RequestCount != 2 || page.Items[0].Outcome != "uncertain" || page.Items[0].RequestBody != "" {
		t.Fatalf("group summary = %+v", page)
	}
	filtered, err := svc.List("owner", calllog.Filter{Status: "uncertain"})
	if err != nil || filtered.Total != 1 {
		t.Fatalf("uncertain filter: %+v %v", filtered, err)
	}
	all, err := svc.List("owner", calllog.Filter{})
	if err != nil || all.Total != 2 {
		t.Fatalf("media scope: %+v %v", all, err)
	}
	detail, err := svc.Detail("owner", "create", 1)
	if err != nil || detail.Total != 2 || len(detail.Requests) != 2 || detail.Requests[0].ResponseBody != "" {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	request, err := svc.Request("owner", "create", "poll")
	if err != nil || request.ResponseBody == "" || request.UpstreamURL == rows[1].UpstreamURL {
		t.Fatalf("request: %+v %v", request, err)
	}
	for _, pair := range [][2]string{{"create", "other"}, {"create", "standalone"}, {"create", "text"}} {
		if _, err := svc.Request("owner", pair[0], pair[1]); !errors.Is(err, calllog.ErrNotFound) {
			t.Fatalf("unscoped request %v: %v", pair, err)
		}
	}
	if _, err := svc.Detail("another", "create", 1); !errors.Is(err, calllog.ErrNotFound) {
		t.Fatalf("foreign detail: %v", err)
	}
}
