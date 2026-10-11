//go:build darwin || linux

package agentworkspace

import (
	"context"
	"io"
	"os/exec"
	"syscall"
	"time"
)

func runLocalProcess(ctx context.Context, root, executable string, args, env []string, output io.Writer) (int, error) {
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Dir, cmd.Env = root, env
	cmd.Stdout, cmd.Stderr = output, output
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
	if err := cmd.Start(); err != nil {
		return -1, err
	}
	defer syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	err := cmd.Wait()
	if ctx.Err() != nil {
		return -1, ctx.Err()
	}
	return cmd.ProcessState.ExitCode(), err
}
