package dependencies

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type fakeRunner struct {
	mu    sync.Mutex
	calls []proc.Command
}

func (f *fakeRunner) ResolvedPath(tool proc.Tool) (string, error) {
	if tool == proc.Codex {
		return "", proc.ErrToolNotFound
	}
	return "/fixture/bin/" + string(tool), nil
}

func (f *fakeRunner) Run(_ context.Context, c proc.Command) (proc.Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, c)
	f.mu.Unlock()
	if c.Tool == proc.Codex {
		return proc.Result{}, proc.ErrToolNotFound
	}
	return proc.Result{Stdout: []byte(string(c.Tool) + " version 1\nsecond")}, nil
}

func TestDetectReturnsAllDependencies(t *testing.T) {
	f := &fakeRunner{}
	got := New(f).Detect(context.Background())
	f.mu.Lock()
	calls := len(f.calls)
	f.mu.Unlock()
	if len(got) != 3 || calls != 2 {
		t.Fatalf("got %d statuses and %d calls", len(got), calls)
	}
	if got[0].Version != "git version 1" || got[0].Path != "/fixture/bin/git" || got[2].State != domain.DependencyMissing {
		t.Fatalf("unexpected statuses: %#v", got)
	}
}

type concurrentRunner struct {
	started chan proc.Tool
	release chan struct{}
}

func (r *concurrentRunner) ResolvedPath(tool proc.Tool) (string, error) {
	return "/fixture/bin/" + string(tool), nil
}

func (r *concurrentRunner) Run(_ context.Context, command proc.Command) (proc.Result, error) {
	r.started <- command.Tool
	<-r.release
	return proc.Result{Stdout: []byte(string(command.Tool) + " version 1\n")}, nil
}

func TestDetectRunsIndependentVersionChecksConcurrently(t *testing.T) {
	runner := &concurrentRunner{started: make(chan proc.Tool, 3), release: make(chan struct{})}
	done := make(chan []domain.DependencyStatus, 1)
	go func() { done <- New(runner).Detect(context.Background()) }()

	seen := map[proc.Tool]bool{}
	for range 3 {
		select {
		case tool := <-runner.started:
			seen[tool] = true
		case <-time.After(time.Second):
			close(runner.release)
			t.Fatal("dependency checks did not all start before the first completed")
		}
	}
	close(runner.release)
	statuses := <-done
	if len(seen) != 3 || len(statuses) != 3 {
		t.Fatalf("started=%v statuses=%v", seen, statuses)
	}
	if statuses[0].Name != domain.DependencyGit || statuses[1].Name != domain.DependencyGH || statuses[2].Name != domain.DependencyCodex {
		t.Fatalf("dependency order changed: %#v", statuses)
	}
}

type brokenRunner struct{}

func (brokenRunner) ResolvedPath(tool proc.Tool) (string, error) {
	return "/fixture/bin/" + string(tool), nil
}

func (brokenRunner) Run(_ context.Context, c proc.Command) (proc.Result, error) {
	if c.Tool == proc.GH {
		return proc.Result{Stderr: []byte("dyld: missing library\nmore")}, errors.New("exit 1")
	}
	return proc.Result{Stdout: []byte("version 1\n")}, nil
}

func TestDetectDistinguishesFoundButBroken(t *testing.T) {
	got := New(brokenRunner{}).Detect(context.Background())
	if got[1].State != domain.DependencyBroken || got[1].Path != "/fixture/bin/gh" || got[1].Message != "Found but could not run: dyld: missing library" {
		t.Fatalf("gh status=%#v", got[1])
	}
}

type refreshingRunner struct {
	brokenRunner
	refreshes int
}

func (r *refreshingRunner) RefreshPaths() { r.refreshes++ }

func TestDetectRefreshesExecutablePathsBeforeChecking(t *testing.T) {
	runner := &refreshingRunner{}
	New(runner).Detect(context.Background())
	if runner.refreshes != 1 {
		t.Fatalf("refreshes=%d, want one path refresh", runner.refreshes)
	}
}

func TestLiveFinderLikeEnvironmentDetectsInstalledTools(t *testing.T) {
	if os.Getenv("REVIEWARC_LIVE_DEPENDENCIES") != "1" {
		t.Skip("set REVIEWARC_LIVE_DEPENDENCIES=1 under a stripped environment for packaged-app verification")
	}
	got := New(proc.NewExecRunner()).Detect(context.Background())
	if len(got) != 3 {
		t.Fatalf("statuses=%d, want git, gh, and codex", len(got))
	}
	for _, status := range got {
		t.Logf("%s: state=%s path=%s version=%s message=%s", status.Name, status.State, status.Path, status.Version, status.Message)
		if status.State != domain.DependencyAvailable || status.Path == "" || status.Version == "" {
			t.Fatalf("dependency unavailable in Finder-like environment: %#v", status)
		}
	}
}
