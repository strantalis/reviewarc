package persistence

import (
	"context"
	"testing"

	"reviewarc/internal/domain"
)

func TestRefreshInboxPullRequestsPersistsBatchAndMarksChangedSessionsStale(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	repository := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
	changed := domain.PullRequestSummary{
		Ref:     domain.PullRequestRef{Repository: repository, Number: 1},
		Title:   "Changed",
		BaseSHA: "base",
		HeadSHA: "new-head",
	}
	unchanged := domain.PullRequestSummary{
		Ref:     domain.PullRequestRef{Repository: repository, Number: 2},
		Title:   "Unchanged",
		BaseSHA: "base",
		HeadSHA: "head",
	}
	for _, item := range []domain.PullRequestSummary{changed, unchanged} {
		session := domain.ReviewSession{
			ID:             "session-" + item.Title,
			PullRequest:    domain.PullRequest{PullRequestSummary: item},
			BaseSHA:        "base",
			HeadSHA:        "head",
			Status:         domain.SessionReady,
			AnalysisStatus: domain.AnalysisReady,
		}
		if err := s.SaveSession(ctx, session); err != nil {
			t.Fatal(err)
		}
	}

	stats, err := s.RefreshInboxPullRequests(ctx, []domain.PullRequestSummary{changed, unchanged})
	if err != nil {
		t.Fatal(err)
	}
	if stats != (InboxRefreshStats{PullRequests: 2, StaleSessions: 1}) {
		t.Fatalf("stats=%+v", stats)
	}

	persisted, err := s.ListPullRequests(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted) != 2 {
		t.Fatalf("persisted pull requests=%d, want 2", len(persisted))
	}
	changedSession, err := s.GetSession(ctx, "session-Changed")
	if err != nil {
		t.Fatal(err)
	}
	if !changedSession.IsStale || changedSession.AnalysisStatus != domain.AnalysisStale {
		t.Fatalf("changed session=%+v", changedSession)
	}
	unchangedSession, err := s.GetSession(ctx, "session-Unchanged")
	if err != nil {
		t.Fatal(err)
	}
	if unchangedSession.IsStale || unchangedSession.AnalysisStatus != domain.AnalysisReady {
		t.Fatalf("unchanged session=%+v", unchangedSession)
	}
}

func TestRefreshInboxPullRequestsEmptyBatchDoesNoWork(t *testing.T) {
	s := openTestStore(t)
	stats, err := s.RefreshInboxPullRequests(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if stats != (InboxRefreshStats{}) {
		t.Fatalf("stats=%+v", stats)
	}
}
