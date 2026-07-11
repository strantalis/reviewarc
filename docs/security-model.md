# Security model

ReviewArc treats repository content, pull-request text, and AI output as untrusted input.

Process execution is allowlisted to `git`, `gh`, and `codex` with argument arrays rather than shell command strings. Repository owner, name, revision, and path inputs are validated. Git commands disable hooks and target only ReviewArc-owned paths. The application never accepts an existing checkout as an execution directory and never runs builds, tests, package managers, scripts, pushes, or merges.

Codex runs non-interactively with an ephemeral session, read-only sandbox, ignored user rules/configuration, no inherited environment, a strict output schema, and a temporary model catalog whose shell type is disabled. ReviewArc then validates every AI path, revision, and inclusive line range against the pinned base or head object. A statement without valid evidence is unverified; invalid references are not navigable.

GitHub credentials remain owned by `gh`; ReviewArc does not store tokens. Publishing is the only external mutation. It requires an immutable five-minute preview, digest confirmation, and a fresh head-SHA check. Confirmation tokens are single-use to reduce duplicate-publication risk. If network state is ambiguous after publication, the UI directs the reviewer to reconcile on GitHub before retrying.

Local state contains private notes and draft comments. ReviewArc creates its data directories with user-only permissions where supported. Users should protect the operating-system account and remove the displayed data root when a full local reset is required.
