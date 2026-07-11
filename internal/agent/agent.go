package agent

import (
	"context"

	"reviewarc/internal/domain"
)

type EventKind string

const (
	EventStarted    EventKind = "started"
	EventProgress   EventKind = "progress"
	EventWarning    EventKind = "warning"
	EventValidating EventKind = "validating"
	EventCompleted  EventKind = "completed"
	EventCancelled  EventKind = "cancelled"
	EventFailed     EventKind = "failed"
)

// AnalyzeInput is a fully prepared, immutable PR snapshot. Workspace must be an
// application-managed isolated worktree at HeadSHA; it must never be a user's checkout.
type AnalyzeInput struct {
	PullRequest            domain.PullRequest   `json:"pullRequest"`
	Workspace              string               `json:"-"`
	BaseSHA                string               `json:"baseSha"`
	HeadSHA                string               `json:"headSha"`
	ChangedFiles           []domain.ChangedFile `json:"changedFiles"`
	UnifiedDiff            string               `json:"unifiedDiff"`
	RepositoryContext      string               `json:"repositoryContext"`
	RepositoryInstructions string               `json:"repositoryInstructions"`
	ExistingDiscussion     string               `json:"existingDiscussion"`
}

type Event struct {
	Kind     EventKind                `json:"kind"`
	Message  string                   `json:"message"`
	Analysis *domain.ReviewAnalysis   `json:"analysis,omitempty"`
	Issues   []domain.ValidationIssue `json:"issues,omitempty"`
	Err      error                    `json:"-"`
}

// ReviewAgent starts one analysis operation. The returned channel is closed exactly once.
// Cancellation is controlled exclusively by ctx.
type ReviewAgent interface {
	AnalyzeChange(ctx context.Context, input AnalyzeInput) (<-chan Event, error)
}
