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

func TestAssistantVisionDefaultsAndExplicitDisable(t *testing.T) {
	for _, tc := range []struct {
		name          string
		text          string
		images, bytes int
	}{
		{"missing config", `{}`, 8, 4 << 20},
		{"missing references", `{"contextWindow":200000}`, 8, 4 << 20},
		{"partial limits", `{"references":{"maxImages":3}}`, 3, 4 << 20},
		{"explicit disabled", `{"references":{"maxImages":0,"maxImageBytes":0}}`, 0, 0},
		{"disabled image count", `{"references":{"maxImages":0}}`, 0, 0},
		{"disabled image size", `{"references":{"maxImageBytes":0}}`, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var snapshot AssistantConfigSnapshot
			body := `{"assistantModel":"direct::vision","channels":[{"id":"direct","enabled":true,"baseUrl":"https://example.invalid/v1","apiKey":"fixture","models":["vision"],"modelProfiles":[{"model":"vision","capability":"text","protocol":"chat-completion","capabilityConfig":{"text":` + tc.text + `}}]}]}`
			if err := json.Unmarshal([]byte(body), &snapshot); err != nil {
				t.Fatal(err)
			}
			provider, err := ResolveAssistantProvider(snapshot, nil)
			if err != nil || provider.MaxImages != tc.images || provider.MaxImageBytes != tc.bytes {
				t.Fatalf("unexpected limits: images=%d bytes=%d error=%v", provider.MaxImages, provider.MaxImageBytes, err)
			}
		})
	}
}
