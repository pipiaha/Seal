//go:build !windows && !darwin && !linux

package agentworkspace

import (
	"context"
	"errors"
	"io"
)

func runLocalProcess(context.Context, string, string, []string, []string, io.Writer) (int, error) {
	return -1, errors.New("process_runtime_unsupported")
}
