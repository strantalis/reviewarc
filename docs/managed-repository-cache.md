# Managed repository cache

ReviewArc stores one bare Git repository per GitHub repository under the application data root. Cache paths are derived from validated host, owner, and repository names; callers cannot supply arbitrary filesystem destinations.

Opening a pull request creates or verifies the bare cache, records the literal origin URL, and fetches the exact base and head revisions required for that PR. Fork pull requests can fetch the head object from the validated fork URL. ReviewArc verifies requested object IDs before diffing. It does not check out into the user's repository and does not run repository hooks.

Diff metadata and hunks are generated from the pinned objects. Codex analysis uses an application-owned temporary snapshot under `worktrees/`, acquired as a read-only lease and removed after use. Concurrent destructive cache updates are excluded while a snapshot is leased.

The cache is disposable; SQLite reviewer state is separate. Quit ReviewArc before manually clearing cache directories. Remove only `repositories/` and `worktrees/` to force refetching while retaining notes and progress, or remove the entire ReviewArc data root for a full reset.
