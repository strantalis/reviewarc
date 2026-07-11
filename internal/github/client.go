package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
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

type RepositoryQuery struct{ IncludeArchived bool }

type PullRequestQuery struct {
	Repositories []domain.RepositoryRef
	CurrentLogin string
}

type InboxResult struct {
	Items   []domain.PullRequestSummary `json:"items"`
	Errors  map[string]string           `json:"errors"`
	Partial bool                        `json:"partial"`
}

type PullRequestDetail struct {
	PullRequest domain.PullRequest   `json:"pullRequest"`
	Files       []domain.ChangedFile `json:"files"`
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
		for _, item := range page.Data.Viewer.Repositories.Nodes {
			if item.IsArchived && !query.IncludeArchived {
				continue
			}
			key := strings.ToLower(item.NameWithOwner)
			if seen[key] || item.Owner.Login == "" || item.Name == "" {
				continue
			}
			seen[key] = true
			repositories = append(repositories, item.domain())
		}
	}
	return repositories, nil
}

func (c *Client) ListPullRequests(ctx context.Context, query PullRequestQuery) InboxResult {
	result := InboxResult{Items: []domain.PullRequestSummary{}, Errors: map[string]string{}}
	seen := map[string]bool{}
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
			key := strings.ToLower(name) + fmt.Sprintf("#%d", item.Ref.Number)
			if item.Ref.Number <= 0 || seen[key] {
				continue
			}
			seen[key] = true
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
	metadata, err := c.run(ctx, []string{"api", root})
	if err != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request: %w", err)
	}
	commits, err := c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/commits?per_page=100"})
	if err != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request commits: %w", err)
	}
	files, err := c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/files?per_page=100"})
	if err != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request files: %w", err)
	}
	detail, err := parsePullRequestDetail(metadata.Stdout, commits.Stdout, files.Stdout)
	if err != nil {
		return PullRequestDetail{}, err
	}
	reviews, err := c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/reviews?per_page=100"})
	if err != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request reviews: %w", err)
	}
	comments, err := c.run(ctx, []string{"api", "--paginate", "--slurp", root + "/comments?per_page=100"})
	if err != nil {
		return PullRequestDetail{}, fmt.Errorf("load pull request review comments: %w", err)
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
