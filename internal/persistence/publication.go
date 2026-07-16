package persistence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"reviewarc/internal/domain"
)

var (
	ErrPublicationAlreadyInProgress = errors.New("publication already in progress for one or more drafts")
	ErrPublicationOutcomeUnknown    = errors.New("publication outcome requires reconciliation")
)

type reviewPublication struct {
	Token, Digest, SessionID, State, GitHubID, GitHubURL string
	DraftIDs                                             []string
}

func (s *Store) SetCommentPublication(ctx context.Context, id string, status domain.CommentStatus, githubID, githubURL string) error {
	if status != domain.CommentPublished && status != domain.CommentFailed {
		return fmt.Errorf("update comment: invalid publication status %q", status)
	}
	_, err := s.db.ExecContext(ctx, `UPDATE comments SET status=?,github_id=?,github_url=?,updated_at=? WHERE id=?`, status, githubID, githubURL, encodeTime(time.Now()), id)
	return wrap("update comment", err)
}

func (s *Store) StartReviewPublication(ctx context.Context, token, digest, sessionID string, ref domain.PullRequestRef, headSHA, event string, draftIDs []string) error {
	if token == "" || digest == "" || sessionID == "" || ref.Number <= 0 || headSHA == "" || event == "" || len(draftIDs) == 0 {
		return errors.New("start review publication: invalid publication")
	}
	seen := make(map[string]bool, len(draftIDs))
	for _, id := range draftIDs {
		if id == "" || seen[id] {
			return errors.New("start review publication: invalid draft IDs")
		}
		seen[id] = true
	}
	body, err := json.Marshal(draftIDs)
	if err != nil {
		return fmt.Errorf("start review publication: encode draft IDs: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return wrap("start review publication", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, id := range draftIDs {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM comments WHERE id=? AND session_id=? AND status=?)`, id, sessionID, domain.CommentDraft).Scan(&exists); err != nil {
			return wrap("start review publication", err)
		}
		if !exists {
			return fmt.Errorf("start review publication: draft %q is unavailable", id)
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT draft_ids_json FROM review_publications WHERE session_id=? AND state IN ('publishing','published')`, sessionID)
	if err != nil {
		return wrap("start review publication", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var existingBody []byte
		if err := rows.Scan(&existingBody); err != nil {
			return wrap("start review publication", err)
		}
		var existingIDs []string
		if err := json.Unmarshal(existingBody, &existingIDs); err != nil {
			return errors.New("start review publication: corrupt existing draft IDs")
		}
		for _, id := range existingIDs {
			if seen[id] {
				return ErrPublicationAlreadyInProgress
			}
		}
	}
	rowsErr := rows.Err()
	if err := rows.Close(); err != nil {
		return wrap("start review publication", err)
	}
	if rowsErr != nil {
		return wrap("start review publication", rowsErr)
	}
	now := encodeTime(time.Now())
	if _, err := tx.ExecContext(ctx, `INSERT INTO review_publications(token,digest,session_id,repo_key,pr_number,head_sha,event,draft_ids_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, token, digest, sessionID, repoKey(ref.Repository), ref.Number, headSHA, event, body, "publishing", now, now); err != nil {
		return wrap("start review publication", err)
	}
	return wrap("start review publication", tx.Commit())
}

func (s *Store) RecordReviewPublicationReceipt(ctx context.Context, token, digest, githubID, githubURL string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE review_publications SET state=CASE WHEN state='publishing' THEN 'published' ELSE state END,github_id=?,github_url=?,updated_at=? WHERE token=? AND digest=? AND (state='publishing' OR (state IN ('published','applied') AND github_id=? AND github_url=?))`, githubID, githubURL, encodeTime(time.Now()), token, digest, githubID, githubURL)
	if err != nil {
		return wrap("record review publication receipt", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return wrap("record review publication receipt", err)
	}
	if count != 1 {
		return fmt.Errorf("record review publication receipt: %w", ErrNotFound)
	}
	return nil
}

func (s *Store) ApplyReviewPublication(ctx context.Context, token, digest string) ([]domain.ReviewComment, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	publication, err := scanReviewPublication(tx.QueryRowContext(ctx, `SELECT token,digest,session_id,draft_ids_json,state,github_id,github_url FROM review_publications WHERE token=? AND digest=?`, token, digest))
	if err != nil {
		return nil, queryErr("load review publication", err)
	}
	if publication.State == "publishing" {
		return nil, ErrPublicationOutcomeUnknown
	}
	if publication.State != "published" && publication.State != "applied" {
		return nil, errors.New("apply review publication: invalid publication state")
	}
	if publication.State == "published" {
		now := encodeTime(time.Now())
		for _, id := range publication.DraftIDs {
			result, updateErr := tx.ExecContext(ctx, `UPDATE comments SET status=?,github_id=?,github_url=?,updated_at=? WHERE id=? AND session_id=? AND status=?`, domain.CommentPublished, publication.GitHubID, publication.GitHubURL, now, id, publication.SessionID, domain.CommentDraft)
			if updateErr != nil {
				return nil, wrap("apply review publication", updateErr)
			}
			count, updateErr := result.RowsAffected()
			if updateErr != nil {
				return nil, wrap("apply review publication", updateErr)
			}
			if count != 1 {
				return nil, fmt.Errorf("apply review publication: draft %q is unavailable", id)
			}
		}
		result, updateErr := tx.ExecContext(ctx, `UPDATE review_publications SET state='applied',updated_at=? WHERE token=? AND digest=? AND state='published'`, now, token, digest)
		if updateErr != nil {
			return nil, wrap("apply review publication", updateErr)
		}
		count, updateErr := result.RowsAffected()
		if updateErr != nil {
			return nil, wrap("apply review publication", updateErr)
		}
		if count != 1 {
			return nil, errors.New("apply review publication: publication state changed")
		}
	}
	comments := make([]domain.ReviewComment, 0, len(publication.DraftIDs))
	for _, id := range publication.DraftIDs {
		comment, loadErr := scanReviewComment(tx.QueryRowContext(ctx, `SELECT id,session_id,chapter_id,kind,body,path,start_line,start_side,line,side,status,github_id,github_url,created_at,updated_at FROM comments WHERE id=? AND session_id=?`, id, publication.SessionID))
		if loadErr != nil {
			return nil, queryErr("load published review comment", loadErr)
		}
		if comment.Status != domain.CommentPublished || comment.GitHubID != publication.GitHubID || comment.GitHubURL != publication.GitHubURL {
			return nil, fmt.Errorf("load published review comment %q: publication receipt does not match", id)
		}
		comments = append(comments, comment)
	}
	if err := tx.Commit(); err != nil {
		return nil, wrap("apply review publication", err)
	}
	return comments, nil
}

func scanReviewPublication(row rowScanner) (reviewPublication, error) {
	var publication reviewPublication
	var draftIDs []byte
	if err := row.Scan(&publication.Token, &publication.Digest, &publication.SessionID, &draftIDs, &publication.State, &publication.GitHubID, &publication.GitHubURL); err != nil {
		return publication, err
	}
	if err := json.Unmarshal(draftIDs, &publication.DraftIDs); err != nil || len(publication.DraftIDs) == 0 {
		return publication, errors.New("corrupt review publication draft IDs")
	}
	return publication, nil
}
