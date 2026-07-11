import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, DiffView, FileContextView, OverviewScreen, SplitDiffView } from './App'
import { Markdown } from './components'
import type { BootstrapState, ReviewSession } from './types'

const paths = {root: '/tmp/reviewarc', repositories: '/tmp/reviewarc/repos', worktrees: '/tmp/reviewarc/worktrees', database: '/tmp/reviewarc/db.sqlite', logs: '/tmp/reviewarc/logs', cache: '/tmp/reviewarc/cache'}

function installBackend(state: BootstrapState, account: unknown = {status: 'authenticated', user: {login: 'sean', name: 'Sean', avatarUrl: ''}}) {
  window.go = {main: {App: {
    Bootstrap: vi.fn().mockResolvedValue(state),
    RefreshAccount: vi.fn().mockResolvedValue(account),
    RefreshInbox: vi.fn().mockResolvedValue({items: [], errors: {}, partial: false}),
  }}}
}

describe('App startup', () => {
  it('shows dependency and auth remediation when gh is missing', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'missing', message: 'not installed'}, {name: 'codex', state: 'available'}], paths, selections: [], inbox: []})
    render(<App/>)
    expect(await screen.findByText('Connect your review workspace')).toBeInTheDocument()
    expect(screen.getByText('gh auth login')).toBeInTheDocument()
  })

  it('opens the real-data inbox for an authenticated configured account', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []})
    render(<App/>)
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    await waitFor(() => expect(window.go?.main?.App?.RefreshInbox).toHaveBeenCalled())
    expect(screen.getByText('Your review queue is clear')).toBeInTheDocument()
  })
})

describe('Reanalysis state', () => {
  it('shows progress, preserves the previous walkthrough, and prevents concurrent review actions', async () => {
    const session: ReviewSession = {
      id: 'session-1', baseSha: 'base', headSha: 'head', status: 'ready', analysisStatus: 'ready', isStale: false,
      createdAt: '2026-07-11T12:00:00Z', updatedAt: '2026-07-11T12:00:00Z', notes: [], comments: [], chapters: [{chapterId: 'chapter-1', status: 'reviewed', updatedAt: '2026-07-11T12:00:00Z'}], progress: {total: 1, reviewed: 1, blocked: 0, clarify: 0, percent: 100},
      pullRequest: {ref: {repository: {host: 'github.com', owner: 'acme', name: 'private-api', cloneUrl: '', databaseId: ''}, number: 7}, title: 'Private change', url: '', author: {login: 'sean', name: 'Sean', avatarUrl: ''}, updatedAt: '2026-07-11T12:00:00Z', isDraft: false, additions: 4, deletions: 1, changedFiles: 1, relationships: ['authored'], labels: [], analysisStatus: 'ready', progress: {total: 1, reviewed: 1, blocked: 0, clarify: 0, percent: 100}, riskLevel: 'low', body: '', baseRef: 'main', headRef: 'feature', baseSha: 'base', headSha: 'head', headRepository: {host: 'github.com', owner: 'acme', name: 'private-api', cloneUrl: '', databaseId: ''}, commits: [], requestedReviewers: [], assignees: [], reviews: [], reviewComments: [], checkRuns: [], reviewState: ''},
      analysis: {schemaVersion: 1, baseSha: 'base', headSha: 'head', summary: 'Previous validated walkthrough', summaryEvidence: [], summaryValidation: 'valid', affectedAreas: [], behavioralChanges: [], risks: [], facts: [], inferences: [], unknowns: [], createdAt: '2026-07-11T12:00:00Z', validationIssues: [], chapters: [{id: 'chapter-1', order: 1, title: 'Existing chapter', description: 'Existing description', purpose: 'Review it', status: 'reviewed', evidence: [], files: [], symbols: [], behavioralChanges: [], risks: [], facts: [], inferences: [], unknowns: [], relatedTests: [], suggestedQuestions: []}]},
    }
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingSnapshot', message: 'Preparing isolated repository snapshot', state: 'running'})
    const getSession = vi.fn().mockResolvedValue(session)
    const handlers: Record<string, (value: unknown) => void> = {}
    const onSession = vi.fn()
    window.go = {main: {App: {StartAnalysis: start, GetSession: getSession}}}
    window.runtime = {EventsOn: vi.fn((name: string, handler: (value: unknown) => void) => { handlers[name] = handler; return () => {} })}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={onSession} onReview={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze'}))
    expect(await screen.findByRole('button', {name: 'Reanalyzing'})).toBeDisabled()
    expect(screen.getByText('Reanalysis progress')).toBeInTheDocument()
    expect(screen.getByText('Previous validated walkthrough')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: /Start guided review/})).toBeDisabled()
    handlers['reviewarc:operation:v1']({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'cancelled', message: 'Analysis cancelled', state: 'cancelled'})
    await waitFor(() => expect(getSession).toHaveBeenCalledWith(session.id))
    expect(onSession).toHaveBeenCalledWith(session)
  })
})

describe('Diff review interactions', () => {
  it('navigates validated evidence and targets both diff sides', () => {
    const onCommentLine = vi.fn()
    render(<DiffView diff={{file: {path: 'src/greet.ts', previousPath: '', status: 'modified', additions: 1, deletions: 1, isBinary: false}, hunks: [{header: '@@ -4 +4 @@', oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: [{kind: 'delete', content: 'old', oldLine: 4}, {kind: 'add', content: 'new', newLine: 4}]}]}} focus={{id: 'evidence', path: 'src/greet.ts', revision: 'head', startLine: 4, endLine: 4, validationStatus: 'valid'}} onCommentLine={onCommentLine}/>)
    const focused = document.getElementById('focused-evidence-line')
    expect(focused).toHaveClass('evidence-focused')
    fireEvent.click(screen.getByRole('button', {name: 'Draft a comment on base line 4'}))
    fireEvent.click(screen.getByRole('button', {name: 'Draft a comment on head line 4'}))
    expect(onCommentLine).toHaveBeenNthCalledWith(1, 4, 'LEFT')
    expect(onCommentLine).toHaveBeenNthCalledWith(2, 4, 'RIGHT')
  })

  it('shows evidence outside diff hunks in full-file context', () => {
    const onCommentLine = vi.fn()
    render(<FileContextView file={{path: 'src/greet.ts', revision: 'base', sha: 'base', content: 'one\ntwo\nthree\n', isBinary: false, lineCount: 3}} focus={{id: 'outside-hunk', path: 'src/greet.ts', revision: 'base', startLine: 2, endLine: 2, validationStatus: 'valid'}} onCommentLine={onCommentLine}/>)
    expect(document.getElementById('focused-file-line')).toHaveTextContent('two')
    fireEvent.click(screen.getByRole('button', {name: 'Draft a comment on base line 2'}))
    expect(onCommentLine).toHaveBeenCalledWith(2, 'LEFT')
  })

  it('renders split diffs with comment targets on both revisions', () => {
    const onCommentLine = vi.fn()
    render(<SplitDiffView diff={{file: {path: 'src/greet.ts', previousPath: '', status: 'modified', additions: 1, deletions: 1, isBinary: false}, hunks: [{header: '@@ -4 +4 @@', oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: [{kind: 'delete', content: 'old', oldLine: 4}, {kind: 'add', content: 'new', newLine: 4}]}]}} onCommentLine={onCommentLine}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Draft a comment on base line 4'}))
    fireEvent.click(screen.getByRole('button', {name: 'Draft a comment on head line 4'}))
    expect(onCommentLine).toHaveBeenNthCalledWith(1, 4, 'LEFT')
    expect(onCommentLine).toHaveBeenNthCalledWith(2, 4, 'RIGHT')
  })
})

describe('safe PR Markdown', () => {
  it('renders headings, lists, code, and only http links', () => {
    render(<Markdown>{'## Summary\n\n- change `README.md`\n- [details](https://example.com)\n- [unsafe](javascript:alert(1))'}</Markdown>)
    expect(screen.getByRole('heading', {name: 'Summary'})).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'details'})).toHaveAttribute('href', 'https://example.com')
    expect(screen.queryByRole('link', {name: 'unsafe'})).not.toBeInTheDocument()
    expect(screen.getByText('README.md').tagName).toBe('CODE')
  })
})
