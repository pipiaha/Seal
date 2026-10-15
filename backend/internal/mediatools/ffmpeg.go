// Package mediatools resolves the desktop-owned native media runtime.
package mediatools

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const FFmpegPathEnv = "CANVAS_FFMPEG_PATH"

func ResolveFFmpeg() (string, error) {
	if configured := strings.TrimSpace(os.Getenv(FFmpegPathEnv)); configured != "" {
		return configured, nil
	}
	if entry := strings.TrimSpace(os.Getenv("BEEFTV_EDIT_HOST_ENTRY")); entry != "" {
		if bundled := sealFFmpeg(filepath.Dir(entry)); bundled != "" {
			return bundled, nil
		}
	}
	executable, err := os.Executable()
	if err == nil {
		if resolved, e := filepath.EvalSymlinks(executable); e == nil {
			executable = resolved
		}
		if bundled := bundledFFmpeg(executable); bundled != "" {
			return bundled, nil
		}
	}
	if path, err := exec.LookPath("ffmpeg"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("视频处理工具不可用，请重新安装应用")
}

func bundledFFmpeg(executable string) string {
	dir := filepath.Dir(executable)
	if filepath.Base(dir) == "cli" {
		dir = filepath.Dir(dir)
	}
	if bundled := sealFFmpeg(filepath.Join(dir, "edit-host")); bundled != "" {
		return bundled
	}
	for _, name := range []string{"ffmpeg.exe", "ffmpeg"} {
		candidate := filepath.Join(dir, "media-runtime", name)
		if info, err := os.Lstat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	return ""
}

func sealFFmpeg(hostRoot string) string {
	for _, name := range []string{"ffmpeg.exe", "ffmpeg"} {
		candidate := filepath.Join(hostRoot, "media", "ffmpeg", "bin", name)
		if info, err := os.Lstat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	return ""
}
