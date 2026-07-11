package git

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	processx "reviewarc/internal/process"
)

const markerSuffix = ".reviewarc-lease.json"

type leaseMarker struct {
	CachePath, WorktreePath, SHA string
	CreatedAt                    time.Time
}

type SnapshotLease struct {
	manager      *Manager
	repo         ManagedRepository
	path, marker string
	once         sync.Once
	err          error
}

func (l *SnapshotLease) Path() string { return l.path }
func (l *SnapshotLease) Close() error {
	l.once.Do(func() { l.err = l.manager.removeSnapshot(context.Background(), l.repo, l.path, l.marker) })
	return l.err
}

func (m *Manager) AcquireReadOnlySnapshot(ctx context.Context, repo ManagedRepository) (*SnapshotLease, error) {
	root := filepath.Join(m.worktrees, "github.com", strings.ToLower(repo.Repository.Owner), strings.ToLower(repo.Repository.Name), fmt.Sprintf("pr-%d", repo.PullRequest))
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	pathName := filepath.Join(root, randomID())
	if !contained(m.worktrees, pathName) {
		return nil, errors.New("unsafe worktree location")
	}
	l := m.lock(repo.ID)
	l.Lock()
	defer l.Unlock()
	if _, err := m.git(ctx, "--git-dir="+repo.CachePath, "-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", pathName, repo.HeadSHA); err != nil {
		return nil, fmt.Errorf("create isolated worktree: %w", err)
	}
	marker := pathName + markerSuffix
	payload, _ := json.Marshal(leaseMarker{CachePath: repo.CachePath, WorktreePath: pathName, SHA: repo.HeadSHA, CreatedAt: time.Now().UTC()})
	if err := os.WriteFile(marker, payload, 0o600); err != nil {
		_, _ = m.git(ctx, "--git-dir="+repo.CachePath, "worktree", "remove", "--force", pathName)
		return nil, err
	}
	m.mu.Lock()
	m.activeSnapshots[pathName] = true
	m.mu.Unlock()
	return &SnapshotLease{manager: m, repo: repo, path: pathName, marker: marker}, nil
}

func (m *Manager) removeSnapshot(ctx context.Context, repo ManagedRepository, pathName, marker string) error {
	if !contained(m.worktrees, pathName) || marker != pathName+markerSuffix {
		return errors.New("refusing unsafe worktree cleanup")
	}
	l := m.lock(repo.ID)
	l.Lock()
	defer l.Unlock()
	_, err := m.run(ctx, processx.Command{Tool: processx.Git, Args: []string{"--git-dir=" + repo.CachePath, "worktree", "remove", "--force", pathName}, Timeout: m.timeout})
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Remove(marker); err != nil && !os.IsNotExist(err) {
		return err
	}
	m.mu.Lock()
	delete(m.activeSnapshots, pathName)
	m.mu.Unlock()
	return nil
}

// CleanupStaleSnapshots removes only expired, marked, inactive app-owned worktrees.
func (m *Manager) CleanupStaleSnapshots(ctx context.Context, olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan)
	return filepath.WalkDir(m.worktrees, func(pathName string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), markerSuffix) {
			return nil
		}
		data, err := os.ReadFile(pathName)
		if err != nil {
			return err
		}
		var marker leaseMarker
		if json.Unmarshal(data, &marker) != nil || marker.WorktreePath+markerSuffix != pathName || !contained(m.worktrees, marker.WorktreePath) || !contained(m.repositories, marker.CachePath) || marker.CreatedAt.After(cutoff) {
			return nil
		}
		m.mu.Lock()
		active := m.activeSnapshots[marker.WorktreePath]
		m.mu.Unlock()
		if active {
			return nil
		}
		repo := ManagedRepository{ID: marker.CachePath, CachePath: marker.CachePath}
		return m.removeSnapshot(ctx, repo, marker.WorktreePath, pathName)
	})
}

func contained(root, target string) bool {
	r, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	t, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(r, t)
	return err == nil && rel != "." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}
