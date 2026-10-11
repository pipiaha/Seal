package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestLocalCustomChannelCanDispatchGenerationWithoutSystemChannel(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ModelChannel{}, &model.UserUploadReservation{}); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { svc.Close() })
	if err := svc.SaveLocalModelConfig([]byte(`{"channels":[{"id":"local-agnes","baseUrl":"https://apihub.agnes-ai.com/v1","enabled":true,"models":["agnes-image-2.5-flash"]}]}`)); err != nil {
		t.Fatal(err)
	}
	var systemQueries atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("count-system-channels", func(query *gorm.DB) {
		if query.Statement.Table == "model_channels" {
			systemQueries.Add(1)
		}
	}); err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://result.invalid/image.png"}]}`))
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	ctx := generation.WithRuntime(context.Background(), generation.Runtime{
		Limits: appLimitsPort{service: svc},
		Call:   generation.CallMeta{ChannelID: "local-agnes", UserID: "local-owner", TaskID: "local-task", Capability: "image", Model: "agnes-image-2.5-flash"},
	})
	var result map[string]any
	err = generation.PostJSON(ctx, generation.Config{ChannelID: "local-agnes", BaseURL: upstream.URL + "/v1", APIKey: "fixture-key", Model: "agnes-image-2.5-flash"}, "/images/generations", map[string]any{"model": "agnes-image-2.5-flash", "prompt": "draw"}, &result)
	if err != nil {
		t.Fatalf("saved local channel must dispatch generation: %v", err)
	}
	if requests.Load() != 1 || result["data"] == nil {
		t.Fatalf("dispatch=%d, result=%v", requests.Load(), result)
	}
	if systemQueries.Load() != 0 {
		t.Fatalf("local generation queried system channels %d times", systemQueries.Load())
	}
}

func TestMissingSystemConcurrencyConfigIsNotConcurrencyExhaustion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ModelChannel{}, &model.UserUploadReservation{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	_, _, err = svc.AcquireChannelSlot(context.Background(), "missing-system-channel", "", time.Second)
	if err == nil {
		t.Fatal("missing hosted channel was allowed")
	}
	failure := classifyTaskFailure(err)
	if failure.ErrorCode() != "local_config" || failure.Retryable || !failure.BlocksAutomaticRetry() || strings.Contains(failure.UserMessage(), "等待已有任务") {
		t.Fatalf("configuration failure presented as capacity exhaustion: %+v; message=%s", failure, failure.UserMessage())
	}
	if generation.ClassifyText(failure.UserMessage()).ErrorCode() != "local_config" {
		t.Fatal("persisted configuration failure lost its category")
	}
}

func TestRuntimeConcurrencySettingPersistsAndChannelOverrideWins(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_WORKER_CONCURRENCY", "3")
	t.Setenv("CANVAS_CHANNEL_CONCURRENCY", "3")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}, &model.ModelChannel{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	actor := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	policy := defaultRuntimePolicy()
	policy.Task.WorkerConcurrency = 8
	policy.Task.ChannelConcurrency = 6
	setting, err := svc.UpdateRuntimePolicySetting(actor, policy)
	if err != nil {
		t.Fatal(err)
	}
	if setting.Task.WorkerConcurrency != 8 || setting.Task.ChannelConcurrency != 6 {
		t.Fatalf("setting = %#v", setting)
	}

	channel := model.ModelChannel{ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, ConcurrencyLimit: 0}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	release, limit, err := svc.AcquireChannelSlot(context.Background(), channel.ID, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if limit != 6 {
		t.Fatalf("global channel limit = %d, want 6", limit)
	}

	if err := db.Model(&channel).Update("concurrency_limit", 9).Error; err != nil {
		t.Fatal(err)
	}
	release, limit, err = svc.AcquireChannelSlot(context.Background(), channel.ID, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if limit != 9 {
		t.Fatalf("overridden channel limit = %d, want 9", limit)
	}
}
