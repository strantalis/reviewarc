// Package cleanup coordinates application-owned cleanup work. Callers invoke
// it at startup and from their daily lifecycle hook; it intentionally owns no
// background goroutine.
package cleanup

import (
	"context"
	"errors"
	"sync"
	"time"
)

const DefaultInterval = 24 * time.Hour

// Job is a cleanup operation such as purging expired archived reviews and
// scavenging abandoned filesystem artifacts.
type Job interface {
	Cleanup(context.Context) error
}

type JobFunc func(context.Context) error

func (f JobFunc) Cleanup(ctx context.Context) error { return f(ctx) }

type SchedulerOptions struct {
	Interval time.Duration
	Now      func() time.Time
}

// Scheduler records successful runs in memory. It is deliberately lightweight:
// persistence belongs to the owning store, while callers control when startup
// and daily lifecycle hooks invoke it.
type Scheduler struct {
	job      Job
	interval time.Duration
	now      func() time.Time

	mu      sync.Mutex
	running bool
	lastRun time.Time
}

func NewScheduler(job Job, options SchedulerOptions) (*Scheduler, error) {
	if job == nil {
		return nil, errors.New("cleanup job is required")
	}
	if options.Interval < 0 {
		return nil, errors.New("cleanup interval cannot be negative")
	}
	if options.Interval == 0 {
		options.Interval = DefaultInterval
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &Scheduler{job: job, interval: options.Interval, now: options.Now}, nil
}

// RunOnStartup always attempts cleanup. A failed run is not recorded, so the
// next lifecycle call can retry it.
func (s *Scheduler) RunOnStartup(ctx context.Context) (bool, error) {
	return s.run(ctx, true)
}

// RunIfDue runs cleanup once the configured interval has elapsed since the
// last successful run. Concurrent and not-yet-due calls are skipped.
func (s *Scheduler) RunIfDue(ctx context.Context) (bool, error) {
	return s.run(ctx, false)
}

func (s *Scheduler) run(ctx context.Context, force bool) (bool, error) {
	s.mu.Lock()
	if s.running || (!force && !s.lastRun.IsZero() && s.now().Sub(s.lastRun) < s.interval) {
		s.mu.Unlock()
		return false, nil
	}
	s.running = true
	s.mu.Unlock()

	err := s.job.Cleanup(ctx)
	now := s.now()
	s.mu.Lock()
	s.running = false
	if err == nil {
		s.lastRun = now
	}
	s.mu.Unlock()
	return true, err
}
