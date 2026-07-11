//go:build darwin || linux

package process

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

// configureCancellation gives each allowed external command its own process
// group. Cancelling the context then terminates wrappers and descendants
// together, which matters for Node-distributed CLIs such as Codex.
func configureCancellation(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = 2 * time.Second
}
