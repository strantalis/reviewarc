package main

import (
	"testing"
	"time"

	"reviewarc/internal/domain"
)

func TestPreparedReviewCacheEvictsLeastRecentlyUsedEntry(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	cache := newPreparedReviewCache(2, 100, time.Hour)
	cache.now = func() time.Time { return now }
	cache.Put("first", preparedState{})
	now = now.Add(time.Minute)
	cache.Put("second", preparedState{})
	now = now.Add(time.Minute)
	if _, ok := cache.Get("first"); !ok {
		t.Fatal("first entry missing before eviction")
	}
	now = now.Add(time.Minute)
	cache.Put("third", preparedState{})

	if _, ok := cache.Get("second"); ok {
		t.Fatal("least recently used entry was retained")
	}
	if _, ok := cache.Get("first"); !ok {
		t.Fatal("recently used entry was evicted")
	}
	if _, ok := cache.Get("third"); !ok {
		t.Fatal("new entry was evicted")
	}
	if got := cache.Len(); got != 2 {
		t.Fatalf("cache size=%d, want 2", got)
	}
}

func TestPreparedReviewCacheExpiresIdleEntries(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	cache := newPreparedReviewCache(4, 100, 10*time.Minute)
	cache.now = func() time.Time { return now }
	cache.Put("active", preparedState{})
	cache.Put("idle", preparedState{})
	now = now.Add(6 * time.Minute)
	if _, ok := cache.Get("active"); !ok {
		t.Fatal("active entry missing")
	}
	now = now.Add(5 * time.Minute)
	if _, ok := cache.Get("idle"); ok {
		t.Fatal("idle entry did not expire")
	}
	if _, ok := cache.Get("active"); !ok {
		t.Fatal("active entry expired despite recent use")
	}
	if got := cache.Len(); got != 1 {
		t.Fatalf("cache size=%d, want 1", got)
	}
}

func TestPreparedReviewCacheDelete(t *testing.T) {
	cache := newPreparedReviewCache(1, 100, time.Hour)
	cache.Put("session", preparedState{})
	cache.Delete("session")
	if _, ok := cache.Get("session"); ok {
		t.Fatal("deleted entry was returned")
	}
}

func TestPreparedReviewCacheBoundsChangedFileRecords(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	cache := newPreparedReviewCache(10, 3, time.Hour)
	cache.now = func() time.Time { return now }
	cache.Put("first", preparedState{files: make([]domain.ChangedFile, 2)})
	now = now.Add(time.Minute)
	cache.Put("second", preparedState{files: make([]domain.ChangedFile, 2)})
	if _, ok := cache.Get("first"); ok {
		t.Fatal("oldest entry was retained above the file-record budget")
	}
	if _, ok := cache.Get("second"); !ok {
		t.Fatal("new entry was evicted")
	}

	cache.Put("oversized", preparedState{files: make([]domain.ChangedFile, 4)})
	if _, ok := cache.Get("oversized"); ok {
		t.Fatal("entry larger than the complete file-record budget was cached")
	}
}
