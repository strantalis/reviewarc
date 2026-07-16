# Build ReviewArc End-to-End MVP

> Historical implementation specification. For current behavior and limitations, see the root README and user documentation.

Build a functional end-to-end MVP of ReviewArc, a local-first desktop application for understanding and reviewing complex pull requests across multiple GitHub repositories.

This must be a working product vertical slice, not a static mockup, UI-only prototype, or disconnected collection of partially implemented modules.

Use:

- Wails for the desktop application
- Go for the backend
- React and TypeScript for the frontend
- SQLite for local persistence
- `git` for repository operations
- `gh` for GitHub authentication, discovery, and review operations
- Codex CLI as the initial AI analysis provider

## Product Goal

ReviewArc helps engineers understand pull requests as structured, evidence-backed review journeys instead of flat collections of changed files and diff hunks.

When a user launches ReviewArc, they should immediately see a unified inbox of pull requests across the repositories and organizations they care about.

The user should not need to manually select or clone a local repository before seeing their pull requests.

When a pull request is opened, ReviewArc should automatically obtain the necessary repository context using an isolated application-managed clone or Git object cache. The app then analyzes the pull request, creates a guided walkthrough, displays relevant code in context, tracks review progress, and allows the user to publish review feedback to GitHub.

The application must be usable with real GitHub repositories and pull requests by the end of this implementation.

## Primary Product Experience

The primary workflow is:

```text
GitHub account
      ↓
Cross-repository PR inbox
      ↓
Open a pull request
      ↓
Managed repository cache
      ↓
Codex analysis
      ↓
Guided review walkthrough
      ↓
Publish feedback to GitHub
```

A local repository checkout may optionally be linked later for richer analysis, but it must not be required for the core MVP flow.

## Core Product Promise

> Understand the change, not just the diff.

ReviewArc should help the reviewer answer:

- What behavior is changing?
- Why do these files belong together?
- Which execution paths are affected?
- What should receive the most review attention?
- Which claims are facts, inferences, or unknowns?
- Are important behaviors covered by tests?
- Which review sections have I completed?
- What feedback should I leave before approving?

## Execution Strategy

Use subagents aggressively and intentionally.

Before editing code, divide the implementation into parallel workstreams and assign focused subagents for at least:

1. Application architecture and shared domain contracts
2. GitHub authentication and cross-repository PR discovery
3. Managed Git repository caching and revision handling
4. Codex CLI integration and structured analysis
5. SQLite persistence and migrations
6. React frontend and desktop review experience
7. Testing, safety review, and end-to-end verification

Additional focused subagents may be created when useful.

Each subagent must:

- Have a clearly defined ownership area
- Inspect relevant existing code before making changes
- Work against shared domain contracts
- Produce implementation-ready changes
- Document assumptions and integration requirements
- Avoid duplicating work assigned elsewhere
- Run focused tests for its area

The primary agent must:

- Establish shared contracts before parallel implementation begins
- Coordinate interfaces between subagents
- Integrate changes continuously
- Resolve mismatches between workstreams
- Avoid leaving disconnected implementations
- Run the complete application
- Exercise the full user flow
- Assign a final review subagent to inspect the integrated result
- Fix high-confidence issues found during final review

Do not stop after producing plans, interfaces, placeholder components, mock data, or partially connected modules.

## Core User Flow

The completed MVP must support this full workflow:

1. Launch ReviewArc.
2. Detect whether `git`, `gh`, and `codex` are installed.
3. Detect the authenticated GitHub user through `gh`.
4. Clearly guide the user when GitHub authentication is unavailable.
5. Discover accessible GitHub organizations and repositories.
6. Allow the user to select organizations or repositories to include.
7. Save those source preferences.
8. Load relevant open pull requests across selected repositories.
9. Display a unified pull request inbox.
10. Filter pull requests by review relationship and status.
11. Open a pull request without requiring a preexisting local checkout.
12. Create or update an isolated managed repository cache.
13. Fetch the base and head revisions for the selected pull request.
14. Load pull request metadata, commits, changed files, and comments.
15. Display actual diff statistics and changed files.
16. Start Codex analysis.
17. Stream visible analysis progress to the frontend.
18. Support cancelling analysis.
19. Validate the structured AI output.
20. Generate a pull request overview and review chapters.
21. Open a chapter and inspect relevant code and diffs.
22. Navigate from evidence references to actual code.
23. Mark chapters as reviewed, blocked, or needing clarification.
24. Create private review notes.
25. Draft inline or general GitHub review comments.
26. Require explicit confirmation before publishing.
27. Publish feedback through `gh`.
28. Close and reopen the application.
29. Restore the inbox, review session, progress, notes, and drafts.

## First-Run Experience

On first launch:

1. Check required dependencies.
2. Detect the authenticated GitHub account.
3. Display the signed-in GitHub username.
4. Load accessible organizations and repositories.
5. Allow the user to select which sources ReviewArc should include.
6. Save those selections.
7. Load the unified pull request inbox.

Do not require the user to browse for a local Git repository.

Provide clear states for:

- `gh` not installed
- GitHub authentication missing
- GitHub authentication expired
- No accessible repositories
- No repositories selected
- No matching pull requests
- Network or API errors
- Git repository fetch failures
- Codex unavailable

## Pull Request Inbox

The home screen should be a cross-repository review inbox.

It should support at minimum:

- Pull requests where review is requested from the current user
- Pull requests assigned to the current user
- Pull requests authored by the current user
- Open pull requests from selected repositories
- Search by title, repository, author, or pull request number
- Filtering by repository
- Filtering by organization
- Filtering by relationship
- Filtering by analysis status
- Sorting by last updated
- Sorting by review priority where available

Each pull request card or row should show:

- Repository
- Pull request number
- Title
- Author
- Last updated time
- Draft status
- Review-request status
- Additions and deletions
- Changed-file count
- Analysis status
- Review progress
- Risk level when analysis exists

Example:

```text
Needs your review

acme/auth-service
#428 Rotate refresh tokens
High risk · 18–25 min · Walkthrough ready

acme/billing
#913 Reconcile delayed payments
Medium risk · Analysis not started

acme/web
#122 Replace navigation framework
Draft · Authored by you
```

Do not use hard-coded pull request data outside tests and development fixtures.

## Repository Source Selection

Allow the user to choose the repositories included in the inbox.

Support:

- Selecting individual repositories
- Selecting all repositories within an organization
- Searching the repository list
- Enabling or disabling a repository later
- Persisting source selections
- Refreshing repository access

Avoid cloning repositories during source selection.

Only create a managed repository cache when a pull request is opened or explicitly prepared for analysis.

## Managed Repository Cache

ReviewArc must not depend on the user’s existing working directories.

Maintain isolated application-managed Git data under the platform-appropriate application data directory.

Conceptual structure:

```text
reviewarc-data/
├── repositories/
│   └── github.com/
│       └── organization/
│           └── repository.git
├── worktrees/
│   └── repository/
│       └── pr-428/
├── database/
├── logs/
└── cache/
```

The exact physical layout may differ, but it must support multiple repositories and multiple pull requests safely.

### Requirements

- Prefer bare or mirrored repository caches where appropriate.
- Fetch only the refs and objects needed when practical.
- Support multiple pull requests from the same repository.
- Avoid modifying the user’s own repository checkout.
- Avoid switching branches in an existing user directory.
- Resolve base and head revisions without requiring checkout.
- Read file content directly from Git objects when possible.
- Create a temporary isolated worktree only when filesystem access is required.
- Clean up stale temporary worktrees safely.
- Preserve reusable Git object caches to avoid unnecessary recloning.
- Handle renamed, deleted, binary, and newly added files.
- Handle fork-based pull requests.
- Apply timeouts and cancellation to clone and fetch operations.
- Expose meaningful fetch progress to the UI.
- Never run repository scripts automatically.

Optionally support linking an existing local checkout, but treat this only as a later optimization. It must not block the default flow.

## GitHub Integration

Use `gh` as the initial GitHub integration.

Implement:

- Authentication status
- Current GitHub user
- Accessible organizations
- Accessible repositories
- Pull request discovery
- Pull request metadata
- Pull request commits
- Base and head repository information
- Base and head revisions
- Changed files
- Diff metadata
- Existing comments and review threads where practical
- Requested reviewers
- Assignees
- Labels
- Draft status
- Review states
- Publishing general review comments
- Publishing inline comments when supported
- Submitting a review when included in scope

Use structured `gh` JSON output whenever available.

Do not parse decorative terminal output when structured output exists.

Create a GitHub client interface so the integration can later move from `gh` to a GitHub App or direct API without rewriting the product domain.

Example:

```go
type GitHubClient interface {
    CurrentUser(ctx context.Context) (GitHubUser, error)
    ListOrganizations(ctx context.Context) ([]Organization, error)
    ListRepositories(ctx context.Context, input RepositoryQuery) ([]Repository, error)
    ListPullRequests(ctx context.Context, input PullRequestQuery) ([]PullRequestSummary, error)
    GetPullRequest(ctx context.Context, repository RepositoryRef, number int) (PullRequest, error)
    PublishComment(ctx context.Context, input PublishCommentInput) (PublishedComment, error)
}
```

## Required Screens

### 1. Pull Request Inbox

Display:

- Signed-in GitHub user
- Selected organizations and repositories
- Repository-source settings
- Search and filters
- Pull request list
- Analysis status
- Review progress
- Refresh action
- Dependency status
- Errors and partial-loading states

### 2. Pull Request Detail and Overview

Display:

- Repository
- Pull request title and number
- Author
- Description
- Base and head branches
- Commit count
- Additions and deletions
- Changed-file count
- Requested reviewers
- Existing review status
- Summary of what changed
- Affected areas
- Risk level
- Review hotspots
- Unknown or unexplained decisions
- Review chapter list
- Start or continue analysis
- Start or continue guided review

### 3. Analysis Progress

Display real progress events such as:

- Loading pull request
- Preparing repository cache
- Fetching revisions
- Reading repository instructions
- Building change context
- Running Codex analysis
- Validating evidence
- Saving review session

Include:

- Progress status
- Streamed high-level events
- Cancellation
- Actionable error messages
- Retry support

Do not expose raw chain-of-thought or hidden model reasoning.

### 4. Guided Review Screen

Use a desktop-oriented three-panel layout.

#### Left panel

- Review chapters
- Chapter statuses
- Overall completion
- Changed files
- Navigation between hotspots

#### Center panel

- File tabs
- Real unified diff
- Optional split diff if practical
- Line numbers
- Surrounding source context
- Highlighted evidence ranges
- Navigation between referenced locations
- Base and head file views
- Handling for additions, deletions, and renames

#### Right panel

- Chapter purpose
- Facts
- Inferences
- Unknowns
- Risks
- Behavioral changes
- Related files
- Related symbols
- Related tests
- Suggested reviewer questions
- Private notes
- Draft comment action

### 5. Review Summary

Display:

- Review completion
- Completed chapters
- Chapters needing clarification
- Blocked chapters
- Remaining risks
- Unknowns
- Private notes
- Draft comments
- Published comments
- Final review summary
- Open in GitHub action

### 6. Settings

Include:

- GitHub account status
- Selected organizations and repositories
- AI provider status
- Managed cache location
- Cache size and cleanup action
- Analysis settings
- Application logs location
- Local data reset controls

## Review Domain Model

Define a stable internal review model shared by backend and frontend.

At minimum:

```ts
type ReviewSession = {
  id: string;
  repository: RepositoryRef;
  pullRequest: PullRequestRef;
  baseRevision: string;
  headRevision: string;
  status: ReviewSessionStatus;
  analysisStatus: AnalysisStatus;
  summary: ReviewSummary;
  chapters: ReviewChapter[];
  risks: ReviewRisk[];
  unknowns: ReviewUnknown[];
  notes: ReviewNote[];
  comments: ReviewComment[];
  progress: ReviewProgress;
  createdAt: string;
  updatedAt: string;
};
```

A review chapter should include:

```ts
type ReviewChapter = {
  id: string;
  order: number;
  title: string;
  description: string;
  purpose: string;
  status: ReviewStatus;
  evidence: EvidenceReference[];
  files: FileReference[];
  symbols: SymbolReference[];
  behavioralChanges: BehavioralChange[];
  risks: ReviewRisk[];
  unknowns: ReviewUnknown[];
  relatedTests: TestReference[];
  suggestedQuestions: SuggestedQuestion[];
};
```

An evidence reference should include:

```ts
type EvidenceReference = {
  id: string;
  path: string;
  revision: "base" | "head";
  startLine: number;
  endLine: number;
  symbol?: string;
  validationStatus: "valid" | "invalid" | "unverified";
};
```

## Facts, Inferences, and Unknowns

Every meaningful AI-generated claim must be categorized as:

- Fact
- Inference
- Unknown

### Fact

Directly supported by:

- Pull request metadata
- Issue or commit context
- Repository code
- Tests
- Git history
- Existing documentation

### Inference

A likely interpretation based on the available evidence.

### Unknown

A significant behavior, decision, assumption, or requirement that cannot be determined from available evidence.

The UI must not present inferred author intent as fact.

Each fact or inference should include supporting evidence where possible.

## Codex CLI Integration

Use Codex CLI as the first AI analysis provider.

Create a provider-independent interface.

Example:

```go
type ReviewAgent interface {
    AnalyzeChange(
        ctx context.Context,
        input AnalyzeChangeInput,
    ) (<-chan ReviewEvent, error)

    AnswerQuestion(
        ctx context.Context,
        input ReviewQuestionInput,
    ) (<-chan ReviewEvent, error)

    InspectRisk(
        ctx context.Context,
        input InspectRiskInput,
    ) (<-chan ReviewEvent, error)
}
```

### Codex requirements

- Invoke Codex non-interactively.
- Use a structured output mode.
- Prefer JSON or JSONL.
- Stream progress events.
- Support cancellation.
- Capture stderr.
- Return useful exit errors.
- Apply timeouts.
- Never rely on conversational Markdown as the primary contract.
- Validate all returned file paths.
- Validate revisions.
- Validate line ranges.
- Detect paths outside the selected managed repository.
- Mark invalid claims or evidence as unverified.
- Do not silently discard validation failures.
- Keep the analysis operation read-only.
- Prevent Codex from changing the repository.
- Do not allow arbitrary commands suggested by Codex.
- Do not expose unrelated environment variables.

The analysis input should include:

- Pull request title
- Pull request description
- Labels
- Commit messages
- Base and head revisions
- Changed-file list
- Diff
- Repository instructions
- Relevant existing tests
- Existing review discussion where useful
- Managed repository path
- Clear read-only instructions

The structured output should produce:

- Overall change summary
- Affected areas
- Review chapters
- Behavioral changes
- Risks
- Unknowns
- Suggested reviewer questions
- Evidence references
- Related tests where identifiable
- Estimated review hotspots
- Optional estimated review effort

## Diff and Code Context

The application must display actual code and diffs.

At minimum:

- Unified diff
- Additions and deletions
- Old and new line numbers
- Readable monospace rendering
- File status
- Rename handling
- New-file handling
- Deleted-file handling
- Binary-file fallback
- Collapsible unchanged regions where practical
- Full base or head file context
- Navigation from evidence to code
- Navigation between changed files
- Clear indication of which revision is displayed

Do not use hard-coded sample diffs in the real application flow.

A lightweight custom diff renderer is acceptable. Monaco may be used if it integrates cleanly, but do not let editor integration consume the entire MVP effort.

## Symbol and Test Discovery

Implement a practical MVP-level discovery system for:

- Changed symbols
- Likely callers or references
- Related tests
- Relevant repository instructions

It may use:

- Diff hunk parsing
- File-level heuristics
- `git grep`
- `rg`
- Tree-sitter where practical
- Language-specific heuristics for Go and TypeScript

Label heuristic relationships as heuristic or unverified.

Do not claim full semantic accuracy unless a language server or reliable parser verified the relationship.

## Persistence

Use SQLite with migrations.

Persist:

- GitHub user metadata
- Organization selections
- Repository selections
- Repository cache metadata
- Pull request summaries
- Pull request metadata cache
- Review sessions
- Analysis results
- Chapter progress
- Private notes
- Draft comments
- Published comment references
- Application settings
- Recent errors or operation records where useful

Requirements:

- Review sessions survive restarts.
- Pull request inbox preferences survive restarts.
- Analysis can be resumed or rerun.
- Migrations are versioned.
- Database operations are tested.
- Corrupt or outdated cached data fails gracefully.

## Safety Model

The application is read-only by default.

Requirements:

- Do not modify a user repository.
- Do not require a user checkout.
- Do not run project scripts automatically.
- Do not run tests automatically.
- Do not execute arbitrary AI-proposed commands.
- Do not checkout or reset user branches.
- Do not push commits.
- Do not merge pull requests.
- Require confirmation before publishing GitHub feedback.
- Log external commands and outcomes.
- Redact credentials and sensitive environment values from logs.
- Use argument-safe process execution.
- Never build shell command strings from user input.
- Apply cancellation and timeouts.
- Validate repository cache paths.
- Prevent path traversal.
- Keep managed clones isolated from user working directories.

After repository operations, verify that ReviewArc has not modified any linked user checkout.

## Application Architecture

Use a clean structure similar to:

```text
reviewarc/
├── frontend/
│   └── src/
│       ├── components/
│       ├── features/
│       │   ├── onboarding/
│       │   ├── repositories/
│       │   ├── pull-request-inbox/
│       │   ├── pull-request-detail/
│       │   ├── analysis/
│       │   ├── review-overview/
│       │   ├── guided-review/
│       │   ├── code-viewer/
│       │   ├── notes/
│       │   └── settings/
│       ├── stores/
│       ├── hooks/
│       └── types/
├── internal/
│   ├── agent/
│   │   ├── agent.go
│   │   └── codex/
│   ├── git/
│   ├── github/
│   ├── inbox/
│   ├── repositories/
│   ├── review/
│   ├── storage/
│   ├── process/
│   ├── validation/
│   └── logging/
├── app.go
├── main.go
└── wails.json
```

Avoid unnecessary abstraction, but keep external integrations behind interfaces.

Generate frontend bindings from the Wails backend rather than duplicating API contracts manually where possible.

## UI Direction

The UI should feel like a polished desktop developer tool.

Use:

- Dense but readable layouts
- Clear information hierarchy
- Subtle surfaces and borders
- Strong keyboard navigation where practical
- Fast perceived performance
- Useful loading states
- Partial-data rendering
- Clear validation states
- Minimal decorative filler
- Consistent terminology

Do not build a marketing website.

Do not spend substantial effort on animations or branding flourishes.

Focus on making the pull request inbox and guided review workflow genuinely usable.

## Performance Expectations

The MVP should:

- Render cached inbox data quickly on launch
- Refresh GitHub data without blocking the entire UI
- Load repositories lazily
- Avoid cloning all selected repositories
- Cache reusable Git objects
- Avoid repeatedly analyzing an unchanged pull request
- Detect when the head revision changes
- Mark old analysis as stale
- Allow a stale review session to be refreshed

## Analysis Freshness

Store the exact base and head commit hashes associated with each analysis.

When a pull request changes:

- Detect the new head revision.
- Mark the previous analysis as stale.
- Preserve existing notes and review progress.
- Offer to rerun analysis.
- Clearly distinguish old evidence from current evidence.
- Do not silently present stale analysis as current.

## Out of Scope

Do not build:

- Organization accounts
- Shared team workspaces
- Server-side analysis
- Billing
- SSO or SCIM
- Slack integration
- Company dashboards
- GitHub App installation
- Multi-user collaboration
- Shared review progress
- Enterprise policy management
- Automatic pull request approval
- Automatic pull request rejection
- Automatic repository modification
- Autonomous test execution
- Full semantic indexing for every language
- Additional AI providers beyond the provider abstraction
- Production cloud infrastructure

## Acceptance Criteria

The MVP is complete only when all of the following work:

1. The Wails application launches successfully.
2. The app detects `git`, `gh`, and `codex`.
3. The app identifies the authenticated GitHub user.
4. The app handles missing GitHub authentication clearly.
5. The user can select organizations or repositories.
6. Repository selections persist.
7. The app displays real pull requests across selected repositories.
8. The inbox supports review-requested, assigned, authored, and repository views.
9. Search and basic filtering work.
10. The user can open a real pull request from the inbox.
11. ReviewArc creates or updates an isolated managed repository cache.
12. The user does not need an existing local checkout.
13. The app resolves the actual base and head revisions.
14. The app displays real pull request metadata.
15. The app displays real changed files and diff statistics.
16. The app displays a real unified diff.
17. The user can start Codex analysis.
18. Analysis progress is visible.
19. Analysis can be cancelled.
20. Codex returns a structured review model.
21. Invalid file paths and line ranges are detected.
22. Facts, inferences, and unknowns are distinguished.
23. The overview displays generated chapters, risks, and hotspots.
24. The guided review screen opens each chapter.
25. Evidence links navigate to actual code.
26. The user can change chapter status.
27. The user can create and persist private notes.
28. The user can draft a GitHub comment.
29. Publishing requires explicit confirmation.
30. The published comment appears on the real pull request.
31. Closing and reopening the app restores the inbox and review session.
32. Changed pull request revisions mark previous analysis as stale.
33. The app never modifies a user working directory.
34. Frontend checks pass.
35. `go test ./...` passes.
36. The Wails application builds successfully where supported.

## Required Automated Tests

Add automated tests for:

- Dependency detection
- GitHub username parsing
- Organization parsing
- Repository parsing
- Pull request parsing
- PR URL parsing
- Inbox filtering
- Inbox sorting
- Repository selection persistence
- Managed repository path generation
- Clone and fetch argument safety
- Fork pull request revision handling
- Git diff parsing
- File rename parsing
- Codex structured-output parsing
- Evidence-path validation
- Evidence-line validation
- Review session persistence
- Chapter status updates
- Notes persistence
- Stale-analysis detection
- Comment input validation
- Command argument safety
- Path traversal prevention

Add integration tests using temporary Git repositories.

Use fixture-based GitHub and Codex tests so automated tests do not require real credentials.

## End-to-End Verification

Before declaring completion:

1. Run all frontend checks.
2. Run all Go tests.
3. Build the Wails application.
4. Launch the application.
5. Verify the authenticated GitHub user.
6. Select at least one real or fixture-backed repository source.
7. Load the cross-repository inbox.
8. Open a pull request.
9. Verify the managed repository cache was created.
10. Display the actual changed files.
11. Open at least two real file diffs.
12. Run or fixture the full Codex analysis integration.
13. Open at least two review chapters.
14. Navigate from evidence to code.
15. Save a private note.
16. Change chapter progress.
17. Restart the application.
18. Confirm persisted state was restored.
19. Draft a review comment.
20. Exercise the confirmation flow.
21. Publish only when a safe real test PR is available; otherwise verify publishing through a fixture-backed integration.
22. Verify no user working directory was modified.
23. Assign a final review subagent.
24. Fix all high-confidence issues identified by that review.

Do not claim a workflow works unless it was exercised.

## Documentation

Create:

- `README.md`
- `docs/product-brief.md`
- `docs/architecture.md`
- `docs/security-model.md`
- `docs/managed-repository-cache.md`

The README must include:

- Prerequisites
- Development setup
- How to run
- How to build
- GitHub CLI authentication
- Codex CLI setup
- Where ReviewArc stores managed repositories
- How to clear the local cache
- Known MVP limitations

## Completion Report

At the end, report:

- What was implemented
- Which subagents were used
- Each subagent’s responsibilities
- Architecture decisions
- GitHub discovery strategy
- Managed repository cache strategy
- Codex integration approach
- Tests run
- Build results
- End-to-end flows verified
- Any environment limitations
- Known MVP limitations
- Recommended next milestone

The final result must be a functional local ReviewArc MVP that displays pull requests across repositories automatically and supports a complete guided review flow on real pull requests.
