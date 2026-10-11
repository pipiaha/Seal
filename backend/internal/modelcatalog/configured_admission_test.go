package modelcatalog

import "testing"

func TestConfiguredAnonymousProviderAdmission(t *testing.T) {
	for _, protocol := range []string{"custom-video", "comfyui-video"} {
		input := map[string]any{"mode": "video", "config": map[string]any{"model": "workflow", "baseUrl": "http://127.0.0.1:8188", "interfaceType": protocol, "authType": "none"}}
		if !HasExecutableVideoConfig(input) || !TaskInputUsesCustomChannel(input) {
			t.Fatalf("anonymous provider not admitted %s", protocol)
		}
		if _, err := SelectTaskModel(TaskSelectRequest{Input: input, FrontendEnabled: true}, TaskSelectLookup{}); err != nil {
			t.Fatal(err)
		}
	}
	input := map[string]any{"mode": "video", "config": map[string]any{"model": "workflow", "baseUrl": "https://example.com", "interfaceType": "newapi", "authType": "none"}}
	if TaskInputUsesCustomChannel(input) {
		t.Fatal("widened anonymous admission to unrelated protocols")
	}
}
