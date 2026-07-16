package main

import (
	"strconv"
	"strings"

	"reviewarc/internal/domain"
)

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
