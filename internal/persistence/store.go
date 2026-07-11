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
	result, err := s.db.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=?,updated_at=? WHERE analysis_status=?`, domain.AnalysisFailed, encodeTime(time.Now()), domain.AnalysisRunning)
	if err != nil {
		return 0, wrap("recover interrupted analyses", err)
	}
	return result.RowsAffected()
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
	if _, err = tx.ExecContext(ctx, `UPDATE review_sessions SET analysis_status=?,is_stale=0,stale_reason='',updated_at=? WHERE id=?`, domain.AnalysisReady, encodeTime(now), sessionID); err != nil {
		return err
	}
	return tx.Commit()
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
	_, err := s.db.ExecContext(ctx, `INSERT INTO comments(id,session_id,chapter_id,kind,body,path,line,side,status,github_id,github_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,kind=excluded.kind,body=excluded.body,path=excluded.path,line=excluded.line,side=excluded.side,status=excluded.status,github_id=excluded.github_id,github_url=excluded.github_url,updated_at=excluded.updated_at`, v.ID, v.SessionID, v.ChapterID, v.Kind, v.Body, v.Path, v.Line, v.Side, v.Status, v.GitHubID, v.GitHubURL, encodeTime(created), encodeTime(now))
	return wrap("save comment", err)
}
func (s *Store) DeleteComment(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM comments WHERE id=? AND status=?`, id, domain.CommentDraft)
	return wrap("delete draft comment", err)
}
func (s *Store) ListComments(ctx context.Context, id string) ([]domain.ReviewComment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,session_id,chapter_id,kind,body,path,line,side,status,github_id,github_url,created_at,updated_at FROM comments WHERE session_id=? ORDER BY created_at,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ReviewComment
	for rows.Next() {
		var v domain.ReviewComment
		var c, u string
		if err := rows.Scan(&v.ID, &v.SessionID, &v.ChapterID, &v.Kind, &v.Body, &v.Path, &v.Line, &v.Side, &v.Status, &v.GitHubID, &v.GitHubURL, &c, &u); err != nil {
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
