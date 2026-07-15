package process

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
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
	if err != nil || n != 6 || b.String() != "abc" || !b.truncated {
		t.Fatalf("n=%d value=%q truncated=%t err=%v", n, b.String(), b.truncated, err)
	}
}

func TestRunnerReportsTruncatedOutput(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "codex")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf 'output-larger-than-limit'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	r := NewExecRunner()
	if err := r.SetPath(Codex, path); err != nil {
		t.Fatal(err)
	}
	result, err := r.Run(context.Background(), Command{Tool: Codex, MaxOutput: 8})
	if !errors.Is(err, ErrOutputLimitExceeded) {
		t.Fatalf("Run error=%v, want ErrOutputLimitExceeded", err)
	}
	if !strings.Contains(err.Error(), "codex stdout exceeded the 8-byte output limit") {
		t.Fatalf("Run error=%q does not describe truncation", err)
	}
	if got := string(result.Stdout); got != "output-l" {
		t.Fatalf("stdout=%q, want truncated prefix", got)
	}
}

func TestMinimalEnvironmentSeparatesCredentialsByTool(t *testing.T) {
	source := []string{"PATH=/bin", "GH_HOST=github.example.com", "GH_CONFIG_DIR=/tmp/gh", "GH_TOKEN=stale", "GITHUB_TOKEN=also-stale", "OPENAI_API_KEY=openai", "ANTHROPIC_API_KEY=anthropic", "CLAUDE_CONFIG_DIR=/tmp/claude", "UNRELATED=nope"}
	if got := minimalEnvironment(source, Git, "/safe/bin"); len(got) != 1 || got[0] != "PATH=/safe/bin" {
		t.Fatalf("git env leaked credentials: %v", got)
	}
	if got := minimalEnvironment(source, GH, "/safe/bin"); len(got) != 3 || got[0] != "GH_HOST=github.example.com" || got[1] != "GH_CONFIG_DIR=/tmp/gh" || got[2] != "PATH=/safe/bin" {
		t.Fatalf("unexpected gh env: %v", got)
	}
	if got := minimalEnvironment(source, Codex, "/safe/bin"); len(got) != 2 || got[0] != "OPENAI_API_KEY=openai" || got[1] != "PATH=/safe/bin" {
		t.Fatalf("unexpected codex env: %v", got)
	}
	if got := minimalEnvironment(source, Claude, "/safe/bin"); len(got) != 3 || got[0] != "ANTHROPIC_API_KEY=anthropic" || got[1] != "CLAUDE_CONFIG_DIR=/tmp/claude" || got[2] != "PATH=/safe/bin" {
		t.Fatalf("unexpected claude env: %v", got)
	}
}

func TestMinimalEnvironmentPreservesValidatedSSHAgentOnlyForGit(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "reviewarc-agent-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "agent.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	source := []string{"HOME=/Users/fixture", "SSH_AUTH_SOCK=" + socket}
	gitEnv := minimalEnvironment(source, Git, "/usr/bin:/bin")
	if !containsString(gitEnv, "SSH_AUTH_SOCK="+socket) {
		t.Fatalf("git environment lost SSH agent socket: %v", gitEnv)
	}
	for _, tool := range []Tool{GH, Codex, Claude} {
		if containsString(minimalEnvironment(source, tool, "/usr/bin:/bin"), "SSH_AUTH_SOCK="+socket) {
			t.Fatalf("%s environment inherited Git SSH agent socket", tool)
		}
	}
	if validSocket(filepath.Join(t.TempDir(), "missing.sock")) {
		t.Fatal("missing path accepted as an SSH agent socket")
	}
}

func TestResolveExecutableUsesAbsoluteExecutableFromSearchDirs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "gh")
	if err := os.WriteFile(path, []byte("fixture"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveExecutable(GH, []string{dir}); got != path {
		t.Fatalf("resolved path=%q, want %q", got, path)
	}
	if got := resolveExecutable(Tool("sh"), []string{dir}); got != "" {
		t.Fatalf("unknown tool resolved to %q", got)
	}
}

func TestResolveClaudeExecutableUsesAllowlist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	if err := os.WriteFile(path, []byte("fixture"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveExecutable(Claude, []string{dir}); got != path {
		t.Fatalf("resolved path=%q, want %q", got, path)
	}
}

func TestExecutableSearchDirsRejectsRelativeAndMissingPathEntries(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing")
	got := executableSearchDirs([]string{"PATH=relative:" + dir + ":" + missing}, "/Users/fixture")
	if got[0] != dir {
		t.Fatalf("search dirs=%v, want existing absolute PATH dir first", got)
	}
	joined := strings.Join(got, ":")
	if strings.Contains(joined, "relative") || strings.Contains(joined, missing) {
		t.Fatalf("unsafe or missing PATH entry retained: %v", got)
	}
	for _, want := range []string{"/opt/homebrew/bin", "/usr/local/bin", "/Users/fixture/.local/bin", "/Users/fixture/.local/share/mise/shims", "/usr/bin", "/bin"} {
		if !containsString(got, want) {
			t.Fatalf("search dirs missing %q: %v", want, got)
		}
	}
}

func TestExecutableSearchDirsIncludesInstalledNVMVersion(t *testing.T) {
	home := t.TempDir()
	nvmBin := filepath.Join(home, ".config", "nvm", "versions", "node", "v24.1.0", "bin")
	if err := os.MkdirAll(nvmBin, 0o755); err != nil {
		t.Fatal(err)
	}
	if !containsString(executableSearchDirs([]string{"PATH=/usr/bin:/bin"}, home), nvmBin) {
		t.Fatalf("nvm bin directory was not discovered: %s", nvmBin)
	}
}

func TestRefreshPathsDiscoversToolInstalledAfterRunnerStarts(t *testing.T) {
	dir := t.TempDir()
	runner := &ExecRunner{source: []string{"PATH=" + dir, "HOME=" + t.TempDir()}, home: t.TempDir()}
	runner.RefreshPaths()
	initial, _ := runner.ResolvedPath(GH)
	path := filepath.Join(dir, "gh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf 'gh version fixture\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	runner.RefreshPaths()
	resolved, err := runner.ResolvedPath(GH)
	if err != nil || resolved != path {
		t.Fatalf("refreshed path=(%q, %v), want %q", resolved, err, path)
	}
	if initial == path {
		t.Fatalf("tool path %q was resolved before it existed", path)
	}
}

func TestRunnerExecutesAbsoluteScriptWithSynthesizedPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "codex")
	if err := os.WriteFile(path, []byte("#!/usr/bin/env sh\nprintf 'codex fixture\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	r := NewExecRunner()
	if err := r.SetPath(Codex, path); err != nil {
		t.Fatal(err)
	}
	resolved, err := r.ResolvedPath(Codex)
	if err != nil || resolved != path {
		t.Fatalf("ResolvedPath()=(%q, %v), want %q", resolved, err, path)
	}
	got, err := r.Run(context.Background(), Command{Tool: Codex, Timeout: time.Second})
	if err != nil || string(got.Stdout) != "codex fixture\n" {
		t.Fatalf("Run stdout=%q err=%v", got.Stdout, err)
	}
}

func TestRunnerReportsMissingResolvedTool(t *testing.T) {
	r := NewExecRunner()
	r.mu.Lock()
	r.paths[GH] = ""
	r.mu.Unlock()
	if _, err := r.Run(context.Background(), Command{Tool: GH}); !errors.Is(err, ErrToolNotFound) {
		t.Fatalf("Run error=%v, want ErrToolNotFound", err)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
