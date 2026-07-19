package persistence

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"reviewarc/internal/domain"
)

// InboxRefreshStats describes the durable work performed by RefreshInboxPullRequests.
// Pull requests are written together in one transaction so a refresh cannot leave a
// partially updated inbox behind.
type InboxRefreshStats struct {
	PullRequests  int
	StaleSessions int64
}

// RefreshInboxPullRequests marks superseded sessions stale and persists the
// latest GitHub summaries in one transaction. Callers can then project review
// state for the complete inbox with ListPullRequestSummaries instead of fully
// hydrating one review session per pull request.
func (s *Store) RefreshInboxPullRequests(ctx context.Context, items []domain.PullRequestSummary) (InboxRefreshStats, error) {
	stats := InboxRefreshStats{}
	if len(items) == 0 {
		return stats, nil
	}

	type row struct {
		item domain.PullRequestSummary
		json []byte
	}
	rows := make([]row, len(items))
	for i, item := range items {
		pullRequest := domain.PullRequest{
			PullRequestSummary: item,
		}
		body, err := json.Marshal(pullRequest)
		if err != nil {
			return stats, fmt.Errorf("refresh inbox: encode pull request: %w", err)
		}
		rows[i] = row{item: item, json: body}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return stats, fmt.Errorf("refresh inbox: begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stale, err := tx.PrepareContext(ctx, `UPDATE review_sessions SET is_stale=1,analysis_status=?,stale_reason=?,archived_at=NULL,archive_reason='',updated_at=? WHERE repo_key=? AND pr_number=? AND (base_sha<>? OR head_sha<>?) AND (is_stale=0 OR archived_at IS NOT NULL)`)
	if err != nil {
		return stats, fmt.Errorf("refresh inbox: prepare stale update: %w", err)
	}
	defer func() { _ = stale.Close() }()

	upsert, err := tx.PrepareContext(ctx, `INSERT INTO pull_requests(repo_key,number,base_sha,head_sha,pull_request_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(repo_key,number) DO UPDATE SET base_sha=excluded.base_sha,head_sha=excluded.head_sha,pull_request_json=excluded.pull_request_json,updated_at=excluded.updated_at`)
	if err != nil {
		return stats, fmt.Errorf("refresh inbox: prepare pull request upsert: %w", err)
	}
	defer func() { _ = upsert.Close() }()

	now := encodeTime(time.Now())
	for _, row := range rows {
		item := row.item
		if item.BaseSHA != "" && item.HeadSHA != "" {
			reason := fmt.Sprintf("pull request revision changed to %s..%s", item.BaseSHA, item.HeadSHA)
			result, execErr := stale.ExecContext(ctx, domain.AnalysisStale, reason, now, repoKey(item.Ref.Repository), item.Ref.Number, item.BaseSHA, item.HeadSHA)
			if execErr != nil {
				return stats, fmt.Errorf("refresh inbox: mark stale sessions: %w", execErr)
			}
			count, rowsErr := result.RowsAffected()
			if rowsErr != nil {
				return stats, fmt.Errorf("refresh inbox: count stale sessions: %w", rowsErr)
			}
			stats.StaleSessions += count
		}
		if _, execErr := upsert.ExecContext(ctx, repoKey(item.Ref.Repository), item.Ref.Number, item.BaseSHA, item.HeadSHA, row.json, now); execErr != nil {
			return stats, fmt.Errorf("refresh inbox: save pull request: %w", execErr)
		}
		stats.PullRequests++
	}
	if err := tx.Commit(); err != nil {
		return stats, fmt.Errorf("refresh inbox: commit: %w", err)
	}
	return stats, nil
}
