CREATE TABLE accessible_repositories (
  account_login TEXT NOT NULL,
  repo_key TEXT NOT NULL REFERENCES repositories(repo_key) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sync_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_login, repo_key)
);

CREATE INDEX accessible_repositories_name ON accessible_repositories(account_login, owner, name);
CREATE INDEX accessible_repositories_sync ON accessible_repositories(account_login, sync_id);
