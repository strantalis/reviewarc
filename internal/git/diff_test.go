package git

import (
	"testing"

	"reviewarc/internal/domain"
)

func TestParsePatchTracksLinesAndNoNewline(t *testing.T) {
	patch := []byte("diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n\\ No newline at end of file\n")
	got, err := ParsePatch(domain.ChangedFile{Path: "a.txt"}, patch)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Hunks) != 1 || len(got.Hunks[0].Lines) != 4 {
		t.Fatalf("unexpected hunks: %#v", got.Hunks)
	}
	if got.Patch != string(patch) {
		t.Fatal("raw validated patch was not retained for the renderer")
	}
	if got.Hunks[0].Lines[1].OldLine == nil || *got.Hunks[0].Lines[1].OldLine != 2 || got.Hunks[0].Lines[2].NewLine == nil || *got.Hunks[0].Lines[2].NewLine != 2 {
		t.Fatalf("wrong line mapping: %#v", got.Hunks[0].Lines)
	}
}

func TestParsePatchRejectsMismatchedCounts(t *testing.T) {
	_, err := ParsePatch(domain.ChangedFile{Path: "a.txt"}, []byte("@@ -1,2 +1,1 @@\n-only\n"))
	if err == nil {
		t.Fatal("expected malformed hunk error")
	}
}

func TestParsePatchBinary(t *testing.T) {
	got, err := ParsePatch(domain.ChangedFile{Path: "x.bin"}, []byte("Binary files a/x.bin and b/x.bin differ\n"))
	if err != nil {
		t.Fatal(err)
	}
	if !got.File.IsBinary || len(got.Hunks) != 0 {
		t.Fatalf("unexpected binary result: %#v", got)
	}
}
