package agent

import (
	"context"

	sharedanalysis "reviewarc/internal/analysis"
	"reviewarc/internal/analysisbundle"
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

// AnalyzeInput contains only authority to a finalized ReviewArc bundle and a
// pinned evidence reader. Providers never receive a user's checkout, a complete
// diff, or repository context in their initial prompt.
type AnalyzeInput struct {
	Bundle           analysisbundle.Reference
	DataRoot         string
	Profile          domain.AnalysisProfile
	ContextTransport domain.ContextTransport
	Snapshot         sharedanalysis.Snapshot
}

type Event struct {
	Kind     EventKind                `json:"kind"`
	Message  string                   `json:"message"`
	Analysis *domain.ReviewAnalysis   `json:"analysis,omitempty"`
	Issues   []domain.ValidationIssue `json:"issues,omitempty"`
	Coverage *domain.AnalysisCoverage `json:"coverage,omitempty"`
	Failure  *domain.AnalysisFailure  `json:"failure,omitempty"`
	Err      error                    `json:"-"`
}

// ReviewAgent starts one analysis operation. The returned channel is closed exactly once.
// Cancellation is controlled exclusively by ctx.
type ReviewAgent interface {
	AnalyzeChange(ctx context.Context, input AnalyzeInput) (<-chan Event, error)
}

type HarnessAdapter interface {
	ReviewAgent
	ID() domain.HarnessID
	Capabilities(context.Context) (domain.HarnessCapabilities, error)
}
