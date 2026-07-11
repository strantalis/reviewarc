# Architecture

ReviewArc is a Wails v2 application. Go owns dependency detection, GitHub and Git process execution, managed repository state, Codex orchestration, validation, publishing, and SQLite persistence. React and TypeScript render the inbox, analysis overview, three-panel review workspace, notes, progress, drafts, and explicit publish confirmation.

The frontend calls a narrow Wails bridge in `frontend/src/bridge.ts`. Domain contracts live in `internal/domain`. The GitHub client uses structured `gh api` and `gh pr list --json` responses. The Git manager accepts typed repository and revision inputs and invokes `git` with fixed argument arrays. The Codex provider consumes JSONL, requires a strict JSON schema, and validates evidence before converting it to the persisted review model.

SQLite stores source selections, repository and PR metadata, sessions, analyses, chapter progress, private notes, comment drafts/publication state, and operation history. Sessions are keyed independently of local checkout paths. Reopening a changed PR reuses the session, preserves reviewer-authored state, and marks prior analysis stale.

Runtime data flows in one direction: GitHub metadata identifies exact revisions; the managed cache fetches them; a read-only snapshot and parsed diff become Codex input; validated structured output becomes a review session; reviewer mutations are persisted locally; only the separately confirmed publish path mutates GitHub.
