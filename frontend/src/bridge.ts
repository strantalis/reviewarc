import type { AccountState, AnalysisConfiguration, AnalysisProfile, AnalysisRequest, BootstrapState, ChapterStatus, ChangedFile, DiffFile, EnvironmentState, FileContent, InboxAnalysis, InboxResult, Operation, OperationSnapshot, PublishPreview, PullRequestRef, PullRequestReviewComment, RepositoryPage, ReviewComment, ReviewNote, ReviewSession, SelectedRepositoryRefresh, SoftwareUpdateStatus, SourceSelection, SourceState, ThreadReplyPreview, UpdateChannel, Organization } from './types'

type WailsMethod = (...args: unknown[]) => Promise<unknown>
type AppMethodName = keyof typeof import('../wailsjs/go/main/App')
type AppBinding = Partial<Record<AppMethodName, WailsMethod>>

declare global {
  interface Window {
    go?: { main?: { App?: AppBinding } }
    runtime?: {
      EventsOn?: (name: string, callback: (payload: unknown) => void) => () => void
      BrowserOpenURL?: (url: string) => void
      Quit?: () => void
      WindowMinimise?: () => void
      WindowToggleMaximise?: () => void
    }
  }
}

export class BridgeUnavailableError extends Error {
  constructor(method: string) { super(`The desktop backend does not expose ${method}. Rebuild the Wails bindings and try again.`) }
}

async function call<T>(names: AppMethodName[], ...args: unknown[]): Promise<T> {
  const app = window.go?.main?.App
  const name = names.find((candidate) => typeof app?.[candidate] === 'function')
  if (!app || !name) throw new BridgeUnavailableError(names[0])
  return (app[name] as WailsMethod)(...args) as Promise<T>
}

export const backend = {
  bootstrap: () => call<BootstrapState>(['Bootstrap']),
  openThirdPartyNotices: () => call<void>(['OpenThirdPartyNotices']),
  refreshEnvironment: () => call<EnvironmentState>(['RefreshEnvironment']),
  getUpdateStatus: () => call<SoftwareUpdateStatus>(['GetUpdateStatus']),
  checkForUpdates: () => call<SoftwareUpdateStatus>(['CheckForUpdates']),
  setUpdateChannel: (channel: UpdateChannel) => call<SoftwareUpdateStatus>(['SetUpdateChannel'], channel),
  installUpdate: () => call<void>(['InstallUpdate']),
  refreshAccount: () => call<AccountState>(['RefreshAccount']),
  listSources: () => call<SourceState>(['ListSources']),
  refreshSourceAccess: (organizations: Organization[]) => call<Organization[]>(['RefreshSourceAccess'], organizations),
  refreshSelectedRepositories: () => call<SelectedRepositoryRefresh>(['RefreshSelectedRepositories']),
  listCachedOwnerRepositories: (owner: string) => call<RepositoryPage>(['ListCachedOwnerRepositories'], owner),
  refreshOwnerRepositories: (owner: string, cursor = '') => call<RepositoryPage>(['RefreshOwnerRepositories'], {owner, cursor}),
  searchOwnerRepositories: (owner: string, query: string, cursor = '', organization = false) => call<RepositoryPage>(['SearchOwnerRepositories'], {owner, query, cursor, organization}),
  saveSelections: (selections: SourceSelection[]) => call<void>(['SaveSelections'], selections),
  refreshInbox: () => call<InboxResult>(['RefreshInbox']),
  openPullRequest: (ref: PullRequestRef) => call<ReviewSession>(['OpenPullRequest'], ref),
  queueInboxAnalysis: (ref: PullRequestRef) => call<InboxAnalysis>(['QueueInboxAnalysis'], ref),
  refreshPullRequestContext: (sessionId: string) => call<ReviewSession>(['RefreshPullRequestContext'], sessionId),
  getAnalysisConfiguration: () => call<AnalysisConfiguration>(['GetAnalysisConfiguration']),
  refreshAnalysisHarnesses: () => call<AnalysisConfiguration>(['RefreshAnalysisHarnesses']),
  saveAnalysisDefaults: (profile: AnalysisProfile) => call<AnalysisConfiguration>(['SaveAnalysisDefaults'], profile),
  startAnalysis: (sessionId: string, request?: AnalysisRequest) => request ? call<Operation>(['StartAnalysisWithProfile'], sessionId, request) : call<Operation>(['StartAnalysis'], sessionId),
  getActiveAnalysisOperation: (sessionId: string) => call<OperationSnapshot | null>(['GetActiveAnalysisOperation'], sessionId),
  cancelOperation: (operationId: string) => call<void>(['CancelOperation'], operationId),
  getSession: (sessionId: string) => call<ReviewSession>(['GetSession'], sessionId),
  getChangedFiles: (sessionId: string) => call<ChangedFile[]>(['GetChangedFiles'], sessionId),
  getDiff: (sessionId: string, path: string) => call<DiffFile>(['GetDiff'], sessionId, path),
  getFile: (sessionId: string, path: string, revision: 'base' | 'head') => call<FileContent>(['GetFile'], sessionId, path, revision),
  updateChapter: (sessionId: string, chapterId: string, status: ChapterStatus) => call<ReviewSession>(['SetChapterStatus'], sessionId, chapterId, status),
  saveNote: (sessionId: string, chapterId: string, body: string, id = '') => call<ReviewNote>(['SaveNote'], {id, sessionId, chapterId, body}),
  deleteNote: (id: string) => call<void>(['DeleteNote'], id),
  saveDraft: (sessionId: string, chapterId: string, body: string, path?: string, startLine?: number, startSide: 'LEFT' | 'RIGHT' = 'RIGHT', line?: number, side: 'LEFT' | 'RIGHT' = 'RIGHT', id = '') => call<ReviewComment>(['SaveDraftComment'], {id, sessionId, chapterId, kind: path ? 'inline' : 'general', body, path: path ?? '', startLine, startSide: startLine ? startSide : '', line: line ?? 0, side}),
  deleteDraft: (id: string) => call<void>(['DeleteDraftComment'], id),
  preparePublish: (sessionId: string, commentIds: string[]) => call<PublishPreview>(['PreparePublish'], sessionId, commentIds),
  prepareReview: (sessionId: string, commentIds: string[], event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES') => call<PublishPreview>(['PrepareReview'], sessionId, commentIds, event),
  confirmPublish: (token: string, digest: string) => call<ReviewComment[]>(['ConfirmPublish'], token, digest),
  discardPublishPreview: (token: string) => call<void>(['DiscardPublishPreview'], token),
  prepareThreadReply: (sessionId: string, targetCommentId: number, body: string) => call<ThreadReplyPreview>(['PrepareThreadReply'], sessionId, targetCommentId, body),
  confirmThreadReply: (token: string, digest: string) => call<PullRequestReviewComment>(['ConfirmThreadReply'], token, digest),
  discardThreadReplyPreview: (token: string) => call<void>(['DiscardThreadReplyPreview'], token),
  on: (name: string, callback: (payload: unknown) => void) => window.runtime?.EventsOn?.(name, callback) ?? (() => {}),
  openGitHubSSO: (rawUrl: string) => {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || !/^\/orgs\/[^/]+\/sso$/.test(url.pathname) || !url.searchParams.has('authorization_request')) throw new Error('GitHub returned an invalid SSO authorization link.')
    if (!window.runtime?.BrowserOpenURL) throw new BridgeUnavailableError('BrowserOpenURL')
    window.runtime.BrowserOpenURL(url.toString())
  },
  openGitHubURL: (rawUrl: string) => {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('GitHub returned an invalid external link.')
    if (!window.runtime?.BrowserOpenURL) throw new BridgeUnavailableError('BrowserOpenURL')
    window.runtime.BrowserOpenURL(url.toString())
  },
  openReleaseNotesURL: (rawUrl: string) => {
    const url = new URL(rawUrl)
    if (url.origin !== 'https://www.reviewarc.dev' || !/^\/releases\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z.-]+)?$/i.test(url.pathname) || url.search || url.hash) throw new Error('ReviewArc returned an invalid release notes link.')
    if (!window.runtime?.BrowserOpenURL) throw new BridgeUnavailableError('BrowserOpenURL')
    window.runtime.BrowserOpenURL(url.toString())
  },
}
