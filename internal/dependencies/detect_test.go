package dependencies

import (
	"context"
	"errors"
	"testing"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type fakeRunner struct{ calls []proc.Command }

func (f *fakeRunner) Run(_ context.Context, c proc.Command) (proc.Result, error) {
	f.calls = append(f.calls, c)
	if c.Tool == proc.Codex {
		return proc.Result{}, errors.New("missing")
	}
	return proc.Result{Stdout: []byte(string(c.Tool) + " version 1\nsecond")}, nil
}

func TestDetectReturnsAllDependencies(t *testing.T) {
	f := &fakeRunner{}
	got := New(f).Detect(context.Background())
	if len(got) != 3 || len(f.calls) != 3 {
		t.Fatalf("got %d statuses and %d calls", len(got), len(f.calls))
	}
	if got[0].Version != "git version 1" || got[2].State != domain.DependencyMissing {
		t.Fatalf("unexpected statuses: %#v", got)
	}
}
