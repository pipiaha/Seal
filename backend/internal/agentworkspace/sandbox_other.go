//go:build !windows

package agentworkspace

import (
	"context"
	"errors"
	"io"
	"os"
)

func sandboxAvailable() bool       { return false }
func isLink(info os.FileInfo) bool { return info.Mode()&os.ModeSymlink != 0 }
func runSandbox(context.Context, string, string, []string, []string, io.Writer) (int, error) {
	return -1, errors.New("sandbox_unavailable: this platform has no configured script sandbox")
}
