import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import { backend } from '../../bridge'
import { repoName } from '../../lib'
import type { BootstrapState, Operation, PullRequestSummary, ReviewSession } from '../../types'

type InboxUpdate = (items: PullRequestSummary[]) => PullRequestSummary[]

export function useSessionSync(
  setBootstrap: Dispatch<SetStateAction<BootstrapState | undefined>>,
  setSession: Dispatch<SetStateAction<ReviewSession | undefined>>,
) {
  const updateInbox = useCallback((update: InboxUpdate) => {
    setBootstrap((current) => current ? {...current, inbox: update(current.inbox)} : current)
  }, [setBootstrap])
  const syncInboxSession = useCallback((next: ReviewSession) => {
    updateInbox((current) => current.map((item) => item.sessionId === next.id || (repoName(item) === repoName(next.pullRequest) && item.ref.number === next.pullRequest.ref.number)
      ? {...item, sessionId: next.id, analysisStatus: next.analysisStatus, progress: next.progress, riskLevel: next.pullRequest.riskLevel}
      : item))
  }, [updateInbox])
  const syncSession = useCallback((next: ReviewSession) => {
    setSession(next)
    syncInboxSession(next)
  }, [setSession, syncInboxSession])

  useEffect(() => backend.on('reviewarc:operation:v1', (raw) => {
    const operation = raw as Operation
    if (!operation.sessionId) return
    if (operation.state === 'queued' || operation.state === 'running') {
      updateInbox((current) => current.map((item) => item.sessionId === operation.sessionId ? {...item, analysisStatus: operation.state as 'queued' | 'running'} : item))
      return
    }
    if (['completed', 'complete', 'failed', 'cancelled'].includes(operation.state)) void backend.getSession(operation.sessionId).then(syncInboxSession).catch(() => {})
  }), [syncInboxSession, updateInbox])

  return {updateInbox, syncSession}
}
