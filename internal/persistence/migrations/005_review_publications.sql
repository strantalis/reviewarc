CREATE TABLE review_publications (
  token TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  repo_key TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  event TEXT NOT NULL,
  draft_ids_json BLOB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('publishing', 'published', 'applied')),
  github_id TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX review_publications_session ON review_publications(session_id, updated_at DESC);
