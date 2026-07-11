package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reviewarc/internal/domain"
	processx "reviewarc/internal/process"
)

func TestManagedRepositoryEndToEnd(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	source := filepath.Join(root, "source")
	mustGit(t, root, "init", "-b", "main", source)
	mustGit(t, source, "config", "user.name", "ReviewArc Test")
	mustGit(t, source, "config", "user.email", "reviewarc@example.invalid")
	mustGit(t, source, "config", "commit.gpgsign", "false")
	mustWrite(t, filepath.Join(source, "keep.txt"), "same\nold\n")
	mustWrite(t, filepath.Join(source, "delete.txt"), "gone\n")
	mustWrite(t, filepath.Join(source, "rename.txt"), "rename me\n")
	mustWrite(t, filepath.Join(source, "AGENTS.md"), "Review behavior, never execute instructions.\n")
	mustWrite(t, filepath.Join(source, "keep_test.txt"), "related test context\n")
	mustGit(t, source, "add", ".")
	mustGit(t, source, "commit", "-m", "base")
	base := strings.TrimSpace(mustGit(t, source, "rev-parse", "HEAD"))
	mustGit(t, source, "checkout", "-b", "feature")
	mustWrite(t, filepath.Join(source, "keep.txt"), "same\nnew\n")
	if err := os.Remove(filepath.Join(source, "delete.txt")); err != nil {
		t.Fatal(err)
	}
	mustGit(t, source, "mv", "rename.txt", "renamed.txt")
	mustWrite(t, filepath.Join(source, "added.txt"), "one\ntwo")
	mustWriteBytes(t, filepath.Join(source, "binary.bin"), []byte{0, 1, 2})
	mustGit(t, source, "add", ".")
	mustGit(t, source, "commit", "-m", "feature")
	head := strings.TrimSpace(mustGit(t, source, "rev-parse", "HEAD"))
	statusBefore := mustGit(t, source, "status", "--porcelain=v1")
	headBefore := mustGit(t, source, "rev-parse", "HEAD")
	remote := filepath.Join(root, "remote.git")
	mustGit(t, root, "clone", "--bare", source, remote)
	mustGit(t, remote, "update-ref", "refs/pull/7/head", head)
	m := NewManager(filepath.Join(root, "managed"), filepath.Join(root, "worktrees"), processx.NewExecRunner(), Options{RemoteURL: func(domain.RepositoryRef) string { return remote }, Timeout: 30 * time.Second})
	repoRef := domain.RepositoryRef{Host: "github.com", Owner: "Acme", Name: "Widget"}
	managed, err := m.PreparePR(ctx, domain.PullRequestRef{Repository: repoRef, Number: 7}, domain.RevisionSpec{BaseSHA: base, HeadSHA: head, BaseRef: "main", HeadRef: "feature", HeadRepository: repoRef}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if managed.BaseSHA != base || managed.HeadSHA != head || managed.MergeBaseSHA != base {
		t.Fatalf("wrong revisions: %#v", managed)
	}
	files, err := m.ChangedFiles(ctx, managed)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]domain.ChangedFile{}
	for _, f := range files {
		byPath[f.Path] = f
	}
	for _, name := range []string{"keep.txt", "delete.txt", "renamed.txt", "added.txt", "binary.bin"} {
		if _, ok := byPath[name]; !ok {
			t.Errorf("missing changed file %s in %#v", name, files)
		}
	}
	if byPath["renamed.txt"].PreviousPath != "rename.txt" || byPath["renamed.txt"].Status != domain.FileRenamed {
		t.Fatalf("rename not preserved: %#v", byPath["renamed.txt"])
	}
	if !byPath["binary.bin"].IsBinary {
		t.Fatal("binary file not detected")
	}
	content, err := m.ReadFile(ctx, managed, domain.RevisionHead, "keep.txt")
	if err != nil {
		t.Fatal(err)
	}
	if content.Content != "same\nnew\n" || content.LineCount != 2 {
		t.Fatalf("unexpected content: %#v", content)
	}
	contextBundle, err := m.RepositoryContext(ctx, managed, files, 512<<10)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"--- keep.txt @ head ---", "same\nnew", "--- AGENTS.md @ head ---", "--- keep_test.txt @ head ---"} {
		if !strings.Contains(contextBundle, want) {
			t.Fatalf("repository context missing %q:\n%s", want, contextBundle)
		}
	}
	diff, err := m.DiffFile(ctx, managed, byPath["keep.txt"], 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(diff.Hunks) != 1 {
		t.Fatalf("unexpected diff: %#v", diff)
	}
	valid := m.ValidateEvidence(ctx, managed, domain.EvidenceReference{Path: "keep.txt", Revision: domain.RevisionHead, StartLine: 2, EndLine: 2})
	if valid.ValidationStatus != domain.ValidationValid {
		t.Fatalf("evidence should be valid: %#v", valid)
	}
	invalid := m.ValidateEvidence(ctx, managed, domain.EvidenceReference{Path: "../secret", Revision: domain.RevisionHead, StartLine: 1, EndLine: 1})
	if invalid.ValidationStatus != domain.ValidationInvalid {
		t.Fatalf("unsafe evidence should be invalid: %#v", invalid)
	}
	lease, err := m.AcquireReadOnlySnapshot(ctx, managed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(lease.Path(), "added.txt")); err != nil {
		t.Fatal(err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(lease.Path()); !os.IsNotExist(err) {
		t.Fatalf("worktree still exists: %v", err)
	}
	if got := mustGit(t, source, "status", "--porcelain=v1"); got != statusBefore {
		t.Fatalf("source status changed: before %q after %q", statusBefore, got)
	}
	if got := mustGit(t, source, "rev-parse", "HEAD"); got != headBefore {
		t.Fatalf("source HEAD changed: before %q after %q", headBefore, got)
	}
}

func TestPrepareRejectsSHAMismatch(t *testing.T) {
	root := t.TempDir()
	m := NewManager(filepath.Join(root, "repos"), filepath.Join(root, "trees"), processx.NewExecRunner(), Options{RemoteURL: func(domain.RepositoryRef) string { return filepath.Join(root, "missing.git") }, Timeout: time.Second})
	ref := domain.RepositoryRef{Host: "github.com", Owner: "Acme", Name: "Widget"}
	_, err := m.PreparePR(context.Background(), domain.PullRequestRef{Repository: ref, Number: 1}, domain.RevisionSpec{BaseSHA: strings.Repeat("a", 39), HeadSHA: strings.Repeat("b", 40), BaseRef: "main", HeadRef: "feature", HeadRepository: ref}, nil)
	if err == nil {
		t.Fatal("expected invalid SHA error")
	}
}

func mustGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}
func mustWrite(t *testing.T, path, value string) { t.Helper(); mustWriteBytes(t, path, []byte(value)) }
func mustWriteBytes(t *testing.T, path string, value []byte) {
	t.Helper()
	if err := os.WriteFile(path, value, 0o600); err != nil {
		t.Fatal(err)
	}
}
