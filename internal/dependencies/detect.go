package dependencies

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type Detector struct{ runner proc.Runner }

func New(runner proc.Runner) *Detector { return &Detector{runner: runner} }

func (d *Detector) Detect(ctx context.Context) []domain.DependencyStatus {
	d.RefreshPaths()
	return d.DetectCurrent(ctx)
}

func (d *Detector) RefreshPaths() {
	if refresher, ok := d.runner.(proc.PathRefresher); ok {
		refresher.RefreshPaths()
	}
}

// DetectCurrent checks the executable paths most recently resolved by
// RefreshPaths. It lets bootstrap refresh once, then overlap these version
// checks with other environment reads that use the same runner.
func (d *Detector) DetectCurrent(ctx context.Context) []domain.DependencyStatus {
	checks := []struct {
		name domain.DependencyName
		tool proc.Tool
		args []string
	}{
		{domain.DependencyGit, proc.Git, []string{"--version"}},
		{domain.DependencyGH, proc.GH, []string{"--version"}},
		{domain.DependencyCodex, proc.Codex, []string{"--version"}},
	}
	result := make([]domain.DependencyStatus, len(checks))
	var wg sync.WaitGroup
	for i, check := range checks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status := domain.DependencyStatus{Name: check.name}
			if resolver, ok := d.runner.(proc.PathResolver); ok {
				path, err := resolver.ResolvedPath(check.tool)
				if err != nil {
					status.State = domain.DependencyMissing
					status.Message = "Not installed in a supported location"
					result[i] = status
					return
				}
				status.Path = path
			}
			r, err := d.runner.Run(ctx, proc.Command{Tool: check.tool, Args: check.args, Timeout: 5 * time.Second, MaxOutput: 64 << 10})
			if err != nil {
				if errors.Is(err, proc.ErrToolNotFound) {
					status.State = domain.DependencyMissing
					status.Message = "Not installed in a supported location"
				} else {
					status.State = domain.DependencyBroken
					status.Message = "Found but could not run"
					if detail := firstLine(string(r.Stderr)); detail != "" {
						status.Message += ": " + detail
					}
				}
			} else {
				status.State = domain.DependencyAvailable
				status.Version = firstLine(string(r.Stdout))
			}
			result[i] = status
		}()
	}
	wg.Wait()
	return result
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if i := strings.IndexByte(value, '\n'); i >= 0 {
		return value[:i]
	}
	return value
}
