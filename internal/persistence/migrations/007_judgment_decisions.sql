CREATE TABLE judgment_decisions (
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  disposition TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, finding_id)
);
