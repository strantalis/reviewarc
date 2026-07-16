# ReviewArc

ReviewArc is a local-first Wails desktop application for reviewing real GitHub pull requests as evidence-backed, guided review journeys. It opens to a unified inbox, creates application-managed Git caches only when a PR is opened, runs a selected compatible AI harness through controlled read-only context tools, validates every AI-provided code reference, and persists reviewer progress locally in SQLite.

Product documentation and signed release downloads are published at [reviewarc.dev](https://reviewarc.dev).

## Prerequisites

- macOS with Xcode Command Line Tools (`xcode-select --install`)
- Go 1.26.5 or newer
- Node.js 24 and npm
- `git`
- GitHub CLI (`gh`), authenticated with `gh auth login`
- For guided analysis, either Codex CLI (`codex`) or Claude Code (`claude`), installed and authenticated. A harness is optional for the inbox and existing reviews.

ReviewArc never needs or modifies an existing working checkout. Its managed repositories, temporary snapshots, database, and logs live under the platform user configuration directory. Set `REVIEWARC_DATA_DIR` to override that location for development or testing.

On macOS the default root is `~/Library/Application Support/ReviewArc`. Managed bare repositories are under `repositories/`, immutable per-run analysis bundles are under `cache/analysis-bundles/`, and SQLite state is under `database/reviewarc.db`.

## Run in development

```sh
cd frontend
npm ci
npm run check
cd ..
export REVIEWARC_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/reviewarc-dev.XXXXXX")"
go run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 dev
```

The development data directory is isolated from normal ReviewArc state and is
not removed automatically. Delete it after ReviewArc exits when it is no longer
needed. See [the contribution guide](CONTRIBUTING.md) for all workspaces,
validation commands, and generated-file rules.

## Build and test

```sh
cd frontend && npm run check && cd ..
go test ./...
go run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 build
```

## Signed macOS releases

Tags such as `v0.1.0-beta.1` and `v1.0.0` start the same fail-closed macOS release workflow. Prerelease SemVer tags publish to the beta channel; plain SemVer tags publish to the stable channel. The workflow builds a universal app, applies release metadata, signs it with a Developer ID Application certificate, creates and signs a DMG, submits it to Apple for notarization, staples and verifies the ticket, then publishes the immutable DMG to Vercel Blob and GitHub Releases. The Vercel-hosted Astro site reads the promoted channel manifest dynamically, so publishing a release does not require a site deployment. If signing, notarization, Gatekeeper assessment, upload verification, or packaging fails, the release is not promoted.

The protected `release` GitHub environment requires these variables:

- `APPLE_BUNDLE_ID`
- `APPLE_COPYRIGHT`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`

It also requires these secrets:

- `APPLE_DEVELOPER_ID_P12_BASE64`
- `APPLE_DEVELOPER_ID_P12_PASSWORD`
- `APPLE_NOTARY_KEY_P8_BASE64`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `BLOB_READ_WRITE_TOKEN`

Use a Team App Store Connect API key for notarization; Apple does not support individual API keys with `notarytool`. Never commit the `.p12`, `.p8`, passwords, or tokens. The download and documentation site lives in `site/`; Vercel deploys it from `main`, while its release endpoint reads Blob through Vercel workload identity.

See [the release setup guide](docs/releasing.md) for the Apple Developer, GitHub environment, Vercel Blob, and first-release checklist.

The first launch checks local dependencies and the active GitHub account. Select repositories or whole organizations; source discovery does not clone anything. Opening a PR fetches only its required base/head refs into a bare cache owned by ReviewArc.

To clear only managed Git data, quit ReviewArc and remove the `repositories/` and `worktrees/` directories shown in Settings. To reset all local ReviewArc state, remove the entire displayed data root. This deletes private notes, drafts, and progress as well as caches.

## Safety boundaries

- External processes use fixed executables and argument arrays; no shell command strings are constructed.
- Git operations target only the ReviewArc data directory.
- Analysis adapters must support ReviewArc's JSON Schema contract, explicit model and reasoning selection, cancellation, and enforceable controlled read-only context.
- The initial prompt contains only an immutable bundle identity and digest. Pull-request metadata and per-file diffs remain in local artifacts and are exposed only through bounded, audited ReviewArc tools.
- Codex runs with its read-only sandbox and shell-disabled model catalog. Claude Code runs with built-in tools disabled and only ReviewArc's MCP tools allowed.
- Repository scripts, builds, tests, hooks, pushes, merges, and working-tree mutations are never run automatically.
- AI paths and line ranges are validated against the exact pinned Git objects. Unsupported claims remain visibly unverified.
- Publishing is a two-step operation: ReviewArc creates an immutable, expiring preview; the user explicitly confirms its digest before the single `gh api` mutation is allowed.

## Current MVP scope

The MVP supports GitHub.com repositories available through `gh`, a unified selected-source inbox with saved views and quick-open, managed Git caches, unified and split diffs, local file context, existing reviews and inline discussion, check runs, structured guided-review chapters through Codex or Claude Code, changed-symbol references, persisted analysis provenance/coverage, notes/progress/drafts, stale-analysis detection, and COMMENT/APPROVE/REQUEST_CHANGES review events with explicit confirmation. Team workspaces and project command execution remain out of scope.

Known limitations: GitHub Enterprise hosts are not yet configurable; linked-issue discovery and full repository-wide semantic caller/dependency indexing are not part of this MVP; an ambiguous network failure after GitHub accepts a review must be reconciled on GitHub before retrying.
