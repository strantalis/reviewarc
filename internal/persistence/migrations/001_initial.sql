CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE selections (
  kind TEXT NOT NULL,
  selection_key TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, selection_key)
);

CREATE TABLE repositories (
  repo_key TEXT PRIMARY KEY,
  repository_json BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pull_requests (
  repo_key TEXT NOT NULL,
  number INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  pull_request_json BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_key, number)
);

CREATE TABLE review_sessions (
  id TEXT PRIMARY KEY,
  repo_key TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  analysis_status TEXT NOT NULL,
  pull_request_json BLOB NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
  stale_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX review_sessions_pr ON review_sessions(repo_key, pr_number, updated_at DESC);

CREATE TABLE analyses (
  session_id TEXT PRIMARY KEY REFERENCES review_sessions(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  analysis_json BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chapter_progress (
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, chapter_id)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_session ON notes(session_id, updated_at);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  line INTEGER,
  side TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  github_id TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX comments_session ON comments(session_id, updated_at);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX operations_updated ON operations(updated_at DESC);
