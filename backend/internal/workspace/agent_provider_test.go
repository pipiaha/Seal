package workspace

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

const agentTestScript = `{create:{method:"POST",path:"/generate",body:{model,prompt,params:images}},response:{result:"data.url"}}`

func TestAgentProviderSavePreservesCredentialsAndOtherModels(t *testing.T) {
	store, err := NewProviderConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"assistantModel":"test::text","channels":[{"id":"test","name":"Test","scope":"user","baseUrl":"https://example.com/v1","apiKey":"secret-fixture","secretKey":"secret-extra","headers":[{"name":"X-Tenant","value":"tenant-secret"}],"models":["text","image"],"modelProfiles":[{"model":"text","capability":"text","protocol":"chat-completion"},{"model":"image","capability":"image","protocol":"openai-image","capabilityConfig":{"image":{"count":1}}}]}]}`)
	if err = store.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	read, err := store.AgentProviderChannels()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(read)
	for _, secret := range []string{"secret-fixture", "secret-extra", "tenant-secret"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatal("channel read exposed saved credential")
		}
	}
	if !read["channels"].([]any)[0].(map[string]any)["hasApiKey"].(bool) {
		t.Fatal("credential readiness missing")
	}
	revision := read["revision"].(int64)
	edit := AgentProviderEdit{OperationID: strings.Repeat("a", 64), ExpectedRevision: &revision, ChannelID: "test", Capability: protocol.CapabilityImage, Model: "image", Script: agentTestScript, SetDefault: true}
	result, err := store.AgentProviderSave(t.Context(), edit)
	if err != nil {
		t.Fatal(err)
	}
	if result["needsCredential"] != false || result["revision"] != revision+1 {
		t.Fatalf("bad save result: %#v", result)
	}
	current, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	channel := current.Config["channels"].([]any)[0].(map[string]any)
	if channel["apiKey"] != "secret-fixture" || channel["secretKey"] != "secret-extra" || current.Config["assistantModel"] != "test::text" || current.Config["imageModel"] != "test::image" {
		t.Fatal("save replaced credentials or unrelated defaults")
	}
	profiles := channel["modelProfiles"].([]any)
	if profiles[0].(map[string]any)["protocol"] != "chat-completion" || profiles[1].(map[string]any)["capabilityConfig"] == nil {
		t.Fatal("save replaced unrelated model or capability settings")
	}
	replay, err := store.AgentProviderSave(t.Context(), edit)
	if err != nil || replay["replayed"] != true {
		t.Fatalf("identical replay failed: %#v %v", replay, err)
	}
	edit.Script = strings.ReplaceAll(agentTestScript, "/generate", "/other")
	if _, err = store.AgentProviderSave(t.Context(), edit); !errors.Is(err, ErrProviderConfigRevisionConflict) {
		t.Fatalf("overwrote concurrent edit: %v", err)
	}
	latest := current.Revision
	edit.ExpectedRevision = &latest
	edit.BaseURL = "https://foreign.example/v1"
	if _, err = store.AgentProviderSave(t.Context(), edit); err == nil {
		t.Fatal("forwarded existing key to a new host")
	}
	edit.BaseURL = ""
	edit.Model = "text"
	if _, err = store.AgentProviderSave(t.Context(), edit); err == nil {
		t.Fatal("overwrote assistant text model")
	}
}

func TestAgentProviderNewChannelReplayAndInvalidScript(t *testing.T) {
	store, err := NewProviderConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	revision := int64(0)
	edit := AgentProviderEdit{OperationID: strings.Repeat("b", 64), ExpectedRevision: &revision, Name: "New Video", BaseURL: "https://example.com/v1", Capability: protocol.CapabilityVideo, Model: "video-1", Script: agentTestScript}
	result, err := store.AgentProviderSave(t.Context(), edit)
	if err != nil {
		t.Fatal(err)
	}
	if result["needsCredential"] != true || result["generated"] != false {
		t.Fatal("new config incorrectly claims connected or generated")
	}
	if _, err = store.AgentProviderSave(t.Context(), edit); err != nil {
		t.Fatal(err)
	}
	current, _, _ := store.LoadEffectiveModelConfig()
	if len(current.Config["channels"].([]any)) != 1 || current.Revision != 1 {
		t.Fatal("replay created a duplicate channel")
	}
	edit.ExpectedRevision = &current.Revision
	edit.OperationID = strings.Repeat("c", 64)
	edit.Script = "{"
	if _, err = store.AgentProviderSave(t.Context(), edit); err == nil {
		t.Fatal("saved invalid JavaScript")
	}
	unchanged, _, _ := store.LoadEffectiveModelConfig()
	if unchanged.Revision != current.Revision {
		t.Fatal("invalid script changed config")
	}
	edit.Script = agentTestScript
	edit.BaseURL = "https://user:secret@example.com/v1"
	if _, err = store.AgentProviderSave(t.Context(), edit); err == nil {
		t.Fatal("accepted credentials in channel URL")
	}
}

func TestAgentProviderUserSuppliedKeyCreateRotateAndPreserve(t *testing.T) {
	store, err := NewProviderConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	revision := int64(0)
	firstKey := "synthetic-key-first"
	edit := AgentProviderEdit{OperationID: strings.Repeat("e", 64), ExpectedRevision: &revision, Name: "User supplied", BaseURL: "https://example.com/v1", Capability: protocol.CapabilityImage, Model: "image", Script: agentTestScript, APIKey: &firstKey}
	result, err := store.AgentProviderSave(t.Context(), edit)
	if err != nil {
		t.Fatal(err)
	}
	if result["needsCredential"] != false {
		t.Fatal("supplied key was not saved")
	}
	assertPrivate := func(key string) {
		t.Helper()
		for _, path := range []string{store.path(), store.backupPath()} {
			if body, err := os.ReadFile(path); err == nil && strings.Contains(string(body), key) {
				t.Fatal("key stored unencrypted")
			}
		}
		read, err := store.AgentProviderChannels()
		if err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(read)
		if strings.Contains(string(body), key) {
			t.Fatal("key exposed by channel tools")
		}
		body, _ = json.Marshal(result)
		if strings.Contains(string(body), key) {
			t.Fatal("key exposed by save result")
		}
	}
	assertPrivate(firstKey)
	if replay, err := store.AgentProviderSave(t.Context(), edit); err != nil || replay["replayed"] != true {
		t.Fatal("key submission replay failed", err)
	}
	secondKey := "synthetic-key-second"
	edit.APIKey = &secondKey
	if _, err = store.AgentProviderSave(t.Context(), edit); !errors.Is(err, ErrProviderConfigRevisionConflict) {
		t.Fatal("key change bypassed stale revision", err)
	}
	edit.ChannelID = result["channelId"].(string)
	revision = result["revision"].(int64)
	result, err = store.AgentProviderSave(t.Context(), edit)
	if err != nil {
		t.Fatal(err)
	}
	assertPrivate(secondKey)
	current, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	if current.Config["channels"].([]any)[0].(map[string]any)["apiKey"] != secondKey {
		t.Fatal("key rotation missing")
	}
	revision = current.Revision
	blank := " "
	edit.APIKey = &blank
	if _, err = store.AgentProviderSave(t.Context(), edit); err != nil {
		t.Fatal(err)
	}
	current, _, _ = store.LoadEffectiveModelConfig()
	if current.Config["channels"].([]any)[0].(map[string]any)["apiKey"] != secondKey {
		t.Fatal("empty input erased the key")
	}
	revision = current.Revision
	edit.APIKey = nil
	if _, err = store.AgentProviderSave(t.Context(), edit); err != nil {
		t.Fatal(err)
	}
	current, _, _ = store.LoadEffectiveModelConfig()
	if current.Config["channels"].([]any)[0].(map[string]any)["apiKey"] != secondKey {
		t.Fatal("omitted input erased the key")
	}
	revision = current.Revision
	invalid := "invalid\nkey"
	edit.APIKey = &invalid
	if _, err = store.AgentProviderSave(t.Context(), edit); err == nil {
		t.Fatal("accepted a multiline key")
	}
	edit.APIKey = &secondKey
	edit.Script = strings.Replace(agentTestScript, "body:{", `body:{key:"`+secondKey+`",`, 1)
	if _, err = store.AgentProviderSave(t.Context(), edit); err == nil {
		t.Fatal("accepted key embedded in JS")
	}
}
