package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"reviewarc/internal/domain"
	"reviewarc/internal/persistence"
)

type PublishItem struct {
	DraftID   string             `json:"draftId"`
	Kind      domain.CommentKind `json:"kind"`
	Body      string             `json:"body"`
	Path      string             `json:"path,omitempty"`
	StartLine *int               `json:"startLine,omitempty"`
	StartSide domain.DiffSide    `json:"startSide,omitempty"`
	Line      *int               `json:"line,omitempty"`
	Side      domain.DiffSide    `json:"side,omitempty"`
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

type ThreadReplyPreview struct {
	Token         string    `json:"token"`
	Digest        string    `json:"digest"`
	Repository    string    `json:"repository"`
	Number        int       `json:"number"`
	HeadSHA       string    `json:"headSha"`
	RootCommentID int64     `json:"rootCommentId"`
	RootAuthor    string    `json:"rootAuthor"`
	Path          string    `json:"path"`
	Body          string    `json:"body"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

type pendingPublish struct {
	preview   PublishPreview
	ref       domain.PullRequestRef
	sessionID string
}

type pendingThreadReply struct {
	preview   ThreadReplyPreview
	ref       domain.PullRequestRef
	sessionID string
}

const maxPendingPublicationPreviews = 8

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
			normalized, err := a.normalizeInline(sessionID, draft.Path, draft.StartLine, draft.StartSide, draft.Line, draft.Side)
			if err != nil {
				return PublishPreview{}, err
			}
			draft.StartLine, draft.StartSide, draft.Line, draft.Side = normalized.StartLine, normalized.StartSide, normalized.Line, normalized.Side
		}
		items = append(items, PublishItem{DraftID: draft.ID, Kind: draft.Kind, Body: draft.Body, Path: draft.Path, StartLine: draft.StartLine, StartSide: draft.StartSide, Line: draft.Line, Side: draft.Side})
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
	a.rememberPublishLocked(pendingPublish{preview: preview, ref: session.PullRequest.Ref, sessionID: session.ID}, time.Now().UTC())
	a.mu.Unlock()
	return preview, nil
}

func (a *App) DiscardPublishPreview(token string) {
	a.mu.Lock()
	delete(a.publish, token)
	a.mu.Unlock()
}

func (a *App) ConfirmPublish(token, digest string) ([]domain.ReviewComment, error) {
	a.mu.Lock()
	pending, ok := a.publish[token]
	delete(a.publish, token)
	a.mu.Unlock()
	if !ok {
		comments, err := a.store.ApplyReviewPublication(a.appContext(), token, digest)
		if errors.Is(err, persistence.ErrNotFound) {
			return nil, errors.New("publish confirmation is invalid or expired")
		}
		if errors.Is(err, persistence.ErrPublicationOutcomeUnknown) {
			return nil, errors.New("publication outcome on GitHub is uncertain; reconcile the review on GitHub before retrying")
		}
		if err != nil {
			return nil, err
		}
		return publishResult(comments), nil
	}
	if pending.preview.Digest != digest || time.Now().After(pending.preview.ExpiresAt) {
		return nil, errors.New("publish confirmation is invalid or expired")
	}
	current, err := a.github.GetPullRequest(a.appContext(), pending.ref)
	if err != nil {
		return nil, err
	}
	if current.PullRequest.HeadSHA != pending.preview.HeadSHA {
		return nil, errors.New("pull request changed; refresh before publishing")
	}
	draftIDs := make([]string, 0, len(pending.preview.Items))
	for _, item := range pending.preview.Items {
		draftIDs = append(draftIDs, item.DraftID)
	}
	if err := a.store.StartReviewPublication(a.appContext(), token, digest, pending.sessionID, pending.ref, pending.preview.HeadSHA, pending.preview.Event, draftIDs); errors.Is(err, persistence.ErrPublicationAlreadyInProgress) {
		return nil, errors.New("one or more drafts already have a publication in progress; retry or reconcile the original publication before publishing again")
	} else if err != nil {
		return nil, err
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
	if err := a.store.RecordReviewPublicationReceipt(a.appContext(), token, digest, fmt.Sprint(published.ID), published.HTMLURL); err != nil {
		return nil, err
	}
	comments, err := a.store.ApplyReviewPublication(a.appContext(), token, digest)
	if err != nil {
		return nil, err
	}
	return publishResult(comments), nil
}

func publishResult(comments []domain.ReviewComment) []domain.ReviewComment {
	out := make([]domain.ReviewComment, 0, len(comments))
	for _, comment := range comments {
		out = append(out, domain.ReviewComment{ID: comment.ID, Kind: comment.Kind, Body: comment.Body, Path: comment.Path, StartLine: comment.StartLine, StartSide: comment.StartSide, Line: comment.Line, Side: comment.Side, Status: comment.Status, GitHubID: comment.GitHubID, GitHubURL: comment.GitHubURL})
	}
	return out
}

func (a *App) PrepareThreadReply(sessionID string, targetCommentID int64, body string) (ThreadReplyPreview, error) {
	if targetCommentID <= 0 || strings.TrimSpace(body) == "" || len(body) > 65536 {
		return ThreadReplyPreview{}, errors.New("reply must contain 1 to 65,536 characters")
	}
	session, err := a.store.GetSession(a.appContext(), sessionID)
	if err != nil {
		return ThreadReplyPreview{}, err
	}
	var target *domain.PullRequestReviewComment
	for i := range session.PullRequest.ReviewComments {
		if session.PullRequest.ReviewComments[i].ID == targetCommentID {
			target = &session.PullRequest.ReviewComments[i]
			break
		}
	}
	if target == nil {
		return ThreadReplyPreview{}, errors.New("review thread is no longer available")
	}
	rootID := target.ID
	if target.ReplyToID > 0 {
		rootID = target.ReplyToID
	}
	var root *domain.PullRequestReviewComment
	for i := range session.PullRequest.ReviewComments {
		comment := &session.PullRequest.ReviewComments[i]
		if comment.ID == rootID && comment.ReplyToID == 0 {
			root = comment
			break
		}
	}
	if root == nil {
		return ThreadReplyPreview{}, errors.New("review thread root is no longer available")
	}
	preview := ThreadReplyPreview{
		Token: newID(), Repository: session.PullRequest.Ref.Repository.Owner + "/" + session.PullRequest.Ref.Repository.Name,
		Number: session.PullRequest.Ref.Number, HeadSHA: session.HeadSHA, RootCommentID: root.ID, RootAuthor: root.Author.Login,
		Path: root.Path, Body: body, ExpiresAt: time.Now().UTC().Add(5 * time.Minute),
	}
	payload, _ := json.Marshal(struct {
		Repository    string
		Number        int
		HeadSHA       string
		RootCommentID int64
		Body          string
	}{preview.Repository, preview.Number, preview.HeadSHA, preview.RootCommentID, preview.Body})
	sum := sha256.Sum256(payload)
	preview.Digest = hex.EncodeToString(sum[:])
	a.mu.Lock()
	a.rememberThreadReplyLocked(pendingThreadReply{preview: preview, ref: session.PullRequest.Ref, sessionID: session.ID}, time.Now().UTC())
	a.mu.Unlock()
	return preview, nil
}

func (a *App) DiscardThreadReplyPreview(token string) {
	a.mu.Lock()
	delete(a.threadReplies, token)
	a.mu.Unlock()
}

func (a *App) ConfirmThreadReply(token, digest string) (domain.PullRequestReviewComment, error) {
	a.mu.Lock()
	pending, ok := a.threadReplies[token]
	delete(a.threadReplies, token)
	a.mu.Unlock()
	if !ok || pending.preview.Digest != digest || time.Now().After(pending.preview.ExpiresAt) {
		return domain.PullRequestReviewComment{}, errors.New("reply confirmation is invalid or expired")
	}
	current, err := a.github.GetPullRequest(a.appContext(), pending.ref)
	if err != nil {
		return domain.PullRequestReviewComment{}, err
	}
	if current.PullRequest.HeadSHA != pending.preview.HeadSHA {
		return domain.PullRequestReviewComment{}, errors.New("pull request changed; refresh before replying")
	}
	found := false
	for _, comment := range current.PullRequest.ReviewComments {
		if comment.ID == pending.preview.RootCommentID && comment.ReplyToID == 0 {
			found = true
			break
		}
	}
	if !found {
		return domain.PullRequestReviewComment{}, errors.New("review thread is no longer available")
	}
	return a.github.ReplyToReviewComment(a.appContext(), pending.ref, pending.preview.RootCommentID, pending.preview.Body)
}

func (a *App) rememberPublishLocked(pending pendingPublish, now time.Time) {
	if a.publish == nil {
		a.publish = map[string]pendingPublish{}
	}
	for token, candidate := range a.publish {
		if !candidate.preview.ExpiresAt.After(now) {
			delete(a.publish, token)
		}
	}
	for len(a.publish) >= maxPendingPublicationPreviews {
		oldestToken := ""
		oldestExpiry := time.Time{}
		for token, candidate := range a.publish {
			if oldestToken == "" || candidate.preview.ExpiresAt.Before(oldestExpiry) {
				oldestToken, oldestExpiry = token, candidate.preview.ExpiresAt
			}
		}
		delete(a.publish, oldestToken)
	}
	a.publish[pending.preview.Token] = pending
}

func (a *App) rememberThreadReplyLocked(pending pendingThreadReply, now time.Time) {
	if a.threadReplies == nil {
		a.threadReplies = map[string]pendingThreadReply{}
	}
	for token, candidate := range a.threadReplies {
		if !candidate.preview.ExpiresAt.After(now) {
			delete(a.threadReplies, token)
		}
	}
	for len(a.threadReplies) >= maxPendingPublicationPreviews {
		oldestToken := ""
		oldestExpiry := time.Time{}
		for token, candidate := range a.threadReplies {
			if oldestToken == "" || candidate.preview.ExpiresAt.Before(oldestExpiry) {
				oldestToken, oldestExpiry = token, candidate.preview.ExpiresAt
			}
		}
		delete(a.threadReplies, oldestToken)
	}
	a.threadReplies[pending.preview.Token] = pending
}

func buildReviewPayload(preview PublishPreview) []byte {
	type inline struct {
		Path      string          `json:"path"`
		StartLine *int            `json:"start_line,omitempty"`
		StartSide domain.DiffSide `json:"start_side,omitempty"`
		Line      int             `json:"line"`
		Side      domain.DiffSide `json:"side"`
		Body      string          `json:"body"`
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
			comments = append(comments, inline{item.Path, item.StartLine, item.StartSide, *item.Line, item.Side, item.Body})
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
