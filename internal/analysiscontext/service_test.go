package analysiscontext

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
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
	defer lease.Close()
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

func TestReadFileBoundsAndRejectsBinary(t *testing.T) {
	limits := analysisbundle.DefaultLimits()
	reader := &fakeObjectReader{files: map[string]string{"head:src/main.go": "one\ntwo\nthree\nfour\n"}, binary: map[string]bool{"base:bin.dat": true}}
	service, lease := fixtureService(t, limits, "patch", reader)
	defer lease.Close()
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
	defer lease.Close()
	out, err := service.SearchSnapshot(context.Background(), SearchInput{Query: "-n --fixed literal", Revision: "head"})
	if err != nil || len(out.Matches) != 1 || reader.query != "-n --fixed literal" {
		t.Fatalf("output=%+v query=%q err=%v", out, reader.query, err)
	}
	if _, err := service.SearchSnapshot(context.Background(), SearchInput{Query: "x", Revision: "head"}); err == nil {
		t.Fatal("short broad query was accepted")
	}
}

func TestContextBudgetsFailClosed(t *testing.T) {
	limits := analysisbundle.DefaultLimits()
	limits.MaxCalls = 1
	service, lease := fixtureService(t, limits, "patch", &fakeObjectReader{})
	defer lease.Close()
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
	defer lease.Close()
	if _, err := service.ReadDiff(context.Background(), ReadDiffInput{FileID: "f000001"}); !errors.Is(err, ErrByteBudget) {
		t.Fatalf("byte budget error=%v", err)
	}
}

func TestMCPServerExposesOnlyAnnotatedReadTools(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer lease.Close()
	server := Server(service, io.Discard)
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(context.Background(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serverSession.Close()
	clientSession, err := client.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer clientSession.Close()
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
		delete(want, tool.Name)
	}
	if len(want) != 0 {
		t.Fatalf("missing tools=%v", want)
	}
}

func TestServeWritesOnlyProtocolToStdout(t *testing.T) {
	service, lease := fixtureService(t, analysisbundle.DefaultLimits(), "patch", &fakeObjectReader{})
	defer lease.Close()
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
