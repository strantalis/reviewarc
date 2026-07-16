export type DependencyName = 'git' | 'gh' | 'codex' | 'claude'
export type DependencyState = 'available' | 'missing' | 'broken'
export type Relationship = 'reviewRequested' | 'assigned' | 'authored' | 'selectedRepo'
export type AnalysisStatus = 'notStarted' | 'running' | 'ready' | 'failed' | 'stale'
export type RiskLevel = 'unknown' | 'low' | 'medium' | 'high' | 'critical'
export type ChapterStatus = 'notReviewed' | 'inProgress' | 'reviewed' | 'needsClarification' | 'blocked'
export type ValidationStatus = 'valid' | 'invalid' | 'unverified'
export type ClaimKind = 'fact' | 'inference' | 'unknown'
export type HarnessAvailability = 'available' | 'missing' | 'broken' | 'unsupported'
export type ContextTransport = 'reviewarcTools' | 'artifactFiles' | 'inline'
export type AnalysisRetryAction = 'retry' | 'replan' | 'configure' | 'authenticate' | 'changeProfile' | 'none'

export interface RepositoryRef { host: string; owner: string; name: string; cloneUrl: string; databaseId: string }
export interface PullRequestRef { repository: RepositoryRef; number: number }
export interface GitHubUser { login: string; name: string; avatarUrl: string }
export interface Organization { login: string; name: string; avatarUrl: string; accessStatus?: 'available' | 'ssoRequired' | 'denied' | 'unknown'; ssoUrl?: string }
export interface Repository { ref: RepositoryRef; description: string; isPrivate: boolean; isArchived: boolean; updatedAt: string }
export interface SourceSelection { kind: 'organization' | 'repository'; key: string; enabled: boolean }
export interface ReviewProgress { total: number; reviewed: number; blocked: number; clarify: number; percent: number }
export interface PullRequestSummary {
  ref: PullRequestRef; title: string; url: string; author: GitHubUser; updatedAt: string; isDraft: boolean
  additions: number; deletions: number; changedFiles: number; relationships: Relationship[]; labels: string[]
  analysisStatus: AnalysisStatus; progress: ReviewProgress; riskLevel: RiskLevel; reviewDecision?: string
}
export interface Commit { sha: string; message: string; author: GitHubUser; authoredAt: string }
export interface PullRequestReview { id: number; author: GitHubUser; state: string; body: string; commitSha: string; submittedAt: string; url: string }
export interface PullRequestReviewComment { id: number; reviewId: number; replyToId?: number; author: GitHubUser; body: string; path: string; startLine?: number; line?: number; originalStartLine?: number; originalLine?: number; startSide?: 'LEFT' | 'RIGHT'; side?: 'LEFT' | 'RIGHT'; commitSha: string; createdAt: string; updatedAt: string; url: string }
export interface CheckRun { id: number; name: string; status: string; conclusion?: string; appName?: string; url: string; detailsUrl?: string; startedAt: string; completedAt: string }
export interface PullRequest extends PullRequestSummary {
  body: string; baseRef: string; headRef: string; baseSha: string; headSha: string; headRepository: RepositoryRef
  commits: Commit[]; requestedReviewers: GitHubUser[]; assignees: GitHubUser[]; reviews: PullRequestReview[]; reviewComments: PullRequestReviewComment[]; checkRuns: CheckRun[]; reviewState: string
}
export interface ChangedFile { path: string; previousPath: string; status: string; additions: number; deletions: number; isBinary: boolean }
export interface DiffLine { kind: 'context' | 'add' | 'delete' | 'noNewline'; content: string; oldLine?: number; newLine?: number }
export interface DiffHunk { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }
export interface DiffFile { file: ChangedFile; hunks: DiffHunk[]; patch: string }
export interface FileContent { path: string; revision: 'base' | 'head'; sha: string; content: string; isBinary: boolean; lineCount: number }
export interface EvidenceReference {
  id: string; path: string; revision: 'base' | 'head'; startLine: number; endLine: number; symbol?: string
  validationStatus: ValidationStatus; validationMessage?: string
}
export interface Claim { id: string; kind: ClaimKind; text: string; evidence: EvidenceReference[]; validationStatus: ValidationStatus; validationMessage?: string }
export interface BehavioralChange { id: string; summary: string; before: string; after: string; evidence: EvidenceReference[] }
export interface ReviewRisk { id: string; title: string; description: string; level: RiskLevel; evidence: EvidenceReference[] }
export interface FileReference { path: string; description: string }
export interface SymbolReference { path: string; name: string; evidence: EvidenceReference[] }
export interface AffectedArea { name: string; description: string; evidence: EvidenceReference[] }
export interface TestReference { id: string; path: string; description: string; evidence: EvidenceReference[]; relationship: ValidationStatus }
export interface SuggestedQuestion { id: string; text: string; rationale: string; evidence: EvidenceReference[] }
export interface ReviewChapter {
  id: string; order: number; title: string; description: string; purpose: string; status: ChapterStatus
  evidence: EvidenceReference[]; files: FileReference[]; symbols: SymbolReference[]; behavioralChanges: BehavioralChange[]
  risks: ReviewRisk[]; facts: Claim[]; inferences: Claim[]; unknowns: Claim[]; relatedTests: TestReference[]
  suggestedQuestions: SuggestedQuestion[]
}
export interface ReviewAnalysis {
  schemaVersion: number; baseSha: string; headSha: string; summary: string; summaryEvidence: EvidenceReference[]
  summaryValidation: ValidationStatus; summaryMessage?: string; affectedAreas: AffectedArea[]
  chapters: ReviewChapter[]; behavioralChanges: BehavioralChange[]; risks: ReviewRisk[]; facts: Claim[]
  inferences: Claim[]; unknowns: Claim[]; createdAt: string; validationIssues: {code: string; message: string; evidenceId?: string}[]
}
export interface ReasoningLevel { id: string; label: string; recommended?: boolean }
export interface HarnessModel { id: string; label: string; reasoningLevels: ReasoningLevel[]; recommended?: boolean }
export interface HarnessCapabilities {
  jsonSchema: boolean; readOnly: boolean; progress: boolean; contextTransport: ContextTransport[]
}
export interface HarnessDescriptor {
  id: string; label: string; availability: HarnessAvailability; path?: string; version?: string; message?: string
  eligible: boolean; capabilities: HarnessCapabilities; models: HarnessModel[]
}
export interface AnalysisProfile { harness: string; model: string; reasoning: string }
export interface AnalysisConfiguration { defaultProfile?: AnalysisProfile; harnesses: HarnessDescriptor[]; refreshedAt?: string }
export interface AnalysisRequest { profile?: AnalysisProfile; saveAsDefault?: boolean }
export interface AnalysisFailure {
  code: string; title: string; message: string; action: AnalysisRetryAction; retryable?: boolean; technicalDetails?: string
}
export interface ContextAccess {
  kind: string; path?: string; revision?: 'base' | 'head'; startLine?: number; endLine?: number; bytes?: number; at: string
}
export interface DiffOmissionDecision {
  path: string; category: 'generated' | 'documentation' | 'example_or_test' | 'metadata' | 'covered_elsewhere' | 'not_relevant' | 'budget_limited' | 'other'; reason: string
}
export interface AnalysisCoverage {
  changedFilesTotal: number; diffFilesFullyRead: number; diffFilesPartiallyRead: number
  diffFilesPreviewed?: number; diffFilesUnseen?: number
  diffFilesUnread: number; diffBytesTotal: number; diffBytesRead: number; segments: number
  omittedPaths: string[]; previewedPaths?: string[]; unseenPaths?: string[]; previewDecisions?: DiffOmissionDecision[]; accesses: ContextAccess[]
}
export interface AnalysisRun {
  id: string; sessionId: string; profile: AnalysisProfile; harnessVersion?: string; contextTransport: ContextTransport
  schemaVersion: number; inputFingerprint: string; coverage: AnalysisCoverage; startedAt: string; completedAt?: string; updatedAt: string
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled'; failure?: AnalysisFailure
}
export interface ReviewNote { id: string; sessionId: string; chapterId?: string; body: string; createdAt: string; updatedAt: string }
export interface ReviewComment {
  id: string; sessionId: string; chapterId?: string; kind: 'general' | 'inline'; body: string; path?: string; startLine?: number
  startSide?: 'LEFT' | 'RIGHT'; line?: number; side?: 'LEFT' | 'RIGHT'; status: 'draft' | 'published' | 'failed'; githubId?: string; githubUrl?: string; createdAt: string; updatedAt: string
}
export interface CommentRange { startLine: number; startSide: 'LEFT' | 'RIGHT'; endLine: number; endSide: 'LEFT' | 'RIGHT' }
export interface ReviewSession {
  id: string; pullRequest: PullRequest; baseSha: string; headSha: string; status: 'preparing' | 'ready' | 'failed'
  analysisStatus: AnalysisStatus; analysis?: ReviewAnalysis; chapters: {chapterId: string; status: ChapterStatus; updatedAt: string}[]
  notes: ReviewNote[]; comments: ReviewComment[]; progress: ReviewProgress; isStale: boolean; staleReason?: string
  latestAnalysisRun?: AnalysisRun
  createdAt: string; updatedAt: string
}
export interface DependencyStatus { name: DependencyName; state: DependencyState; path?: string; version?: string; message?: string }
export interface AppPaths { root: string; repositories: string; worktrees: string; database: string; logs: string; cache: string }
export interface EnvironmentState { dependencies: DependencyStatus[]; account?: GitHubUser; gitProtocol: 'ssh' | 'https'; refreshedAt: string }
export type UpdateChannel = 'stable' | 'beta'
export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'failed' | 'unsupported'
export interface UpdateRelease { version: string; build: string; releaseNotesUrl?: string }
export interface SoftwareUpdateStatus {
  currentVersion: string; currentBuild: string; state: UpdateState; channel: UpdateChannel; release?: UpdateRelease
  downloadedBytes?: number; totalBytes?: number; lastCheckedAt?: string; checkMode?: 'manual' | 'scheduled'; error?: string; errorVisible?: boolean
}
export interface BootstrapState { dependencies: DependencyStatus[]; paths: AppPaths; account?: GitHubUser; gitProtocol?: 'ssh' | 'https'; selections: SourceSelection[]; inbox: PullRequestSummary[]; environmentCached?: boolean }
export interface SourceCatalog { organizations: Organization[]; repositories: Repository[]; selections?: SourceSelection[] }
export interface SessionDetail { session: ReviewSession; files: ChangedFile[]; diffs?: DiffFile[] }
export interface OperationEvent { stage: string; message: string; progress?: number; status?: 'running' | 'complete' | 'failed'; updatedAt?: string }
export interface AccountState { status: string; user?: GitHubUser; message?: string }
export interface SourceState extends SourceCatalog {}
export interface RepositoryPage { items: Repository[]; totalCount: number; endCursor?: string; hasNextPage: boolean; cached: boolean }
export interface SelectedRepositoryRefresh { repositories: Repository[]; archivedKeys: string[]; errors: Record<string, string> }
export interface InboxResult { items: PullRequestSummary[]; errors?: Record<string, string>; partial?: boolean }
export interface Operation { id: string; sessionId?: string; kind: string; stage: string; message: string; state: string; progress?: number; runId?: string; failure?: AnalysisFailure; updatedAt?: string }
export interface OperationSnapshot { operation: Operation; events: Operation[] }
export interface PublishItem { draftId: string; kind: 'general' | 'inline'; body: string; path?: string; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; line?: number; side?: 'LEFT' | 'RIGHT' }
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
export interface PublishPreview { token: string; digest: string; repository: string; number: number; headSha: string; items: PublishItem[]; event: ReviewEvent; expiresAt: string }
export interface ThreadReplyPreview { token: string; digest: string; repository: string; number: number; headSha: string; rootCommentId: number; rootAuthor: string; path: string; body: string; expiresAt: string }
