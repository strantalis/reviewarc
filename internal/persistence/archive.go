package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"reviewarc/internal/domain"
)

const (
	archiveRetentionSetting     = "archive_retention_days_v1"
	defaultArchiveRetentionDays = 30
)

var (
	ErrSessionBusy        = errors.New("review session has unfinished local work")
	ErrSessionNotArchived = errors.New("review session is not archived")
)

// GetArchiveRetention returns the local retention policy. Existing installs
// receive the product default without needing a settings migration.
func (s *Store) GetArchiveRetention(ctx context.Context) (domain.ArchiveRetention, error) {
	retention := domain.ArchiveRetention{Days: defaultArchiveRetentionDays}
	if err := s.GetSetting(ctx, archiveRetentionSetting, &retention); err != nil {
		if errors.Is(err, ErrNotFound) {
			return domain.ArchiveRetention{Days: defaultArchiveRetentionDays}, nil
		}
		return domain.ArchiveRetention{}, err
	}
	if retention.Days < 0 {
		return domain.ArchiveRetention{}, errors.New("load archive retention: days cannot be negative")
	}
	return retention, nil
}

func (s *Store) SaveArchiveRetention(ctx context.Context, retention domain.ArchiveRetention) error {
	if retention.Days < 0 {
		return errors.New("save archive retention: days cannot be negative")
	}
	return s.SetSetting(ctx, archiveRetentionSetting, retention)
}

// ArchiveSession hides a review from active work while retaining every local
// artifact. It also makes an in-flight analysis terminal so it cannot resume
// after the review has been archived.
func (s *Store) ArchiveSession(ctx context.Context, id string, reason domain.ArchiveReason) error {
	if id == "" || !validArchiveReason(reason) {
		return errors.New("archive review session: invalid session or reason")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := encodeTime(time.Now())
	result, err := tx.ExecContext(ctx, `
		UPDATE review_sessions
		SET archived_at=COALESCE(archived_at, ?),
			archive_reason=CASE WHEN archived_at IS NULL THEN ? ELSE archive_reason END,
			analysis_status=CASE
				WHEN analysis_status IN (?, ?) AND EXISTS(SELECT 1 FROM analyses WHERE analyses.session_id=review_sessions.id)
					THEN CASE WHEN is_stale=1 THEN ? ELSE ? END
				WHEN analysis_status IN (?, ?) THEN ?
				ELSE analysis_status
			END,
			updated_at=?
		WHERE id=?`, now, reason, domain.AnalysisQueued, domain.AnalysisRunning, domain.AnalysisStale, domain.AnalysisReady, domain.AnalysisQueued, domain.AnalysisRunning, domain.AnalysisNotStarted, now, id)
	if err != nil {
		return wrap("archive review session", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return wrap("archive review session", err)
	}
	if count != 1 {
		return fmt.Errorf("archive review session: %w", ErrNotFound)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE analysis_runs SET status=?,completed_at=?,updated_at=? WHERE session_id=? AND status IN (?,?,?)`, domain.AnalysisRunCancelled, now, now, id, domain.AnalysisRunQueued, domain.AnalysisRunPreparing, domain.AnalysisRunRunning); err != nil {
		return wrap("archive review session", err)
	}
	return wrap("archive review session", tx.Commit())
}

func (s *Store) RestoreSession(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("restore review session: session ID is required")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE review_sessions SET archived_at=NULL,archive_reason='',updated_at=? WHERE id=? AND archived_at IS NOT NULL`, encodeTime(time.Now()), id)
	if err != nil {
		return wrap("restore review session", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return wrap("restore review session", err)
	}
	if count != 1 {
		return fmt.Errorf("restore review session: %w", ErrNotFound)
	}
	return nil
}

func (s *Store) ListArchivedSessions(ctx context.Context) ([]domain.ReviewSession, error) {
	return s.listSessions(ctx, `SELECT id FROM review_sessions WHERE archived_at IS NOT NULL ORDER BY archived_at DESC,id DESC`)
}

// ListArchivePurgeCandidates returns archived sessions whose retention period
// ended at or before now. It is intentionally read-only; callers explicitly
// delete each candidate after completing any app-level cleanup.
func (s *Store) ListArchivePurgeCandidates(ctx context.Context, now time.Time) ([]domain.ReviewSession, error) {
	retention, err := s.GetArchiveRetention(ctx)
	if err != nil {
		return nil, err
	}
	if retention.Days == 0 {
		return []domain.ReviewSession{}, nil
	}
	cutoff := now.AddDate(0, 0, -retention.Days)
	return s.listSessions(ctx, `SELECT id FROM review_sessions WHERE archived_at IS NOT NULL AND archived_at<=? ORDER BY archived_at,id`, encodeTime(cutoff))
}

// DeleteSession permanently removes an archived review and all FK-cascaded
// local review content. A publication awaiting reconciliation is retained.
func (s *Store) DeleteSession(ctx context.Context, id string) error {
	if id == "" {
		return errors.New("delete review session: session ID is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var archivedAt sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT archived_at FROM review_sessions WHERE id=?`, id).Scan(&archivedAt); err != nil {
		return queryErr("delete review session", err)
	}
	if !archivedAt.Valid {
		return fmt.Errorf("delete review session: %w", ErrSessionNotArchived)
	}
	var busy bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM analysis_runs WHERE session_id=? AND status IN (?,?,?)) OR EXISTS(SELECT 1 FROM review_publications WHERE session_id=? AND state IN ('publishing','published'))`, id, domain.AnalysisRunQueued, domain.AnalysisRunPreparing, domain.AnalysisRunRunning, id).Scan(&busy); err != nil {
		return wrap("delete review session", err)
	}
	if busy {
		return fmt.Errorf("delete review session: %w", ErrSessionBusy)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM review_sessions WHERE id=?`, id); err != nil {
		return wrap("delete review session", err)
	}
	return wrap("delete review session", tx.Commit())
}

func validArchiveReason(reason domain.ArchiveReason) bool {
	return reason == domain.ArchiveReasonManual || reason == domain.ArchiveReasonApproved
}
