// Package process safely runs ReviewArc's fixed external tool set.
package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type Tool string

const (
	Git   Tool = "git"
	GH    Tool = "gh"
	Codex Tool = "codex"
)

const defaultMaxOutput = 16 << 20

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

type ExecRunner struct {
	mu    sync.RWMutex
	paths map[Tool]string
	env   map[Tool][]string
}

func NewExecRunner() *ExecRunner {
	source := os.Environ()
	return &ExecRunner{paths: map[Tool]string{Git: "git", GH: "gh", Codex: "codex"}, env: map[Tool][]string{
		Git: minimalEnvironment(source, Git), GH: minimalEnvironment(source, GH), Codex: minimalEnvironment(source, Codex),
	}}
}

func (r *ExecRunner) SetPath(tool Tool, path string) error {
	if !validTool(tool) || path == "" || strings.ContainsRune(path, 0) {
		return errors.New("invalid tool path")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.paths[tool] = path
	return nil
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
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	limit := c.MaxOutput
	if limit <= 0 {
		limit = defaultMaxOutput
	}
	var stdout, stderr limitedBuffer
	stdout.limit, stderr.limit = limit, limit
	cmd := exec.CommandContext(ctx, path, c.Args...)
	configureCancellation(cmd)
	cmd.Dir, cmd.Env, cmd.Stdin = c.Dir, env, bytes.NewReader(c.Stdin)
	cmd.Stdout, cmd.Stderr = newLineWriter(&stdout, c.OnStdoutLine), newLineWriter(&stderr, c.OnStderrLine)
	err := cmd.Run()
	result := Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes(), ExitCode: exitCode(err), Duration: time.Since(started)}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return result, ctxErr
	}
	if err != nil {
		return result, fmt.Errorf("%s exited with code %d: %w", c.Tool, result.ExitCode, err)
	}
	return result, nil
}

func validTool(t Tool) bool { return t == Git || t == GH || t == Codex }
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
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.limit - b.Len()
	if remaining > 0 {
		if remaining < len(p) {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return n, nil
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
	n, err := w.destination.Write(p)
	if w.callback == nil {
		return n, err
	}
	w.pending = append(w.pending, p...)
	for {
		index := bytes.IndexByte(w.pending, '\n')
		if index < 0 {
			break
		}
		line := append([]byte(nil), w.pending[:index]...)
		w.pending = w.pending[index+1:]
		w.callback(line)
	}
	return n, err
}

func minimalEnvironment(source []string, tool Tool) []string {
	allowed := map[string]bool{"PATH": true, "HOME": true, "USER": true, "TMPDIR": true, "LANG": true, "LC_ALL": true, "SSL_CERT_FILE": true, "SSL_CERT_DIR": true}
	if tool == GH {
		allowed["GH_HOST"], allowed["GH_CONFIG_DIR"], allowed["GH_TOKEN"], allowed["GITHUB_TOKEN"] = true, true, true, true
	}
	if tool == Codex {
		allowed["CODEX_HOME"], allowed["OPENAI_API_KEY"] = true, true
	}
	out := make([]string, 0, len(allowed))
	for _, entry := range source {
		key, _, ok := strings.Cut(entry, "=")
		if ok && allowed[key] {
			out = append(out, entry)
		}
	}
	return out
}
