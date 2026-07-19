ALTER TABLE review_sessions ADD COLUMN archived_at TEXT;
ALTER TABLE review_sessions ADD COLUMN archive_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX review_sessions_active_pr ON review_sessions(repo_key, pr_number, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX review_sessions_archived ON review_sessions(archived_at DESC)
  WHERE archived_at IS NOT NULL;
