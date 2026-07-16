package codex

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
	mu               sync.Mutex
	command          processpkg.Command
	result           processpkg.Result
	err              error
	wait             bool
	stream           bool
	release          <-chan struct{}
	loggedOut        bool
	commands         []processpkg.Command
	catalogShellType string
}

func (r *fixtureRunner) Run(ctx context.Context, command processpkg.Command) (processpkg.Result, error) {
	r.mu.Lock()
	r.commands = append(r.commands, command)
	r.mu.Unlock()
	if len(command.Args) >= 2 && command.Args[0] == "debug" && command.Args[1] == "models" {
		return processpkg.Result{Stdout: []byte(`{"models":[{"slug":"fixture","display_name":"Fixture","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"medium"}],"shell_type":"shell_command"}]}`)}, nil
	}
	if len(command.Args) == 1 && command.Args[0] == "--version" {
		return processpkg.Result{Stdout: []byte("codex-cli fixture\n")}, nil
	}
	if len(command.Args) == 2 && command.Args[0] == "login" && command.Args[1] == "status" {
		if r.loggedOut {
			return processpkg.Result{Stderr: []byte("Not logged in")}, errors.New("exit 1")
		}
		return processpkg.Result{Stdout: []byte("Logged in using ChatGPT\n")}, nil
	}
	r.mu.Lock()
	r.command = command
	r.mu.Unlock()
	if r.stream && command.OnStdoutLine != nil {
		for _, line := range strings.Split(strings.TrimSuffix(string(r.result.Stdout), "\n"), "\n") {
			command.OnStdoutLine([]byte(line))
		}
	}
	if r.release != nil {
		select {
		case <-r.release:
		case <-ctx.Done():
			return processpkg.Result{}, ctx.Err()
		}
	}
	for _, arg := range command.Args {
		if strings.HasPrefix(arg, "model_catalog_json=") {
			path := strings.Trim(strings.TrimPrefix(arg, "model_catalog_json="), `"`)
			var catalog struct {
				Models []struct {
					ShellType string `json:"shell_type"`
				} `json:"models"`
			}
			if data, readErr := os.ReadFile(path); readErr == nil && json.Unmarshal(data, &catalog) == nil && len(catalog.Models) > 0 {
				r.catalogShellType = catalog.Models[0].ShellType
			}
		}
	}
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

func fixtureJSONL(t *testing.T) []byte {
	t.Helper()
	payload, err := os.ReadFile("testdata/analysis.json")
	if err != nil {
		t.Fatal(err)
	}
	tool, _ := json.Marshal(map[string]any{
		"type": "item.completed",
		"item": map[string]any{
			"id": "tool_1", "type": "mcp_tool_call", "server": "reviewarc", "tool": "read_diff", "status": "completed",
			"arguments": map[string]any{"fileId": "f000001", "cursor": 0},
			"result":    map[string]any{"bytes": len(fixturePatch), "hasMore": false},
		},
	})
	message, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{"id": "item_1", "type": "agent_message", "text": string(payload)}})
	return []byte("{\"type\":\"thread.started\",\"thread_id\":\"fixture\"}\n" + string(tool) + "\n" + string(message) + "\n")
}

func TestProgressMessageDescribesApprovedContextActivity(t *testing.T) {
	line := []byte(`{"type":"item.completed","item":{"type":"mcp_tool_call","server":"reviewarc","tool":"read_diff","arguments":{"fileId":"f000001","cursor":0}}}`)
	manifest := analysisbundle.Manifest{Changes: []analysisbundle.Change{{ID: "f000001", Path: "src/greet.go"}}}
	if got := progressMessage(line, manifest); got != "Reading diff for src/greet.go" {
		t.Fatalf("progress message=%q", got)
	}
	unsafe := []byte(`{"type":"item.completed","item":{"type":"mcp_tool_call","server":"other","tool":"read_diff","arguments":{"fileId":"f000001"}}}`)
	if got := progressMessage(unsafe, manifest); got != "" {
		t.Fatalf("unapproved activity was exposed: %q", got)
	}
}

func TestProgressMessageDescribesLifecycleWithoutExposingContent(t *testing.T) {
	reasoning := []byte(`{"type":"item.updated","item":{"type":"reasoning","text":"private reasoning"}}`)
	if got := progressMessage(reasoning, analysisbundle.Manifest{}); got != "Reasoning about the change" || strings.Contains(got, "private") {
		t.Fatalf("reasoning progress=%q", got)
	}
	message := []byte(`{"type":"item.started","item":{"type":"agent_message","text":"private response"}}`)
	if got := progressMessage(message, analysisbundle.Manifest{}); got != "Composing the structured review" || strings.Contains(got, "private") {
		t.Fatalf("message progress=%q", got)
	}
}

func TestAnalyzeEmitsObservedActivityBeforeCodexExits(t *testing.T) {
	release := make(chan struct{})
	runner := &fixtureRunner{result: processpkg.Result{Stdout: fixtureJSONL(t)}, stream: true, release: release}
	events, err := New(runner, Config{Timeout: time.Second, ContextServerExecutable: "/usr/bin/true"}).AnalyzeChange(context.Background(), validInput(t))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(time.Second)
	for {
		select {
		case event := <-events:
			if event.Kind == agent.EventProgress && event.Message == "Reading diff for src/greet.go" {
				close(release)
				for range events {
				}
				return
			}
		case <-deadline:
			close(release)
			t.Fatal("Codex activity was not emitted before process exit")
		}
	}
}

func TestParseJSONLTracksPreviewedInventoryFromRealEventShape(t *testing.T) {
	inventory, err := json.Marshal(map[string]any{
		"type": "item.completed",
		"item": map[string]any{"type": "mcp_tool_call", "server": "reviewarc", "tool": "list_changes", "status": "completed", "arguments": map[string]any{"cursor": 0}, "result": map[string]any{"changes": []any{map[string]any{"id": "f000001", "preview": "+hello"}, map[string]any{"id": "f000002", "preview": "+generated"}}, "hasMore": false}},
	})
	if err != nil {
		t.Fatal(err)
	}
	manifest := analysisbundle.Manifest{Changes: []analysisbundle.Change{
		{ID: "f000001", Path: "src/greet.go", Diff: analysisbundle.Artifact{Bytes: int64(len(fixturePatch))}},
		{ID: "f000002", Path: "generated/output.go", Diff: analysisbundle.Artifact{Bytes: 100}},
	}}
	tracker := agent.NewAccessTracker(manifest)
	stream := append(append(inventory, '\n'), fixtureJSONL(t)...)
	if _, _, err := parseJSONL(stream, tracker); err != nil {
		t.Fatal(err)
	}
	coverage := tracker.Coverage()
	if coverage.DiffFilesFullyRead != 1 || coverage.DiffFilesPreviewed != 1 || coverage.DiffFilesUnseen != 0 {
		t.Fatalf("coverage=%+v", coverage)
	}
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
		Profile:          domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "fixture", Reasoning: domain.ReasoningMedium},
		ContextTransport: domain.ContextReviewArcTools,
		Snapshot: sharedanalysis.Snapshot{BaseSHA: base, HeadSHA: head, Files: fixtureFiles{
			"head:src/greet.go": []byte("package greet\nfunc Greet() string { return \"hello\" }\n"),
		}},
	}
}

func TestAnalyzeUsesBoundedPromptAndValidatesEvidence(t *testing.T) {
	runner := &fixtureRunner{result: processpkg.Result{Stdout: fixtureJSONL(t)}}
	p := New(runner, Config{Timeout: time.Second, ContextServerExecutable: "/usr/bin/true"})
	events, err := p.AnalyzeChange(context.Background(), validInput(t))
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
	if completed == nil || completed.Analysis == nil || completed.Coverage == nil {
		t.Fatal("missing completed analysis or coverage")
	}
	if completed.Analysis.SummaryValidation != domain.ValidationValid || len(completed.Analysis.SummaryEvidence) != 1 {
		t.Fatalf("summary support=%s evidence=%+v", completed.Analysis.SummaryValidation, completed.Analysis.SummaryEvidence)
	}
	if got := completed.Analysis.Facts[1].ValidationStatus; got != domain.ValidationUnverified {
		t.Fatalf("unsupported fact status=%s", got)
	}
	if completed.Coverage.DiffFilesFullyRead != 1 || completed.Coverage.DiffBytesRead != len(fixturePatch) {
		t.Fatalf("coverage=%+v", completed.Coverage)
	}
	runner.mu.Lock()
	command := runner.command
	runner.mu.Unlock()
	joined := strings.Join(command.Args, " ")
	for _, want := range []string{"--json", "--output-schema", "--sandbox read-only", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--model fixture", `approval_policy="never"`, `model_reasoning_effort="medium"`, "mcp_servers.reviewarc.enabled_tools="} {
		if !strings.Contains(joined, want) {
			t.Errorf("safe invocation missing %q: %s", want, joined)
		}
	}
	if runner.catalogShellType != "disabled" {
		t.Fatalf("model shell type = %q, want disabled", runner.catalogShellType)
	}
	prompt := string(command.Stdin)
	if len(prompt) > maxLaunchPromptBytes || strings.Contains(prompt, fixturePatch) || strings.Contains(prompt, "package greet") {
		t.Fatalf("launch prompt was not bounded and artifact-only: %q", prompt)
	}
	if !strings.Contains(prompt, "using only the reviewarc read-only context tools") {
		t.Fatalf("missing controlled-context instruction: %q", prompt)
	}
}

func TestCapabilitiesDiscoverModelsAndControlledTransport(t *testing.T) {
	provider := New(&fixtureRunner{}, Config{})
	capabilities, err := provider.Capabilities(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if capabilities.ID != domain.HarnessCodex || capabilities.Version != "codex-cli fixture" || capabilities.DefaultModel != "fixture" || len(capabilities.Models) != 1 || capabilities.Models[0].DefaultReasoningLevel != domain.ReasoningMedium || len(capabilities.Models[0].ReasoningLevels) != 2 {
		t.Fatalf("capabilities=%+v", capabilities)
	}
	if len(capabilities.ContextTransports) != 1 || capabilities.ContextTransports[0] != domain.ContextReviewArcTools {
		t.Fatalf("controlled transport missing: %+v", capabilities.ContextTransports)
	}
	if !capabilities.SupportsProgress {
		t.Fatal("Codex progress capability missing")
	}
}

func TestCapabilitiesRejectLoggedOutCodex(t *testing.T) {
	capabilities, err := New(&fixtureRunner{loggedOut: true}, Config{}).Capabilities(context.Background())
	if err == nil || capabilities.State != domain.HarnessBroken || !strings.Contains(capabilities.Message, "Sign in") {
		t.Fatalf("capabilities=%+v err=%v", capabilities, err)
	}
}

func TestParseJSONLRejectsMalformedStructuredAndUnapprovedToolOutput(t *testing.T) {
	tracker := NewAccessTrackerForTest()
	if _, _, err := parseJSONL([]byte("not json\n"), tracker); err == nil {
		t.Fatal("expected malformed JSONL error")
	}
	event := `{"type":"item.completed","item":{"type":"agent_message","text":"{\"schemaVersion\":1,\"unexpected\":true}"}}`
	if _, _, err := parseJSONL([]byte(event), tracker); err == nil {
		t.Fatal("expected strict structured output error")
	}
	policy := `{"type":"item.completed","item":{"type":"command_execution","status":"completed"}}`
	if _, _, err := parseJSONL([]byte(policy), tracker); !errors.Is(err, errPolicyViolation) {
		t.Fatalf("policy error=%v", err)
	}
}

func TestParseJSONLDeduplicatesRecoverableWarnings(t *testing.T) {
	payload, err := os.ReadFile("testdata/analysis.json")
	if err != nil {
		t.Fatal(err)
	}
	warning := `{"type":"item.completed","item":{"type":"error","message":"local configuration warning"}}`
	message, err := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{"type": "agent_message", "text": string(payload)}})
	if err != nil {
		t.Fatal(err)
	}
	_, warnings, err := parseJSONL([]byte(warning+"\n"+warning+"\n"+string(message)+"\n"), NewAccessTrackerForTest())
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 1 {
		t.Fatalf("warnings=%v", warnings)
	}
}

func NewAccessTrackerForTest() *agent.AccessTracker {
	return agent.NewAccessTracker(analysisbundle.Manifest{})
}

func TestCancellationTerminatesAnalysis(t *testing.T) {
	runner := &fixtureRunner{wait: true}
	p := New(runner, Config{Timeout: time.Minute, ContextServerExecutable: "/usr/bin/true"})
	ctx, cancel := context.WithCancel(context.Background())
	events, err := p.AnalyzeChange(ctx, validInput(t))
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

func TestRevisionMismatchFailsClosed(t *testing.T) {
	provider := New(&fixtureRunner{}, Config{ContextServerExecutable: "/usr/bin/true"})
	input := validInput(t)
	input.Snapshot.HeadSHA = strings.Repeat("4", 40)
	if _, err := provider.AnalyzeChange(context.Background(), input); err == nil {
		t.Fatal("expected revision mismatch")
	}
}

func TestOversizedProviderFailureDoesNotOfferUnchangedRetry(t *testing.T) {
	event := providerFailure(errors.New("exit 1"), []byte(`{"input_error_code":"input_too_large","max_chars":1048576}`))
	if event.Failure == nil || event.Failure.Code != domain.FailureInputTooLarge || event.Failure.Action != domain.RetryChangeProfile || event.Failure.Retryable {
		t.Fatalf("failure=%+v", event.Failure)
	}
}
