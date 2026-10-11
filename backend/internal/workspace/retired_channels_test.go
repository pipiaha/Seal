package workspace

import (
	"encoding/json"
	"testing"
)

func TestRemoveRetiredChannelRequiresExplicitReselection(t *testing.T) {
	var config map[string]any
	if err := json.Unmarshal([]byte(`{"channels":[{"id":"beefapi","credentialRef":"beefapi-enterprise"},{"id":"own","baseUrl":"https://example.com"}],"videoModel":"beefapi::old-video","textModel":"own::text","assistantModel":"beefapi::old-text"}`), &config); err != nil {
		t.Fatal(err)
	}
	RemoveRetiredChannels(config)
	if len(config["channels"].([]any)) != 1 || config["videoModel"] != "" || config["assistantModel"] != "" || config["textModel"] != "own::text" {
		t.Fatalf("config: %+v", config)
	}
	RemoveRetiredChannels(config)
	if len(config["modelSelectionRequired"].([]any)) != 2 {
		t.Fatalf("required selections lost: %+v", config)
	}
	config["videoModel"] = "own::new-video"
	RemoveRetiredChannels(config)
	if len(config["modelSelectionRequired"].([]any)) != 1 {
		t.Fatalf("explicit selection not accepted: %+v", config)
	}
}
