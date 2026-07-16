PRAGMA foreign_keys=OFF;

ALTER TABLE analysis_runs RENAME TO analysis_runs_before_queue;

CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  harness_id TEXT NOT NULL,
  harness_version TEXT NOT NULL DEFAULT '',
  context_transport TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_level TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  coverage_json BLOB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'completed', 'failed', 'cancelled')),
  failure_code TEXT NOT NULL DEFAULT '',
  failure_title TEXT NOT NULL DEFAULT '',
  failure_message TEXT NOT NULL DEFAULT '',
  failure_action TEXT NOT NULL DEFAULT '',
  failure_retryable INTEGER NOT NULL DEFAULT 0 CHECK (failure_retryable IN (0, 1)),
  failure_technical_details TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO analysis_runs SELECT * FROM analysis_runs_before_queue;
DROP TABLE analysis_runs_before_queue;

CREATE INDEX analysis_runs_session ON analysis_runs(session_id, started_at DESC);
CREATE INDEX analysis_runs_status ON analysis_runs(status, updated_at);
CREATE UNIQUE INDEX analysis_runs_one_active_session ON analysis_runs(session_id)
  WHERE status IN ('queued', 'preparing', 'running');

PRAGMA foreign_keys=ON;
