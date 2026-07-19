package cleanup

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestSchedulerRunsAtStartupThenOncePerInterval(t *testing.T) {
	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	runs := 0
	scheduler, err := NewScheduler(JobFunc(func(context.Context) error {
		runs++
		return nil
	}), SchedulerOptions{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if ran, err := scheduler.RunOnStartup(context.Background()); err != nil || !ran {
		t.Fatalf("startup ran=%t err=%v", ran, err)
	}
	if ran, err := scheduler.RunIfDue(context.Background()); err != nil || ran {
		t.Fatalf("immediate daily ran=%t err=%v", ran, err)
	}
	now = now.Add(DefaultInterval)
	if ran, err := scheduler.RunIfDue(context.Background()); err != nil || !ran {
		t.Fatalf("due daily ran=%t err=%v", ran, err)
	}
	if runs != 2 {
		t.Fatalf("runs=%d, want 2", runs)
	}
}

func TestSchedulerRetriesFailureAndDoesNotOverlap(t *testing.T) {
	now := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	started := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	runs := 0
	scheduler, err := NewScheduler(JobFunc(func(context.Context) error {
		mu.Lock()
		runs++
		current := runs
		mu.Unlock()
		if current == 1 {
			close(started)
			<-release
			return errors.New("temporary failure")
		}
		return nil
	}), SchedulerOptions{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := scheduler.RunOnStartup(context.Background())
		result <- err
	}()
	<-started
	if ran, err := scheduler.RunIfDue(context.Background()); err != nil || ran {
		t.Fatalf("overlap ran=%t err=%v", ran, err)
	}
	close(release)
	if err := <-result; err == nil {
		t.Fatal("failed job was accepted")
	}
	if ran, err := scheduler.RunIfDue(context.Background()); err != nil || !ran {
		t.Fatalf("retry ran=%t err=%v", ran, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if runs != 2 {
		t.Fatalf("runs=%d, want 2", runs)
	}
}

func TestNewSchedulerRejectsInvalidConfiguration(t *testing.T) {
	if _, err := NewScheduler(nil, SchedulerOptions{}); err == nil {
		t.Fatal("nil job was accepted")
	}
	if _, err := NewScheduler(JobFunc(func(context.Context) error { return nil }), SchedulerOptions{Interval: -time.Second}); err == nil {
		t.Fatal("negative interval was accepted")
	}
}
