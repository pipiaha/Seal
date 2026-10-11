package comfyui

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestComfyClientRejectsCrossOriginRedirectAndCredentials(t *testing.T) {
	hits := 0
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits++ }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer source.Close()
	client, err := HTTPClient(source.URL, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	if _, err := client.Get(source.URL); err == nil {
		t.Fatal("accepted cross-origin redirect")
	}
	if hits != 0 {
		t.Fatal("followed redirect")
	}
	for _, value := range []string{"file:///tmp/workflow", "http://key:secret@localhost:8188", "http://127.0.0.1:8188?key=secret"} {
		if _, err := ValidateURL(value); err == nil {
			t.Fatalf("accepted unsafe config %s", value)
		}
	}
}
