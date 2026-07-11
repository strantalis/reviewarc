package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"reviewarc/internal/agent"
	"reviewarc/internal/domain"
	processpkg "reviewarc/internal/process"
)

type fixtureRunner struct {
	mu               sync.Mutex
	command          processpkg.Command
	result           processpkg.Result
	err              error
	wait             bool
	commands         []processpkg.Command
	catalogShellType string
}

func (r *fixtureRunner) Run(ctx context.Context, command processpkg.Command) (processpkg.Result, error) {
	r.mu.Lock()
	r.command = command
	r.commands = append(r.commands, command)
	r.mu.Unlock()
	if r.wait {
		<-ctx.Done()
		return processpkg.Result{}, ctx.Err()
	}
	if len(command.Args) >= 3 && command.Args[0] == "debug" && command.Args[1] == "models" {
		return processpkg.Result{Stdout: []byte(`{"models":[{"slug":"fixture","shell_type":"shell_command"}]}`)}, nil
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
	return r.result, r.err
}

type fixtureFiles map[string][]byte

func (f fixtureFiles) ReadFile(_ context.Context, _, revision, path string) ([]byte, error) {
	value, ok := f[revision+":"+path]
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
	event, _ := json.Marshal(map[string]any{"type": "item.completed", "item": map[string]any{"id": "item_1", "type": "agent_message", "text": string(payload)}})
	return append(append([]byte("{\"type\":\"thread.started\",\"thread_id\":\"fixture\"}\n"), event...), '\n')
}

func validInput(t *testing.T) agent.AnalyzeInput {
	t.Helper()
	return agent.AnalyzeInput{Workspace: t.TempDir(), BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), UnifiedDiff: "diff --git a/src/greet.go b/src/greet.go", RepositoryContext: "--- src/greet.go @ head ---\npackage greet"}
}

func TestAnalyzeValidatesEvidenceAndUnsupportedClaims(t *testing.T) {
	runner := &fixtureRunner{result: processpkg.Result{Stdout: fixtureJSONL(t)}}
	p := New(runner, Config{Timeout: time.Second})
	p.files = fixtureFiles{strings.Repeat("2", 40) + ":src/greet.go": []byte("package greet\nfunc Greet() string { return \"hello\" }\n")}
	events, err := p.AnalyzeChange(context.Background(), validInput(t))
	if err != nil {
		t.Fatal(err)
	}
	var completed *domain.ReviewAnalysis
	for event := range events {
		if event.Kind == agent.EventFailed {
			t.Fatalf("analysis failed: %v", event.Err)
		}
		if event.Kind == agent.EventCompleted {
			completed = event.Analysis
		}
	}
	if completed == nil {
		t.Fatal("missing completed analysis")
	}
	if completed.SummaryValidation != domain.ValidationValid || len(completed.SummaryEvidence) != 1 {
		t.Fatalf("summary support=%s evidence=%+v", completed.SummaryValidation, completed.SummaryEvidence)
	}
	if got := completed.Facts[0].ValidationStatus; got != domain.ValidationValid {
		t.Fatalf("valid fact status=%s", got)
	}
	if got := completed.Facts[1].ValidationStatus; got != domain.ValidationUnverified {
		t.Fatalf("unsupported fact status=%s", got)
	}
	if got := completed.Facts[1].Evidence[0].ValidationStatus; got != domain.ValidationInvalid {
		t.Fatalf("escaping evidence status=%s", got)
	}
	if len(completed.ValidationIssues) < 2 {
		t.Fatalf("issues=%+v", completed.ValidationIssues)
	}
	runner.mu.Lock()
	args := append([]string(nil), runner.command.Args...)
	runner.mu.Unlock()
	joined := strings.Join(args, " ")
	for _, want := range []string{"--json", "--output-schema", "--sandbox read-only", "--ephemeral", "--ignore-user-config", "--ignore-rules", `approval_policy="never"`, `shell_environment_policy.inherit="none"`, "model_catalog_json="} {
		if !strings.Contains(joined, want) {
			t.Errorf("safe invocation missing %q: %s", want, joined)
		}
	}
	if runner.catalogShellType != "disabled" {
		t.Fatalf("model shell type = %q, want disabled", runner.catalogShellType)
	}
	if !strings.Contains(string(runner.command.Stdin), "src/greet.go @ head") {
		t.Fatal("bounded repository context was not supplied to Codex")
	}
}

func TestValidateRejectsTraversalAndInvalidLines(t *testing.T) {
	for _, test := range []struct {
		name, path string
		start, end int
		want       string
	}{
		{"parent", "../outside", 1, 1, "escapes"}, {"absolute", "/tmp/outside", 1, 1, "relative"}, {"dot", ".", 1, 1, "escapes"}, {"dot-prefix", "./src/greet.go", 1, 1, "canonical"}, {"normalized-traversal", "src/../greet.go", 1, 1, "canonical"}, {"backward", "src/greet.go", 3, 2, "1-based"},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := rawEvidence{ID: "e", Path: test.path, Revision: "head", StartLine: test.start, EndLine: test.end}
			v := validator{ctx: context.Background(), files: fixtureFiles{}, workspace: t.TempDir(), base: strings.Repeat("1", 40), head: strings.Repeat("2", 40), cache: map[string][]byte{}, ids: map[string]rawEvidence{}}
			got := v.evidence([]rawEvidence{raw})[0]
			if got.ValidationStatus != domain.ValidationInvalid || !strings.Contains(got.ValidationMessage, test.want) {
				t.Fatalf("got %+v", got)
			}
		})
	}
}

func TestValidateModelIdentityRejectsDuplicateChapterIDs(t *testing.T) {
	raw := rawAnalysis{Chapters: []rawChapter{{ID: "chapter", Order: 1}, {ID: "chapter", Order: 2}}}
	if err := validateModelIdentity(raw); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("duplicate chapter ID error = %v", err)
	}
	raw = rawAnalysis{Chapters: []rawChapter{{ID: "chapter", Order: 1}, {ID: "other", Order: 1}}}
	if err := validateModelIdentity(raw); err == nil || !strings.Contains(err.Error(), "order") {
		t.Fatalf("duplicate chapter order error = %v", err)
	}
}

func TestParseJSONLRejectsConversationalOrUnknownOutput(t *testing.T) {
	if _, _, err := parseJSONL([]byte("not json\n")); err == nil {
		t.Fatal("expected malformed JSONL error")
	}
	event := `{"type":"item.completed","item":{"type":"agent_message","text":"{\"schemaVersion\":1,\"unexpected\":true}"}}`
	if _, _, err := parseJSONL([]byte(event)); err == nil {
		t.Fatal("expected strict structured output error")
	}
}

func TestCancellationTerminatesAnalysis(t *testing.T) {
	runner := &fixtureRunner{wait: true}
	p := New(runner, Config{Timeout: time.Minute})
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
			if !ok {
				return
			}
			if event.Kind == agent.EventCancelled {
				return
			}
		case <-deadline:
			t.Fatal("analysis did not cancel")
		}
	}
}

func TestRevisionMismatchFailsClosed(t *testing.T) {
	raw, warnings, err := parseJSONL(fixtureJSONL(t))
	if err != nil || len(warnings) != 0 {
		t.Fatalf("parse: %v %v", err, warnings)
	}
	raw.HeadSHA = strings.Repeat("3", 40)
	p := New(&fixtureRunner{}, Config{})
	input := validInput(t)
	if _, err = p.validate(context.Background(), input, raw); err == nil {
		t.Fatal("expected revision mismatch")
	}
}

func TestLiveCodexAcceptsToolDisabledCatalog(t *testing.T) {
	if os.Getenv("REVIEWARC_LIVE_CODEX") != "1" {
		t.Skip("set REVIEWARC_LIVE_CODEX=1 for installed CLI verification")
	}
	runner := processpkg.NewExecRunner()
	p := New(runner, Config{Timeout: 2 * time.Minute})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	catalog, err := p.writeToollessModelCatalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(catalog)
	result, err := runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Dir: t.TempDir(), Timeout: 2 * time.Minute, MaxOutput: 4 << 20,
		Args:  []string{"exec", "--json", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "-c", fmt.Sprintf("model_catalog_json=%q", catalog), "-C", ".", "-"},
		Stdin: []byte("Return exactly NO_SHELL and do not call tools.")})
	if err != nil {
		t.Fatalf("tool-disabled Codex invocation failed: %v: %s", err, result.Stderr)
	}
	output := string(result.Stdout)
	if !strings.Contains(output, "NO_SHELL") {
		t.Fatalf("missing expected response: %s", output)
	}
	if strings.Contains(output, "command_execution") || strings.Contains(output, "exec_command") {
		t.Fatalf("shell event appeared with disabled catalog: %s", output)
	}
}
