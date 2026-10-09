package mediareview

import (
	"bytes"
	"context"
	"encoding/base64"
	"infinite-canvas/backend/internal/editing"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSampleTimesBounds(t *testing.T) {
	times, err := SampleTimes(2, nil, 3)
	if err != nil || len(times) != 3 || times[0] != 0 || times[2] >= 2 || times[1] <= 0 {
		t.Fatalf("times=%v err=%v", times, err)
	}
	for _, invalid := range []float64{-1, 2, math.NaN(), math.Inf(1)} {
		if _, err := SampleTimes(2, []float64{invalid}, 3); err == nil {
			t.Fatal("invalid frame time accepted", invalid)
		}
	}
	explicit, err := SampleTimes(2, []float64{0.2, 1.8}, 1)
	if err != nil || len(explicit) != 2 {
		t.Fatal("explicit times were silently truncated")
	}
}

func TestActualVideoAudioInspection(t *testing.T) {
	if os.Getenv("SEAL_MEDIA_READ_TEST") != "1" {
		t.Skip("requires bundled FFmpeg")
	}
	ffmpeg, err := editing.ResolveFFmpegBinary()
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "sample.mp4")
	cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", file)
	if data, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v %s", err, data)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	read := func(kind string, frames bool, times []float64) (Info, error) {
		return Read(context.Background(), root, bytes.NewReader(data), int64(len(data)), kind, frames, times, 3)
	}
	info, err := read("video", true, nil)
	if err != nil || info.DurationMs < 900 || info.Width != 160 || !info.HasAudio || len(info.Frames) != 3 {
		t.Fatalf("duration=%d size=%dx%d audio=%v frameCount=%d err=%v", info.DurationMs, info.Width, info.Height, info.HasAudio, len(info.Frames), err)
	}
	for i, frame := range info.Frames {
		pixels, err := base64.StdEncoding.DecodeString(frame.Data)
		if err != nil || len(pixels) < 2 || pixels[0] != 0xff || pixels[1] != 0xd8 {
			t.Fatal("not real JPEG pixels")
		}
		if i > 0 && frame.Time <= info.Frames[i-1].Time {
			t.Fatal("timestamps did not advance")
		}
	}
	audio, err := read("audio", false, nil)
	if err != nil || !audio.HasAudio || len(audio.Frames) != 0 {
		t.Fatal("audio metadata failed", err)
	}
	if _, err := read("audio", true, nil); err == nil {
		t.Fatal("audio falsely produced an image")
	}
	if _, err := read("video", true, []float64{100}); err == nil {
		t.Fatal("out of bounds time accepted")
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatal("inspection tempfiles leaked")
	}
	actual, _ := os.ReadFile(file)
	if !bytes.Equal(actual, data) {
		t.Fatal("original media modified")
	}
}
