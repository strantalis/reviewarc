// Package persistence provides ReviewArc's durable, local-only SQLite store.
package persistence

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"reviewarc/internal/domain"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

var ErrNotFound = errors.New("persistence: not found")

const analysisProfileSetting = "analysis_profile_v1"

type Store struct{ db *sql.DB }

type Operation struct {
	ID, Kind, Subject, Status, Detail string
	CreatedAt, UpdatedAt              time.Time
}

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("open database: empty path")
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.initialize(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// RecoverInterruptedAnalyses clears process-local running state left behind by
// a crash or quit. No analysis process can survive application startup.
func (s *Store) RecoverInterruptedAnalyses(ctx context.Context) (int64, error) {
	now := encodeTime(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE analysis_runs SET status=?,failure_code=?,failure_title=?,failure_message=?,failure_action=?,failure_retryable=1,completed_at=?,updated_at=? WHERE status IN (?,?)`, domain.AnalysisRunFailed, domain.FailureInterrupted, "Analysis interrupted", "ReviewArc closed before this analysis completed.", domain.RetrySamePlan, now, now, domain.AnalysisRunPreparing, domain.AnalysisRunRunning); err != nil {
		return 0, wrap("recover interrupted analysis runs", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=?,updated_at=? WHERE analysis_status=?`, domain.AnalysisFailed, now, domain.AnalysisRunning)
	if err != nil {
		return 0, wrap("recover interrupted analyses", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) initialize(ctx context.Context) error {
	for _, pragma := range []string{"PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000", "PRAGMA journal_mode=WAL"} {
		if _, err := s.db.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("configure sqlite: %w", err)
		}
	}
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version=?`, entry.Name()).Scan(&exists); err != nil {
			return err
		}
		if exists != 0 {
			continue
		}
		body, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, string(body)); err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, entry.Name(), encodeTime(time.Now()))
		}
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

func (s *Store) SetSetting(ctx context.Context, key string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode setting %q: %w", key, err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, key, b, encodeTime(time.Now()))
	return wrap("save setting", err)
}

func (s *Store) GetSetting(ctx context.Context, key string, target any) error {
	var b []byte
	if err := s.db.QueryRowContext(ctx, `SELECT value_json FROM settings WHERE key=?`, key).Scan(&b); err != nil {
		return queryErr("load setting", err)
	}
	if err := json.Unmarshal(b, target); err != nil {
		return fmt.Errorf("load setting %q: corrupt JSON: %w", key, err)
	}
	return nil
}

func (s *Store) SaveAnalysisProfile(ctx context.Context, profile domain.AnalysisProfile) error {
	if profile.Harness == "" || strings.TrimSpace(profile.Model) == "" || strings.ContainsRune(profile.Model, 0) || profile.Reasoning == "" {
		return errors.New("save analysis profile: harness, model, and reasoning level are required")
	}
	return s.SetSetting(ctx, analysisProfileSetting, profile)
}

func (s *Store) GetAnalysisProfile(ctx context.Context) (domain.AnalysisProfile, error) {
	var profile domain.AnalysisProfile
	if err := s.GetSetting(ctx, analysisProfileSetting, &profile); err != nil {
		return profile, err
	}
	if profile.Harness == "" || strings.TrimSpace(profile.Model) == "" || strings.ContainsRune(profile.Model, 0) || profile.Reasoning == "" {
		return domain.AnalysisProfile{}, errors.New("load analysis profile: invalid profile")
	}
	return profile, nil
}

func (s *Store) ReplaceSelections(ctx context.Context, selections []domain.SourceSelection) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM selections`); err != nil {
		return err
	}
	now := encodeTime(time.Now())
	for _, v := range selections {
		if _, err = tx.ExecContext(ctx, `INSERT INTO selections(kind,selection_key,enabled,updated_at) VALUES(?,?,?,?)`, v.Kind, v.Key, v.Enabled, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListSelections(ctx context.Context) ([]domain.SourceSelection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT kind,selection_key,enabled FROM selections ORDER BY kind,selection_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SourceSelection
	for rows.Next() {
		var v domain.SourceSelection
		if err := rows.Scan(&v.Kind, &v.Key, &v.Enabled); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) RemoveRepositorySelections(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, key := range keys {
		if _, err := tx.ExecContext(ctx, `DELETE FROM selections WHERE kind=? AND lower(selection_key)=lower(?)`, domain.SelectionRepository, key); err != nil {
			return wrap("remove archived repository selection", err)
		}
	}
	return tx.Commit()
}

func repoKey(ref domain.RepositoryRef) string {
	return strings.ToLower(ref.Host + "/" + ref.Owner + "/" + ref.Name)
}

func (s *Store) UpsertRepository(ctx context.Context, repo domain.Repository) error {
	b, err := json.Marshal(repo)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO repositories(repo_key,repository_json,updated_at) VALUES(?,?,?) ON CONFLICT(repo_key) DO UPDATE SET repository_json=excluded.repository_json,updated_at=excluded.updated_at`, repoKey(repo.Ref), b, encodeTime(time.Now()))
	return wrap("save repository", err)
}

func (s *Store) UpsertRepositories(ctx context.Context, repositories []domain.Repository) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return wrap("save repositories", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, repo := range repositories {
		b, marshalErr := json.Marshal(repo)
		if marshalErr != nil {
			return marshalErr
		}
		if _, execErr := tx.ExecContext(ctx, `INSERT INTO repositories(repo_key,repository_json,updated_at) VALUES(?,?,?) ON CONFLICT(repo_key) DO UPDATE SET repository_json=excluded.repository_json,updated_at=excluded.updated_at`, repoKey(repo.Ref), b, encodeTime(time.Now())); execErr != nil {
			return wrap("save repositories", execErr)
		}
	}
	return wrap("save repositories", tx.Commit())
}

func (s *Store) ListRepositories(ctx context.Context) ([]domain.Repository, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT repository_json FROM repositories ORDER BY repo_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Repository
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var v domain.Repository
		if json.Unmarshal(b, &v) == nil {
			out = append(out, v)
		}
	}
	return out, rows.Err()
}

// ListSelectedRepositories loads only repository rows referenced by explicit
// source selections. Organization selections do not need repository metadata
// during bootstrap.
func (s *Store) ListSelectedRepositories(ctx context.Context) ([]domain.Repository, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.repository_json
		FROM repositories r
		JOIN selections s ON s.kind=? AND r.repo_key=('github.com/' || lower(s.selection_key))
		ORDER BY r.repo_key`, domain.SelectionRepository)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Repository
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var repository domain.Repository
		if json.Unmarshal(b, &repository) == nil {
			out = append(out, repository)
		}
	}
	return out, rows.Err()
}

func (s *Store) ListRepositoriesByOwner(ctx context.Context, owner string, limit int) ([]domain.Repository, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	prefix := "github.com/" + strings.ToLower(owner) + "/%"
	rows, err := s.db.QueryContext(ctx, `SELECT repository_json FROM repositories WHERE repo_key LIKE ? ORDER BY repo_key`, prefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Repository, 0, limit)
	for rows.Next() && len(out) < limit {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var repository domain.Repository
		if json.Unmarshal(b, &repository) == nil && !repository.IsArchived && strings.EqualFold(repository.Ref.Owner, owner) {
			out = append(out, repository)
		}
	}
	return out, rows.Err()
}

func (s *Store) UpsertPullRequest(ctx context.Context, pr domain.PullRequest) error {
	b, err := json.Marshal(pr)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO pull_requests(repo_key,number,base_sha,head_sha,pull_request_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(repo_key,number) DO UPDATE SET base_sha=excluded.base_sha,head_sha=excluded.head_sha,pull_request_json=excluded.pull_request_json,updated_at=excluded.updated_at`, repoKey(pr.Ref.Repository), pr.Ref.Number, pr.BaseSHA, pr.HeadSHA, b, encodeTime(time.Now()))
	return wrap("save pull request", err)
}

func (s *Store) ListPullRequests(ctx context.Context) ([]domain.PullRequest, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT pull_request_json FROM pull_requests ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.PullRequest
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var v domain.PullRequest
		if json.Unmarshal(b, &v) == nil {
			out = append(out, v)
		}
	}
	return out, rows.Err()
}

// ListPullRequestSummaries returns the bootstrap inbox in one database query.
// It deliberately avoids hydrating notes, comments, chapters, and full review
// sessions for every cached pull request.
func (s *Store) ListPullRequestSummaries(ctx context.Context) ([]domain.PullRequestSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.pull_request_json,
		       COALESCE(s.analysis_status, ''),
		       CASE
		         WHEN a.analysis_json IS NULL THEN -1
		         WHEN NOT json_valid(a.analysis_json) THEN -2
		         ELSE COALESCE((
		           SELECT MAX(CASE json_extract(r.value, '$.level')
		             WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 0 END)
		           FROM json_each(a.analysis_json, '$.risks') r
		         ), 0)
		       END,
		       COALESCE((SELECT COUNT(*) FROM chapter_progress cp WHERE cp.session_id=s.id), 0),
		       COALESCE((SELECT COUNT(*) FROM chapter_progress cp WHERE cp.session_id=s.id AND cp.status=?), 0),
		       COALESCE((SELECT COUNT(*) FROM chapter_progress cp WHERE cp.session_id=s.id AND cp.status=?), 0),
		       COALESCE((SELECT COUNT(*) FROM chapter_progress cp WHERE cp.session_id=s.id AND cp.status=?), 0)
		FROM pull_requests p
		LEFT JOIN review_sessions s ON s.id=(
			SELECT latest.id FROM review_sessions latest
			WHERE latest.repo_key=p.repo_key AND latest.pr_number=p.number
			ORDER BY latest.updated_at DESC LIMIT 1
		)
		LEFT JOIN analyses a ON a.session_id=s.id
		ORDER BY p.updated_at DESC`, domain.ChapterReviewed, domain.ChapterBlocked, domain.ChapterNeedsClarification)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.PullRequestSummary, 0)
	for rows.Next() {
		var pullRequestJSON []byte
		var analysisStatus domain.AnalysisStatus
		var riskRank, total, reviewed, blocked, clarify int
		if err := rows.Scan(&pullRequestJSON, &analysisStatus, &riskRank, &total, &reviewed, &blocked, &clarify); err != nil {
			return nil, err
		}
		var pullRequest domain.PullRequest
		if json.Unmarshal(pullRequestJSON, &pullRequest) != nil {
			continue
		}
		item := pullRequest.PullRequestSummary
		if analysisStatus != "" {
			item.AnalysisStatus = analysisStatus
		}
		item.Progress = domain.ReviewProgress{Total: total, Reviewed: reviewed, Blocked: blocked, Clarify: clarify}
		if total > 0 {
			item.Progress.Percent = reviewed * 100 / total
		}
		if riskRank == -2 {
			item.AnalysisStatus = domain.AnalysisFailed
		} else if riskRank >= 0 {
			item.RiskLevel = []domain.RiskLevel{domain.RiskUnknown, domain.RiskLow, domain.RiskMedium, domain.RiskHigh, domain.RiskCritical}[riskRank]
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) GetPullRequest(ctx context.Context, ref domain.PullRequestRef) (domain.PullRequest, error) {
	var out domain.PullRequest
	var b []byte
	if err := s.db.QueryRowContext(ctx, `SELECT pull_request_json FROM pull_requests WHERE repo_key=? AND number=?`, repoKey(ref.Repository), ref.Number).Scan(&b); err != nil {
		return out, queryErr("load pull request", err)
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return out, fmt.Errorf("load pull request: corrupt JSON: %w", err)
	}
	return out, nil
}

func (s *Store) SaveSession(ctx context.Context, session domain.ReviewSession) error {
	b, err := json.Marshal(session.PullRequest)
	if err != nil {
		return fmt.Errorf("encode session pull request: %w", err)
	}
	now := session.UpdatedAt
	if now.IsZero() {
		now = time.Now()
	}
	created := session.CreatedAt
	if created.IsZero() {
		created = now
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO review_sessions(id,repo_key,pr_number,base_sha,head_sha,status,analysis_status,pull_request_json,is_stale,stale_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET repo_key=excluded.repo_key,pr_number=excluded.pr_number,base_sha=excluded.base_sha,head_sha=excluded.head_sha,status=excluded.status,analysis_status=excluded.analysis_status,pull_request_json=excluded.pull_request_json,is_stale=excluded.is_stale,stale_reason=excluded.stale_reason,updated_at=excluded.updated_at`, session.ID, repoKey(session.PullRequest.Ref.Repository), session.PullRequest.Ref.Number, session.BaseSHA, session.HeadSHA, session.Status, session.AnalysisStatus, b, session.IsStale, session.StaleReason, encodeTime(created), encodeTime(now))
	return wrap("save review session", err)
}

func (s *Store) SaveAnalysis(ctx context.Context, sessionID string, analysis domain.ReviewAnalysis) error {
	b, err := json.Marshal(analysis)
	if err != nil {
		return fmt.Errorf("encode analysis: %w", err)
	}
	now := time.Now()
	created := analysis.CreatedAt
	if created.IsZero() {
		created = now
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO analyses(session_id,schema_version,base_sha,head_sha,analysis_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET schema_version=excluded.schema_version,base_sha=excluded.base_sha,head_sha=excluded.head_sha,analysis_json=excluded.analysis_json,created_at=excluded.created_at,updated_at=excluded.updated_at`, sessionID, analysis.SchemaVersion, analysis.BaseSHA, analysis.HeadSHA, b, encodeTime(created), encodeTime(now)); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=?,is_stale=0,stale_reason='',updated_at=? WHERE id=?`, domain.AnalysisReady, encodeTime(now), sessionID); err != nil {
		return err
	}
	return tx.Commit()
}

// SaveCompletedAnalysis atomically replaces the analysis and reconciles its
// chapter progress. Callers use this after model generation has completed so
// an operation cancellation cannot leave the two durable views out of sync.
func (s *Store) SaveCompletedAnalysis(ctx context.Context, sessionID string, analysis domain.ReviewAnalysis) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveCompletedAnalysisTx(ctx, tx, sessionID, analysis, time.Now()); err != nil {
		return err
	}
	return tx.Commit()
}

func saveCompletedAnalysisTx(ctx context.Context, tx *sql.Tx, sessionID string, analysis domain.ReviewAnalysis, now time.Time) error {
	body, err := json.Marshal(analysis)
	if err != nil {
		return fmt.Errorf("encode analysis: %w", err)
	}
	created := analysis.CreatedAt
	if created.IsZero() {
		created = now
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO analyses(session_id,schema_version,base_sha,head_sha,analysis_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET schema_version=excluded.schema_version,base_sha=excluded.base_sha,head_sha=excluded.head_sha,analysis_json=excluded.analysis_json,created_at=excluded.created_at,updated_at=excluded.updated_at`, sessionID, analysis.SchemaVersion, analysis.BaseSHA, analysis.HeadSHA, body, encodeTime(created), encodeTime(now)); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT chapter_id,status FROM chapter_progress WHERE session_id=?`, sessionID)
	if err != nil {
		return err
	}
	existing := map[string]domain.ChapterStatus{}
	for rows.Next() {
		var id string
		var status domain.ChapterStatus
		if err := rows.Scan(&id, &status); err != nil {
			rows.Close()
			return err
		}
		existing[id] = status
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM chapter_progress WHERE session_id=?`, sessionID); err != nil {
		return err
	}
	for _, chapter := range analysis.Chapters {
		status, ok := existing[chapter.ID]
		if !ok {
			status = domain.ChapterNotReviewed
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO chapter_progress(session_id,chapter_id,status,updated_at) VALUES(?,?,?,?)`, sessionID, chapter.ID, status, encodeTime(now)); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=?,is_stale=0,stale_reason='',updated_at=? WHERE id=?`, domain.AnalysisReady, encodeTime(now), sessionID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return fmt.Errorf("complete analysis: session %q not found", sessionID)
	}
	return nil
}

func (s *Store) StartAnalysisRun(ctx context.Context, run domain.AnalysisRun) error {
	if run.ID == "" || run.SessionID == "" || run.Profile.Harness == "" || strings.TrimSpace(run.Profile.Model) == "" || run.Profile.Reasoning == "" || run.ContextTransport == "" || run.SchemaVersion < 1 || run.InputFingerprint == "" {
		return errors.New("start analysis run: incomplete provenance")
	}
	if run.Status == "" {
		run.Status = domain.AnalysisRunPreparing
	}
	if run.Status != domain.AnalysisRunPreparing && run.Status != domain.AnalysisRunRunning {
		return fmt.Errorf("start analysis run: invalid status %q", run.Status)
	}
	now := run.UpdatedAt
	if now.IsZero() {
		now = time.Now()
	}
	started := run.StartedAt
	if started.IsZero() {
		started = now
	}
	coverage, err := json.Marshal(run.Coverage)
	if err != nil {
		return fmt.Errorf("encode analysis coverage: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO analysis_runs(id,session_id,harness_id,harness_version,context_transport,model,reasoning_level,schema_version,input_fingerprint,coverage_json,status,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, run.ID, run.SessionID, run.Profile.Harness, run.HarnessVersion, run.ContextTransport, run.Profile.Model, run.Profile.Reasoning, run.SchemaVersion, run.InputFingerprint, coverage, run.Status, encodeTime(started), encodeTime(now)); err != nil {
		return wrap("start analysis run", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=?,updated_at=? WHERE id=?`, domain.AnalysisRunning, encodeTime(now), run.SessionID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return fmt.Errorf("start analysis run: session %q not found", run.SessionID)
	}
	return tx.Commit()
}

func (s *Store) MarkAnalysisRunRunning(ctx context.Context, runID string) error {
	if runID == "" {
		return errors.New("mark analysis run running: run ID is required")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE analysis_runs SET status=?,updated_at=? WHERE id=? AND status=?`, domain.AnalysisRunRunning, encodeTime(time.Now()), runID, domain.AnalysisRunPreparing)
	if err != nil {
		return wrap("mark analysis run running", err)
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return fmt.Errorf("mark analysis run running: run %q is not preparing", runID)
	}
	return nil
}

func (s *Store) CompleteAnalysisRun(ctx context.Context, runID string, analysis domain.ReviewAnalysis, coverage domain.AnalysisCoverage) error {
	coverageJSON, err := json.Marshal(coverage)
	if err != nil {
		return fmt.Errorf("encode analysis coverage: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var sessionID string
	var schemaVersion int
	if err := tx.QueryRowContext(ctx, `SELECT session_id,schema_version FROM analysis_runs WHERE id=? AND status IN (?,?)`, runID, domain.AnalysisRunPreparing, domain.AnalysisRunRunning).Scan(&sessionID, &schemaVersion); err != nil {
		return queryErr("complete analysis run", err)
	}
	if analysis.SchemaVersion != schemaVersion {
		return fmt.Errorf("complete analysis run: schema version %d does not match run version %d", analysis.SchemaVersion, schemaVersion)
	}
	now := time.Now()
	if err := saveCompletedAnalysisTx(ctx, tx, sessionID, analysis, now); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE analysis_runs SET coverage_json=?,status=?,failure_code='',failure_title='',failure_message='',failure_action='',failure_retryable=0,failure_technical_details='',completed_at=?,updated_at=? WHERE id=?`, coverageJSON, domain.AnalysisRunCompleted, encodeTime(now), encodeTime(now), runID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return fmt.Errorf("complete analysis run: run %q changed concurrently", runID)
	}
	return tx.Commit()
}

func (s *Store) FailAnalysisRun(ctx context.Context, runID string, failure domain.AnalysisFailure, coverage domain.AnalysisCoverage) error {
	if failure.Code == "" {
		return errors.New("fail analysis run: failure code is required")
	}
	return s.finishAnalysisRun(ctx, runID, domain.AnalysisRunFailed, &failure, coverage)
}

func (s *Store) CancelAnalysisRun(ctx context.Context, runID string, coverage domain.AnalysisCoverage) error {
	return s.finishAnalysisRun(ctx, runID, domain.AnalysisRunCancelled, nil, coverage)
}

func (s *Store) finishAnalysisRun(ctx context.Context, runID string, status domain.AnalysisRunStatus, failure *domain.AnalysisFailure, coverage domain.AnalysisCoverage) error {
	coverageJSON, err := json.Marshal(coverage)
	if err != nil {
		return fmt.Errorf("encode analysis coverage: %w", err)
	}
	var code, title, message, action, technical string
	var retryable bool
	if failure != nil {
		code, title, message, action, retryable = string(failure.Code), failure.Title, failure.Message, string(failure.Action), failure.Retryable
		technical = boundedTechnicalDetails(failure.TechnicalDetails)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var sessionID string
	if err := tx.QueryRowContext(ctx, `SELECT session_id FROM analysis_runs WHERE id=? AND status IN (?,?)`, runID, domain.AnalysisRunPreparing, domain.AnalysisRunRunning).Scan(&sessionID); err != nil {
		return queryErr("finish analysis run", err)
	}
	now := time.Now()
	result, err := tx.ExecContext(ctx, `UPDATE analysis_runs SET coverage_json=?,status=?,failure_code=?,failure_title=?,failure_message=?,failure_action=?,failure_retryable=?,failure_technical_details=?,completed_at=?,updated_at=? WHERE id=?`, coverageJSON, status, code, title, message, action, retryable, technical, encodeTime(now), encodeTime(now), runID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return fmt.Errorf("finish analysis run: run %q changed concurrently", runID)
	}
	withoutAnalysis := domain.AnalysisFailed
	if status == domain.AnalysisRunCancelled {
		withoutAnalysis = domain.AnalysisNotStarted
	}
	if _, err = tx.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=CASE WHEN EXISTS(SELECT 1 FROM analyses WHERE analyses.session_id=review_sessions.id) THEN CASE WHEN is_stale=1 THEN ? ELSE ? END ELSE ? END,updated_at=? WHERE id=?`, domain.AnalysisStale, domain.AnalysisReady, withoutAnalysis, encodeTime(now), sessionID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ListAnalysisRuns(ctx context.Context, sessionID string) ([]domain.AnalysisRun, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,session_id,harness_id,harness_version,context_transport,model,reasoning_level,schema_version,input_fingerprint,coverage_json,status,failure_code,failure_title,failure_message,failure_action,failure_retryable,failure_technical_details,started_at,completed_at,updated_at FROM analysis_runs WHERE session_id=? ORDER BY started_at DESC,id DESC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AnalysisRun
	for rows.Next() {
		run, err := scanAnalysisRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

type rowScanner interface{ Scan(...any) error }

func scanAnalysisRun(row rowScanner) (domain.AnalysisRun, error) {
	var run domain.AnalysisRun
	var coverage []byte
	var failureCode, failureTitle, failureMessage, failureAction, technical string
	var retryable bool
	var started, updated string
	var completed sql.NullString
	if err := row.Scan(&run.ID, &run.SessionID, &run.Profile.Harness, &run.HarnessVersion, &run.ContextTransport, &run.Profile.Model, &run.Profile.Reasoning, &run.SchemaVersion, &run.InputFingerprint, &coverage, &run.Status, &failureCode, &failureTitle, &failureMessage, &failureAction, &retryable, &technical, &started, &completed, &updated); err != nil {
		return run, err
	}
	if err := json.Unmarshal(coverage, &run.Coverage); err != nil {
		return run, fmt.Errorf("load analysis run %q: corrupt coverage JSON: %w", run.ID, err)
	}
	if failureCode != "" {
		run.Failure = &domain.AnalysisFailure{Code: domain.AnalysisFailureCode(failureCode), Title: failureTitle, Message: failureMessage, Action: domain.AnalysisRetryAction(failureAction), Retryable: retryable, TechnicalDetails: technical}
	}
	run.StartedAt, _ = decodeTime(started)
	run.UpdatedAt, _ = decodeTime(updated)
	if completed.Valid {
		value, err := decodeTime(completed.String)
		if err == nil {
			run.CompletedAt = &value
		}
	}
	return run, nil
}

func (s *Store) latestAnalysisRun(ctx context.Context, sessionID string) (*domain.AnalysisRun, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,session_id,harness_id,harness_version,context_transport,model,reasoning_level,schema_version,input_fingerprint,coverage_json,status,failure_code,failure_title,failure_message,failure_action,failure_retryable,failure_technical_details,started_at,completed_at,updated_at FROM analysis_runs WHERE session_id=? ORDER BY started_at DESC,id DESC LIMIT 1`, sessionID)
	run, err := scanAnalysisRun(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func boundedTechnicalDetails(value string) string {
	const maxTechnicalDetails = 16 << 10
	value = strings.TrimSpace(value)
	if len(value) > maxTechnicalDetails {
		value = value[len(value)-maxTechnicalDetails:]
	}
	return value
}

func (s *Store) GetSession(ctx context.Context, id string) (domain.ReviewSession, error) {
	var v domain.ReviewSession
	var pr []byte
	var created, updated string
	err := s.db.QueryRowContext(ctx, `SELECT id,base_sha,head_sha,status,analysis_status,pull_request_json,is_stale,stale_reason,created_at,updated_at FROM review_sessions WHERE id=?`, id).Scan(&v.ID, &v.BaseSHA, &v.HeadSHA, &v.Status, &v.AnalysisStatus, &pr, &v.IsStale, &v.StaleReason, &created, &updated)
	if err != nil {
		return v, queryErr("load review session", err)
	}
	if err = json.Unmarshal(pr, &v.PullRequest); err != nil {
		return v, fmt.Errorf("load review session %q: corrupt pull request JSON: %w", id, err)
	}
	v.CreatedAt, _ = decodeTime(created)
	v.UpdatedAt, _ = decodeTime(updated)
	var analysis []byte
	err = s.db.QueryRowContext(ctx, `SELECT analysis_json FROM analyses WHERE session_id=?`, id).Scan(&analysis)
	if err == nil {
		var a domain.ReviewAnalysis
		if json.Unmarshal(analysis, &a) == nil {
			v.Analysis = &a
		} else {
			v.AnalysisStatus = domain.AnalysisFailed
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return v, err
	}
	v.LatestAnalysisRun, err = s.latestAnalysisRun(ctx, id)
	if err != nil {
		return v, err
	}
	v.Chapters, err = s.listChapters(ctx, id)
	if err != nil {
		return v, err
	}
	v.Notes, err = s.ListNotes(ctx, id)
	if err != nil {
		return v, err
	}
	v.Comments, err = s.ListComments(ctx, id)
	if err != nil {
		return v, err
	}
	v.Progress = calculateProgress(v.Chapters)
	return v, nil
}

func (s *Store) ListSessions(ctx context.Context) ([]domain.ReviewSession, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM review_sessions ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := make([]domain.ReviewSession, 0, len(ids))
	for _, id := range ids {
		v, err := s.GetSession(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Store) LatestSessionForPullRequest(ctx context.Context, ref domain.PullRequestRef) (domain.ReviewSession, error) {
	var id string
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM review_sessions WHERE repo_key=? AND pr_number=? ORDER BY updated_at DESC LIMIT 1`, repoKey(ref.Repository), ref.Number).Scan(&id); err != nil {
		return domain.ReviewSession{}, queryErr("load latest review session", err)
	}
	return s.GetSession(ctx, id)
}

func (s *Store) SetChapterStatus(ctx context.Context, sessionID, chapterID string, status domain.ChapterStatus) error {
	if !validChapterStatus(status) {
		return fmt.Errorf("save chapter status: invalid status %q", status)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO chapter_progress(session_id,chapter_id,status,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id,chapter_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`, sessionID, chapterID, status, encodeTime(time.Now()))
	return wrap("save chapter status", err)
}

// ReconcileChapterProgress preserves statuses for stable chapter IDs, removes
// chapters no longer present, and initializes only genuinely new chapters.
func (s *Store) ReconcileChapterProgress(ctx context.Context, sessionID string, chapters []domain.ReviewChapter) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT chapter_id,status FROM chapter_progress WHERE session_id=?`, sessionID)
	if err != nil {
		return err
	}
	existing := map[string]domain.ChapterStatus{}
	for rows.Next() {
		var id string
		var status domain.ChapterStatus
		if err := rows.Scan(&id, &status); err != nil {
			rows.Close()
			return err
		}
		existing[id] = status
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chapter_progress WHERE session_id=?`, sessionID); err != nil {
		return err
	}
	now := encodeTime(time.Now())
	for _, chapter := range chapters {
		status, ok := existing[chapter.ID]
		if !ok {
			status = domain.ChapterNotReviewed
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO chapter_progress(session_id,chapter_id,status,updated_at) VALUES(?,?,?,?)`, sessionID, chapter.ID, status, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) listChapters(ctx context.Context, id string) ([]domain.ChapterProgress, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT chapter_id,status,updated_at FROM chapter_progress WHERE session_id=? ORDER BY chapter_id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ChapterProgress
	for rows.Next() {
		var v domain.ChapterProgress
		var t string
		if err := rows.Scan(&v.ChapterID, &v.Status, &t); err != nil {
			return nil, err
		}
		v.UpdatedAt, _ = decodeTime(t)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) SaveNote(ctx context.Context, v domain.ReviewNote) error {
	now := v.UpdatedAt
	if now.IsZero() {
		now = time.Now()
	}
	created := v.CreatedAt
	if created.IsZero() {
		created = now
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO notes(id,session_id,chapter_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,body=excluded.body,updated_at=excluded.updated_at`, v.ID, v.SessionID, v.ChapterID, v.Body, encodeTime(created), encodeTime(now))
	return wrap("save note", err)
}
func (s *Store) DeleteNote(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM notes WHERE id=?`, id)
	return wrap("delete note", err)
}
func (s *Store) ListNotes(ctx context.Context, id string) ([]domain.ReviewNote, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,session_id,chapter_id,body,created_at,updated_at FROM notes WHERE session_id=? ORDER BY created_at,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ReviewNote
	for rows.Next() {
		var v domain.ReviewNote
		var c, u string
		if err := rows.Scan(&v.ID, &v.SessionID, &v.ChapterID, &v.Body, &c, &u); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = decodeTime(c)
		v.UpdatedAt, _ = decodeTime(u)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) SaveComment(ctx context.Context, v domain.ReviewComment) error {
	now := v.UpdatedAt
	if now.IsZero() {
		now = time.Now()
	}
	created := v.CreatedAt
	if created.IsZero() {
		created = now
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO comments(id,session_id,chapter_id,kind,body,path,start_line,start_side,line,side,status,github_id,github_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,kind=excluded.kind,body=excluded.body,path=excluded.path,start_line=excluded.start_line,start_side=excluded.start_side,line=excluded.line,side=excluded.side,status=excluded.status,github_id=excluded.github_id,github_url=excluded.github_url,updated_at=excluded.updated_at`, v.ID, v.SessionID, v.ChapterID, v.Kind, v.Body, v.Path, v.StartLine, v.StartSide, v.Line, v.Side, v.Status, v.GitHubID, v.GitHubURL, encodeTime(created), encodeTime(now))
	return wrap("save comment", err)
}
func (s *Store) DeleteComment(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM comments WHERE id=? AND status=?`, id, domain.CommentDraft)
	return wrap("delete draft comment", err)
}
func (s *Store) ListComments(ctx context.Context, id string) ([]domain.ReviewComment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,session_id,chapter_id,kind,body,path,start_line,start_side,line,side,status,github_id,github_url,created_at,updated_at FROM comments WHERE session_id=? ORDER BY created_at,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ReviewComment
	for rows.Next() {
		var v domain.ReviewComment
		var c, u string
		if err := rows.Scan(&v.ID, &v.SessionID, &v.ChapterID, &v.Kind, &v.Body, &v.Path, &v.StartLine, &v.StartSide, &v.Line, &v.Side, &v.Status, &v.GitHubID, &v.GitHubURL, &c, &u); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = decodeTime(c)
		v.UpdatedAt, _ = decodeTime(u)
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SetCommentPublication(ctx context.Context, id string, status domain.CommentStatus, githubID, githubURL string) error {
	if status != domain.CommentPublished && status != domain.CommentFailed {
		return fmt.Errorf("update comment: invalid publication status %q", status)
	}
	_, err := s.db.ExecContext(ctx, `UPDATE comments SET status=?,github_id=?,github_url=?,updated_at=? WHERE id=?`, status, githubID, githubURL, encodeTime(time.Now()), id)
	return wrap("update comment", err)
}

// MarkStaleIfChanged marks every prior session for a PR stale without deleting
// reviewer-authored progress, notes, or draft comments.
func (s *Store) MarkStaleIfChanged(ctx context.Context, ref domain.PullRequestRef, baseSHA, headSHA string) (bool, error) {
	reason := fmt.Sprintf("pull request revision changed to %s..%s", baseSHA, headSHA)
	res, err := s.db.ExecContext(ctx, `UPDATE review_sessions SET is_stale=1,analysis_status=?,stale_reason=?,updated_at=? WHERE repo_key=? AND pr_number=? AND (base_sha<>? OR head_sha<>?) AND is_stale=0`, domain.AnalysisStale, reason, encodeTime(time.Now()), repoKey(ref.Repository), ref.Number, baseSHA, headSHA)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) SaveOperation(ctx context.Context, v Operation) error {
	now := v.UpdatedAt
	if now.IsZero() {
		now = time.Now()
	}
	created := v.CreatedAt
	if created.IsZero() {
		created = now
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO operations(id,kind,subject,status,detail,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated_at=excluded.updated_at`, v.ID, v.Kind, v.Subject, v.Status, v.Detail, encodeTime(created), encodeTime(now))
	return wrap("save operation", err)
}

func (s *Store) ListOperations(ctx context.Context, limit int) ([]Operation, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,kind,subject,status,detail,created_at,updated_at FROM operations ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Operation
	for rows.Next() {
		var v Operation
		var created, updated string
		if err := rows.Scan(&v.ID, &v.Kind, &v.Subject, &v.Status, &v.Detail, &created, &updated); err != nil {
			return nil, err
		}
		v.CreatedAt, _ = decodeTime(created)
		v.UpdatedAt, _ = decodeTime(updated)
		out = append(out, v)
	}
	return out, rows.Err()
}

func calculateProgress(items []domain.ChapterProgress) domain.ReviewProgress {
	p := domain.ReviewProgress{Total: len(items)}
	for _, v := range items {
		switch v.Status {
		case domain.ChapterReviewed:
			p.Reviewed++
		case domain.ChapterBlocked:
			p.Blocked++
		case domain.ChapterNeedsClarification:
			p.Clarify++
		}
	}
	if p.Total > 0 {
		p.Percent = p.Reviewed * 100 / p.Total
	}
	return p
}
func validChapterStatus(s domain.ChapterStatus) bool {
	switch s {
	case domain.ChapterNotReviewed, domain.ChapterInProgress, domain.ChapterReviewed, domain.ChapterNeedsClarification, domain.ChapterBlocked:
		return true
	}
	return false
}
func encodeTime(t time.Time) string          { return t.UTC().Format(time.RFC3339Nano) }
func decodeTime(v string) (time.Time, error) { return time.Parse(time.RFC3339Nano, v) }
func queryErr(op string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", op, ErrNotFound)
	}
	return wrap(op, err)
}
func wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", op, err)
}
