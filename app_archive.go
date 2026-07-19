package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"reviewarc/internal/analysisbundle"
	"reviewarc/internal/domain"
	"reviewarc/internal/persistence"
)

const archiveCleanupInterval = 24 * time.Hour

// GetArchiveRetentionDays returns the number of days completed reviews remain
// restorable. Zero disables automatic deletion.
func (a *App) GetArchiveRetentionDays() (int, error) {
	retention, err := a.store.GetArchiveRetention(a.appContext())
	if err != nil {
		return 0, err
	}
	return retention.Days, nil
}

// SetArchiveRetentionDays updates the archive retention policy. Zero keeps
// archived reviews until the user deletes them explicitly.
func (a *App) SetArchiveRetentionDays(days int) (int, error) {
	retention := domain.ArchiveRetention{Days: days}
	if err := a.store.SaveArchiveRetention(a.appContext(), retention); err != nil {
		return 0, err
	}
	return days, nil
}

func (a *App) ListArchivedSessions() ([]domain.ReviewSession, error) {
	sessions, err := a.store.ListArchivedSessions(a.appContext())
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		sessions = []domain.ReviewSession{}
	}
	for index := range sessions {
		sessions[index] = normalizeSession(sessions[index])
	}
	return sessions, nil
}

// ArchiveSession is deliberately reversible. It cancels analysis work and
// discards unpublished in-memory confirmations, while durable notes, drafts,
// judgments, and publication history remain intact until retention cleanup.
func (a *App) ArchiveSession(sessionID string) (domain.ReviewSession, error) {
	return a.archiveSession(sessionID, domain.ArchiveReasonManual)
}

func (a *App) archiveSession(sessionID string, reason domain.ArchiveReason) (domain.ReviewSession, error) {
	if sessionID == "" {
		return domain.ReviewSession{}, errors.New("session ID is required")
	}

	a.mu.RLock()
	operationID := a.analysisBySession[sessionID]
	a.mu.RUnlock()
	if operationID != "" {
		if err := a.CancelOperation(operationID); err != nil {
			return domain.ReviewSession{}, fmt.Errorf("archive review: cancel analysis: %w", err)
		}
	}

	a.discardSessionConfirmations(sessionID)
	if err := a.store.ArchiveSession(a.appContext(), sessionID, reason); err != nil {
		return domain.ReviewSession{}, err
	}
	a.evictPreparedSession(sessionID)
	session, err := a.GetSession(sessionID)
	if err != nil {
		return domain.ReviewSession{}, err
	}
	a.emitSessionChange(sessionID, "archived")
	return session, nil
}

func (a *App) RestoreSession(sessionID string) (domain.ReviewSession, error) {
	if err := a.store.RestoreSession(a.appContext(), sessionID); err != nil {
		return domain.ReviewSession{}, err
	}
	session, err := a.GetSession(sessionID)
	if err != nil {
		return domain.ReviewSession{}, err
	}
	a.emitSessionChange(sessionID, "restored")
	return session, nil
}

func (a *App) DeleteArchivedSession(sessionID string) error {
	if a.sessionAnalysisActive(sessionID) {
		return errors.New("analysis cancellation is still finishing; try again shortly")
	}
	a.discardSessionConfirmations(sessionID)
	if err := a.store.DeleteSession(a.appContext(), sessionID); err != nil {
		return err
	}
	a.evictPreparedSession(sessionID)
	a.emitSessionChange(sessionID, "deleted")
	return nil
}

func (a *App) discardSessionConfirmations(sessionID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for token, pending := range a.publish {
		if pending.sessionID == sessionID {
			delete(a.publish, token)
		}
	}
	for token, pending := range a.threadReplies {
		if pending.sessionID == sessionID {
			delete(a.threadReplies, token)
		}
	}
}

func (a *App) sessionAnalysisActive(sessionID string) bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	_, active := a.analysisBySession[sessionID]
	return active
}

func (a *App) emitSessionChange(sessionID, reason string) {
	if a.ctx != nil {
		runtime.EventsEmit(a.appContext(), "reviewarc:session:v1", map[string]any{"sessionId": sessionID, "reason": reason})
	}
}

func (a *App) archiveCleanupLoop(ctx context.Context) {
	defer a.schedulerWG.Done()
	_, _ = a.cleanupScheduler.RunOnStartup(ctx)
	ticker := time.NewTicker(archiveCleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = a.cleanupScheduler.RunIfDue(ctx)
		}
	}
}

func (a *App) runArchiveCleanup(ctx context.Context) error {
	if _, err := analysisbundle.Scavenge(a.paths.Root, analysisbundle.ScavengeOptions{ProtectedPaths: a.activeBundlePaths()}); err != nil {
		return err
	}
	sessions, err := a.store.ListArchivePurgeCandidates(ctx, time.Now().UTC())
	if err != nil {
		return err
	}
	var cleanupErr error
	for _, session := range sessions {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if a.sessionAnalysisActive(session.ID) {
			continue
		}
		if err := a.store.DeleteSession(ctx, session.ID); err != nil {
			if errors.Is(err, persistence.ErrPublicationOutcomeUnknown) || errors.Is(err, persistence.ErrSessionBusy) {
				continue
			}
			cleanupErr = errors.Join(cleanupErr, err)
			continue
		}
		a.evictPreparedSession(session.ID)
	}
	return cleanupErr
}

func (a *App) evictPreparedSession(sessionID string) {
	if a.prepared != nil {
		a.prepared.Delete(sessionID)
	}
}

func (a *App) activeBundlePaths() map[string]struct{} {
	a.mu.RLock()
	defer a.mu.RUnlock()
	paths := make(map[string]struct{}, len(a.activeBundles))
	for path := range a.activeBundles {
		paths[path] = struct{}{}
	}
	return paths
}
