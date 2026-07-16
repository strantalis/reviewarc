// Package domain contains ReviewArc's integration-independent application model.
// These types are also the canonical source for Wails-generated TypeScript models.
package domain

import "time"

type SelectionKind string
type Relationship string
type AnalysisStatus string
type RiskLevel string
type FileStatus string
type DiffLineKind string
type Revision string
type ValidationStatus string
type ClaimKind string
type ChapterStatus string
type SessionStatus string
type CommentKind string
type CommentStatus string
type DiffSide string
type DependencyName string
type DependencyState string

const (
	SelectionOrganization SelectionKind = "organization"
	SelectionRepository   SelectionKind = "repository"

	RelationshipReviewRequested Relationship = "reviewRequested"
	RelationshipAssigned        Relationship = "assigned"
	RelationshipAuthored        Relationship = "authored"
	RelationshipSelectedRepo    Relationship = "selectedRepo"

	AnalysisNotStarted AnalysisStatus = "notStarted"
	AnalysisQueued     AnalysisStatus = "queued"
	AnalysisRunning    AnalysisStatus = "running"
	AnalysisReady      AnalysisStatus = "ready"
	AnalysisFailed     AnalysisStatus = "failed"
	AnalysisStale      AnalysisStatus = "stale"

	RiskUnknown  RiskLevel = "unknown"
	RiskLow      RiskLevel = "low"
	RiskMedium   RiskLevel = "medium"
	RiskHigh     RiskLevel = "high"
	RiskCritical RiskLevel = "critical"

	FileAdded    FileStatus = "added"
	FileModified FileStatus = "modified"
	FileDeleted  FileStatus = "deleted"
	FileRenamed  FileStatus = "renamed"
	FileCopied   FileStatus = "copied"
	FileBinary   FileStatus = "binary"

	DiffContext   DiffLineKind = "context"
	DiffAdd       DiffLineKind = "add"
	DiffDelete    DiffLineKind = "delete"
	DiffNoNewline DiffLineKind = "noNewline"

	RevisionBase Revision = "base"
	RevisionHead Revision = "head"

	ValidationValid      ValidationStatus = "valid"
	ValidationInvalid    ValidationStatus = "invalid"
	ValidationUnverified ValidationStatus = "unverified"

	ClaimFact      ClaimKind = "fact"
	ClaimInference ClaimKind = "inference"
	ClaimUnknown   ClaimKind = "unknown"

	ChapterNotReviewed        ChapterStatus = "notReviewed"
	ChapterInProgress         ChapterStatus = "inProgress"
	ChapterReviewed           ChapterStatus = "reviewed"
	ChapterNeedsClarification ChapterStatus = "needsClarification"
	ChapterBlocked            ChapterStatus = "blocked"

	SessionPreparing SessionStatus = "preparing"
	SessionReady     SessionStatus = "ready"
	SessionFailed    SessionStatus = "failed"

	CommentGeneral   CommentKind   = "general"
	CommentInline    CommentKind   = "inline"
	CommentDraft     CommentStatus = "draft"
	CommentPublished CommentStatus = "published"
	CommentFailed    CommentStatus = "failed"
	DiffSideLeft     DiffSide      = "LEFT"
	DiffSideRight    DiffSide      = "RIGHT"

	DependencyGit       DependencyName  = "git"
	DependencyGH        DependencyName  = "gh"
	DependencyCodex     DependencyName  = "codex"
	DependencyAvailable DependencyState = "available"
	DependencyMissing   DependencyState = "missing"
	DependencyBroken    DependencyState = "broken"
)

type RepositoryRef struct {
	Host       string `json:"host"`
	Owner      string `json:"owner"`
	Name       string `json:"name"`
	CloneURL   string `json:"cloneUrl"`
	DatabaseID string `json:"databaseId"`
}

type PullRequestRef struct {
	Repository RepositoryRef `json:"repository"`
	Number     int           `json:"number"`
}

type RevisionSpec struct {
	BaseSHA        string        `json:"baseSha"`
	HeadSHA        string        `json:"headSha"`
	BaseRef        string        `json:"baseRef"`
	HeadRef        string        `json:"headRef"`
	HeadRepository RepositoryRef `json:"headRepository"`
}

type GitHubUser struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type Organization struct {
	Login        string `json:"login"`
	Name         string `json:"name"`
	AvatarURL    string `json:"avatarUrl"`
	AccessStatus string `json:"accessStatus"`
	SSOURL       string `json:"ssoUrl,omitempty"`
}

type Repository struct {
	Ref         RepositoryRef `json:"ref"`
	Description string        `json:"description"`
	IsPrivate   bool          `json:"isPrivate"`
	IsArchived  bool          `json:"isArchived"`
	UpdatedAt   time.Time     `json:"updatedAt"`
}

type SourceSelection struct {
	Kind    SelectionKind `json:"kind"`
	Key     string        `json:"key"`
	Enabled bool          `json:"enabled"`
}

type ReviewProgress struct {
	Total    int `json:"total"`
	Reviewed int `json:"reviewed"`
	Blocked  int `json:"blocked"`
	Clarify  int `json:"clarify"`
	Percent  int `json:"percent"`
}

type PullRequestSummary struct {
	Ref            PullRequestRef `json:"ref"`
	Title          string         `json:"title"`
	URL            string         `json:"url"`
	Author         GitHubUser     `json:"author"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	IsDraft        bool           `json:"isDraft"`
	Additions      int            `json:"additions"`
	Deletions      int            `json:"deletions"`
	ChangedFiles   int            `json:"changedFiles"`
	Relationships  []Relationship `json:"relationships"`
	Labels         []string       `json:"labels"`
	AnalysisStatus AnalysisStatus `json:"analysisStatus"`
	Progress       ReviewProgress `json:"progress"`
	RiskLevel      RiskLevel      `json:"riskLevel"`
	ReviewDecision string         `json:"reviewDecision,omitempty"`
	BaseSHA        string         `json:"baseSha,omitempty"`
	HeadSHA        string         `json:"headSha,omitempty"`
	SessionID      string         `json:"sessionId,omitempty"`
}

type Commit struct {
	SHA        string     `json:"sha"`
	Message    string     `json:"message"`
	Author     GitHubUser `json:"author"`
	AuthoredAt time.Time  `json:"authoredAt"`
}

// PullRequestReview is an existing review submitted to GitHub. It is distinct
// from ReviewArc's private ReviewComment drafts.
type PullRequestReview struct {
	ID          int64      `json:"id"`
	Author      GitHubUser `json:"author"`
	State       string     `json:"state"`
	Body        string     `json:"body"`
	CommitSHA   string     `json:"commitSha"`
	SubmittedAt time.Time  `json:"submittedAt"`
	URL         string     `json:"url"`
}

// PullRequestReviewComment is an existing inline GitHub review comment.
type PullRequestReviewComment struct {
	ID                int64      `json:"id"`
	ReviewID          int64      `json:"reviewId"`
	ReplyToID         int64      `json:"replyToId,omitempty"`
	Author            GitHubUser `json:"author"`
	Body              string     `json:"body"`
	Path              string     `json:"path"`
	StartLine         *int       `json:"startLine,omitempty"`
	Line              *int       `json:"line,omitempty"`
	OriginalStartLine *int       `json:"originalStartLine,omitempty"`
	OriginalLine      *int       `json:"originalLine,omitempty"`
	StartSide         DiffSide   `json:"startSide,omitempty"`
	Side              DiffSide   `json:"side,omitempty"`
	CommitSHA         string     `json:"commitSha"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	URL               string     `json:"url"`
}

// CheckRun describes a GitHub check run for the pull request head revision.
type CheckRun struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	Conclusion  string    `json:"conclusion,omitempty"`
	AppName     string    `json:"appName,omitempty"`
	URL         string    `json:"url"`
	DetailsURL  string    `json:"detailsUrl,omitempty"`
	StartedAt   time.Time `json:"startedAt"`
	CompletedAt time.Time `json:"completedAt"`
}

type PullRequest struct {
	PullRequestSummary
	Body               string                     `json:"body"`
	BaseRef            string                     `json:"baseRef"`
	HeadRef            string                     `json:"headRef"`
	HeadRepository     RepositoryRef              `json:"headRepository"`
	Commits            []Commit                   `json:"commits"`
	RequestedReviewers []GitHubUser               `json:"requestedReviewers"`
	Assignees          []GitHubUser               `json:"assignees"`
	Reviews            []PullRequestReview        `json:"reviews"`
	ReviewComments     []PullRequestReviewComment `json:"reviewComments"`
	CheckRuns          []CheckRun                 `json:"checkRuns"`
	ReviewState        string                     `json:"reviewState"`
}

type ChangedFile struct {
	Path         string     `json:"path"`
	PreviousPath string     `json:"previousPath"`
	Status       FileStatus `json:"status"`
	Additions    int        `json:"additions"`
	Deletions    int        `json:"deletions"`
	IsBinary     bool       `json:"isBinary"`
}

type DiffLine struct {
	Kind    DiffLineKind `json:"kind"`
	Content string       `json:"content"`
	OldLine *int         `json:"oldLine,omitempty"`
	NewLine *int         `json:"newLine,omitempty"`
}

type DiffHunk struct {
	Header   string     `json:"header"`
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Lines    []DiffLine `json:"lines"`
}

type DiffFile struct {
	File  ChangedFile `json:"file"`
	Hunks []DiffHunk  `json:"hunks"`
	Patch string      `json:"patch"`
}

type FileContent struct {
	Path      string   `json:"path"`
	Revision  Revision `json:"revision"`
	SHA       string   `json:"sha"`
	Content   string   `json:"content"`
	IsBinary  bool     `json:"isBinary"`
	LineCount int      `json:"lineCount"`
}

type EvidenceReference struct {
	ID                string           `json:"id"`
	Path              string           `json:"path"`
	Revision          Revision         `json:"revision"`
	StartLine         int              `json:"startLine"`
	EndLine           int              `json:"endLine"`
	Symbol            string           `json:"symbol,omitempty"`
	ValidationStatus  ValidationStatus `json:"validationStatus"`
	ValidationMessage string           `json:"validationMessage,omitempty"`
}

type Claim struct {
	ID                string              `json:"id"`
	Kind              ClaimKind           `json:"kind"`
	Text              string              `json:"text"`
	Evidence          []EvidenceReference `json:"evidence"`
	ValidationStatus  ValidationStatus    `json:"validationStatus"`
	ValidationMessage string              `json:"validationMessage,omitempty"`
}

type BehavioralChange struct {
	ID                string              `json:"id"`
	Summary           string              `json:"summary"`
	Before            string              `json:"before"`
	After             string              `json:"after"`
	Evidence          []EvidenceReference `json:"evidence"`
	ValidationStatus  ValidationStatus    `json:"validationStatus"`
	ValidationMessage string              `json:"validationMessage,omitempty"`
}

type ReviewRisk struct {
	ID                string              `json:"id"`
	Title             string              `json:"title"`
	Description       string              `json:"description"`
	Level             RiskLevel           `json:"level"`
	Evidence          []EvidenceReference `json:"evidence"`
	ValidationStatus  ValidationStatus    `json:"validationStatus"`
	ValidationMessage string              `json:"validationMessage,omitempty"`
}

type FileReference struct {
	Path              string           `json:"path"`
	Description       string           `json:"description"`
	ValidationStatus  ValidationStatus `json:"validationStatus"`
	ValidationMessage string           `json:"validationMessage,omitempty"`
}
type SymbolReference struct {
	Path     string              `json:"path"`
	Name     string              `json:"name"`
	Evidence []EvidenceReference `json:"evidence"`
}
type AffectedArea struct {
	Name              string              `json:"name"`
	Description       string              `json:"description"`
	Evidence          []EvidenceReference `json:"evidence"`
	ValidationStatus  ValidationStatus    `json:"validationStatus"`
	ValidationMessage string              `json:"validationMessage,omitempty"`
}

type TestReference struct {
	ID           string              `json:"id"`
	Path         string              `json:"path"`
	Description  string              `json:"description"`
	Evidence     []EvidenceReference `json:"evidence"`
	Relationship ValidationStatus    `json:"relationship"`
}

type SuggestedQuestion struct {
	ID        string              `json:"id"`
	Text      string              `json:"text"`
	Rationale string              `json:"rationale"`
	Evidence  []EvidenceReference `json:"evidence"`
}

type ReviewChapter struct {
	ID                 string              `json:"id"`
	Order              int                 `json:"order"`
	Title              string              `json:"title"`
	Description        string              `json:"description"`
	Purpose            string              `json:"purpose"`
	Status             ChapterStatus       `json:"status"`
	Evidence           []EvidenceReference `json:"evidence"`
	Files              []FileReference     `json:"files"`
	Symbols            []SymbolReference   `json:"symbols"`
	BehavioralChanges  []BehavioralChange  `json:"behavioralChanges"`
	Risks              []ReviewRisk        `json:"risks"`
	Facts              []Claim             `json:"facts"`
	Inferences         []Claim             `json:"inferences"`
	Unknowns           []Claim             `json:"unknowns"`
	RelatedTests       []TestReference     `json:"relatedTests"`
	SuggestedQuestions []SuggestedQuestion `json:"suggestedQuestions"`
}

type ValidationIssue struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	EvidenceID string `json:"evidenceId,omitempty"`
}

type ReviewAnalysis struct {
	SchemaVersion     int                 `json:"schemaVersion"`
	BaseSHA           string              `json:"baseSha"`
	HeadSHA           string              `json:"headSha"`
	Summary           string              `json:"summary"`
	SummaryEvidence   []EvidenceReference `json:"summaryEvidence"`
	SummaryValidation ValidationStatus    `json:"summaryValidation"`
	SummaryMessage    string              `json:"summaryMessage,omitempty"`
	AffectedAreas     []AffectedArea      `json:"affectedAreas"`
	Chapters          []ReviewChapter     `json:"chapters"`
	BehavioralChanges []BehavioralChange  `json:"behavioralChanges"`
	Risks             []ReviewRisk        `json:"risks"`
	Facts             []Claim             `json:"facts"`
	Inferences        []Claim             `json:"inferences"`
	Unknowns          []Claim             `json:"unknowns"`
	CreatedAt         time.Time           `json:"createdAt"`
	ValidationIssues  []ValidationIssue   `json:"validationIssues"`
}

type ChapterProgress struct {
	ChapterID string        `json:"chapterId"`
	Status    ChapterStatus `json:"status"`
	UpdatedAt time.Time     `json:"updatedAt"`
}
type ReviewNote struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	ChapterID string    `json:"chapterId,omitempty"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type ReviewComment struct {
	ID        string        `json:"id"`
	SessionID string        `json:"sessionId"`
	ChapterID string        `json:"chapterId,omitempty"`
	Kind      CommentKind   `json:"kind"`
	Body      string        `json:"body"`
	Path      string        `json:"path,omitempty"`
	StartLine *int          `json:"startLine,omitempty"`
	StartSide DiffSide      `json:"startSide,omitempty"`
	Line      *int          `json:"line,omitempty"`
	Side      DiffSide      `json:"side,omitempty"`
	Status    CommentStatus `json:"status"`
	GitHubID  string        `json:"githubId,omitempty"`
	GitHubURL string        `json:"githubUrl,omitempty"`
	CreatedAt time.Time     `json:"createdAt"`
	UpdatedAt time.Time     `json:"updatedAt"`
}

type ReviewSession struct {
	ID                string            `json:"id"`
	PullRequest       PullRequest       `json:"pullRequest"`
	BaseSHA           string            `json:"baseSha"`
	HeadSHA           string            `json:"headSha"`
	Status            SessionStatus     `json:"status"`
	AnalysisStatus    AnalysisStatus    `json:"analysisStatus"`
	Analysis          *ReviewAnalysis   `json:"analysis,omitempty"`
	LatestAnalysisRun *AnalysisRun      `json:"latestAnalysisRun,omitempty"`
	Chapters          []ChapterProgress `json:"chapters"`
	Notes             []ReviewNote      `json:"notes"`
	Comments          []ReviewComment   `json:"comments"`
	Progress          ReviewProgress    `json:"progress"`
	IsStale           bool              `json:"isStale"`
	StaleReason       string            `json:"staleReason,omitempty"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

type DependencyStatus struct {
	Name    DependencyName  `json:"name"`
	State   DependencyState `json:"state"`
	Path    string          `json:"path,omitempty"`
	Version string          `json:"version,omitempty"`
	Message string          `json:"message,omitempty"`
}

type AppPaths struct {
	Root         string `json:"root"`
	Repositories string `json:"repositories"`
	Worktrees    string `json:"worktrees"`
	Database     string `json:"database"`
	Logs         string `json:"logs"`
	Cache        string `json:"cache"`
}

type EnvironmentState struct {
	Dependencies []DependencyStatus `json:"dependencies"`
	Account      *GitHubUser        `json:"account,omitempty"`
	GitProtocol  string             `json:"gitProtocol"`
	RefreshedAt  time.Time          `json:"refreshedAt"`
}

type BootstrapState struct {
	Dependencies      []DependencyStatus   `json:"dependencies"`
	Paths             AppPaths             `json:"paths"`
	Account           *GitHubUser          `json:"account,omitempty"`
	GitProtocol       string               `json:"gitProtocol"`
	Selections        []SourceSelection    `json:"selections"`
	Inbox             []PullRequestSummary `json:"inbox"`
	EnvironmentCached bool                 `json:"environmentCached"`
}
