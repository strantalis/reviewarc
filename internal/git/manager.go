// Package git manages ReviewArc-owned bare repositories and object-only reads.
package git

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"reviewarc/internal/domain"
	processx "reviewarc/internal/process"
)

const (
	defaultTimeout          = 5 * time.Minute
	maxInteractiveFileBytes = 256 << 10
	maxInteractiveFileLines = 10_000
)

var (
	shaPattern      = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)
	ErrFileTooLarge = errors.New("file is too large to display safely")
)

type ProgressPhase string

const (
	ProgressInitializing ProgressPhase = "initializing"
	ProgressFetchingBase ProgressPhase = "fetchingBase"
	ProgressFetchingHead ProgressPhase = "fetchingHead"
	ProgressResolving    ProgressPhase = "resolving"
	ProgressReady        ProgressPhase = "ready"
)

type Progress struct {
	Phase   ProgressPhase `json:"phase"`
	Message string        `json:"message"`
}
type ProgressSink func(Progress)

type ManagedRepository struct {
	ID           string               `json:"id"`
	Repository   domain.RepositoryRef `json:"repository"`
	PullRequest  int                  `json:"pullRequest"`
	CachePath    string               `json:"-"`
	BaseSHA      string               `json:"baseSha"`
	HeadSHA      string               `json:"headSha"`
	MergeBaseSHA string               `json:"mergeBaseSha"`
}

type Options struct {
	RemoteURL func(domain.RepositoryRef) string
	Timeout   time.Duration
}

type Manager struct {
	repositories, worktrees string
	runner                  processx.Runner
	remoteURL               func(domain.RepositoryRef) string
	timeout                 time.Duration
	mu                      sync.Mutex
	locks                   map[string]*sync.RWMutex
	activeSnapshots         map[string]bool
}

func NewManager(repositories, worktrees string, runner processx.Runner, options Options) *Manager {
	remote := options.RemoteURL
	if remote == nil {
		remote = func(r domain.RepositoryRef) string { return "https://github.com/" + r.Owner + "/" + r.Name + ".git" }
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	return &Manager{repositories: repositories, worktrees: worktrees, runner: runner, remoteURL: remote, timeout: timeout, locks: map[string]*sync.RWMutex{}, activeSnapshots: map[string]bool{}}
}

func (m *Manager) lock(key string) *sync.RWMutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.locks[key] == nil {
		m.locks[key] = &sync.RWMutex{}
	}
	return m.locks[key]
}
func emit(s ProgressSink, phase ProgressPhase, message string) {
	if s != nil {
		s(Progress{Phase: phase, Message: message})
	}
}

func (m *Manager) PreparePR(ctx context.Context, pr domain.PullRequestRef, spec domain.RevisionSpec, progress ProgressSink) (ManagedRepository, error) {
	if err := validateRepository(pr.Repository); err != nil {
		return ManagedRepository{}, err
	}
	if pr.Number <= 0 || !shaPattern.MatchString(spec.BaseSHA) || !shaPattern.MatchString(spec.HeadSHA) || !validRef(spec.BaseRef) || !validRef(spec.HeadRef) {
		return ManagedRepository{}, errors.New("invalid pull request revisions")
	}
	base, head := strings.ToLower(spec.BaseSHA), strings.ToLower(spec.HeadSHA)
	key := strings.ToLower(pr.Repository.Owner + "/" + pr.Repository.Name)
	l := m.lock(key)
	l.Lock()
	defer l.Unlock()
	cache := filepath.Join(m.repositories, "github.com", strings.ToLower(pr.Repository.Owner), strings.ToLower(pr.Repository.Name)+".git")
	if err := m.ensureCache(ctx, cache, pr.Repository, progress); err != nil {
		return ManagedRepository{}, err
	}
	emit(progress, ProgressFetchingBase, "Fetching base and pull request revisions")
	refRoot := "refs/reviewarc/fetch/pr-" + strconv.Itoa(pr.Number)
	_, err := m.git(ctx, "--git-dir="+cache, "fetch", "--force", "--no-tags", "origin", "+refs/heads/"+spec.BaseRef+":"+refRoot+"/base", "+refs/pull/"+strconv.Itoa(pr.Number)+"/head:"+refRoot+"/head")
	if err != nil || m.hasCommit(ctx, cache, head) != nil {
		if _, baseErr := m.git(ctx, "--git-dir="+cache, "fetch", "--force", "--no-tags", "origin", "+refs/heads/"+spec.BaseRef+":"+refRoot+"/base"); baseErr != nil {
			return ManagedRepository{}, fmt.Errorf("fetch base revision: %w", baseErr)
		}
		if validateRepository(spec.HeadRepository) != nil {
			return ManagedRepository{}, fmt.Errorf("fetch pull request head: %w", err)
		}
		emit(progress, ProgressFetchingHead, "Fetching pull request fork revision")
		if _, forkErr := m.git(ctx, "--git-dir="+cache, "fetch", "--force", "--no-tags", m.remoteURL(spec.HeadRepository), "+refs/heads/"+spec.HeadRef+":"+refRoot+"/head"); forkErr != nil {
			return ManagedRepository{}, fmt.Errorf("fetch fork head: %w", forkErr)
		}
	}
	if err := m.hasCommit(ctx, cache, base); err != nil {
		return ManagedRepository{}, fmt.Errorf("base revision unavailable: %w", err)
	}
	if err := m.hasCommit(ctx, cache, head); err != nil {
		return ManagedRepository{}, fmt.Errorf("head revision unavailable: %w", err)
	}
	emit(progress, ProgressResolving, "Resolving pull request merge base")
	mergeResult, err := m.git(ctx, "--git-dir="+cache, "merge-base", base, head)
	if err != nil {
		return ManagedRepository{}, fmt.Errorf("resolve merge base: %w", err)
	}
	merge := strings.TrimSpace(string(mergeResult.Stdout))
	if !shaPattern.MatchString(merge) {
		return ManagedRepository{}, errors.New("git returned an invalid merge base")
	}
	stdin := []byte("start\nupdate refs/reviewarc/pr/" + strconv.Itoa(pr.Number) + "/base " + base + "\nupdate refs/reviewarc/pr/" + strconv.Itoa(pr.Number) + "/head " + head + "\nupdate refs/reviewarc/pr/" + strconv.Itoa(pr.Number) + "/merge-base " + merge + "\nprepare\ncommit\n")
	if _, err := m.run(ctx, processx.Command{Tool: processx.Git, Args: []string{"--git-dir=" + cache, "update-ref", "--stdin"}, Stdin: stdin, Timeout: m.timeout}); err != nil {
		return ManagedRepository{}, fmt.Errorf("pin pull request revisions: %w", err)
	}
	emit(progress, ProgressReady, "Repository cache ready")
	return ManagedRepository{ID: key, Repository: pr.Repository, PullRequest: pr.Number, CachePath: cache, BaseSHA: base, HeadSHA: head, MergeBaseSHA: merge}, nil
}

func (m *Manager) ChangedFiles(ctx context.Context, repo ManagedRepository) ([]domain.ChangedFile, error) {
	l := m.lock(repo.ID)
	l.RLock()
	defer l.RUnlock()
	statusResult, err := m.git(ctx, "--git-dir="+repo.CachePath, "diff", "--name-status", "-z", "--no-ext-diff", "--no-textconv", "--find-renames=50%", repo.MergeBaseSHA, repo.HeadSHA, "--")
	if err != nil {
		return nil, fmt.Errorf("list changed files: %w", err)
	}
	files, err := parseNameStatus(statusResult.Stdout)
	if err != nil {
		return nil, err
	}
	statsResult, err := m.git(ctx, "--git-dir="+repo.CachePath, "diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "--find-renames=50%", repo.MergeBaseSHA, repo.HeadSHA, "--")
	if err != nil {
		return nil, fmt.Errorf("read diff statistics: %w", err)
	}
	stats, err := parseNumstat(statsResult.Stdout)
	if err != nil {
		return nil, err
	}
	for i := range files {
		if s, ok := stats[files[i].Path]; ok {
			files[i].Additions = s.additions
			files[i].Deletions = s.deletions
			files[i].IsBinary = s.binary
			if s.binary {
				files[i].Status = domain.FileBinary
			}
		}
	}
	return files, nil
}

func (m *Manager) DiffFile(ctx context.Context, repo ManagedRepository, file domain.ChangedFile, contextLines int) (domain.DiffFile, error) {
	if err := ValidatePath(file.Path); err != nil {
		return domain.DiffFile{}, err
	}
	if file.PreviousPath != "" {
		if err := ValidatePath(file.PreviousPath); err != nil {
			return domain.DiffFile{}, err
		}
	}
	if contextLines < 0 {
		contextLines = 0
	}
	if contextLines > 100 {
		contextLines = 100
	}
	args := []string{"--git-dir=" + repo.CachePath, "-c", "core.quotePath=true", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames=50%", "--diff-algorithm=histogram", "--unified=" + strconv.Itoa(contextLines), repo.MergeBaseSHA, repo.HeadSHA, "--"}
	if file.PreviousPath != "" {
		args = append(args, file.PreviousPath)
	}
	args = append(args, file.Path)
	l := m.lock(repo.ID)
	l.RLock()
	defer l.RUnlock()
	result, err := m.git(ctx, args...)
	if err != nil {
		return domain.DiffFile{}, fmt.Errorf("load file diff: %w", err)
	}
	return ParsePatch(file, result.Stdout)
}

func (m *Manager) ensureCache(ctx context.Context, cache string, ref domain.RepositoryRef, progress ProgressSink) error {
	if st, err := os.Stat(cache); err == nil && st.IsDir() {
		bare, bareErr := m.git(ctx, "--git-dir="+cache, "rev-parse", "--is-bare-repository")
		if bareErr != nil || strings.TrimSpace(string(bare.Stdout)) != "true" {
			return errors.New("managed cache is not a bare Git repository")
		}
		// Read the literal configured URL. `remote get-url` applies the user's
		// url.*.insteadOf rules and can make a safe GitHub origin appear different.
		origin, originErr := m.git(ctx, "--git-dir="+cache, "config", "--get", "remote.origin.url")
		if originErr != nil || strings.TrimSpace(string(origin.Stdout)) != m.remoteURL(ref) {
			return errors.New("managed cache origin does not match repository")
		}
		return nil
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	emit(progress, ProgressInitializing, "Creating managed repository cache")
	if err := os.MkdirAll(filepath.Dir(cache), 0o700); err != nil {
		return err
	}
	tmp := cache + ".tmp-" + randomID()
	_ = os.RemoveAll(tmp)
	if _, err := m.git(ctx, "init", "--bare", tmp); err != nil {
		return fmt.Errorf("initialize bare cache: %w", err)
	}
	if _, err := m.git(ctx, "--git-dir="+tmp, "remote", "add", "origin", m.remoteURL(ref)); err != nil {
		_ = os.RemoveAll(tmp)
		return fmt.Errorf("configure cache origin: %w", err)
	}
	if err := os.Rename(tmp, cache); err != nil {
		_ = os.RemoveAll(tmp)
		if _, statErr := os.Stat(cache); statErr == nil {
			return nil
		}
		return err
	}
	return nil
}

func (m *Manager) hasCommit(ctx context.Context, cache, sha string) error {
	_, err := m.git(ctx, "--git-dir="+cache, "cat-file", "-e", sha+"^{commit}")
	return err
}
func (m *Manager) git(ctx context.Context, args ...string) (processx.Result, error) {
	return m.run(ctx, processx.Command{Tool: processx.Git, Args: args, Timeout: m.timeout, MaxOutput: 32 << 20})
}
func (m *Manager) run(ctx context.Context, c processx.Command) (processx.Result, error) {
	return m.runner.Run(ctx, c)
}

func (m *Manager) ReadFile(ctx context.Context, repo ManagedRepository, revision domain.Revision, name string) (domain.FileContent, error) {
	if err := ValidatePath(name); err != nil {
		return domain.FileContent{}, err
	}
	sha, err := revisionSHA(repo, revision)
	if err != nil {
		return domain.FileContent{}, err
	}
	l := m.lock(repo.ID)
	l.RLock()
	defer l.RUnlock()
	entry, err := m.git(ctx, "--git-dir="+repo.CachePath, "ls-tree", "-z", sha, "--", name)
	if err != nil {
		return domain.FileContent{}, err
	}
	raw := strings.TrimSuffix(string(entry.Stdout), "\x00")
	parts := strings.SplitN(raw, "\t", 2)
	fields := strings.Fields(parts[0])
	if len(parts) != 2 || parts[1] != name || len(fields) != 3 || fields[1] != "blob" || !shaPattern.MatchString(fields[2]) {
		return domain.FileContent{}, errors.New("path is not a file at the selected revision")
	}
	sizeResult, err := m.run(ctx, processx.Command{Tool: processx.Git, Args: []string{"--git-dir=" + repo.CachePath, "cat-file", "-s", fields[2]}, Timeout: m.timeout, MaxOutput: 1024})
	if err != nil {
		return domain.FileContent{}, fmt.Errorf("measure repository file: %w", err)
	}
	size, parseErr := strconv.ParseInt(strings.TrimSpace(string(sizeResult.Stdout)), 10, 64)
	if parseErr != nil || size < 0 {
		return domain.FileContent{}, errors.New("git returned an invalid repository file size")
	}
	if size > maxInteractiveFileBytes {
		return domain.FileContent{}, fileDisplayLimitError(name)
	}
	blob, err := m.run(ctx, processx.Command{Tool: processx.Git, Args: []string{"--git-dir=" + repo.CachePath, "cat-file", "blob", fields[2]}, Timeout: m.timeout, MaxOutput: maxInteractiveFileBytes})
	if err != nil {
		return domain.FileContent{}, fmt.Errorf("read repository file: %w", err)
	}
	lines := lineCount(blob.Stdout)
	if lines > maxInteractiveFileLines {
		return domain.FileContent{}, fileDisplayLimitError(name)
	}
	binary := bytes.IndexByte(blob.Stdout, 0) >= 0 || !utf8.Valid(blob.Stdout)
	content := ""
	if !binary {
		content = string(blob.Stdout)
	}
	return domain.FileContent{Path: name, Revision: revision, SHA: sha, Content: content, IsBinary: binary, LineCount: lines}, nil
}

func fileDisplayLimitError(name string) error {
	return fmt.Errorf("%w: %s exceeds the %d KiB or %d-line display limit", ErrFileTooLarge, name, maxInteractiveFileBytes>>10, maxInteractiveFileLines)
}

func (m *Manager) ValidateEvidence(ctx context.Context, repo ManagedRepository, evidence domain.EvidenceReference) domain.EvidenceReference {
	if ValidatePath(evidence.Path) != nil {
		evidence.ValidationStatus = domain.ValidationInvalid
		evidence.ValidationMessage = "unsafe repository path"
		return evidence
	}
	content, err := m.ReadFile(ctx, repo, evidence.Revision, evidence.Path)
	if err != nil {
		if errors.Is(err, ErrFileTooLarge) {
			evidence.ValidationStatus = domain.ValidationUnverified
			evidence.ValidationMessage = "file is too large for interactive evidence display"
			return evidence
		}
		evidence.ValidationStatus = domain.ValidationInvalid
		evidence.ValidationMessage = "path does not exist at the selected revision"
		return evidence
	}
	if content.IsBinary {
		evidence.ValidationStatus = domain.ValidationUnverified
		evidence.ValidationMessage = "binary content cannot support line evidence"
		return evidence
	}
	if evidence.StartLine < 1 || evidence.EndLine < evidence.StartLine || evidence.EndLine > content.LineCount {
		evidence.ValidationStatus = domain.ValidationInvalid
		evidence.ValidationMessage = "line range is outside the file"
		return evidence
	}
	evidence.ValidationStatus = domain.ValidationValid
	evidence.ValidationMessage = ""
	return evidence
}

func revisionSHA(repo ManagedRepository, revision domain.Revision) (string, error) {
	switch revision {
	case domain.RevisionBase:
		return repo.BaseSHA, nil
	case domain.RevisionHead:
		return repo.HeadSHA, nil
	default:
		return "", errors.New("invalid revision")
	}
}
func lineCount(b []byte) int {
	if len(b) == 0 {
		return 0
	}
	n := strings.Count(string(b), "\n")
	if b[len(b)-1] != '\n' {
		n++
	}
	return n
}
func randomID() string { var b [8]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func validRef(s string) bool {
	if s == "" || strings.HasPrefix(s, "-") || strings.HasPrefix(s, "/") || strings.HasSuffix(s, "/") || strings.HasSuffix(s, ".") || strings.Contains(s, "..") || strings.Contains(s, "@{") {
		return false
	}
	for _, r := range s {
		if r < 0x20 || r == 0x7f || strings.ContainsRune(" ~^:?*[\\", r) {
			return false
		}
	}
	for _, p := range strings.Split(s, "/") {
		if p == "" || p == "." || p == ".." || strings.HasSuffix(p, ".lock") {
			return false
		}
	}
	return true
}
