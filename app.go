package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"reviewarc/internal/agent"
	"reviewarc/internal/agent/codex"
	"reviewarc/internal/appdata"
	"reviewarc/internal/dependencies"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	githubclient "reviewarc/internal/github"
	"reviewarc/internal/persistence"
	proc "reviewarc/internal/process"
)

type AccountState struct {
	Status  string             `json:"status"`
	User    *domain.GitHubUser `json:"user,omitempty"`
	Message string             `json:"message,omitempty"`
}
type SourceState struct {
	Organizations []domain.Organization    `json:"organizations"`
	Repositories  []domain.Repository      `json:"repositories"`
	Selections    []domain.SourceSelection `json:"selections"`
}
type InboxState struct {
	Items   []domain.PullRequestSummary `json:"items"`
	Errors  map[string]string           `json:"errors"`
	Partial bool                        `json:"partial"`
}
type Operation struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId,omitempty"`
	Kind      string `json:"kind"`
	Stage     string `json:"stage"`
	State     string `json:"state"`
	Message   string `json:"message"`
}
type NoteInput struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	ChapterID string `json:"chapterId"`
	Body      string `json:"body"`
}
type CommentInput struct {
	ID        string             `json:"id"`
	SessionID string             `json:"sessionId"`
	ChapterID string             `json:"chapterId"`
	Kind      domain.CommentKind `json:"kind"`
	Body      string             `json:"body"`
	Path      string             `json:"path"`
	Line      *int               `json:"line"`
	Side      domain.DiffSide    `json:"side"`
}
type PublishItem struct {
	DraftID string             `json:"draftId"`
	Kind    domain.CommentKind `json:"kind"`
	Body    string             `json:"body"`
	Path    string             `json:"path,omitempty"`
	Line    *int               `json:"line,omitempty"`
	Side    domain.DiffSide    `json:"side,omitempty"`
}
type PublishPreview struct {
	Token      string        `json:"token"`
	Digest     string        `json:"digest"`
	Repository string        `json:"repository"`
	Number     int           `json:"number"`
	HeadSHA    string        `json:"headSha"`
	Items      []PublishItem `json:"items"`
	Event      string        `json:"event"`
	ExpiresAt  time.Time     `json:"expiresAt"`
}

type preparedState struct {
	repository gitcache.ManagedRepository
	files      []domain.ChangedFile
}
type pendingPublish struct {
	preview PublishPreview
	ref     domain.PullRequestRef
}

type App struct {
	ctx               context.Context
	mu                sync.RWMutex
	paths             domain.AppPaths
	detector          *dependencies.Detector
	github            *githubclient.Client
	store             *persistence.Store
	repos             *gitcache.Manager
	agent             agent.ReviewAgent
	prepared          map[string]preparedState
	active            map[string]context.CancelFunc
	analysisBySession map[string]string
	publish           map[string]pendingPublish
	gitProtocol       func() string
}

func NewApp() (*App, error) {
	paths, err := appdata.Resolve()
	if err != nil {
		return nil, err
	}
	runner := proc.NewExecRunner()
	gitProtocol := func() string { return githubGitProtocol(runner) }
	remoteURL := preferredGitHubRemote(runner)
	store, err := persistence.Open(paths.Database)
	if err != nil {
		return nil, err
	}
	if _, err := store.RecoverInterruptedAnalyses(context.Background()); err != nil {
		_ = store.Close()
		return nil, err
	}
	return &App{paths: paths, detector: dependencies.New(runner), github: githubclient.New(runner), store: store, repos: gitcache.NewManager(paths.Repositories, paths.Worktrees, runner, gitcache.Options{RemoteURL: remoteURL}), agent: codex.New(runner, codex.Config{}), prepared: map[string]preparedState{}, active: map[string]context.CancelFunc{}, analysisBySession: map[string]string{}, publish: map[string]pendingPublish{}, gitProtocol: gitProtocol}, nil
}

func githubGitProtocol(runner proc.Runner) string {
	protocol := "https"
	if result, err := runner.Run(context.Background(), proc.Command{Tool: proc.GH, Args: []string{"config", "get", "git_protocol", "--host", "github.com"}, Timeout: 5 * time.Second, MaxOutput: 1024}); err == nil {
		protocol = strings.ToLower(strings.TrimSpace(string(result.Stdout)))
	}
	if protocol == "ssh" {
		return "ssh"
	}
	return "https"
}
func githubRemote(protocol string) func(domain.RepositoryRef) string {
	if protocol == "ssh" {
		return func(r domain.RepositoryRef) string { return "git@github.com:" + r.Owner + "/" + r.Name + ".git" }
	}
	return func(r domain.RepositoryRef) string { return "https://github.com/" + r.Owner + "/" + r.Name + ".git" }
}
func preferredGitHubRemote(runner proc.Runner) func(domain.RepositoryRef) string {
	return func(r domain.RepositoryRef) string {
		return githubRemote(githubGitProtocol(runner))(r)
	}
}
func (a *App) startup(ctx context.Context) { a.mu.Lock(); a.ctx = ctx; a.mu.Unlock() }
func (a *App) shutdown(context.Context)    { _ = a.store.Close() }
func (a *App) appContext() context.Context {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func (a *App) Bootstrap() domain.BootstrapState {
	ctx := a.appContext()
	selections, _ := a.store.ListSelections(ctx)
	if selections == nil {
		selections = []domain.SourceSelection{}
	}
	stored, _ := a.store.ListPullRequests(ctx)
	inbox := make([]domain.PullRequestSummary, 0, len(stored))
	for _, pr := range stored {
		item := pr.PullRequestSummary
		if item.Relationships == nil {
			item.Relationships = []domain.Relationship{}
		}
		if item.Labels == nil {
			item.Labels = []string{}
		}
		if s, err := a.store.LatestSessionForPullRequest(ctx, pr.Ref); err == nil {
			item.AnalysisStatus, item.Progress = s.AnalysisStatus, s.Progress
			if s.Analysis != nil {
				item.RiskLevel = highestRisk(s.Analysis.Risks)
			}
		}
		inbox = append(inbox, item)
	}
	sortInbox(inbox)
	protocol := "https"
	if a.gitProtocol != nil {
		protocol = a.gitProtocol()
	}
	state := domain.BootstrapState{Dependencies: a.detector.Detect(ctx), Paths: a.paths, Selections: selections, Inbox: inbox, GitProtocol: protocol}
	if user, err := a.github.CurrentUser(ctx); err == nil {
		state.Account = &user
	}
	return state
}
func (a *App) RefreshAccount() AccountState {
	u, err := a.github.CurrentUser(a.appContext())
	if err != nil {
		var auth *githubclient.AuthError
		if errors.As(err, &auth) {
			return AccountState{Status: string(auth.Kind), Message: auth.Message}
		}
		return AccountState{Status: "unavailable", Message: "GitHub account status could not be verified."}
	}
	return AccountState{Status: "authenticated", User: &u}
}
func (a *App) ListSources() (SourceState, error) {
	ctx := a.appContext()
	orgs, err := a.github.ListOrganizations(ctx)
	if err != nil {
		return SourceState{}, err
	}
	repos, err := a.github.ListRepositories(ctx, githubclient.RepositoryQuery{})
	if err != nil {
		return SourceState{}, err
	}
	for _, repo := range repos {
		if err := a.store.UpsertRepository(ctx, repo); err != nil {
			return SourceState{}, err
		}
	}
	selections, _ := a.store.ListSelections(ctx)
	if orgs == nil {
		orgs = []domain.Organization{}
	}
	if repos == nil {
		repos = []domain.Repository{}
	}
	if selections == nil {
		selections = []domain.SourceSelection{}
	}
	return SourceState{Organizations: orgs, Repositories: repos, Selections: selections}, nil
}
func (a *App) SaveSelections(selections []domain.SourceSelection) error {
	for _, s := range selections {
		if s.Kind != domain.SelectionOrganization && s.Kind != domain.SelectionRepository {
			return errors.New("invalid source selection")
		}
		if strings.TrimSpace(s.Key) == "" || len(s.Key) > 220 {
			return errors.New("invalid source selection key")
		}
	}
	return a.store.ReplaceSelections(a.appContext(), selections)
}
func (a *App) RefreshInbox() (InboxState, error) {
	ctx := a.appContext()
	account := a.RefreshAccount()
	if account.User == nil {
		return InboxState{}, errors.New(account.Message)
	}
	repositories, err := a.store.ListRepositories(ctx)
	if err != nil || len(repositories) == 0 {
		sources, e := a.ListSources()
		if e != nil {
			return InboxState{}, e
		}
		repositories = sources.Repositories
	}
	selections, err := a.store.ListSelections(ctx)
	if err != nil {
		return InboxState{}, err
	}
	selected := selectedRepositories(repositories, selections)
	result := a.github.ListPullRequests(ctx, githubclient.PullRequestQuery{Repositories: selected, CurrentLogin: account.User.Login})
	for i := range result.Items {
		item := &result.Items[i]
		if item.BaseSHA != "" && item.HeadSHA != "" {
			if _, staleErr := a.store.MarkStaleIfChanged(ctx, item.Ref, item.BaseSHA, item.HeadSHA); staleErr != nil {
				return InboxState{}, staleErr
			}
		}
		if s, e := a.store.LatestSessionForPullRequest(ctx, item.Ref); e == nil {
			item.AnalysisStatus, item.Progress = s.AnalysisStatus, s.Progress
			if s.Analysis != nil {
				item.RiskLevel = highestRisk(s.Analysis.Risks)
			}
		}
		if persistErr := a.store.UpsertPullRequest(ctx, domain.PullRequest{PullRequestSummary: *item, BaseSHA: item.BaseSHA, HeadSHA: item.HeadSHA}); persistErr != nil {
			return InboxState{}, persistErr
		}
	}
	return InboxState{Items: result.Items, Errors: result.Errors, Partial: result.Partial}, nil
}
func (a *App) OpenPullRequest(ref domain.PullRequestRef) (domain.ReviewSession, error) {
	ctx := a.appContext()
	var cached *domain.PullRequest
	if stored, listErr := a.store.ListPullRequests(ctx); listErr == nil {
		for i := range stored {
			if strings.EqualFold(stored[i].Ref.Repository.Host, ref.Repository.Host) && strings.EqualFold(stored[i].Ref.Repository.Owner, ref.Repository.Owner) && strings.EqualFold(stored[i].Ref.Repository.Name, ref.Repository.Name) && stored[i].Ref.Number == ref.Number {
				cached = &stored[i]
				break
			}
		}
	}
	detail, err := a.github.GetPullRequest(ctx, ref)
	if err != nil {
		return domain.ReviewSession{}, err
	}
	pr := detail.PullRequest
	if cached != nil {
		pr.Relationships = cached.Relationships
		if len(pr.Labels) == 0 {
			pr.Labels = cached.Labels
		}
		if pr.ReviewState == "" {
			pr.ReviewState = cached.ReviewState
			if pr.ReviewState == "" {
				pr.ReviewState = cached.ReviewDecision
			}
		}
	}
	if err := a.store.UpsertPullRequest(ctx, pr); err != nil {
		return domain.ReviewSession{}, err
	}
	_, _ = a.store.MarkStaleIfChanged(ctx, pr.Ref, pr.BaseSHA, pr.HeadSHA)
	session, err := a.store.LatestSessionForPullRequest(ctx, pr.Ref)
	if err != nil {
		now := time.Now().UTC()
		session = domain.ReviewSession{ID: newID(), PullRequest: pr, BaseSHA: pr.BaseSHA, HeadSHA: pr.HeadSHA, Status: domain.SessionPreparing, AnalysisStatus: domain.AnalysisNotStarted, CreatedAt: now, UpdatedAt: now}
		if err := a.store.SaveSession(ctx, session); err != nil {
			return domain.ReviewSession{}, err
		}
	} else if session.HeadSHA != pr.HeadSHA || session.BaseSHA != pr.BaseSHA {
		session.PullRequest, session.BaseSHA, session.HeadSHA = pr, pr.BaseSHA, pr.HeadSHA
		session.IsStale, session.AnalysisStatus, session.Status = true, domain.AnalysisStale, domain.SessionPreparing
		session.StaleReason = "Pull request revisions changed; existing notes, drafts, and progress were preserved."
		session.UpdatedAt = time.Now().UTC()
		if err := a.store.SaveSession(ctx, session); err != nil {
			return domain.ReviewSession{}, err
		}
	}
	prepared, files, err := a.prepare(ctx, session)
	if err != nil {
		session.Status = domain.SessionFailed
		session.UpdatedAt = time.Now().UTC()
		_ = a.store.SaveSession(ctx, session)
		return session, err
	}
	session.PullRequest = pr
	session.Status = domain.SessionReady
	session = normalizeSession(session)
	session.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveSession(ctx, session); err != nil {
		return domain.ReviewSession{}, err
	}
	a.mu.Lock()
	a.prepared[session.ID] = preparedState{prepared, files}
	a.mu.Unlock()
	return a.GetSession(session.ID)
}
func (a *App) GetSession(id string) (domain.ReviewSession, error) {
	session, err := a.store.GetSession(a.appContext(), id)
	if err != nil {
		return session, err
	}
	return normalizeSession(session), nil
}
func (a *App) GetChangedFiles(sessionID string) ([]domain.ChangedFile, error) {
	state, err := a.ensurePrepared(sessionID)
	return state.files, err
}
func (a *App) GetDiff(sessionID, path string) (domain.DiffFile, error) {
	state, err := a.ensurePrepared(sessionID)
	if err != nil {
		return domain.DiffFile{}, err
	}
	for _, file := range state.files {
		if file.Path == path {
			return a.repos.DiffFile(a.appContext(), state.repository, file, 5)
		}
	}
	return domain.DiffFile{}, errors.New("file is not part of this pull request")
}
func (a *App) GetFile(sessionID, path string, revision domain.Revision) (domain.FileContent, error) {
	state, err := a.ensurePrepared(sessionID)
	if err != nil {
		return domain.FileContent{}, err
	}
	return a.repos.ReadFile(a.appContext(), state.repository, revision, path)
}
func (a *App) StartAnalysis(sessionID string) (Operation, error) {
	state, err := a.ensurePrepared(sessionID)
	if err != nil {
		return Operation{}, err
	}
	session, err := a.store.GetSession(a.appContext(), sessionID)
	if err != nil {
		return Operation{}, err
	}
	op := Operation{ID: newID(), SessionID: sessionID, Kind: "analysis", Stage: "preparingSnapshot", State: "running", Message: "Preparing isolated repository snapshot"}
	ctx, cancel := context.WithCancel(a.appContext())
	a.mu.Lock()
	if _, exists := a.analysisBySession[sessionID]; exists {
		a.mu.Unlock()
		cancel()
		return Operation{}, errors.New("analysis is already running for this session")
	}
	a.active[op.ID] = cancel
	a.analysisBySession[sessionID] = op.ID
	a.mu.Unlock()
	session.AnalysisStatus = domain.AnalysisRunning
	session.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveSession(a.appContext(), session); err != nil {
		cancel()
		a.mu.Lock()
		delete(a.active, op.ID)
		delete(a.analysisBySession, sessionID)
		a.mu.Unlock()
		return Operation{}, err
	}
	a.emitOperation(op)
	go a.runAnalysis(ctx, op, session, state)
	return op, nil
}
func (a *App) CancelOperation(id string) error {
	a.mu.Lock()
	cancel := a.active[id]
	delete(a.active, id)
	a.mu.Unlock()
	if cancel == nil {
		return errors.New("operation is not active")
	}
	cancel()
	return nil
}
func (a *App) SetChapterStatus(sessionID, chapterID string, status domain.ChapterStatus) (domain.ReviewSession, error) {
	if err := a.store.SetChapterStatus(a.appContext(), sessionID, chapterID, status); err != nil {
		return domain.ReviewSession{}, err
	}
	return a.GetSession(sessionID)
}
func (a *App) SaveNote(input NoteInput) (domain.ReviewNote, error) {
	if strings.TrimSpace(input.Body) == "" || len(input.Body) > 20000 {
		return domain.ReviewNote{}, errors.New("note must contain 1 to 20,000 characters")
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = newID()
	}
	note := domain.ReviewNote{ID: input.ID, SessionID: input.SessionID, ChapterID: input.ChapterID, Body: input.Body, CreatedAt: now, UpdatedAt: now}
	if err := a.store.SaveNote(a.appContext(), note); err != nil {
		return domain.ReviewNote{}, err
	}
	return note, nil
}
func (a *App) DeleteNote(id string) error { return a.store.DeleteNote(a.appContext(), id) }
func (a *App) SaveDraftComment(input CommentInput) (domain.ReviewComment, error) {
	if strings.TrimSpace(input.Body) == "" || len(input.Body) > 65536 {
		return domain.ReviewComment{}, errors.New("comment must contain 1 to 65,536 characters")
	}
	if input.Kind != domain.CommentGeneral && input.Kind != domain.CommentInline {
		return domain.ReviewComment{}, errors.New("invalid comment kind")
	}
	if input.Kind == domain.CommentInline {
		if err := a.validateInline(input.SessionID, input.Path, input.Line, input.Side); err != nil {
			return domain.ReviewComment{}, err
		}
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = newID()
	}
	comment := domain.ReviewComment{ID: input.ID, SessionID: input.SessionID, ChapterID: input.ChapterID, Kind: input.Kind, Body: input.Body, Path: input.Path, Line: input.Line, Side: input.Side, Status: domain.CommentDraft, CreatedAt: now, UpdatedAt: now}
	if err := a.store.SaveComment(a.appContext(), comment); err != nil {
		return domain.ReviewComment{}, err
	}
	return comment, nil
}
func (a *App) DeleteDraftComment(id string) error { return a.store.DeleteComment(a.appContext(), id) }
func (a *App) PreparePublish(sessionID string, draftIDs []string) (PublishPreview, error) {
	return a.PrepareReview(sessionID, draftIDs, "COMMENT")
}
func (a *App) PrepareReview(sessionID string, draftIDs []string, event string) (PublishPreview, error) {
	event = strings.ToUpper(strings.TrimSpace(event))
	if event != "COMMENT" && event != "APPROVE" && event != "REQUEST_CHANGES" {
		return PublishPreview{}, errors.New("invalid GitHub review event")
	}
	session, err := a.store.GetSession(a.appContext(), sessionID)
	if err != nil {
		return PublishPreview{}, err
	}
	wanted := map[string]bool{}
	for _, id := range draftIDs {
		wanted[id] = true
	}
	items := make([]PublishItem, 0, len(wanted))
	for _, draft := range session.Comments {
		if !wanted[draft.ID] || draft.Status != domain.CommentDraft {
			continue
		}
		if draft.Kind == domain.CommentInline {
			if err := a.validateInline(sessionID, draft.Path, draft.Line, draft.Side); err != nil {
				return PublishPreview{}, err
			}
		}
		items = append(items, PublishItem{draft.ID, draft.Kind, draft.Body, draft.Path, draft.Line, draft.Side})
	}
	if len(items) != len(wanted) || (event == "COMMENT" && len(items) == 0) {
		return PublishPreview{}, errors.New("one or more draft comments are unavailable")
	}
	if event == "REQUEST_CHANGES" {
		hasBody := false
		for _, item := range items {
			if item.Kind == domain.CommentGeneral && strings.TrimSpace(item.Body) != "" {
				hasBody = true
				break
			}
		}
		if !hasBody {
			return PublishPreview{}, errors.New("request changes requires a selected general draft explaining the decision")
		}
	}
	preview := PublishPreview{Token: newID(), Repository: session.PullRequest.Ref.Repository.Owner + "/" + session.PullRequest.Ref.Repository.Name, Number: session.PullRequest.Ref.Number, HeadSHA: session.HeadSHA, Items: items, Event: event, ExpiresAt: time.Now().UTC().Add(5 * time.Minute)}
	payload, _ := json.Marshal(struct {
		Repository string
		Number     int
		HeadSHA    string
		Items      []PublishItem
		Event      string
	}{preview.Repository, preview.Number, preview.HeadSHA, preview.Items, preview.Event})
	sum := sha256.Sum256(payload)
	preview.Digest = hex.EncodeToString(sum[:])
	a.mu.Lock()
	a.publish[preview.Token] = pendingPublish{preview, session.PullRequest.Ref}
	a.mu.Unlock()
	return preview, nil
}
func (a *App) ConfirmPublish(token, digest string) ([]domain.ReviewComment, error) {
	a.mu.Lock()
	pending, ok := a.publish[token]
	delete(a.publish, token)
	a.mu.Unlock()
	if !ok || pending.preview.Digest != digest || time.Now().After(pending.preview.ExpiresAt) {
		return nil, errors.New("publish confirmation is invalid or expired")
	}
	current, err := a.github.GetPullRequest(a.appContext(), pending.ref)
	if err != nil {
		return nil, err
	}
	if current.PullRequest.HeadSHA != pending.preview.HeadSHA {
		return nil, errors.New("pull request changed; refresh before publishing")
	}
	response, err := a.github.PublishReview(a.appContext(), pending.ref, buildReviewPayload(pending.preview))
	if err != nil {
		return nil, err
	}
	var published struct {
		ID      any    `json:"id"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.Unmarshal(response, &published); err != nil {
		return nil, errors.New("GitHub published the review but returned malformed confirmation")
	}
	out := make([]domain.ReviewComment, 0, len(pending.preview.Items))
	for _, item := range pending.preview.Items {
		id := fmt.Sprint(published.ID)
		if err := a.store.SetCommentPublication(a.appContext(), item.DraftID, domain.CommentPublished, id, published.HTMLURL); err != nil {
			return nil, err
		}
		out = append(out, domain.ReviewComment{ID: item.DraftID, Kind: item.Kind, Body: item.Body, Path: item.Path, Line: item.Line, Side: item.Side, Status: domain.CommentPublished, GitHubID: id, GitHubURL: published.HTMLURL})
	}
	return out, nil
}

func (a *App) prepare(ctx context.Context, session domain.ReviewSession) (gitcache.ManagedRepository, []domain.ChangedFile, error) {
	spec := domain.RevisionSpec{BaseSHA: session.BaseSHA, HeadSHA: session.HeadSHA, BaseRef: session.PullRequest.BaseRef, HeadRef: session.PullRequest.HeadRef, HeadRepository: session.PullRequest.HeadRepository}
	prepared, err := a.repos.PreparePR(ctx, session.PullRequest.Ref, spec, nil)
	if err != nil {
		return prepared, nil, err
	}
	files, err := a.repos.ChangedFiles(ctx, prepared)
	return prepared, files, err
}
func (a *App) ensurePrepared(sessionID string) (preparedState, error) {
	a.mu.RLock()
	state, ok := a.prepared[sessionID]
	a.mu.RUnlock()
	if ok {
		return state, nil
	}
	session, err := a.store.GetSession(a.appContext(), sessionID)
	if err != nil {
		return state, err
	}
	repo, files, err := a.prepare(a.appContext(), session)
	if err != nil {
		return state, err
	}
	state = preparedState{repo, files}
	a.mu.Lock()
	a.prepared[sessionID] = state
	a.mu.Unlock()
	return state, nil
}
func (a *App) runAnalysis(ctx context.Context, op Operation, session domain.ReviewSession, state preparedState) {
	defer func() { a.mu.Lock(); delete(a.active, op.ID); delete(a.analysisBySession, session.ID); a.mu.Unlock() }()
	lease, err := a.repos.AcquireReadOnlySnapshot(ctx, state.repository)
	if err != nil {
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op)
			return
		}
		a.failOperation(op, err)
		return
	}
	defer lease.Close()
	var diff strings.Builder
	for _, file := range state.files {
		if parsed, e := a.repos.DiffFile(ctx, state.repository, file, 5); e == nil {
			writeDiff(&diff, parsed)
		} else if analysisWasCancelled(ctx, e) {
			a.cancelAnalysisOperation(op)
			return
		}
	}
	repositoryContext, err := a.repos.RepositoryContext(ctx, state.repository, state.files, 512<<10)
	if err != nil {
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op)
			return
		}
		a.failOperation(op, err)
		return
	}
	op.Stage = "runningCodex"
	op.Message = "Running Codex in read-only mode"
	a.emitOperation(op)
	events, err := a.agent.AnalyzeChange(ctx, agent.AnalyzeInput{PullRequest: session.PullRequest, Workspace: lease.Path(), BaseSHA: session.BaseSHA, HeadSHA: session.HeadSHA, ChangedFiles: state.files, UnifiedDiff: diff.String(), RepositoryContext: repositoryContext, ExistingDiscussion: existingDiscussion(session.PullRequest)})
	if err != nil {
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op)
			return
		}
		a.failOperation(op, err)
		return
	}
	for event := range events {
		op.Message = event.Message
		switch event.Kind {
		case agent.EventCompleted:
			if event.Analysis == nil {
				a.failOperation(op, errors.New("analysis completed without a review model"))
				return
			}
			commitCtx, cancelCommit := context.WithTimeout(a.appContext(), 10*time.Second)
			err := a.store.SaveCompletedAnalysis(commitCtx, session.ID, *event.Analysis)
			cancelCommit()
			if err != nil {
				a.failOperation(op, err)
				return
			}
			op.Stage = "complete"
			op.State = "completed"
			op.Message = "Analysis ready"
			a.emitOperation(op)
			if a.ctx != nil {
				runtime.EventsEmit(a.appContext(), "reviewarc:session:v1", map[string]any{"sessionId": session.ID, "reason": "analysisReady"})
			}
			return
		case agent.EventCancelled:
			a.cancelAnalysisOperation(op)
			return
		case agent.EventFailed:
			eventErr := event.Err
			if eventErr == nil {
				eventErr = errors.New(event.Message)
			}
			if analysisWasCancelled(ctx, eventErr) {
				a.cancelAnalysisOperation(op)
				return
			}
			a.failOperation(op, eventErr)
			return
		}
		a.emitOperation(op)
	}
	if ctx.Err() != nil {
		a.cancelAnalysisOperation(op)
		return
	}
	a.failOperation(op, errors.New("analysis stream ended without a completed review model"))
}
func (a *App) cancelAnalysisOperation(op Operation) {
	op.State = "cancelled"
	op.Stage = "cancelled"
	op.Message = "Analysis cancelled"
	if current, loadErr := a.store.GetSession(a.appContext(), op.SessionID); loadErr == nil {
		current.AnalysisStatus = analysisStatusAfterCancellation(current)
		current.UpdatedAt = time.Now().UTC()
		_ = a.store.SaveSession(a.appContext(), current)
	}
	a.emitOperation(op)
}
func (a *App) failOperation(op Operation, err error) {
	op.State = "failed"
	op.Stage = "failed"
	op.Message = safeMessage(err)
	if session, loadErr := a.store.GetSession(a.appContext(), op.SessionID); loadErr == nil {
		session.AnalysisStatus = domain.AnalysisFailed
		session.UpdatedAt = time.Now().UTC()
		_ = a.store.SaveSession(a.appContext(), session)
	}
	a.emitOperation(op)
}
func (a *App) emitOperation(op Operation) {
	_ = a.store.SaveOperation(a.appContext(), persistence.Operation{ID: op.ID, Kind: op.Kind, Subject: op.SessionID, Status: op.State, Detail: op.Message, UpdatedAt: time.Now().UTC()})
	if a.ctx != nil {
		runtime.EventsEmit(a.appContext(), "reviewarc:operation:v1", op)
	}
}
func (a *App) validateInline(sessionID, path string, line *int, side domain.DiffSide) error {
	if line == nil || *line < 1 || (side != domain.DiffSideLeft && side != domain.DiffSideRight) {
		return errors.New("inline comment requires a valid diff line and side")
	}
	diff, err := a.GetDiff(sessionID, path)
	if err != nil {
		return err
	}
	for _, h := range diff.Hunks {
		for _, candidate := range h.Lines {
			if side == domain.DiffSideRight && candidate.NewLine != nil && *candidate.NewLine == *line || side == domain.DiffSideLeft && candidate.OldLine != nil && *candidate.OldLine == *line {
				return nil
			}
		}
	}
	return errors.New("inline comment line is not present in the pull request diff")
}
func selectedRepositories(repos []domain.Repository, selections []domain.SourceSelection) []domain.RepositoryRef {
	repoKeys, orgKeys := map[string]bool{}, map[string]bool{}
	for _, s := range selections {
		if !s.Enabled {
			continue
		}
		if s.Kind == domain.SelectionOrganization {
			orgKeys[strings.ToLower(s.Key)] = true
		} else {
			repoKeys[strings.ToLower(s.Key)] = true
		}
	}
	var out []domain.RepositoryRef
	for _, repo := range repos {
		name := strings.ToLower(repo.Ref.Owner + "/" + repo.Ref.Name)
		if repoKeys[name] || orgKeys[strings.ToLower(repo.Ref.Owner)] {
			out = append(out, repo.Ref)
		}
	}
	return out
}
func buildReviewPayload(preview PublishPreview) []byte {
	type inline struct {
		Path string          `json:"path"`
		Line int             `json:"line"`
		Side domain.DiffSide `json:"side"`
		Body string          `json:"body"`
	}
	body := []string{}
	comments := []inline{}
	event := preview.Event
	if event == "" {
		event = "COMMENT"
	}
	for _, item := range preview.Items {
		if item.Kind == domain.CommentGeneral {
			body = append(body, item.Body)
		} else if item.Line != nil {
			comments = append(comments, inline{item.Path, *item.Line, item.Side, item.Body})
		}
	}
	payload, _ := json.Marshal(struct {
		CommitID string   `json:"commit_id"`
		Body     string   `json:"body"`
		Event    string   `json:"event"`
		Comments []inline `json:"comments,omitempty"`
	}{preview.HeadSHA, strings.Join(body, "\n\n"), event, comments})
	return payload
}
func writeDiff(builder *strings.Builder, file domain.DiffFile) {
	builder.WriteString("diff --git a/" + file.File.Path + " b/" + file.File.Path + "\n")
	for _, h := range file.Hunks {
		builder.WriteString(h.Header + "\n")
		for _, line := range h.Lines {
			prefix := " "
			if line.Kind == domain.DiffAdd {
				prefix = "+"
			} else if line.Kind == domain.DiffDelete {
				prefix = "-"
			} else if line.Kind == domain.DiffNoNewline {
				prefix = "\\"
			}
			builder.WriteString(prefix + line.Content + "\n")
		}
	}
}

func existingDiscussion(pr domain.PullRequest) string {
	var out strings.Builder
	for _, review := range pr.Reviews {
		fmt.Fprintf(&out, "Review by @%s [%s]: %s\n", review.Author.Login, review.State, strings.TrimSpace(review.Body))
	}
	for _, comment := range pr.ReviewComments {
		line := comment.Line
		if line == nil {
			line = comment.OriginalLine
		}
		location := comment.Path
		if line != nil {
			location += fmt.Sprintf(":%d", *line)
		}
		fmt.Fprintf(&out, "Inline comment by @%s on %s: %s\n", comment.Author.Login, location, strings.TrimSpace(comment.Body))
	}
	return out.String()
}
func highestRisk(risks []domain.ReviewRisk) domain.RiskLevel {
	rank := map[domain.RiskLevel]int{domain.RiskUnknown: 0, domain.RiskLow: 1, domain.RiskMedium: 2, domain.RiskHigh: 3, domain.RiskCritical: 4}
	result := domain.RiskUnknown
	for _, risk := range risks {
		if rank[risk.Level] > rank[result] {
			result = risk.Level
		}
	}
	return result
}

func analysisStatusAfterCancellation(session domain.ReviewSession) domain.AnalysisStatus {
	if session.Analysis == nil {
		return domain.AnalysisNotStarted
	}
	if session.IsStale {
		return domain.AnalysisStale
	}
	return domain.AnalysisReady
}

func analysisWasCancelled(ctx context.Context, err error) bool {
	return errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled)
}

func sortInbox(items []domain.PullRequestSummary) {
	sort.SliceStable(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
}

func newID() string {
	value := make([]byte, 16)
	_, _ = rand.Read(value)
	return hex.EncodeToString(value)
}
func safeMessage(err error) string {
	if err == nil {
		return "Operation failed"
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 300 {
		message = message[:300]
	}
	return message
}

func normalizeSession(session domain.ReviewSession) domain.ReviewSession {
	if session.PullRequest.Relationships == nil {
		session.PullRequest.Relationships = []domain.Relationship{}
	}
	if session.PullRequest.Labels == nil {
		session.PullRequest.Labels = []string{}
	}
	if session.PullRequest.Commits == nil {
		session.PullRequest.Commits = []domain.Commit{}
	}
	if session.PullRequest.RequestedReviewers == nil {
		session.PullRequest.RequestedReviewers = []domain.GitHubUser{}
	}
	if session.PullRequest.Assignees == nil {
		session.PullRequest.Assignees = []domain.GitHubUser{}
	}
	if session.PullRequest.Reviews == nil {
		session.PullRequest.Reviews = []domain.PullRequestReview{}
	}
	if session.PullRequest.ReviewComments == nil {
		session.PullRequest.ReviewComments = []domain.PullRequestReviewComment{}
	}
	if session.PullRequest.CheckRuns == nil {
		session.PullRequest.CheckRuns = []domain.CheckRun{}
	}
	if session.Chapters == nil {
		session.Chapters = []domain.ChapterProgress{}
	}
	if session.Notes == nil {
		session.Notes = []domain.ReviewNote{}
	}
	if session.Comments == nil {
		session.Comments = []domain.ReviewComment{}
	}
	if session.Analysis == nil {
		return session
	}
	if session.AnalysisStatus == domain.AnalysisNotStarted {
		session.AnalysisStatus = analysisStatusAfterCancellation(session)
	}
	a := session.Analysis
	if a.SummaryEvidence == nil {
		a.SummaryEvidence = []domain.EvidenceReference{}
	}
	if a.SummaryValidation == "" {
		a.SummaryValidation = domain.ValidationUnverified
		a.SummaryMessage = "summary predates evidence validation"
	}
	if a.AffectedAreas == nil {
		a.AffectedAreas = []domain.AffectedArea{}
	}
	if a.Chapters == nil {
		a.Chapters = []domain.ReviewChapter{}
	}
	if a.BehavioralChanges == nil {
		a.BehavioralChanges = []domain.BehavioralChange{}
	}
	if a.Risks == nil {
		a.Risks = []domain.ReviewRisk{}
	}
	if a.Facts == nil {
		a.Facts = []domain.Claim{}
	}
	if a.Inferences == nil {
		a.Inferences = []domain.Claim{}
	}
	if a.Unknowns == nil {
		a.Unknowns = []domain.Claim{}
	}
	if a.ValidationIssues == nil {
		a.ValidationIssues = []domain.ValidationIssue{}
	}
	for i := range a.Chapters {
		c := &a.Chapters[i]
		if c.Evidence == nil {
			c.Evidence = []domain.EvidenceReference{}
		}
		if c.Files == nil {
			c.Files = []domain.FileReference{}
		}
		if c.Symbols == nil {
			c.Symbols = []domain.SymbolReference{}
		}
		if c.BehavioralChanges == nil {
			c.BehavioralChanges = []domain.BehavioralChange{}
		}
		if c.Risks == nil {
			c.Risks = []domain.ReviewRisk{}
		}
		if c.Facts == nil {
			c.Facts = []domain.Claim{}
		}
		if c.Inferences == nil {
			c.Inferences = []domain.Claim{}
		}
		if c.Unknowns == nil {
			c.Unknowns = []domain.Claim{}
		}
		if c.RelatedTests == nil {
			c.RelatedTests = []domain.TestReference{}
		}
		if c.SuggestedQuestions == nil {
			c.SuggestedQuestions = []domain.SuggestedQuestion{}
		}
	}
	return session
}
