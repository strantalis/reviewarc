package main

import (
	"testing"

	"reviewarc/internal/domain"
)

func deltaSession() domain.ReviewSession {
	analysis := &domain.ReviewAnalysis{
		BaseSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		HeadSHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		Judgments: []domain.ReviewJudgment{
			{
				ID:    "j1",
				Title: "Retry exhaustion can drop webhooks",
				Observations: []domain.ReviewObservation{
					{ID: "o1", Evidence: []domain.EvidenceReference{{Path: "internal/webhooks/retry.go", StartLine: 10, EndLine: 20}}},
					{ID: "o2", Evidence: []domain.EvidenceReference{{Path: "internal/webhooks/retry.go", StartLine: 30, EndLine: 40}}},
				},
			},
			{
				ID:    "j2",
				Title: "Idempotency coverage is unclear",
				Observations: []domain.ReviewObservation{
					{ID: "o3", Evidence: []domain.EvidenceReference{{Path: "internal/webhooks/dedupe.go"}}},
				},
			},
		},
	}
	return domain.ReviewSession{
		BaseSHA:  "cccccccccccccccccccccccccccccccccccccccc",
		HeadSHA:  "dddddddddddddddddddddddddddddddddddddddd",
		IsStale:  true,
		Analysis: analysis,
		Comments: []domain.ReviewComment{
			{ID: "draft", Kind: domain.CommentInline, Status: domain.CommentDraft, Path: "internal/webhooks/config.go"},
			{ID: "published", Kind: domain.CommentInline, Status: domain.CommentPublished, Path: "internal/webhooks/other.go"},
			{ID: "general", Kind: domain.CommentGeneral, Status: domain.CommentDraft},
		},
	}
}

func TestBuildRevisionDeltaAnnotatesAndSortsFiles(t *testing.T) {
	t.Parallel()
	session := deltaSession()
	files := []domain.ChangedFile{
		{Path: "README.md", Status: domain.FileModified},
		{Path: "internal/webhooks/config.go", Status: domain.FileModified},
		{Path: "internal/webhooks/retry.go", Status: domain.FileModified},
		{Path: "internal/webhooks/other.go", Status: domain.FileModified},
	}
	commits := []domain.Commit{{SHA: "dddddddddddddddddddddddddddddddddddddddd", Message: "fix retry"}}

	delta := buildRevisionDelta(session, session.Analysis.HeadSHA, session.HeadSHA, files, commits, 3)

	if !delta.Available {
		t.Fatalf("delta should be available: %+v", delta)
	}
	if !delta.BaseChanged {
		t.Fatal("base moved between analysis and session; BaseChanged should be true")
	}
	if delta.CommitCount != 3 || len(delta.Commits) != 1 {
		t.Fatalf("commit metadata lost: %+v", delta)
	}
	if len(delta.Files) != 4 {
		t.Fatalf("expected 4 files, got %d", len(delta.Files))
	}
	if delta.Files[0].File.Path != "internal/webhooks/retry.go" {
		t.Fatalf("cited file should sort first, got %s", delta.Files[0].File.Path)
	}
	if got := delta.Files[0].CitedByFindings; len(got) != 1 || got[0] != "Retry exhaustion can drop webhooks" {
		t.Fatalf("duplicate finding titles should be deduped, got %v", got)
	}
	if delta.Files[1].File.Path != "internal/webhooks/config.go" || !delta.Files[1].HasDraftComment {
		t.Fatalf("draft-annotated file should sort second, got %+v", delta.Files[1])
	}
	for _, file := range delta.Files[2:] {
		if len(file.CitedByFindings) != 0 || file.HasDraftComment {
			t.Fatalf("unannotated files should carry no badges: %+v", file)
		}
	}
}

func TestBuildRevisionDeltaTracksRenamedPaths(t *testing.T) {
	t.Parallel()
	session := deltaSession()
	files := []domain.ChangedFile{
		{Path: "internal/webhooks/retry_v2.go", PreviousPath: "internal/webhooks/retry.go", Status: domain.FileRenamed},
	}

	delta := buildRevisionDelta(session, session.Analysis.HeadSHA, session.HeadSHA, files, nil, 1)

	if got := delta.Files[0].CitedByFindings; len(got) != 1 || got[0] != "Retry exhaustion can drop webhooks" {
		t.Fatalf("rename should keep the previous path's finding link, got %v", got)
	}
}

func TestFindingTitlesByPathFallsBackToLegacyFindings(t *testing.T) {
	t.Parallel()
	analysis := &domain.ReviewAnalysis{
		Risks:    []domain.ReviewRisk{{Title: "Top-level risk", Evidence: []domain.EvidenceReference{{Path: "a.go"}}}},
		Unknowns: []domain.Claim{{Text: "Unresolved question", Evidence: []domain.EvidenceReference{{Path: "b.go"}}}},
		Chapters: []domain.ReviewChapter{{
			Risks:    []domain.ReviewRisk{{Title: "Chapter risk", Evidence: []domain.EvidenceReference{{Path: "c.go"}}}},
			Unknowns: []domain.Claim{{Text: "Chapter unknown", Evidence: []domain.EvidenceReference{{Path: "a.go"}}}},
		}},
	}

	index := findingTitlesByPath(analysis)

	if got := index["a.go"]; len(got) != 2 {
		t.Fatalf("a.go should collect both top-level risk and chapter unknown, got %v", got)
	}
	if got := index["b.go"]; len(got) != 1 || got[0] != "Unresolved question" {
		t.Fatalf("unknowns should index by text, got %v", got)
	}
	if got := index["c.go"]; len(got) != 1 || got[0] != "Chapter risk" {
		t.Fatalf("chapter risks should be indexed, got %v", got)
	}
	if got := findingTitlesByPath(nil); len(got) != 0 {
		t.Fatalf("nil analysis should produce an empty index, got %v", got)
	}
}
