package github

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type fakeRunner struct {
	responses []proc.Result
	errors    []error
	commands  []proc.Command
}

func (f *fakeRunner) Run(_ context.Context, c proc.Command) (proc.Result, error) {
	f.commands = append(f.commands, c)
	i := len(f.commands) - 1
	var err error
	if i < len(f.errors) {
		err = f.errors[i]
	}
	return f.responses[i], err
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
}

func TestInboxIsSortedAndIsolatesRepositoryFailures(t *testing.T) {
	old := `[{"number":1,"title":"Old","url":"https://github.com/acme/api/pull/1","author":{"login":"dev"},"updatedAt":"2026-07-10T10:00:00Z","headRefOid":"head1","baseRefOid":"base1"}]`
	newer := `[{"number":2,"title":"New","url":"https://github.com/acme/web/pull/2","author":{"login":"dev"},"updatedAt":"2026-07-11T10:00:00Z","reviewRequests":[{"login":"SEAN"}],"headRefOid":"head2","baseRefOid":"base2"}]`
	f := &fakeRunner{
		responses: []proc.Result{{Stdout: []byte(old)}, {Stderr: []byte("private details must not escape")}, {Stdout: []byte(newer)}},
		errors:    []error{nil, errors.New("exit 1"), nil},
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

func TestPullRequestDetailParsesForkRenameAndBinary(t *testing.T) {
	metadata := []byte(`{"number":4,"title":"Change","body":"why","html_url":"https://github.com/acme/api/pull/4","updated_at":"2026-07-11T11:00:00Z","user":{"login":"dev"},"base":{"ref":"main","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repo":{"name":"api","clone_url":"https://github.com/acme/api.git","owner":{"login":"acme"}}},"head":{"ref":"topic","sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","repo":{"name":"api","clone_url":"https://github.com/fork/api.git","owner":{"login":"fork"}}},"additions":2,"deletions":1,"changed_files":2,"labels":[{"name":"security"}]}`)
	commits := []byte(`[[{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","commit":{"message":"change","author":{"name":"Dev","date":"2026-07-11T10:00:00Z"}},"author":{"login":"dev"}}]]`)
	files := []byte(`[[{"filename":"new.go","previous_filename":"old.go","status":"renamed","additions":1,"deletions":1,"patch":"@@"},{"filename":"asset.bin","status":"modified","additions":0,"deletions":0}]]`)
	detail, err := parsePullRequestDetail(metadata, commits, files)
	if err != nil {
		t.Fatal(err)
	}
	if detail.PullRequest.HeadRepository.Owner != "fork" || detail.PullRequest.URL == "" || detail.PullRequest.HeadRepository.CloneURL == "" || len(detail.PullRequest.Labels) != 1 || detail.PullRequest.Labels[0] != "security" || detail.Files[0].Status != domain.FileRenamed || detail.Files[0].PreviousPath != "old.go" || !detail.Files[1].IsBinary {
		t.Fatalf("detail=%+v", detail)
	}
}

func TestPullRequestDetailRejectsUnavailableRepositoriesAndMalformedPages(t *testing.T) {
	metadataWithoutHead := []byte(`{"number":4,"base":{"repo":{"name":"api","owner":{"login":"acme"}}},"head":{"repo":null}}`)
	if _, err := parsePullRequestDetail(metadataWithoutHead, []byte(`[[]]`), []byte(`[[]]`)); err == nil {
		t.Fatal("missing head repository was accepted")
	}
	metadata := []byte(`{"number":4,"base":{"repo":{"name":"api","owner":{"login":"acme"}}},"head":{"repo":{"name":"api","owner":{"login":"fork"}}}}`)
	if _, err := parsePullRequestDetail(metadata, []byte(`{}`), []byte(`[[]]`)); err == nil {
		t.Fatal("malformed commit pagination was accepted")
	}
	if _, err := parsePullRequestDetail(metadata, []byte(`[[]]`), []byte(`{}`)); err == nil {
		t.Fatal("malformed file pagination was accepted")
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
	if len(pr.ReviewComments) != 2 || pr.ReviewComments[0].ID != 101 || pr.ReviewComments[0].Line != nil || pr.ReviewComments[0].OriginalLine == nil || *pr.ReviewComments[0].OriginalLine != 40 || pr.ReviewComments[1].ReplyToID != 101 || pr.ReviewComments[1].Side != domain.DiffSideRight {
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

func TestGetPullRequestLoadsContextFromFixedEndpoints(t *testing.T) {
	sha := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	metadata := `{"number":4,"base":{"ref":"main","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repo":{"name":"api","owner":{"login":"acme"}}},"head":{"ref":"topic","sha":"` + sha + `","repo":{"name":"api","owner":{"login":"fork"}}}}`
	f := &fakeRunner{responses: []proc.Result{
		{Stdout: []byte(metadata)}, {Stdout: []byte(`[[]]`)}, {Stdout: []byte(`[[]]`)},
		{Stdout: []byte(`[[]]`)}, {Stdout: []byte(`[[]]`)}, {Stdout: []byte(`[{"check_runs":[]}]`)},
	}}
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
		"repos/acme/api/pulls/4/files?per_page=100",
		"repos/acme/api/pulls/4/reviews?per_page=100",
		"repos/acme/api/pulls/4/comments?per_page=100",
		"repos/acme/api/commits/" + sha + "/check-runs?per_page=100",
	}
	if len(f.commands) != len(wantEndpoints) {
		t.Fatalf("commands=%d", len(f.commands))
	}
	for i, want := range wantEndpoints {
		got := f.commands[i].Args[len(f.commands[i].Args)-1]
		if got != want {
			t.Fatalf("command %d endpoint=%q want %q", i, got, want)
		}
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
