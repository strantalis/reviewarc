package git

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reviewarc/internal/domain"
	processx "reviewarc/internal/process"
)

func TestDeltaBetweenPreparedRevisions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	source := filepath.Join(root, "source")
	mustGit(t, root, "init", "-b", "main", source)
	mustGit(t, source, "config", "user.name", "ReviewArc Test")
	mustGit(t, source, "config", "user.email", "reviewarc@example.invalid")
	mustGit(t, source, "config", "commit.gpgsign", "false")
	mustWrite(t, filepath.Join(source, "a.txt"), "a\n")
	mustWrite(t, filepath.Join(source, "b.txt"), "b\n")
	mustGit(t, source, "add", ".")
	mustGit(t, source, "commit", "-m", "base")
	base := strings.TrimSpace(mustGit(t, source, "rev-parse", "HEAD"))
	mustGit(t, source, "checkout", "-b", "feature")
	mustWrite(t, filepath.Join(source, "a.txt"), "a\nchanged\n")
	mustGit(t, source, "add", ".")
	mustGit(t, source, "commit", "-m", "first review head")
	firstHead := strings.TrimSpace(mustGit(t, source, "rev-parse", "HEAD"))

	remote := filepath.Join(root, "remote.git")
	mustGit(t, root, "clone", "--bare", source, remote)
	mustGit(t, remote, "update-ref", "refs/pull/7/head", firstHead)

	m := NewManager(filepath.Join(root, "managed"), filepath.Join(root, "worktrees"), processx.NewExecRunner(), Options{RemoteURL: func(domain.RepositoryRef) string { return remote }, Timeout: 30 * time.Second})
	repoRef := domain.RepositoryRef{Host: "github.com", Owner: "Acme", Name: "Widget"}
	prRef := domain.PullRequestRef{Repository: repoRef, Number: 7}
	spec := domain.RevisionSpec{BaseSHA: base, HeadSHA: firstHead, BaseRef: "main", HeadRef: "feature", HeadRepository: repoRef}
	if _, err := m.PreparePR(ctx, prRef, spec, nil); err != nil {
		t.Fatal(err)
	}

	mustWrite(t, filepath.Join(source, "b.txt"), "b\nupdated\n")
	mustWrite(t, filepath.Join(source, "c.txt"), "new\n")
	mustGit(t, source, "add", ".")
	mustGit(t, source, "commit", "-m", "address review feedback")
	secondHead := strings.TrimSpace(mustGit(t, source, "rev-parse", "HEAD"))
	mustGit(t, source, "push", remote, "feature:feature")
	mustGit(t, remote, "update-ref", "refs/pull/7/head", secondHead)

	spec.HeadSHA = secondHead
	managed, err := m.PreparePR(ctx, prRef, spec, nil)
	if err != nil {
		t.Fatal(err)
	}

	files, err := m.DeltaFiles(ctx, managed, firstHead, secondHead)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]domain.ChangedFile{}
	for _, f := range files {
		byPath[f.Path] = f
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 delta files, got %#v", files)
	}
	if byPath["b.txt"].Status != domain.FileModified || byPath["b.txt"].Additions != 1 {
		t.Fatalf("b.txt delta wrong: %#v", byPath["b.txt"])
	}
	if byPath["c.txt"].Status != domain.FileAdded {
		t.Fatalf("c.txt delta wrong: %#v", byPath["c.txt"])
	}

	commits, count, err := m.DeltaCommits(ctx, managed, firstHead, secondHead, 10)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || len(commits) != 1 {
		t.Fatalf("expected exactly one delta commit, got count=%d commits=%#v", count, commits)
	}
	if commits[0].SHA != secondHead || commits[0].Message != "address review feedback" || commits[0].Author.Name != "ReviewArc Test" {
		t.Fatalf("commit metadata wrong: %#v", commits[0])
	}
	if commits[0].AuthoredAt.IsZero() {
		t.Fatal("commit authored time missing")
	}

	if _, err := m.DeltaFiles(ctx, managed, strings.Repeat("e", 40), secondHead); err == nil {
		t.Fatal("missing from-revision should fail so callers can report the delta as unavailable")
	}
	if _, _, err := m.DeltaCommits(ctx, managed, "not-a-sha", secondHead, 10); err == nil {
		t.Fatal("invalid revision should be rejected")
	}
}
