# Contributing to ReviewArc

ReviewArc uses an explicit contributor trust list to keep maintenance load and
automated low-quality submissions manageable. Start with an issue before doing
implementation work so scope, safety constraints, and validation are agreed on
before a pull request is opened.

## Propose a change first

Open a bug report or feature proposal that describes:

- the problem and affected workflow;
- the smallest proposed scope;
- relevant security, privacy, or release implications; and
- how the change will be validated.

The maintainer may add people with demonstrated context and constructive
participation to `.github/VOUCHED.td`. Pull requests from people who are neither
vouched nor repository collaborators are automatically closed; they may be
reopened after the contributor is vouched. Vouch is an experimental intake
mechanism. Being vouched does not grant write access or bypass review, required
CI, or CODEOWNERS approval.

Do not open a public issue for a suspected vulnerability. Follow
[the security policy](.github/SECURITY.md) instead.

## Development environment

The supported development and release target is macOS. Install:

- Xcode Command Line Tools (`xcode-select --install`);
- Go 1.26.5 or newer;
- Node.js 24 and npm;
- `git`;
- GitHub CLI (`gh`), authenticated with `gh auth login`; and
- optionally, an authenticated Codex CLI (`codex`) or Claude Code (`claude`)
  installation for guided-analysis work.

Install the three Node workspaces from the repository root:

```sh
npm ci --prefix frontend
npm ci --prefix site
npm ci --prefix scripts/release
```

Install the GolangCI-Lint release recorded in `.golangci-lint-version` using
the official binary installation instructions. CI uses that exact version.

ReviewArc does not use an existing working checkout for analyzed repositories.
For development, keep its database, managed repositories, logs, and analysis
artifacts isolated from normal application state:

```sh
export REVIEWARC_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/reviewarc-dev.XXXXXX")"
go run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 dev
```

The temporary data directory is not removed automatically. Delete it after
ReviewArc exits if the state is no longer needed.

Run the documentation and download site separately with:

```sh
npm --prefix site run dev
```

## Repository map

- `app.go`, `main.go`, and the other root Go files: Wails application boundary.
- `internal/`: domain, GitHub, managed Git, analysis, persistence, process, and
  updater packages.
- `frontend/src/`: React and TypeScript desktop interface.
- `frontend/wailsjs/`: committed Wails-generated runtime and bindings.
- `site/`: Astro documentation, release pages, and update-feed endpoints.
- `build/darwin/`: macOS metadata and pinned Sparkle integration.
- `scripts/release/`: deterministic signing, notarization, packaging, and
  publication tooling.
- `docs/`: architecture, security, managed-cache, release, and historical
  product specifications.

Read [the architecture overview](docs/architecture.md),
[security model](docs/security-model.md), and
[managed repository cache](docs/managed-repository-cache.md) before changing a
trust boundary or data flow. Release changes also require
[the release guide](docs/releasing.md).

## Validate a change

Run the checks relevant to the changed area. Before requesting review, install
the workspaces above and run the full local equivalent of CI:

```sh
scripts/check.sh
```

The script runs strict frontend, site, and Go linting, frontend and site checks
and builds, Go formatting, vet and tests, release-tool checks, notice freshness,
and the Wails build. Some focused
integration checks are opt-in because they use installed external tools. For example,
`REVIEWARC_LIVE_CODEX=1 go test ./internal/analysiscontext` exercises the live
Codex context boundary. State which optional checks ran in the pull request.

## Generated and locked files

- Do not hand-edit `frontend/wailsjs/`. After changing a Wails-bound Go method
  or model, run `go run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 generate module`,
  then `npm --prefix frontend run normalize:bindings`, and commit the resulting
  bindings.
- Do not hand-edit `THIRD_PARTY_NOTICES.txt`. Fetch the pinned Sparkle archive,
  then run `node scripts/release/generate_third_party_notices.mjs` and commit the
  generated notice file.
- Update `package-lock.json` files with npm, not by editing them directly.
- Treat committed SQLite migrations as append-only. Add a new numbered
  migration rather than changing a migration that may already have run.

## Pull requests and commits

Keep pull requests narrow, preserve unrelated work, include appropriate tests,
and link the approved issue. Explain user-visible behavior, trust-boundary
changes, generated output, and any check that could not be run. Never include
tokens, private keys, credentials, private repository contents, or user data in
issues, fixtures, logs, commits, or pull requests.

Use Conventional Commits, such as `fix: handle cancelled analysis` or
`docs: clarify local setup`. Approval, CODEOWNERS review, resolved conversations,
and the required CI check apply even to vouched contributors.

## Maintaining the Vouch list

Vouch-list changes are maintainer-controlled. Add one lowercase platform handle
per line to `.github/VOUCHED.td`, for example `github:octocat`, keep entries
sorted, and include the trust-list change in a reviewed commit. Remove an entry
when that trust is withdrawn. Bots and collaborators with write access are
allowed by Vouch automatically, but they remain subject to the repository's
other rules.

## Contribution license

ReviewArc is licensed under Apache-2.0. Under section 5 of that license, an
intentional contribution submitted for inclusion in ReviewArc is provided under
Apache-2.0 unless it is explicitly designated in writing as "Not a
Contribution." By opening a pull request, you confirm that you have the right to
submit the work on those terms. ReviewArc does not currently require a separate
contributor license agreement.
