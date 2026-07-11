package process

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRunnerRejectsUnknownToolsAndNULArguments(t *testing.T) {
	r := NewExecRunner()
	if _, err := r.Run(context.Background(), Command{Tool: "sh", Args: []string{"-c", "echo unsafe"}}); err == nil {
		t.Fatal("unknown executable was accepted")
	}
	if _, err := r.Run(context.Background(), Command{Tool: Git, Args: []string{"status\x00--short"}}); err == nil {
		t.Fatal("NUL argument was accepted")
	}
	if _, err := r.Run(context.Background(), Command{Tool: Git, Dir: "bad\x00dir"}); err == nil {
		t.Fatal("NUL working directory was accepted")
	}
}

func TestSetPathRejectsUnknownToolsEmptyAndNULPaths(t *testing.T) {
	r := NewExecRunner()
	for _, test := range []struct {
		tool Tool
		path string
	}{
		{tool: Tool("shell"), path: "/bin/sh"},
		{tool: Git, path: ""},
		{tool: Git, path: "/tmp/git\x00evil"},
	} {
		if err := r.SetPath(test.tool, test.path); err == nil {
			t.Fatalf("SetPath(%q, %q) succeeded", test.tool, test.path)
		}
	}
}

func TestRunnerStreamsCompleteStdoutLines(t *testing.T) {
	r := NewExecRunner()
	var lines []string
	got, err := r.Run(context.Background(), Command{
		Tool: Git, Args: []string{"--version"}, Timeout: time.Second,
		OnStdoutLine: func(line []byte) { lines = append(lines, string(line)) },
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(lines) != 1 || !strings.HasPrefix(lines[0], "git version ") {
		t.Fatalf("streamed lines=%q stdout=%q", lines, got.Stdout)
	}
}

func TestRunnerCapturesOutputAndExit(t *testing.T) {
	r := NewExecRunner()
	got, err := r.Run(context.Background(), Command{Tool: Git, Args: []string{"--version"}, Timeout: time.Second})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got.ExitCode != 0 || len(got.Stdout) == 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestRunnerHonorsCancellation(t *testing.T) {
	r := NewExecRunner()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := r.Run(ctx, Command{Tool: Git, Args: []string{"--version"}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}

func TestLimitedBufferCapsButReportsConsumedBytes(t *testing.T) {
	b := limitedBuffer{limit: 3}
	n, err := b.Write([]byte("abcdef"))
	if err != nil || n != 6 || b.String() != "abc" {
		t.Fatalf("n=%d value=%q err=%v", n, b.String(), err)
	}
}

func TestMinimalEnvironmentSeparatesCredentialsByTool(t *testing.T) {
	source := []string{"PATH=/bin", "GH_TOKEN=github", "OPENAI_API_KEY=openai", "UNRELATED=nope"}
	if got := minimalEnvironment(source, Git); len(got) != 1 {
		t.Fatalf("git env leaked credentials: %v", got)
	}
	if got := minimalEnvironment(source, GH); len(got) != 2 || got[1] != "GH_TOKEN=github" {
		t.Fatalf("unexpected gh env: %v", got)
	}
	if got := minimalEnvironment(source, Codex); len(got) != 2 || got[1] != "OPENAI_API_KEY=openai" {
		t.Fatalf("unexpected codex env: %v", got)
	}
}
