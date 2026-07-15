package agent

import (
	"encoding/json"
	"reflect"
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
		{`{"fileId":"f000001","cursor":40}`, `{"bytes":60,"hasMore":false}`},
		{`{"fileId":"f000001","cursor":0}`, `{"bytes":60,"hasMore":true}`},
		{`{"fileId":"f000002","cursor":10}`, `{"bytes":20,"hasMore":true}`},
	} {
		if err := tracker.Record("read_diff", json.RawMessage(record.args), json.RawMessage(record.result)); err != nil {
			t.Fatal(err)
		}
	}
	coverage := tracker.Coverage()
	if coverage.ChangedFilesTotal != 3 || coverage.DiffFilesFullyRead != 1 || coverage.DiffFilesPartiallyRead != 1 || coverage.DiffFilesUnread != 1 {
		t.Fatalf("coverage=%+v", coverage)
	}
	if coverage.DiffBytesTotal != 175 || coverage.DiffBytesRead != 120 || coverage.Segments != 3 {
		t.Fatalf("byte coverage=%+v", coverage)
	}
	if !reflect.DeepEqual(coverage.OmittedPaths, []string{"src/third.go"}) {
		t.Fatalf("omitted=%v", coverage.OmittedPaths)
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
		{"read_diff", `{"fileId":"missing"}`, `{"bytes":1}`},
		{"read_diff", `{"fileId":"f000001","cursor":101}`, `{"bytes":1}`},
	} {
		tracker := NewAccessTracker(accessManifest())
		if err := tracker.Record(test.tool, json.RawMessage(test.args), json.RawMessage(test.result)); err == nil {
			t.Fatalf("accepted tool=%s args=%s", test.tool, test.args)
		}
	}
}
