package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type fakeRunner struct {
	mu        sync.Mutex
	responses []proc.Result
	errors    []error
	commands  []proc.Command
}

type pullRequestListRunner struct {
	mu       sync.Mutex
	results  map[string]proc.Result
	errors   map[string]error
	commands []proc.Command
}

type concurrencyRunner struct {
	mu       sync.Mutex
	active   int
	maximum  int
	commands int
	delay    time.Duration
}

type organizationAccessRunner struct {
	mu       sync.Mutex
	results  map[string]proc.Result
	errors   map[string]error
	commands []proc.Command
}

func (f *organizationAccessRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	endpoint := command.Args[len(command.Args)-1]
	f.mu.Lock()
	f.commands = append(f.commands, command)
	f.mu.Unlock()
	return f.results[endpoint], f.errors[endpoint]
}

func (f *fakeRunner) Run(_ context.Context, c proc.Command) (proc.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, c)
	i := len(f.commands) - 1
	var err error
	if i < len(f.errors) {
		err = f.errors[i]
	}
	return f.responses[i], err
}

func (r *pullRequestListRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	key := ""
	for index, arg := range command.Args {
		if arg == "-R" && index+1 < len(command.Args) {
			key = "repository:" + command.Args[index+1]
		}
		if strings.HasPrefix(arg, "search=org:") {
			organization := strings.TrimPrefix(strings.Fields(strings.TrimPrefix(arg, "search="))[0], "org:")
			key = "organization:" + organization
		}
	}
	r.mu.Lock()
	r.commands = append(r.commands, command)
	result, err := r.results[key], r.errors[key]
	r.mu.Unlock()
	return result, err
}

func (r *concurrencyRunner) Run(_ context.Context, _ proc.Command) (proc.Result, error) {
	r.mu.Lock()
	r.active++
	r.commands++
	if r.active > r.maximum {
		r.maximum = r.active
	}
	r.mu.Unlock()
	time.Sleep(r.delay)
	r.mu.Lock()
	r.active--
	r.mu.Unlock()
	return proc.Result{Stdout: []byte(`[]`)}, nil
}

func TestCurrentUserUsesStructuredAPI(t *testing.T) {
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(`{"login":"sean","name":"Sean","avatar_url":"https://example/avatar"}`)}}}
	u, err := New(f).CurrentUser(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.Login != "sean" {
		t.Fatalf("login=%q", u.Login)
	}
	if got := f.commands[0].Args; len(got) != 2 || got[0] != "api" || got[1] != "user" {
		t.Fatalf("args=%v", got)
	}
}

func TestExpiredAuthIsDistinct(t *testing.T) {
	f := &fakeRunner{responses: []proc.Result{{Stderr: []byte("The token in default is invalid")}}, errors: []error{errors.New("exit 1")}}
	_, err := New(f).CurrentUser(context.Background())
	var auth *AuthError
	if !errors.As(err, &auth) || auth.Kind != AuthExpired {
		t.Fatalf("error=%v", err)
	}
}

func TestCurrentUserClassifiesAuthenticationFailures(t *testing.T) {
	tests := []struct {
		name   string
		stderr string
		want   AuthErrorKind
	}{
		{name: "required", stderr: "not logged into any GitHub hosts", want: AuthRequired},
		{name: "expired", stderr: "HTTP 401: Bad credentials", want: AuthExpired},
		{name: "forbidden", stderr: "HTTP 403: Forbidden", want: AuthForbidden},
		{name: "network", stderr: "could not resolve host github.com", want: AuthNetwork},
		{name: "unknown", stderr: "unexpected gh failure", want: AuthUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := &fakeRunner{responses: []proc.Result{{Stderr: []byte(test.stderr)}}, errors: []error{errors.New("exit 1")}}
			_, err := New(f).CurrentUser(context.Background())
			var auth *AuthError
			if !errors.As(err, &auth) || auth.Kind != test.want {
				t.Fatalf("error=%v, want kind %q", err, test.want)
			}
		})
	}
}

func TestCurrentUserRejectsMalformedOrIncompleteData(t *testing.T) {
	for _, body := range []string{`not-json`, `{"name":"Missing login"}`} {
		f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(body)}}}
		if _, err := New(f).CurrentUser(context.Background()); err == nil {
			t.Fatalf("CurrentUser accepted %q", body)
		}
	}
}

func TestListOrganizationsFlattensPagesDeduplicatesAndSorts(t *testing.T) {
	body := `[[{"login":"Zeta","description":"Z","avatar_url":"z"},{"login":"acme","description":"A"}],[{"login":"ACME","description":"duplicate"},{"login":"beta","description":"B"}]]`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(body)}}}
	got, err := New(f).ListOrganizations(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Login != "acme" || got[1].Login != "beta" || got[2].Login != "Zeta" {
		t.Fatalf("organizations=%+v", got)
	}
	if args := f.commands[0].Args; !reflect.DeepEqual(args[:3], []string{"api", "--paginate", "--slurp"}) {
		t.Fatalf("organization command=%v", args)
	}
}

func TestCheckOrganizationAccessClassifiesSSODeniedAndUnknown(t *testing.T) {
	ssoURL := "https://github.com/orgs/locked/sso?authorization_request=temporary"
	f := &organizationAccessRunner{
		results: map[string]proc.Result{
			"orgs/open/repos?type=all&per_page=1":    {Stdout: []byte("HTTP/2.0 200 OK\r\n\r\n")},
			"orgs/locked/repos?type=all&per_page=1":  {Stdout: []byte("HTTP/2.0 403 Forbidden\r\nX-GitHub-SSO: required; url=" + ssoURL + "\r\n\r\n"), ExitCode: 1},
			"orgs/denied/repos?type=all&per_page=1":  {Stdout: []byte("HTTP/2.0 403 Forbidden\r\n\r\n"), ExitCode: 1},
			"orgs/unknown/repos?type=all&per_page=1": {Stderr: []byte("network unavailable"), ExitCode: 1},
		},
		errors: map[string]error{
			"orgs/locked/repos?type=all&per_page=1":  errors.New("exit 1"),
			"orgs/denied/repos?type=all&per_page=1":  errors.New("exit 1"),
			"orgs/unknown/repos?type=all&per_page=1": errors.New("exit 1"),
		},
	}
	organizations := []domain.Organization{{Login: "open"}, {Login: "locked"}, {Login: "denied"}, {Login: "unknown"}, {Login: "../invalid"}}
	got := New(f).CheckOrganizationAccess(context.Background(), organizations)
	if got[0].AccessStatus != OrganizationAccessAvailable || got[1].AccessStatus != OrganizationAccessSSORequired || got[1].SSOURL != ssoURL || got[2].AccessStatus != OrganizationAccessDenied || got[3].AccessStatus != OrganizationAccessUnknown || got[4].AccessStatus != OrganizationAccessUnknown {
		t.Fatalf("access=%+v", got)
	}
	if len(f.commands) != 4 {
		t.Fatalf("invalid organization reached gh; commands=%d", len(f.commands))
	}
	want := []string{"api", "-i", "--silent", "orgs/locked/repos?type=all&per_page=1"}
	found := false
	for _, command := range f.commands {
		found = found || reflect.DeepEqual(command.Args, want)
	}
	if !found {
		t.Fatalf("SSO probe missing from commands=%v", f.commands)
	}
}

func TestGetRepositoryReturnsArchivedStatusFromStructuredOutput(t *testing.T) {
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(`{"id":"R_1","name":"old","nameWithOwner":"acme/old","description":"Archived","updatedAt":"2026-07-12T00:00:00Z","isPrivate":true,"isArchived":true,"owner":{"login":"acme"}}`)}}}
	repository, err := New(f).GetRepository(context.Background(), domain.RepositoryRef{Owner: "acme", Name: "old"})
	if err != nil {
		t.Fatal(err)
	}
	if !repository.IsArchived || repository.Ref.Owner != "acme" || repository.Ref.Name != "old" {
		t.Fatalf("repository=%+v", repository)
	}
	want := []string{"repo", "view", "acme/old", "--json", "id,name,nameWithOwner,description,updatedAt,isPrivate,isArchived,owner"}
	if !reflect.DeepEqual(f.commands[0].Args, want) {
		t.Fatalf("command=%v", f.commands[0].Args)
	}
}

func TestSSOAuthorizationURLRejectsUntrustedDestinations(t *testing.T) {
	valid := []byte("HTTP/2.0 403 Forbidden\r\nX-GitHub-SSO: required; url=https://github.com/orgs/acme/sso?authorization_request=temporary\r\n")
	if got := parseSSOAuthorizationURL(valid, "acme"); got == "" {
		t.Fatal("valid GitHub SSO URL was rejected")
	}
	for _, raw := range []string{
		"https://evil.example/orgs/acme/sso?authorization_request=temporary",
		"https://github.com/orgs/other/sso?authorization_request=temporary",
		"http://github.com/orgs/acme/sso?authorization_request=temporary",
		"https://github.com/orgs/acme/sso",
	} {
		response := []byte("HTTP/2.0 403 Forbidden\nX-GitHub-SSO: required; url=" + raw + "\n")
		if got := parseSSOAuthorizationURL(response, "acme"); got != "" {
			t.Fatalf("untrusted SSO URL accepted: %q", got)
		}
	}
}

func TestRepositoryAndInboxParsing(t *testing.T) {
	repos := `[{"data":{"viewer":{"repositories":{"nodes":[{"id":"R1","name":"api","nameWithOwner":"acme/api","description":"backend","updatedAt":"2026-07-11T10:00:00Z","isPrivate":true,"isArchived":false,"owner":{"login":"acme"}}]}}}}]`
	prs := `[{"number":7,"title":"Fix races","url":"https://github.com/acme/api/pull/7","author":{"login":"sean"},"updatedAt":"2026-07-11T11:00:00Z","isDraft":false,"additions":12,"deletions":3,"changedFiles":2,"assignees":[{"login":"sean"}],"reviewRequests":[],"labels":[{"name":"bug"}],"reviewDecision":"CHANGES_REQUESTED"}]`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(repos)}, {Stdout: []byte(prs)}}}
	c := New(f)
	listed, err := c.ListRepositories(context.Background(), RepositoryQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].Ref.Owner != "acme" {
		t.Fatalf("repos=%+v", listed)
	}
	inbox := c.ListPullRequests(context.Background(), PullRequestQuery{Repositories: []domain.RepositoryRef{listed[0].Ref}, CurrentLogin: "sean"})
	if inbox.Partial || len(inbox.Items) != 1 {
		t.Fatalf("inbox=%+v", inbox)
	}
	if !contains(inbox.Items[0].Relationships, domain.RelationshipAuthored) || !contains(inbox.Items[0].Relationships, domain.RelationshipAssigned) {
		t.Fatalf("relationships=%v", inbox.Items[0].Relationships)
	}
	if inbox.Items[0].UpdatedAt.Equal(time.Time{}) {
		t.Fatal("updatedAt was not parsed")
	}
	if inbox.Items[0].ReviewDecision != "CHANGES_REQUESTED" {
		t.Fatalf("review decision=%q", inbox.Items[0].ReviewDecision)
	}
	if !reflect.DeepEqual(inbox.Items[0].Labels, []string{"bug"}) {
		t.Fatalf("labels=%v", inbox.Items[0].Labels)
	}
}

func TestListRepositoriesIncludesOrganizationRepositoriesAndDeduplicates(t *testing.T) {
	viewer := `[{"data":{"viewer":{"repositories":{"nodes":[{"id":"R1","name":"personal","nameWithOwner":"sean/personal","updatedAt":"2026-07-11T10:00:00Z","owner":{"login":"sean"}},{"id":"R2","name":"shared","nameWithOwner":"acme/shared","updatedAt":"2026-07-11T10:00:00Z","owner":{"login":"acme"}}]}}}}]`
	organization := `[{"data":{"organization":{"repositories":{"nodes":[{"id":"R2","name":"shared","nameWithOwner":"acme/shared","updatedAt":"2026-07-11T10:00:00Z","owner":{"login":"acme"}},{"id":"R3","name":"private-api","nameWithOwner":"acme/private-api","isPrivate":true,"updatedAt":"2026-07-12T10:00:00Z","owner":{"login":"acme"}},{"id":"R4","name":"archive","nameWithOwner":"acme/archive","isArchived":true,"updatedAt":"2026-07-10T10:00:00Z","owner":{"login":"acme"}}]}}}}]`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(viewer)}, {Stdout: []byte(organization)}}}

	got, err := New(f).ListRepositories(context.Background(), RepositoryQuery{Organizations: []string{"acme", "ACME"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Ref.Owner != "acme" || got[0].Ref.Name != "private-api" || got[1].Ref.Name != "shared" || got[2].Ref.Owner != "sean" {
		t.Fatalf("repositories=%+v", got)
	}
	if len(f.commands) != 2 {
		t.Fatalf("commands=%d, want viewer plus one deduplicated organization query", len(f.commands))
	}
	wantPrefix := []string{"api", "graphql", "--paginate", "--slurp", "-F", "login=acme"}
	if !reflect.DeepEqual(f.commands[1].Args[:len(wantPrefix)], wantPrefix) {
		t.Fatalf("organization command=%v", f.commands[1].Args)
	}
}

func TestListAccessibleRepositoriesPageUsesViewerAffiliationsAndCursor(t *testing.T) {
	body := `{"data":{"viewer":{"login":"sean","repositories":{"totalCount":12000,"nodes":[{"id":"R1","name":"api","nameWithOwner":"acme/api","description":"backend","owner":{"login":"acme"}},{"id":"R2","name":"old","nameWithOwner":"acme/old","isArchived":true,"owner":{"login":"acme"}}],"pageInfo":{"hasNextPage":true,"endCursor":"next-page"}}}}}`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(body)}}}
	page, err := New(f).ListAccessibleRepositoriesPage(context.Background(), AccessibleRepositoryPageQuery{Cursor: "current-page", PageSize: 500})
	if err != nil {
		t.Fatal(err)
	}
	if page.AccountLogin != "sean" || page.TotalCount != 12000 || len(page.Items) != 1 || page.Items[0].Ref.Owner != "acme" || page.Items[0].Ref.Name != "api" || !page.HasNextPage || page.EndCursor != "next-page" {
		t.Fatalf("page=%+v", page)
	}
	args := f.commands[0].Args
	if containsString(args, "--paginate") || !containsString(args, "first=100") || !containsString(args, "after=current-page") || !strings.Contains(args[len(args)-1], "affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER]") {
		t.Fatalf("accessible repository command=%v", args)
	}
	if _, err := New(&fakeRunner{}).ListAccessibleRepositoriesPage(context.Background(), AccessibleRepositoryPageQuery{Cursor: strings.Repeat("x", 4097)}); err == nil {
		t.Fatal("oversized cursor reached accessible repository paging")
	}
}

func TestListRepositoriesRejectsInvalidOrganizationBeforeRunningIt(t *testing.T) {
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(`[]`)}}}
	_, err := New(f).ListRepositories(context.Background(), RepositoryQuery{Organizations: []string{"../escape"}})
	if err == nil || len(f.commands) != 1 {
		t.Fatalf("error=%v commands=%d", err, len(f.commands))
	}
}

func TestListOwnerRepositoriesReturnsOneActiveCursorPage(t *testing.T) {
	body := `{"data":{"repositoryOwner":{"repositories":{"totalCount":52,"nodes":[{"id":"R1","name":"active","nameWithOwner":"acme/active","owner":{"login":"acme"}},{"id":"R2","name":"archive","nameWithOwner":"acme/archive","isArchived":true,"owner":{"login":"acme"}}],"pageInfo":{"hasNextPage":true,"endCursor":"cursor-1"}}}}}`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(body)}}}
	page, err := New(f).ListOwnerRepositories(context.Background(), RepositoryPageQuery{Owner: "acme"})
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 52 || !page.HasNextPage || page.EndCursor != "cursor-1" || len(page.Items) != 1 || page.Items[0].Ref.Name != "active" {
		t.Fatalf("page=%+v", page)
	}
	args := f.commands[0].Args
	if containsString(args, "--paginate") || containsString(args, "--slurp") || !containsString(args, "first=50") || !strings.Contains(args[len(args)-1], "isArchived:false") || !strings.Contains(args[len(args)-1], "ownerAffiliations:[OWNER]") {
		t.Fatalf("owner page command=%v", args)
	}
}

func TestListOwnerRepositoriesPassesCursorAndRejectsInvalidOwner(t *testing.T) {
	body := `{"data":{"repositoryOwner":{"repositories":{"totalCount":1,"nodes":[],"pageInfo":{}}}}}`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(body)}}}
	if _, err := New(f).ListOwnerRepositories(context.Background(), RepositoryPageQuery{Owner: "acme", Cursor: "cursor-1", PageSize: 500}); err != nil {
		t.Fatal(err)
	}
	if !containsString(f.commands[0].Args, "after=cursor-1") || !containsString(f.commands[0].Args, "first=100") {
		t.Fatalf("owner page command=%v", f.commands[0].Args)
	}
	if _, err := New(&fakeRunner{}).ListOwnerRepositories(context.Background(), RepositoryPageQuery{Owner: "../escape"}); err == nil {
		t.Fatal("invalid owner reached repository paging")
	}
	if _, err := New(&fakeRunner{}).ListOwnerRepositories(context.Background(), RepositoryPageQuery{Owner: "acme", Cursor: strings.Repeat("x", 4097)}); err == nil {
		t.Fatal("oversized cursor reached repository paging")
	}
}

func TestSearchOwnerRepositoriesUsesOneScopedCursorRequest(t *testing.T) {
	body := `{"data":{"search":{"repositoryCount":12000,"nodes":[{"id":"R50","name":"repo-50","nameWithOwner":"acme/repo-50","description":"match","owner":{"login":"acme"}}],"pageInfo":{"hasNextPage":true,"endCursor":"search-next"}}}}`
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(body)}}}
	page, err := New(f).SearchOwnerRepositories(context.Background(), RepositorySearchQuery{Owner: "acme", Query: `repo "50"`, Cursor: "search-cursor", Organization: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.commands) != 1 || page.TotalCount != 12000 || len(page.Items) != 1 || page.Items[0].Ref.Name != "repo-50" || !page.HasNextPage || page.EndCursor != "search-next" {
		t.Fatalf("page=%+v commands=%d", page, len(f.commands))
	}
	args := f.commands[0].Args
	if containsString(args, "--paginate") || containsString(args, "--slurp") || !containsString(args, "after=search-cursor") || !containsString(args, `search="repo \"50\"" in:name,description org:acme archived:false`) {
		t.Fatalf("repository search command=%v", args)
	}
}

func TestOrganizationPullRequestSearchAvoidsRepositoryFanoutAndPreservesRelationships(t *testing.T) {
	organization := `{"data":{"search":{"issueCount":1,"nodes":[{"number":7,"title":"Org change","url":"https://github.com/acme/api/pull/7","author":{"login":"dev"},"updatedAt":"2026-07-12T10:00:00Z","additions":4,"deletions":2,"changedFiles":1,"assignees":{"nodes":[{"login":"sean"}]},"reviewRequests":{"nodes":[{"requestedReviewer":{"login":"sean"}}]},"labels":{"nodes":[{"name":"security"}]},"headRefOid":"head","baseRefOid":"base","repository":{"id":"R1","name":"api","nameWithOwner":"acme/api","isPrivate":true,"owner":{"login":"acme"}}}]}}}`
	explicitDuplicate := `[{"number":7,"title":"Org change","url":"https://github.com/acme/api/pull/7","author":{"login":"dev"},"updatedAt":"2026-07-12T10:00:00Z"}]`
	f := &pullRequestListRunner{results: map[string]proc.Result{"organization:acme": {Stdout: []byte(organization)}, "repository:acme/api": {Stdout: []byte(explicitDuplicate)}}, errors: map[string]error{}}
	query := PullRequestQuery{Organizations: []string{"acme", "ACME"}, Repositories: []domain.RepositoryRef{{Owner: "acme", Name: "api"}}, CurrentLogin: "sean"}
	got := New(f).ListPullRequests(context.Background(), query)
	if got.Partial || len(got.Items) != 1 || len(f.commands) != 2 {
		t.Fatalf("inbox=%+v commands=%d", got, len(f.commands))
	}
	if !contains(got.Items[0].Relationships, domain.RelationshipAssigned) || !contains(got.Items[0].Relationships, domain.RelationshipReviewRequested) || got.Items[0].Ref.Repository.DatabaseID != "R1" {
		t.Fatalf("item=%+v", got.Items[0])
	}
	if !reflect.DeepEqual(got.Items[0].Labels, []string{"security"}) {
		t.Fatalf("labels=%v", got.Items[0].Labels)
	}
	var organizationArgs []string
	for _, command := range f.commands {
		if containsString(command.Args, "search=org:acme is:pr is:open archived:false sort:updated-desc") {
			organizationArgs = command.Args
		}
	}
	if containsString(organizationArgs, "--paginate") || containsString(organizationArgs, "--slurp") {
		t.Fatalf("organization search commands=%v", f.commands)
	}
}

func TestOrganizationPullRequestSearchReturnsOneNewestPageWithPartialWarning(t *testing.T) {
	nodes := make([]map[string]any, 100)
	for index := range nodes {
		number := index + 1
		nodes[index] = map[string]any{
			"number":    number,
			"title":     fmt.Sprintf("Change %d", number),
			"url":       fmt.Sprintf("https://github.com/acme/api/pull/%d", number),
			"updatedAt": fmt.Sprintf("2026-07-12T10:%02d:00Z", index%60),
			"repository": map[string]any{
				"id":            "R1",
				"name":          "api",
				"nameWithOwner": "acme/api",
				"owner":         map[string]any{"login": "acme"},
			},
		}
	}
	body, err := json.Marshal(map[string]any{
		"data": map[string]any{"search": map[string]any{"issueCount": 125, "nodes": nodes}},
	})
	if err != nil {
		t.Fatal(err)
	}
	runner := &pullRequestListRunner{
		results: map[string]proc.Result{"organization:acme": {Stdout: body}},
		errors:  map[string]error{},
	}

	got := New(runner).ListPullRequests(context.Background(), PullRequestQuery{Organizations: []string{"acme"}})
	if !got.Partial || len(got.Items) != 100 {
		t.Fatalf("inbox=%+v", got)
	}
	wantWarning := "Showing 100 of 125 open pull requests from acme, ordered by most recently updated. Narrow the source selection to review older work."
	if got.Errors["organization:acme"] != wantWarning {
		t.Fatalf("warning=%q, want %q", got.Errors["organization:acme"], wantWarning)
	}
	if len(runner.commands) != 1 {
		t.Fatalf("commands=%d, want one organization request", len(runner.commands))
	}
	args := runner.commands[0].Args
	if containsString(args, "--paginate") || containsString(args, "--slurp") || !strings.Contains(args[len(args)-1], "first:100") || !containsString(args, "search=org:acme is:pr is:open archived:false sort:updated-desc") {
		t.Fatalf("organization search command=%v", args)
	}
}

func TestInboxIsSortedAndIsolatesRepositoryFailures(t *testing.T) {
	old := `[{"number":1,"title":"Old","url":"https://github.com/acme/api/pull/1","author":{"login":"dev"},"updatedAt":"2026-07-10T10:00:00Z","headRefOid":"head1","baseRefOid":"base1"}]`
	newer := `[{"number":2,"title":"New","url":"https://github.com/acme/web/pull/2","author":{"login":"dev"},"updatedAt":"2026-07-11T10:00:00Z","reviewRequests":[{"login":"SEAN"}],"headRefOid":"head2","baseRefOid":"base2"}]`
	f := &pullRequestListRunner{
		results: map[string]proc.Result{"repository:acme/api": {Stdout: []byte(old)}, "repository:acme/bad": {Stderr: []byte("private details must not escape")}, "repository:acme/web": {Stdout: []byte(newer)}},
		errors:  map[string]error{"repository:acme/bad": errors.New("exit 1")},
	}
	repos := []domain.RepositoryRef{
		{Owner: "acme", Name: "api"},
		{Owner: "acme", Name: "bad"},
		{Owner: "acme", Name: "web"},
		{Owner: "../escape", Name: "repo"},
	}
	got := New(f).ListPullRequests(context.Background(), PullRequestQuery{Repositories: repos, CurrentLogin: "sean"})
	if !got.Partial || len(got.Items) != 2 || got.Items[0].Ref.Number != 2 || got.Items[1].Ref.Number != 1 {
		t.Fatalf("inbox=%+v", got)
	}
	if !contains(got.Items[0].Relationships, domain.RelationshipReviewRequested) {
		t.Fatalf("relationships=%v", got.Items[0].Relationships)
	}
	if got.Errors["acme/bad"] != "GitHub request failed; retry or refresh authentication." {
		t.Fatalf("unsafe or missing error=%q", got.Errors["acme/bad"])
	}
	if got.Errors["../escape/repo"] != "Invalid repository name" {
		t.Fatalf("invalid repository error=%q", got.Errors["../escape/repo"])
	}
	if len(f.commands) != 3 {
		t.Fatalf("invalid repository reached gh; commands=%d", len(f.commands))
	}
}

func TestInboxRepositoryFetchesUseBoundedConcurrency(t *testing.T) {
	runner := &concurrencyRunner{delay: 20 * time.Millisecond}
	repositories := make([]domain.RepositoryRef, 12)
	for index := range repositories {
		repositories[index] = domain.RepositoryRef{Owner: "acme", Name: fmt.Sprintf("repo-%02d", index)}
	}
	result := New(runner).ListPullRequests(context.Background(), PullRequestQuery{Repositories: repositories, CurrentLogin: "sean"})
	if result.Partial || len(result.Items) != 0 {
		t.Fatalf("inbox=%+v", result)
	}
	if runner.commands != len(repositories) || runner.maximum != 4 {
		t.Fatalf("commands=%d maximum concurrency=%d", runner.commands, runner.maximum)
	}
}

func TestPullRequestDetailParsesOverviewData(t *testing.T) {
	metadata := []byte(`{"number":4,"title":"Change","body":"why","html_url":"https://github.com/acme/api/pull/4","updated_at":"2026-07-11T11:00:00Z","user":{"login":"dev"},"base":{"ref":"main","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}},"head":{"ref":"topic","sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","repo":{"name":"api","clone_url":"https://github.com/fork/api.git","owner":{"login":"fork"}}},"additions":2,"deletions":1,"changed_files":2,"labels":[{"name":"security"}]}`)
	commits := []byte(`[[{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","commit":{"message":"change","author":{"name":"Dev","date":"2026-07-11T10:00:00Z"}},"author":{"login":"dev"}}]]`)
	detail, err := parsePullRequestDetail(metadata, commits)
	if err != nil {
		t.Fatal(err)
	}
	if detail.PullRequest.HeadRepository.Owner != "fork" || detail.PullRequest.URL == "" || detail.PullRequest.HeadRepository.CloneURL == "" || len(detail.PullRequest.Labels) != 1 || detail.PullRequest.Labels[0] != "security" || len(detail.PullRequest.Commits) != 1 {
		t.Fatalf("detail=%+v", detail)
	}
}

func TestPullRequestDetailRejectsUnavailableRepositoriesAndMalformedPages(t *testing.T) {
	metadataWithoutHead := []byte(`{"number":4,"base":{"repo":{"name":"api","owner":{"login":"acme"}}},"head":{"repo":null}}`)
	if _, err := parsePullRequestDetail(metadataWithoutHead, []byte(`[[]]`)); err == nil {
		t.Fatal("missing head repository was accepted")
	}
	metadata := []byte(`{"number":4,"base":{"repo":{"name":"api","owner":{"login":"acme"}}},"head":{"repo":{"name":"api","owner":{"login":"fork"}}}}`)
	if _, err := parsePullRequestDetail(metadata, []byte(`{}`)); err == nil {
		t.Fatal("malformed commit pagination was accepted")
	}
}

func TestPullRequestContextParsesFixtureBackedReviewsCommentsAndChecks(t *testing.T) {
	read := func(name string) []byte {
		t.Helper()
		body, err := os.ReadFile("testdata/" + name)
		if err != nil {
			t.Fatal(err)
		}
		return body
	}
	pr := domain.PullRequest{}
	if err := parsePullRequestContext(&pr, read("reviews.json"), read("review_comments.json"), read("check_runs.json")); err != nil {
		t.Fatal(err)
	}
	if len(pr.Reviews) != 2 || pr.Reviews[0].ID != 11 || pr.Reviews[1].State != "APPROVED" || pr.Reviews[0].Author.Login != "alice" {
		t.Fatalf("reviews=%+v", pr.Reviews)
	}
	if len(pr.ReviewComments) != 2 || pr.ReviewComments[0].ID != 101 || pr.ReviewComments[0].Line != nil || pr.ReviewComments[0].OriginalStartLine == nil || *pr.ReviewComments[0].OriginalStartLine != 38 || pr.ReviewComments[0].OriginalLine == nil || *pr.ReviewComments[0].OriginalLine != 40 || pr.ReviewComments[0].StartSide != domain.DiffSideLeft || pr.ReviewComments[1].ReplyToID != 101 || pr.ReviewComments[1].Side != domain.DiffSideRight {
		t.Fatalf("comments=%+v", pr.ReviewComments)
	}
	if len(pr.CheckRuns) != 2 || pr.CheckRuns[0].Name != "Lint" || pr.CheckRuns[1].AppName != "GitHub Actions" || pr.CheckRuns[1].Conclusion != "success" {
		t.Fatalf("checks=%+v", pr.CheckRuns)
	}
}

func TestPullRequestContextRejectsMalformedPagination(t *testing.T) {
	validReviews, validComments, validChecks := []byte(`[[]]`), []byte(`[[]]`), []byte(`[{"check_runs":[]}]`)
	tests := []struct {
		name                      string
		reviews, comments, checks []byte
	}{
		{name: "reviews", reviews: []byte(`{}`), comments: validComments, checks: validChecks},
		{name: "comments", reviews: validReviews, comments: []byte(`{}`), checks: validChecks},
		{name: "checks", reviews: validReviews, comments: validComments, checks: []byte(`{}`)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := parsePullRequestContext(&domain.PullRequest{}, test.reviews, test.comments, test.checks); err == nil {
				t.Fatal("malformed pagination was accepted")
			}
		})
	}
}

func TestGetPullRequestCoreStopsAtUsableRequestBoundary(t *testing.T) {
	sha := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	metadata := `{"number":4,"base":{"ref":"main","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repo":{"name":"api","owner":{"login":"acme"}}},"head":{"ref":"topic","sha":"` + sha + `","repo":{"name":"api","owner":{"login":"fork"}}}}`
	root := "repos/acme/api/pulls/4"
	f := &organizationAccessRunner{results: map[string]proc.Result{
		root:                           {Stdout: []byte(metadata)},
		root + "/commits?per_page=100": {Stdout: []byte(`[[]]`)},
	}, errors: map[string]error{}}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Owner: "acme", Name: "api"}, Number: 4}
	detail, err := New(f).GetPullRequestCore(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if detail.PullRequest.HeadSHA != sha || detail.PullRequest.Reviews == nil || detail.PullRequest.ReviewComments == nil || detail.PullRequest.CheckRuns == nil {
		t.Fatalf("core detail is not immediately usable: %+v", detail.PullRequest)
	}
	if len(f.commands) != 2 {
		t.Fatalf("core commands=%d, want metadata and commits only: %v", len(f.commands), f.commands)
	}
	for _, command := range f.commands {
		endpoint := command.Args[len(command.Args)-1]
		if strings.Contains(endpoint, "/reviews") || strings.Contains(endpoint, "/comments") || strings.Contains(endpoint, "/check-runs") {
			t.Fatalf("core hydration waited for deferred context endpoint %q", endpoint)
		}
	}
}

func TestGetPullRequestLoadsContextWithoutUnusedFilesEndpoint(t *testing.T) {
	sha := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	metadata := `{"number":4,"base":{"ref":"main","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repo":{"name":"api","owner":{"login":"acme"}}},"head":{"ref":"topic","sha":"` + sha + `","repo":{"name":"api","owner":{"login":"fork"}}}}`
	root := "repos/acme/api/pulls/4"
	f := &organizationAccessRunner{results: map[string]proc.Result{
		root:                            {Stdout: []byte(metadata)},
		root + "/commits?per_page=100":  {Stdout: []byte(`[[]]`)},
		root + "/reviews?per_page=100":  {Stdout: []byte(`[[]]`)},
		root + "/comments?per_page=100": {Stdout: []byte(`[[]]`)},
		"repos/acme/api/commits/" + sha + "/check-runs?per_page=100": {Stdout: []byte(`[{"check_runs":[]}]`)},
	}, errors: map[string]error{}}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Owner: "acme", Name: "api"}, Number: 4}
	detail, err := New(f).GetPullRequest(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if detail.PullRequest.Reviews == nil || detail.PullRequest.ReviewComments == nil || detail.PullRequest.CheckRuns == nil {
		t.Fatalf("context collections must be non-nil: %+v", detail.PullRequest)
	}
	wantEndpoints := []string{
		"repos/acme/api/pulls/4",
		"repos/acme/api/pulls/4/commits?per_page=100",
		"repos/acme/api/pulls/4/reviews?per_page=100",
		"repos/acme/api/pulls/4/comments?per_page=100",
		"repos/acme/api/commits/" + sha + "/check-runs?per_page=100",
	}
	if len(f.commands) != len(wantEndpoints) {
		t.Fatalf("commands=%d", len(f.commands))
	}
	gotEndpoints := map[string]bool{}
	for _, command := range f.commands {
		gotEndpoints[command.Args[len(command.Args)-1]] = true
	}
	if gotEndpoints[root+"/files?per_page=100"] {
		t.Fatalf("unused files endpoint was requested: commands=%v", f.commands)
	}
	for _, want := range wantEndpoints {
		if !gotEndpoints[want] {
			t.Fatalf("missing endpoint=%q from commands=%v", want, f.commands)
		}
	}
}

func TestReplyToReviewCommentUsesRootReplyEndpointAndStructuredInput(t *testing.T) {
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(`{"id":202,"pull_request_review_id":11,"in_reply_to_id":101,"user":{"login":"sean"},"body":"Follow-up","path":"quota/limiter.go","line":16,"side":"RIGHT","commit_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","created_at":"2026-07-13T04:00:00Z","updated_at":"2026-07-13T04:00:00Z","html_url":"https://github.com/acme/api/pull/7#discussion_r202"}`)}}}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Owner: "acme", Name: "api"}, Number: 7}
	reply, err := New(f).ReplyToReviewComment(context.Background(), ref, 101, "Follow-up")
	if err != nil {
		t.Fatal(err)
	}
	if reply.ID != 202 || reply.ReplyToID != 101 || reply.Author.Login != "sean" || reply.Body != "Follow-up" {
		t.Fatalf("reply=%+v", reply)
	}
	want := []string{"api", "--method", "POST", "repos/acme/api/pulls/7/comments/101/replies", "--input", "-"}
	if !reflect.DeepEqual(f.commands[0].Args, want) || string(f.commands[0].Stdin) != `{"body":"Follow-up"}` {
		t.Fatalf("command=%+v", f.commands[0])
	}
}

func TestReplyToReviewCommentRejectsInvalidInputBeforeGitHub(t *testing.T) {
	f := &fakeRunner{}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Owner: "../acme", Name: "api"}, Number: 7}
	if _, err := New(f).ReplyToReviewComment(context.Background(), ref, 0, " "); err == nil {
		t.Fatal("invalid reply was accepted")
	}
	if len(f.commands) != 0 {
		t.Fatalf("GitHub called for invalid reply: %+v", f.commands)
	}
}

func TestPublishReviewUsesStructuredInputAndFixedEndpoint(t *testing.T) {
	payload := []byte(`{"event":"COMMENT","body":"Looks good"}`)
	f := &fakeRunner{responses: []proc.Result{{Stdout: []byte(`{"id":42}`)}}}
	ref := domain.PullRequestRef{Repository: domain.RepositoryRef{Owner: "acme", Name: "api"}, Number: 7}
	got, err := New(f).PublishReview(context.Background(), ref, payload)
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(got) || len(f.commands) != 1 {
		t.Fatalf("response=%q commands=%d", got, len(f.commands))
	}
	command := f.commands[0]
	wantArgs := []string{"api", "--method", "POST", "repos/acme/api/pulls/7/reviews", "--input", "-"}
	if command.Tool != proc.GH || !reflect.DeepEqual(command.Args, wantArgs) || !reflect.DeepEqual(command.Stdin, payload) {
		t.Fatalf("publish command=%+v", command)
	}
	for _, invalid := range []domain.PullRequestRef{
		{Repository: domain.RepositoryRef{Owner: "../escape", Name: "api"}, Number: 7},
		{Repository: domain.RepositoryRef{Owner: "acme", Name: "api"}, Number: 0},
	} {
		if _, err := New(&fakeRunner{}).PublishReview(context.Background(), invalid, payload); err == nil {
			t.Fatalf("invalid ref accepted: %+v", invalid)
		}
	}
	if _, err := New(&fakeRunner{}).PublishReview(context.Background(), ref, []byte(`not-json`)); err == nil {
		t.Fatal("invalid JSON payload accepted")
	}
}

func contains(items []domain.Relationship, want domain.Relationship) bool {
	for _, v := range items {
		if v == want {
			return true
		}
	}
	return false
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
