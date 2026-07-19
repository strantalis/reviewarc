package main

import (
	"testing"

	"reviewarc/internal/domain"
)

func TestMergeInboxReviewStatePreservesRemoteOrderAndFields(t *testing.T) {
	repository := domain.RepositoryRef{Host: "github.com", Owner: "Acme", Name: "API"}
	first := domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: repository, Number: 1}, Title: "fresh title"}
	second := domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: repository, Number: 2}, Title: "second"}
	local := domain.PullRequestSummary{
		Ref:            domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "GITHUB.COM", Owner: "acme", Name: "api"}, Number: 1},
		Title:          "stale title",
		SessionID:      "session-1",
		AnalysisStatus: domain.AnalysisReady,
		RiskLevel:      domain.RiskHigh,
		Progress:       domain.ReviewProgress{Total: 4, Reviewed: 3, Percent: 75},
	}

	got := mergeInboxReviewState([]domain.PullRequestSummary{first, second}, []domain.PullRequestSummary{local})
	if len(got) != 2 || got[0].Title != "fresh title" || got[1].Title != "second" {
		t.Fatalf("remote ordering or fields changed: %+v", got)
	}
	if got[0].SessionID != local.SessionID || got[0].AnalysisStatus != local.AnalysisStatus || got[0].RiskLevel != local.RiskLevel || got[0].Progress != local.Progress {
		t.Fatalf("review projection not merged: %+v", got[0])
	}
	if got[1].SessionID != "" {
		t.Fatalf("unmatched item changed: %+v", got[1])
	}
}

func TestMergeInboxReviewStateDoesNotMutateRemoteSlice(t *testing.T) {
	remote := []domain.PullRequestSummary{{
		Ref:   domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 1},
		Title: "remote",
	}}
	local := []domain.PullRequestSummary{{Ref: remote[0].Ref, SessionID: "session"}}
	_ = mergeInboxReviewState(remote, local)
	if remote[0].SessionID != "" {
		t.Fatalf("remote input mutated: %+v", remote[0])
	}
}

func TestActiveRemotePullRequestsOmitsArchivedProjection(t *testing.T) {
	repository := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
	active := domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: repository, Number: 1}}
	archived := domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: repository, Number: 2}}

	got := activeRemotePullRequests([]domain.PullRequestSummary{active, archived}, []domain.PullRequestSummary{active})
	if len(got) != 1 || got[0].Ref.Number != active.Ref.Number {
		t.Fatalf("active remote pull requests = %+v", got)
	}
}
