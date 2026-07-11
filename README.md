# ReviewArc

ReviewArc is a local-first Wails desktop application for reviewing real GitHub pull requests as evidence-backed, guided review journeys. It opens to a unified inbox, creates isolated application-managed Git caches only when a PR is opened, runs Codex in read-only mode, validates every AI-provided code reference, and persists reviewer progress locally in SQLite.

## Prerequisites

- Go 1.24 or newer
- Node.js and npm
- `git`
- GitHub CLI (`gh`), authenticated with `gh auth login`
- Codex CLI, authenticated and available as `codex`

ReviewArc never needs or modifies an existing working checkout. Its managed repositories, temporary snapshots, database, and logs live under the platform user configuration directory. Set `REVIEWARC_DATA_DIR` to override that location for development or testing.

On macOS the default root is `~/Library/Application Support/ReviewArc`. Managed bare repositories are under `repositories/`, temporary read-only analysis snapshots under `worktrees/`, and SQLite state under `database/reviewarc.db`.

## Run in development

```sh
cd frontend
npm install
npm run check
cd ..
go run github.com/wailsapp/wails/v2/cmd/wails@v2.11.0 dev
```

## Build and test

```sh
cd frontend && npm run check && cd ..
go test ./...
go run github.com/wailsapp/wails/v2/cmd/wails@v2.11.0 build
```

The first launch checks local dependencies and the active GitHub account. Select repositories or whole organizations; source discovery does not clone anything. Opening a PR fetches only its required base/head refs into a bare cache owned by ReviewArc.

To clear only managed Git data, quit ReviewArc and remove the `repositories/` and `worktrees/` directories shown in Settings. To reset all local ReviewArc state, remove the entire displayed data root. This deletes private notes, drafts, and progress as well as caches.

## Safety boundaries

- External processes use fixed executables and argument arrays; no shell command strings are constructed.
- Git operations target only the ReviewArc data directory.
- Codex runs non-interactively with JSONL, a strict output schema, an ephemeral session, a read-only sandbox, and no inherited shell environment.
- ReviewArc supplies Codex a derived model catalog with shell tools disabled, so repository command execution is unavailable during analysis.
- Repository scripts, builds, tests, hooks, pushes, merges, and working-tree mutations are never run automatically.
- AI paths and line ranges are validated against the exact pinned Git objects. Unsupported claims remain visibly unverified.
- Publishing is a two-step operation: ReviewArc creates an immutable, expiring preview; the user explicitly confirms its digest before the single `gh api` mutation is allowed.

## Current MVP scope

The MVP supports GitHub.com repositories available through `gh`, a unified selected-source inbox with saved views and quick-open, managed Git caches, unified and split diffs, local file context, existing reviews and inline discussion, check runs, structured Codex review chapters, changed-symbol references, persisted notes/progress/drafts, stale-analysis detection, and COMMENT/APPROVE/REQUEST_CHANGES review events with explicit confirmation. Team workspaces, project command execution, and additional AI providers are intentionally out of scope.

Known limitations: GitHub Enterprise hosts are not yet configurable; linked-issue discovery and full repository-wide semantic caller/dependency indexing are not part of this MVP; an ambiguous network failure after GitHub accepts a review must be reconciled on GitHub before retrying.
