package main

import (
	"sort"
	"strings"

	"reviewarc/internal/domain"
)

const maxDeltaCommits = 20

// GetRevisionDelta reports what changed between the revision the current
// analysis reviewed and the pull request's current head. It reads pinned local
// Git objects only; when either revision is no longer available the delta is
// returned as unavailable instead of failing the stale review view.
func (a *App) GetRevisionDelta(sessionID string) (domain.RevisionDelta, error) {
	ctx := a.appContext()
	session, err := a.store.GetSession(ctx, sessionID)
	if err != nil {
		return domain.RevisionDelta{}, err
	}
	if !session.IsStale || session.Analysis == nil {
		return domain.RevisionDelta{Reason: "The analysis matches the current revision."}, nil
	}
	from := strings.ToLower(session.Analysis.HeadSHA)
	to := strings.ToLower(session.HeadSHA)
	if from == "" || to == "" || from == to {
		return domain.RevisionDelta{Reason: "The previously analyzed revision is not recorded."}, nil
	}
	state, err := a.ensurePreparedContext(ctx, sessionID)
	if err != nil {
		return domain.RevisionDelta{}, err
	}
	files, err := a.repos.DeltaFiles(ctx, state.repository, from, to)
	if err != nil {
		return domain.RevisionDelta{FromHeadSHA: from, ToHeadSHA: to, Reason: "The previously analyzed revision is no longer in the local cache."}, nil
	}
	commits, commitCount, err := a.repos.DeltaCommits(ctx, state.repository, from, to, maxDeltaCommits)
	if err != nil {
		return domain.RevisionDelta{FromHeadSHA: from, ToHeadSHA: to, Reason: "The commit range between the revisions could not be read."}, nil
	}
	return buildRevisionDelta(session, from, to, files, commits, commitCount), nil
}

// buildRevisionDelta annotates the interdiff files with local review context:
// which agent findings cite each path and which paths carry draft comments.
func buildRevisionDelta(session domain.ReviewSession, from, to string, files []domain.ChangedFile, commits []domain.Commit, commitCount int) domain.RevisionDelta {
	findingsByPath := findingTitlesByPath(session.Analysis)
	draftPaths := map[string]bool{}
	for _, comment := range session.Comments {
		if comment.Status == domain.CommentDraft && comment.Kind == domain.CommentInline && comment.Path != "" {
			draftPaths[comment.Path] = true
		}
	}
	deltaFiles := make([]domain.RevisionDeltaFile, 0, len(files))
	for _, file := range files {
		titles := append([]string(nil), findingsByPath[file.Path]...)
		if file.PreviousPath != "" {
			titles = append(titles, findingsByPath[file.PreviousPath]...)
		}
		deltaFiles = append(deltaFiles, domain.RevisionDeltaFile{
			File:            file,
			CitedByFindings: dedupeStrings(titles),
			HasDraftComment: draftPaths[file.Path] || (file.PreviousPath != "" && draftPaths[file.PreviousPath]),
		})
	}
	sort.SliceStable(deltaFiles, func(i, j int) bool {
		left, right := deltaFiles[i], deltaFiles[j]
		if (len(left.CitedByFindings) > 0) != (len(right.CitedByFindings) > 0) {
			return len(left.CitedByFindings) > 0
		}
		if left.HasDraftComment != right.HasDraftComment {
			return left.HasDraftComment
		}
		return left.File.Path < right.File.Path
	})
	baseChanged := session.Analysis != nil && session.Analysis.BaseSHA != "" && session.BaseSHA != "" &&
		!strings.EqualFold(session.Analysis.BaseSHA, session.BaseSHA)
	return domain.RevisionDelta{
		Available:   true,
		FromHeadSHA: from,
		ToHeadSHA:   to,
		BaseChanged: baseChanged,
		CommitCount: commitCount,
		Commits:     commits,
		Files:       deltaFiles,
	}
}

// findingTitlesByPath indexes evidence paths by the finding titles that cite
// them, mirroring which findings the review brief presents: explicit agent
// judgments when present, otherwise legacy risks and unknowns.
func findingTitlesByPath(analysis *domain.ReviewAnalysis) map[string][]string {
	index := map[string][]string{}
	if analysis == nil {
		return index
	}
	add := func(title string, evidence []domain.EvidenceReference) {
		if title == "" {
			return
		}
		for _, reference := range evidence {
			if reference.Path == "" {
				continue
			}
			index[reference.Path] = append(index[reference.Path], title)
		}
	}
	if len(analysis.Judgments) > 0 {
		for _, judgment := range analysis.Judgments {
			for _, observation := range judgment.Observations {
				add(judgment.Title, observation.Evidence)
			}
		}
		return index
	}
	for _, risk := range analysis.Risks {
		add(risk.Title, risk.Evidence)
	}
	for _, unknown := range analysis.Unknowns {
		add(unknown.Text, unknown.Evidence)
	}
	for _, chapter := range analysis.Chapters {
		for _, risk := range chapter.Risks {
			add(risk.Title, risk.Evidence)
		}
		for _, unknown := range chapter.Unknowns {
			add(unknown.Text, unknown.Evidence)
		}
	}
	return index
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := values[:0]
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
