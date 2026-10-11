package callpayload

import (
	"strings"
	"testing"
)

func TestCallPayloadPreservesDiagnosticsWithoutCredentials(t *testing.T) {
	raw := `{"prompt":"cat","token":"raw-token","api_key":"raw-key","url":"https://user:pass@example.com/file?X-Amz-Credential=raw-credential&X-Amz-Signature=raw-signature&frame=3","image":"data:image/png;base64,raw-image","error":"Authorization=Bearer raw-bearer"}`
	safe := SanitizeAPICallPayload([]byte(raw), "application/json")
	for _, secret := range []string{"raw-token", "raw-key", "raw-credential", "raw-signature", "raw-image", "raw-bearer", "user:pass"} {
		if strings.Contains(safe, secret) {
			t.Fatalf("leaked %s in %s", secret, safe)
		}
	}
	for _, diagnostic := range []string{"cat", "example.com/file", "frame=3"} {
		if !strings.Contains(safe, diagnostic) {
			t.Fatalf("lost %s in %s", diagnostic, safe)
		}
	}
	url := SanitizeAPICallURL("https://example.com/tasks?a=1&token=private-token")
	if strings.Contains(url, "private-token") || !strings.Contains(url, "a=1") {
		t.Fatal(url)
	}
}
