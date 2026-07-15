package claude

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"reviewarc/internal/agent"
	sharedanalysis "reviewarc/internal/analysis"
	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	processpkg "reviewarc/internal/process"
)

const fixturePatch = "diff --git a/src/greet.go b/src/greet.go\n@@ -1,2 +1,2 @@\n package greet\n-func Greet() string { return \"hi\" }\n+func Greet() string { return \"hello\" }\n"

type fixtureRunner struct {
	mu        sync.Mutex
	command   processpkg.Command
	result    processpkg.Result
	err       error
	wait      bool
	mcpConfig []byte
}

func (r *fixtureRunner) Run(ctx context.Context, command processpkg.Command) (processpkg.Result, error) {
	if len(command.Args) == 1 && command.Args[0] == "--version" {
		return processpkg.Result{Stdout: []byte("2.1.210 (Claude Code)\n")}, nil
	}
	if len(command.Args) == 1 && command.Args[0] == "--help" {
		return processpkg.Result{Stdout: []byte(strings.Join([]string{"--json-schema", "--strict-mcp-config", "--mcp-config", "--tools", "--permission-mode", "--effort", "--no-session-persistence"}, "\n"))}, nil
	}
	r.mu.Lock()
	r.command = command
	for index, arg := range command.Args {
		if arg == "--mcp-config" && index+1 < len(command.Args) {
			r.mcpConfig, _ = os.ReadFile(command.Args[index+1])
		}
	}
	r.mu.Unlock()
	if r.wait {
		<-ctx.Done()
		return processpkg.Result{}, ctx.Err()
	}
	return r.result, r.err
}

type fixturePatchSource map[string]string

func (f fixturePatchSource) DiffFile(_ context.Context, _ gitcache.ManagedRepository, file domain.ChangedFile, _ int) (domain.DiffFile, error) {
	return domain.DiffFile{File: file, Patch: f[file.Path]}, nil
}

type fixtureFiles map[string][]byte

func (f fixtureFiles) ReadFile(_ context.Context, revision domain.Revision, path string) ([]byte, error) {
	value, ok := f[string(revision)+":"+path]
	if !ok {
		return nil, errors.New("missing")
	}
	return value, nil
}

func validInput(t *testing.T) agent.AnalyzeInput {
	t.Helper()
	dataRoot := t.TempDir()
	base, head, merge := strings.Repeat("1", 40), strings.Repeat("2", 40), strings.Repeat("3", 40)
	file := domain.ChangedFile{Path: "src/greet.go", Status: domain.FileModified, Additions: 1, Deletions: 1}
	lease, err := (analysisbundle.Builder{Root: analysisbundle.BundleRoot(dataRoot), Source: fixturePatchSource{file.Path: fixturePatch}}).Build(context.Background(), analysisbundle.Input{
		PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{
			Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}, Title: "Greeting change",
		}},
		Repository:   gitcache.ManagedRepository{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, PullRequest: 7, BaseSHA: base, HeadSHA: head, MergeBaseSHA: merge},
		ChangedFiles: []domain.ChangedFile{file},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	return agent.AnalyzeInput{
		Bundle: lease.Reference, DataRoot: dataRoot,
		Profile:          domain.AnalysisProfile{Harness: domain.HarnessClaude, Model: "sonnet", Reasoning: domain.ReasoningHigh},
		ContextTransport: domain.ContextReviewArcTools,
		Snapshot: sharedanalysis.Snapshot{BaseSHA: base, HeadSHA: head, Files: fixtureFiles{
			"head:src/greet.go": []byte("package greet\nfunc Greet() string { return \"hello\" }\n"),
		}},
	}
}

func fixtureStream(t *testing.T) []byte {
	t.Helper()
	payload, err := os.ReadFile("../codex/testdata/analysis.json")
	if err != nil {
		t.Fatal(err)
	}
	toolUse, _ := json.Marshal(map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_use", "id": "tool_1", "name": "mcp__reviewarc__read_diff", "input": map[string]any{"fileId": "f000001", "cursor": 0},
	}}}})
	toolResult, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"content": []any{map[string]any{
		"type": "tool_result", "tool_use_id": "tool_1", "content": map[string]any{"bytes": len(fixturePatch), "hasMore": false},
	}}}})
	var structured any
	if err := json.Unmarshal(payload, &structured); err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(map[string]any{"type": "result", "is_error": false, "structured_output": structured})
	return []byte(string(toolUse) + "\n" + string(toolResult) + "\n" + string(result) + "\n")
}

func TestProgressMessageDescribesApprovedContextActivity(t *testing.T) {
	line := []byte(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__reviewarc__read_file","input":{"path":"src/greet.go","revision":"head","startLine":1,"endLine":20}}]}}`)
	if got := progressMessage(line, analysisbundle.Manifest{}); got != "Reading src/greet.go lines 1–20" {
		t.Fatalf("progress message=%q", got)
	}
	unsafe := []byte(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__other__read_file","input":{"path":"secret"}}]}}`)
	if got := progressMessage(unsafe, analysisbundle.Manifest{}); got != "" {
		t.Fatalf("unapproved activity was exposed: %q", got)
	}
}

func TestCapabilitiesExposeSecondEligibleAdapter(t *testing.T) {
	capabilities, err := New(&fixtureRunner{}, Config{}).Capabilities(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if capabilities.ID != domain.HarnessClaude || capabilities.State != domain.HarnessAvailable || capabilities.Version != "2.1.210 (Claude Code)" || capabilities.DefaultModel != "sonnet" || len(capabilities.Models) != 2 {
		t.Fatalf("capabilities=%+v", capabilities)
	}
	if !capabilities.SupportsJSONSchema || !capabilities.EnforcesReadOnly || !capabilities.SupportsProgress || len(capabilities.ContextTransports) != 1 || capabilities.ContextTransports[0] != domain.ContextReviewArcTools {
		t.Fatalf("contract capabilities=%+v", capabilities)
	}
}

func TestAnalyzeUsesOnlyControlledToolsAndStructuredOutput(t *testing.T) {
	runner := &fixtureRunner{result: processpkg.Result{Stdout: fixtureStream(t)}}
	provider := New(runner, Config{Timeout: time.Second, ContextServerExecutable: "/usr/bin/true"})
	events, err := provider.AnalyzeChange(context.Background(), validInput(t))
	if err != nil {
		t.Fatal(err)
	}
	var completed *agent.Event
	for event := range events {
		if event.Kind == agent.EventFailed {
			t.Fatalf("analysis failed: %+v", event.Failure)
		}
		if event.Kind == agent.EventCompleted {
			copy := event
			completed = &copy
		}
	}
	if completed == nil || completed.Analysis == nil || completed.Coverage == nil || completed.Coverage.DiffFilesFullyRead != 1 {
		t.Fatalf("completed=%+v", completed)
	}
	runner.mu.Lock()
	command, mcpConfig := runner.command, append([]byte(nil), runner.mcpConfig...)
	runner.mu.Unlock()
	joined := strings.Join(command.Args, " ")
	for _, want := range []string{"--output-format stream-json", "--json-schema", "--model sonnet", "--effort high", "--permission-mode dontAsk", "--strict-mcp-config", "--setting-sources  --disable-slash-commands", "--no-chrome", "--no-session-persistence", "--tools  --allowedTools mcp__reviewarc__list_changes"} {
		if !strings.Contains(joined, want) {
			t.Errorf("isolated invocation missing %q: %s", want, joined)
		}
	}
	if len(command.Stdin) > maxLaunchPromptBytes || strings.Contains(string(command.Stdin), fixturePatch) || strings.Contains(string(command.Stdin), "package greet") {
		t.Fatalf("launch prompt was not bounded and artifact-only: %q", command.Stdin)
	}
	if !strings.Contains(string(mcpConfig), `"context-server"`) || strings.Contains(string(mcpConfig), "Bash") {
		t.Fatalf("MCP config=%s", mcpConfig)
	}
}

func TestParseStreamRejectsMalformedUnknownToolsAndMissingStructuredOutput(t *testing.T) {
	tracker := agent.NewAccessTracker(analysisbundle.Manifest{})
	if _, err := parseStream([]byte("not json\n"), tracker); err == nil {
		t.Fatal("malformed stream accepted")
	}
	policy := `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"one","name":"Bash","input":{}}]}}`
	if _, err := parseStream([]byte(policy), tracker); !errors.Is(err, errPolicyViolation) {
		t.Fatalf("policy error=%v", err)
	}
	if _, err := parseStream([]byte(`{"type":"result","is_error":false}`), tracker); err == nil {
		t.Fatal("missing structured output accepted")
	}
}

func TestCancellationTerminatesClaudeAnalysis(t *testing.T) {
	runner := &fixtureRunner{wait: true}
	provider := New(runner, Config{Timeout: time.Minute, ContextServerExecutable: "/usr/bin/true"})
	ctx, cancel := context.WithCancel(context.Background())
	events, err := provider.AnalyzeChange(ctx, validInput(t))
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	deadline := time.After(time.Second)
	for {
		select {
		case event, ok := <-events:
			if !ok || event.Kind == agent.EventCancelled {
				return
			}
		case <-deadline:
			t.Fatal("analysis did not cancel")
		}
	}
}

func TestOversizedProviderFailureDoesNotOfferUnchangedRetry(t *testing.T) {
	event := providerFailure(errors.New("exit 1"), []byte("input exceeds maximum length"))
	if event.Failure == nil || event.Failure.Code != domain.FailureInputTooLarge || event.Failure.Action != domain.RetryChangeProfile || event.Failure.Retryable {
		t.Fatalf("failure=%+v", event.Failure)
	}
}
