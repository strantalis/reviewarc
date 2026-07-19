package main

import (
	"strconv"
	"strings"

	"reviewarc/internal/domain"
)

// activeRemotePullRequests filters the just-refreshed GitHub result through the
// durable active projection. Every remote row has already been upserted before
// this runs, so an absent local key represents an intentionally archived review.
func activeRemotePullRequests(remote, active []domain.PullRequestSummary) []domain.PullRequestSummary {
	keys := make(map[string]struct{}, len(active))
	for _, item := range active {
		keys[inboxPullRequestKey(item.Ref)] = struct{}{}
	}
	out := make([]domain.PullRequestSummary, 0, len(remote))
	for _, item := range remote {
		if _, ok := keys[inboxPullRequestKey(item.Ref)]; ok {
			out = append(out, item)
		}
	}
	return out
}

// mergeInboxReviewState applies the lightweight local review projection to
// fresh GitHub results while preserving GitHub ordering and partial-result
// semantics.
func mergeInboxReviewState(remote, local []domain.PullRequestSummary) []domain.PullRequestSummary {
	projected := make(map[string]domain.PullRequestSummary, len(local))
	for _, item := range local {
		projected[inboxPullRequestKey(item.Ref)] = item
	}
	result := make([]domain.PullRequestSummary, len(remote))
	copy(result, remote)
	for i := range result {
		item, ok := projected[inboxPullRequestKey(result[i].Ref)]
		if !ok {
			continue
		}
		result[i].SessionID = item.SessionID
		result[i].AnalysisStatus = item.AnalysisStatus
		result[i].Progress = item.Progress
		result[i].RiskLevel = item.RiskLevel
	}
	return result
}

func inboxPullRequestKey(ref domain.PullRequestRef) string {
	repository := ref.Repository
	return strings.ToLower(repository.Host) + "/" + strings.ToLower(repository.Owner) + "/" + strings.ToLower(repository.Name) + "#" + strconv.Itoa(ref.Number)
}
