package handler

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"infinite-canvas/backend/internal/assistant"
	"testing"
)

func TestAssistantImagesValidateActualPixelsAndModelLimits(t *testing.T) {
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewNRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	item := assistantImage{ID: "test-image", Name: "test.png", MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(buffer.Bytes())}
	provider := assistant.Provider{MaxImages: 2, MaxImageBytes: 4096}
	if err := validateAssistantImages([]assistantImage{item}, provider); err != nil {
		t.Fatal(err)
	}
	if validateAssistantImages([]assistantImage{item}, assistant.Provider{}) == nil {
		t.Fatal("text-only model accepted pixels")
	}
	if validateAssistantImages([]assistantImage{item, item}, provider) == nil {
		t.Fatal("duplicate attachment accepted")
	}
	provider.MaxImageBytes = 1
	if validateAssistantImages([]assistantImage{item}, provider) == nil {
		t.Fatal("oversized image accepted")
	}
	provider.MaxImageBytes = 4096
	item.MimeType = "image/jpeg"
	if validateAssistantImages([]assistantImage{item}, provider) == nil {
		t.Fatal("spoofed MIME accepted")
	}
	item.MimeType = "image/png"
	item.Data = base64.StdEncoding.EncodeToString([]byte("not an image"))
	if validateAssistantImages([]assistantImage{item}, provider) == nil {
		t.Fatal("invalid pixels accepted")
	}
}
