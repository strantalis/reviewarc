# Architecture

ReviewArc is a Wails v2 application. Go owns dependency detection, GitHub and Git process execution, managed repository state, AI harness orchestration, validation, publishing, and SQLite persistence. React and TypeScript render the inbox, analysis setup and overview, three-panel review workspace, notes, progress, drafts, and explicit publish confirmation.

The frontend calls a narrow Wails bridge in `frontend/src/bridge.ts`. Domain contracts live in `internal/domain`. The GitHub client uses structured `gh api` and `gh pr list --json` responses. The Git manager accepts typed repository and revision inputs and invokes `git` with fixed argument arrays. An adapter-neutral registry discovers capabilities and resolves the selected harness, model, reasoning level, and controlled context transport. Codex and Claude Code adapters normalize their streams into one strict JSON Schema decoder and evidence validator.

SQLite stores source selections, the default analysis profile, repository and PR metadata, sessions, append-only analysis runs and provenance, analyses, chapter progress, private notes, comment drafts/publication state, and operation history. Sessions are keyed independently of local checkout paths. Reopening a changed PR reuses the session, preserves reviewer-authored state, and marks prior analysis stale.

Runtime data flows in one direction: GitHub metadata identifies exact revisions; the managed cache fetches them; ReviewArc writes an immutable artifact bundle; a harness reads selected pages through bounded read-only tools; validated structured output and measured coverage become a review session; reviewer mutations are persisted locally; only the separately confirmed publish path mutates GitHub.
