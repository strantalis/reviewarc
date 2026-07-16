package agent

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
)

func accessManifest() analysisbundle.Manifest {
	return analysisbundle.Manifest{Changes: []analysisbundle.Change{
		{ID: "f000001", Path: "src/first.go", Diff: analysisbundle.Artifact{Bytes: 100}},
		{ID: "f000002", Path: "src/second.go", Diff: analysisbundle.Artifact{Bytes: 50}},
		{ID: "f000003", Path: "src/third.go", Diff: analysisbundle.Artifact{Bytes: 25}},
	}}
}

func TestAccessTrackerReconstructsPagedCoverageWithoutDoubleCounting(t *testing.T) {
	tracker := NewAccessTracker(accessManifest())
	for _, record := range []struct {
		args   string
		result string
	}{
		{`{"cursor":0}`, `{"changes":[{"id":"f000001"},{"id":"f000002"},{"id":"f000003"}],"hasMore":false}`},
		{`{"fileId":"f000001","cursor":40}`, `{"bytes":60,"hasMore":false}`},
		{`{"fileId":"f000001","cursor":0}`, `{"bytes":60,"hasMore":true}`},
		{`{"fileId":"f000002","cursor":10}`, `{"bytes":20,"hasMore":true}`},
	} {
		tool := "read_diff"
		if strings.Contains(record.result, `"changes"`) {
			tool = "list_changes"
		}
		if err := tracker.Record(tool, json.RawMessage(record.args), json.RawMessage(record.result)); err != nil {
			t.Fatal(err)
		}
	}
	coverage := tracker.Coverage()
	if coverage.ChangedFilesTotal != 3 || coverage.DiffFilesFullyRead != 1 || coverage.DiffFilesPartiallyRead != 1 || coverage.DiffFilesPreviewed != 1 || coverage.DiffFilesUnseen != 0 || coverage.DiffFilesUnread != 1 {
		t.Fatalf("coverage=%+v", coverage)
	}
	if coverage.DiffBytesTotal != 175 || coverage.DiffBytesRead != 120 || coverage.Segments != 3 {
		t.Fatalf("byte coverage=%+v", coverage)
	}
	if !reflect.DeepEqual(coverage.OmittedPaths, []string{"src/third.go"}) {
		t.Fatalf("omitted=%v", coverage.OmittedPaths)
	}
	if !reflect.DeepEqual(coverage.PreviewedPaths, []string{"src/third.go"}) || len(coverage.UnseenPaths) != 0 {
		t.Fatalf("previewed=%v unseen=%v", coverage.PreviewedPaths, coverage.UnseenPaths)
	}
}

func TestAccessTrackerInventoriesLargePullRequestInPagedBatches(t *testing.T) {
	manifest := analysisbundle.Manifest{Changes: make([]analysisbundle.Change, 171)}
	for index := range manifest.Changes {
		manifest.Changes[index] = analysisbundle.Change{ID: fmt.Sprintf("f%06d", index+1), Path: fmt.Sprintf("src/file-%03d.go", index+1), Diff: analysisbundle.Artifact{Bytes: 100}}
	}
	tracker := NewAccessTracker(manifest)
	for start, end := 0, 100; start < len(manifest.Changes); start, end = end, min(end+100, len(manifest.Changes)) {
		changes := make([]map[string]string, 0, end-start)
		for _, change := range manifest.Changes[start:end] {
			changes = append(changes, map[string]string{"id": change.ID, "preview": "+bounded change"})
		}
		result, err := json.Marshal(map[string]any{"changes": changes, "hasMore": end < len(manifest.Changes), "nextCursor": end})
		if err != nil {
			t.Fatal(err)
		}
		if err := tracker.Record("list_changes", json.RawMessage(fmt.Sprintf(`{"cursor":%d}`, start)), result); err != nil {
			t.Fatal(err)
		}
	}
	coverage := tracker.Coverage()
	if coverage.DiffFilesPreviewed != 171 || coverage.DiffFilesUnseen != 0 || len(coverage.PreviewedPaths) != 171 {
		t.Fatalf("coverage=%+v", coverage)
	}
}

func TestAccessTrackerReconcilesAcknowledgedPreviewDecisions(t *testing.T) {
	tracker := NewAccessTracker(accessManifest())
	if err := tracker.Record("list_changes", json.RawMessage(`{"cursor":0}`), json.RawMessage(`{"changes":[{"id":"f000001"},{"id":"f000002"},{"id":"f000003"}],"hasMore":false}`)); err != nil {
		t.Fatal(err)
	}
	result := json.RawMessage(`{"recorded":2,"ignored":0,"decisions":[{"fileId":"f000003","category":"documentation","reason":"Documentation-only update."},{"fileId":"f000001","category":"covered_elsewhere","reason":"Behavior is covered by the implementation diff."}]}`)
	if err := tracker.Record("explain_diff_omissions", nil, result); err != nil {
		t.Fatal(err)
	}
	if err := tracker.Record("read_diff", json.RawMessage(`{"fileId":"f000001","cursor":0}`), json.RawMessage(`{"bytes":50,"hasMore":true}`)); err != nil {
		t.Fatal(err)
	}
	coverage := tracker.Coverage()
	if coverage.DiffFilesPartiallyRead != 1 || coverage.DiffFilesPreviewed != 2 || len(coverage.PreviewDecisions) != 1 {
		t.Fatalf("coverage=%+v", coverage)
	}
	decision := coverage.PreviewDecisions[0]
	if decision.Path != "src/third.go" || decision.Category != domain.DiffOmissionDocumentation || decision.Reason != "Documentation-only update." {
		t.Fatalf("decision=%+v", decision)
	}
}

func TestAccessTrackerIgnoresMalformedAdvisoryDecisions(t *testing.T) {
	tracker := NewAccessTracker(accessManifest())
	if err := tracker.Record("list_changes", nil, json.RawMessage(`{"changes":[{"id":"f000001"}],"hasMore":false}`)); err != nil {
		t.Fatal(err)
	}
	for _, result := range []string{
		`{"recorded":1,"decisions":[{"fileId":"missing","category":"other","reason":"Unknown."}]}`,
		`{"recorded":2,"decisions":[{"fileId":"f000001","category":"other","reason":"One."}]}`,
		`{"recorded":1,"decisions":[{"fileId":"f000001","category":"other","reason":"bad\nreason"}]}`,
		`{"recorded":1,"decisions":[{"fileId":"f000001","category":"other","reason":"Visual order \u202espoof."}]}`,
	} {
		if err := tracker.Record("explain_diff_omissions", nil, json.RawMessage(result)); err != nil {
			t.Fatalf("advisory event failed analysis: %v", err)
		}
	}
	coverage := tracker.Coverage()
	if coverage.DiffFilesPreviewed != 1 || len(coverage.PreviewDecisions) != 0 {
		t.Fatalf("coverage=%+v", coverage)
	}
}

func TestAccessTrackerPersistsBoundedFileAndSearchMetadata(t *testing.T) {
	tracker := NewAccessTracker(accessManifest())
	if err := tracker.Record("read_file", json.RawMessage(`{"path":"src/first.go","revision":"head","startLine":10,"endLine":20}`), json.RawMessage(`{"content":"three lines","endLine":12}`)); err != nil {
		t.Fatal(err)
	}
	if err := tracker.Record("search_snapshot", json.RawMessage(`{"query":"needle","revision":"base"}`), json.RawMessage(`{"matches":[]}`)); err != nil {
		t.Fatal(err)
	}
	coverage := tracker.Coverage()
	if len(coverage.Accesses) != 2 {
		t.Fatalf("accesses=%+v", coverage.Accesses)
	}
	file := coverage.Accesses[0]
	if file.Kind != "read_file" || file.Path != "src/first.go" || file.Revision != domain.RevisionHead || file.StartLine != 10 || file.EndLine != 12 || file.Bytes != len("three lines") {
		t.Fatalf("file access=%+v", file)
	}
	if search := coverage.Accesses[1]; search.Kind != "search_snapshot" || search.Revision != domain.RevisionBase || search.Bytes == 0 {
		t.Fatalf("search access=%+v", search)
	}
}

func TestAccessTrackerRejectsUnknownToolsFilesAndRanges(t *testing.T) {
	for _, test := range []struct {
		tool, args, result string
	}{
		{"exec_command", `{}`, `{}`},
		{"list_changes", `{}`, `{"changes":[{"id":"missing"}]}`},
		{"read_diff", `{"fileId":"missing"}`, `{"bytes":1}`},
		{"read_diff", `{"fileId":"f000001","cursor":101}`, `{"bytes":1}`},
	} {
		tracker := NewAccessTracker(accessManifest())
		if err := tracker.Record(test.tool, json.RawMessage(test.args), json.RawMessage(test.result)); err == nil {
			t.Fatalf("accepted tool=%s args=%s", test.tool, test.args)
		}
	}
}

func TestContextActivityMessageDescribesOnlySafeToolMetadata(t *testing.T) {
	manifest := accessManifest()
	for _, test := range []struct {
		tool, args, want string
	}{
		{"list_changes", `{}`, "Listing changed files"},
		{"read_pr_context", `{"section":"discussion"}`, "Reading pull request discussion"},
		{"read_diff", `{"fileId":"f000001","cursor":0}`, "Reading diff for src/first.go"},
		{"read_file", `{"path":"src/first.go","revision":"head","startLine":10,"endLine":20}`, "Reading src/first.go lines 10–20"},
		{"search_snapshot", `{"query":"private search term","revision":"base"}`, "Searching the base repository snapshot"},
		{"explain_diff_omissions", `{"decisions":[{"reason":"private omission reason"}]}`, "Recording preview-only decisions"},
		{"exec_command", `{"command":"unsafe"}`, ""},
	} {
		got := ContextActivityMessage(test.tool, json.RawMessage(test.args), manifest)
		if got != test.want {
			t.Fatalf("ContextActivityMessage(%q)=%q, want %q", test.tool, got, test.want)
		}
		if strings.Contains(got, "private search term") {
			t.Fatalf("search term leaked into progress copy: %q", got)
		}
	}
}
