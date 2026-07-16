package main

import (
	"sync"
	"time"
)

const (
	maxPreparedReviewEntries = 32
	maxPreparedReviewFiles   = 20_000
	preparedReviewIdleTTL    = 30 * time.Minute
)

type preparedReviewCache struct {
	mu         sync.Mutex
	entries    map[string]preparedReviewCacheEntry
	maxEntries int
	maxFiles   int
	totalFiles int
	idleTTL    time.Duration
	now        func() time.Time
}

type preparedReviewCacheEntry struct {
	state    preparedState
	lastUsed time.Time
}

func newPreparedReviewCache(maxEntries, maxFiles int, idleTTL time.Duration) *preparedReviewCache {
	if maxEntries <= 0 {
		maxEntries = maxPreparedReviewEntries
	}
	if maxFiles <= 0 {
		maxFiles = maxPreparedReviewFiles
	}
	if idleTTL <= 0 {
		idleTTL = preparedReviewIdleTTL
	}
	return &preparedReviewCache{
		entries:    make(map[string]preparedReviewCacheEntry, maxEntries),
		maxEntries: maxEntries,
		maxFiles:   maxFiles,
		idleTTL:    idleTTL,
		now:        time.Now,
	}
}

// Get returns a prepared review and refreshes its idle deadline.
func (c *preparedReviewCache) Get(sessionID string) (preparedState, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	c.purgeExpiredLocked(now)
	entry, ok := c.entries[sessionID]
	if !ok {
		return preparedState{}, false
	}
	entry.lastUsed = now
	c.entries[sessionID] = entry
	return entry.state, true
}

func (c *preparedReviewCache) Put(sessionID string, state preparedState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	c.purgeExpiredLocked(now)
	if existing, ok := c.entries[sessionID]; ok {
		c.totalFiles -= len(existing.state.files)
		delete(c.entries, sessionID)
	}
	if len(state.files) > c.maxFiles {
		return
	}
	c.entries[sessionID] = preparedReviewCacheEntry{state: state, lastUsed: now}
	c.totalFiles += len(state.files)
	for len(c.entries) > c.maxEntries || c.totalFiles > c.maxFiles {
		oldestID := ""
		oldestTime := time.Time{}
		for id, entry := range c.entries {
			if id == sessionID && len(c.entries) > 1 {
				continue
			}
			if oldestID == "" || entry.lastUsed.Before(oldestTime) {
				oldestID = id
				oldestTime = entry.lastUsed
			}
		}
		c.totalFiles -= len(c.entries[oldestID].state.files)
		delete(c.entries, oldestID)
	}
}

func (c *preparedReviewCache) Delete(sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.totalFiles -= len(c.entries[sessionID].state.files)
	delete(c.entries, sessionID)
}

func (c *preparedReviewCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.purgeExpiredLocked(c.now())
	return len(c.entries)
}

func (c *preparedReviewCache) purgeExpiredLocked(now time.Time) {
	for id, entry := range c.entries {
		if !entry.lastUsed.Add(c.idleTTL).After(now) {
			c.totalFiles -= len(entry.state.files)
			delete(c.entries, id)
		}
	}
}
