package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	"strings"
	"testing"
)

type assistantMediaFakeHost struct {
	data  json.RawMessage
	input json.RawMessage
}

func TestAssistantEditTranscriptionReusesImportedResourceAndRejectsWrongFile(t *testing.T) {
	t.Setenv("CANVAS_WHISPER_BASE_URL", "http://127.0.0.1:18080/asr")
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	wav := assistantTestWAV()
	resource, err := svc.UploadLocalResourceFile("owner", "speech.wav", int64(len(wav)), "audio", 0, 0, 25, bytes.NewReader(wav))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{&model.EditingProject{ID: "cut_bridge", UserID: "owner", Title: "Edit"}, &model.EditingAssetReference{ID: "pin", UserID: "owner", CanvasID: "cut_bridge", EditID: "edit", AssetID: "voice", ResourceID: resource.ID}} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	digest := sha256.Sum256(wav)
	encode := func(hash string) json.RawMessage {
		data, _ := json.Marshal(map[string]any{"code": 0, "data": map[string]any{"hasAudio": true, "source": map[string]string{"resourceId": resource.ID, "assetId": "voice", "sha256": hash}, "placements": []map[string]any{{"start": 3, "sourceStart": 0.1, "playbackRate": 1.5}}}})
		return data
	}
	host := &assistantMediaFakeHost{data: encode(hex.EncodeToString(digest[:]))}
	input := AssistantEditMediaRequest{File: "assets/speech.wav", Language: "zh", Route: "service"}
	first, info, err := svc.AssistantTranscribeEditMedia(context.Background(), "owner", "cut_bridge", "edit", input, host)
	if err != nil || !strings.Contains(string(info), "sourceStart") {
		t.Fatal("valid imported media failed", err)
	}
	second, _, err := svc.AssistantTranscribeEditMedia(context.Background(), "owner", "cut_bridge", "edit", input, host)
	if err != nil || second.ID != first.ID {
		t.Fatal("ASR resubmitted", err)
	}
	host.data = encode(strings.Repeat("0", 64))
	if _, _, err := svc.AssistantTranscribeEditMedia(context.Background(), "owner", "cut_bridge", "edit", input, host); err == nil {
		t.Fatal("wrong original file accepted")
	}
}

func (h *assistantMediaFakeHost) Call(_ context.Context, _, route string, body []byte) (json.RawMessage, int, error) {
	h.input = append([]byte(nil), body...)
	if !strings.Contains(route, "/media-info?projectId=cut_bridge") {
		panic("unexpected route")
	}
	return h.data, 200, nil
}

func TestAssistantEditTranscriptionRejectsUnpinnedAndSilentMedia(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	if err := db.Create(&model.EditingProject{ID: "cut_bridge", UserID: "owner", Title: "Edit"}).Error; err != nil {
		t.Fatal(err)
	}
	revision := int64(3)
	input := AssistantEditMediaRequest{File: "assets/video.mp4", ExpectedRevision: &revision}
	host := &assistantMediaFakeHost{data: json.RawMessage(`{"code":0,"data":{"hasAudio":true,"source":{"assetId":"forged","resourceId":"other"}}}`)}
	if _, _, err := svc.AssistantTranscribeEditMedia(context.Background(), "owner", "cut_bridge", "edit", input, host); err == nil || !strings.Contains(err.Error(), "已导入") {
		t.Fatal("forged HTML source bypassed pinned resource check", err)
	}
	var wire struct {
		Revision int64 `json:"expectedRevision"`
	}
	if json.Unmarshal(host.input, &wire) != nil || wire.Revision != 3 {
		t.Fatal("revision lost in runtime request")
	}
	host.data = json.RawMessage(`{"code":0,"data":{"hasAudio":false}}`)
	if _, _, err := svc.AssistantTranscribeEditMedia(context.Background(), "owner", "cut_bridge", "edit", input, host); err == nil {
		t.Fatal("silent clip started ASR")
	}
	if _, _, err := svc.AssistantTranscribeEditMedia(context.Background(), "foreign", "cut_bridge", "edit", input, host); err == nil {
		t.Fatal("foreign project accepted")
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 0 {
		t.Fatal("rejected requests created tasks")
	}
}
