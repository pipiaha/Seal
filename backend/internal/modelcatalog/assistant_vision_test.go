package modelcatalog

import (
	"encoding/json"
	"testing"
)

func TestAssistantVisionUsesSelectedProfileAndChangesFingerprint(t *testing.T) {
	var snapshot AssistantConfigSnapshot
	if err := json.Unmarshal([]byte(`{"assistantModel":"direct::vision","channels":[{"id":"direct","enabled":true,"baseUrl":"https://example.invalid/v1","apiKey":"fixture","models":["vision"],"modelProfiles":[{"model":"vision","capability":"text","protocol":"chat-completion","capabilityConfig":{"text":{"references":{"maxImages":12,"maxImageBytes":2097152}}}}]}]}`), &snapshot); err != nil {
		t.Fatal(err)
	}
	provider, err := ResolveAssistantProvider(snapshot, nil)
	if err != nil || provider.MaxImages != 8 || provider.MaxImageBytes != 2097152 {
		t.Fatalf("vision limits lost: %+v %v", provider, err)
	}
	before := provider.Fingerprint()
	provider.MaxImages = 0
	if provider.Fingerprint() == before {
		t.Fatal("vision changes do not refresh runtime")
	}
}
