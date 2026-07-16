package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"reviewarc/internal/agent"
	sharedanalysis "reviewarc/internal/analysis"
	"reviewarc/internal/dependencies"
	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
	githubclient "reviewarc/internal/github"
	"reviewarc/internal/persistence"
	proc "reviewarc/internal/process"
)

type appFixtureRunner struct {
	results  []proc.Result
	errors   []error
	commands []proc.Command
}

type appAnalysisAdapter struct{}

func (appAnalysisAdapter) ID() domain.HarnessID { return domain.HarnessCodex }
func (appAnalysisAdapter) Capabilities(context.Context) (domain.HarnessCapabilities, error) {
	return domain.HarnessCapabilities{
		ID: domain.HarnessCodex, Name: "Codex", State: domain.HarnessAvailable, Version: "fixture",
		SupportsJSONSchema: true, EnforcesReadOnly: true, SupportsProgress: true, SupportsCancellation: true,
		ContextTransports: []domain.ContextTransport{domain.ContextReviewArcTools}, DefaultModel: "fixture",
		Models: []domain.ModelCapability{{ID: "fixture", Name: "Fixture", ReasoningLevels: []domain.ReasoningLevel{domain.ReasoningMedium}, DefaultReasoningLevel: domain.ReasoningMedium}},
	}, nil
}
func (appAnalysisAdapter) AnalyzeChange(context.Context, agent.AnalyzeInput) (<-chan agent.Event, error) {
	return nil, errors.New("analysis should not start before pull request context is loaded")
}

type selectableAppAnalysisAdapter struct{ id domain.HarnessID }

func (a selectableAppAnalysisAdapter) ID() domain.HarnessID { return a.id }
func (a selectableAppAnalysisAdapter) Capabilities(context.Context) (domain.HarnessCapabilities, error) {
	name := "Codex"
	if a.id == domain.HarnessClaude {
		name = "Claude Code"
	}
	return domain.HarnessCapabilities{
		ID: a.id, Name: name, State: domain.HarnessAvailable, Version: "fixture",
		SupportsJSONSchema: true, EnforcesReadOnly: true, SupportsProgress: true, SupportsCancellation: true,
		ContextTransports: []domain.ContextTransport{domain.ContextReviewArcTools}, DefaultModel: "fixture",
		Models: []domain.ModelCapability{{ID: "fixture", Name: "Fixture", ReasoningLevels: []domain.ReasoningLevel{domain.ReasoningMedium}, DefaultReasoningLevel: domain.ReasoningMedium}},
	}, nil
}
func (a selectableAppAnalysisAdapter) AnalyzeChange(context.Context, agent.AnalyzeInput) (<-chan agent.Event, error) {
	return nil, fmt.Errorf("%s analysis should not start before pull request context is loaded", a.id)
}

type pullRequestFixtureRunner struct {
	mu          sync.Mutex
	metadata    []byte
	reviews     []byte
	comments    []byte
	checks      []byte
	contextErr  error
	contextHook func()
	commands    []proc.Command
}

func (r *pullRequestFixtureRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	r.mu.Lock()
	r.commands = append(r.commands, command)
	r.mu.Unlock()
	endpoint := command.Args[len(command.Args)-1]
	if reflect.DeepEqual(command.Args, []string{"api", "--method", "POST", "repos/acme/api/pulls/7/reviews", "--input", "-"}) {
		return proc.Result{Stdout: []byte(`{"id":991,"html_url":"https://github.com/acme/api/pull/7#pullrequestreview-991"}`)}, nil
	}
	if reflect.DeepEqual(command.Args, []string{"api", "--method", "POST", "repos/acme/api/pulls/7/comments/101/replies", "--input", "-"}) {
		return proc.Result{Stdout: []byte(`{"id":202,"pull_request_review_id":11,"in_reply_to_id":101,"user":{"login":"sean"},"body":"Follow-up","path":"quota/limiter.go","line":16,"side":"RIGHT","commit_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","created_at":"2026-07-13T04:00:00Z","updated_at":"2026-07-13T04:00:00Z","html_url":"https://github.com/acme/api/pull/7#discussion_r202"}`)}, nil
	}
	switch endpoint {
	case "repos/acme/api/pulls/7":
		return proc.Result{Stdout: r.metadata}, nil
	case "repos/acme/api/pulls/7/comments?per_page=100":
		if len(r.comments) > 0 {
			return proc.Result{Stdout: r.comments}, nil
		}
		return proc.Result{Stdout: []byte(`[[]]`)}, nil
	case "repos/acme/api/pulls/7/reviews?per_page=100":
		if r.contextHook != nil {
			r.contextHook()
		}
		if r.contextErr != nil {
			return proc.Result{}, r.contextErr
		}
		if len(r.reviews) > 0 {
			return proc.Result{Stdout: r.reviews}, nil
		}
		return proc.Result{Stdout: []byte(`[[]]`)}, nil
	case "repos/acme/api/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs?per_page=100":
		if len(r.checks) > 0 {
			return proc.Result{Stdout: r.checks}, nil
		}
		return proc.Result{Stdout: []byte(`[{"check_runs":[]}]`)}, nil
	default:
		return proc.Result{Stdout: []byte(`[[]]`)}, nil
	}
}

type protocolRunner struct{ protocol string }

type bootstrapRefreshRunner struct{ refreshed bool }

type bootstrapConcurrentRunner struct {
	started      chan string
	release      chan struct{}
	accountLogin string
}

func (r *bootstrapConcurrentRunner) RefreshPaths() {}
func (r *bootstrapConcurrentRunner) ResolvedPath(tool proc.Tool) (string, error) {
	return "/fixture/bin/" + string(tool), nil
}
func (r *bootstrapConcurrentRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	name := string(command.Tool)
	if len(command.Args) > 0 && command.Args[0] == "api" {
		name = "account"
	}
	r.started <- name
	<-r.release
	if name == "account" {
		return proc.Result{Stdout: []byte(fmt.Sprintf(`{"login":%q,"name":"Sean","avatar_url":""}`, r.accountLogin))}, nil
	}
	return proc.Result{Stdout: []byte(name + " version fixture\n")}, nil
}

type repositoryRefreshConcurrencyRunner struct {
	mu       sync.Mutex
	active   int
	maximum  int
	commands int
}

func (r *bootstrapRefreshRunner) RefreshPaths() { r.refreshed = true }
func (r *bootstrapRefreshRunner) ResolvedPath(tool proc.Tool) (string, error) {
	return "/fixture/bin/" + string(tool), nil
}
func (r *bootstrapRefreshRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	if len(command.Args) >= 2 && command.Args[0] == "api" && command.Args[1] == "user" {
		return proc.Result{Stdout: []byte(`{"login":"strantalis","name":"Sean","avatar_url":""}`)}, nil
	}
	return proc.Result{Stdout: []byte(string(command.Tool) + " version fixture\n")}, nil
}

func (r *repositoryRefreshConcurrencyRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	r.mu.Lock()
	r.active++
	r.commands++
	if r.active > r.maximum {
		r.maximum = r.active
	}
	r.mu.Unlock()
	time.Sleep(20 * time.Millisecond)
	nameWithOwner := command.Args[2]
	owner, name, _ := strings.Cut(nameWithOwner, "/")
	body := fmt.Sprintf(`{"id":"%s","name":"%s","nameWithOwner":"%s","owner":{"login":"%s"}}`, nameWithOwner, name, nameWithOwner, owner)
	r.mu.Lock()
	r.active--
	r.mu.Unlock()
	return proc.Result{Stdout: []byte(body)}, nil
}

func (r protocolRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	if !reflect.DeepEqual(command.Args, []string{"config", "get", "git_protocol", "--host", "github.com"}) {
		return proc.Result{}, errors.New("unexpected command")
	}
	return proc.Result{Stdout: []byte(r.protocol + "\n")}, nil
}

func (f *appFixtureRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	f.commands = append(f.commands, command)
	i := len(f.commands) - 1
	if i >= len(f.results) {
		return proc.Result{}, errors.New("unexpected fixture command")
	}
	var err error
	if i < len(f.errors) {
		err = f.errors[i]
	}
	return f.results[i], err
}

func TestSelectedSourcesKeepOrganizationsOutOfRepositoryFanout(t *testing.T) {
	repositories := []domain.Repository{
		{Ref: domain.RepositoryRef{Owner: "Acme", Name: "api"}},
		{Ref: domain.RepositoryRef{Owner: "Acme", Name: "web"}},
		{Ref: domain.RepositoryRef{Owner: "other", Name: "worker"}},
	}
	selections := []domain.SourceSelection{
		{Kind: domain.SelectionOrganization, Key: "ACME", Enabled: true},
		{Kind: domain.SelectionRepository, Key: "other/worker", Enabled: true},
		{Kind: domain.SelectionRepository, Key: "ignored/repo", Enabled: false},
	}
	got := selectedRepositories(repositories, selections)
	want := []domain.RepositoryRef{repositories[2].Ref}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("selected=%+v, want %+v", got, want)
	}
	if organizations := selectedOrganizations(selections); !reflect.DeepEqual(organizations, []string{"ACME"}) {
		t.Fatalf("organizations=%v", organizations)
	}
}

func TestSelectedRepositoriesExcludeArchivedCachedRows(t *testing.T) {
	repositories := []domain.Repository{{Ref: domain.RepositoryRef{Owner: "acme", Name: "active"}}, {Ref: domain.RepositoryRef{Owner: "acme", Name: "archived"}, IsArchived: true}}
	selections := []domain.SourceSelection{{Kind: domain.SelectionRepository, Key: "acme/active", Enabled: true}, {Kind: domain.SelectionRepository, Key: "acme/archived", Enabled: true}}
	got := selectedRepositories(repositories, selections)
	if len(got) != 1 || got[0].Name != "active" {
		t.Fatalf("selected=%+v", got)
	}
	active := activeSourceSelections(selections, repositories)
	if len(active) != 1 || active[0].Key != "acme/active" {
		t.Fatalf("active selections=%+v", active)
	}
}

func TestRefreshSelectedRepositoriesDetectsArchiveTransition(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	selection := domain.SourceSelection{Kind: domain.SelectionRepository, Key: "acme/old", Enabled: true}
	if err := store.ReplaceSelections(ctx, []domain.SourceSelection{selection}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertRepositories(ctx, []domain.Repository{{Ref: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "old"}}}); err != nil {
		t.Fatal(err)
	}
	runner := &appFixtureRunner{results: []proc.Result{{Stdout: []byte(`{"id":"R_1","name":"old","nameWithOwner":"acme/old","description":"Archived","updatedAt":"2026-07-12T00:00:00Z","isPrivate":true,"isArchived":true,"owner":{"login":"acme"}}`)}}}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store}

	refreshed, err := app.RefreshSelectedRepositories()
	if err != nil {
		t.Fatal(err)
	}
	if len(refreshed.Repositories) != 0 || !reflect.DeepEqual(refreshed.ArchivedKeys, []string{"acme/old"}) || len(refreshed.Errors) != 0 {
		t.Fatalf("refresh=%+v", refreshed)
	}
	cached, err := store.ListRepositories(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(cached) != 1 || !cached[0].IsArchived {
		t.Fatalf("cached=%+v", cached)
	}
	selections, err := store.ListSelections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(selections) != 0 {
		t.Fatalf("archived selection remained persisted: %+v", selections)
	}
}

func TestExplicitRepositoryRefreshUsesBoundedConcurrency(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runner := &repositoryRefreshConcurrencyRunner{}
	app := &App{ctx: context.Background(), github: githubclient.New(runner), store: store}
	selections := make([]domain.SourceSelection, 12)
	for index := range selections {
		selections[index] = domain.SourceSelection{Kind: domain.SelectionRepository, Key: fmt.Sprintf("acme/repo-%02d", index), Enabled: true}
	}
	repositories, archived, refreshErrors := app.refreshExplicitRepositories(context.Background(), selections)
	if len(repositories) != len(selections) || len(archived) != 0 || len(refreshErrors) != 0 {
		t.Fatalf("repositories=%d archived=%v errors=%v", len(repositories), archived, refreshErrors)
	}
	if runner.commands != len(selections) || runner.maximum != 4 {
		t.Fatalf("commands=%d maximum concurrency=%d", runner.commands, runner.maximum)
	}
	for index, repository := range repositories {
		if repository.Ref.Name != fmt.Sprintf("repo-%02d", index) {
			t.Fatalf("repository order changed at %d: %+v", index, repository.Ref)
		}
	}
}

func TestInboxSortUsesGitHubUpdatedTime(t *testing.T) {
	items := []domain.PullRequestSummary{{Title: "old", UpdatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}, {Title: "new", UpdatedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)}}
	sortInbox(items)
	if items[0].Title != "new" {
		t.Fatalf("sorted items=%+v", items)
	}
}

func TestPreferredGitHubRemoteHonorsGHProtocol(t *testing.T) {
	ref := domain.RepositoryRef{Owner: "acme", Name: "api"}
	runner := &protocolRunner{protocol: "ssh"}
	if got := githubGitProtocol(runner); got != "ssh" {
		t.Fatalf("protocol=%q", got)
	}
	remote := preferredGitHubRemote(runner)
	if got := remote(ref); got != "git@github.com:acme/api.git" {
		t.Fatalf("SSH remote=%q", got)
	}
	runner.protocol = "https"
	if got := remote(ref); got != "https://github.com/acme/api.git" {
		t.Fatalf("HTTPS remote=%q", got)
	}
	runner.protocol = "unexpected"
	if got := remote(ref); got != "https://github.com/acme/api.git" {
		t.Fatalf("fallback remote=%q", got)
	}
}

func TestBootstrapRefreshesDependenciesBeforeReadingGitProtocol(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runner := &bootstrapRefreshRunner{}
	app := &App{
		detector: dependencies.New(runner),
		github:   githubclient.New(runner),
		store:    store,
		gitProtocol: func() string {
			if runner.refreshed {
				return "ssh"
			}
			return "https"
		},
	}
	state := app.Bootstrap()
	if !runner.refreshed || state.GitProtocol != "ssh" {
		t.Fatalf("refreshed=%v protocol=%q, want refreshed SSH state", runner.refreshed, state.GitProtocol)
	}
}

func TestBootstrapOverlapsIndependentEnvironmentChecks(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runner := &bootstrapConcurrentRunner{started: make(chan string, 5), release: make(chan struct{}), accountLogin: "strantalis"}
	app := &App{
		detector: dependencies.New(runner),
		github:   githubclient.New(runner),
		store:    store,
		gitProtocol: func() string {
			runner.started <- "protocol"
			<-runner.release
			return "ssh"
		},
	}
	done := make(chan domain.BootstrapState, 1)
	go func() { done <- app.Bootstrap() }()
	seen := map[string]bool{}
	for range 5 {
		select {
		case name := <-runner.started:
			seen[name] = true
		case <-time.After(time.Second):
			close(runner.release)
			t.Fatalf("environment checks did not overlap; started=%v", seen)
		}
	}
	close(runner.release)
	state := <-done
	for _, name := range []string{"git", "gh", "codex", "account", "protocol"} {
		if !seen[name] {
			t.Fatalf("missing concurrent check %q; started=%v", name, seen)
		}
	}
	if len(state.Dependencies) != 3 || state.Account == nil || state.Account.Login != "strantalis" || state.GitProtocol != "ssh" {
		t.Fatalf("bootstrap=%+v", state)
	}
	if state.EnvironmentCached {
		t.Fatal("first bootstrap unexpectedly reported cached environment")
	}
	warm := app.Bootstrap()
	if !warm.EnvironmentCached || warm.Account == nil || warm.Account.Login != "strantalis" || len(runner.started) != 0 {
		t.Fatalf("warm bootstrap invoked environment checks or lost snapshot: state=%+v pending=%d", warm, len(runner.started))
	}

	runner.accountLogin = "updated"
	runner.release = make(chan struct{})
	refreshed := make(chan domain.EnvironmentState, 1)
	refreshErrors := make(chan error, 1)
	go func() {
		state, err := app.RefreshEnvironment()
		refreshed <- state
		refreshErrors <- err
	}()
	for range 5 {
		select {
		case <-runner.started:
		case <-time.After(time.Second):
			close(runner.release)
			t.Fatal("background environment refresh did not run every check")
		}
	}
	close(runner.release)
	next := <-refreshed
	if err := <-refreshErrors; err != nil {
		t.Fatal(err)
	}
	if next.Account == nil || next.Account.Login != "updated" {
		t.Fatalf("refreshed environment=%+v", next)
	}
	updated := app.Bootstrap()
	if !updated.EnvironmentCached || updated.Account == nil || updated.Account.Login != "updated" || len(runner.started) != 0 {
		t.Fatalf("updated snapshot was not reused: state=%+v pending=%d", updated, len(runner.started))
	}
}

type panicRunner struct{}

func (panicRunner) Run(context.Context, proc.Command) (proc.Result, error) {
	panic("cached bootstrap invoked a process")
}

func TestBootstrapAcceptsCachedMissingDependenciesWithoutRunningTools(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	snapshot := domain.EnvironmentState{
		Dependencies: []domain.DependencyStatus{
			{Name: domain.DependencyGit, State: domain.DependencyAvailable},
			{Name: domain.DependencyGH, State: domain.DependencyMissing, Message: "Not installed in a supported location"},
			{Name: domain.DependencyCodex, State: domain.DependencyBroken, Message: "Found but could not run"},
		},
		GitProtocol: "https",
		RefreshedAt: time.Now().UTC(),
	}
	if err := store.SetSetting(context.Background(), environmentSnapshotSetting, snapshot); err != nil {
		t.Fatal(err)
	}
	runner := panicRunner{}
	app := &App{detector: dependencies.New(runner), github: githubclient.New(runner), store: store, gitProtocol: func() string { panic("cached bootstrap read protocol") }}
	state := app.Bootstrap()
	if !state.EnvironmentCached || state.Account != nil || state.Dependencies[1].State != domain.DependencyMissing || state.Dependencies[2].State != domain.DependencyBroken {
		t.Fatalf("bootstrap=%+v", state)
	}
}

func TestApplicationOptionsKeepNativeWindowShapeWithCustomControls(t *testing.T) {
	configured := applicationOptions(&App{})
	if configured.Frameless {
		t.Fatal("a titled native window is required for macOS rounded corners")
	}
	if configured.Mac == nil || configured.Mac.TitleBar == nil {
		t.Fatal("custom controls require a hidden native title bar")
	}
	titleBar := configured.Mac.TitleBar
	if titleBar.HideTitleBar || !titleBar.HideTitle || !titleBar.FullSizeContent || !titleBar.TitlebarAppearsTransparent {
		t.Fatalf("title bar must preserve the native window shape with full-size content: %+v", titleBar)
	}
	if configured.OnDomReady == nil {
		t.Fatal("native AppKit controls must be hidden after the window is ready")
	}
	if configured.AssetServer == nil || configured.AssetServer.Middleware == nil {
		t.Fatal("embedded frontend assets must disable persistent webview caching")
	}
	recorder := httptest.NewRecorder()
	servedPath := ""
	handler := configured.AssetServer.Middleware(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		servedPath = request.URL.Path
		response.WriteHeader(http.StatusNoContent)
	}))
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "https://reviewarc.invalid/__frontend/"+frontendRevision+"/", nil))
	if got := recorder.Header().Get("Cache-Control"); got != "no-store, max-age=0" {
		t.Fatalf("Cache-Control=%q, want no-store", got)
	}
	if frontendRevision == "" || frontendRevision == "unavailable" || !strings.Contains(frontendRevisionScript(frontendRevision), frontendRevision) {
		t.Fatalf("invalid embedded frontend revision %q", frontendRevision)
	}
	if servedPath != "/" {
		t.Fatalf("versioned frontend path was not rewritten: %q", servedPath)
	}
}

func TestFrontendRevisionNavigationSkipsWailsDevServer(t *testing.T) {
	if shouldNavigateToEmbeddedFrontend("dev") {
		t.Fatal("development builds must stay on the Wails frontend dev server")
	}
	for _, buildType := range []string{"production", "debug", ""} {
		if !shouldNavigateToEmbeddedFrontend(buildType) {
			t.Fatalf("build type %q must use the embedded frontend revision", buildType)
		}
	}
}

func TestAnalysisStatusAfterCancellationPreservesPreviousWalkthrough(t *testing.T) {
	if got := analysisStatusAfterCancellation(domain.ReviewSession{}); got != domain.AnalysisNotStarted {
		t.Fatalf("new analysis cancellation status=%q", got)
	}
	withAnalysis := domain.ReviewSession{Analysis: &domain.ReviewAnalysis{}}
	if got := analysisStatusAfterCancellation(withAnalysis); got != domain.AnalysisReady {
		t.Fatalf("reanalysis cancellation status=%q", got)
	}
	withAnalysis.IsStale = true
	if got := analysisStatusAfterCancellation(withAnalysis); got != domain.AnalysisStale {
		t.Fatalf("stale reanalysis cancellation status=%q", got)
	}
}

func TestAnalysisStatusAfterFailurePreservesPreviousWalkthrough(t *testing.T) {
	if got := analysisStatusAfterFailure(domain.ReviewSession{}); got != domain.AnalysisFailed {
		t.Fatalf("first analysis failure status=%q", got)
	}
	withAnalysis := domain.ReviewSession{Analysis: &domain.ReviewAnalysis{}}
	if got := analysisStatusAfterFailure(withAnalysis); got != domain.AnalysisReady {
		t.Fatalf("reanalysis failure status=%q", got)
	}
	withAnalysis.IsStale = true
	if got := analysisStatusAfterFailure(withAnalysis); got != domain.AnalysisStale {
		t.Fatalf("stale reanalysis failure status=%q", got)
	}
}

func TestAnalysisRepositoryUsesAnalyzedRevisionForStaleWalkthrough(t *testing.T) {
	repository := gitcache.ManagedRepository{BaseSHA: "current-base", HeadSHA: "current-head"}
	session := domain.ReviewSession{IsStale: true, Analysis: &domain.ReviewAnalysis{BaseSHA: "analyzed-base", HeadSHA: "analyzed-head"}}

	got := analysisRepository(session, repository)
	if got.BaseSHA != "analyzed-base" || got.HeadSHA != "analyzed-head" {
		t.Fatalf("stale evidence revisions = %q..%q", got.BaseSHA, got.HeadSHA)
	}
	if got.BaseSHA == repository.BaseSHA && got.HeadSHA == repository.HeadSHA {
		t.Fatal("stale analysis revision should be detectable without loading changed files")
	}

	session.IsStale = false
	got = analysisRepository(session, repository)
	if got.BaseSHA != repository.BaseSHA || got.HeadSHA != repository.HeadSHA {
		t.Fatalf("current evidence revisions changed = %q..%q", got.BaseSHA, got.HeadSHA)
	}
}

func TestAnalysisWasCancelledRecognizesContextAndWrappedError(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if !analysisWasCancelled(cancelled, errors.New("snapshot interrupted")) {
		t.Fatal("cancelled context was not recognized")
	}
	if !analysisWasCancelled(context.Background(), fmt.Errorf("prepare: %w", context.Canceled)) {
		t.Fatal("wrapped cancellation was not recognized")
	}
	if analysisWasCancelled(context.Background(), errors.New("network failed")) {
		t.Fatal("ordinary failure was treated as cancellation")
	}
}

func TestBuildReviewPayloadSeparatesGeneralAndInlineComments(t *testing.T) {
	startLine := 24
	line := 27
	payload := buildReviewPayload(PublishPreview{HeadSHA: "head", Items: []PublishItem{
		{Kind: domain.CommentGeneral, Body: "First general note"},
		{Kind: domain.CommentInline, Body: "Check this branch", Path: "internal/store.go", StartLine: &startLine, StartSide: domain.DiffSideRight, Line: &line, Side: domain.DiffSideRight},
		{Kind: domain.CommentGeneral, Body: "Second general note"},
	}})
	var got struct {
		CommitID string `json:"commit_id"`
		Body     string `json:"body"`
		Event    string `json:"event"`
		Comments []struct {
			Path      string          `json:"path"`
			StartLine int             `json:"start_line"`
			StartSide domain.DiffSide `json:"start_side"`
			Line      int             `json:"line"`
			Side      domain.DiffSide `json:"side"`
			Body      string          `json:"body"`
		} `json:"comments"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got.CommitID != "head" || got.Body != "First general note\n\nSecond general note" || got.Event != "COMMENT" || len(got.Comments) != 1 {
		t.Fatalf("payload=%s", payload)
	}
	if got.Comments[0].Path != "internal/store.go" || got.Comments[0].StartLine != startLine || got.Comments[0].StartSide != domain.DiffSideRight || got.Comments[0].Line != line || got.Comments[0].Side != domain.DiffSideRight {
		t.Fatalf("inline=%+v", got.Comments[0])
	}
}

func TestValidateInlineDiffAcceptsOnlyPresentOrderedRanges(t *testing.T) {
	old4, old5, new4, new5 := 4, 5, 4, 5
	diff := domain.DiffFile{Hunks: []domain.DiffHunk{
		{Lines: []domain.DiffLine{
			{Kind: domain.DiffContext, OldLine: &old4, NewLine: &new4},
			{Kind: domain.DiffDelete, OldLine: &old5},
			{Kind: domain.DiffAdd, NewLine: &new5},
		}},
	}}
	start, end := 4, 5
	if err := validateInlineDiff(diff, &start, domain.DiffSideRight, &end, domain.DiffSideRight); err != nil {
		t.Fatalf("valid range rejected: %v", err)
	}
	missing := 3
	if err := validateInlineDiff(diff, &missing, domain.DiffSideRight, &end, domain.DiffSideRight); err == nil || !strings.Contains(err.Error(), "start") {
		t.Fatalf("missing start error = %v", err)
	}
	reversedStart, reversedEnd := 5, 4
	normalized, err := normalizeInlineDiff(diff, &reversedStart, domain.DiffSideRight, &reversedEnd, domain.DiffSideRight)
	if err != nil || normalized.StartLine == nil || *normalized.StartLine != 4 || normalized.Line == nil || *normalized.Line != 5 {
		t.Fatalf("same-side reverse normalization = %+v, %v", normalized, err)
	}
	crossStart, crossEnd := 5, 5
	normalized, err = normalizeInlineDiff(diff, &crossStart, domain.DiffSideRight, &crossEnd, domain.DiffSideLeft)
	if err != nil || normalized.StartLine == nil || *normalized.StartLine != 5 || normalized.StartSide != domain.DiffSideLeft || normalized.Line == nil || *normalized.Line != 5 || normalized.Side != domain.DiffSideRight {
		t.Fatalf("cross-side reverse normalization = %+v, %v", normalized, err)
	}
	payload := buildReviewPayload(PublishPreview{HeadSHA: "head", Items: []PublishItem{{Kind: domain.CommentInline, Body: "replacement", Path: "file.go", StartLine: normalized.StartLine, StartSide: normalized.StartSide, Line: normalized.Line, Side: normalized.Side}}})
	if !bytes.Contains(payload, []byte(`"start_line":5,"start_side":"LEFT","line":5,"side":"RIGHT"`)) {
		t.Fatalf("normalized cross-side payload = %s", payload)
	}
}

func TestBuildReviewPayloadUsesExplicitDecisionEvent(t *testing.T) {
	payload := buildReviewPayload(PublishPreview{HeadSHA: "head", Event: "APPROVE"})
	var got struct {
		Event string `json:"event"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got.Event != "APPROVE" {
		t.Fatalf("event=%q payload=%s", got.Event, payload)
	}
}

func TestNormalizeSessionMakesEveryFrontendCollectionNonNil(t *testing.T) {
	session := normalizeSession(domain.ReviewSession{Analysis: &domain.ReviewAnalysis{Chapters: []domain.ReviewChapter{{}}}})
	if session.PullRequest.Relationships == nil || session.PullRequest.Labels == nil || session.PullRequest.Commits == nil || session.PullRequest.Reviews == nil || session.PullRequest.ReviewComments == nil || session.PullRequest.CheckRuns == nil || session.Chapters == nil || session.Notes == nil || session.Comments == nil {
		t.Fatalf("session collections were not normalized: %+v", session)
	}
	analysis := session.Analysis
	if analysis.SummaryEvidence == nil || analysis.SummaryValidation != domain.ValidationUnverified || analysis.AffectedAreas == nil || analysis.Risks == nil || analysis.Facts == nil || analysis.Inferences == nil || analysis.Unknowns == nil || analysis.ValidationIssues == nil {
		t.Fatalf("analysis collections were not normalized: %+v", analysis)
	}
	chapter := analysis.Chapters[0]
	if chapter.Evidence == nil || chapter.Files == nil || chapter.Symbols == nil || chapter.BehavioralChanges == nil || chapter.Risks == nil || chapter.Facts == nil || chapter.Inferences == nil || chapter.Unknowns == nil || chapter.RelatedTests == nil || chapter.SuggestedQuestions == nil {
		t.Fatalf("chapter collections were not normalized: %+v", chapter)
	}
}

func TestOpenPullRequestReturnsCoreBeforeRefreshingFullContext(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	baseSHA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	headSHA := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	metadata := `{"number":7,"title":"Fixture PR","html_url":"https://github.com/acme/api/pull/7","updated_at":"2026-07-11T12:00:00Z","user":{"login":"author"},"base":{"ref":"main","sha":"` + baseSHA + `","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}},"head":{"ref":"feature","sha":"` + headSHA + `","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}}}`
	reviews := []byte(`[[{"id":11,"user":{"login":"alice"},"body":"Please cover the retry path.","state":"COMMENTED","commit_id":"` + headSHA + `","submitted_at":"2026-07-11T13:00:00Z","html_url":"https://github.com/acme/api/pull/7#pullrequestreview-11"}]]`)
	comments := []byte(`[[{"id":101,"pull_request_review_id":11,"user":{"login":"alice"},"body":"Can this race?","path":"quota/limiter.go","line":16,"side":"RIGHT","commit_id":"` + headSHA + `","created_at":"2026-07-11T13:01:00Z","updated_at":"2026-07-11T13:01:00Z","html_url":"https://github.com/acme/api/pull/7#discussion_r101"}]]`)
	checks := []byte(`[{"check_runs":[{"id":21,"name":"test","status":"completed","conclusion":"success","html_url":"https://github.com/acme/api/actions/runs/21"}]}]`)
	runner := &pullRequestFixtureRunner{metadata: []byte(metadata), reviews: reviews, comments: comments, checks: checks}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}

	core, err := app.OpenPullRequest(ref)
	if err != nil {
		t.Fatal(err)
	}
	if len(runner.commands) != 2 {
		t.Fatalf("open commands=%d, want metadata and commits only: %v", len(runner.commands), runner.commands)
	}
	if len(core.PullRequest.Reviews) != 0 || len(core.PullRequest.ReviewComments) != 0 || len(core.PullRequest.CheckRuns) != 0 {
		t.Fatalf("core open unexpectedly waited for context: %+v", core.PullRequest)
	}

	hydrated, err := app.RefreshPullRequestContext(core.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runner.commands) != 5 || len(hydrated.PullRequest.Reviews) != 1 || len(hydrated.PullRequest.ReviewComments) != 1 || len(hydrated.PullRequest.CheckRuns) != 1 {
		t.Fatalf("hydrated session=%+v commands=%d", hydrated.PullRequest, len(runner.commands))
	}
	persisted, err := store.GetSession(ctx, core.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := existingDiscussion(persisted.PullRequest); !strings.Contains(got, "Please cover the retry path.") || !strings.Contains(got, "Can this race?") {
		t.Fatalf("analysis discussion context=%q", got)
	}
}

func TestPullRequestContextOverflowLeavesCoreSessionUsable(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	baseSHA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	headSHA := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	metadata := `{"number":7,"title":"Large PR","base":{"ref":"main","sha":"` + baseSHA + `","repo":{"name":"api","owner":{"login":"acme"}}},"head":{"ref":"feature","sha":"` + headSHA + `","repo":{"name":"api","owner":{"login":"acme"}}}}`
	runner := &pullRequestFixtureRunner{metadata: []byte(metadata)}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}
	core, err := app.OpenPullRequest(ref)
	if err != nil {
		t.Fatal(err)
	}
	runner.contextErr = fmt.Errorf("gh stdout exceeded its limit: %w", proc.ErrOutputLimitExceeded)
	if _, err := app.RefreshPullRequestContext(core.ID); !errors.Is(err, proc.ErrOutputLimitExceeded) {
		t.Fatalf("context error=%v, want ErrOutputLimitExceeded", err)
	}
	persisted, err := store.GetSession(ctx, core.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.PullRequest.Title != "Large PR" || persisted.PullRequest.HeadSHA != headSHA || len(persisted.PullRequest.Reviews) != 0 || len(persisted.PullRequest.ReviewComments) != 0 {
		t.Fatalf("core session was not preserved after context overflow: %+v", persisted.PullRequest)
	}
}

func TestPullRequestContextRejectsAStaleRevisionBeforeSaving(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	oldHead := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	newHead := "cccccccccccccccccccccccccccccccccccccccc"
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}
	session := domain.ReviewSession{ID: "stale-context", PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: ref}, HeadSHA: oldHead}, HeadSHA: oldHead}
	if err := store.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	runner := &pullRequestFixtureRunner{contextHook: func() {
		current, loadErr := store.GetSession(ctx, session.ID)
		if loadErr != nil {
			t.Errorf("load concurrent session: %v", loadErr)
			return
		}
		current.HeadSHA = newHead
		current.PullRequest.HeadSHA = newHead
		if saveErr := store.SaveSession(ctx, current); saveErr != nil {
			t.Errorf("save concurrent session: %v", saveErr)
		}
	}}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store}

	if _, err := app.RefreshPullRequestContext(session.ID); err == nil || !strings.Contains(err.Error(), "revision changed") {
		t.Fatalf("stale context error=%v", err)
	}
	persisted, err := store.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.PullRequest.HeadSHA != newHead || len(persisted.PullRequest.Reviews) != 0 || len(persisted.PullRequest.ReviewComments) != 0 || len(persisted.PullRequest.CheckRuns) != 0 {
		t.Fatalf("stale context was applied: %+v", persisted.PullRequest)
	}
}

func TestStartAnalysisLoadsFullContextBeforePreparingSnapshot(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
	headSHA := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	pr := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 7}}, HeadSHA: headSHA}
	session := domain.ReviewSession{ID: "analysis-context", PullRequest: pr, BaseSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", HeadSHA: headSHA, Status: domain.SessionPreparing, AnalysisStatus: domain.AnalysisNotStarted}
	if err := store.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAnalysisProfile(ctx, domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "fixture", Reasoning: domain.ReasoningMedium}); err != nil {
		t.Fatal(err)
	}
	runner := &pullRequestFixtureRunner{contextErr: errors.New("discussion unavailable")}
	registry, err := agent.NewRegistry(appAnalysisAdapter{})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{github: githubclient.New(runner), store: store, runner: runner, harnesses: registry, prepared: map[string]preparedState{}, active: map[string]context.CancelFunc{}, analysisBySession: map[string]string{}}

	op, err := app.StartAnalysis(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if op.Stage != "loadingPullRequestContext" {
		t.Fatalf("initial analysis stage=%q", op.Stage)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		current, loadErr := store.GetSession(ctx, session.ID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if current.AnalysisStatus == domain.AnalysisFailed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("analysis did not fail at the required context boundary")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(runner.commands) != 3 {
		t.Fatalf("analysis context commands=%d, want reviews, comments, and checks", len(runner.commands))
	}
	for _, command := range runner.commands {
		endpoint := command.Args[len(command.Args)-1]
		if !strings.Contains(endpoint, "/reviews") && !strings.Contains(endpoint, "/comments") && !strings.Contains(endpoint, "/check-runs") {
			t.Fatalf("analysis reached non-context endpoint before context completed: %q", endpoint)
		}
	}
}

func TestActiveAnalysisOperationRestoresHistoryAndCancelIdentity(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	cancelled := false
	app := &App{
		store:             store,
		active:            map[string]context.CancelFunc{"operation-1": func() { cancelled = true }},
		analysisBySession: map[string]string{"session-1": "operation-1"},
		operationHistory:  map[string][]Operation{},
	}
	first := Operation{ID: "operation-1", SessionID: "session-1", RunID: "run-1", Kind: "analysis", Stage: "preparingContext", State: "running", Message: "Preparing bounded review context"}
	second := first
	second.Stage = "analyzingChange"
	second.Message = "Reading src/greet.go lines 1–20"
	app.emitOperation(first)
	app.emitOperation(second)

	snapshot, err := app.GetActiveAnalysisOperation("session-1")
	if err != nil || snapshot == nil || snapshot.Operation.Stage != second.Stage || snapshot.Operation.Message != second.Message || len(snapshot.Events) != 2 || snapshot.Events[0].Stage != first.Stage {
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
	if snapshot.Events[0].UpdatedAt.IsZero() || snapshot.Events[1].UpdatedAt.IsZero() || snapshot.Events[1].UpdatedAt.Before(snapshot.Events[0].UpdatedAt) {
		t.Fatalf("operation history is not timestamped in order: %+v", snapshot.Events)
	}
	if err := app.CancelOperation(snapshot.Operation.ID); err != nil || !cancelled {
		t.Fatalf("cancelled=%t err=%v", cancelled, err)
	}
	second.State = "failed"
	app.emitOperation(second)
	if snapshot, err := app.GetActiveAnalysisOperation("session-1"); err != nil || snapshot != nil {
		t.Fatalf("terminal snapshot=%+v err=%v", snapshot, err)
	}
}

func TestStartAnalysisWithProfilePersistsTheExplicitHarnessInsteadOfTheSavedDefault(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	headSHA := strings.Repeat("b", 40)
	session := domain.ReviewSession{ID: "explicit-profile", PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}}, HeadSHA: headSHA}, BaseSHA: strings.Repeat("a", 40), HeadSHA: headSHA, Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
	if err := store.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAnalysisProfile(ctx, domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "fixture", Reasoning: domain.ReasoningMedium}); err != nil {
		t.Fatal(err)
	}
	registry, err := agent.NewRegistry(selectableAppAnalysisAdapter{id: domain.HarnessCodex}, selectableAppAnalysisAdapter{id: domain.HarnessClaude})
	if err != nil {
		t.Fatal(err)
	}
	runner := &pullRequestFixtureRunner{contextErr: errors.New("discussion unavailable")}
	app := &App{github: githubclient.New(runner), store: store, runner: runner, harnesses: registry, prepared: map[string]preparedState{}, active: map[string]context.CancelFunc{}, analysisBySession: map[string]string{}}
	profile := domain.AnalysisProfile{Harness: domain.HarnessClaude, Model: "fixture", Reasoning: domain.ReasoningMedium}

	if _, err := app.StartAnalysisWithProfile(session.ID, AnalysisRequest{Profile: &profile}); err != nil {
		t.Fatal(err)
	}
	runs, err := store.ListAnalysisRuns(ctx, session.ID)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs=%+v err=%v", runs, err)
	}
	if runs[0].Profile != profile {
		t.Fatalf("analysis run profile=%+v, want explicit profile %+v", runs[0].Profile, profile)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		current, loadErr := store.GetSession(ctx, session.ID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if current.AnalysisStatus == domain.AnalysisFailed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("analysis did not finish after the fixture context failure")
		}
		time.Sleep(10 * time.Millisecond)
	}
	saved, err := store.GetAnalysisProfile(ctx)
	if err != nil || saved.Harness != domain.HarnessCodex {
		t.Fatalf("saved default=%+v err=%v, want Codex unchanged", saved, err)
	}
}

func TestStartAnalysisWithoutHarnessLeavesSessionUsable(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	session := domain.ReviewSession{ID: "no-harness", PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}}}, BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
	if err := store.SaveSession(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	registry, _ := agent.NewRegistry(appAnalysisAdapter{})
	app := &App{store: store, harnesses: registry}
	_, err = app.StartAnalysis(session.ID)
	var resolution *agent.ResolutionError
	if !errors.As(err, &resolution) || resolution.Failure.Code != domain.FailureConfigurationRequired {
		t.Fatalf("error=%v", err)
	}
	loaded, loadErr := store.GetSession(context.Background(), session.ID)
	if loadErr != nil || loaded.Status != domain.SessionReady || loaded.AnalysisStatus != domain.AnalysisNotStarted || loaded.LatestAnalysisRun != nil {
		t.Fatalf("session=%+v err=%v", loaded, loadErr)
	}
}

func TestStartAnalysisRejectsUnchangedOversizedRetry(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	profile := domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "fixture", Reasoning: domain.ReasoningMedium}
	if err := store.SaveAnalysisProfile(context.Background(), profile); err != nil {
		t.Fatal(err)
	}
	session := domain.ReviewSession{ID: "oversized", PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}}}, BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), Status: domain.SessionReady, AnalysisStatus: domain.AnalysisNotStarted}
	if err := store.SaveSession(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	capabilities, _ := appAnalysisAdapter{}.Capabilities(context.Background())
	run := domain.AnalysisRun{ID: "oversized-run", SessionID: session.ID, Profile: profile, HarnessVersion: capabilities.Version, ContextTransport: domain.ContextReviewArcTools, SchemaVersion: sharedanalysis.SchemaVersion, InputFingerprint: analysisFingerprint(session, profile, capabilities.Version, domain.ContextReviewArcTools)}
	if err := store.StartAnalysisRun(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	failure := domain.AnalysisFailure{Code: domain.FailureInputTooLarge, Title: "Too large", Message: "Change the plan", Action: domain.RetryChangeProfile}
	if err := store.FailAnalysisRun(context.Background(), run.ID, failure, domain.AnalysisCoverage{}); err != nil {
		t.Fatal(err)
	}
	registry, _ := agent.NewRegistry(appAnalysisAdapter{})
	app := &App{store: store, harnesses: registry}
	if _, err := app.StartAnalysis(session.ID); err == nil || !strings.Contains(err.Error(), "will not repeat") {
		t.Fatalf("unchanged retry error=%v", err)
	}
	runs, err := store.ListAnalysisRuns(context.Background(), session.ID)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs=%+v err=%v", runs, err)
	}
}

func TestPromptVersionChangeAllowsOversizedAnalysisReplan(t *testing.T) {
	profile := domain.AnalysisProfile{Harness: domain.HarnessCodex, Model: "fixture", Reasoning: domain.ReasoningMedium}
	session := domain.ReviewSession{PullRequest: domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}}}, BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40)}
	capabilities, _ := appAnalysisAdapter{}.Capabilities(context.Background())
	current := analysisFingerprint(session, profile, capabilities.Version, domain.ContextReviewArcTools)
	legacy := analysisFingerprintWithPromptVersion(session, profile, capabilities.Version, domain.ContextReviewArcTools, analysisPromptVersion-1)
	if current == legacy {
		t.Fatal("prompt version did not change the analysis fingerprint")
	}
	prior := &domain.AnalysisRun{InputFingerprint: legacy, Status: domain.AnalysisRunFailed, Failure: &domain.AnalysisFailure{Code: domain.FailureInputTooLarge}}
	if unchangedOversizedRetryBlocked(prior, current) {
		t.Fatal("a previous prompt version remained blocked after the analysis plan changed")
	}
	prior.InputFingerprint = current
	if !unchangedOversizedRetryBlocked(prior, current) {
		t.Fatal("an unchanged current analysis plan was not blocked")
	}
}

func TestPublishRequiresMatchingConfirmationAndUsesFixtureBackedGitHubFlow(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api", CloneURL: "https://github.com/acme/api.git"}
	baseSHA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	headSHA := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	pr := domain.PullRequest{
		PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 7}, Title: "Fixture PR"},
		BaseSHA:            baseSHA, HeadSHA: headSHA, BaseRef: "main", HeadRef: "feature", HeadRepository: ref,
	}
	session := domain.ReviewSession{ID: "session", PullRequest: pr, BaseSHA: baseSHA, HeadSHA: headSHA, Status: domain.SessionReady, AnalysisStatus: domain.AnalysisReady}
	if err := store.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	draft := domain.ReviewComment{ID: "draft", SessionID: session.ID, Kind: domain.CommentGeneral, Body: "Please verify rollback behavior.", Status: domain.CommentDraft}
	if err := store.SaveComment(ctx, draft); err != nil {
		t.Fatal(err)
	}
	metadata := `{"number":7,"title":"Fixture PR","html_url":"https://github.com/acme/api/pull/7","updated_at":"2026-07-11T12:00:00Z","user":{"login":"author"},"base":{"ref":"main","sha":"` + baseSHA + `","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}},"head":{"ref":"feature","sha":"` + headSHA + `","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}}}`
	runner := &pullRequestFixtureRunner{metadata: []byte(metadata)}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store, publish: map[string]pendingPublish{}}

	preview, err := app.PreparePublish(session.ID, []string{draft.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.ConfirmPublish(preview.Token, "wrong digest"); err == nil {
		t.Fatal("publish accepted a mismatched confirmation digest")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("GitHub called before valid confirmation: %+v", runner.commands)
	}
	if _, err := app.ConfirmPublish(preview.Token, preview.Digest); err == nil {
		t.Fatal("consumed confirmation token was reusable")
	}

	preview, err = app.PreparePublish(session.ID, []string{draft.ID})
	if err != nil {
		t.Fatal(err)
	}
	published, err := app.ConfirmPublish(preview.Token, preview.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if len(published) != 1 || published[0].Status != domain.CommentPublished || published[0].GitHubID != "991" {
		t.Fatalf("published=%+v", published)
	}
	if len(runner.commands) != 6 {
		t.Fatalf("commands=%d, want detail metadata, commits, reviews, comments, checks, and publish", len(runner.commands))
	}
	var publishCommand proc.Command
	for _, command := range runner.commands {
		if reflect.DeepEqual(command.Args, []string{"api", "--method", "POST", "repos/acme/api/pulls/7/reviews", "--input", "-"}) {
			publishCommand = command
			break
		}
	}
	if publishCommand.Tool != proc.GH || !reflect.DeepEqual(publishCommand.Args, []string{"api", "--method", "POST", "repos/acme/api/pulls/7/reviews", "--input", "-"}) {
		t.Fatalf("publish command=%+v", publishCommand)
	}
	var payload struct {
		CommitID string `json:"commit_id"`
		Body     string `json:"body"`
		Event    string `json:"event"`
	}
	if err := json.Unmarshal(publishCommand.Stdin, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.CommitID != headSHA || payload.Body != draft.Body || payload.Event != "COMMENT" {
		t.Fatalf("publish payload=%s", publishCommand.Stdin)
	}
	got, err := store.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Comments) != 1 || got.Comments[0].Status != domain.CommentPublished || got.Comments[0].GitHubURL == "" {
		t.Fatalf("persisted comments=%+v", got.Comments)
	}
}

func TestExpiredPublishPreviewIsRejectedWithoutGitHubCall(t *testing.T) {
	runner := &appFixtureRunner{}
	app := &App{ctx: context.Background(), github: githubclient.New(runner), publish: map[string]pendingPublish{
		"expired": {preview: PublishPreview{Token: "expired", Digest: "digest", ExpiresAt: time.Now().Add(-time.Second)}},
	}}
	if _, err := app.ConfirmPublish("expired", "digest"); err == nil {
		t.Fatal("expired publish preview was accepted")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("GitHub called for expired confirmation: %+v", runner.commands)
	}
}

func TestThreadReplyRequiresConfirmationNormalizesRootAndPublishes(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx := context.Background()
	ref := domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}
	baseSHA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	headSHA := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	line := 16
	root := domain.PullRequestReviewComment{ID: 101, Author: domain.GitHubUser{Login: "alice"}, Body: "Root", Path: "quota/limiter.go", Line: &line, Side: domain.DiffSideRight}
	existingReply := domain.PullRequestReviewComment{ID: 102, ReplyToID: 101, Author: domain.GitHubUser{Login: "bob"}, Body: "Existing reply", Path: root.Path, Line: root.Line, Side: root.Side}
	pr := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: ref, Number: 7}, Title: "Fixture PR"}, BaseSHA: baseSHA, HeadSHA: headSHA, BaseRef: "main", HeadRef: "feature", HeadRepository: ref, ReviewComments: []domain.PullRequestReviewComment{root, existingReply}}
	session := domain.ReviewSession{ID: "session-reply", PullRequest: pr, BaseSHA: baseSHA, HeadSHA: headSHA, Status: domain.SessionReady, AnalysisStatus: domain.AnalysisReady}
	if err := store.SaveSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	metadata := `{"number":7,"title":"Fixture PR","html_url":"https://github.com/acme/api/pull/7","updated_at":"2026-07-13T04:00:00Z","user":{"login":"author"},"base":{"ref":"main","sha":"` + baseSHA + `","repo":{"name":"api","owner":{"login":"acme"}}},"head":{"ref":"feature","sha":"` + headSHA + `","repo":{"name":"api","owner":{"login":"acme"}}}}`
	comments := []byte(`[[{"id":101,"pull_request_review_id":11,"user":{"login":"alice"},"body":"Root","path":"quota/limiter.go","line":16,"side":"RIGHT","commit_id":"` + headSHA + `","created_at":"2026-07-13T03:00:00Z","updated_at":"2026-07-13T03:00:00Z","html_url":"https://github.com/acme/api/pull/7#discussion_r101"}]]`)
	runner := &pullRequestFixtureRunner{metadata: []byte(metadata), comments: comments}
	app := &App{ctx: ctx, github: githubclient.New(runner), store: store, threadReplies: map[string]pendingThreadReply{}}

	preview, err := app.PrepareThreadReply(session.ID, existingReply.ID, "Follow-up")
	if err != nil {
		t.Fatal(err)
	}
	if preview.RootCommentID != root.ID || preview.RootAuthor != "alice" || preview.Body != "Follow-up" {
		t.Fatalf("preview=%+v", preview)
	}
	if _, err := app.ConfirmThreadReply(preview.Token, "wrong"); err == nil {
		t.Fatal("reply accepted a mismatched confirmation digest")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("GitHub called before valid confirmation: %+v", runner.commands)
	}
	preview, err = app.PrepareThreadReply(session.ID, root.ID, "Follow-up")
	if err != nil {
		t.Fatal(err)
	}
	reply, err := app.ConfirmThreadReply(preview.Token, preview.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if reply.ID != 202 || reply.ReplyToID != root.ID || reply.Body != "Follow-up" {
		t.Fatalf("reply=%+v", reply)
	}
	var publish proc.Command
	for _, command := range runner.commands {
		if reflect.DeepEqual(command.Args, []string{"api", "--method", "POST", "repos/acme/api/pulls/7/comments/101/replies", "--input", "-"}) {
			publish = command
		}
	}
	if publish.Tool != proc.GH || string(publish.Stdin) != `{"body":"Follow-up"}` {
		t.Fatalf("publish=%+v", publish)
	}
}
