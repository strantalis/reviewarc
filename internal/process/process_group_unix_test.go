//go:build darwin || linux

package process

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestRunnerCancellationKillsDescendantProcess(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	pidFile := t.TempDir() + "/child.pid"
	runner := NewExecRunner()
	if err := runner.SetPath(Codex, executable); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, runErr := runner.Run(ctx, Command{Tool: Codex, Args: []string{"-test.run=TestProcessGroupHelper", "--", pidFile}, Timeout: 10 * time.Second})
		done <- runErr
	}()

	var childPID int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if value, readErr := os.ReadFile(pidFile); readErr == nil {
			childPID, err = strconv.Atoi(string(value))
			if err == nil {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if childPID == 0 {
		t.Fatal("helper descendant did not start")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error=%v, want context.Canceled", err)
	}
	reapDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(reapDeadline) {
		if err := syscall.Kill(childPID, 0); errors.Is(err, syscall.ESRCH) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("descendant process %d survived cancellation", childPID)
}

func TestProcessGroupHelper(_ *testing.T) {
	if len(os.Args) < 2 || os.Args[len(os.Args)-2] != "--" {
		return
	}
	child := exec.CommandContext(context.Background(), "sleep", "30")
	if err := child.Start(); err != nil {
		os.Exit(2)
	}
	if err := os.WriteFile(os.Args[len(os.Args)-1], []byte(strconv.Itoa(child.Process.Pid)), 0o600); err != nil {
		os.Exit(3)
	}
	_ = child.Wait()
	os.Exit(0)
}
