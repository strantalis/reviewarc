package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type Client struct{ runner proc.Runner }

func New(runner proc.Runner) *Client { return &Client{runner: runner} }

type AuthErrorKind string

const (
	AuthUnavailable AuthErrorKind = "unavailable"
	AuthRequired    AuthErrorKind = "authenticationRequired"
	AuthExpired     AuthErrorKind = "authenticationExpired"
	AuthForbidden   AuthErrorKind = "forbidden"
	AuthNetwork     AuthErrorKind = "networkUnavailable"
)

type AuthError struct {
	Kind    AuthErrorKind
	Message string
}

func (e *AuthError) Error() string { return e.Message }

type RepositoryQuery struct {
	IncludeArchived bool
	Organizations   []string
}

type RepositoryPageQuery struct {
	Owner    string
	Cursor   string
	PageSize int
}

type RepositoryPage struct {
	Items       []domain.Repository `json:"items"`
	TotalCount  int                 `json:"totalCount"`
	EndCursor   string              `json:"endCursor,omitempty"`
	HasNextPage bool                `json:"hasNextPage"`
}

const (
	OrganizationAccessAvailable   = "available"
	OrganizationAccessSSORequired = "ssoRequired"
	OrganizationAccessDenied      = "denied"
	OrganizationAccessUnknown     = "unknown"
)

type PullRequestQuery struct {
	Repositories  []domain.RepositoryRef
	Organizations []string
	CurrentLogin  string
}

type InboxResult struct {
	Items   []domain.PullRequestSummary `json:"items"`
	Errors  map[string]string           `json:"errors"`
	Partial bool                        `json:"partial"`
}

type PullRequestDetail struct {
	PullRequest domain.PullRequest `json:"pullRequest"`
}

func (c *Client) CurrentUser(ctx context.Context) (domain.GitHubUser, error) {
	result, err := c.run(ctx, []string{"api", "user"})
	if err != nil {
		return domain.GitHubUser{}, classifyAuth(result.Stderr, err)
	}
	var raw userJSON
	if err := json.Unmarshal(result.Stdout, &raw); err != nil {
		return domain.GitHubUser{}, fmt.Errorf("parse GitHub user: %w", err)
	}
	if raw.Login == "" {
		return domain.GitHubUser{}, errors.New("GitHub returned an account without a login")
	}
	return raw.domain(), nil
}

func (c *Client) ListOrganizations(ctx context.Context) ([]domain.Organization, error) {
	result, err := c.run(ctx, []string{"api", "--paginate", "--slurp", "user/orgs?per_page=100"})
	if err != nil {
		return nil, fmt.Errorf("list GitHub organizations: %w", classifyAuth(result.Stderr, err))
	}
	var pages [][]organizationJSON
	if err := json.Unmarshal(result.Stdout, &pages); err != nil {
		return nil, fmt.Errorf("parse GitHub organizations: %w", err)
	}
	seen := map[string]bool{}
	organizations := make([]domain.Organization, 0)
	for _, page := range pages {
		for _, item := range page {
			key := strings.ToLower(item.Login)
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			organizations = append(organizations, domain.Organization{Login: item.Login, Name: item.Description, AvatarURL: item.AvatarURL})
		}
	}
	sort.Slice(organizations, func(i, j int) bool {
		return strings.ToLower(organizations[i].Login) < strings.ToLower(organizations[j].Login)
	})
	return organizations, nil
}

func (c *Client) CheckOrganizationAccess(ctx context.Context, organizations []domain.Organization) []domain.Organization {
	checked := append([]domain.Organization(nil), organizations...)
	var wg sync.WaitGroup
	workers := make(chan struct{}, 4)
	for i := range checked {
		checked[i].AccessStatus = OrganizationAccessUnknown
		if !validName(checked[i].Login) {
			continue
		}
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			workers <- struct{}{}
			defer func() { <-workers }()
			endpoint := fmt.Sprintf("orgs/%s/repos?type=all&per_page=1", checked[index].Login)
			result, err := c.run(ctx, []string{"api", "-i", "--silent", endpoint})
			if err == nil {
				checked[index].AccessStatus = OrganizationAccessAvailable
				return
			}
			response := append(append([]byte(nil), result.Stdout...), result.Stderr...)
			if ssoURL := parseSSOAuthorizationURL(response, checked[index].Login); ssoURL != "" {
				checked[index].AccessStatus = OrganizationAccessSSORequired
				checked[index].SSOURL = ssoURL
				return
			}
			if responseStatus(response) == 403 {
				checked[index].AccessStatus = OrganizationAccessDenied
			}
		}(i)
	}
	wg.Wait()
	return checked
}

func parseSSOAuthorizationURL(response []byte, organization string) string {
	for _, line := range strings.Split(strings.ReplaceAll(string(response), "\r\n", "\n"), "\n") {
		name, value, found := strings.Cut(line, ":")
		if !found || !strings.EqualFold(strings.TrimSpace(name), "X-GitHub-SSO") {
			continue
		}
		parts := strings.Split(value, ";")
		if len(parts) < 2 || !strings.EqualFold(strings.TrimSpace(parts[0]), "required") {
			continue
		}
		for _, part := range parts[1:] {
			key, rawURL, found := strings.Cut(strings.TrimSpace(part), "=")
			if found && strings.EqualFold(key, "url") && validSSOAuthorizationURL(rawURL, organization) {
				return rawURL
			}
		}
	}
	return ""
}

func validSSOAuthorizationURL(rawURL, organization string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "github.com") || parsed.User != nil || parsed.Port() != "" {
		return false
	}
	expectedPath := "/orgs/" + organization + "/sso"
	return strings.EqualFold(parsed.EscapedPath(), expectedPath) && parsed.Query().Get("authorization_request") != ""
}

func responseStatus(response []byte) int {
	for _, line := range strings.Split(strings.ReplaceAll(string(response), "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || !strings.HasPrefix(strings.ToUpper(fields[0]), "HTTP/") {
			continue
		}
		status, err := strconv.Atoi(fields[1])
		if err == nil {
			return status
		}
	}
	return 0
}

func (c *Client) ListRepositories(ctx context.Context, query RepositoryQuery) ([]domain.Repository, error) {
	const graphQL = `query($endCursor:String){viewer{repositories(first:100,after:$endCursor,affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],orderBy:{field:NAME,direction:ASC}){nodes{id name nameWithOwner url isPrivate isArchived description updatedAt owner{login}} pageInfo{hasNextPage endCursor}}}}`
	result, err := c.run(ctx, []string{"api", "graphql", "--paginate", "--slurp", "-f", "query=" + graphQL})
	if err != nil {
		return nil, fmt.Errorf("list GitHub repositories: %w", classifyAuth(result.Stderr, err))
	}
	var pages []repositoriesPageJSON
	if err := json.Unmarshal(result.Stdout, &pages); err != nil {
		return nil, fmt.Errorf("parse GitHub repositories: %w", err)
	}
	repositories := make([]domain.Repository, 0)
	seen := map[string]bool{}
	for _, page := range pages {
		repositories = appendRepositories(repositories, seen, page.Data.Viewer.Repositories.Nodes, query.IncludeArchived)
	}

	const organizationGraphQL = `query($login:String!,$endCursor:String){organization(login:$login){repositories(first:100,after:$endCursor,orderBy:{field:NAME,direction:ASC}){nodes{id name nameWithOwner url isPrivate isArchived description updatedAt owner{login}} pageInfo{hasNextPage endCursor}}}}`
	queriedOrganizations := map[string]bool{}
	for _, organization := range query.Organizations {
		key := strings.ToLower(organization)
		if queriedOrganizations[key] {
			continue
		}
		if !validName(organization) {
			return nil, fmt.Errorf("invalid GitHub organization %q", organization)
		}
		queriedOrganizations[key] = true
		result, err := c.run(ctx, []string{"api", "graphql", "--paginate", "--slurp", "-F", "login=" + organization, "-f", "query=" + organizationGraphQL})
		if err != nil {
			return nil, fmt.Errorf("list repositories for %s: %w", organization, classifyAuth(result.Stderr, err))
		}
		var organizationPages []organizationRepositoriesPageJSON
		if err := json.Unmarshal(result.Stdout, &organizationPages); err != nil {
			return nil, fmt.Errorf("parse repositories for %s: %w", organization, err)
		}
		for _, page := range organizationPages {
			repositories = appendRepositories(repositories, seen, page.Data.Organization.Repositories.Nodes, query.IncludeArchived)
		}
	}
	sort.Slice(repositories, func(i, j int) bool {
		return strings.ToLower(repositories[i].Ref.Owner+"/"+repositories[i].Ref.Name) < strings.ToLower(repositories[j].Ref.Owner+"/"+repositories[j].Ref.Name)
	})
	return repositories, nil
}

func (c *Client) ListOwnerRepositories(ctx context.Context, query RepositoryPageQuery) (RepositoryPage, error) {
	if !validName(query.Owner) {
		return RepositoryPage{}, errors.New("invalid GitHub repository owner")
	}
	if len(query.Cursor) > 4096 {
		return RepositoryPage{}, errors.New("invalid GitHub pagination cursor")
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}
	const graphQL = `query($owner:String!,$first:Int!,$after:String){repositoryOwner(login:$owner){repositories(first:$first,after:$after,isArchived:false,ownerAffiliations:[OWNER],orderBy:{field:NAME,direction:ASC}){totalCount nodes{id name nameWithOwner url isPrivate isArchived description updatedAt owner{login}} pageInfo{hasNextPage endCursor}}}}`
	args := []string{"api", "graphql", "-F", "owner=" + query.Owner, "-F", fmt.Sprintf("first=%d", pageSize)}
	if query.Cursor != "" {
		args = append(args, "-f", "after="+query.Cursor)
	}
	args = append(args, "-f", "query="+graphQL)
	result, err := c.run(ctx, args)
	if err != nil {
		return RepositoryPage{}, fmt.Errorf("list repositories for %s: %w", query.Owner, classifyAuth(result.Stderr, err))
	}
	var raw ownerRepositoriesJSON
	if err := json.Unmarshal(result.Stdout, &raw); err != nil {
		return RepositoryPage{}, fmt.Errorf("parse repositories for %s: %w", query.Owner, err)
	}
	if raw.Data.RepositoryOwner == nil {
		return RepositoryPage{}, fmt.Errorf("repository owner %s is unavailable", query.Owner)
	}
	connection := raw.Data.RepositoryOwner.Repositories
	items := appendRepositories([]domain.Repository{}, map[string]bool{}, connection.Nodes, false)
	if items == nil {
		items = []domain.Repository{}
	}
	return RepositoryPage{Items: items, TotalCount: connection.TotalCount, EndCursor: connection.PageInfo.EndCursor, HasNextPage: connection.PageInfo.HasNextPage}, nil
}

func (c *Client) GetRepository(ctx context.Context, ref domain.RepositoryRef) (domain.Repository, error) {
	if !validName(ref.Owner) || !validName(ref.Name) {
		return domain.Repository{}, errors.New("invalid GitHub repository")
	}
	result, err := c.run(ctx, []string{"repo", "view", ref.Owner + "/" + ref.Name, "--json", "id,name,nameWithOwner,description,updatedAt,isPrivate,isArchived,owner"})
	if err != nil {
		return domain.Repository{}, fmt.Errorf("load repository %s/%s: %w", ref.Owner, ref.Name, classifyAuth(result.Stderr, err))
	}
	var raw repositoryJSON
	if err := json.Unmarshal(result.Stdout, &raw); err != nil {
		return domain.Repository{}, fmt.Errorf("parse repository %s/%s: %w", ref.Owner, ref.Name, err)
	}
	if raw.Owner.Login == "" || raw.Name == "" || raw.NameWithOwner == "" {
		return domain.Repository{}, fmt.Errorf("GitHub returned incomplete repository data for %s/%s", ref.Owner, ref.Name)
	}
	return raw.domain(), nil
}

func appendRepositories(repositories []domain.Repository, seen map[string]bool, items []repositoryJSON, includeArchived bool) []domain.Repository {
	for _, item := range items {
		if item.IsArchived && !includeArchived {
			continue
		}
		key := strings.ToLower(item.NameWithOwner)
		if key == "" || seen[key] || item.Owner.Login == "" || item.Name == "" {
			continue
		}
		seen[key] = true
		repositories = append(repositories, item.domain())
	}
	return repositories
}

func (c *Client) ListPullRequests(ctx context.Context, query PullRequestQuery) InboxResult {
	result := InboxResult{Items: []domain.PullRequestSummary{}, Errors: map[string]string{}}
	seen := map[string]bool{}
	const organizationSearchGraphQL = `query($search:String!,$endCursor:String){search(type:ISSUE,query:$search,first:100,after:$endCursor){issueCount nodes{... on PullRequest{number title url updatedAt isDraft additions deletions changedFiles reviewDecision headRefOid baseRefOid author{login} assignees(first:100){nodes{login}} reviewRequests(first:100){nodes{requestedReviewer{... on User{login}}}} labels(first:100){nodes{name}} repository{id name nameWithOwner isPrivate isArchived owner{login}}}} pageInfo{hasNextPage endCursor}}}`
	seenOrganizations := map[string]bool{}
	for _, organization := range query.Organizations {
		key := strings.ToLower(organization)
		errorKey := "organization:" + organization
		if seenOrganizations[key] {
			continue
		}
		if !validName(organization) {
			result.Errors[errorKey] = "Invalid organization name"
			result.Partial = true
			continue
		}
		seenOrganizations[key] = true
		search := fmt.Sprintf("org:%s is:pr is:open archived:false sort:updated-desc", organization)
		output, err := c.run(ctx, []string{"api", "graphql", "--paginate", "--slurp", "-f", "search=" + search, "-f", "query=" + organizationSearchGraphQL})
		if err != nil {
			result.Errors[errorKey] = safeError(err)
			result.Partial = true
			continue
		}
		var pages []searchPullRequestsPageJSON
		if err := json.Unmarshal(output.Stdout, &pages); err != nil {
			result.Errors[errorKey] = "GitHub returned malformed pull request data"
			result.Partial = true
			continue
		}
		parsed := 0
		issueCount := 0
		for _, page := range pages {
			if page.Data.Search.IssueCount > issueCount {
				issueCount = page.Data.Search.IssueCount
			}
			for _, row := range page.Data.Search.Nodes {
				repository := row.Repository
				if row.Number <= 0 || repository.IsArchived || repository.Owner.Login == "" || repository.Name == "" || repository.NameWithOwner == "" {
					continue
				}
				ref := repository.domain().Ref
				itemKey := strings.ToLower(ref.Owner+"/"+ref.Name) + fmt.Sprintf("#%d", row.Number)
				if seen[itemKey] {
					continue
				}
				seen[itemKey] = true
				result.Items = append(result.Items, row.summaryJSON().domain(ref, query.CurrentLogin))
				parsed++
			}
		}
		if issueCount > parsed && parsed >= 1000 {
			result.Errors[errorKey] = "GitHub search returned the first 1,000 open pull requests"
			result.Partial = true
		}
	}
	for _, repository := range query.Repositories {
		name := repository.Owner + "/" + repository.Name
		if !validName(repository.Owner) || !validName(repository.Name) {
			result.Errors[name] = "Invalid repository name"
			result.Partial = true
			continue
		}
		output, err := c.run(ctx, []string{"pr", "list", "-R", name, "--state", "open", "--limit", "100", "--json", "number,title,url,author,updatedAt,isDraft,additions,deletions,changedFiles,assignees,reviewRequests,labels,reviewDecision,headRefOid,baseRefOid"})
		if err != nil {
			result.Errors[name] = safeError(err)
			result.Partial = true
			continue
		}
		var rows []pullRequestSummaryJSON
		if err := json.Unmarshal(output.Stdout, &rows); err != nil {
			result.Errors[name] = "GitHub returned malformed pull request data"
			result.Partial = true
			continue
		}
		for _, row := range rows {
			item := row.domain(repository, query.CurrentLogin)
			itemKey := strings.ToLower(name) + fmt.Sprintf("#%d", item.Ref.Number)
			if item.Ref.Number <= 0 || seen[itemKey] {
				continue
			}
			seen[itemKey] = true
			result.Items = append(result.Items, item)
		}
	}
	sort.SliceStable(result.Items, func(i, j int) bool { return result.Items[i].UpdatedAt.After(result.Items[j].UpdatedAt) })
	return result
}

func (c *Client) GetPullRequest(ctx context.Context, ref domain.PullRequestRef) (PullRequestDetail, error) {
	if ref.Number <= 0 || !validName(ref.Repository.Owner) || !validName(ref.Repository.Name) {
		return PullRequestDetail{}, errors.New("invalid pull request reference")
	}
	root := fmt.Sprintf("repos/%s/%s/pulls/%d", ref.Repository.Owner, ref.Repository.Name, ref.Number)
	var metadata, commits, reviews, comments proc.Result
	var metadataErr, commitsErr, reviewsErr, commentsErr error
	var wg sync.WaitGroup
	wg.Add(4)
	go func() { defer wg.Done(); metadata, metadataErr = c.run(ctx, []string{"api", root}) }()
	go func() {
		defer wg.Done()
		commits, commitsErr = c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/commits?per_page=100"})
	}()
	go func() {
		defer wg.Done()
		reviews, reviewsErr = c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/reviews?per_page=100"})
	}()
	go func() {
		defer wg.Done()
		comments, commentsErr = c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/comments?per_page=100"})
	}()
	wg.Wait()
	if metadataErr != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request: %w", metadataErr)
	}
	if commitsErr != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request commits: %w", commitsErr)
	}
	if reviewsErr != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request reviews: %w", reviewsErr)
	}
	if commentsErr != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request review comments: %w", commentsErr)
	}
	detail, err := parsePullRequestDetail(metadata.Stdout, commits.Stdout)
	if err != nil {
		return PullRequestDetail{}, err
	}
	if !validCommitSHA(detail.PullRequest.HeadSHA) {
		return PullRequestDetail{}, errors.New("pull request returned an invalid head revision")
	}
	checksEndpoint := fmt.Sprintf("repos/%s/%s/commits/%s/check-runs?per_page=100", ref.Repository.Owner, ref.Repository.Name, detail.PullRequest.HeadSHA)
	checks, err := c.run(ctx, []string{"api", "--paginate", "--slurp", checksEndpoint})
	if err != nil {
		checks.Stdout = []byte(`[{"check_runs":[]}]`)
	}
	if err := parsePullRequestContext(&detail.PullRequest, reviews.Stdout, comments.Stdout, checks.Stdout); err != nil {
		return PullRequestDetail{}, err
	}
	return detail, nil
}

func (c *Client) PublishReview(ctx context.Context, ref domain.PullRequestRef, payload []byte) ([]byte, error) {
	if ref.Number <= 0 || !validName(ref.Repository.Owner) || !validName(ref.Repository.Name) || !json.Valid(payload) {
		return nil, errors.New("invalid publish request")
	}
	endpoint := fmt.Sprintf("repos/%s/%s/pulls/%d/reviews", ref.Repository.Owner, ref.Repository.Name, ref.Number)
	result, err := c.runner.Run(ctx, proc.Command{Tool: proc.GH, Args: []string{"api", "--method", "POST", endpoint, "--input", "-"}, Stdin: payload, Timeout: 30 * time.Second, MaxOutput: 4 << 20})
	if err != nil {
		return nil, fmt.Errorf("publish GitHub review: %w", err)
	}
	return result.Stdout, nil
}

func (c *Client) ReplyToReviewComment(ctx context.Context, ref domain.PullRequestRef, rootCommentID int64, body string) (domain.PullRequestReviewComment, error) {
	if ref.Number <= 0 || rootCommentID <= 0 || !validName(ref.Repository.Owner) || !validName(ref.Repository.Name) || strings.TrimSpace(body) == "" || len(body) > 65536 {
		return domain.PullRequestReviewComment{}, errors.New("invalid review thread reply")
	}
	payload, err := json.Marshal(struct {
		Body string `json:"body"`
	}{Body: body})
	if err != nil {
		return domain.PullRequestReviewComment{}, errors.New("encode review thread reply")
	}
	endpoint := fmt.Sprintf("repos/%s/%s/pulls/%d/comments/%d/replies", ref.Repository.Owner, ref.Repository.Name, ref.Number, rootCommentID)
	result, err := c.runner.Run(ctx, proc.Command{Tool: proc.GH, Args: []string{"api", "--method", "POST", endpoint, "--input", "-"}, Stdin: payload, Timeout: 30 * time.Second, MaxOutput: 4 << 20})
	if err != nil {
		return domain.PullRequestReviewComment{}, fmt.Errorf("publish GitHub review thread reply: %w", err)
	}
	var raw reviewCommentJSON
	if err := json.Unmarshal(result.Stdout, &raw); err != nil || raw.ID <= 0 || raw.InReplyToID != rootCommentID || raw.HTMLURL == "" {
		return domain.PullRequestReviewComment{}, errors.New("GitHub published the reply but returned malformed confirmation")
	}
	return raw.domain(), nil
}

func (c *Client) run(ctx context.Context, args []string) (proc.Result, error) {
	return c.runner.Run(ctx, proc.Command{Tool: proc.GH, Args: args, Timeout: 45 * time.Second, MaxOutput: 16 << 20})
}

func classifyAuth(stderr []byte, cause error) error {
	message := strings.ToLower(string(stderr) + " " + cause.Error())
	switch {
	case strings.Contains(message, "token") && (strings.Contains(message, "invalid") || strings.Contains(message, "expired")), strings.Contains(message, "bad credentials"):
		return &AuthError{Kind: AuthExpired, Message: "GitHub credentials have expired. Run gh auth login to reconnect."}
	case strings.Contains(message, "not logged"), strings.Contains(message, "authentication required"):
		return &AuthError{Kind: AuthRequired, Message: "Sign in with gh auth login to use GitHub."}
	case strings.Contains(message, "403"), strings.Contains(message, "forbidden"):
		return &AuthError{Kind: AuthForbidden, Message: "GitHub denied access to this resource."}
	case strings.Contains(message, "could not resolve"), strings.Contains(message, "connection"), strings.Contains(message, "network"):
		return &AuthError{Kind: AuthNetwork, Message: "GitHub is unreachable. Check the network and try again."}
	default:
		return &AuthError{Kind: AuthUnavailable, Message: "GitHub account status could not be verified."}
	}
}

func validName(value string) bool {
	if value == "" || value == "." || value == ".." || len(value) > 100 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("-_.", r) {
			continue
		}
		return false
	}
	return true
}

func validCommitSHA(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') || (r >= '0' && r <= '9') {
			continue
		}
		return false
	}
	return true
}

func safeError(error) string { return "GitHub request failed; retry or refresh authentication." }
