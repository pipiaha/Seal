package agentweb

import (
	"context"
	"os"
	"testing"
	"time"
)

// Opt-in smoke for the desktop's real proxy/DNS route; no API keys or paid calls.
func TestDesktopDocumentationReadLive(t *testing.T) {
	raw := os.Getenv("SEAL_AGENT_WEB_SMOKE_URL")
	if raw == "" {
		t.Skip("set SEAL_AGENT_WEB_SMOKE_URL for a real public documentation request")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
	defer cancel()
	result, err := Read(ctx, raw, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	if text, _ := result["text"].(string); len(text) < 100 {
		t.Fatal("documentation did not produce readable text")
	}
	t.Log("public documentation read with source and nonempty text")
}
