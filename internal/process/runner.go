// Package process safely runs ReviewArc's fixed external tool set.
package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Tool string

const (
	Git    Tool = "git"
	GH     Tool = "gh"
	Codex  Tool = "codex"
	Claude Tool = "claude"
)

const defaultMaxOutput = 16 << 20

var (
	ErrToolNotFound        = errors.New("tool executable not found")
	ErrOutputLimitExceeded = errors.New("tool output exceeded limit")
)

type Command struct {
	Tool         Tool
	Args         []string
	Dir          string
	Stdin        []byte
	Timeout      time.Duration
	MaxOutput    int
	OnStdoutLine func([]byte)
	OnStderrLine func([]byte)
}

type Result struct {
	Stdout, Stderr []byte
	ExitCode       int
	Duration       time.Duration
}

type Runner interface {
	Run(context.Context, Command) (Result, error)
}

// PathResolver exposes only the resolved path for an allowlisted tool. It does
// not accept arbitrary executable names.
type PathResolver interface {
	ResolvedPath(Tool) (string, error)
}

type PathRefresher interface {
	RefreshPaths()
}

type ExecRunner struct {
	mu     sync.RWMutex
	paths  map[Tool]string
	env    map[Tool][]string
	source []string
	home   string
}

func NewExecRunner() *ExecRunner {
	source := os.Environ()
	runner := &ExecRunner{source: append([]string(nil), source...), home: userHomeDir(source)}
	runner.RefreshPaths()
	return runner
}

func (r *ExecRunner) RefreshPaths() {
	search := executableSearchDirs(r.source, r.home)
	paths := make(map[Tool]string, 4)
	for _, tool := range []Tool{Git, GH, Codex, Claude} {
		paths[tool] = resolveExecutable(tool, search)
	}
	pathValue := strings.Join(search, string(os.PathListSeparator))
	environments := make(map[Tool][]string, len(paths))
	for tool, path := range paths {
		environment := minimalEnvironment(r.source, tool, pathValue)
		if path != "" {
			environment = prependPath(environment, filepath.Dir(path))
		}
		environments[tool] = environment
	}
	r.mu.Lock()
	r.paths = paths
	r.env = environments
	r.mu.Unlock()
}

func (r *ExecRunner) SetPath(tool Tool, path string) error {
	if !validTool(tool) || path == "" || strings.ContainsRune(path, 0) || !filepath.IsAbs(path) || !isExecutable(path) {
		return errors.New("invalid tool path")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.paths[tool] = path
	r.env[tool] = prependPath(r.env[tool], filepath.Dir(path))
	return nil
}

func (r *ExecRunner) ResolvedPath(tool Tool) (string, error) {
	if !validTool(tool) {
		return "", fmt.Errorf("tool %q is not allowed", tool)
	}
	r.mu.RLock()
	path := r.paths[tool]
	r.mu.RUnlock()
	if path == "" {
		return "", fmt.Errorf("%w: %s", ErrToolNotFound, tool)
	}
	return path, nil
}

func (r *ExecRunner) Run(ctx context.Context, c Command) (Result, error) {
	started := time.Now()
	if !validTool(c.Tool) {
		return Result{}, fmt.Errorf("tool %q is not allowed", c.Tool)
	}
	for _, arg := range c.Args {
		if strings.ContainsRune(arg, 0) {
			return Result{}, errors.New("command argument contains NUL")
		}
	}
	if strings.ContainsRune(c.Dir, 0) {
		return Result{}, errors.New("working directory contains NUL")
	}
	r.mu.RLock()
	path := r.paths[c.Tool]
	env := append([]string(nil), r.env[c.Tool]...)
	r.mu.RUnlock()
	if path == "" {
		return Result{ExitCode: -1, Duration: time.Since(started)}, fmt.Errorf("%w: %s", ErrToolNotFound, c.Tool)
	}
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	limit := c.MaxOutput
	if limit <= 0 {
		limit = defaultMaxOutput
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var stdout, stderr limitedBuffer
	stdout.limit, stderr.limit = limit, limit
	stdout.onLimit, stderr.onLimit = cancel, cancel
	cmd := exec.CommandContext(runCtx, path, c.Args...)
	configureCancellation(cmd)
	cmd.Dir, cmd.Env, cmd.Stdin = c.Dir, env, bytes.NewReader(c.Stdin)
	cmd.Stdout, cmd.Stderr = newLineWriter(&stdout, c.OnStdoutLine), newLineWriter(&stderr, c.OnStderrLine)
	err := cmd.Run()
	result := Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes(), ExitCode: exitCode(err), Duration: time.Since(started)}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return result, ctxErr
	}
	if stdout.truncated || stderr.truncated {
		stream := "stdout"
		if stdout.truncated && stderr.truncated {
			stream = "stdout and stderr"
		} else if stderr.truncated {
			stream = "stderr"
		}
		return result, fmt.Errorf("%s %s exceeded the %d-byte output limit: %w", c.Tool, stream, limit, ErrOutputLimitExceeded)
	}
	if err != nil {
		return result, fmt.Errorf("%s exited with code %d: %w", c.Tool, result.ExitCode, err)
	}
	return result, nil
}

func validTool(t Tool) bool { return t == Git || t == GH || t == Codex || t == Claude }
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

type limitedBuffer struct {
	bytes.Buffer
	limit     int
	truncated bool
	onLimit   func()
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n, _ := b.write(p)
	return n, nil
}

func (b *limitedBuffer) write(p []byte) (int, int) {
	n := len(p)
	remaining := b.limit - b.Len()
	if len(p) > remaining {
		if !b.truncated {
			b.truncated = true
			if b.onLimit != nil {
				b.onLimit()
			}
		}
	}
	retained := 0
	if remaining > 0 {
		if remaining < len(p) {
			p = p[:remaining]
		}
		retained, _ = b.Buffer.Write(p)
	}
	return n, retained
}

type lineWriter struct {
	destination *limitedBuffer
	callback    func([]byte)
	pending     []byte
}

func newLineWriter(destination *limitedBuffer, callback func([]byte)) *lineWriter {
	return &lineWriter{destination: destination, callback: callback}
}

func (w *lineWriter) Write(p []byte) (int, error) {
	n, retained := w.destination.write(p)
	if w.callback == nil {
		return n, nil
	}
	w.pending = append(w.pending, p[:retained]...)
	for {
		index := bytes.IndexByte(w.pending, '\n')
		if index < 0 {
			break
		}
		line := append([]byte(nil), w.pending[:index]...)
		w.pending = w.pending[index+1:]
		w.callback(line)
	}
	return n, nil
}

func minimalEnvironment(source []string, tool Tool, pathValue string) []string {
	allowed := map[string]bool{"PATH": true, "HOME": true, "USER": true, "TMPDIR": true, "LANG": true, "LC_ALL": true, "SSL_CERT_FILE": true, "SSL_CERT_DIR": true}
	if tool == Git {
		allowed["SSH_AUTH_SOCK"] = true
	}
	if tool == GH {
		// ReviewArc deliberately relies on gh's own credential store. Forwarding
		// launch-time token variables can shadow a newer keyring login for the
		// entire lifetime of the desktop process.
		allowed["GH_HOST"], allowed["GH_CONFIG_DIR"] = true, true
	}
	if tool == Codex {
		allowed["CODEX_HOME"], allowed["OPENAI_API_KEY"] = true, true
	}
	if tool == Claude {
		allowed["ANTHROPIC_API_KEY"], allowed["CLAUDE_CONFIG_DIR"] = true, true
	}
	out := make([]string, 0, len(allowed))
	for _, entry := range source {
		key, value, ok := strings.Cut(entry, "=")
		if key == "SSH_AUTH_SOCK" && !validSocket(value) {
			continue
		}
		if ok && allowed[key] && key != "PATH" {
			out = append(out, entry)
		}
	}
	out = append(out, "PATH="+pathValue)
	return out
}

func validSocket(path string) bool {
	if !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode()&os.ModeSocket != 0
}

func userHomeDir(source []string) string {
	for _, entry := range source {
		if value, ok := strings.CutPrefix(entry, "HOME="); ok && filepath.IsAbs(value) {
			return filepath.Clean(value)
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

func executableSearchDirs(source []string, home string) []string {
	var candidates []string
	for _, entry := range source {
		value, ok := strings.CutPrefix(entry, "PATH=")
		if !ok {
			continue
		}
		for _, dir := range filepath.SplitList(value) {
			if filepath.IsAbs(dir) && isDirectory(dir) {
				candidates = append(candidates, dir)
			}
		}
		break
	}
	if filepath.IsAbs(home) {
		fnmRoots := []string{
			filepath.Join(home, "Library", "Application Support", "fnm"),
			filepath.Join(home, ".local", "share", "fnm"),
			filepath.Join(home, ".fnm"),
		}
		if root := absoluteEnvironmentPath(source, "FNM_DIR"); root != "" {
			fnmRoots = append([]string{root}, fnmRoots...)
		}
		if dataHome := absoluteEnvironmentPath(source, "XDG_DATA_HOME"); dataHome != "" {
			fnmRoots = append([]string{filepath.Join(dataHome, "fnm")}, fnmRoots...)
		}
		for _, root := range fnmRoots {
			candidates = append(candidates, filepath.Join(root, "aliases", "default", "bin"))
		}
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".nix-profile", "bin"),
			filepath.Join(home, ".asdf", "shims"),
			filepath.Join(home, ".local", "share", "mise", "shims"),
			filepath.Join(home, ".volta", "bin"),
			filepath.Join(home, ".bun", "bin"),
			filepath.Join(home, ".npm-global", "bin"),
			filepath.Join(home, ".local", "share", "pnpm"),
			filepath.Join(home, "Library", "pnpm"),
		)
		patterns := []string{
			filepath.Join(home, ".config", "nvm", "versions", "node", "*", "bin"),
			filepath.Join(home, ".nvm", "versions", "node", "*", "bin"),
		}
		for _, root := range fnmRoots {
			patterns = append(patterns, filepath.Join(root, "node-versions", "*", "installation", "bin"))
		}
		for _, pattern := range patterns {
			matches, _ := filepath.Glob(pattern)
			sort.SliceStable(matches, func(i, j int) bool { return compareVersionPath(matches[i], matches[j]) > 0 })
			candidates = append(candidates, matches...)
		}
	}
	// Prefer the user's version-manager selection over machine-wide fallback
	// installations when the desktop launch environment omitted shell setup.
	candidates = append(candidates, "/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin")
	// These directories provide interpreters and system helpers used by CLI
	// script shebangs (for example, #!/usr/bin/env node).
	candidates = append(candidates, "/usr/bin", "/bin", "/usr/sbin", "/sbin")
	seen := make(map[string]bool, len(candidates))
	dirs := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		if !filepath.IsAbs(candidate) || seen[candidate] {
			continue
		}
		seen[candidate] = true
		dirs = append(dirs, candidate)
	}
	return dirs
}

func absoluteEnvironmentPath(source []string, key string) string {
	prefix := key + "="
	for _, entry := range source {
		if value, ok := strings.CutPrefix(entry, prefix); ok && filepath.IsAbs(value) {
			return filepath.Clean(value)
		}
	}
	return ""
}

func compareVersionPath(left, right string) int {
	a, b := versionParts(left), versionParts(right)
	for i := 0; i < len(a) || i < len(b); i++ {
		var av, bv int
		if i < len(a) {
			av = a[i]
		}
		if i < len(b) {
			bv = b[i]
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}
	return strings.Compare(left, right)
}

func versionParts(path string) []int {
	parts := strings.FieldsFunc(filepath.ToSlash(path), func(r rune) bool { return r == '/' })
	for i := len(parts) - 1; i >= 0; i-- {
		value := strings.TrimPrefix(parts[i], "v")
		if value == parts[i] || value == "" || value[0] < '0' || value[0] > '9' {
			continue
		}
		var numbers []int
		for _, component := range strings.Split(value, ".") {
			number, err := strconv.Atoi(component)
			if err != nil {
				break
			}
			numbers = append(numbers, number)
		}
		if len(numbers) > 0 {
			return numbers
		}
	}
	return nil
}

func resolveExecutable(tool Tool, search []string) string {
	if !validTool(tool) {
		return ""
	}
	for _, dir := range search {
		candidate := filepath.Join(dir, string(tool))
		if isExecutable(candidate) {
			return candidate
		}
	}
	return ""
}

func isDirectory(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode().Perm()&0o111 != 0
}

func prependPath(env []string, dir string) []string {
	for i, entry := range env {
		if value, ok := strings.CutPrefix(entry, "PATH="); ok {
			for _, existing := range filepath.SplitList(value) {
				if existing == dir {
					return env
				}
			}
			env[i] = "PATH=" + dir + string(os.PathListSeparator) + value
			return env
		}
	}
	return append(env, "PATH="+dir)
}
