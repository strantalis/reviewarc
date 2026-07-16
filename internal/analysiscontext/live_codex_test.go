package analysiscontext

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	sharedanalysis "reviewarc/internal/analysis"
	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	processpkg "reviewarc/internal/process"
)

const liveContextHelperEnv = "REVIEWARC_LIVE_CONTEXT_HELPER"

func TestMain(m *testing.M) {
	if os.Getenv(liveContextHelperEnv) == "1" {
		service, err := Open(
			os.Getenv("REVIEWARC_LIVE_DATA_ROOT"),
			os.Getenv("REVIEWARC_LIVE_BUNDLE"),
			os.Getenv("REVIEWARC_LIVE_DIGEST"),
			processpkg.NewExecRunner(),
		)
		if err == nil {
			err = Serve(context.Background(), service, os.Stdin, os.Stdout, os.Stderr)
		}
		if err != nil {
			_, _ = fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestLiveCodexUsesOnlyRequiredReviewArcMCP(t *testing.T) {
	if os.Getenv("REVIEWARC_LIVE_CODEX") != "1" {
		t.Skip("set REVIEWARC_LIVE_CODEX=1 for installed Codex MCP verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dataRoot := t.TempDir()
	cache := filepath.Join(dataRoot, "repositories", "github.com", "acme", "api.git")
	if err := os.MkdirAll(filepath.Dir(cache), 0o700); err != nil {
		t.Fatal(err)
	}
	git := exec.CommandContext(ctx, "git", "init", "--bare", cache)
	if output, err := git.CombinedOutput(); err != nil {
		t.Fatalf("create bare fixture: %v: %s", err, output)
	}

	files := []domain.ChangedFile{
		{Path: "src/main.go", Status: domain.FileModified, Additions: 1, Deletions: 1},
		{Path: "README.md", Status: domain.FileModified, Additions: 1, Deletions: 1},
	}
	input := analysisbundle.Input{
		PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{
			Ref:   domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 91},
			Title: "Live Codex context fixture",
		}},
		Repository: gitcache.ManagedRepository{
			Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, PullRequest: 91,
			BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), MergeBaseSHA: strings.Repeat("3", 40),
		},
		ChangedFiles: files,
	}
	lease, err := (analysisbundle.Builder{Root: analysisbundle.BundleRoot(dataRoot), Source: bundlePatchSource{
		files[0].Path: "@@ -1 +1 @@\n-old\n+new\n",
		files[1].Path: "@@ -1 +1 @@\n-Old docs\n+New docs\n",
	}}).Build(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lease.Close() }()

	runner := processpkg.NewExecRunner()
	catalogResult, err := runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: []string{"debug", "models", "--bundled"}, Timeout: 20 * time.Second, MaxOutput: 16 << 20})
	if err != nil {
		t.Fatalf("load Codex model catalog: %v: %s", err, catalogResult.Stderr)
	}
	var catalog struct {
		Models []map[string]any `json:"models"`
	}
	if err := json.Unmarshal(catalogResult.Stdout, &catalog); err != nil || len(catalog.Models) == 0 {
		t.Fatalf("invalid Codex model catalog: %v", err)
	}
	for _, model := range catalog.Models {
		model["shell_type"] = "disabled"
		model["experimental_supported_tools"] = []any{}
	}
	catalogPath := writePrivateJSON(t, catalog)
	schemaPath := writePrivateJSON(t, json.RawMessage(sharedanalysis.Schema()))
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	config := func(key, value string) []string { return []string{"-c", key + "=" + value} }
	args := []string{"exec", "--json", "--output-schema", schemaPath, "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--color", "never"}
	for _, setting := range [][2]string{
		{"approval_policy", strconv.Quote("never")},
		{"shell_environment_policy.inherit", strconv.Quote("none")},
		{"web_search", strconv.Quote("disabled")},
		{"memories.use_memories", "false"},
		{"memories.generate_memories", "false"},
		{"features.remote_plugin", "false"},
		{"model_catalog_json", strconv.Quote(catalogPath)},
		{"mcp_servers.reviewarc.command", strconv.Quote(testBinary)},
		{"mcp_servers.reviewarc.required", "true"},
		{"mcp_servers.reviewarc.enabled_tools", `["list_changes","read_diff","explain_diff_omissions"]`},
		{"mcp_servers.reviewarc.default_tools_approval_mode", strconv.Quote("approve")},
		{"mcp_servers.reviewarc.startup_timeout_sec", "15"},
		{"mcp_servers.reviewarc.env." + liveContextHelperEnv, strconv.Quote("1")},
		{"mcp_servers.reviewarc.env.REVIEWARC_LIVE_DATA_ROOT", strconv.Quote(dataRoot)},
		{"mcp_servers.reviewarc.env.REVIEWARC_LIVE_BUNDLE", strconv.Quote(lease.Reference.Path)},
		{"mcp_servers.reviewarc.env.REVIEWARC_LIVE_DIGEST", strconv.Quote(lease.Reference.Digest)},
	} {
		args = append(args, config(setting[0], setting[1])...)
	}
	args = append(args, "-C", dataRoot, "-")
	prompt := `You must call reviewarc.list_changes exactly once, then reviewarc.read_diff exactly once for fileId f000001 with cursor 0, then reviewarc.explain_diff_omissions exactly once with this argument shape: {"decisions":[{"fileId":"f000002","category":"documentation","reason":"Documentation-only fixture; no runtime behavior changed."}]}. Do not flatten the decisions array. Do not call any other tool and do not return the review before all three calls succeed. Then return a concise review matching the output schema. Use schemaVersion 1, baseSha ` + strings.Repeat("1", 40) + `, headSha ` + strings.Repeat("2", 40) + `, summary "The fixture changes old to new.", and one chapter with one fact citing src/main.go at head line 1. Use unique non-empty IDs and no other claims.`
	result, err := runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: args, Dir: dataRoot, Stdin: []byte(prompt), Timeout: 2 * time.Minute, MaxOutput: 8 << 20})
	if err != nil {
		t.Fatalf("live Codex MCP invocation: %v\nstderr: %s\nstdout: %s", err, result.Stderr, result.Stdout)
	}

	completedTools := map[string]bool{}
	var structured []byte
	scanner := bufio.NewScanner(strings.NewReader(string(result.Stdout)))
	scanner.Buffer(make([]byte, 64<<10), 2<<20)
	for scanner.Scan() {
		var event struct {
			Type string `json:"type"`
			Item struct {
				Type   string          `json:"type"`
				Server string          `json:"server"`
				Tool   string          `json:"tool"`
				Status string          `json:"status"`
				Text   string          `json:"text"`
				Result json.RawMessage `json:"result"`
			} `json:"item"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("decode Codex JSONL event: %v: %s", err, scanner.Bytes())
		}
		switch event.Item.Type {
		case "command_execution", "file_change", "web_search":
			t.Fatalf("forbidden Codex event %q: %s", event.Item.Type, scanner.Bytes())
		case "mcp_tool_call":
			if event.Item.Server != "reviewarc" || (event.Item.Tool != "list_changes" && event.Item.Tool != "read_diff" && event.Item.Tool != "explain_diff_omissions") {
				t.Fatalf("unexpected MCP call: %s", scanner.Bytes())
			}
			if event.Item.Status == "completed" || event.Item.Status == "success" {
				if event.Item.Tool == "explain_diff_omissions" {
					var output struct {
						StructuredContent struct {
							Recorded int `json:"recorded"`
						} `json:"structured_content"`
					}
					if err := json.Unmarshal(event.Item.Result, &output); err != nil || output.StructuredContent.Recorded != 1 {
						t.Fatalf("omission provenance was not recorded: result=%s err=%v", event.Item.Result, err)
					}
				}
				completedTools[event.Item.Tool] = true
			} else if event.Item.Status != "in_progress" && event.Item.Status != "started" {
				t.Fatalf("unsuccessful MCP call: %s", scanner.Bytes())
			}
		case "agent_message":
			structured = []byte(event.Item.Text)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if !completedTools["list_changes"] || !completedTools["read_diff"] || !completedTools["explain_diff_omissions"] {
		t.Fatalf("missing successful MCP calls: completed=%v\n%s", completedTools, result.Stdout)
	}
	if _, err := sharedanalysis.Decode(structured); err != nil {
		t.Fatalf("live Codex did not return ReviewArc's structured schema: %v\n%s", err, result.Stdout)
	}
}

func writePrivateJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "fixture.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
