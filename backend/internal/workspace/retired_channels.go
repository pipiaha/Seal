package workspace

import (
	"net/url"
	"strings"
)

// IsRetiredChannel recognizes the former built-in connection, not user URLs.
func IsRetiredChannel(id, credentialRef string) bool {
	return strings.TrimSpace(id) == "beefapi" || strings.TrimSpace(credentialRef) == "beefapi-enterprise"
}

// RemoveRetiredChannels runs on both read and save, including recovered backups.
func RemoveRetiredChannels(config map[string]any) {
	channels, _ := config["channels"].([]any)
	kept := make([]any, 0, len(channels))
	removed := map[string]bool{"beefapi": true}
	retiredModels := map[string]bool{}
	keptModels := map[string]bool{}
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := channel["id"].(string)
		ref, _ := channel["credentialRef"].(string)
		if IsRetiredChannel(id, ref) {
			if models, ok := channel["models"].([]any); ok {
				for _, raw := range models {
					if value, ok := raw.(string); ok {
						retiredModels[value] = true
					}
				}
			}
			removed[id] = true
			continue
		}
		kept = append(kept, channel)
		if models, ok := channel["models"].([]any); ok {
			for _, raw := range models {
				if value, ok := raw.(string); ok {
					keptModels[value] = true
				}
			}
		}
	}
	config["channels"] = kept
	required := map[string]bool{}
	if fields, ok := config["modelSelectionRequired"].([]any); ok {
		for _, raw := range fields {
			if field, ok := raw.(string); ok {
				required[field] = true
			}
		}
	}
	for _, field := range []string{"model", "imageModel", "videoModel", "textModel", "audioModel", "assistantModel"} {
		value, _ := config[field].(string)
		id, _, encoded := strings.Cut(value, "::")
		if encoded && removed[id] || !encoded && retiredModels[value] && !keptModels[value] {
			config[field] = ""
			required[field] = true
		} else if value != "" {
			delete(required, field)
		}
	}
	fields := []any{}
	for _, field := range []string{"model", "imageModel", "videoModel", "textModel", "audioModel", "assistantModel"} {
		if required[field] {
			fields = append(fields, field)
		}
	}
	config["modelSelectionRequired"] = fields
	if base, _ := config["baseUrl"].(string); base != "" {
		if parsed, err := url.Parse(base); err == nil && strings.EqualFold(parsed.Hostname(), "enterprise.beefapi.com") {
			config["baseUrl"] = ""
			config["apiKey"] = ""
		}
	}
	if ref, _ := config["credentialRef"].(string); ref == "beefapi-enterprise" {
		delete(config, "credentialRef")
		config["apiKey"] = ""
		config["baseUrl"] = ""
	}
}
