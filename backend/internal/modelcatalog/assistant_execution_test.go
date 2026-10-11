package modelcatalog

import (
	"encoding/json"
	"testing"
)

func TestAssistantExecutionConfigResolvesLimitsAndFingerprint(t *testing.T) {
	var snapshot AssistantConfigSnapshot
	if err := json.Unmarshal([]byte(`{"assistantModel":"direct::deepseek-flash","channels":[{"id":"direct","enabled":true,"baseUrl":"https://example.invalid/v1","apiKey":"fixture","models":["deepseek-flash"],"modelProfiles":[{"model":"deepseek-flash","capability":"text","protocol":"chat-completion","capabilityConfig":{"text":{"maxOutputTokens":49152,"outputTokenLimit":32768,"contextWindow":131072,"reasoningFormat":"deepseek","reasoningEffort":"high","reasoningLevels":["off","low","high","max"]}}}]}]}`), &snapshot); err != nil {
		t.Fatal(err)
	}
	provider, err := ResolveAssistantProvider(snapshot, nil)
	if err != nil || provider.MaxOutputTokens != 32768 || provider.ContextWindow != 131072 || provider.ReasoningEffort != "high" || len(provider.ReasoningLevels) != 4 {
		t.Fatalf("execution settings lost: %+v %v", provider, err)
	}
	before := provider.Fingerprint()
	provider.ReasoningEffort = "low"
	if provider.Fingerprint() == before {
		t.Fatal("effort did not refresh runtime")
	}
	snapshot.Channels[0].ModelProfiles[0].CapabilityConfig.Text.MaxOutputTokens = -1
	if _, reason := ResolveAssistantChannelModel(snapshot, snapshot.AssistantModel, nil); reason != AssistantReasonParametersInvalid {
		t.Fatalf("invalid budget accepted: %s", reason)
	}
}
