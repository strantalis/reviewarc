package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"reviewarc/internal/agent"
	"reviewarc/internal/agent/claude"
	"reviewarc/internal/agent/codex"
	sharedanalysis "reviewarc/internal/analysis"
	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/analysiscontext"
	"reviewarc/internal/appdata"
	cleanupservice "reviewarc/internal/cleanup"
	"reviewarc/internal/dependencies"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	githubclient "reviewarc/internal/github"
	"reviewarc/internal/persistence"
	proc "reviewarc/internal/process"
	"reviewarc/internal/update"
)

type AccountState struct {
	Status  string             `json:"status"`
	User    *domain.GitHubUser `json:"user,omitempty"`
	Message string             `json:"message,omitempty"`
}
type SourceState struct {
	Organizations     []domain.Organization    `json:"organizations"`
	Repositories      []domain.Repository      `json:"repositories"`
	Selections        []domain.SourceSelection `json:"selections"`
	OrganizationError string                   `json:"organizationError,omitempty"`
}
type RepositoryPage struct {
	Items           []domain.Repository `json:"items"`
	TotalCount      int                 `json:"totalCount"`
	EndCursor       string              `json:"endCursor,omitempty"`
	HasNextPage     bool                `json:"hasNextPage"`
	Cached          bool                `json:"cached"`
	RefreshRequired bool                `json:"refreshRequired,omitempty"`
	LastSyncedAt    string              `json:"lastSyncedAt,omitempty"`
}
type RepositoryPageInput struct {
	Owner  string `json:"owner"`
	Cursor string `json:"cursor"`
}
type RepositorySearchInput struct {
	Owner        string `json:"owner"`
	Query        string `json:"query"`
	Cursor       string `json:"cursor"`
	Organization bool   `json:"organization"`
}
type AccessibleRepositorySearchInput struct {
	Account string `json:"account"`
	Query   string `json:"query"`
	Offset  int    `json:"offset"`
}
type AccessibleRepositoryRefreshInput struct {
	Account string `json:"account"`
	SyncID  string `json:"syncId"`
	Cursor  string `json:"cursor"`
}
type AccessibleRepositoryRefresh struct {
	SyncID      string `json:"syncId"`
	Processed   int    `json:"processed"`
	TotalCount  int    `json:"totalCount"`
	EndCursor   string `json:"endCursor,omitempty"`
	HasNextPage bool   `json:"hasNextPage"`
	CompletedAt string `json:"completedAt,omitempty"`
}
type SelectedRepositoryRefresh struct {
	Repositories []domain.Repository `json:"repositories"`
	ArchivedKeys []string            `json:"archivedKeys"`
	Errors       map[string]string   `json:"errors"`
}
type InboxState struct {
	Items   []domain.PullRequestSummary `json:"items"`
	Errors  map[string]string           `json:"errors"`
	Partial bool                        `json:"partial"`
}
type Operation struct {
	ID        string                  `json:"id"`
	SessionID string                  `json:"sessionId,omitempty"`
	Kind      string                  `json:"kind"`
	Stage     string                  `json:"stage"`
	State     string                  `json:"state"`
	Message   string                  `json:"message"`
	Progress  *float64                `json:"progress,omitempty"`
	RunID     string                  `json:"runId,omitempty"`
	Failure   *domain.AnalysisFailure `json:"failure,omitempty"`
	UpdatedAt time.Time               `json:"updatedAt"`
}
type OperationSnapshot struct {
	Operation Operation   `json:"operation"`
	Events    []Operation `json:"events"`
}
type InboxAnalysis struct {
	Session   domain.ReviewSession `json:"session"`
	Operation Operation            `json:"operation"`
}
type AnalysisRequest struct {
	Profile       *domain.AnalysisProfile `json:"profile,omitempty"`
	SaveAsDefault bool                    `json:"saveAsDefault"`
}

const analysisPromptVersion = 3

type AnalysisConfiguration struct {
	DefaultProfile *domain.AnalysisProfile `json:"defaultProfile,omitempty"`
	Harnesses      []HarnessDescriptor     `json:"harnesses"`
	RefreshedAt    time.Time               `json:"refreshedAt"`
}
type HarnessDescriptor struct {
	ID           domain.HarnessID         `json:"id"`
	Label        string                   `json:"label"`
	Availability domain.HarnessState      `json:"availability"`
	Path         string                   `json:"path,omitempty"`
	Version      string                   `json:"version,omitempty"`
	Message      string                   `json:"message,omitempty"`
	Eligible     bool                     `json:"eligible"`
	Capabilities HarnessCapabilitySummary `json:"capabilities"`
	Models       []HarnessModelDescriptor `json:"models"`
	CustomModel  *HarnessModelDescriptor  `json:"customModel,omitempty"`
}
type HarnessCapabilitySummary struct {
	JSONSchema       bool                      `json:"jsonSchema"`
	ReadOnly         bool                      `json:"readOnly"`
	Progress         bool                      `json:"progress"`
	ContextTransport []domain.ContextTransport `json:"contextTransport"`
}
type HarnessModelDescriptor struct {
	ID              string                     `json:"id"`
	Label           string                     `json:"label"`
	ReasoningLevels []ReasoningLevelDescriptor `json:"reasoningLevels"`
	Recommended     bool                       `json:"recommended"`
}
type ReasoningLevelDescriptor struct {
	ID          domain.ReasoningLevel `json:"id"`
	Label       string                `json:"label"`
	Recommended bool                  `json:"recommended"`
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
	StartLine *int               `json:"startLine"`
	StartSide domain.DiffSide    `json:"startSide"`
	Line      *int               `json:"line"`
	Side      domain.DiffSide    `json:"side"`
}
type preparedState struct {
	repository gitcache.ManagedRepository
	files      []domain.ChangedFile
}
type analysisPlan struct {
	adapter   agent.HarnessAdapter
	profile   domain.AnalysisProfile
	transport domain.ContextTransport
	runID     string
}

const (
	environmentSnapshotSetting = "environment_snapshot_v1"
	accessibleCatalogSetting   = "accessible_repository_catalog_v1"
	accessibleCatalogMaxAge    = 30 * time.Minute
)

type accessibleCatalogSnapshot struct {
	LastSyncedAt time.Time `json:"lastSyncedAt"`
}

type App struct {
	ctx               context.Context
	mu                sync.RWMutex
	environmentMu     sync.Mutex
	paths             domain.AppPaths
	detector          *dependencies.Detector
	github            *githubclient.Client
	store             *persistence.Store
	repos             *gitcache.Manager
	runner            proc.Runner
	harnesses         *agent.Registry
	prepared          *preparedReviewCache
	active            map[string]context.CancelFunc
	analysisBySession map[string]string
	operationHistory  map[string][]Operation
	analysisWake      chan struct{}
	activeBundles     map[string]struct{}
	cleanupScheduler  *cleanupservice.Scheduler
	schedulerCancel   context.CancelFunc
	schedulerWG       sync.WaitGroup
	publish           map[string]pendingPublish
	threadReplies     map[string]pendingThreadReply
	gitProtocol       func() string
	updater           *update.Service
	updateCancel      context.CancelFunc
	accessibleMu      sync.Mutex
	accessibleSyncID  string
	accessibleAccount string
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
	registry, err := agent.NewRegistry(codex.New(runner, codex.Config{}), claude.New(runner, claude.Config{}))
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	app := &App{paths: paths, detector: dependencies.New(runner), github: githubclient.New(runner), store: store, repos: gitcache.NewManager(paths.Repositories, paths.Worktrees, runner, gitcache.Options{RemoteURL: remoteURL}), runner: runner, harnesses: registry, prepared: newPreparedReviewCache(0, 0, 0), active: map[string]context.CancelFunc{}, analysisBySession: map[string]string{}, operationHistory: map[string][]Operation{}, analysisWake: make(chan struct{}, 2), activeBundles: map[string]struct{}{}, publish: map[string]pendingPublish{}, threadReplies: map[string]pendingThreadReply{}, gitProtocol: gitProtocol}
	app.cleanupScheduler, err = cleanupservice.NewScheduler(cleanupservice.JobFunc(app.runArchiveCleanup), cleanupservice.SchedulerOptions{Interval: archiveCleanupInterval})
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	app.configureUpdater()
	return app, nil
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
func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	if a.schedulerCancel == nil && a.analysisWake != nil {
		var schedulerCtx context.Context
		schedulerCtx, a.schedulerCancel = context.WithCancel(ctx)
		for range 2 {
			a.schedulerWG.Add(1)
			go a.analysisWorker(schedulerCtx)
		}
		a.schedulerWG.Add(1)
		go a.archiveCleanupLoop(schedulerCtx)
	}
	a.mu.Unlock()
	a.wakeAnalysisWorkers()
}
func (a *App) domReady(ctx context.Context) {
	configureNativeWindowChrome(ctx)
	configureNativeApplicationMenu(ctx)
	if shouldNavigateToEmbeddedFrontend(runtime.Environment(ctx).BuildType) {
		runtime.WindowExecJS(ctx, frontendRevisionScript(frontendRevision))
	}
	if a.updater == nil {
		return
	}
	a.mu.Lock()
	if a.updateCancel != nil {
		a.mu.Unlock()
		return
	}
	updateCtx, cancel := context.WithCancel(ctx)
	a.updateCancel = cancel
	a.mu.Unlock()
	_ = a.updater.Start(updateCtx)
}

func shouldNavigateToEmbeddedFrontend(buildType string) bool { return buildType != "dev" }

func frontendRevisionScript(revision string) string {
	return fmt.Sprintf(`(() => { const path = %q; if (window.location.pathname !== path) window.location.replace("wails://wails" + path); })();`, "/__frontend/"+revision+"/")
}
func (a *App) shutdown(context.Context) {
	a.mu.Lock()
	cancel := a.updateCancel
	a.updateCancel = nil
	schedulerCancel := a.schedulerCancel
	a.schedulerCancel = nil
	active := make([]context.CancelFunc, 0, len(a.active))
	for _, stop := range a.active {
		active = append(active, stop)
	}
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if schedulerCancel != nil {
		schedulerCancel()
	}
	for _, stop := range active {
		stop()
	}
	a.schedulerWG.Wait()
	_ = a.store.Close()
}
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
	if repositories, err := a.store.ListSelectedRepositories(ctx); err == nil {
		selections = activeSourceSelections(selections, repositories)
	}
	if selections == nil {
		selections = []domain.SourceSelection{}
	}
	inbox, _ := a.store.ListPullRequestSummaries(ctx)
	for i := range inbox {
		item := &inbox[i]
		if item.Relationships == nil {
			item.Relationships = []domain.Relationship{}
		}
		if item.Labels == nil {
			item.Labels = []string{}
		}
	}
	sortInbox(inbox)
	environment, cached := a.cachedEnvironment(ctx)
	if !cached {
		environment = a.refreshEnvironment(ctx)
		_ = a.store.SetSetting(ctx, environmentSnapshotSetting, environment)
	}
	return domain.BootstrapState{
		Dependencies:      environment.Dependencies,
		Paths:             a.paths,
		Selections:        selections,
		Inbox:             inbox,
		GitProtocol:       environment.GitProtocol,
		Account:           environment.Account,
		EnvironmentCached: cached,
	}
}

func bundledThirdPartyNoticesPath(executablePath string) string {
	return filepath.Clean(filepath.Join(filepath.Dir(executablePath), "..", "Resources", "ThirdPartyNotices.txt"))
}

func (a *App) OpenThirdPartyNotices() error {
	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate ReviewArc executable: %w", err)
	}
	noticePath := bundledThirdPartyNoticesPath(executablePath)
	info, err := os.Stat(noticePath)
	if err != nil {
		return fmt.Errorf("locate bundled third-party notices: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("bundled third-party notices are not a regular file: %s", noticePath)
	}
	if err := exec.CommandContext(a.appContext(), "/usr/bin/open", noticePath).Run(); err != nil {
		return fmt.Errorf("open bundled third-party notices: %w", err)
	}
	return nil
}

func (a *App) cachedEnvironment(ctx context.Context) (domain.EnvironmentState, bool) {
	var state domain.EnvironmentState
	if err := a.store.GetSetting(ctx, environmentSnapshotSetting, &state); err != nil || !validEnvironmentState(state) {
		return domain.EnvironmentState{}, false
	}
	return state, true
}

func validEnvironmentState(state domain.EnvironmentState) bool {
	if state.RefreshedAt.IsZero() || (state.GitProtocol != "https" && state.GitProtocol != "ssh") || len(state.Dependencies) != 3 {
		return false
	}
	want := map[domain.DependencyName]bool{domain.DependencyGit: true, domain.DependencyGH: true, domain.DependencyCodex: true}
	seen := map[domain.DependencyName]bool{}
	for _, dependency := range state.Dependencies {
		if !want[dependency.Name] || seen[dependency.Name] {
			return false
		}
		switch dependency.State {
		case domain.DependencyAvailable, domain.DependencyMissing, domain.DependencyBroken:
		default:
			return false
		}
		seen[dependency.Name] = true
	}
	return state.Account == nil || strings.TrimSpace(state.Account.Login) != ""
}

func (a *App) RefreshEnvironment() (domain.EnvironmentState, error) {
	a.environmentMu.Lock()
	defer a.environmentMu.Unlock()
	ctx := a.appContext()
	state := a.refreshEnvironment(ctx)
	if err := a.store.SetSetting(ctx, environmentSnapshotSetting, state); err != nil {
		return domain.EnvironmentState{}, fmt.Errorf("save environment snapshot: %w", err)
	}
	return state, nil
}

func (a *App) refreshEnvironment(ctx context.Context) domain.EnvironmentState {
	a.detector.RefreshPaths()
	var dependencyState []domain.DependencyStatus
	protocol := "https"
	var account *domain.GitHubUser
	var environment sync.WaitGroup
	environment.Add(3)
	go func() {
		defer environment.Done()
		dependencyState = a.detector.DetectCurrent(ctx)
	}()
	go func() {
		defer environment.Done()
		if a.gitProtocol != nil {
			protocol = a.gitProtocol()
		}
	}()
	go func() {
		defer environment.Done()
		if user, err := a.github.CurrentUser(ctx); err == nil {
			account = &user
		}
	}()
	environment.Wait()
	return domain.EnvironmentState{Dependencies: dependencyState, GitProtocol: protocol, Account: account, RefreshedAt: time.Now().UTC()}
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
	organizationError := ""
	orgs, err := a.github.ListOrganizations(ctx)
	if err != nil {
		var auth *githubclient.AuthError
		if errors.As(err, &auth) {
			organizationError = auth.Message
		} else {
			organizationError = "GitHub organizations could not be loaded. Try again in a moment."
		}
		orgs = []domain.Organization{}
	}
	for i := range orgs {
		orgs[i].AccessStatus = githubclient.OrganizationAccessUnknown
	}
	selections, err := a.store.ListSelections(ctx)
	if err != nil {
		return SourceState{}, err
	}
	cached, err := a.store.ListRepositories(ctx)
	if err != nil {
		return SourceState{}, err
	}
	repos := explicitlySelectedRepositories(cached, selections)
	if orgs == nil {
		orgs = []domain.Organization{}
	}
	if repos == nil {
		repos = []domain.Repository{}
	}
	if selections == nil {
		selections = []domain.SourceSelection{}
	}
	return SourceState{Organizations: orgs, Repositories: repos, Selections: selections, OrganizationError: organizationError}, nil
}
func (a *App) RefreshSourceAccess(organizations []domain.Organization) []domain.Organization {
	return a.github.CheckOrganizationAccess(a.appContext(), organizations)
}
func (a *App) RefreshSelectedRepositories() (SelectedRepositoryRefresh, error) {
	ctx := a.appContext()
	selections, err := a.store.ListSelections(ctx)
	if err != nil {
		return SelectedRepositoryRefresh{}, err
	}
	repositories, archived, refreshErrors := a.refreshExplicitRepositories(ctx, selections)
	return SelectedRepositoryRefresh{Repositories: repositories, ArchivedKeys: archived, Errors: refreshErrors}, nil
}
func (a *App) ListAccessibleRepositories(input AccessibleRepositorySearchInput) (RepositoryPage, error) {
	input.Account = strings.TrimSpace(input.Account)
	input.Query = strings.TrimSpace(input.Query)
	if !validSourceOwner(input.Account) || len(input.Query) > 256 || input.Offset < 0 {
		return RepositoryPage{}, errors.New("invalid accessible repository search")
	}
	items, total, err := a.store.SearchAccessibleRepositories(a.appContext(), input.Account, input.Query, input.Offset, 50)
	if err != nil {
		return RepositoryPage{}, err
	}
	page := RepositoryPage{Items: items, TotalCount: total, HasNextPage: input.Offset+len(items) < total, Cached: true}
	var snapshot accessibleCatalogSnapshot
	settingKey := accessibleCatalogSetting + ":" + strings.ToLower(input.Account)
	if err := a.store.GetSetting(a.appContext(), settingKey, &snapshot); err != nil {
		if !errors.Is(err, persistence.ErrNotFound) {
			return RepositoryPage{}, err
		}
		page.RefreshRequired = true
		return page, nil
	}
	if snapshot.LastSyncedAt.IsZero() {
		page.RefreshRequired = true
		return page, nil
	}
	page.LastSyncedAt = snapshot.LastSyncedAt.UTC().Format(time.RFC3339)
	page.RefreshRequired = time.Since(snapshot.LastSyncedAt) > accessibleCatalogMaxAge
	return page, nil
}
func (a *App) RefreshAccessibleRepositories(input AccessibleRepositoryRefreshInput) (AccessibleRepositoryRefresh, error) {
	input.Account = strings.TrimSpace(input.Account)
	if !validSourceOwner(input.Account) {
		return AccessibleRepositoryRefresh{}, errors.New("invalid accessible repository refresh")
	}
	if input.SyncID == "" {
		if input.Cursor != "" {
			return AccessibleRepositoryRefresh{}, errors.New("invalid accessible repository refresh")
		}
		user, err := a.github.CurrentUser(a.appContext())
		if err != nil {
			return AccessibleRepositoryRefresh{}, err
		}
		if !strings.EqualFold(user.Login, input.Account) {
			return AccessibleRepositoryRefresh{}, errors.New("authenticated GitHub account changed during repository refresh")
		}
		input.SyncID = newID()
		a.accessibleMu.Lock()
		a.accessibleSyncID = input.SyncID
		a.accessibleAccount = input.Account
		a.accessibleMu.Unlock()
	} else if !validSyncID(input.SyncID) {
		return AccessibleRepositoryRefresh{}, errors.New("invalid accessible repository refresh")
	}
	a.accessibleMu.Lock()
	active := a.accessibleSyncID == input.SyncID && strings.EqualFold(a.accessibleAccount, input.Account)
	a.accessibleMu.Unlock()
	if !active {
		return AccessibleRepositoryRefresh{}, errors.New("accessible repository refresh was replaced")
	}
	page, err := a.github.ListAccessibleRepositoriesPage(a.appContext(), githubclient.AccessibleRepositoryPageQuery{Cursor: input.Cursor, PageSize: 100})
	if err != nil {
		a.accessibleMu.Lock()
		if a.accessibleSyncID == input.SyncID {
			a.accessibleSyncID = ""
			a.accessibleAccount = ""
		}
		a.accessibleMu.Unlock()
		return AccessibleRepositoryRefresh{}, err
	}
	if page.HasNextPage && page.EndCursor == "" {
		a.accessibleMu.Lock()
		if a.accessibleSyncID == input.SyncID {
			a.accessibleSyncID = ""
			a.accessibleAccount = ""
		}
		a.accessibleMu.Unlock()
		return AccessibleRepositoryRefresh{}, errors.New("GitHub returned an incomplete repository cursor")
	}
	a.accessibleMu.Lock()
	defer a.accessibleMu.Unlock()
	if a.accessibleSyncID != input.SyncID {
		return AccessibleRepositoryRefresh{}, errors.New("accessible repository refresh was replaced")
	}
	if err := a.store.UpsertAccessibleRepositories(a.appContext(), page.Items, input.Account, input.SyncID); err != nil {
		a.accessibleSyncID = ""
		a.accessibleAccount = ""
		return AccessibleRepositoryRefresh{}, err
	}
	result := AccessibleRepositoryRefresh{SyncID: input.SyncID, Processed: len(page.Items), TotalCount: page.TotalCount, EndCursor: page.EndCursor, HasNextPage: page.HasNextPage}
	if !page.HasNextPage {
		if err := a.store.CompleteAccessibleRepositorySync(a.appContext(), input.Account, input.SyncID); err != nil {
			a.accessibleSyncID = ""
			a.accessibleAccount = ""
			return AccessibleRepositoryRefresh{}, err
		}
		completedAt := time.Now().UTC()
		settingKey := accessibleCatalogSetting + ":" + strings.ToLower(input.Account)
		if err := a.store.SetSetting(a.appContext(), settingKey, accessibleCatalogSnapshot{LastSyncedAt: completedAt}); err != nil {
			a.accessibleSyncID = ""
			a.accessibleAccount = ""
			return AccessibleRepositoryRefresh{}, err
		}
		result.CompletedAt = completedAt.Format(time.RFC3339)
		a.accessibleSyncID = ""
		a.accessibleAccount = ""
	}
	return result, nil
}
func (a *App) ListCachedOwnerRepositories(owner string) (RepositoryPage, error) {
	if !validSourceOwner(owner) {
		return RepositoryPage{}, errors.New("invalid repository owner")
	}
	items, err := a.store.ListRepositoriesByOwner(a.appContext(), owner, 50)
	if err != nil {
		return RepositoryPage{}, err
	}
	if items == nil {
		items = []domain.Repository{}
	}
	return RepositoryPage{Items: items, TotalCount: len(items), Cached: true}, nil
}
func (a *App) RefreshOwnerRepositories(input RepositoryPageInput) (RepositoryPage, error) {
	page, err := a.github.ListOwnerRepositories(a.appContext(), githubclient.RepositoryPageQuery{Owner: input.Owner, Cursor: input.Cursor, PageSize: 50})
	if err != nil {
		return RepositoryPage{}, err
	}
	if err := a.store.UpsertRepositories(a.appContext(), page.Items); err != nil {
		return RepositoryPage{}, err
	}
	return RepositoryPage{Items: page.Items, TotalCount: page.TotalCount, EndCursor: page.EndCursor, HasNextPage: page.HasNextPage}, nil
}
func (a *App) SearchOwnerRepositories(input RepositorySearchInput) (RepositoryPage, error) {
	page, err := a.github.SearchOwnerRepositories(a.appContext(), githubclient.RepositorySearchQuery{Owner: input.Owner, Query: input.Query, Cursor: input.Cursor, PageSize: 50, Organization: input.Organization})
	if err != nil {
		return RepositoryPage{}, err
	}
	if err := a.store.UpsertRepositories(a.appContext(), page.Items); err != nil {
		return RepositoryPage{}, err
	}
	return RepositoryPage{Items: page.Items, TotalCount: page.TotalCount, EndCursor: page.EndCursor, HasNextPage: page.HasNextPage}, nil
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
	selections, err := a.store.ListSelections(ctx)
	if err != nil {
		return InboxState{}, err
	}
	selectedRepositories, _, repositoryErrors := a.refreshExplicitRepositories(ctx, selections)
	selected := make([]domain.RepositoryRef, 0, len(selectedRepositories))
	for _, repository := range selectedRepositories {
		selected = append(selected, repository.Ref)
	}
	organizations := selectedOrganizations(selections)
	result := a.github.ListPullRequests(ctx, githubclient.PullRequestQuery{Repositories: selected, Organizations: organizations, CurrentLogin: account.User.Login})
	for key, message := range repositoryErrors {
		result.Errors[key] = message
		result.Partial = true
	}
	if _, err := a.store.RefreshInboxPullRequests(ctx, result.Items); err != nil {
		return InboxState{}, err
	}
	local, err := a.store.ListPullRequestSummaries(ctx)
	if err != nil {
		return InboxState{}, err
	}
	result.Items = mergeInboxReviewState(activeRemotePullRequests(result.Items, local), local)
	return InboxState{Items: result.Items, Errors: result.Errors, Partial: result.Partial}, nil
}

func (a *App) refreshExplicitRepositories(ctx context.Context, selections []domain.SourceSelection) ([]domain.Repository, []string, map[string]string) {
	repositories := []domain.Repository{}
	archived := []string{}
	refreshErrors := map[string]string{}
	seen := map[string]bool{}
	all := []domain.Repository{}
	type refreshTask struct {
		selection domain.SourceSelection
		ref       domain.RepositoryRef
	}
	type refreshResult struct {
		repository domain.Repository
		err        error
	}
	tasks := []refreshTask{}
	for _, selection := range selections {
		if !selection.Enabled || selection.Kind != domain.SelectionRepository {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(selection.Key))
		if seen[key] {
			continue
		}
		seen[key] = true
		owner, name, found := strings.Cut(selection.Key, "/")
		if !found || !validSourceOwner(owner) || !validSourceRepositoryName(name) {
			refreshErrors["repository:"+selection.Key] = "Invalid repository selection"
			continue
		}
		tasks = append(tasks, refreshTask{selection: selection, ref: domain.RepositoryRef{Host: "github.com", Owner: owner, Name: name}})
	}
	results := make([]refreshResult, len(tasks))
	var wg sync.WaitGroup
	workers := make(chan struct{}, 4)
	for index := range tasks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			workers <- struct{}{}
			defer func() { <-workers }()
			results[index].repository, results[index].err = a.github.GetRepository(ctx, tasks[index].ref)
		}()
	}
	wg.Wait()
	for index, result := range results {
		selection := tasks[index].selection
		if result.err != nil {
			refreshErrors["repository:"+selection.Key] = safeMessage(result.err)
			continue
		}
		repository := result.repository
		all = append(all, repository)
		if repository.IsArchived {
			archived = append(archived, selection.Key)
			continue
		}
		repositories = append(repositories, repository)
	}
	if len(all) > 0 {
		if err := a.store.UpsertRepositories(ctx, all); err != nil {
			refreshErrors["persistence"] = safeMessage(err)
		}
	}
	if len(archived) > 0 {
		if err := a.store.RemoveRepositorySelections(ctx, archived); err != nil {
			refreshErrors["persistence"] = safeMessage(err)
		}
	}
	return repositories, archived, refreshErrors
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
	detail, err := a.github.GetPullRequestCore(ctx, ref)
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
	revisionChanged := false
	if err != nil {
		now := time.Now().UTC()
		session = domain.ReviewSession{ID: newID(), PullRequest: pr, BaseSHA: pr.BaseSHA, HeadSHA: pr.HeadSHA, Status: domain.SessionPreparing, AnalysisStatus: domain.AnalysisNotStarted, CreatedAt: now, UpdatedAt: now}
		if err := a.store.SaveSession(ctx, session); err != nil {
			return domain.ReviewSession{}, err
		}
	} else if session.HeadSHA != pr.HeadSHA || session.BaseSHA != pr.BaseSHA {
		revisionChanged = true
		session.PullRequest, session.BaseSHA, session.HeadSHA = pr, pr.BaseSHA, pr.HeadSHA
		session.IsStale, session.AnalysisStatus, session.Status = true, domain.AnalysisStale, domain.SessionPreparing
		session.StaleReason = "Pull request revisions changed; existing notes, drafts, and progress were preserved."
		session.UpdatedAt = time.Now().UTC()
		if err := a.store.SaveSession(ctx, session); err != nil {
			return domain.ReviewSession{}, err
		}
	}
	session.PullRequest = pr
	session = normalizeSession(session)
	session.UpdatedAt = time.Now().UTC()
	if revisionChanged {
		a.mu.Lock()
		if err := a.store.SaveSession(ctx, session); err != nil {
			a.mu.Unlock()
			return domain.ReviewSession{}, err
		}
		a.prepared.Delete(session.ID)
		a.mu.Unlock()
	} else if err := a.store.SaveSession(ctx, session); err != nil {
		return domain.ReviewSession{}, err
	}
	return a.GetSession(session.ID)
}
func (a *App) RefreshPullRequestContext(sessionID string) (domain.ReviewSession, error) {
	return a.refreshPullRequestContext(a.appContext(), sessionID)
}
func (a *App) refreshPullRequestContext(ctx context.Context, sessionID string) (domain.ReviewSession, error) {
	session, err := a.store.GetSession(ctx, sessionID)
	if err != nil {
		return domain.ReviewSession{}, err
	}
	pullRequestContext, err := a.github.GetPullRequestContext(ctx, session.PullRequest.Ref, session.PullRequest.HeadSHA)
	if err != nil {
		return domain.ReviewSession{}, err
	}
	current, err := a.store.GetSession(ctx, sessionID)
	if err != nil {
		return domain.ReviewSession{}, err
	}
	if current.PullRequest.Ref.Number != session.PullRequest.Ref.Number ||
		!strings.EqualFold(current.PullRequest.Ref.Repository.Host, session.PullRequest.Ref.Repository.Host) ||
		!strings.EqualFold(current.PullRequest.Ref.Repository.Owner, session.PullRequest.Ref.Repository.Owner) ||
		!strings.EqualFold(current.PullRequest.Ref.Repository.Name, session.PullRequest.Ref.Repository.Name) ||
		current.PullRequest.HeadSHA != session.PullRequest.HeadSHA {
		return domain.ReviewSession{}, errors.New("pull request revision changed while loading discussion and checks")
	}
	current.PullRequest.Reviews = pullRequestContext.Reviews
	current.PullRequest.ReviewComments = pullRequestContext.ReviewComments
	current.PullRequest.CheckRuns = pullRequestContext.CheckRuns
	current.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveSession(ctx, current); err != nil {
		return domain.ReviewSession{}, err
	}
	return normalizeSession(current), nil
}
func (a *App) GetSession(id string) (domain.ReviewSession, error) {
	session, err := a.store.GetSession(a.appContext(), id)
	if err != nil {
		return session, err
	}
	return normalizeSession(session), nil
}
func (a *App) GetChangedFiles(sessionID string) ([]domain.ChangedFile, error) {
	state, err := a.preparedReviewState(sessionID)
	return state.files, err
}
func (a *App) GetDiff(sessionID, path string) (domain.DiffFile, error) {
	state, err := a.preparedReviewState(sessionID)
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
	state, _, err := a.preparedReviewRepository(sessionID)
	if err != nil {
		return domain.FileContent{}, err
	}
	return a.repos.ReadFile(a.appContext(), state.repository, revision, path)
}

func (a *App) preparedReviewState(sessionID string) (preparedState, error) {
	state, revisionChanged, err := a.preparedReviewRepository(sessionID)
	if err != nil || !revisionChanged {
		return state, err
	}
	files, err := a.repos.ChangedFiles(a.appContext(), state.repository)
	state.files = files
	return state, err
}

func (a *App) preparedReviewRepository(sessionID string) (preparedState, bool, error) {
	state, err := a.ensurePrepared(sessionID)
	if err != nil {
		return state, false, err
	}
	session, err := a.store.GetSession(a.appContext(), sessionID)
	if err != nil {
		return state, false, err
	}
	repository := analysisRepository(session, state.repository)
	revisionChanged := repository.BaseSHA != state.repository.BaseSHA || repository.HeadSHA != state.repository.HeadSHA
	state.repository = repository
	return state, revisionChanged, nil
}

func analysisRepository(session domain.ReviewSession, repository gitcache.ManagedRepository) gitcache.ManagedRepository {
	if !session.IsStale || session.Analysis == nil {
		return repository
	}
	if session.Analysis.BaseSHA != "" {
		repository.BaseSHA = session.Analysis.BaseSHA
	}
	if session.Analysis.HeadSHA != "" {
		repository.HeadSHA = session.Analysis.HeadSHA
	}
	return repository
}

func (a *App) GetAnalysisConfiguration() AnalysisConfiguration {
	return a.analysisConfiguration(false)
}

func (a *App) RefreshAnalysisHarnesses() AnalysisConfiguration {
	return a.analysisConfiguration(true)
}

func (a *App) analysisConfiguration(refresh bool) AnalysisConfiguration {
	if refresh {
		if refresher, ok := a.runner.(proc.PathRefresher); ok {
			refresher.RefreshPaths()
		}
	}
	capabilities := a.harnesses.Capabilities(a.appContext())
	configuration := AnalysisConfiguration{Harnesses: make([]HarnessDescriptor, 0, len(capabilities)), RefreshedAt: time.Now().UTC()}
	for _, capability := range capabilities {
		descriptor := HarnessDescriptor{
			ID: capability.ID, Label: capability.Name, Availability: capability.State,
			Version: capability.Version, Message: capability.Message,
			Eligible:     capability.State == domain.HarnessAvailable && capability.SupportsJSONSchema && capability.EnforcesReadOnly && capability.SupportsProgress && controlledTransport(capability.ContextTransports) != "",
			Capabilities: HarnessCapabilitySummary{JSONSchema: capability.SupportsJSONSchema, ReadOnly: capability.EnforcesReadOnly, Progress: capability.SupportsProgress, ContextTransport: append([]domain.ContextTransport(nil), capability.ContextTransports...)},
			Models:       make([]HarnessModelDescriptor, 0, len(capability.Models)),
		}
		if resolver, ok := a.runner.(proc.PathResolver); ok {
			tool := proc.Codex
			if capability.ID == domain.HarnessClaude {
				tool = proc.Claude
			}
			if path, err := resolver.ResolvedPath(tool); err == nil {
				descriptor.Path = path
			}
		}
		for _, model := range capability.Models {
			descriptor.Models = append(descriptor.Models, modelDescriptor(model))
		}
		if capability.CustomModel != nil {
			item := modelDescriptor(*capability.CustomModel)
			descriptor.CustomModel = &item
		}
		configuration.Harnesses = append(configuration.Harnesses, descriptor)
	}
	if profile, err := a.store.GetAnalysisProfile(a.appContext()); err == nil && profileSelectable(profile, configuration.Harnesses) {
		configuration.DefaultProfile = &profile
	}
	return configuration
}

func (a *App) SaveAnalysisDefaults(profile domain.AnalysisProfile) (AnalysisConfiguration, error) {
	_, resolved, _, err := a.harnesses.Resolve(a.appContext(), profile)
	if err != nil {
		return AnalysisConfiguration{}, err
	}
	if err := a.store.SaveAnalysisProfile(a.appContext(), resolved); err != nil {
		return AnalysisConfiguration{}, err
	}
	return a.analysisConfiguration(false), nil
}

func profileSelectable(profile domain.AnalysisProfile, harnesses []HarnessDescriptor) bool {
	for _, harness := range harnesses {
		if harness.ID != profile.Harness || !harness.Eligible {
			continue
		}
		for _, model := range harness.Models {
			if model.ID != profile.Model {
				continue
			}
			for _, level := range model.ReasoningLevels {
				if level.ID == profile.Reasoning {
					return true
				}
			}
		}
		if harness.CustomModel != nil && agent.IsValidCustomModelID(profile.Model) {
			for _, level := range harness.CustomModel.ReasoningLevels {
				if level.ID == profile.Reasoning {
					return true
				}
			}
		}
	}
	return false
}

func modelDescriptor(model domain.ModelCapability) HarnessModelDescriptor {
	item := HarnessModelDescriptor{ID: model.ID, Label: model.Name, Recommended: model.Recommended, ReasoningLevels: make([]ReasoningLevelDescriptor, 0, len(model.ReasoningLevels))}
	for _, level := range model.ReasoningLevels {
		item.ReasoningLevels = append(item.ReasoningLevels, ReasoningLevelDescriptor{ID: level, Label: reasoningLabel(level), Recommended: level == model.DefaultReasoningLevel})
	}
	return item
}

func reasoningLabel(level domain.ReasoningLevel) string {
	switch level {
	case domain.ReasoningLow:
		return "Low"
	case domain.ReasoningMedium:
		return "Medium"
	case domain.ReasoningHigh:
		return "High"
	case domain.ReasoningXHigh:
		return "Extra high"
	case domain.ReasoningMax:
		return "Maximum"
	default:
		return string(level)
	}
}

func controlledTransport(transports []domain.ContextTransport) domain.ContextTransport {
	for _, transport := range transports {
		if transport == domain.ContextReviewArcTools {
			return transport
		}
	}
	for _, transport := range transports {
		if transport == domain.ContextArtifactFiles {
			return transport
		}
	}
	return ""
}

func (a *App) StartAnalysis(sessionID string) (Operation, error) {
	profile, err := a.store.GetAnalysisProfile(a.appContext())
	if err != nil {
		return Operation{}, &agent.ResolutionError{Failure: domain.AnalysisFailure{Code: domain.FailureConfigurationRequired, Title: "AI analysis is not configured", Message: "Choose an installed analysis harness before starting the first analysis.", Action: domain.RetryConfigure}}
	}
	return a.startAnalysis(sessionID, AnalysisRequest{Profile: &profile})
}

func (a *App) StartAnalysisWithProfile(sessionID string, request AnalysisRequest) (Operation, error) {
	return a.startAnalysis(sessionID, request)
}

// QueueInboxAnalysis opens or refreshes the pull request session before
// enqueueing analysis with the saved default profile. It intentionally leaves
// navigation to the caller so inbox triage can continue in the foreground.
func (a *App) QueueInboxAnalysis(ref domain.PullRequestRef) (InboxAnalysis, error) {
	session, err := a.OpenPullRequest(ref)
	if err != nil {
		return InboxAnalysis{}, err
	}
	op, err := a.StartAnalysis(session.ID)
	if err != nil {
		return InboxAnalysis{}, err
	}
	session.AnalysisStatus = domain.AnalysisQueued
	return InboxAnalysis{Session: session, Operation: op}, nil
}

func (a *App) startAnalysis(sessionID string, request AnalysisRequest) (Operation, error) {
	session, err := a.store.GetSession(a.appContext(), sessionID)
	if err != nil {
		return Operation{}, err
	}
	var profile domain.AnalysisProfile
	if request.Profile != nil {
		profile = *request.Profile
	} else if profile, err = a.store.GetAnalysisProfile(a.appContext()); err != nil {
		return Operation{}, &agent.ResolutionError{Failure: domain.AnalysisFailure{Code: domain.FailureConfigurationRequired, Title: "AI analysis is not configured", Message: "Choose an installed analysis harness before starting the first analysis.", Action: domain.RetryConfigure}}
	}
	adapter, profile, capabilities, err := a.harnesses.Resolve(a.appContext(), profile)
	if err != nil {
		return Operation{}, err
	}
	transport := controlledTransport(capabilities.ContextTransports)
	fingerprint := analysisFingerprint(session, profile, capabilities.Version, transport)
	if unchangedOversizedRetryBlocked(session.LatestAnalysisRun, fingerprint) {
		return Operation{}, errors.New("input_too_large: ReviewArc will not repeat the unchanged oversized analysis request; change the profile or analysis plan")
	}
	if request.SaveAsDefault {
		if err := a.store.SaveAnalysisProfile(a.appContext(), profile); err != nil {
			return Operation{}, err
		}
	}
	runID := newID()
	queued := a.analysisWake != nil
	opID := newID()
	if queued {
		opID = runID
	}
	op := Operation{ID: opID, SessionID: sessionID, RunID: runID, Kind: "analysis", Stage: "loadingPullRequestContext", State: "running", Message: "Loading GitHub discussion and checks", UpdatedAt: time.Now().UTC()}
	ctx, cancel := context.WithCancel(a.appContext())
	a.mu.Lock()
	if _, exists := a.analysisBySession[sessionID]; exists {
		a.mu.Unlock()
		cancel()
		return Operation{}, errors.New("analysis is already running for this session")
	}
	a.analysisBySession[sessionID] = op.ID
	if !queued {
		a.active[op.ID] = cancel
	}
	a.mu.Unlock()
	if queued {
		op.Stage = "queued"
		op.State = "queued"
		op.Message = "Waiting for an analysis worker"
	}
	runStatus := domain.AnalysisRunPreparing
	if queued {
		runStatus = domain.AnalysisRunQueued
	}
	run := domain.AnalysisRun{ID: runID, SessionID: sessionID, Profile: profile, HarnessVersion: capabilities.Version, ContextTransport: transport, SchemaVersion: sharedanalysis.SchemaVersion, InputFingerprint: fingerprint, Coverage: domain.AnalysisCoverage{OmittedPaths: []string{}, Accesses: []domain.ContextAccess{}}, Status: runStatus}
	if err := a.store.StartAnalysisRun(a.appContext(), run); err != nil {
		cancel()
		a.mu.Lock()
		delete(a.active, op.ID)
		delete(a.analysisBySession, sessionID)
		a.mu.Unlock()
		return Operation{}, err
	}
	a.emitOperation(op)
	if queued {
		cancel()
		a.wakeAnalysisWorkers()
		return op, nil
	}
	go func() {
		defer cancel()
		a.prepareAndRunAnalysis(ctx, op, session, analysisPlan{adapter: adapter, profile: profile, transport: transport, runID: runID})
	}()
	return op, nil
}

func (a *App) wakeAnalysisWorkers() {
	for range 2 {
		select {
		case a.analysisWake <- struct{}{}:
		default:
			return
		}
	}
}

func (a *App) analysisWorker(ctx context.Context) {
	defer a.schedulerWG.Done()
	for {
		run, err := a.store.ClaimNextQueuedAnalysisRun(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(250 * time.Millisecond):
			}
			continue
		}
		if run == nil {
			select {
			case <-ctx.Done():
				return
			case <-a.analysisWake:
			}
			continue
		}
		a.runQueuedAnalysis(ctx, *run)
	}
}

func (a *App) runQueuedAnalysis(workerCtx context.Context, run domain.AnalysisRun) {
	op := Operation{ID: run.ID, SessionID: run.SessionID, RunID: run.ID, Kind: "analysis", Stage: "loadingPullRequestContext", State: "running", Message: "Loading GitHub discussion and checks"}
	session, err := a.store.GetSession(workerCtx, run.SessionID)
	if err != nil {
		a.failAnalysisOperation(op, contextFailure(err), domain.AnalysisCoverage{})
		a.mu.Lock()
		delete(a.analysisBySession, run.SessionID)
		a.mu.Unlock()
		return
	}
	adapter, profile, capabilities, err := a.harnesses.Resolve(workerCtx, run.Profile)
	if err != nil {
		a.failAnalysisOperation(op, providerStartFailure(err), domain.AnalysisCoverage{})
		a.mu.Lock()
		delete(a.analysisBySession, run.SessionID)
		a.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(workerCtx)
	defer cancel()
	a.mu.Lock()
	a.active[op.ID] = cancel
	a.analysisBySession[run.SessionID] = op.ID
	a.mu.Unlock()
	a.emitOperation(op)
	a.prepareAndRunAnalysis(ctx, op, session, analysisPlan{adapter: adapter, profile: profile, transport: controlledTransport(capabilities.ContextTransports), runID: run.ID})
}

func analysisFingerprint(session domain.ReviewSession, profile domain.AnalysisProfile, harnessVersion string, transport domain.ContextTransport) string {
	return analysisFingerprintWithPromptVersion(session, profile, harnessVersion, transport, analysisPromptVersion)
}

func analysisFingerprintWithPromptVersion(session domain.ReviewSession, profile domain.AnalysisProfile, harnessVersion string, transport domain.ContextTransport, promptVersion int) string {
	payload, _ := json.Marshal(struct {
		BaseSHA, HeadSHA, HarnessVersion string
		Profile                          domain.AnalysisProfile
		Transport                        domain.ContextTransport
		SchemaVersion, PromptVersion     int
		PullRequest                      domain.PullRequest
	}{session.BaseSHA, session.HeadSHA, harnessVersion, profile, transport, sharedanalysis.SchemaVersion, promptVersion, session.PullRequest})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func unchangedOversizedRetryBlocked(prior *domain.AnalysisRun, fingerprint string) bool {
	return prior != nil && prior.InputFingerprint == fingerprint && prior.Status == domain.AnalysisRunFailed && prior.Failure != nil && (prior.Failure.Code == domain.FailureInputTooLarge || prior.Failure.Code == domain.FailureRetryRequiresReplan)
}
func (a *App) CancelOperation(id string) error {
	a.mu.Lock()
	cancel := a.active[id]
	a.mu.Unlock()
	if cancel != nil {
		cancel()
		return nil
	}
	run, err := a.store.GetAnalysisRun(a.appContext(), id)
	if err != nil || run.Status != domain.AnalysisRunQueued {
		return errors.New("operation is not active")
	}
	if err := a.store.CancelAnalysisRun(a.appContext(), run.ID, domain.AnalysisCoverage{}); err != nil {
		return err
	}
	a.mu.Lock()
	delete(a.analysisBySession, run.SessionID)
	a.mu.Unlock()
	a.emitOperation(Operation{ID: run.ID, SessionID: run.SessionID, RunID: run.ID, Kind: "analysis", Stage: "cancelled", State: "cancelled", Message: "Queued analysis cancelled"})
	return nil
}
func (a *App) GetActiveAnalysisOperation(sessionID string) (*OperationSnapshot, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, errors.New("session ID is required")
	}
	a.mu.RLock()
	operationID := a.analysisBySession[sessionID]
	history := append([]Operation(nil), a.operationHistory[operationID]...)
	a.mu.RUnlock()
	if operationID == "" || len(history) == 0 {
		run, err := a.store.LatestAnalysisRun(a.appContext(), sessionID)
		if err != nil || run == nil || (run.Status != domain.AnalysisRunQueued && run.Status != domain.AnalysisRunPreparing && run.Status != domain.AnalysisRunRunning) {
			return nil, err
		}
		state, stage, message := "running", "loadingPullRequestContext", "Loading GitHub discussion and checks"
		if run.Status == domain.AnalysisRunQueued {
			state, stage, message = "queued", "queued", "Waiting for an analysis worker"
		}
		op := Operation{ID: run.ID, SessionID: sessionID, RunID: run.ID, Kind: "analysis", Stage: stage, State: state, Message: message, UpdatedAt: run.UpdatedAt}
		return &OperationSnapshot{Operation: op, Events: []Operation{op}}, nil
	}
	return &OperationSnapshot{Operation: history[len(history)-1], Events: history}, nil
}
func (a *App) SetChapterStatus(sessionID, chapterID string, status domain.ChapterStatus) (domain.ReviewSession, error) {
	if err := a.store.SetChapterStatus(a.appContext(), sessionID, chapterID, status); err != nil {
		return domain.ReviewSession{}, err
	}
	return a.GetSession(sessionID)
}

// SetJudgmentDecision persists the reviewer's local disposition for one agent
// finding so accepted tradeoffs and their rationales survive restarts.
func (a *App) SetJudgmentDecision(sessionID, findingID, disposition, note string) (domain.ReviewSession, error) {
	switch disposition {
	case "unreviewed", "accepted", "concern", "needsEvidence":
	default:
		return domain.ReviewSession{}, errors.New("unknown judgment disposition")
	}
	if strings.TrimSpace(findingID) == "" || len(findingID) > 200 {
		return domain.ReviewSession{}, errors.New("invalid finding identifier")
	}
	if len(note) > 20000 {
		return domain.ReviewSession{}, errors.New("decision rationale must stay under 20,000 characters")
	}
	decision := domain.JudgmentDecision{SessionID: sessionID, FindingID: findingID, Disposition: disposition, Note: note, UpdatedAt: time.Now().UTC()}
	if err := a.store.SaveJudgmentDecision(a.appContext(), decision); err != nil {
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
		normalized, err := a.normalizeInline(input.SessionID, input.Path, input.StartLine, input.StartSide, input.Line, input.Side)
		if err != nil {
			return domain.ReviewComment{}, err
		}
		input.StartLine, input.StartSide, input.Line, input.Side = normalized.StartLine, normalized.StartSide, normalized.Line, normalized.Side
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = newID()
	}
	comment := domain.ReviewComment{ID: input.ID, SessionID: input.SessionID, ChapterID: input.ChapterID, Kind: input.Kind, Body: input.Body, Path: input.Path, StartLine: input.StartLine, StartSide: input.StartSide, Line: input.Line, Side: input.Side, Status: domain.CommentDraft, CreatedAt: now, UpdatedAt: now}
	if err := a.store.SaveComment(a.appContext(), comment); err != nil {
		return domain.ReviewComment{}, err
	}
	return comment, nil
}
func (a *App) DeleteDraftComment(id string) error { return a.store.DeleteComment(a.appContext(), id) }
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
	return a.ensurePreparedContext(a.appContext(), sessionID)
}
func (a *App) ensurePreparedContext(ctx context.Context, sessionID string) (preparedState, error) {
	a.mu.RLock()
	state, ok := a.prepared.Get(sessionID)
	a.mu.RUnlock()
	if ok {
		return state, nil
	}
	for attempt := 0; attempt < 2; attempt++ {
		session, err := a.store.GetSession(ctx, sessionID)
		if err != nil {
			return state, err
		}
		repo, files, err := a.prepare(ctx, session)
		if err != nil {
			return state, err
		}
		state = preparedState{repo, files}
		a.mu.Lock()
		current, err := a.store.GetSession(ctx, sessionID)
		if err != nil {
			a.mu.Unlock()
			return preparedState{}, err
		}
		if current.BaseSHA != session.BaseSHA || current.HeadSHA != session.HeadSHA {
			a.mu.Unlock()
			continue
		}
		current.Status = domain.SessionReady
		current.UpdatedAt = time.Now().UTC()
		if err := a.store.SaveSession(ctx, current); err != nil {
			a.mu.Unlock()
			return preparedState{}, err
		}
		a.prepared.Put(sessionID, state)
		a.mu.Unlock()
		return state, nil
	}
	return preparedState{}, errors.New("pull request revision changed while preparing the managed repository")
}
func (a *App) prepareAndRunAnalysis(ctx context.Context, op Operation, session domain.ReviewSession, plan analysisPlan) {
	sessionID := session.ID
	op.Stage = "loadingPullRequestContext"
	op.Message = "Loading GitHub discussion and checks"
	a.emitOperation(op)
	refreshed, err := a.refreshPullRequestContext(ctx, sessionID)
	if err != nil {
		a.mu.Lock()
		delete(a.active, op.ID)
		delete(a.analysisBySession, sessionID)
		a.mu.Unlock()
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op, domain.AnalysisCoverage{})
		} else {
			a.failAnalysisOperation(op, contextFailure(err), domain.AnalysisCoverage{})
		}
		return
	}
	session = refreshed
	if failure := analysisCheckFailure(session.PullRequest.CheckRuns); failure != nil {
		a.mu.Lock()
		delete(a.active, op.ID)
		delete(a.analysisBySession, sessionID)
		a.mu.Unlock()
		a.failAnalysisOperation(op, *failure, domain.AnalysisCoverage{})
		return
	}
	op.Stage = "preparingContext"
	op.Message = "Preparing bounded review context"
	a.emitOperation(op)
	state, err := a.ensurePreparedContext(ctx, session.ID)
	if err != nil {
		a.mu.Lock()
		delete(a.active, op.ID)
		delete(a.analysisBySession, session.ID)
		a.mu.Unlock()
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op, domain.AnalysisCoverage{})
		} else {
			a.failAnalysisOperation(op, contextFailure(err), domain.AnalysisCoverage{})
		}
		return
	}
	current, err := a.store.GetSession(ctx, session.ID)
	if err != nil {
		a.mu.Lock()
		delete(a.active, op.ID)
		delete(a.analysisBySession, session.ID)
		a.mu.Unlock()
		a.failAnalysisOperation(op, contextFailure(err), domain.AnalysisCoverage{})
		return
	}
	a.runAnalysis(ctx, op, current, state, plan)
}
func (a *App) runAnalysis(ctx context.Context, op Operation, session domain.ReviewSession, state preparedState, plan analysisPlan) {
	defer func() { a.mu.Lock(); delete(a.active, op.ID); delete(a.analysisBySession, session.ID); a.mu.Unlock() }()
	lease, err := (analysisbundle.Builder{Root: analysisbundle.BundleRoot(a.paths.Root), Source: a.repos}).Build(ctx, analysisbundle.Input{PullRequest: session.PullRequest, Repository: state.repository, ChangedFiles: state.files})
	if err != nil {
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op, domain.AnalysisCoverage{})
			return
		}
		a.failAnalysisOperation(op, contextFailure(err), domain.AnalysisCoverage{})
		return
	}
	a.mu.Lock()
	if a.activeBundles == nil {
		a.activeBundles = map[string]struct{}{}
	}
	a.activeBundles[lease.Reference.Path] = struct{}{}
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.activeBundles, lease.Reference.Path)
		a.mu.Unlock()
		_ = lease.Close()
	}()
	bundle, err := analysisbundle.Open(a.paths.Root, lease.Reference.Path, lease.Reference.Digest)
	if err != nil {
		a.failAnalysisOperation(op, contextFailure(err), domain.AnalysisCoverage{})
		return
	}
	emptyCoverage := agent.NewAccessTracker(bundle.Manifest).Coverage()
	reader, err := analysiscontext.NewGitObjectReader(a.runner, state.repository.CachePath, session.BaseSHA, session.HeadSHA)
	if err != nil {
		a.failAnalysisOperation(op, contextFailure(err), emptyCoverage)
		return
	}
	op.Stage = "analyzingChange"
	op.Message = "Analyzing the change with controlled read-only context"
	a.emitOperation(op)
	if err := a.store.MarkAnalysisRunRunning(ctx, plan.runID); err != nil {
		a.failAnalysisOperation(op, persistenceFailure(err), emptyCoverage)
		return
	}
	events, err := plan.adapter.AnalyzeChange(ctx, agent.AnalyzeInput{
		Bundle: lease.Reference, DataRoot: a.paths.Root, Profile: plan.profile, ContextTransport: plan.transport,
		Snapshot: sharedanalysis.Snapshot{BaseSHA: session.BaseSHA, HeadSHA: session.HeadSHA, Files: evidenceFileReader{reader}},
	})
	if err != nil {
		if analysisWasCancelled(ctx, err) {
			a.cancelAnalysisOperation(op, emptyCoverage)
			return
		}
		a.failAnalysisOperation(op, providerStartFailure(err), emptyCoverage)
		return
	}
	coverage := emptyCoverage
	for event := range events {
		op.Message = event.Message
		if event.Coverage != nil {
			coverage = *event.Coverage
		}
		switch event.Kind {
		case agent.EventStarted, agent.EventProgress, agent.EventWarning:
			op.Stage = "analyzingChange"
		case agent.EventValidating:
			if strings.Contains(strings.ToLower(event.Message), "structured") {
				op.Stage = "validatingOutput"
			} else {
				op.Stage = "validatingEvidence"
			}
		case agent.EventCompleted:
			if event.Analysis == nil {
				a.failAnalysisOperation(op, providerStartFailure(errors.New("analysis completed without a review model")), coverage)
				return
			}
			op.Stage = "savingReview"
			op.Message = "Saving the validated guided review"
			a.emitOperation(op)
			commitCtx, cancelCommit := context.WithTimeout(a.appContext(), 10*time.Second)
			err := a.store.CompleteAnalysisRun(commitCtx, plan.runID, *event.Analysis, coverage)
			cancelCommit()
			if err != nil {
				a.failAnalysisOperation(op, persistenceFailure(err), coverage)
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
			a.cancelAnalysisOperation(op, coverage)
			return
		case agent.EventFailed:
			eventErr := event.Err
			if eventErr == nil {
				eventErr = errors.New(event.Message)
			}
			if analysisWasCancelled(ctx, eventErr) {
				a.cancelAnalysisOperation(op, coverage)
				return
			}
			failure := providerStartFailure(eventErr)
			if event.Failure != nil {
				failure = *event.Failure
			}
			a.failAnalysisOperation(op, failure, coverage)
			return
		}
		a.emitOperation(op)
	}
	if ctx.Err() != nil {
		a.cancelAnalysisOperation(op, coverage)
		return
	}
	a.failAnalysisOperation(op, providerStartFailure(errors.New("analysis stream ended without a completed review model")), coverage)
}
func (a *App) cancelAnalysisOperation(op Operation, coverage domain.AnalysisCoverage) {
	op.State = "cancelled"
	op.Stage = "cancelled"
	op.Message = "Analysis cancelled"
	if op.RunID != "" {
		_ = a.store.CancelAnalysisRun(a.appContext(), op.RunID, coverage)
	}
	a.emitOperation(op)
}
func (a *App) failAnalysisOperation(op Operation, failure domain.AnalysisFailure, coverage domain.AnalysisCoverage) {
	op.State = "failed"
	op.Stage = "failed"
	op.Message = failure.Message
	op.Failure = &failure
	if op.RunID != "" {
		if err := a.store.FailAnalysisRun(a.appContext(), op.RunID, failure, coverage); err != nil {
			op.Failure = ptrAnalysisFailure(persistenceFailure(err))
			op.Message = op.Failure.Message
		}
	}
	a.emitOperation(op)
}

type evidenceFileReader struct {
	reader *analysiscontext.GitObjectReader
}

func (r evidenceFileReader) ReadFile(ctx context.Context, revision domain.Revision, path string) ([]byte, error) {
	content, binary, err := r.reader.ReadFile(ctx, revision, path)
	if err != nil {
		return nil, err
	}
	if binary {
		return nil, errors.New("evidence path is binary")
	}
	return []byte(content), nil
}

func contextFailure(err error) domain.AnalysisFailure {
	return domain.AnalysisFailure{Code: domain.FailureContextAccess, Title: "Review context could not be prepared", Message: "ReviewArc could not prepare the bounded pull request context for analysis.", Action: domain.RetrySamePlan, Retryable: true, TechnicalDetails: safeMessage(err)}
}

func analysisCheckFailure(checks []domain.CheckRun) *domain.AnalysisFailure {
	if len(checks) == 0 {
		return nil
	}
	passing := map[string]bool{"success": true, "neutral": true, "skipped": true}
	failing := map[string]bool{"failure": true, "timed_out": true, "action_required": true, "startup_failure": true}
	failedNames := make([]string, 0)
	waitingNames := make([]string, 0)
	for _, check := range checks {
		result := strings.ToLower(strings.TrimSpace(check.Conclusion))
		if passing[result] {
			continue
		}
		if failing[result] {
			failedNames = append(failedNames, check.Name)
			continue
		}
		waitingNames = append(waitingNames, check.Name)
	}
	if len(failedNames) > 0 {
		return &domain.AnalysisFailure{
			Code:             domain.FailureChecksFailed,
			Title:            "Review paused while CI is failing",
			Message:          "Fix or rerun the failing checks before ReviewArc spends model time while CI is failing.",
			Action:           domain.RetrySamePlan,
			Retryable:        true,
			TechnicalDetails: "Failing checks: " + strings.Join(failedNames, ", "),
		}
	}
	if len(waitingNames) > 0 {
		return &domain.AnalysisFailure{
			Code:             domain.FailureChecksPending,
			Title:            "Review is waiting for CI",
			Message:          "ReviewArc will start the deep review after the current checks are rerun or finish successfully.",
			Action:           domain.RetrySamePlan,
			Retryable:        true,
			TechnicalDetails: "Waiting checks: " + strings.Join(waitingNames, ", "),
		}
	}
	return nil
}

func providerStartFailure(err error) domain.AnalysisFailure {
	return domain.AnalysisFailure{Code: domain.FailureProvider, Title: "Analysis did not complete", Message: "The selected harness stopped before ReviewArc received a valid review.", Action: domain.RetrySamePlan, Retryable: true, TechnicalDetails: safeMessage(err)}
}

func persistenceFailure(err error) domain.AnalysisFailure {
	return domain.AnalysisFailure{Code: domain.FailurePersistence, Title: "Analysis could not be saved", Message: "ReviewArc received a result but could not save the guided review.", Action: domain.RetrySamePlan, Retryable: true, TechnicalDetails: safeMessage(err)}
}

func ptrAnalysisFailure(failure domain.AnalysisFailure) *domain.AnalysisFailure { return &failure }
func (a *App) emitOperation(op Operation) {
	op.UpdatedAt = time.Now().UTC()
	a.mu.Lock()
	if a.operationHistory == nil {
		a.operationHistory = map[string][]Operation{}
	}
	history := append(a.operationHistory[op.ID], op)
	if len(history) > 100 {
		history = append([]Operation(nil), history[len(history)-100:]...)
	}
	if operationTerminal(op) {
		delete(a.operationHistory, op.ID)
	} else {
		a.operationHistory[op.ID] = history
	}
	a.mu.Unlock()
	_ = a.store.SaveOperation(a.appContext(), persistence.Operation{ID: op.ID, Kind: op.Kind, Subject: op.SessionID, Status: op.State, Detail: op.Message, UpdatedAt: op.UpdatedAt})
	if a.ctx != nil {
		runtime.EventsEmit(a.appContext(), "reviewarc:operation:v1", op)
	}
}

func operationTerminal(op Operation) bool {
	return op.State == "complete" || op.State == "completed" || op.State == "failed" || op.State == "cancelled"
}

type inlineRange struct {
	StartLine *int
	StartSide domain.DiffSide
	Line      *int
	Side      domain.DiffSide
}

func (a *App) normalizeInline(sessionID, path string, startLine *int, startSide domain.DiffSide, line *int, side domain.DiffSide) (inlineRange, error) {
	diff, err := a.GetDiff(sessionID, path)
	if err != nil {
		return inlineRange{}, err
	}
	return normalizeInlineDiff(diff, startLine, startSide, line, side)
}

func normalizeInlineDiff(diff domain.DiffFile, startLine *int, startSide domain.DiffSide, line *int, side domain.DiffSide) (inlineRange, error) {
	if line == nil || *line < 1 || (side != domain.DiffSideLeft && side != domain.DiffSideRight) {
		return inlineRange{}, errors.New("inline comment requires a valid diff line and side")
	}
	if startLine != nil {
		if *startLine < 1 || (startSide != domain.DiffSideLeft && startSide != domain.DiffSideRight) {
			return inlineRange{}, errors.New("multi-line comment requires a valid start line and side")
		}
	}
	position := func(wanted int, wantedSide domain.DiffSide) (int, bool) {
		position := 0
		for _, h := range diff.Hunks {
			for _, candidate := range h.Lines {
				if wantedSide == domain.DiffSideRight && candidate.NewLine != nil && *candidate.NewLine == wanted || wantedSide == domain.DiffSideLeft && candidate.OldLine != nil && *candidate.OldLine == wanted {
					return position, true
				}
				position++
			}
		}
		return 0, false
	}
	endPosition, endPresent := position(*line, side)
	if !endPresent {
		return inlineRange{}, errors.New("inline comment line is not present in the pull request diff")
	}
	if startLine == nil {
		return inlineRange{Line: line, Side: side}, nil
	}
	startPosition, startPresent := position(*startLine, startSide)
	if !startPresent {
		return inlineRange{}, errors.New("multi-line comment start is not present in the pull request diff")
	}
	if startPosition == endPosition {
		return inlineRange{Line: line, Side: side}, nil
	}
	if startPosition > endPosition {
		return inlineRange{StartLine: line, StartSide: side, Line: startLine, Side: startSide}, nil
	}
	return inlineRange{StartLine: startLine, StartSide: startSide, Line: line, Side: side}, nil
}

func validateInlineDiff(diff domain.DiffFile, startLine *int, startSide domain.DiffSide, line *int, side domain.DiffSide) error {
	_, err := normalizeInlineDiff(diff, startLine, startSide, line, side)
	return err
}
func selectedRepositories(repos []domain.Repository, selections []domain.SourceSelection) []domain.RepositoryRef {
	repoKeys := map[string]bool{}
	for _, s := range selections {
		if !s.Enabled {
			continue
		}
		if s.Kind == domain.SelectionRepository {
			repoKeys[strings.ToLower(s.Key)] = true
		}
	}
	refs := map[string]domain.RepositoryRef{}
	archived := map[string]bool{}
	for _, repo := range repos {
		name := strings.ToLower(repo.Ref.Owner + "/" + repo.Ref.Name)
		if repo.IsArchived {
			archived[name] = true
			continue
		}
		if repoKeys[name] {
			refs[name] = repo.Ref
		}
	}
	for key := range repoKeys {
		if _, ok := refs[key]; ok || archived[key] {
			continue
		}
		owner, name, found := strings.Cut(key, "/")
		if found {
			refs[key] = domain.RepositoryRef{Host: "github.com", Owner: owner, Name: name, CloneURL: "https://github.com/" + owner + "/" + name + ".git"}
		}
	}
	out := make([]domain.RepositoryRef, 0, len(refs))
	for _, ref := range refs {
		out = append(out, ref)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Owner+"/"+out[i].Name) < strings.ToLower(out[j].Owner+"/"+out[j].Name)
	})
	return out
}
func selectedOrganizations(selections []domain.SourceSelection) []string {
	seen := map[string]bool{}
	organizations := make([]string, 0)
	for _, selection := range selections {
		if !selection.Enabled || selection.Kind != domain.SelectionOrganization {
			continue
		}
		key := strings.ToLower(selection.Key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		organizations = append(organizations, selection.Key)
	}
	sort.Slice(organizations, func(i, j int) bool { return strings.ToLower(organizations[i]) < strings.ToLower(organizations[j]) })
	return organizations
}
func explicitlySelectedRepositories(repositories []domain.Repository, selections []domain.SourceSelection) []domain.Repository {
	selected := map[string]bool{}
	for _, selection := range selections {
		if selection.Enabled && selection.Kind == domain.SelectionRepository {
			selected[strings.ToLower(selection.Key)] = true
		}
	}
	items := make([]domain.Repository, 0, len(selected))
	for _, repository := range repositories {
		name := strings.ToLower(repository.Ref.Owner + "/" + repository.Ref.Name)
		if selected[name] && !repository.IsArchived {
			items = append(items, repository)
		}
	}
	return items
}
func activeSourceSelections(selections []domain.SourceSelection, repositories []domain.Repository) []domain.SourceSelection {
	archived := map[string]bool{}
	for _, repository := range repositories {
		if repository.IsArchived {
			archived[strings.ToLower(repository.Ref.Owner+"/"+repository.Ref.Name)] = true
		}
	}
	active := make([]domain.SourceSelection, 0, len(selections))
	for _, selection := range selections {
		if selection.Kind == domain.SelectionRepository && archived[strings.ToLower(selection.Key)] {
			continue
		}
		active = append(active, selection)
	}
	return active
}
func validSourceOwner(owner string) bool {
	if owner == "" || owner == "." || owner == ".." || len(owner) > 100 {
		return false
	}
	for _, r := range owner {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("-_", r) {
			continue
		}
		return false
	}
	return true
}
func validSourceRepositoryName(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > 100 {
		return false
	}
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("-_.", r) {
			continue
		}
		return false
	}
	return true
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
func analysisStatusAfterCancellation(session domain.ReviewSession) domain.AnalysisStatus {
	if session.Analysis == nil {
		return domain.AnalysisNotStarted
	}
	if session.IsStale {
		return domain.AnalysisStale
	}
	return domain.AnalysisReady
}

func analysisStatusAfterFailure(session domain.ReviewSession) domain.AnalysisStatus {
	if session.Analysis == nil {
		return domain.AnalysisFailed
	}
	return analysisStatusAfterCancellation(session)
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
func validSyncID(value string) bool {
	if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
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
	if session.Decisions == nil {
		session.Decisions = []domain.JudgmentDecision{}
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
