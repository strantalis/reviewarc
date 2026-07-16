package analysiscontext

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
)

type bundlePatchSource map[string]string

func (p bundlePatchSource) DiffFile(_ context.Context, _ gitcache.ManagedRepository, file domain.ChangedFile, _ int) (domain.DiffFile, error) {
	return domain.DiffFile{File: file, Patch: p[file.Path]}, nil
}

type fakeObjectReader struct {
	files   map[string]string
	binary  map[string]bool
	matches []SearchMatch
	query   string
}

func (r *fakeObjectReader) ReadFile(_ context.Context, revision domain.Revision, path string) (string, bool, error) {
	key := string(revision) + ":" + path
	if r.binary[key] {
		return "", true, nil
	}
	value, ok := r.files[key]
	if !ok {
		return "", false, errors.New("missing")
	}
	return value, false, nil
}

func (r *fakeObjectReader) Search(_ context.Context, _ domain.Revision, query string) ([]SearchMatch, error) {
	r.query = query
	return append([]SearchMatch(nil), r.matches...), nil
}

func fixtureService(t *testing.T, limits analysisbundle.Limits, patch string, reader ObjectReader) (*Service, *analysisbundle.Lease) {
	t.Helper()
	dataRoot := t.TempDir()
	file := domain.ChangedFile{Path: "src/main.go", Status: domain.FileModified, Additions: 1}
	input := analysisbundle.Input{
		PullRequest:  domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 9}, Title: "Context fixture"}},
		Repository:   gitcache.ManagedRepository{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, PullRequest: 9, BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), MergeBaseSHA: strings.Repeat("3", 40)},
		ChangedFiles: []domain.ChangedFile{file}, Limits: limits,
	}
	lease, err := (analysisbundle.Builder{Root: analysisbundle.BundleRoot(dataRoot), Source: bundlePatchSource{file.Path: patch}}).Build(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := analysisbundle.Open(dataRoot, lease.Reference.Path, lease.Reference.Digest)
	if err != nil {
		_ = lease.Close()
		t.Fatal(err)
	}
	service, err := New(bundle, reader)
	if err != nil {
		_ = lease.Close()
		t.Fatal(err)
	}
	return service, lease
}

func TestReadDiffPagesAndRecordsCoverage(t *testing.T) {
	limits := analysisbundle.DefaultLimits()
	limits.PageBytes = 1024
	patch := strings.Repeat("diff line\n", 300)
	service, lease := fixtureService(t, limits, patch, &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	first, err := service.ReadDiff(context.Background(), ReadDiffInput{FileID: "f000001"})
	if err != nil || !first.HasMore || first.NextCursor == 0 {
		t.Fatalf("first page=%+v err=%v", first, err)
	}
	if _, err := service.ReadDiff(context.Background(), ReadDiffInput{FileID: "f000001", Cursor: first.NextCursor}); err != nil {
		t.Fatal(err)
	}
	records := service.AccessRecords()
	if len(records) != 2 || records[0].Tool != "read_diff" || !records[0].Success {
		t.Fatalf("records=%+v", records)
	}
	coverage := service.Coverage()
	if coverage.DiffFilesRead != 1 || coverage.DiffFilesPartiallyRead != 1 || coverage.BytesServed == 0 {
		t.Fatalf("coverage=%+v", coverage)
	}
}

func TestListChangesIncludesBoundedDiffPreviewForTriage(t *testing.T) {
	patch := "diff --git a/src/main.go b/src/main.go\n@@ -1 +1 @@\n-old\n+new\n"
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), patch, &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	out, err := service.ListChanges(context.Background(), ListChangesInput{})
	if err != nil || len(out.Changes) != 1 {
		t.Fatalf("changes=%+v err=%v", out.Changes, err)
	}
	change := out.Changes[0]
	if !strings.Contains(change.Preview, "+new") || change.PreviewTruncated || change.Diff.Path != "" || change.Diff.SHA256 != "" {
		t.Fatalf("change=%+v", change)
	}
}

func TestListChangesPagesCompleteLargePullRequestInventory(t *testing.T) {
	dataRoot := t.TempDir()
	files := make([]domain.ChangedFile, 171)
	patches := bundlePatchSource{}
	for index := range files {
		path := fmt.Sprintf("src/file-%03d.go", index+1)
		files[index] = domain.ChangedFile{Path: path, Status: domain.FileModified, Additions: 1}
		patches[path] = fmt.Sprintf("diff --git a/%s b/%s\n@@ -1 +1 @@\n-old\n+new-%d\n", path, path, index+1)
	}
	input := analysisbundle.Input{
		PullRequest:  domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 9}, Title: "Large context fixture"}},
		Repository:   gitcache.ManagedRepository{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, PullRequest: 9, BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), MergeBaseSHA: strings.Repeat("3", 40)},
		ChangedFiles: files, Limits: analysisbundle.DefaultLimits(),
	}
	lease, err := (analysisbundle.Builder{Root: analysisbundle.BundleRoot(dataRoot), Source: patches}).Build(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lease.Close() }()
	bundle, err := analysisbundle.Open(dataRoot, lease.Reference.Path, lease.Reference.Digest)
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(bundle, &fakeObjectReader{})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.ListChanges(context.Background(), ListChangesInput{})
	if err != nil || len(first.Changes) != 100 || !first.HasMore || first.NextCursor != 100 {
		t.Fatalf("first page changes=%d hasMore=%t next=%d err=%v", len(first.Changes), first.HasMore, first.NextCursor, err)
	}
	second, err := service.ListChanges(context.Background(), ListChangesInput{Cursor: first.NextCursor})
	if err != nil || len(second.Changes) != 71 || second.HasMore || second.NextCursor != 0 {
		t.Fatalf("second page changes=%d hasMore=%t next=%d err=%v", len(second.Changes), second.HasMore, second.NextCursor, err)
	}
	for _, change := range append(first.Changes, second.Changes...) {
		if change.Preview == "" {
			t.Fatalf("change %s had no triage preview", change.Path)
		}
	}
}

func TestReadFileBoundsAndRejectsBinary(t *testing.T) {
	limits := analysisbundle.DefaultLimits()
	reader := &fakeObjectReader{files: map[string]string{"head:src/main.go": "one\ntwo\nthree\nfour\n"}, binary: map[string]bool{"base:bin.dat": true}}
	service, lease := fixtureService(t, limits, "patch", reader)
	defer func() { _ = lease.Close() }()
	out, err := service.ReadFile(context.Background(), ReadFileInput{Path: "src/main.go", Revision: "head", StartLine: 2, EndLine: 3})
	if err != nil || out.Content != "two\nthree" || out.EndLine != 3 {
		t.Fatalf("output=%+v err=%v", out, err)
	}
	if _, err := service.ReadFile(context.Background(), ReadFileInput{Path: "bin.dat", Revision: "base", StartLine: 1, EndLine: 1}); err == nil || !strings.Contains(err.Error(), "binary") {
		t.Fatalf("binary error=%v", err)
	}
	if _, err := service.ReadFile(context.Background(), ReadFileInput{Path: "src/main.go", Revision: "head", StartLine: 1, EndLine: limits.FileRangeLines + 1}); err == nil {
		t.Fatal("unbounded range was accepted")
	}
}

func TestSearchUsesLiteralQueryAndValidatesInput(t *testing.T) {
	reader := &fakeObjectReader{matches: []SearchMatch{{Path: "src/main.go", Line: 2, Content: "needle"}}}
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", reader)
	defer func() { _ = lease.Close() }()
	out, err := service.SearchSnapshot(context.Background(), SearchInput{Query: "-n --fixed literal", Revision: "head"})
	if err != nil || len(out.Matches) != 1 || reader.query != "-n --fixed literal" {
		t.Fatalf("output=%+v query=%q err=%v", out, reader.query, err)
	}
	if _, err := service.SearchSnapshot(context.Background(), SearchInput{Query: "x", Revision: "head"}); err == nil {
		t.Fatal("short broad query was accepted")
	}
}

func TestExplainDiffOmissionsAcceptsBoundedReasonsBestEffort(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	out, err := service.ExplainDiffOmissions(context.Background(), ExplainDiffOmissionsInput{Decisions: []DiffOmissionInput{
		{FileID: "f000001", Category: "documentation", Reason: "  README-only guidance; no runtime behavior changed.  "},
		{FileID: "missing", Category: "not_relevant", Reason: "Unknown file."},
		{FileID: "f000001", Category: "other", Reason: "Duplicate decision."},
		{FileID: "f000001", Category: "invalid", Reason: "Invalid category."},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if out.Recorded != 1 || out.Ignored != 3 || len(out.Decisions) != 1 || out.Decisions[0].Reason != "README-only guidance; no runtime behavior changed." {
		t.Fatalf("output=%+v", out)
	}
	records := service.AccessRecords()
	if len(records) != 1 || records[0].Tool != "explain_diff_omissions" || !records[0].Success {
		t.Fatalf("records=%+v", records)
	}
}

func TestExplainDiffOmissionsRejectsUnboundedCallsWithoutChargingRepositoryBytes(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	for _, decisions := range [][]DiffOmissionInput{
		nil,
		make([]DiffOmissionInput, 101),
	} {
		if _, err := service.ExplainDiffOmissions(context.Background(), ExplainDiffOmissionsInput{Decisions: decisions}); err == nil {
			t.Fatalf("accepted %d decisions", len(decisions))
		}
	}
	for _, decision := range []DiffOmissionInput{
		{FileID: "f000001", Category: "other", Reason: strings.Repeat("x", 321)},
		{FileID: "f000001", Category: "other", Reason: "Visual order \u202espoof."},
		{FileID: "f000001", Category: "invalid", Reason: "Invalid category."},
	} {
		out, err := service.ExplainDiffOmissions(context.Background(), ExplainDiffOmissionsInput{Decisions: []DiffOmissionInput{decision}})
		if err != nil || out.Recorded != 0 || out.Ignored != 1 {
			t.Fatalf("invalid decision=%+v output=%+v err=%v", decision, out, err)
		}
	}
	if coverage := service.Coverage(); coverage.BytesServed != 0 {
		t.Fatalf("advisory metadata consumed repository-byte budget: %+v", coverage)
	}
}

func TestContextBudgetsFailClosed(t *testing.T) {
	limits := analysisbundle.DefaultLimits()
	limits.MaxCalls = 1
	service, lease := fixtureService(t, limits, "patch", &fakeObjectReader{})
	defer func(lease *analysisbundle.Lease) { _ = lease.Close() }(lease)
	if _, err := service.ListChanges(context.Background(), ListChangesInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ListChanges(context.Background(), ListChangesInput{}); !errors.Is(err, ErrCallBudget) {
		t.Fatalf("second call error=%v", err)
	}

	limits = analysisbundle.DefaultLimits()
	limits.PageBytes = 1024
	limits.MaxServedBytes = 1024
	service, lease = fixtureService(t, limits, strings.Repeat("x", 3000), &fakeObjectReader{})
	defer func(lease *analysisbundle.Lease) { _ = lease.Close() }(lease)
	if _, err := service.ReadDiff(context.Background(), ReadDiffInput{FileID: "f000001"}); !errors.Is(err, ErrByteBudget) {
		t.Fatalf("byte budget error=%v", err)
	}
}

func TestMCPServerExposesOnlyAnnotatedReadTools(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	server := Server(service, io.Discard)
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(context.Background(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = serverSession.Close() }()
	clientSession, err := client.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = clientSession.Close() }()
	result, err := clientSession.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Tools) != len(ToolNames) {
		t.Fatalf("tools=%v", result.Tools)
	}
	want := make(map[string]bool, len(ToolNames))
	for _, name := range ToolNames {
		want[name] = true
	}
	for _, tool := range result.Tools {
		if !want[tool.Name] || tool.Annotations == nil || !tool.Annotations.ReadOnlyHint || tool.Annotations.OpenWorldHint == nil || *tool.Annotations.OpenWorldHint || tool.Annotations.DestructiveHint == nil || *tool.Annotations.DestructiveHint {
			t.Fatalf("tool=%+v", tool)
		}
		if tool.Name == "explain_diff_omissions" {
			assertDiffOmissionSchema(t, tool.InputSchema)
		}
		delete(want, tool.Name)
	}
	if len(want) != 0 {
		t.Fatalf("missing tools=%v", want)
	}
}

func assertDiffOmissionSchema(t *testing.T, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Required   []string `json:"required"`
		Properties map[string]struct {
			MinItems int `json:"minItems"`
			MaxItems int `json:"maxItems"`
			Items    struct {
				Required   []string `json:"required"`
				Properties map[string]struct {
					Enum      []string `json:"enum"`
					MinLength int      `json:"minLength"`
					MaxLength int      `json:"maxLength"`
				} `json:"properties"`
			} `json:"items"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	decisions := schema.Properties["decisions"]
	if !slices.Equal(schema.Required, []string{"decisions"}) || decisions.MinItems != 1 || decisions.MaxItems != 100 || !slices.Equal(decisions.Items.Required, []string{"fileId", "category", "reason"}) {
		t.Fatalf("schema=%s", data)
	}
	category, reason := decisions.Items.Properties["category"], decisions.Items.Properties["reason"]
	if len(category.Enum) != 8 || reason.MinLength != 1 || reason.MaxLength != 240 {
		t.Fatalf("schema=%s", data)
	}
}

func TestMCPServerAcceptsDiffOmissionProvenance(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	server := Server(service, io.Discard)
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(context.Background(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = serverSession.Close() }()
	clientSession, err := client.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = clientSession.Close() }()

	result, err := clientSession.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "explain_diff_omissions",
		Arguments: map[string]any{"decisions": []any{map[string]any{
			"fileId": "f000001", "category": "documentation", "reason": "README-only guidance; no runtime behavior changed.",
		}}},
	})
	if err != nil || result.IsError {
		t.Fatalf("CallTool result=%+v err=%v", result, err)
	}
	records := service.AccessRecords()
	if len(records) != 1 || records[0].Tool != "explain_diff_omissions" || !records[0].Success {
		t.Fatalf("records=%+v", records)
	}
}

func TestServeWritesOnlyProtocolToStdout(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer func() { _ = lease.Close() }()
	input := "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1\"}}}\n"
	stdinReader, stdinWriter := io.Pipe()
	stdoutReader, stdoutWriter := io.Pipe()
	var stderr bytes.Buffer
	done := make(chan error, 1)
	go func() { done <- Serve(context.Background(), service, stdinReader, stdoutWriter, &stderr) }()
	if _, err := io.WriteString(stdinWriter, input); err != nil {
		t.Fatal(err)
	}
	response, err := bufio.NewReader(stdoutReader).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	_ = stdinWriter.Close()
	_ = stdoutWriter.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(response, "{\"jsonrpc\":\"2.0\"") || strings.Contains(response, "level=") {
		t.Fatalf("stdout=%q stderr=%q", response, stderr.String())
	}
}
