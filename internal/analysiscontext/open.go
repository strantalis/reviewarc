package analysiscontext

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"reviewarc/internal/analysisbundle"
	processpkg "reviewarc/internal/process"
)

func Open(dataRoot, bundlePath, digest string, runner processpkg.Runner) (*Service, error) {
	root, err := filepath.Abs(dataRoot)
	if err != nil || root == string(filepath.Separator) {
		return nil, errors.New("data root must be an absolute private directory")
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o022 != 0 {
		return nil, errors.New("data root is unavailable or writable by other users")
	}
	bundle, err := analysisbundle.Open(root, bundlePath, digest)
	if err != nil {
		return nil, err
	}
	repo := bundle.Manifest.Repository
	cache := filepath.Join(root, "repositories", "github.com", strings.ToLower(repo.Owner), strings.ToLower(repo.Name)+".git")
	if !contained(filepath.Join(root, "repositories"), cache) {
		return nil, errors.New("derived repository cache path is unsafe")
	}
	cacheInfo, err := os.Lstat(cache)
	if err != nil || !cacheInfo.IsDir() || cacheInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("pinned repository cache is unavailable or unsafe")
	}
	reader, err := NewGitObjectReader(runner, cache, bundle.Manifest.Revisions.Base, bundle.Manifest.Revisions.Head)
	if err != nil {
		return nil, err
	}
	return New(bundle, reader)
}

func contained(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
