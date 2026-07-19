package analysisbundle

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScavengeRootRemovesOnlyOldFinalizedUnprotectedBundles(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	old := makeCleanupBundle(t, root, "11111111111111111111111111111111", now.Add(-25*time.Hour))
	protected := makeCleanupBundle(t, root, "22222222222222222222222222222222", now.Add(-25*time.Hour))
	recent := makeCleanupBundle(t, root, "33333333333333333333333333333333", now.Add(-23*time.Hour))
	stage := filepath.Join(root, ".stage-kept")
	if err := os.Mkdir(stage, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(stage, now.Add(-48*time.Hour), now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("not a bundle"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := ScavengeRoot(root, ScavengeOptions{
		OlderThan: 24 * time.Hour,
		Now:       func() time.Time { return now },
		ProtectedPaths: map[string]struct{}{
			protected: {},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 1 || result.Removed[0] != old {
		t.Fatalf("removed=%v, want [%s]", result.Removed, old)
	}
	for _, path := range []string{protected, recent, stage, filepath.Join(root, "notes.txt")} {
		if _, err := os.Lstat(path); err != nil {
			t.Fatalf("preserved path %q: %v", path, err)
		}
	}
	if _, err := os.Lstat(old); !os.IsNotExist(err) {
		t.Fatalf("stale bundle survives: %v", err)
	}
}

func TestScavengeRootSkipsSymlinksAndUnsafeNames(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	unsafe := filepath.Join(root, "bundle-not-a-real-id")
	if err := os.Mkdir(unsafe, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(unsafe, now.Add(-48*time.Hour), now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	link := filepath.Join(root, "bundle-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}

	if _, err := ScavengeRoot(root, ScavengeOptions{OlderThan: time.Hour, Now: func() time.Time { return now }}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{unsafe, link, target} {
		if _, err := os.Lstat(path); err != nil {
			t.Fatalf("unsafe path %q was changed: %v", path, err)
		}
	}
}

func TestScavengeRootDoesNotCreateMissingDirectoryAndRejectsUnsafeInput(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	if _, err := ScavengeRoot(missing, ScavengeOptions{}); err != nil {
		t.Fatalf("missing root error: %v", err)
	}
	if _, err := os.Lstat(missing); !os.IsNotExist(err) {
		t.Fatalf("missing root was created: %v", err)
	}
	if _, err := ScavengeRoot(t.TempDir(), ScavengeOptions{OlderThan: -time.Second}); err == nil {
		t.Fatal("negative stale age was accepted")
	}
}

func makeCleanupBundle(t *testing.T, root, id string, modified time.Time) string {
	t.Helper()
	path := filepath.Join(root, "bundle-"+id)
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modified, modified); err != nil {
		t.Fatal(err)
	}
	return path
}
