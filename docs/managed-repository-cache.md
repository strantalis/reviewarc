# Managed repository cache

ReviewArc stores one bare Git repository per GitHub repository under the application data root. Cache paths are derived from validated host, owner, and repository names; callers cannot supply arbitrary filesystem destinations.

## Local data layout

On macOS, the default data root is `~/Library/Application Support/ReviewArc`. The resolved root is shown in ReviewArc settings. `REVIEWARC_DATA_DIR` can override it for isolated development and testing.

- `database/reviewarc.db` stores source selections, review sessions, analysis provenance, private notes, drafts, decisions, and publication history.
- `repositories/` contains application-managed bare Git repositories.
- `worktrees/` contains temporary ReviewArc-managed worktrees when a workflow requires one.
- `cache/analysis-bundles/` contains immutable private artifacts for active analysis runs.
- `logs/` contains local application diagnostics.

These paths belong exclusively to ReviewArc. Do not point the data root at an existing checkout or a directory managed by another application.

## Cache lifecycle

Opening a pull request creates or verifies the bare cache, records the literal origin URL, and fetches the exact base and head revisions required for that PR. Fork pull requests can fetch the head object from the validated fork URL. ReviewArc verifies requested object IDs before diffing. It does not check out into the user's repository and does not run repository hooks.

Diff metadata and hunks are generated from the pinned objects. Analysis creates an immutable private bundle under `cache/analysis-bundles/` with PR metadata and separate, pageable per-file diff artifacts. The selected harness receives only the bundle identity and uses a constrained local context server to read bounded pages or pinned file ranges. The bundle is verified by digest and removed when its run lease ends.

The cache is disposable; SQLite reviewer state is separate. Quit ReviewArc before manually clearing cache directories. Remove only `repositories/` and `worktrees/` to force refetching while retaining notes and progress, or remove the entire ReviewArc data root for a full reset.
