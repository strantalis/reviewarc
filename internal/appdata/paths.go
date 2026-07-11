package appdata

import (
	"fmt"
	"os"
	"path/filepath"

	"reviewarc/internal/domain"
)

func Resolve() (domain.AppPaths, error) {
	root := os.Getenv("REVIEWARC_DATA_DIR")
	if root == "" {
		config, err := os.UserConfigDir()
		if err != nil {
			return domain.AppPaths{}, fmt.Errorf("resolve user config directory: %w", err)
		}
		root = filepath.Join(config, "ReviewArc")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return domain.AppPaths{}, fmt.Errorf("resolve app data directory: %w", err)
	}
	p := domain.AppPaths{Root: root, Repositories: filepath.Join(root, "repositories"), Worktrees: filepath.Join(root, "worktrees"), Database: filepath.Join(root, "database", "reviewarc.db"), Logs: filepath.Join(root, "logs"), Cache: filepath.Join(root, "cache")}
	for _, dir := range []string{p.Root, p.Repositories, p.Worktrees, filepath.Dir(p.Database), p.Logs, p.Cache} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return domain.AppPaths{}, fmt.Errorf("create app data directory: %w", err)
		}
	}
	return p, nil
}
