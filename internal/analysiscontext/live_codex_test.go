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

	file := domain.ChangedFile{Path: "src/main.go", Status: domain.FileModified, Additions: 1, Deletions: 1}
	input := analysisbundle.Input{
		PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{
			Ref:   domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 91},
			Title: "Live Codex context fixture",
		}},
		Repository: gitcache.ManagedRepository{
			Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, PullRequest: 91,
			BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), MergeBaseSHA: strings.Repeat("3", 40),
		},
		ChangedFiles: []domain.ChangedFile{file},
	}
	lease, err := (analysisbundle.Builder{Root: analysisbundle.BundleRoot(dataRoot), Source: bundlePatchSource{file.Path: "@@ -1 +1 @@\n-old\n+new\n"}}).Build(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()

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
	schemaPath := writePrivateJSON(t, map[string]any{
		"type": "object", "properties": map[string]any{"marker": map[string]any{"type": "string", "const": "TOOL_OK"}},
		"required": []string{"marker"}, "additionalProperties": false,
	})
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
		{"mcp_servers.reviewarc.enabled_tools", `["list_changes"]`},
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
	prompt := "Call the reviewarc list_changes tool exactly once. Do not call any other tool. After it succeeds, return the JSON object required by the output schema with marker TOOL_OK."
	result, err := runner.Run(ctx, processpkg.Command{Tool: processpkg.Codex, Args: args, Dir: dataRoot, Stdin: []byte(prompt), Timeout: 2 * time.Minute, MaxOutput: 8 << 20})
	if err != nil {
		t.Fatalf("live Codex MCP invocation: %v\nstderr: %s\nstdout: %s", err, result.Stderr, result.Stdout)
	}

	var called, marker bool
	scanner := bufio.NewScanner(strings.NewReader(string(result.Stdout)))
	scanner.Buffer(make([]byte, 64<<10), 2<<20)
	for scanner.Scan() {
		var event struct {
			Type string `json:"type"`
			Item struct {
				Type   string `json:"type"`
				Server string `json:"server"`
				Tool   string `json:"tool"`
				Status string `json:"status"`
				Text   string `json:"text"`
			} `json:"item"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("decode Codex JSONL event: %v: %s", err, scanner.Bytes())
		}
		switch event.Item.Type {
		case "command_execution", "file_change", "web_search":
			t.Fatalf("forbidden Codex event %q: %s", event.Item.Type, scanner.Bytes())
		case "mcp_tool_call":
			if event.Item.Server != "reviewarc" || event.Item.Tool != "list_changes" || (event.Item.Status != "completed" && event.Item.Status != "success") {
				t.Fatalf("unexpected MCP call: %s", scanner.Bytes())
			}
			called = true
		case "agent_message":
			marker = marker || strings.Contains(event.Item.Text, "TOOL_OK")
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if !called || !marker {
		t.Fatalf("missing successful MCP call or structured marker: called=%t marker=%t\n%s", called, marker, result.Stdout)
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
