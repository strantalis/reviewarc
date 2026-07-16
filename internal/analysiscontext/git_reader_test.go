package analysiscontext

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"reviewarc/internal/domain"
	processpkg "reviewarc/internal/process"
)

func TestGitObjectReaderUsesPinnedObjectsAndLiteralSearch(t *testing.T) {
	repo := t.TempDir()
	runGit(t, repo, "init")
	runGit(t, repo, "config", "user.email", "reviewarc@example.com")
	runGit(t, repo, "config", "user.name", "ReviewArc Test")
	if err := os.MkdirAll(filepath.Join(repo, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "src", "main.go"), []byte("package main\n// literal -n marker\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "binary.dat"), []byte{'a', 0, 'b'}, 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, repo, "add", "--", "src/main.go", "binary.dat")
	runGit(t, repo, "-c", "commit.gpgsign=false", "commit", "-m", "base")
	base := strings.TrimSpace(runGit(t, repo, "rev-parse", "HEAD"))
	if err := os.WriteFile(filepath.Join(repo, "src", "main.go"), []byte("package main\n// literal -n marker\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, repo, "add", "--", "src/main.go")
	runGit(t, repo, "-c", "commit.gpgsign=false", "commit", "-m", "head")
	head := strings.TrimSpace(runGit(t, repo, "rev-parse", "HEAD"))
	bare := filepath.Join(t.TempDir(), "repo.git")
	runGit(t, "", "clone", "--bare", repo, bare)

	reader, err := NewGitObjectReader(processpkg.NewExecRunner(), bare, base, head)
	if err != nil {
		t.Fatal(err)
	}
	content, binary, err := reader.ReadFile(context.Background(), domain.RevisionBase, "src/main.go")
	if err != nil || binary || strings.Contains(content, "func main") {
		t.Fatalf("base content=%q binary=%t err=%v", content, binary, err)
	}
	content, binary, err = reader.ReadFile(context.Background(), domain.RevisionHead, "src/main.go")
	if err != nil || binary || !strings.Contains(content, "func main") {
		t.Fatalf("head content=%q binary=%t err=%v", content, binary, err)
	}
	if _, binary, err := reader.ReadFile(context.Background(), domain.RevisionHead, "binary.dat"); err != nil || !binary {
		t.Fatalf("binary=%t err=%v", binary, err)
	}
	if _, _, err := reader.ReadFile(context.Background(), domain.RevisionHead, "../outside"); err == nil {
		t.Fatal("path traversal was accepted")
	}
	matches, err := reader.Search(context.Background(), domain.RevisionHead, "-n marker")
	if err != nil || len(matches) != 1 || matches[0].Path != "src/main.go" || matches[0].Line != 2 {
		t.Fatalf("matches=%+v err=%v", matches, err)
	}
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	command := exec.CommandContext(context.Background(), "git", args...)
	if dir != "" {
		command.Dir = dir
	}
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return string(output)
}
