# ReviewArc Product Brief

## Product Summary

ReviewArc is a local-first pull request review application that helps engineers understand complex code changes before approving them.

Instead of presenting a pull request as a flat collection of files and diff hunks, ReviewArc organizes the change into a guided walkthrough of its intent, behavior, affected systems, risks, and tests.

The product is designed for the growing volume of AI-generated code, where implementation speed has increased but reviewer comprehension has not.

The initial product will be a desktop application built with Wails, using a web-based frontend and a local Go backend.

---

## Problem

Modern pull request review is still primarily file-oriented.

A reviewer is typically given:

- A pull request description
- A list of changed files
- Isolated diff hunks
- Automated comments
- CI results

This format makes it difficult to understand cross-cutting changes, especially when a pull request was produced or heavily assisted by an AI coding agent.

Reviewers often struggle to answer basic questions:

- What behavior is actually changing?
- Why were these files changed together?
- What is the intended execution path?
- Which existing callers are affected?
- Are the important failure paths tested?
- Which parts of the pull request require the most attention?
- What have I already reviewed?

Existing AI review tools primarily generate findings and comments. They do not make the human review process itself substantially easier.

---

## Product Thesis

ReviewArc turns a pull request into a structured, evidence-backed review journey.

The product should help a reviewer understand the full arc of a change:

1. Why the change exists
2. What behavior changed
3. How the implementation works
4. What parts of the system are affected
5. What risks and unknowns remain
6. How the change is validated
7. Whether the reviewer is comfortable approving it

ReviewArc should not replace the reviewer.

It should improve the reviewer’s ability to reason about unfamiliar or AI-generated code.

---

## Target User

### Primary User

An experienced software engineer reviewing pull requests in a codebase they know partially, but not completely.

Typical characteristics:

- Reviews several pull requests per week
- Uses GitHub or a similar code-hosting platform
- Works with AI-generated or AI-assisted code
- Reviews changes spanning multiple files or packages
- Wants to remain responsible for the final decision
- Uses tools such as Codex, Claude Code, Gemini CLI, Cursor, or Copilot

### Early-Adopter Teams

The strongest initial users are likely to work in:

- Platform engineering
- Infrastructure
- Security
- Backend services
- Developer tooling
- Fintech
- Enterprise systems
- Large TypeScript or Go repositories
- Monorepos

---

## Core User Promise

> Understand the change, not just the diff.

A reviewer should be able to open a pull request in ReviewArc and quickly understand:

- The purpose of the change
- The major behavioral changes
- The most important review areas
- The relevant code paths
- The associated tests
- The remaining risks and unknowns

---

## Initial Product Scope

The initial version is a local desktop application for individual reviewers.

It should support:

- Opening a GitHub pull request
- Comparing two local Git revisions
- Analyzing the full local repository
- Generating review chapters
- Browsing code in full-file context
- Viewing changed symbols and related callers
- Mapping tests to changed behavior
- Tracking review progress
- Drafting GitHub comments
- Publishing comments through the GitHub CLI
- Invoking an installed AI CLI for deeper analysis

The prototype does not need a server component.

The architecture should allow shared and server-side review sessions to be added later.

---

## Primary User Flow

### 1. Open a Pull Request

The user launches ReviewArc and selects a local repository.

They can then:

- Enter a GitHub pull request number
- Paste a GitHub pull request URL
- Select a local branch
- Compare two Git revisions

Example:

```bash
reviewarc open 428
```

The desktop application opens the corresponding review session.

### 2. Analyze the Change

ReviewArc collects:

- Pull request title and description
- Linked issue information
- Commit messages
- Changed files
- Diff statistics
- Changed symbols
- Related callers
- Related tests
- Repository instructions
- Existing review comments

The AI backend produces a structured review model rather than an unstructured Markdown summary.

### 3. Present the Review Overview

The overview screen should answer:

- What changed?
- Why does it matter?
- How large is the change?
- What areas are affected?
- Where should the reviewer spend time?
- What is unexplained?
- What is the estimated review effort?

Example:

```text
PR #428 — Rotate refresh tokens

Change type:
Cross-cutting authentication change

Affected areas:
Authentication, persistence, middleware

Highest risk:
Concurrent refresh-token handling

Estimated review:
18–25 minutes

Review chapters:
6
```

### 4. Start the Guided Review

The change is organized into review chapters such as:

1. Overview and intent
2. Persistence model
3. Token rotation logic
4. Retry behavior
5. Migration
6. Tests and failure paths

The reviewer progresses through the chapters instead of reviewing files alphabetically.

### 5. Inspect Code in Context

The main review screen should include:

- Review chapter navigation
- Full-file or contextual code view
- Split and unified diff modes
- Changed symbol navigation
- Callers and dependencies
- Related tests
- Risks and unknowns
- Suggested reviewer questions
- Review notes

### 6. Record Review Progress

For each chapter, the reviewer can mark it as:

- Not reviewed
- In progress
- Reviewed
- Needs clarification
- Blocked

The application should preserve the review session locally.

### 7. Leave Feedback

The reviewer can:

- Add private notes
- Draft a review question
- Convert a finding into a GitHub comment
- Publish comments
- Approve or request changes through GitHub

The prototype may initially publish through the `gh` CLI.

---

## Review Model

ReviewArc should store analysis in a structured internal model.

Example:

```ts
type ReviewSession = {
  id: string;
  repository: RepositoryRef;
  pullRequest?: PullRequestRef;
  baseRevision: string;
  headRevision: string;
  objective: string;
  summary: string;
  chapters: ReviewChapter[];
  changedSymbols: ChangedSymbol[];
  risks: ReviewRisk[];
  unknowns: ReviewUnknown[];
  evidence: EvidenceReference[];
  progress: ReviewProgress;
};
```

### Review Chapter

```ts
type ReviewChapter = {
  id: string;
  title: string;
  description: string;
  purpose: string;
  status: ReviewStatus;
  files: FileReference[];
  symbols: SymbolReference[];
  behavioralChanges: BehavioralChange[];
  risks: ReviewRisk[];
  tests: TestReference[];
  questions: SuggestedQuestion[];
};
```

### Evidence Reference

```ts
type EvidenceReference = {
  path: string;
  revision: "base" | "head";
  startLine: number;
  endLine: number;
  symbol?: string;
};
```

Every AI-generated claim should be linked to evidence whenever possible.

---

## Trust and Accuracy Principles

ReviewArc should clearly distinguish between facts, inferences, and unknowns.

### Fact

Directly supported by repository evidence or linked pull request context.

Example:

> The new refresh-token record includes a revocation timestamp.

### Inference

A likely conclusion based on the implementation.

Example:

> This appears intended to prevent refresh-token replay.

### Unknown

An important decision or behavior that cannot be determined from available evidence.

Example:

> It is unclear whether concurrent refresh requests are expected to succeed independently.

The UI should avoid presenting inferred author intent as fact.

---

## AI Integration

The prototype should use installed AI CLI tools rather than immediately implementing a complete custom agent runtime.

Initial provider:

- Codex CLI

Potential future providers:

- Claude Code
- Gemini CLI
- Direct OpenAI API
- Local models

The application should define a provider-independent interface.

```go
type ReviewAgent interface {
    AnalyzeChange(ctx context.Context, input AnalyzeInput) (<-chan ReviewEvent, error)
    AnswerQuestion(ctx context.Context, input QuestionInput) (<-chan ReviewEvent, error)
    InspectRisk(ctx context.Context, input RiskInput) (<-chan ReviewEvent, error)
}
```

The agent should return structured JSON events that ReviewArc validates before displaying.

The application should not depend on parsing conversational terminal output.

---

## Local-First Architecture

### Desktop Framework

Wails is the preferred application framework.

### Frontend

Suggested stack:

- React
- TypeScript
- Vite
- Tailwind CSS or a small component system
- Monaco Editor initially, if practical

### Backend

Go service embedded through Wails.

Responsibilities:

- Repository discovery
- Git operations
- GitHub CLI integration
- AI CLI process management
- Structured output parsing
- Review session persistence
- File and symbol lookup
- Local application settings
- Safe command execution

### Local Storage

SQLite should store:

- Repositories
- Review sessions
- Chapter progress
- Notes
- Draft comments
- Provider settings
- Cached analysis

### External Dependencies

Initial integrations:

- `git`
- `gh`
- `codex`

The application should verify installed dependencies and provide clear setup guidance.

---

## Suggested Application Structure

```text
reviewarc/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── repositories/
│   │   │   ├── review-overview/
│   │   │   ├── review-session/
│   │   │   ├── code-viewer/
│   │   │   └── settings/
│   │   ├── hooks/
│   │   ├── stores/
│   │   └── types/
│   └── package.json
├── internal/
│   ├── agent/
│   │   ├── agent.go
│   │   └── codex/
│   ├── git/
│   ├── github/
│   ├── review/
│   ├── symbols/
│   ├── storage/
│   └── commands/
├── app.go
├── main.go
└── wails.json
```

---

## MVP Screens

### 1. Repository Home

Displays:

- Recently opened repositories
- Recent review sessions
- Open pull request action
- Compare local revisions action
- Dependency status for Git, GitHub CLI, and AI providers

### 2. Pull Request Overview

Displays:

- Pull request title and description
- Change type
- Risk level
- Estimated review time
- Affected areas
- Review chapters
- Suggested review hotspots
- Linked context
- Start guided review action

### 3. Guided Review Screen

Three-column layout:

#### Left

- Review chapters
- Chapter progress
- Navigation

#### Center

- Full code context
- Split or unified diff
- Changed-symbol navigation
- File tabs

#### Right

- Chapter purpose
- Evidence
- Callers
- Tests
- Risks
- Unknowns
- Suggested questions

### 4. Review Notes

Displays:

- Private notes
- Draft comments
- Published comments
- Findings grouped by chapter
- Final review summary

### 5. Settings

Includes:

- AI provider
- Model selection
- Repository permissions
- GitHub CLI status
- Analysis limits
- Local storage settings

---

## Prototype Milestones

### Milestone 1: Repository and Diff Viewer

Build a working Wails application that can:

- Open a local repository
- Select two revisions
- Display changed files
- Display a contextual diff
- Persist the selected repository

No AI is required yet.

### Milestone 2: Pull Request Integration

Add:

- GitHub pull request lookup using `gh`
- Pull request metadata
- Local checkout verification
- Changed-file loading
- Existing comment retrieval

### Milestone 3: AI-Generated Review Overview

Invoke Codex to produce:

- Pull request summary
- Affected areas
- Review chapters
- Risk hotspots
- Unknowns

Validate file and line references before showing them.

### Milestone 4: Guided Review Experience

Add:

- Chapter navigation
- Review status
- Evidence links
- Suggested questions
- Local review notes
- Progress persistence

### Milestone 5: Code Relationships

Add:

- Changed-symbol extraction
- Search for callers and references
- Related-test discovery
- Navigation between source and tests

Initial implementation can use text search and Tree-sitter. Full LSP integration can come later.

### Milestone 6: GitHub Feedback

Add:

- Draft inline comments
- Publish review comments
- Submit review
- Store published comment references locally

---

## Explicit Non-Goals for the Prototype

The prototype should not attempt to:

- Automatically approve pull requests
- Replace a human reviewer
- Support every programming language
- Run arbitrary project commands automatically
- Build a complete semantic code graph
- Reconstruct private AI reasoning
- Analyze every pull request on a server
- Support team collaboration
- Provide organization-wide analytics
- Compete directly on automated bug-finding volume

---

## Safety Model

Review analysis should be read-only by default.

The application should:

- Avoid allowing the AI agent to modify the repository
- Block destructive Git commands
- Avoid exposing unrelated credentials
- Avoid running arbitrary commands without user approval
- Clearly display commands before execution
- Use temporary worktrees when appropriate
- Restrict AI analysis to the selected repository

Tests and builds should require explicit user action in the first version.

---

## Future Premium Product

The local application is the adoption path.

A future server-side product could add:

- GitHub App installation
- Automatic pull request analysis
- Shared review walkthroughs
- Reviewer assignments
- Shared progress
- Team standards
- Architecture rules
- Historical review memory
- Organization analytics
- Slack notifications
- Company-managed AI models
- Private execution workers
- Enterprise audit controls

The premium positioning would be:

> Local ReviewArc helps an engineer understand a change.
> ReviewArc for Teams helps a company understand and manage every change.

---

## Success Metrics

The prototype should test whether ReviewArc improves review comprehension.

Useful measures:

- Time required to explain the pull request
- Time to first meaningful review comment
- Total review duration
- Number of files manually explored
- Reviewer confidence before and after using ReviewArc
- Number of important risks identified
- Percentage of review chapters completed
- Whether users return for another pull request

The most important qualitative question is:

> Did ReviewArc help you understand and review this pull request better than GitHub and your normal AI tools?

---

## Initial Validation Plan

Test the prototype with 10–15 experienced engineers.

Give each user a moderately complex pull request and ask them to review it using:

1. Their normal GitHub workflow
2. ReviewArc

Observe:

- Where they spend time
- Which questions they ask
- Which chapters they find useful
- Whether the AI explanation feels trustworthy
- Whether full-file context improves understanding
- Whether review progress is valuable
- Whether they want to share the walkthrough

The strongest signal will be users asking to use ReviewArc on their next real pull request.

---

## Product Positioning

### Category

Guided pull request review workspace

### Primary Message

> Understand the change, not just the diff.

### Supporting Message

> ReviewArc turns complex pull requests into structured, evidence-backed walkthroughs so engineers can review AI-generated code with confidence.

### Potential Taglines

- Follow the full arc of every change.
- Understand every change. Review with confidence.
- A guided path through complex pull requests.
- Review the system change, not the file list.
- From intent to implementation to impact.
