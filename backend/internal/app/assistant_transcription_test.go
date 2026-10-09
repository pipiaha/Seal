package app

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/transcription"
	"os"
	"strings"
	"testing"
)

func assistantTestWAV() []byte {
	wav := make([]byte, 844)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], 836)
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 16000)
	binary.LittleEndian.PutUint32(wav[28:], 32000)
	binary.LittleEndian.PutUint16(wav[32:], 2)
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], 800)
	return wav
}

func TestAssistantTranscriptionKeepsIndependentEditAndReusesTask(t *testing.T) {
	t.Setenv("CANVAS_WHISPER_BASE_URL", "http://127.0.0.1:18080/asr")
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	project := model.EditingProject{ID: "cut_asr", UserID: "owner", Title: "Independent edit"}
	wav := assistantTestWAV()
	resource, err := svc.UploadLocalResourceFile("owner", "speech.wav", int64(len(wav)), "audio", 0, 0, 25, bytes.NewReader(wav))
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"data": map[string]string{"storageKey": "resource:" + resource.ID}})
	asset := model.Asset{ID: "voice", UserID: "owner", Kind: "audio", Status: model.AssetVersionStatusConfirmed, PayloadJSON: string(payload)}
	for _, value := range []any{&project, &asset} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	first, err := svc.AssistantTranscribeAsset("owner", project.ID, asset.ID, "zh", "service")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.AssistantTranscribeAsset("owner", project.ID, asset.ID, "zh", "service")
	if err != nil || second.ID != first.ID {
		t.Fatal("repeated ASR created another task", err)
	}
	if first.ProjectID != project.ID || first.Type != model.TaskTypeTimelineTranscription {
		t.Fatal("wrong edit scope")
	}
	if _, err := svc.AssistantTranscribeAsset("other", project.ID, asset.ID, "zh", "service"); err == nil {
		t.Fatal("foreign project accepted")
	}
	var count int64
	if err := db.Model(&model.CanvasProject{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("transcription created a hidden canvas", err)
	}
}

func TestAssistantLocalASRActualAssetSurvivesReopen(t *testing.T) {
	file := os.Getenv("BEEFTV_TEST_ASR_SAMPLE")
	if file == "" || !transcription.LocalAvailable() {
		t.Skip("requires the pinned local model/runtime and real speech sample")
	}
	t.Setenv("CANVAS_WHISPER_BASE_URL", "")
	if entry := os.Getenv("BEEFTV_TEST_SHIPPED_EDIT_ENTRY"); entry != "" {
		t.Setenv("BEEFTV_EDIT_HOST_ENTRY", entry)
		t.Setenv("PATH", "")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	svc, db := openDBRuntimeMatrix(t, dir)
	defer func() { closeDBRuntimeMatrix(t, svc, db) }()
	if err := db.Create(&model.EditingProject{ID: "cut_offline_asr", UserID: "local", Title: "ASR"}).Error; err != nil {
		t.Fatal(err)
	}
	resource, err := svc.UploadLocalResourceFile("local", "speech.wav", int64(len(data)), "audio", 0, 0, 11000, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"data": map[string]any{"storageKey": "resource:" + resource.ID}})
	asset := model.Asset{ID: "offline-speech", UserID: "local", Kind: "audio", Status: model.AssetVersionStatusConfirmed, PayloadJSON: string(payload)}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	task, err := svc.AssistantTranscribeAsset("local", "cut_offline_asr", asset.ID, "en", "local")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.taskWorker().processNextTask(); err != nil {
		t.Fatal(err)
	}
	closeDBRuntimeMatrix(t, svc, db)
	svc, db = openDBRuntimeMatrix(t, dir)
	reused, err := svc.AssistantTranscribeAsset("local", "cut_offline_asr", asset.ID, "en", "local")
	if err != nil || reused.ID != task.ID || reused.Status != model.TaskStatusSucceeded {
		t.Fatalf("recovery=%+v err=%v", reused, err)
	}
	var result transcription.Result
	if err := json.Unmarshal([]byte(reused.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	if result.TimingLevel != "token" || !strings.Contains(strings.ToLower(reused.ResultJSON), "country") || result.SRT == "" {
		t.Fatal("real transcript/timestamps not persisted")
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("offline ASR was submitted twice", err)
	}
}
