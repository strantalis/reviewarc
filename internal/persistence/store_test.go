package persistence

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
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
	defer func() {
		if err := s.Close(); err != nil {
			t.Errorf("close reopened store: %v", err)
		}
	}()
	var account map[string]string
	if err := s.GetSetting(ctx, "account", &account); err != nil {
		t.Fatal(err)
	}
	if account["login"] != "sean" {
		t.Fatalf("account = %#v", account)
	}
	var applied int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied != 6 {
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

func TestRepositoryOwnerCacheIsScopedLimitedAndExcludesArchived(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	repositories := []domain.Repository{
		{Ref: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "a"}},
		{Ref: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "b"}},
		{Ref: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "archive"}, IsArchived: true},
		{Ref: domain.RepositoryRef{Host: "github.com", Owner: "other", Name: "c"}},
	}
	if err := s.UpsertRepositories(ctx, repositories); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListRepositoriesByOwner(ctx, "ACME", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Ref.Name != "a" {
		t.Fatalf("repositories=%+v", got)
	}
	got, err = s.ListRepositoriesByOwner(ctx, "acme", 50)
	if err != nil || len(got) != 2 || got[1].Ref.Name != "b" {
		t.Fatalf("repositories=%+v error=%v", got, err)
	}
}

func TestListSelectedRepositoriesExcludesUnselectedRows(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	selected := domain.Repository{Ref: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, IsArchived: true}
	unrelated := domain.Repository{Ref: domain.RepositoryRef{Host: "github.com", Owner: "large-org", Name: "unrelated"}}
	if err := s.UpsertRepositories(ctx, []domain.Repository{selected, unrelated}); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceSelections(ctx, []domain.SourceSelection{{Kind: domain.SelectionRepository, Key: "ACME/API", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListSelectedRepositories(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Ref.Name != "api" || !got[0].IsArchived {
		t.Fatalf("repositories=%+v", got)
	}
}

func TestListPullRequestSummariesProjectsLatestReviewState(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
	pullRequest := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{
		Ref:            domain.PullRequestRef{Repository: ref, Number: 42},
		Title:          "Keep bootstrap local",
		AnalysisStatus: domain.AnalysisNotStarted,
		RiskLevel:      domain.RiskUnknown,
		BaseSHA:        "base",
		HeadSHA:        "head",
	}}
	if err := s.UpsertPullRequest(ctx, pullRequest); err != nil {
		t.Fatal(err)
	}
	session := domain.ReviewSession{ID: "latest", PullRequest: pullRequest, BaseSHA: "base", HeadSHA: "head", Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	analysis := domain.ReviewAnalysis{
		SchemaVersion: 1,
		BaseSHA:       "base",
		HeadSHA:       "head",
		Risks:         []domain.ReviewRisk{{ID: "risk", Level: domain.RiskHigh}},
		Chapters: []domain.ReviewChapter{
			{ID: "reviewed"},
			{ID: "blocked"},
			{ID: "clarify"},
		},
	}
	if err := s.SaveCompletedAnalysis(ctx, session.ID, analysis); err != nil {
		t.Fatal(err)
	}
	for id, status := range map[string]domain.ChapterStatus{
		"reviewed": domain.ChapterReviewed,
		"blocked":  domain.ChapterBlocked,
		"clarify":  domain.ChapterNeedsClarification,
	} {
		if err := s.SetChapterStatus(ctx, session.ID, id, status); err != nil {
			t.Fatal(err)
		}
	}

	items, err := s.ListPullRequestSummaries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("summaries=%d, want one", len(items))
	}
	got := items[0]
	if got.Title != pullRequest.Title || got.AnalysisStatus != domain.AnalysisReady || got.RiskLevel != domain.RiskHigh {
		t.Fatalf("summary=%+v", got)
	}
	wantProgress := domain.ReviewProgress{Total: 3, Reviewed: 1, Blocked: 1, Clarify: 1, Percent: 33}
	if got.Progress != wantProgress {
		t.Fatalf("progress=%+v, want %+v", got.Progress, wantProgress)
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
	startLine, line := 39, 42
	comment := domain.ReviewComment{ID: "comment-1", SessionID: session.ID, ChapterID: "flow", Kind: domain.CommentInline, Body: "Could this race?", Path: "internal/store.go", StartLine: &startLine, StartSide: domain.DiffSideRight, Line: &line, Side: domain.DiffSideRight, Status: domain.CommentDraft}
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
	if len(got.Comments) != 1 || got.Comments[0].StartLine == nil || *got.Comments[0].StartLine != 39 || got.Comments[0].StartSide != domain.DiffSideRight || got.Comments[0].Line == nil || *got.Comments[0].Line != 42 {
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
	run := domain.AnalysisRun{ID: "interrupted-run", SessionID: session.ID, Profile: domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "model", Reasoning: domain.ReasoningMedium}, ContextTransport: domain.ContextInline, SchemaVersion: 1, InputFingerprint: "fingerprint"}
	if err := s.StartAnalysisRun(ctx, run); err != nil {
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
	if got.LatestAnalysisRun == nil || got.LatestAnalysisRun.Status != domain.AnalysisRunFailed || got.LatestAnalysisRun.Failure == nil || got.LatestAnalysisRun.Failure.Code != domain.FailureInterrupted {
		t.Fatalf("recovered run=%+v", got.LatestAnalysisRun)
	}
}

func TestQueuedAnalysisRunsAreDurableClaimedFIFOAndCancellable(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	profile := domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "model", Reasoning: domain.ReasoningMedium}
	makeSession := func(id string, number int) domain.ReviewSession {
		ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
		return domain.ReviewSession{ID: id, PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: number}}}, BaseSHA: "base", HeadSHA: "head", Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
	}
	firstSession, secondSession := makeSession("queued-first", 1), makeSession("queued-second", 2)
	for _, session := range []domain.ReviewSession{firstSession, secondSession} {
		if err := s.SaveSession(ctx, session); err != nil {
			t.Fatal(err)
		}
	}
	first := domain.AnalysisRun{ID: "queued-run-1", SessionID: firstSession.ID, Profile: profile, ContextTransport: domain.ContextInline, SchemaVersion: 1, InputFingerprint: "first", Status: domain.AnalysisRunQueued, StartedAt: time.Now().Add(-time.Minute)}
	second := domain.AnalysisRun{ID: "queued-run-2", SessionID: secondSession.ID, Profile: profile, ContextTransport: domain.ContextInline, SchemaVersion: 1, InputFingerprint: "second", Status: domain.AnalysisRunQueued, StartedAt: time.Now()}
	if err := s.StartAnalysisRun(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := s.StartAnalysisRun(ctx, second); err != nil {
		t.Fatal(err)
	}
	if duplicate := s.StartAnalysisRun(ctx, domain.AnalysisRun{ID: "duplicate", SessionID: firstSession.ID, Profile: profile, ContextTransport: domain.ContextInline, SchemaVersion: 1, InputFingerprint: "duplicate", Status: domain.AnalysisRunQueued}); duplicate == nil {
		t.Fatal("second active run for one session was accepted")
	}
	if got, _ := s.GetSession(ctx, firstSession.ID); got.AnalysisStatus != domain.AnalysisQueued {
		t.Fatalf("queued session status=%q", got.AnalysisStatus)
	}
	claimed, err := s.ClaimNextQueuedAnalysisRun(ctx)
	if err != nil || claimed == nil || claimed.ID != first.ID || claimed.Status != domain.AnalysisRunPreparing {
		t.Fatalf("claimed=%+v err=%v", claimed, err)
	}
	if err := s.CancelAnalysisRun(ctx, second.ID, domain.AnalysisCoverage{}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetSession(ctx, secondSession.ID); got.AnalysisStatus != domain.AnalysisNotStarted || got.LatestAnalysisRun == nil || got.LatestAnalysisRun.Status != domain.AnalysisRunCancelled {
		t.Fatalf("cancelled queued session=%+v", got)
	}
}

func TestRecoveryPreservesQueuedAnalysisRuns(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	run := domain.AnalysisRun{ID: "queued-restart", SessionID: session.ID, Profile: domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "model", Reasoning: domain.ReasoningMedium}, ContextTransport: domain.ContextInline, SchemaVersion: 1, InputFingerprint: "queued", Status: domain.AnalysisRunQueued}
	if err := s.StartAnalysisRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	count, err := s.RecoverInterruptedAnalyses(ctx)
	if err != nil || count != 0 {
		t.Fatalf("recovery count=%d err=%v", count, err)
	}
	got, err := s.GetSession(ctx, session.ID)
	if err != nil || got.AnalysisStatus != domain.AnalysisQueued || got.LatestAnalysisRun == nil || got.LatestAnalysisRun.Status != domain.AnalysisRunQueued {
		t.Fatalf("queued run after recovery=%+v err=%v", got.LatestAnalysisRun, err)
	}
}

func TestAnalysisProfileRoundTripAndValidation(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	if _, err := s.GetAnalysisProfile(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing profile error=%v", err)
	}
	want := domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "gpt-test", Reasoning: domain.ReasoningHigh}
	if err := s.SaveAnalysisProfile(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetAnalysisProfile(ctx)
	if err != nil || got != want {
		t.Fatalf("profile=%+v err=%v", got, err)
	}
	if err := s.SaveAnalysisProfile(ctx, domain.AnalysisProfile{}); err == nil {
		t.Fatal("invalid profile accepted")
	}
}

func TestAnalysisRunsAreAppendOnlyAndHydrateLatestProvenance(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	legacy := domain.ReviewAnalysis{SchemaVersion: 1, BaseSHA: session.BaseSHA, HeadSHA: session.HeadSHA, Summary: "legacy"}
	if err := s.SaveAnalysis(ctx, session.ID, legacy); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.GetSession(ctx, session.ID)
	if err != nil || loaded.LatestAnalysisRun != nil {
		t.Fatalf("legacy session run=%+v err=%v", loaded.LatestAnalysisRun, err)
	}
	profile := domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "gpt-test", Reasoning: domain.ReasoningHigh}
	first := domain.AnalysisRun{ID: "run-1", SessionID: session.ID, Profile: profile, HarnessVersion: "1.0", ContextTransport: domain.ContextInline, SchemaVersion: 1, InputFingerprint: "input-1"}
	if err := s.StartAnalysisRun(ctx, first); err != nil {
		t.Fatal(err)
	}
	failure := domain.AnalysisFailure{Code: domain.FailureProvider, Title: "Provider failed", Message: "Try again later.", Action: domain.RetrySamePlan, Retryable: true, TechnicalDetails: strings.Repeat("x", 20<<10)}
	if err := s.FailAnalysisRun(ctx, first.ID, failure, domain.AnalysisCoverage{ChangedFilesTotal: 3, DiffFilesPartiallyRead: 1, DiffFilesUnread: 2}); err != nil {
		t.Fatal(err)
	}
	loaded, err = s.GetSession(ctx, session.ID)
	if err != nil || loaded.AnalysisStatus != domain.AnalysisReady || loaded.Analysis == nil || loaded.LatestAnalysisRun == nil || loaded.LatestAnalysisRun.Status != domain.AnalysisRunFailed {
		t.Fatalf("failed run session=%+v err=%v", loaded, err)
	}
	if len(loaded.LatestAnalysisRun.Failure.TechnicalDetails) != 16<<10 {
		t.Fatalf("technical details length=%d", len(loaded.LatestAnalysisRun.Failure.TechnicalDetails))
	}
	second := domain.AnalysisRun{ID: "run-2", SessionID: session.ID, Profile: profile, HarnessVersion: "1.1", ContextTransport: domain.ContextArtifactFiles, SchemaVersion: 1, InputFingerprint: "input-2"}
	if err := s.StartAnalysisRun(ctx, second); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkAnalysisRunRunning(ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkAnalysisRunRunning(ctx, second.ID); err == nil {
		t.Fatal("running analysis accepted a second preparing transition")
	}
	completed := domain.ReviewAnalysis{SchemaVersion: 1, BaseSHA: session.BaseSHA, HeadSHA: session.HeadSHA, Summary: "current", Chapters: []domain.ReviewChapter{{ID: "chapter"}}}
	coverage := domain.AnalysisCoverage{ChangedFilesTotal: 3, DiffFilesFullyRead: 2, DiffFilesPreviewed: 1, DiffFilesUnread: 1, DiffBytesTotal: 120, DiffBytesRead: 100, Segments: 1, OmittedPaths: []string{"generated/file.go"}, PreviewedPaths: []string{"generated/file.go"}, UnseenPaths: []string{}, PreviewDecisions: []domain.DiffOmissionDecision{{Path: "generated/file.go", Category: domain.DiffOmissionGenerated, Reason: "Generated output mirrors the reviewed source."}}}
	if err := s.CompleteAnalysisRun(ctx, second.ID, completed, coverage); err != nil {
		t.Fatal(err)
	}
	loaded, err = s.GetSession(ctx, session.ID)
	if err != nil || loaded.LatestAnalysisRun == nil || loaded.LatestAnalysisRun.ID != second.ID || loaded.LatestAnalysisRun.Status != domain.AnalysisRunCompleted || loaded.LatestAnalysisRun.ContextTransport != domain.ContextArtifactFiles || loaded.Analysis == nil || loaded.Analysis.Summary != "current" {
		t.Fatalf("completed session=%+v err=%v", loaded, err)
	}
	if loaded.LatestAnalysisRun.Coverage.DiffFilesPreviewed != 1 || !reflect.DeepEqual(loaded.LatestAnalysisRun.Coverage.PreviewedPaths, []string{"generated/file.go"}) || !reflect.DeepEqual(loaded.LatestAnalysisRun.Coverage.PreviewDecisions, coverage.PreviewDecisions) {
		t.Fatalf("persisted coverage=%+v", loaded.LatestAnalysisRun.Coverage)
	}
	runs, err := s.ListAnalysisRuns(ctx, session.ID)
	if err != nil || len(runs) != 2 || runs[0].ID != second.ID || runs[1].ID != first.ID {
		t.Fatalf("runs=%+v err=%v", runs, err)
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

func TestReviewPublicationAppliesDraftsAtomicallyAndIsRetrySafe(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	session := testSession()
	if err := s.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	draftIDs := []string{"draft-1", "draft-2"}
	for _, id := range draftIDs {
		if err := s.SaveComment(ctx, domain.ReviewComment{ID: id, SessionID: session.ID, Kind: domain.CommentGeneral, Body: id, Status: domain.CommentDraft}); err != nil {
			t.Fatal(err)
		}
	}
	const (
		token     = "publish-token"
		digest    = "publish-digest"
		githubID  = "991"
		githubURL = "https://github.com/openai/codex/pull/123#pullrequestreview-991"
	)
	if err := s.StartReviewPublication(ctx, token, digest, session.ID, session.PullRequest.Ref, session.HeadSHA, "COMMENT", draftIDs); err != nil {
		t.Fatal(err)
	}
	if err := s.StartReviewPublication(ctx, "other-token", "other-digest", session.ID, session.PullRequest.Ref, session.HeadSHA, "COMMENT", draftIDs[1:]); !errors.Is(err, ErrPublicationAlreadyInProgress) {
		t.Fatalf("overlapping publication error = %v, want ErrPublicationAlreadyInProgress", err)
	}
	if _, err := s.ApplyReviewPublication(ctx, token, digest); !errors.Is(err, ErrPublicationOutcomeUnknown) {
		t.Fatalf("ApplyReviewPublication() before receipt error = %v, want ErrPublicationOutcomeUnknown", err)
	}
	if err := s.RecordReviewPublicationReceipt(ctx, token, digest, githubID, githubURL); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx, `CREATE TRIGGER fail_second_publication BEFORE UPDATE OF status ON comments WHEN OLD.id='draft-2' AND NEW.status='published' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyReviewPublication(ctx, token, digest); err == nil || !strings.Contains(err.Error(), "fixture failure") {
		t.Fatalf("ApplyReviewPublication() error = %v, want fixture failure", err)
	}
	comments, err := s.ListComments(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 2 || comments[0].Status != domain.CommentDraft || comments[1].Status != domain.CommentDraft {
		t.Fatalf("partial publication escaped rollback: %+v", comments)
	}
	var state string
	if err := s.db.QueryRowContext(ctx, `SELECT state FROM review_publications WHERE token=?`, token).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "published" {
		t.Fatalf("publication state after rollback = %q, want published", state)
	}
	if _, err := s.db.ExecContext(ctx, `DROP TRIGGER fail_second_publication`); err != nil {
		t.Fatal(err)
	}

	published, err := s.ApplyReviewPublication(ctx, token, digest)
	if err != nil {
		t.Fatal(err)
	}
	if len(published) != 2 {
		t.Fatalf("published comments = %+v", published)
	}
	for index, comment := range published {
		if comment.ID != draftIDs[index] || comment.Status != domain.CommentPublished || comment.GitHubID != githubID || comment.GitHubURL != githubURL {
			t.Fatalf("published[%d] = %+v", index, comment)
		}
	}
	if err := s.RecordReviewPublicationReceipt(ctx, token, digest, githubID, githubURL); err != nil {
		t.Fatalf("record identical receipt after apply: %v", err)
	}
	retried, err := s.ApplyReviewPublication(ctx, token, digest)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(retried, published) {
		t.Fatalf("retried publication = %+v, want %+v", retried, published)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT state FROM review_publications WHERE token=?`, token).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "applied" {
		t.Fatalf("publication state after retry = %q, want applied", state)
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
	if _, err := s.db.ExecContext(ctx, `UPDATE analyses SET analysis_json='{broken' WHERE session_id=?`, session.ID); err != nil {
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
	if _, err := s.db.ExecContext(ctx, `UPDATE settings SET value_json='{broken' WHERE key='broken'`); err != nil {
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

func TestRemoveRepositorySelectionsIsScopedAndCaseInsensitive(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	selections := []domain.SourceSelection{
		{Kind: domain.SelectionRepository, Key: "Acme/Old", Enabled: true},
		{Kind: domain.SelectionRepository, Key: "acme/active", Enabled: true},
		{Kind: domain.SelectionOrganization, Key: "Acme", Enabled: true},
	}
	if err := s.ReplaceSelections(ctx, selections); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveRepositorySelections(ctx, []string{"acme/old"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListSelections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Kind != domain.SelectionOrganization || got[1].Key != "acme/active" {
		t.Fatalf("selections=%+v", got)
	}
}

func TestAccessibleRepositoryCatalogSearchAndCompletedSync(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	repository := func(owner, name, description string) domain.Repository {
		return domain.Repository{Ref: domain.RepositoryRef{Host: "github.com", Owner: owner, Name: name}, Description: description}
	}
	if err := s.UpsertAccessibleRepositories(ctx, []domain.Repository{
		repository("acme", "api", "Payments backend"),
		repository("sean", "review_100%", "Desktop review client"),
	}, "sean", "sync-one"); err != nil {
		t.Fatal(err)
	}
	items, total, err := s.SearchAccessibleRepositories(ctx, "sean", "payments", 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(items) != 1 || items[0].Ref.Name != "api" {
		t.Fatalf("items=%+v total=%d", items, total)
	}
	items, total, err = s.SearchAccessibleRepositories(ctx, "sean", "review_100%", 0, 50)
	if err != nil || total != 1 || len(items) != 1 || items[0].Ref.Owner != "sean" {
		t.Fatalf("literal wildcard search items=%+v total=%d err=%v", items, total, err)
	}
	if err := s.UpsertAccessibleRepositories(ctx, []domain.Repository{repository("acme", "api", "Payments backend")}, "sean", "sync-two"); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteAccessibleRepositorySync(ctx, "sean", "sync-two"); err != nil {
		t.Fatal(err)
	}
	items, total, err = s.SearchAccessibleRepositories(ctx, "sean", "", 0, 50)
	if err != nil || total != 1 || len(items) != 1 || items[0].Ref.Name != "api" {
		t.Fatalf("completed catalog items=%+v total=%d err=%v", items, total, err)
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
	pr := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 123}, Title: "Make reviews local", BaseSHA: "base", HeadSHA: "head"}, BaseRef: "main", HeadRef: "feature"}
	return domain.ReviewSession{ID: "session-1", PullRequest: pr, BaseSHA: "base", HeadSHA: "head", Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
}
