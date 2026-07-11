package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"reviewarc/internal/domain"
	githubclient "reviewarc/internal/github"
	"reviewarc/internal/persistence"
	proc "reviewarc/internal/process"
)

type appFixtureRunner struct {
	results  []proc.Result
	errors   []error
	commands []proc.Command
}

type protocolRunner struct{ protocol string }

func (r protocolRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	if !reflect.DeepEqual(command.Args, []string{"config", "get", "git_protocol", "--host", "github.com"}) {
		return proc.Result{}, errors.New("unexpected command")
	}
	return proc.Result{Stdout: []byte(r.protocol + "\n")}, nil
}

func (f *appFixtureRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	f.commands = append(f.commands, command)
	i := len(f.commands) - 1
	if i >= len(f.results) {
		return proc.Result{}, errors.New("unexpected fixture command")
	}
	var err error
	if i < len(f.errors) {
		err = f.errors[i]
	}
	return f.results[i], err
}

func TestSelectedRepositoriesSupportsOrganizationAndRepositorySelections(t *testing.T) {
	repositories := []domain.Repository{
		{Ref: domain.RepositoryRef{Owner: "Acme", Name: "api"}},
		{Ref: domain.RepositoryRef{Owner: "Acme", Name: "web"}},
		{Ref: domain.RepositoryRef{Owner: "other", Name: "worker"}},
	}
	selections := []domain.SourceSelection{
		{Kind: domain.SelectionOrganization, Key: "ACME", Enabled: true},
		{Kind: domain.SelectionRepository, Key: "other/worker", Enabled: true},
		{Kind: domain.SelectionRepository, Key: "ignored/repo", Enabled: false},
	}
	got := selectedRepositories(repositories, selections)
	want := []domain.RepositoryRef{repositories[0].Ref, repositories[1].Ref, repositories[2].Ref}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("selected=%+v, want %+v", got, want)
	}
}

func TestInboxSortUsesGitHubUpdatedTime(t *testing.T) {
	items := []domain.PullRequestSummary{{Title: "old", UpdatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}, {Title: "new", UpdatedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)}}
	sortInbox(items)
	if items[0].Title != "new" {
		t.Fatalf("sorted items=%+v", items)
	}
}

func TestPreferredGitHubRemoteHonorsGHProtocol(t *testing.T) {
	ref := domain.RepositoryRef{Owner: "acme", Name: "api"}
	if got := preferredGitHubRemote(protocolRunner{protocol: "ssh"})(ref); got != "git@github.com:acme/api.git" {
		t.Fatalf("SSH remote=%q", got)
	}
	if got := preferredGitHubRemote(protocolRunner{protocol: "https"})(ref); got != "https://github.com/acme/api.git" {
		t.Fatalf("HTTPS remote=%q", got)
	}
}

func TestAnalysisStatusAfterCancellationPreservesPreviousWalkthrough(t *testing.T) {
	if got := analysisStatusAfterCancellation(domain.ReviewSession{}); got != domain.AnalysisNotStarted {
		t.Fatalf("new analysis cancellation status=%q", got)
	}
	withAnalysis := domain.ReviewSession{Analysis: &domain.ReviewAnalysis{}}
	if got := analysisStatusAfterCancellation(withAnalysis); got != domain.AnalysisReady {
		t.Fatalf("reanalysis cancellation status=%q", got)
	}
	withAnalysis.IsStale = true
	if got := analysisStatusAfterCancellation(withAnalysis); got != domain.AnalysisStale {
		t.Fatalf("stale reanalysis cancellation status=%q", got)
	}
}

func TestAnalysisWasCancelledRecognizesContextAndWrappedError(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if !analysisWasCancelled(cancelled, errors.New("snapshot interrupted")) {
		t.Fatal("cancelled context was not recognized")
	}
	if !analysisWasCancelled(context.Background(), fmt.Errorf("prepare: %w", context.Canceled)) {
		t.Fatal("wrapped cancellation was not recognized")
	}
	if analysisWasCancelled(context.Background(), errors.New("network failed")) {
		t.Fatal("ordinary failure was treated as cancellation")
	}
}

func TestBuildReviewPayloadSeparatesGeneralAndInlineComments(t *testing.T) {
	line := 27
	payload := buildReviewPayload(PublishPreview{HeadSHA: "head", Items: []PublishItem{
		{Kind: domain.CommentGeneral, Body: "First general note"},
		{Kind: domain.CommentInline, Body: "Check this branch", Path: "internal/store.go", Line: &line, Side: domain.DiffSideRight},
		{Kind: domain.CommentGeneral, Body: "Second general note"},
	}})
	var got struct {
		CommitID string `json:"commit_id"`
		Body     string `json:"body"`
		Event    string `json:"event"`
		Comments []struct {
			Path string          `json:"path"`
			Line int             `json:"line"`
			Side domain.DiffSide `json:"side"`
			Body string          `json:"body"`
		} `json:"comments"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got.CommitID != "head" || got.Body != "First general note\n\nSecond general note" || got.Event != "COMMENT" || len(got.Comments) != 1 {
		t.Fatalf("payload=%s", payload)
	}
	if got.Comments[0].Path != "internal/store.go" || got.Comments[0].Line != line || got.Comments[0].Side != domain.DiffSideRight {
		t.Fatalf("inline=%+v", got.Comments[0])
	}
}

func TestBuildReviewPayloadUsesExplicitDecisionEvent(t *testing.T) {
	payload := buildReviewPayload(PublishPreview{HeadSHA: "head", Event: "APPROVE"})
	var got struct {
		Event string `json:"event"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got.Event != "APPROVE" {
		t.Fatalf("event=%q payload=%s", got.Event, payload)
	}
}

func TestNormalizeSessionMakesEveryFrontendCollectionNonNil(t *testing.T) {
	session := normalizeSession(domain.ReviewSession{Analysis: &domain.ReviewAnalysis{Chapters: []domain.ReviewChapter{{}}}})
	if session.PullRequest.Relationships == nil || session.PullRequest.Labels == nil || session.PullRequest.Commits == nil || session.PullRequest.Reviews == nil || session.PullRequest.ReviewComments == nil || session.PullRequest.CheckRuns == nil || session.Chapters == nil || session.Notes == nil || session.Comments == nil {
		t.Fatalf("session collections were not normalized: %+v", session)
	}
	analysis := session.Analysis
	if analysis.SummaryEvidence == nil || analysis.SummaryValidation != domain.ValidationUnverified || analysis.AffectedAreas == nil || analysis.Risks == nil || analysis.Facts == nil || analysis.Inferences == nil || analysis.Unknowns == nil || analysis.ValidationIssues == nil {
		t.Fatalf("analysis collections were not normalized: %+v", analysis)
	}
	chapter := analysis.Chapters[0]
	if chapter.Evidence == nil || chapter.Files == nil || chapter.Symbols == nil || chapter.BehavioralChanges == nil || chapter.Risks == nil || chapter.Facts == nil || chapter.Inferences == nil || chapter.Unknowns == nil || chapter.RelatedTests == nil || chapter.SuggestedQuestions == nil {
		t.Fatalf("chapter collections were not normalized: %+v", chapter)
	}
}

func TestPublishRequiresMatchingConfirmationAndUsesFixtureBackedGitHubFlow(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api", CloneURL: "https://github.com/acme/api.git"}
	baseSHA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	headSHA := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	pr := domain.PullRequest{
		PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 7}, Title: "Fixture PR"},
		BaseSHA:            baseSHA, HeadSHA: headSHA, BaseRef: "main", HeadRef: "feature", HeadRepository: ref,
	}
	session := domain.ReviewSession{ID: "session", PullRequest: pr, BaseSHA: baseSHA, HeadSHA: headSHA, Status: domain.SessionReady, AnalysisStatus: domain.AnalysisReady}
	if err := store.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	draft := domain.ReviewComment{ID: "draft", SessionID: session.ID, Kind: domain.CommentGeneral, Body: "Please verify rollback behavior.", Status: domain.CommentDraft}
	if err := store.SaveComment(ctx, draft); err != nil {
		t.Fatal(err)
	}
	metadata := `{"number":7,"title":"Fixture PR","html_url":"https://github.com/acme/api/pull/7","updated_at":"2026-07-11T12:00:00Z","user":{"login":"author"},"base":{"ref":"main","sha":"` + baseSHA + `","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}},"head":{"ref":"feature","sha":"` + headSHA + `","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}}}`
	runner := &appFixtureRunner{results: []proc.Result{
		{Stdout: []byte(metadata)},
		{Stdout: []byte(`[[]]`)},
		{Stdout: []byte(`[[]]`)},
		{Stdout: []byte(`[[]]`)},
		{Stdout: []byte(`[[]]`)},
		{Stdout: []byte(`[{"check_runs":[]}]`)},
		{Stdout: []byte(`{"id":991,"html_url":"https://github.com/acme/api/pull/7#pullrequestreview-991"}`)},
	}}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store, publish: map[string]pendingPublish{}}

	preview, err := app.PreparePublish(session.ID, []string{draft.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.ConfirmPublish(preview.Token, "wrong digest"); err == nil {
		t.Fatal("publish accepted a mismatched confirmation digest")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("GitHub called before valid confirmation: %+v", runner.commands)
	}
	if _, err := app.ConfirmPublish(preview.Token, preview.Digest); err == nil {
		t.Fatal("consumed confirmation token was reusable")
	}

	preview, err = app.PreparePublish(session.ID, []string{draft.ID})
	if err != nil {
		t.Fatal(err)
	}
	published, err := app.ConfirmPublish(preview.Token, preview.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if len(published) != 1 || published[0].Status != domain.CommentPublished || published[0].GitHubID != "991" {
		t.Fatalf("published=%+v", published)
	}
	if len(runner.commands) != 7 {
		t.Fatalf("commands=%d, want detail metadata, commits, files, reviews, comments, checks, and publish", len(runner.commands))
	}
	publishCommand := runner.commands[6]
	if publishCommand.Tool != proc.GH || !reflect.DeepEqual(publishCommand.Args, []string{"api", "--method", "POST", "repos/acme/api/pulls/7/reviews", "--input", "-"}) {
		t.Fatalf("publish command=%+v", publishCommand)
	}
	var payload struct {
		CommitID string `json:"commit_id"`
		Body     string `json:"body"`
		Event    string `json:"event"`
	}
	if err := json.Unmarshal(publishCommand.Stdin, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.CommitID != headSHA || payload.Body != draft.Body || payload.Event != "COMMENT" {
		t.Fatalf("publish payload=%s", publishCommand.Stdin)
	}
	got, err := store.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Comments) != 1 || got.Comments[0].Status != domain.CommentPublished || got.Comments[0].GitHubURL == "" {
		t.Fatalf("persisted comments=%+v", got.Comments)
	}
}

func TestExpiredPublishPreviewIsRejectedWithoutGitHubCall(t *testing.T) {
	runner := &appFixtureRunner{}
	app := &App{ctx: context.Background(), github: githubclient.New(runner), publish: map[string]pendingPublish{
		"expired": {preview: PublishPreview{Token: "expired", Digest: "digest", ExpiresAt: time.Now().Add(-time.Second)}},
	}}
	if _, err := app.ConfirmPublish("expired", "digest"); err == nil {
		t.Fatal("expired publish preview was accepted")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("GitHub called for expired confirmation: %+v", runner.commands)
	}
}
