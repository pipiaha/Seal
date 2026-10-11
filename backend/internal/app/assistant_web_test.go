package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/agentweb"
	"infinite-canvas/backend/internal/model"
)

func TestSearchProviderCredentialsStaySeparateAndLegacySettingsSurvive(t *testing.T) {
	fixture, _ := newTimelineTaskTestService(t)
	s := NewLocal(fixture.repo, t.TempDir())
	defer s.Close()
	legacy, _ := s.encryptSettingSecret("legacy-tavily-fixture")
	body, _ := json.Marshal(AssistantWebSettings{Enabled: true, APIKey: legacy})
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: webSettingsKey("owner"), ValueJSON: string(body)}); err != nil {
		t.Fatal(err)
	}
	old, err := s.assistantWebSettings("owner")
	if err != nil || old.APIKey != "legacy-tavily-fixture" || old.Provider != "tavily" {
		t.Fatal("legacy setting lost", err)
	}
	settings, err := s.SaveAssistantWebSettings("owner", AssistantWebSettings{Enabled: true, Provider: "deepseek", APIKey: "deepseek-fixture"})
	if err != nil || !settings.Configured || settings.APIKey != "" {
		t.Fatal("new credential leaked or lost", err)
	}
	row, _ := s.repo.SystemSetting(webSettingsKey("owner"))
	if strings.Contains(row.ValueJSON, "deepseek-fixture") || strings.Contains(row.ValueJSON, "legacy-tavily-fixture") {
		t.Fatal("credential persisted as plaintext")
	}
	_, err = s.SaveAssistantWebSettings("owner", AssistantWebSettings{Enabled: true, Provider: "tavily"})
	if err != nil {
		t.Fatal(err)
	}
	back, err := s.assistantWebSettings("owner")
	if err != nil || back.APIKey != "legacy-tavily-fixture" {
		t.Fatal("switch erased Tavily key", err)
	}
	_, err = s.SaveAssistantWebSettings("owner", AssistantWebSettings{Provider: "deepseek", ClearKey: true})
	if err != nil {
		t.Fatal(err)
	}
	cleared, _ := s.assistantWebSettings("owner")
	if cleared.Configured {
		t.Fatal("DeepSeek key not cleared")
	}
	_, _ = s.SaveAssistantWebSettings("owner", AssistantWebSettings{Provider: "tavily"})
	kept, _ := s.assistantWebSettings("owner")
	if !kept.Configured {
		t.Fatal("clearing DeepSeek erased Tavily key")
	}
}

func TestSearchReadsLiveChannelCredentialsAndReportsMissingChannel(t *testing.T) {
	fixture, _ := newTimelineTaskTestService(t)
	s := NewLocal(fixture.repo, t.TempDir())
	defer s.Close()
	write := func(key string, enabled bool) {
		body, _ := json.Marshal(map[string]any{"channels": []any{map[string]any{"id": "ds", "name": "DeepSeek", "enabled": enabled, "apiFormat": "openai", "baseUrl": "https://api.deepseek.com/v1", "models": []string{"deepseek-chat"}, "apiKey": key}}})
		if err := s.SaveLocalModelConfig(body); err != nil {
			t.Fatal(err)
		}
	}
	write("channel-fixture-v1", true)
	settings, err := s.SaveAssistantWebSettings("owner", AssistantWebSettings{Enabled: true, Provider: "deepseek", CredentialSource: "channel", ChannelID: "ds"})
	if err != nil || !settings.Configured || settings.APIKey != "" || settings.BaseURL != agentweb.DeepSeekSearchBaseURL {
		t.Fatal(settings, err)
	}
	write("channel-fixture-v2", true)
	live, err := s.assistantWebSettings("owner")
	if err != nil || live.APIKey != "channel-fixture-v2" {
		t.Fatal("channel rotation not reflected", err)
	}
	write("channel-fixture-v2", false)
	public, err := s.AssistantWebSettings("owner")
	if err != nil || public.Configured || public.ConfigurationError == "" || public.APIKey != "" {
		t.Fatal("disabled channel hidden", public, err)
	}
	if _, err = s.assistantWebSettings("owner"); err == nil {
		t.Fatal("execution accepted disabled channel")
	}
	_, _ = s.SaveAssistantWebSettings("owner", AssistantWebSettings{Provider: "deepseek", CredentialSource: "channel", ChannelID: "gone"})
	public, _ = s.AssistantWebSettings("owner")
	if public.Configured || public.ConfigurationError == "" {
		t.Fatal("missing channel silently accepted")
	}
	for _, url := range []string{"https://user:secret@example.com/v1", "http://example.com/v1", "https://127.0.0.1/v1", "https://example.com/messages", "https://example.com/v1?key=secret"} {
		if _, err = s.SaveAssistantWebSettings("owner", AssistantWebSettings{Provider: "deepseek", BaseURL: url}); err == nil {
			t.Fatal("unsafe endpoint saved", url)
		}
	}
}
