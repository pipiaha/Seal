// Package mediareview inspects authorized local media with the bundled native tools.
package mediareview

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/editing"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Frame struct {
	Time     float64 `json:"time"`
	MimeType string  `json:"mimeType"`
	Data     string  `json:"data"`
}
type Info struct {
	DurationMs int64   `json:"durationMs"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	HasAudio   bool    `json:"hasAudio"`
	Frames     []Frame `json:"frames,omitempty"`
	Coverage   string  `json:"coverage,omitempty"`
}
type bounded struct {
	bytes.Buffer
	max int
}

func (b *bounded) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.max {
		return 0, errors.New("媒体工具输出超过限制")
	}
	return b.Buffer.Write(p)
}
func environment() []string {
	out := []string{}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA":
			out = append(out, entry)
		}
	}
	return out
}
func execute(ctx context.Context, tool string, args []string, max int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, tool, args...)
	cmd.Env = environment()
	out := &bounded{max: max}
	stderr := &bounded{max: 8192}
	cmd.Stdout = out
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("无法解析媒体，请确认文件有效且 FFmpeg 已安装")
	}
	return out.Bytes(), nil
}
func SampleTimes(duration float64, requested []float64, count int) ([]float64, error) {
	if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return nil, errors.New("媒体时长无效")
	}
	if len(requested) > 8 {
		return nil, errors.New("一次最多读取 8 个视频时间点")
	}
	if len(requested) > 0 {
		for _, t := range requested {
			if math.IsNaN(t) || math.IsInf(t, 0) || t < 0 || t >= duration {
				return nil, errors.New("视频时间点超出素材范围")
			}
		}
		return requested, nil
	}
	count = max(1, min(count, 8))
	result := make([]float64, count)
	last := math.Max(0, duration-0.05)
	for i := range result {
		if count > 1 {
			result[i] = last * float64(i) / float64(count-1)
		}
	}
	return result, nil
}
func Read(ctx context.Context, root string, source io.Reader, size int64, kind string, frames bool, times []float64, count int) (Info, error) {
	var result Info
	if size <= 0 || size > 512<<20 {
		return result, errors.New("媒体文件不能超过 512 MiB")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return result, err
	}
	dir, err := os.MkdirTemp(root, "read-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "media")
	output, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return result, err
	}
	written, copyErr := io.Copy(output, io.LimitReader(source, size+1))
	closeErr := output.Close()
	if copyErr != nil || closeErr != nil || written != size {
		return result, errors.New("素材读取不完整，请重新导入")
	}
	ffmpeg, err := editing.ResolveFFmpegBinary()
	if err != nil {
		return result, err
	}
	name := "ffprobe"
	if strings.HasSuffix(strings.ToLower(ffmpeg), ".exe") {
		name += ".exe"
	}
	ffprobe := filepath.Join(filepath.Dir(ffmpeg), name)
	if _, err := os.Stat(ffprobe); err != nil {
		ffprobe, err = exec.LookPath(name)
		if err != nil {
			return result, errors.New("媒体分析依赖 FFprobe 未安装")
		}
	}
	raw, err := execute(ctx, ffprobe, []string{"-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,width,height,duration,avg_frame_rate", "-of", "json", file}, 512<<10)
	if err != nil {
		return result, err
	}
	var probe struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			Type      string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
			Duration  string `json:"duration"`
			FrameRate string `json:"avg_frame_rate"`
		} `json:"streams"`
	}
	if json.Unmarshal(raw, &probe) != nil {
		return result, errors.New("媒体分析结果无效")
	}
	duration, _ := strconv.ParseFloat(probe.Format.Duration, 64)
	frameStep := 0.05
	for _, stream := range probe.Streams {
		if stream.Type == "audio" {
			result.HasAudio = true
		}
		if stream.Type == "video" {
			result.Width = stream.Width
			result.Height = stream.Height
			numerator, denominator, ok := strings.Cut(stream.FrameRate, "/")
			if ok {
				n, _ := strconv.ParseFloat(numerator, 64)
				d, _ := strconv.ParseFloat(denominator, 64)
				if n > 0 && d > 0 {
					frameStep = math.Max(frameStep, d/n)
				}
			}
		}
		if duration <= 0 {
			duration, _ = strconv.ParseFloat(stream.Duration, 64)
		}
	}
	result.DurationMs = int64(duration * 1000)
	if kind != "image" && (duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0)) {
		return result, errors.New("媒体时长无效")
	}
	if (kind == "video" || kind == "image") && result.Width <= 0 || kind == "audio" && !result.HasAudio {
		return result, errors.New("文件内容与素材类型不一致")
	}
	if !frames {
		return result, nil
	}
	if kind == "audio" {
		return result, errors.New("音频没有画面，请使用 ASR 转写")
	}
	if kind == "image" {
		times = []float64{0}
	} else {
		if len(times) == 0 {
			count = max(1, min(count, 8))
			times = make([]float64, count)
			last := math.Max(0, duration-frameStep)
			for i := range times {
				if count > 1 {
					times[i] = last * float64(i) / float64(count-1)
				}
			}
		}
		times, err = SampleTimes(duration, times, count)
		if err != nil {
			return result, err
		}
	}
	for _, t := range times {
		args := []string{"-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe"}
		if kind == "video" {
			args = append(args, "-ss", strconv.FormatFloat(t, 'f', 3, 64))
		}
		args = append(args, "-i", file, "-frames:v", "1", "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1")
		raw, err := execute(ctx, ffmpeg, args, 2<<20)
		if err != nil || len(raw) == 0 {
			return result, errors.New("视频画面解码失败，请换时间点重试")
		}
		result.Frames = append(result.Frames, Frame{Time: t, MimeType: "image/jpeg", Data: base64.StdEncoding.EncodeToString(raw)})
	}
	result.Coverage = "仅检查以上时间点的画面；抽样不能证明整段视频都已看过。声音需单独读取 ASR，ASR 也不代表已理解音乐和音效。"
	return result, nil
}
