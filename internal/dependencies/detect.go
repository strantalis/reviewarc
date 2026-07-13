package dependencies

import (
	"context"
	"errors"
	"strings"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type Detector struct{ runner proc.Runner }

func New(runner proc.Runner) *Detector { return &Detector{runner: runner} }

func (d *Detector) Detect(ctx context.Context) []domain.DependencyStatus {
	if refresher, ok := d.runner.(proc.PathRefresher); ok {
		refresher.RefreshPaths()
	}
	checks := []struct {
		name domain.DependencyName
		tool proc.Tool
		args []string
	}{
		{domain.DependencyGit, proc.Git, []string{"--version"}},
		{domain.DependencyGH, proc.GH, []string{"--version"}},
		{domain.DependencyCodex, proc.Codex, []string{"--version"}},
	}
	result := make([]domain.DependencyStatus, 0, len(checks))
	for _, check := range checks {
		status := domain.DependencyStatus{Name: check.name}
		if resolver, ok := d.runner.(proc.PathResolver); ok {
			path, err := resolver.ResolvedPath(check.tool)
			if err != nil {
				status.State = domain.DependencyMissing
				status.Message = "Not installed in a supported location"
				result = append(result, status)
				continue
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
		result = append(result, status)
	}
	return result
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if i := strings.IndexByte(value, '\n'); i >= 0 {
		return value[:i]
	}
	return value
}
