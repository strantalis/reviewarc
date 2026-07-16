package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"reviewarc/internal/agent"
	"reviewarc/internal/agent/claude"
	"reviewarc/internal/agent/codex"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	githubclient "reviewarc/internal/github"
	"reviewarc/internal/persistence"
	proc "reviewarc/internal/process"
)

type analysisFlowRunner struct {
	base     proc.Runner
	harness  domain.HarnessID
	payload  []byte
	mu       sync.Mutex
	commands []proc.Command
}

func (r *analysisFlowRunner) Run(ctx context.Context, command proc.Command) (proc.Result, error) {
	r.mu.Lock()
	r.commands = append(r.commands, command)
	r.mu.Unlock()
	switch command.Tool {
	case proc.Git:
		return r.base.Run(ctx, command)
	case proc.GH:
		endpoint := command.Args[len(command.Args)-1]
		if strings.Contains(endpoint, "/check-runs") {
			return proc.Result{Stdout: []byte(`[{"check_runs":[]}]`)}, nil
		}
		return proc.Result{Stdout: []byte(`[[]]`)}, nil
	case proc.Codex:
		return r.codex(command)
	case proc.Claude:
		return r.claude(command)
	default:
		return proc.Result{}, fmt.Errorf("unexpected tool %q", command.Tool)
	}
}

func (r *analysisFlowRunner) codex(command proc.Command) (proc.Result, error) {
	if len(command.Args) == 1 && command.Args[0] == "--version" {
		return proc.Result{Stdout: []byte("codex-cli e2e\n")}, nil
	}
	if len(command.Args) == 2 && command.Args[0] == "login" && command.Args[1] == "status" {
		return proc.Result{Stdout: []byte("Logged in using ChatGPT\n")}, nil
	}
	if len(command.Args) >= 2 && command.Args[0] == "debug" && command.Args[1] == "models" {
		return proc.Result{Stdout: []byte(`{"models":[{"slug":"fixture","display_name":"Fixture","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"medium"}],"shell_type":"shell_command"}]}`)}, nil
	}
	inventory, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{
		"id": "inventory-1", "type": "mcp_tool_call", "server": "reviewarc", "tool": "list_changes", "status": "completed",
		"arguments": map[string]any{"cursor": 0}, "result": map[string]any{"changes": []any{map[string]any{"id": "f000001"}, map[string]any{"id": "f000002"}}, "hasMore": false},
	}})
	tool, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{
		"id": "tool-1", "type": "mcp_tool_call", "server": "reviewarc", "tool": "read_diff", "status": "completed",
		"arguments": map[string]any{"fileId": "f000001", "cursor": 0}, "result": map[string]any{"bytes": 1 << 20, "hasMore": false},
	}})
	omission, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{
		"id": "omission-1", "type": "mcp_tool_call", "server": "reviewarc", "tool": "explain_diff_omissions", "status": "completed",
		"arguments": map[string]any{"decisions": []any{map[string]any{"fileId": "f000002", "category": "example_or_test", "reason": "Test-only change does not affect shipped runtime behavior."}}},
		"result":    map[string]any{"recorded": 1, "ignored": 0, "decisions": []any{map[string]any{"fileId": "f000002", "category": "example_or_test", "reason": "Test-only change does not affect shipped runtime behavior."}}},
	}})
	message, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{"id": "message-1", "type": "agent_message", "text": string(r.payload)}})
	return streamedResult(command, bytes.Join([][]byte{[]byte(`{"type":"thread.started","thread_id":"e2e"}`), inventory, tool, omission, message, nil}, []byte("\n"))), nil
}

func (r *analysisFlowRunner) claude(command proc.Command) (proc.Result, error) {
	if len(command.Args) == 1 && command.Args[0] == "--version" {
		return proc.Result{Stdout: []byte("2.1.210 (Claude Code)\n")}, nil
	}
	if len(command.Args) == 1 && command.Args[0] == "--help" {
		return proc.Result{Stdout: []byte("--print\n--output-format\n--verbose\n--include-partial-messages\n--json-schema\n--model\n--effort\n--permission-mode\n--strict-mcp-config\n--mcp-config\n--setting-sources\n--disable-slash-commands\n--no-chrome\n--no-session-persistence\n--tools\n--allowedTools\n--system-prompt\n")}, nil
	}
	if len(command.Args) == 2 && command.Args[0] == "auth" && command.Args[1] == "status" {
		return proc.Result{Stdout: []byte(`{"loggedIn":true,"authMethod":"oauth"}`)}, nil
	}
	inventoryUse, _ := json.Marshal(map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_use", "id": "inventory-1", "name": "mcp__reviewarc__list_changes", "input": map[string]any{"cursor": 0},
	}}}})
	inventoryResult, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_result", "tool_use_id": "inventory-1", "content": map[string]any{"changes": []any{map[string]any{"id": "f000001"}, map[string]any{"id": "f000002"}}, "hasMore": false},
	}}}})
	toolUse, _ := json.Marshal(map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_use", "id": "tool-1", "name": "mcp__reviewarc__read_diff", "input": map[string]any{"fileId": "f000001", "cursor": 0},
	}}}})
	toolResult, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_result", "tool_use_id": "tool-1", "content": map[string]any{"bytes": 1 << 20, "hasMore": false},
	}}}})
	omissionUse, _ := json.Marshal(map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_use", "id": "omission-1", "name": "mcp__reviewarc__explain_diff_omissions", "input": map[string]any{"decisions": []any{map[string]any{"fileId": "f000002", "category": "example_or_test", "reason": "Test-only change does not affect shipped runtime behavior."}}},
	}}}})
	omissionResult, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_result", "tool_use_id": "omission-1", "content": map[string]any{"recorded": 1, "ignored": 0, "decisions": []any{map[string]any{"fileId": "f000002", "category": "example_or_test", "reason": "Test-only change does not affect shipped runtime behavior."}}},
	}}}})
	var structured any
	if err := json.Unmarshal(r.payload, &structured); err != nil {
		return proc.Result{}, err
	}
	structuredOutput, _ := json.Marshal(map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_use", "id": "structured-1", "name": "StructuredOutput", "input": structured,
	}}}})
	result := []byte(`{"type":"result","subtype":"success","is_error":false}`)
	return streamedResult(command, bytes.Join([][]byte{inventoryUse, inventoryResult, toolUse, toolResult, omissionUse, omissionResult, structuredOutput, result, nil}, []byte("\n"))), nil
}

func streamedResult(command proc.Command, stdout []byte) proc.Result {
	if command.OnStdoutLine != nil {
		for _, line := range bytes.Split(stdout, []byte("\n")) {
			if len(line) > 0 {
				command.OnStdoutLine(line)
			}
		}
	}
	return proc.Result{Stdout: stdout}
}

func TestAnalysisFlowEndToEndAcrossHarnesses(t *testing.T) {
	for _, harness := range []domain.HarnessID{domain.HarnessCodex, domain.HarnessClaude} {
		t.Run(string(harness), func(t *testing.T) {
			baseSHA, headSHA, remote := analysisRemoteFixture(t)
			payload := analysisFlowPayload(t, baseSHA, headSHA)
			root := t.TempDir()
			paths := domain.AppPaths{Root: root, Repositories: filepath.Join(root, "repositories"), Worktrees: filepath.Join(root, "worktrees"), Database: filepath.Join(root, "reviewarc.db")}
			store, err := persistence.Open(paths.Database)
			if err != nil {
				t.Fatal(err)
			}
			runner := &analysisFlowRunner{base: proc.NewExecRunner(), harness: harness, payload: payload}
			manager := gitcache.NewManager(paths.Repositories, paths.Worktrees, runner, gitcache.Options{RemoteURL: func(domain.RepositoryRef) string { return remote }})
			var adapter agent.HarnessAdapter
			if harness == domain.HarnessCodex {
				adapter = codex.New(runner, codex.Config{Timeout: 10 * time.Second, ContextServerExecutable: "/usr/bin/true"})
			} else {
				adapter = claude.New(runner, claude.Config{Timeout: 10 * time.Second, ContextServerExecutable: "/usr/bin/true"})
			}
			registry, err := agent.NewRegistry(adapter)
			if err != nil {
				t.Fatal(err)
			}
			profile := domain.AnalysisProfile{Harness: harness, Model: "fixture", Reasoning: domain.ReasoningMedium}
			if harness == domain.HarnessClaude {
				profile.Model = "sonnet"
			}
			ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
			pr := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 7}, Title: "Greeting change", BaseSHA: baseSHA, HeadSHA: headSHA}, BaseRef: "main", HeadRef: "feature", HeadRepository: ref}
			session := domain.ReviewSession{ID: "analysis-" + string(harness), PullRequest: pr, BaseSHA: baseSHA, HeadSHA: headSHA, Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
			if err := store.SaveSession(context.Background(), session); err != nil {
				t.Fatal(err)
			}
			app := &App{paths: paths, github: githubclient.New(runner), store: store, repos: manager, runner: runner, harnesses: registry, prepared: newPreparedReviewCache(0, 0, 0), active: map[string]context.CancelFunc{}, analysisBySession: map[string]string{}}
			if _, err := app.StartAnalysisWithProfile(session.ID, AnalysisRequest{Profile: &profile}); err != nil {
				t.Fatal(err)
			}
			completed := waitForAnalysisSession(t, store, session.ID)
			waitForAnalysisIdle(t, app, session.ID)
			if completed.Analysis == nil || completed.Analysis.Summary != "Changes greeting behavior." || len(completed.Analysis.Chapters) != 1 {
				t.Fatalf("analysis=%+v", completed.Analysis)
			}
			if completed.LatestAnalysisRun == nil || completed.LatestAnalysisRun.Status != domain.AnalysisRunCompleted || completed.LatestAnalysisRun.Profile.Harness != harness || completed.LatestAnalysisRun.Coverage.DiffFilesFullyRead != 1 || completed.LatestAnalysisRun.Coverage.DiffFilesPreviewed != 1 || len(completed.LatestAnalysisRun.Coverage.PreviewDecisions) != 1 || completed.LatestAnalysisRun.Coverage.PreviewDecisions[0].Path != "src/greet_test.go" {
				t.Fatalf("run=%+v", completed.LatestAnalysisRun)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := persistence.Open(paths.Database)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = reopened.Close() })
			reloaded, err := reopened.GetSession(context.Background(), session.ID)
			if err != nil || reloaded.Analysis == nil || reloaded.LatestAnalysisRun == nil || reloaded.LatestAnalysisRun.Status != domain.AnalysisRunCompleted || len(reloaded.LatestAnalysisRun.Coverage.PreviewDecisions) != 1 || reloaded.LatestAnalysisRun.Coverage.PreviewDecisions[0].Reason != "Test-only change does not affect shipped runtime behavior." {
				t.Fatalf("reloaded=%+v err=%v", reloaded, err)
			}
		})
	}
}

func waitForAnalysisIdle(t *testing.T, app *App, sessionID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		app.mu.RLock()
		_, active := app.analysisBySession[sessionID]
		app.mu.RUnlock()
		if !active {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("analysis operation did not release its session lock")
		}
		time.Sleep(time.Millisecond)
	}
}

func waitForAnalysisSession(t *testing.T, store *persistence.Store, sessionID string) domain.ReviewSession {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		session, err := store.GetSession(context.Background(), sessionID)
		if err != nil {
			t.Fatal(err)
		}
		if session.AnalysisStatus == domain.AnalysisReady {
			return session
		}
		if session.AnalysisStatus == domain.AnalysisFailed {
			t.Fatalf("analysis failed: %+v", session.LatestAnalysisRun)
		}
		if time.Now().After(deadline) {
			t.Fatalf("analysis timed out: %+v", session.LatestAnalysisRun)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func analysisFlowPayload(t *testing.T, baseSHA, headSHA string) []byte {
	t.Helper()
	payload, err := os.ReadFile("internal/agent/codex/testdata/analysis.json")
	if err != nil {
		t.Fatal(err)
	}
	payload = bytes.ReplaceAll(payload, []byte(strings.Repeat("1", 40)), []byte(baseSHA))
	payload = bytes.ReplaceAll(payload, []byte(strings.Repeat("2", 40)), []byte(headSHA))
	payload = bytes.ReplaceAll(payload, []byte(`"fact-chapter"`), []byte(`"f1"`))
	payload = bytes.ReplaceAll(payload, []byte(`"fact-valid"`), []byte(`"f1"`))
	return payload
}

func analysisRemoteFixture(t *testing.T) (string, string, string) {
	t.Helper()
	root := t.TempDir()
	source, remote := filepath.Join(root, "source"), filepath.Join(root, "remote.git")
	runAnalysisGit(t, "", "init", "-b", "main", source)
	runAnalysisGit(t, source, "config", "user.name", "ReviewArc Test")
	runAnalysisGit(t, source, "config", "user.email", "reviewarc@example.invalid")
	if err := os.MkdirAll(filepath.Join(source, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "src", "greet.go"), []byte("package greet\nfunc Greet() string { return \"hi\" }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "src", "greet_test.go"), []byte("package greet\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runAnalysisGit(t, source, "add", ".")
	runAnalysisGit(t, source, "-c", "commit.gpgsign=false", "commit", "-m", "base")
	baseSHA := strings.TrimSpace(runAnalysisGit(t, source, "rev-parse", "HEAD"))
	runAnalysisGit(t, source, "checkout", "-b", "feature")
	if err := os.WriteFile(filepath.Join(source, "src", "greet.go"), []byte("package greet\nfunc Greet() string { return \"hello\" }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "src", "greet_test.go"), []byte("package greet\n// Greeting behavior is covered by the implementation review.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runAnalysisGit(t, source, "add", ".")
	runAnalysisGit(t, source, "-c", "commit.gpgsign=false", "commit", "-m", "feature")
	headSHA := strings.TrimSpace(runAnalysisGit(t, source, "rev-parse", "HEAD"))
	runAnalysisGit(t, "", "clone", "--bare", source, remote)
	runAnalysisGit(t, "", "--git-dir="+remote, "update-ref", "refs/pull/7/head", headSHA)
	return baseSHA, headSHA, remote
}

func runAnalysisGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	command := exec.CommandContext(context.Background(), "git", args...)
	command.Dir = dir
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, output)
	}
	return string(output)
}
