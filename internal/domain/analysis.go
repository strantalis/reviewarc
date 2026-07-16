package domain

import "time"

type HarnessID string
type HarnessState string
type ContextTransport string
type ReasoningLevel string
type AnalysisRunStatus string
type AnalysisFailureCode string
type AnalysisRetryAction string

const (
	HarnessCodex  HarnessID = "codex"
	HarnessClaude HarnessID = "claude"

	HarnessAvailable   HarnessState = "available"
	HarnessMissing     HarnessState = "missing"
	HarnessBroken      HarnessState = "broken"
	HarnessUnsupported HarnessState = "unsupported"

	ContextInline         ContextTransport = "inline"
	ContextArtifactFiles  ContextTransport = "artifactFiles"
	ContextReviewArcTools ContextTransport = "reviewarcTools"

	ReasoningLow    ReasoningLevel = "low"
	ReasoningMedium ReasoningLevel = "medium"
	ReasoningHigh   ReasoningLevel = "high"
	ReasoningXHigh  ReasoningLevel = "xhigh"
	ReasoningMax    ReasoningLevel = "max"

	AnalysisRunPreparing AnalysisRunStatus = "preparing"
	AnalysisRunRunning   AnalysisRunStatus = "running"
	AnalysisRunCompleted AnalysisRunStatus = "completed"
	AnalysisRunFailed    AnalysisRunStatus = "failed"
	AnalysisRunCancelled AnalysisRunStatus = "cancelled"

	FailureConfigurationRequired AnalysisFailureCode = "configuration_required"
	FailureHarnessUnavailable    AnalysisFailureCode = "harness_unavailable"
	FailureUnsupportedCapability AnalysisFailureCode = "unsupported_capability"
	FailureInvalidProfile        AnalysisFailureCode = "invalid_profile"
	FailureAuthentication        AnalysisFailureCode = "authentication_required"
	FailureRateLimited           AnalysisFailureCode = "rate_limited"
	FailureProviderUnavailable   AnalysisFailureCode = "provider_unavailable"
	FailureInputTooLarge         AnalysisFailureCode = "input_too_large"
	FailureContextBudget         AnalysisFailureCode = "context_budget_exceeded"
	FailureProviderInput         AnalysisFailureCode = "provider_input_rejected"
	FailureProviderOutput        AnalysisFailureCode = "provider_output_invalid"
	FailureProviderProtocol      AnalysisFailureCode = "provider_protocol_error"
	FailureMalformedOutput       AnalysisFailureCode = "malformed_structured_output"
	FailureEvidenceValidation    AnalysisFailureCode = "evidence_validation_failed"
	FailureContextAccess         AnalysisFailureCode = "context_access_failed"
	FailurePolicyViolation       AnalysisFailureCode = "policy_violation"
	FailureRetryRequiresReplan   AnalysisFailureCode = "retry_requires_replan"
	FailureTimeout               AnalysisFailureCode = "timeout"
	FailureProvider              AnalysisFailureCode = "provider_failed"
	FailureInterrupted           AnalysisFailureCode = "interrupted"
	FailurePersistence           AnalysisFailureCode = "persistence_failed"

	RetryNone          AnalysisRetryAction = "none"
	RetrySamePlan      AnalysisRetryAction = "retry"
	RetryReplan        AnalysisRetryAction = "replan"
	RetryConfigure     AnalysisRetryAction = "configure"
	RetryAuthenticate  AnalysisRetryAction = "authenticate"
	RetryChangeProfile AnalysisRetryAction = "changeProfile"
)

type ModelCapability struct {
	ID                    string           `json:"id"`
	Name                  string           `json:"name"`
	ReasoningLevels       []ReasoningLevel `json:"reasoningLevels"`
	DefaultReasoningLevel ReasoningLevel   `json:"defaultReasoningLevel,omitempty"`
	Recommended           bool             `json:"recommended"`
}

type HarnessLimits struct {
	MaxInputBytes  int `json:"maxInputBytes,omitempty"`
	MaxOutputBytes int `json:"maxOutputBytes,omitempty"`
}

type HarnessCapabilities struct {
	ID                   HarnessID          `json:"id"`
	Name                 string             `json:"name"`
	Version              string             `json:"version,omitempty"`
	State                HarnessState       `json:"state"`
	Message              string             `json:"message,omitempty"`
	Models               []ModelCapability  `json:"models"`
	CustomModel          *ModelCapability   `json:"customModel,omitempty"`
	DefaultModel         string             `json:"defaultModel,omitempty"`
	ContextTransports    []ContextTransport `json:"contextTransports"`
	SupportsJSONSchema   bool               `json:"supportsJsonSchema"`
	EnforcesReadOnly     bool               `json:"enforcesReadOnly"`
	SupportsProgress     bool               `json:"supportsProgress"`
	SupportsCancellation bool               `json:"supportsCancellation"`
	Limits               HarnessLimits      `json:"limits"`
}

type AnalysisProfile struct {
	Harness   HarnessID      `json:"harness"`
	Model     string         `json:"model"`
	Reasoning ReasoningLevel `json:"reasoning"`
}

type AnalysisFailure struct {
	Code             AnalysisFailureCode `json:"code"`
	Title            string              `json:"title"`
	Message          string              `json:"message"`
	Action           AnalysisRetryAction `json:"action"`
	Retryable        bool                `json:"retryable"`
	TechnicalDetails string              `json:"technicalDetails,omitempty"`
}

type ContextAccess struct {
	Kind      string    `json:"kind"`
	Path      string    `json:"path,omitempty"`
	Revision  Revision  `json:"revision,omitempty"`
	StartLine int       `json:"startLine,omitempty"`
	EndLine   int       `json:"endLine,omitempty"`
	Bytes     int       `json:"bytes,omitempty"`
	At        time.Time `json:"at"`
}

type DiffOmissionCategory string

const (
	DiffOmissionGenerated        DiffOmissionCategory = "generated"
	DiffOmissionDocumentation    DiffOmissionCategory = "documentation"
	DiffOmissionExampleOrTest    DiffOmissionCategory = "example_or_test"
	DiffOmissionMetadata         DiffOmissionCategory = "metadata"
	DiffOmissionCoveredElsewhere DiffOmissionCategory = "covered_elsewhere"
	DiffOmissionNotRelevant      DiffOmissionCategory = "not_relevant"
	DiffOmissionBudgetLimited    DiffOmissionCategory = "budget_limited"
	DiffOmissionOther            DiffOmissionCategory = "other"
)

func (c DiffOmissionCategory) Valid() bool {
	switch c {
	case DiffOmissionGenerated, DiffOmissionDocumentation, DiffOmissionExampleOrTest, DiffOmissionMetadata, DiffOmissionCoveredElsewhere, DiffOmissionNotRelevant, DiffOmissionBudgetLimited, DiffOmissionOther:
		return true
	default:
		return false
	}
}

type DiffOmissionDecision struct {
	Path     string               `json:"path"`
	Category DiffOmissionCategory `json:"category"`
	Reason   string               `json:"reason"`
}

type AnalysisCoverage struct {
	ChangedFilesTotal      int                    `json:"changedFilesTotal"`
	DiffFilesFullyRead     int                    `json:"diffFilesFullyRead"`
	DiffFilesPartiallyRead int                    `json:"diffFilesPartiallyRead"`
	DiffFilesPreviewed     int                    `json:"diffFilesPreviewed"`
	DiffFilesUnseen        int                    `json:"diffFilesUnseen"`
	DiffFilesUnread        int                    `json:"diffFilesUnread"`
	DiffBytesTotal         int                    `json:"diffBytesTotal"`
	DiffBytesRead          int                    `json:"diffBytesRead"`
	Segments               int                    `json:"segments"`
	OmittedPaths           []string               `json:"omittedPaths"`
	PreviewedPaths         []string               `json:"previewedPaths"`
	UnseenPaths            []string               `json:"unseenPaths"`
	PreviewDecisions       []DiffOmissionDecision `json:"previewDecisions,omitempty"`
	Accesses               []ContextAccess        `json:"accesses"`
}

type AnalysisRun struct {
	ID               string            `json:"id"`
	SessionID        string            `json:"sessionId"`
	Profile          AnalysisProfile   `json:"profile"`
	HarnessVersion   string            `json:"harnessVersion,omitempty"`
	ContextTransport ContextTransport  `json:"contextTransport"`
	SchemaVersion    int               `json:"schemaVersion"`
	InputFingerprint string            `json:"inputFingerprint"`
	Coverage         AnalysisCoverage  `json:"coverage"`
	Status           AnalysisRunStatus `json:"status"`
	Failure          *AnalysisFailure  `json:"failure,omitempty"`
	StartedAt        time.Time         `json:"startedAt"`
	CompletedAt      *time.Time        `json:"completedAt,omitempty"`
	UpdatedAt        time.Time         `json:"updatedAt"`
}
