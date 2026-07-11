import type { AccountState, BootstrapState, ChapterStatus, ChangedFile, DiffFile, FileContent, InboxResult, Operation, PublishPreview, PullRequestRef, ReviewComment, ReviewNote, ReviewSession, SourceSelection, SourceState } from './types'

type WailsMethod = (...args: unknown[]) => Promise<unknown>
type AppBinding = Record<string, WailsMethod>

declare global {
  interface Window {
    go?: { main?: { App?: AppBinding } }
    runtime?: { EventsOn?: (name: string, callback: (payload: unknown) => void) => () => void }
  }
}

export class BridgeUnavailableError extends Error {
  constructor(method: string) { super(`The desktop backend does not expose ${method}. Rebuild the Wails bindings and try again.`) }
}

async function call<T>(names: string[], ...args: unknown[]): Promise<T> {
  const app = window.go?.main?.App
  const name = names.find((candidate) => typeof app?.[candidate] === 'function')
  if (!app || !name) throw new BridgeUnavailableError(names[0])
  return app[name](...args) as Promise<T>
}

export const backend = {
  bootstrap: () => call<BootstrapState>(['Bootstrap']),
  refreshAccount: () => call<AccountState>(['RefreshAccount']),
  listSources: () => call<SourceState>(['ListSources']),
  saveSelections: (selections: SourceSelection[]) => call<void>(['SaveSelections'], selections),
  refreshInbox: () => call<InboxResult>(['RefreshInbox']),
  openPullRequest: (ref: PullRequestRef) => call<ReviewSession>(['OpenPullRequest'], ref),
  startAnalysis: (sessionId: string) => call<Operation>(['StartAnalysis'], sessionId),
  cancelOperation: (operationId: string) => call<void>(['CancelOperation'], operationId),
  getSession: (sessionId: string) => call<ReviewSession>(['GetSession'], sessionId),
  getChangedFiles: (sessionId: string) => call<ChangedFile[]>(['GetChangedFiles'], sessionId),
  getDiff: (sessionId: string, path: string) => call<DiffFile>(['GetDiff'], sessionId, path),
  getFile: (sessionId: string, path: string, revision: 'base' | 'head') => call<FileContent>(['GetFile'], sessionId, path, revision),
  updateChapter: (sessionId: string, chapterId: string, status: ChapterStatus) => call<ReviewSession>(['SetChapterStatus'], sessionId, chapterId, status),
  saveNote: (sessionId: string, chapterId: string, body: string, id = '') => call<ReviewNote>(['SaveNote'], {id, sessionId, chapterId, body}),
  deleteNote: (id: string) => call<void>(['DeleteNote'], id),
  saveDraft: (sessionId: string, chapterId: string, body: string, path?: string, line?: number, side: 'LEFT' | 'RIGHT' = 'RIGHT', id = '') => call<ReviewComment>(['SaveDraftComment'], {id, sessionId, chapterId, kind: path ? 'inline' : 'general', body, path: path ?? '', line: line ?? 0, side}),
  deleteDraft: (id: string) => call<void>(['DeleteDraftComment'], id),
  preparePublish: (sessionId: string, commentIds: string[]) => call<PublishPreview>(['PreparePublish'], sessionId, commentIds),
  prepareReview: (sessionId: string, commentIds: string[], event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES') => call<PublishPreview>(['PrepareReview'], sessionId, commentIds, event),
  confirmPublish: (token: string, digest: string) => call<ReviewComment[]>(['ConfirmPublish'], token, digest),
  on: (name: string, callback: (payload: unknown) => void) => window.runtime?.EventsOn?.(name, callback) ?? (() => {}),
}
