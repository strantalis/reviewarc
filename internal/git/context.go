package git

import (
	"bytes"
	"context"
	"fmt"
	"path"
	"sort"
	"strings"

	"reviewarc/internal/domain"
)

const (
	defaultContextBytes = 512 << 10
	maxContextFileBytes = 96 << 10
)

// RepositoryContext returns bounded, object-backed repository text for a
// tool-less analyst: complete changed files plus nearby instructions and
// heuristically related tests. It never reads the worktree filesystem.
func (m *Manager) RepositoryContext(ctx context.Context, repo ManagedRepository, changed []domain.ChangedFile, maxBytes int) (string, error) {
	if maxBytes <= 0 || maxBytes > defaultContextBytes {
		maxBytes = defaultContextBytes
	}
	l := m.lock(repo.ID)
	l.RLock()
	tree, err := m.git(ctx, "--git-dir="+repo.CachePath, "ls-tree", "-r", "-z", "--name-only", repo.HeadSHA)
	l.RUnlock()
	if err != nil {
		return "", fmt.Errorf("list repository context: %w", err)
	}
	available := map[string]bool{}
	for _, raw := range bytes.Split(tree.Stdout, []byte{0}) {
		name := string(raw)
		if name != "" && ValidatePath(name) == nil {
			available[name] = true
		}
	}

	type candidate struct {
		path     string
		revision domain.Revision
		priority int
	}
	selected := map[string]candidate{}
	add := func(name string, revision domain.Revision, priority int) {
		if ValidatePath(name) != nil {
			return
		}
		key := string(revision) + ":" + name
		if current, ok := selected[key]; !ok || priority < current.priority {
			selected[key] = candidate{name, revision, priority}
		}
	}
	for _, file := range changed {
		revision := domain.RevisionHead
		name := file.Path
		if file.Status == domain.FileDeleted {
			revision = domain.RevisionBase
			if file.PreviousPath != "" {
				name = file.PreviousPath
			}
		}
		add(name, revision, 0)
		dir, stem := path.Dir(file.Path), fileStem(file.Path)
		for name := range available {
			base := strings.ToLower(path.Base(name))
			if base == "agents.md" && (path.Dir(name) == "." || path.Dir(name) == dir) {
				add(name, domain.RevisionHead, 1)
			}
			if isTestPath(name) && (path.Dir(name) == dir || strings.Contains(strings.ToLower(path.Base(name)), stem)) {
				add(name, domain.RevisionHead, 2)
			}
		}
	}
	for _, name := range []string{"AGENTS.md", "README.md"} {
		if available[name] {
			add(name, domain.RevisionHead, 1)
		}
	}

	candidates := make([]candidate, 0, len(selected))
	for _, item := range selected {
		candidates = append(candidates, item)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].priority != candidates[j].priority {
			return candidates[i].priority < candidates[j].priority
		}
		return candidates[i].path < candidates[j].path
	})

	var out strings.Builder
	for _, item := range candidates {
		content, readErr := m.ReadFile(ctx, repo, item.revision, item.path)
		if readErr != nil || content.IsBinary {
			continue
		}
		body := content.Content
		if len(body) > maxContextFileBytes {
			body = body[:maxContextFileBytes] + "\n[truncated by ReviewArc]\n"
		}
		section := fmt.Sprintf("\n--- %s @ %s ---\n%s", item.path, item.revision, body)
		if out.Len()+len(section) > maxBytes {
			break
		}
		out.WriteString(section)
	}
	return out.String(), nil
}

func fileStem(name string) string {
	base := strings.ToLower(path.Base(name))
	ext := path.Ext(base)
	return strings.TrimSuffix(base, ext)
}

func isTestPath(name string) bool {
	lower := strings.ToLower(name)
	base := path.Base(lower)
	return strings.Contains(lower, "/test/") || strings.Contains(lower, "/tests/") || strings.Contains(base, "_test.") || strings.Contains(base, ".test.") || strings.Contains(base, ".spec.")
}
