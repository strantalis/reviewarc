package persistence

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"reviewarc/internal/domain"
)

func TestMigrationsAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "reviewarc.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := s.SetSetting(ctx, "account", map[string]string{"login": "sean"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var account map[string]string
	if err := s.GetSetting(ctx, "account", &account); err != nil {
		t.Fatal(err)
	}
	if account["login"] != "sean" {
		t.Fatalf("account = %#v", account)
	}
	var applied int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied != 1 {
		t.Fatalf("applied migrations = %d", applied)
	}
}

func TestSelectionsReplaceAndPersist(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	want := []domain.SourceSelection{{Kind: domain.SelectionRepository, Key: "openai/codex", Enabled: true}, {Kind: domain.SelectionOrganization, Key: "openai", Enabled: false}}
	if err := s.ReplaceSelections(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListSelections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Key != "openai" || got[1].Key != "openai/codex" {
		t.Fatalf("selections = %#v", got)
	}
	if err := s.ReplaceSelections(ctx, want[1:]); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ListSelections(ctx)
	if len(got) != 1 || got[0].Key != "openai" {
		t.Fatalf("replaced selections = %#v", got)
	}
}

func TestSessionAnalysisProgressNotesAndComments(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	analysis := domain.ReviewAnalysis{SchemaVersion: 1, BaseSHA: "base", HeadSHA: "head", Summary: "safe refactor", CreatedAt: time.Now(), Chapters: []domain.ReviewChapter{{ID: "flow"}, {ID: "tests"}}}
	if err := s.SaveAnalysis(ctx, session.ID, analysis); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "flow", domain.ChapterReviewed); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "tests", domain.ChapterBlocked); err != nil {
		t.Fatal(err)
	}
	note := domain.ReviewNote{ID: "note-1", SessionID: session.ID, ChapterID: "flow", Body: "Check retry semantics"}
	if err := s.SaveNote(ctx, note); err != nil {
		t.Fatal(err)
	}
	line := 42
	comment := domain.ReviewComment{ID: "comment-1", SessionID: session.ID, ChapterID: "flow", Kind: domain.CommentInline, Body: "Could this race?", Path: "internal/store.go", Line: &line, Side: domain.DiffSideRight, Status: domain.CommentDraft}
	if err := s.SaveComment(ctx, comment); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Analysis == nil || got.Analysis.Summary != "safe refactor" {
		t.Fatalf("analysis = %#v", got.Analysis)
	}
	if got.Progress.Total != 2 || got.Progress.Reviewed != 1 || got.Progress.Blocked != 1 || got.Progress.Percent != 50 {
		t.Fatalf("progress = %#v", got.Progress)
	}
	if len(got.Notes) != 1 || got.Notes[0].Body != note.Body {
		t.Fatalf("notes = %#v", got.Notes)
	}
	if len(got.Comments) != 1 || got.Comments[0].Line == nil || *got.Comments[0].Line != 42 {
		t.Fatalf("comments = %#v", got.Comments)
	}
	if err := s.SetCommentPublication(ctx, comment.ID, domain.CommentPublished, "991", "https://github.test/comment/991"); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Comments[0].Status != domain.CommentPublished || got.Comments[0].GitHubID != "991" {
		t.Fatalf("published comment = %#v", got.Comments[0])
	}
	sessions, err := s.ListSessions(ctx)
	if err != nil || len(sessions) != 1 {
		t.Fatalf("list sessions = %#v, %v", sessions, err)
	}
	latest, err := s.LatestSessionForPullRequest(ctx, session.PullRequest.Ref)
	if err != nil || latest.ID != session.ID {
		t.Fatalf("latest session = %#v, %v", latest, err)
	}
}

func TestStaleDetectionPreservesReviewerState(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "flow", domain.ChapterInProgress); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveNote(ctx, domain.ReviewNote{ID: "n", SessionID: session.ID, Body: "private"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveComment(ctx, domain.ReviewComment{ID: "draft", SessionID: session.ID, Kind: domain.CommentGeneral, Body: "not published", Status: domain.CommentDraft}); err != nil {
		t.Fatal(err)
	}
	changed, err := s.MarkStaleIfChanged(ctx, session.PullRequest.Ref, "base", "head")
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("unchanged revision marked stale")
	}
	changed, err = s.MarkStaleIfChanged(ctx, session.PullRequest.Ref, "base", "new-head")
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("changed revision not marked stale")
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsStale || got.AnalysisStatus != domain.AnalysisStale {
		t.Fatalf("stale state = %#v", got)
	}
	if len(got.Notes) != 1 || len(got.Chapters) != 1 || len(got.Comments) != 1 || got.Comments[0].Status != domain.CommentDraft {
		t.Fatalf("reviewer state lost: notes=%#v chapters=%#v comments=%#v", got.Notes, got.Chapters, got.Comments)
	}
}

func TestRecoverInterruptedAnalysesMakesRestartRetryable(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
	session := domain.ReviewSession{ID: "interrupted", PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 9}}}, BaseSHA: "base", HeadSHA: "head", Status: domain.SessionReady, AnalysisStatus: domain.AnalysisRunning}
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	count, err := s.RecoverInterruptedAnalyses(ctx)
	if err != nil || count != 1 {
		t.Fatalf("recovery count=%d err=%v", count, err)
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.AnalysisStatus != domain.AnalysisFailed {
		t.Fatalf("analysis status=%q", got.AnalysisStatus)
	}
}

func TestReconcileChapterProgressPreservesStableIDs(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "stable", domain.ChapterReviewed); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "removed", domain.ChapterBlocked); err != nil {
		t.Fatal(err)
	}
	if err := s.ReconcileChapterProgress(ctx, session.ID, []domain.ReviewChapter{{ID: "stable"}, {ID: "new"}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]domain.ChapterStatus{}
	for _, progress := range got.Chapters {
		statuses[progress.ChapterID] = progress.Status
	}
	if len(statuses) != 2 || statuses["stable"] != domain.ChapterReviewed || statuses["new"] != domain.ChapterNotReviewed {
		t.Fatalf("reconciled statuses=%v", statuses)
	}
}

func TestSaveCompletedAnalysisAtomicallyReconcilesProgress(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "stable", domain.ChapterReviewed); err != nil {
		t.Fatal(err)
	}
	if err := s.SetChapterStatus(ctx, session.ID, "removed", domain.ChapterBlocked); err != nil {
		t.Fatal(err)
	}
	analysis := domain.ReviewAnalysis{SchemaVersion: 1, BaseSHA: session.BaseSHA, HeadSHA: session.HeadSHA, Summary: "complete", Chapters: []domain.ReviewChapter{{ID: "stable"}, {ID: "new"}}}
	if err := s.SaveCompletedAnalysis(ctx, session.ID, analysis); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]domain.ChapterStatus{}
	for _, progress := range got.Chapters {
		statuses[progress.ChapterID] = progress.Status
	}
	if got.AnalysisStatus != domain.AnalysisReady || got.Analysis == nil || got.Analysis.Summary != "complete" {
		t.Fatalf("completed analysis was not saved: %+v", got)
	}
	if len(statuses) != 2 || statuses["stable"] != domain.ChapterReviewed || statuses["new"] != domain.ChapterNotReviewed {
		t.Fatalf("completed analysis statuses=%v", statuses)
	}
}

func TestReviewProgressCountsEveryStatus(t *testing.T) {
	items := []domain.ChapterProgress{
		{Status: domain.ChapterNotReviewed},
		{Status: domain.ChapterInProgress},
		{Status: domain.ChapterReviewed},
		{Status: domain.ChapterReviewed},
		{Status: domain.ChapterBlocked},
		{Status: domain.ChapterNeedsClarification},
	}
	got := calculateProgress(items)
	if got.Total != 6 || got.Reviewed != 2 || got.Blocked != 1 || got.Clarify != 1 || got.Percent != 33 {
		t.Fatalf("progress=%+v", got)
	}
}

func TestOnlyDraftCommentsCanBeDeletedAndPublicationStatusIsValidated(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	draft := domain.ReviewComment{ID: "draft", SessionID: session.ID, Kind: domain.CommentGeneral, Body: "draft", Status: domain.CommentDraft}
	published := domain.ReviewComment{ID: "published", SessionID: session.ID, Kind: domain.CommentGeneral, Body: "published", Status: domain.CommentPublished, GitHubID: "10"}
	for _, comment := range []domain.ReviewComment{draft, published} {
		if err := s.SaveComment(ctx, comment); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.DeleteComment(ctx, draft.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteComment(ctx, published.ID); err != nil {
		t.Fatal(err)
	}
	comments, err := s.ListComments(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 1 || comments[0].ID != published.ID {
		t.Fatalf("comments=%+v", comments)
	}
	if err := s.SetCommentPublication(ctx, published.ID, domain.CommentDraft, "", ""); err == nil {
		t.Fatal("publication accepted draft status")
	}
}

func TestCorruptJSONIsIsolated(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveAnalysis(ctx, session.ID, domain.ReviewAnalysis{SchemaVersion: 1, BaseSHA: "base", HeadSHA: "head"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE analyses SET analysis_json='{broken' WHERE session_id=?`, session.ID); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Analysis != nil || got.AnalysisStatus != domain.AnalysisFailed {
		t.Fatalf("corrupt analysis was trusted: %#v", got)
	}
	if err := s.SetSetting(ctx, "broken", map[string]string{"ok": "yes"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE settings SET value_json='{broken' WHERE key='broken'`); err != nil {
		t.Fatal(err)
	}
	var value any
	if err := s.GetSetting(ctx, "broken", &value); err == nil {
		t.Fatal("corrupt setting was trusted")
	}
	if err := s.GetSetting(ctx, "absent", &value); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing setting error = %v", err)
	}
}

func TestInvalidChapterStatusRejected(t *testing.T) {
	s := openTestStore(t)
	if err := s.SetChapterStatus(context.Background(), "missing", "chapter", domain.ChapterStatus("done")); err == nil {
		t.Fatal("invalid status accepted")
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	return s
}

func testSession() domain.ReviewSession {
	ref := domain.RepositoryRef{Host: "github.com", Owner: "OpenAI", Name: "Codex", CloneURL: "https://github.com/openai/codex.git"}
	pr := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 123}, Title: "Make reviews local"}, BaseSHA: "base", HeadSHA: "head", BaseRef: "main", HeadRef: "feature"}
	return domain.ReviewSession{ID: "session-1", PullRequest: pr, BaseSHA: "base", HeadSHA: "head", Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
}
