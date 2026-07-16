package analysisbundle

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reviewarc/internal/domain"
	gitcache "reviewarc/internal/git"
)

type patchSource map[string]string

func (p patchSource) DiffFile(_ context.Context, _ gitcache.ManagedRepository, file domain.ChangedFile, _ int) (domain.DiffFile, error) {
	return domain.DiffFile{File: file, Patch: p[file.Path]}, nil
}

func fixtureInput(files []domain.ChangedFile) Input {
	return Input{
		PullRequest:  domain.PullRequest{PullRequestSummary: domain.PullRequestSummary{Ref: domain.PullRequestRef{Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, Number: 7}, Title: "Review bundle"}},
		Repository:   gitcache.ManagedRepository{ID: "acme/api", Repository: domain.RepositoryRef{Host: "github.com", Owner: "acme", Name: "api"}, PullRequest: 7, BaseSHA: strings.Repeat("1", 40), HeadSHA: strings.Repeat("2", 40), MergeBaseSHA: strings.Repeat("3", 40)},
		ChangedFiles: files,
	}
}

func TestBuildFinalizesPrivateVerifiedBundle(t *testing.T) {
	dataRoot := t.TempDir()
	file := domain.ChangedFile{Path: "src/main.go", Status: domain.FileModified, Additions: 1, Deletions: 1}
	lease, err := (Builder{Root: BundleRoot(dataRoot), Source: patchSource{file.Path: "diff --git a/src/main.go b/src/main.go\n@@ -1 +1 @@\n-old\n+new\n"}}).Build(context.Background(), fixtureInput([]domain.ChangedFile{file}))
	if err != nil {
		t.Fatal(err)
	}
	path := lease.Reference.Path
	t.Cleanup(func() { _ = lease.Close() })
	bundle, err := Open(dataRoot, path, lease.Reference.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Manifest.Changes[0].ID != "f000001" || bundle.Manifest.Changes[0].Diff.Path != "diffs/f000001.patch" || !strings.Contains(bundle.Manifest.Changes[0].Preview, "+new") {
		t.Fatalf("manifest change=%+v", bundle.Manifest.Changes[0])
	}
	for _, name := range []string{"manifest.json", "pr.json", "discussion.json", "diffs/f000001.patch"} {
		info, statErr := os.Stat(filepath.Join(path, name))
		if statErr != nil {
			t.Fatalf("artifact %s: %v", name, statErr)
		}
		if info.Mode().Perm()&0o022 != 0 {
			t.Fatalf("artifact %s mode=%v", name, info.Mode())
		}
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("bundle survived lease close: %v", err)
	}
}

func TestOversizedProviderPromptBecomesPagedLocalArtifact(t *testing.T) {
	const reproducedProviderInputBytes = 1_055_787
	dataRoot := t.TempDir()
	file := domain.ChangedFile{Path: "generated/large.txt", Status: domain.FileModified, Additions: 1}
	patch := strings.Repeat("x", reproducedProviderInputBytes)
	lease, err := (Builder{Root: BundleRoot(dataRoot), Source: patchSource{file.Path: patch}}).Build(context.Background(), fixtureInput([]domain.ChangedFile{file}))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	bundle, err := Open(dataRoot, lease.Reference.Path, lease.Reference.Digest)
	if err != nil {
		t.Fatal(err)
	}
	artifact := bundle.Manifest.Changes[0].Diff
	if artifact.Bytes != reproducedProviderInputBytes || artifact.Pages < 2 {
		t.Fatalf("artifact=%+v", artifact)
	}
	prompt := LaunchPrompt(lease.Reference)
	if len(prompt) >= 16<<10 || strings.Contains(prompt, strings.Repeat("x", 128)) || !strings.Contains(prompt, "continue paging until hasMore is false") {
		t.Fatalf("launch prompt bytes=%d content=%q", len(prompt), prompt)
	}
}

func TestRepresentativeDiffPreviewSamplesLargePatchWithoutEmbeddingIt(t *testing.T) {
	patch := strings.Repeat("A", 1200) + strings.Repeat("B", 1200) + strings.Repeat("C", 1200)
	preview, truncated := representativeDiffPreview(patch)
	if !truncated || len(preview) > diffPreviewBytes {
		t.Fatalf("preview bytes=%d truncated=%t", len(preview), truncated)
	}
	for _, marker := range []string{"AAAA", "BBBB", "CCCC"} {
		if !strings.Contains(preview, marker) {
			t.Fatalf("preview did not sample %q: %q", marker, preview)
		}
	}
}

func TestOpenRejectsDigestAndArtifactTampering(t *testing.T) {
	dataRoot := t.TempDir()
	file := domain.ChangedFile{Path: "main.go", Status: domain.FileModified}
	lease, err := (Builder{Root: BundleRoot(dataRoot), Source: patchSource{file.Path: "patch"}}).Build(context.Background(), fixtureInput([]domain.ChangedFile{file}))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if _, err := Open(dataRoot, lease.Reference.Path, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("digest error=%v", err)
	}
	patch := filepath.Join(lease.Reference.Path, "diffs", "f000001.patch")
	if err := os.Chmod(patch, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(patch, []byte("other"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dataRoot, lease.Reference.Path, lease.Reference.Digest); err == nil {
		t.Fatal("tampered artifact was accepted")
	}
}

func TestOpenRejectsBundleOutsidePrivateRoot(t *testing.T) {
	dataRoot := t.TempDir()
	outside := filepath.Join(t.TempDir(), "bundle-outside")
	if err := os.Mkdir(outside, 0o500); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dataRoot, outside, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("outside bundle error=%v", err)
	}
}

func TestOpenRejectsUnexpectedBundleEntries(t *testing.T) {
	dataRoot := t.TempDir()
	file := domain.ChangedFile{Path: "main.go", Status: domain.FileModified}
	lease, err := (Builder{Root: BundleRoot(dataRoot), Source: patchSource{file.Path: "patch"}}).Build(context.Background(), fixtureInput([]domain.ChangedFile{file}))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if err := os.Chmod(lease.Reference.Path, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lease.Reference.Path, "unexpected"), []byte("untrusted"), 0o400); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lease.Reference.Path, 0o500); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dataRoot, lease.Reference.Path, lease.Reference.Digest); err == nil || !strings.Contains(err.Error(), "unexpected") {
		t.Fatalf("unexpected entry error=%v", err)
	}
}

func TestLargeMultiFileBundleKeepsLaunchPromptSmall(t *testing.T) {
	dataRoot := t.TempDir()
	files := make([]domain.ChangedFile, 0, 18)
	patches := patchSource{}
	for i := 0; i < 18; i++ {
		path := "src/file" + string(rune('a'+i)) + ".go"
		files = append(files, domain.ChangedFile{Path: path, Status: domain.FileModified, Additions: 1})
		patches[path] = "diff --git a/" + path + " b/" + path + "\n" + strings.Repeat("+large context line\n", 3500)
	}
	lease, err := (Builder{Root: BundleRoot(dataRoot), Source: patches}).Build(context.Background(), fixtureInput(files))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	bundle, err := Open(dataRoot, lease.Reference.Path, lease.Reference.Digest)
	if err != nil {
		t.Fatal(err)
	}
	var bytes int64
	for _, change := range bundle.Manifest.Changes {
		bytes += change.Diff.Bytes
	}
	if bytes <= 1_055_787 {
		t.Fatalf("bundle diff bytes=%d, want screenshot-sized regression input", bytes)
	}
	if prompt := LaunchPrompt(lease.Reference); len(prompt) >= 2048 || strings.Contains(prompt, "large context line") {
		t.Fatalf("launch prompt unexpectedly contains bundle payload: bytes=%d", len(prompt))
	}
}

func TestBuildRejectsTraversalAndDuplicatePaths(t *testing.T) {
	for _, files := range [][]domain.ChangedFile{
		{{Path: "../escape", Status: domain.FileModified}},
		{{Path: "same.go", Status: domain.FileModified}, {Path: "same.go", Status: domain.FileModified}},
	} {
		if _, err := (Builder{Root: BundleRoot(t.TempDir()), Source: patchSource{}}).Build(context.Background(), fixtureInput(files)); err == nil {
			t.Fatalf("unsafe changed files accepted: %+v", files)
		}
	}
}
