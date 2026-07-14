package github

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"reviewarc/internal/domain"
)

type userJSON struct {
	Login, Name string
	AvatarURL   string `json:"avatar_url"`
}

func (u userJSON) domain() domain.GitHubUser {
	return domain.GitHubUser{Login: u.Login, Name: u.Name, AvatarURL: u.AvatarURL}
}

type organizationJSON struct {
	Login, Description string
	AvatarURL          string `json:"avatar_url"`
}

type repositoryJSON struct {
	ID, Name, NameWithOwner, Description, UpdatedAt string
	IsPrivate, IsArchived                           bool
	Owner                                           struct{ Login string }
}

func (r repositoryJSON) domain() domain.Repository {
	updated, _ := time.Parse(time.RFC3339, r.UpdatedAt)
	return domain.Repository{Ref: domain.RepositoryRef{Host: "github.com", Owner: r.Owner.Login, Name: r.Name, DatabaseID: r.ID, CloneURL: "https://github.com/" + r.NameWithOwner + ".git"}, Description: r.Description, IsPrivate: r.IsPrivate, IsArchived: r.IsArchived, UpdatedAt: updated}
}

type repositoriesPageJSON struct {
	Data struct {
		Viewer struct {
			Repositories struct{ Nodes []repositoryJSON }
		}
	}
}

type organizationRepositoriesPageJSON struct {
	Data struct {
		Organization struct {
			Repositories struct{ Nodes []repositoryJSON }
		}
	}
}

type pageInfoJSON struct {
	HasNextPage bool
	EndCursor   string
}

type ownerRepositoriesJSON struct {
	Data struct {
		RepositoryOwner *struct {
			Repositories struct {
				TotalCount int
				Nodes      []repositoryJSON
				PageInfo   pageInfoJSON
			}
		}
	}
}

type namedUserJSON struct{ Login string }
type labelJSON struct{ Name string }
type pullRequestSummaryJSON struct {
	Number                                 int
	Title, URL, UpdatedAt                  string
	Author                                 namedUserJSON
	IsDraft                                bool
	Additions, Deletions, ChangedFiles     int
	Assignees, ReviewRequests              []namedUserJSON
	Labels                                 []labelJSON
	ReviewDecision, HeadRefOid, BaseRefOid string
}

type searchPullRequestJSON struct {
	Number                                 int
	Title, URL, UpdatedAt                  string
	Author                                 namedUserJSON
	IsDraft                                bool
	Additions, Deletions, ChangedFiles     int
	ReviewDecision, HeadRefOid, BaseRefOid string
	Assignees                              struct{ Nodes []namedUserJSON }
	Labels                                 struct{ Nodes []labelJSON }
	ReviewRequests                         struct {
		Nodes []struct{ RequestedReviewer namedUserJSON }
	}
	Repository repositoryJSON
}

func (r searchPullRequestJSON) summaryJSON() pullRequestSummaryJSON {
	reviewRequests := make([]namedUserJSON, 0, len(r.ReviewRequests.Nodes))
	for _, request := range r.ReviewRequests.Nodes {
		if request.RequestedReviewer.Login != "" {
			reviewRequests = append(reviewRequests, request.RequestedReviewer)
		}
	}
	return pullRequestSummaryJSON{Number: r.Number, Title: r.Title, URL: r.URL, UpdatedAt: r.UpdatedAt, Author: r.Author, IsDraft: r.IsDraft, Additions: r.Additions, Deletions: r.Deletions, ChangedFiles: r.ChangedFiles, Assignees: r.Assignees.Nodes, ReviewRequests: reviewRequests, Labels: r.Labels.Nodes, ReviewDecision: r.ReviewDecision, HeadRefOid: r.HeadRefOid, BaseRefOid: r.BaseRefOid}
}

type searchPullRequestsPageJSON struct {
	Data struct {
		Search struct {
			IssueCount int
			Nodes      []searchPullRequestJSON
			PageInfo   pageInfoJSON
		}
	}
}

func (r pullRequestSummaryJSON) domain(repository domain.RepositoryRef, login string) domain.PullRequestSummary {
	updated, _ := time.Parse(time.RFC3339, r.UpdatedAt)
	rels := []domain.Relationship{domain.RelationshipSelectedRepo}
	if strings.EqualFold(r.Author.Login, login) {
		rels = append(rels, domain.RelationshipAuthored)
	}
	for _, u := range r.Assignees {
		if strings.EqualFold(u.Login, login) {
			rels = appendUnique(rels, domain.RelationshipAssigned)
		}
	}
	for _, u := range r.ReviewRequests {
		if strings.EqualFold(u.Login, login) {
			rels = appendUnique(rels, domain.RelationshipReviewRequested)
		}
	}
	labels := make([]string, 0, len(r.Labels))
	for _, l := range r.Labels {
		labels = append(labels, l.Name)
	}
	return domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: repository, Number: r.Number}, Title: r.Title, URL: r.URL, Author: domain.GitHubUser{Login: r.Author.Login}, UpdatedAt: updated, IsDraft: r.IsDraft, Additions: r.Additions, Deletions: r.Deletions, ChangedFiles: r.ChangedFiles, Relationships: rels, Labels: labels, AnalysisStatus: domain.AnalysisNotStarted, RiskLevel: domain.RiskUnknown, ReviewDecision: r.ReviewDecision, BaseSHA: r.BaseRefOid, HeadSHA: r.HeadRefOid}
}
func appendUnique(items []domain.Relationship, value domain.Relationship) []domain.Relationship {
	for _, item := range items {
		if item == value {
			return items
		}
	}
	return append(items, value)
}

type pullRequestJSON struct {
	Number    int
	Title     string
	Body      string
	HTMLURL   string `json:"html_url"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	Draft     bool
	User      userJSON
	Base      struct {
		Ref, SHA string
		Repo     *struct {
			FullName string `json:"full_name"`
			CloneURL string `json:"clone_url"`
			Owner    userJSON
			Name     string
		}
	}
	Head struct {
		Ref, SHA string
		Repo     *struct {
			FullName string `json:"full_name"`
			CloneURL string `json:"clone_url"`
			Owner    userJSON
			Name     string
		}
	}
	Additions          int
	Deletions          int
	ChangedFiles       int `json:"changed_files"`
	Commits            int
	RequestedReviewers []userJSON `json:"requested_reviewers"`
	Assignees          []userJSON
	Labels             []labelJSON
}
type commitJSON struct {
	SHA    string
	Commit struct {
		Message string
		Author  struct{ Name, Date string }
	}
	Author *userJSON
}
type reviewJSON struct {
	ID          int64
	User        userJSON
	Body        string
	State       string
	HTMLURL     string `json:"html_url"`
	CommitID    string `json:"commit_id"`
	SubmittedAt string `json:"submitted_at"`
}

type reviewCommentJSON struct {
	ID                  int64
	PullRequestReviewID int64 `json:"pull_request_review_id"`
	InReplyToID         int64 `json:"in_reply_to_id"`
	User                userJSON
	Body                string
	Path                string
	StartLine           *int `json:"start_line"`
	Line                *int
	OriginalStartLine   *int   `json:"original_start_line"`
	OriginalLine        *int   `json:"original_line"`
	StartSide           string `json:"start_side"`
	Side                string
	CommitID            string `json:"commit_id"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
	HTMLURL             string `json:"html_url"`
}

func (r reviewCommentJSON) domain() domain.PullRequestReviewComment {
	return domain.PullRequestReviewComment{
		ID: r.ID, ReviewID: r.PullRequestReviewID, ReplyToID: r.InReplyToID,
		Author: r.User.domain(), Body: r.Body, Path: r.Path, StartLine: positiveLine(r.StartLine), Line: positiveLine(r.Line),
		OriginalStartLine: positiveLine(r.OriginalStartLine), OriginalLine: positiveLine(r.OriginalLine), StartSide: mapDiffSide(r.StartSide), Side: mapDiffSide(r.Side), CommitSHA: r.CommitID,
		CreatedAt: parseTime(r.CreatedAt), UpdatedAt: parseTime(r.UpdatedAt), URL: r.HTMLURL,
	}
}

type checkRunJSON struct {
	ID          int64
	Name        string
	Status      string
	Conclusion  string
	HTMLURL     string `json:"html_url"`
	DetailsURL  string `json:"details_url"`
	StartedAt   string `json:"started_at"`
	CompletedAt string `json:"completed_at"`
	App         *struct {
		Name string
	}
}

type checkRunsPageJSON struct {
	CheckRuns []checkRunJSON `json:"check_runs"`
}

func parsePullRequestDetail(metadata, commitsData []byte) (PullRequestDetail, error) {
	var raw pullRequestJSON
	if err := json.Unmarshal(metadata, &raw); err != nil {
		return PullRequestDetail{}, fmt.Errorf("parse pull request metadata: %w", err)
	}
	if raw.Base.Repo == nil || raw.Head.Repo == nil {
		return PullRequestDetail{}, fmt.Errorf("pull request repository is unavailable")
	}
	repo := domain.RepositoryRef{Host: "github.com", Owner: raw.Base.Repo.Owner.Login, Name: raw.Base.Repo.Name, CloneURL: raw.Base.Repo.CloneURL}
	headRepo := domain.RepositoryRef{Host: "github.com", Owner: raw.Head.Repo.Owner.Login, Name: raw.Head.Repo.Name, CloneURL: raw.Head.Repo.CloneURL}
	updated, _ := time.Parse(time.RFC3339, raw.UpdatedAt)
	pr := domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: repo, Number: raw.Number}, Title: raw.Title, URL: raw.HTMLURL, Author: raw.User.domain(), UpdatedAt: updated, IsDraft: raw.Draft, Additions: raw.Additions, Deletions: raw.Deletions, ChangedFiles: raw.ChangedFiles, AnalysisStatus: domain.AnalysisNotStarted, RiskLevel: domain.RiskUnknown}, Body: raw.Body, BaseRef: raw.Base.Ref, HeadRef: raw.Head.Ref, BaseSHA: raw.Base.SHA, HeadSHA: raw.Head.SHA, HeadRepository: headRepo}
	pr.Relationships = []domain.Relationship{}
	pr.Labels = make([]string, 0, len(raw.Labels))
	for _, label := range raw.Labels {
		pr.Labels = append(pr.Labels, label.Name)
	}
	pr.Commits = []domain.Commit{}
	pr.RequestedReviewers = []domain.GitHubUser{}
	pr.Assignees = []domain.GitHubUser{}
	pr.Reviews = []domain.PullRequestReview{}
	pr.ReviewComments = []domain.PullRequestReviewComment{}
	pr.CheckRuns = []domain.CheckRun{}
	for _, u := range raw.RequestedReviewers {
		pr.RequestedReviewers = append(pr.RequestedReviewers, u.domain())
	}
	for _, u := range raw.Assignees {
		pr.Assignees = append(pr.Assignees, u.domain())
	}
	var commitPages [][]commitJSON
	if err := json.Unmarshal(commitsData, &commitPages); err != nil {
		return PullRequestDetail{}, fmt.Errorf("parse commits: %w", err)
	}
	for _, page := range commitPages {
		for _, item := range page {
			authored, _ := time.Parse(time.RFC3339, item.Commit.Author.Date)
			author := domain.GitHubUser{Name: item.Commit.Author.Name}
			if item.Author != nil {
				author = item.Author.domain()
			}
			pr.Commits = append(pr.Commits, domain.Commit{SHA: item.SHA, Message: item.Commit.Message, Author: author, AuthoredAt: authored})
		}
	}
	return PullRequestDetail{PullRequest: pr}, nil
}

func parsePullRequestContext(pr *domain.PullRequest, reviewsData, commentsData, checksData []byte) error {
	var reviewPages [][]reviewJSON
	if err := json.Unmarshal(reviewsData, &reviewPages); err != nil {
		return fmt.Errorf("parse pull request reviews: %w", err)
	}
	var commentPages [][]reviewCommentJSON
	if err := json.Unmarshal(commentsData, &commentPages); err != nil {
		return fmt.Errorf("parse pull request review comments: %w", err)
	}
	var checkPages []checkRunsPageJSON
	if err := json.Unmarshal(checksData, &checkPages); err != nil {
		return fmt.Errorf("parse pull request check runs: %w", err)
	}

	pr.Reviews = make([]domain.PullRequestReview, 0)
	for _, page := range reviewPages {
		for _, item := range page {
			if item.ID <= 0 {
				continue
			}
			pr.Reviews = append(pr.Reviews, domain.PullRequestReview{
				ID: item.ID, Author: item.User.domain(), State: item.State, Body: item.Body,
				CommitSHA: item.CommitID, SubmittedAt: parseTime(item.SubmittedAt), URL: item.HTMLURL,
			})
		}
	}
	pr.ReviewComments = make([]domain.PullRequestReviewComment, 0)
	for _, page := range commentPages {
		for _, item := range page {
			if item.ID <= 0 || item.Path == "" {
				continue
			}
			pr.ReviewComments = append(pr.ReviewComments, item.domain())
		}
	}
	pr.CheckRuns = make([]domain.CheckRun, 0)
	for _, page := range checkPages {
		for _, item := range page.CheckRuns {
			if item.ID <= 0 || item.Name == "" {
				continue
			}
			appName := ""
			if item.App != nil {
				appName = item.App.Name
			}
			pr.CheckRuns = append(pr.CheckRuns, domain.CheckRun{
				ID: item.ID, Name: item.Name, Status: item.Status, Conclusion: item.Conclusion, AppName: appName,
				URL: item.HTMLURL, DetailsURL: item.DetailsURL, StartedAt: parseTime(item.StartedAt), CompletedAt: parseTime(item.CompletedAt),
			})
		}
	}

	sort.SliceStable(pr.Reviews, func(i, j int) bool {
		if pr.Reviews[i].SubmittedAt.Equal(pr.Reviews[j].SubmittedAt) {
			return pr.Reviews[i].ID < pr.Reviews[j].ID
		}
		return pr.Reviews[i].SubmittedAt.Before(pr.Reviews[j].SubmittedAt)
	})
	sort.SliceStable(pr.ReviewComments, func(i, j int) bool {
		if pr.ReviewComments[i].CreatedAt.Equal(pr.ReviewComments[j].CreatedAt) {
			return pr.ReviewComments[i].ID < pr.ReviewComments[j].ID
		}
		return pr.ReviewComments[i].CreatedAt.Before(pr.ReviewComments[j].CreatedAt)
	})
	sort.SliceStable(pr.CheckRuns, func(i, j int) bool {
		if strings.EqualFold(pr.CheckRuns[i].Name, pr.CheckRuns[j].Name) {
			return pr.CheckRuns[i].ID < pr.CheckRuns[j].ID
		}
		return strings.ToLower(pr.CheckRuns[i].Name) < strings.ToLower(pr.CheckRuns[j].Name)
	})
	return nil
}

func parseTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}

func positiveLine(value *int) *int {
	if value == nil || *value <= 0 {
		return nil
	}
	line := *value
	return &line
}

func mapDiffSide(value string) domain.DiffSide {
	switch value {
	case string(domain.DiffSideLeft):
		return domain.DiffSideLeft
	case string(domain.DiffSideRight):
		return domain.DiffSideRight
	default:
		return ""
	}
}
