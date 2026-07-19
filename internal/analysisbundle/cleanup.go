package analysisbundle

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultStaleAge is deliberately longer than a normal analysis run. It keeps
// a cleanup pass from racing an unusually slow, still-running analysis when a
// caller does not provide its active lease paths.
const DefaultStaleAge = 24 * time.Hour

// ScavengeOptions controls cleanup of finalized analysis bundles.
//
// ProtectedPaths is a set of absolute bundle paths currently leased by this
// process. A protected bundle is never removed, even after OlderThan has
// elapsed. OlderThan defaults to DefaultStaleAge and must not be negative.
type ScavengeOptions struct {
	ProtectedPaths map[string]struct{}
	OlderThan      time.Duration
	Now            func() time.Time
}

// ScavengeResult reports only bundles actually removed. Paths are absolute.
type ScavengeResult struct {
	Removed []string
}

// Scavenge removes abandoned, finalized analysis bundles from dataRoot. It
// never creates the bundle root and ignores unrecognized files, staging
// directories, symlinks, and bundles that are too recent or actively leased.
func Scavenge(dataRoot string, options ScavengeOptions) (ScavengeResult, error) {
	return ScavengeRoot(BundleRoot(dataRoot), options)
}

// ScavengeRoot is Scavenge's root-oriented form, primarily useful when the
// application has already resolved its private bundle directory.
func ScavengeRoot(root string, options ScavengeOptions) (ScavengeResult, error) {
	root, err := filepath.Abs(root)
	if err != nil || root == string(filepath.Separator) {
		return ScavengeResult{}, errors.New("analysis bundle root must be an absolute private directory")
	}
	if options.OlderThan < 0 {
		return ScavengeResult{}, errors.New("analysis bundle stale age cannot be negative")
	}
	olderThan := options.OlderThan
	if olderThan == 0 {
		olderThan = DefaultStaleAge
	}
	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	protected := canonicalProtectedPaths(options.ProtectedPaths)

	info, err := os.Lstat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return ScavengeResult{}, nil
	}
	if err != nil {
		return ScavengeResult{}, fmt.Errorf("inspect analysis bundle root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return ScavengeResult{}, errors.New("analysis bundle root is unavailable or unsafe")
	}
	rooted, err := os.OpenRoot(root)
	if err != nil {
		return ScavengeResult{}, fmt.Errorf("open analysis bundle root: %w", err)
	}
	defer func() { _ = rooted.Close() }()
	directory, err := rooted.Open(".")
	if err != nil {
		return ScavengeResult{}, fmt.Errorf("read analysis bundle root: %w", err)
	}
	entries, err := directory.ReadDir(-1)
	closeErr := directory.Close()
	if err != nil {
		return ScavengeResult{}, fmt.Errorf("read analysis bundle root: %w", err)
	}
	if closeErr != nil {
		return ScavengeResult{}, fmt.Errorf("close analysis bundle root: %w", closeErr)
	}

	cutoff := now().Add(-olderThan)
	result := ScavengeResult{}
	for _, entry := range entries {
		name := entry.Name()
		if !finalBundleName(name) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		path := filepath.Join(root, name)
		if protected[path] {
			continue
		}
		info, err := rooted.Lstat(name)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("inspect analysis bundle %q: %w", name, err)
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.ModTime().After(cutoff) {
			continue
		}
		if err := rooted.RemoveAll(name); err != nil {
			return result, fmt.Errorf("remove stale analysis bundle %q: %w", name, err)
		}
		result.Removed = append(result.Removed, path)
	}
	return result, nil
}

func canonicalProtectedPaths(paths map[string]struct{}) map[string]bool {
	protected := make(map[string]bool, len(paths))
	for path := range paths {
		absolute, err := filepath.Abs(path)
		if err == nil {
			protected[absolute] = true
		}
	}
	return protected
}

func finalBundleName(name string) bool {
	if !strings.HasPrefix(name, "bundle-") || len(name) != len("bundle-")+32 {
		return false
	}
	return validHex(strings.TrimPrefix(name, "bundle-"))
}
