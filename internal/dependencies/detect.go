package dependencies

import (
	"context"
	"strings"
	"time"

	"reviewarc/internal/domain"
	proc "reviewarc/internal/process"
)

type Detector struct{ runner proc.Runner }

func New(runner proc.Runner) *Detector { return &Detector{runner: runner} }

func (d *Detector) Detect(ctx context.Context) []domain.DependencyStatus {
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
		r, err := d.runner.Run(ctx, proc.Command{Tool: check.tool, Args: check.args, Timeout: 5 * time.Second, MaxOutput: 64 << 10})
		status := domain.DependencyStatus{Name: check.name}
		if err != nil {
			status.State = domain.DependencyMissing
			status.Message = "Not available on PATH"
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
