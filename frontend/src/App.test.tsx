import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, DiffView, FileContextView, OverviewScreen, ReviewWorkspace, SettingsScreen, SourceSelector, SplitDiffView } from './App'
import { Markdown, WindowControls } from './components'
import type { BootstrapState, ReviewSession, SoftwareUpdateStatus } from './types'

const paths = {root: '/tmp/reviewarc', repositories: '/tmp/reviewarc/repos', worktrees: '/tmp/reviewarc/worktrees', database: '/tmp/reviewarc/db.sqlite', logs: '/tmp/reviewarc/logs', cache: '/tmp/reviewarc/cache'}
const idleUpdate: SoftwareUpdateStatus = {currentVersion: '0.1.0', currentBuild: '7', state: 'idle', channel: 'stable'}

function installBackend(state: BootstrapState, account: unknown = {status: 'authenticated', user: {login: 'sean', name: 'Sean', avatarUrl: ''}}) {
  window.go = {main: {App: {
    Bootstrap: vi.fn().mockResolvedValue(state),
    GetUpdateStatus: vi.fn().mockResolvedValue(idleUpdate),
    RefreshAccount: vi.fn().mockResolvedValue(account),
    RefreshInbox: vi.fn().mockResolvedValue({items: [], errors: {}, partial: false}),
  }}}
}

describe('App startup', () => {
  it('wires the custom stoplights to Wails window actions', () => {
    const quit = vi.fn()
    const minimise = vi.fn()
    const zoom = vi.fn()
    window.runtime = {Quit: quit, WindowMinimise: minimise, WindowToggleMaximise: zoom}
    render(<WindowControls/>)
    fireEvent.click(screen.getByRole('button', {name: 'Close ReviewArc'}))
    fireEvent.click(screen.getByRole('button', {name: 'Minimize ReviewArc'}))
    fireEvent.click(screen.getByRole('button', {name: 'Zoom ReviewArc'}))
    expect(quit).toHaveBeenCalledOnce()
    expect(minimise).toHaveBeenCalledOnce()
    expect(zoom).toHaveBeenCalledOnce()
  })

  it('shows Finder-launch-aware dependency remediation when gh is missing', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available', path: '/usr/bin/git'}, {name: 'gh', state: 'missing', message: 'Not available on PATH'}, {name: 'codex', state: 'available', path: '/opt/homebrew/bin/codex'}], paths, selections: [], inbox: []})
    render(<App/>)
    expect(await screen.findByText('Connect your review workspace')).toBeInTheDocument()
    expect(screen.getByText(/Finder-launched apps use a limited environment/)).toBeInTheDocument()
    expect(screen.getByText('brew install gh')).toBeInTheDocument()
    expect(screen.queryByText('gh auth login')).not.toBeInTheDocument()
    expect(screen.getByText('/opt/homebrew/bin/codex')).toBeInTheDocument()
  })

  it('checks dependencies again and leaves onboarding when the environment is repaired', async () => {
    const missing: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'missing'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []}
    const ready: BootstrapState = {...missing, dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}]}
    installBackend(missing)
    window.go!.main!.App!.Bootstrap = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(ready)
    render(<App/>)
    fireEvent.click(await screen.findByRole('button', {name: 'Check again'}))
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    expect(window.go?.main?.App?.Bootstrap).toHaveBeenCalledTimes(2)
  })

  it('opens the real-data inbox for an authenticated configured account', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []})
    render(<App/>)
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    await waitFor(() => expect(window.go?.main?.App?.RefreshInbox).toHaveBeenCalled())
	expect(screen.getByText('Your review queue is clear')).toBeInTheDocument()
  })

  it('filters the inbox by GitHub label', async () => {
    const base = {ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, number: 7}, title: 'Security change', url: '', author: {login: 'sean', name: '', avatarUrl: ''}, updatedAt: '2026-07-12T00:00:00Z', isDraft: false, additions: 8, deletions: 2, changedFiles: 3, relationships: ['selectedRepo' as const, 'authored' as const], labels: ['security'], analysisStatus: 'notStarted' as const, progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, riskLevel: 'unknown' as const}
    const docs = {...base, ref: {...base.ref, number: 8}, title: 'Documentation change', labels: ['documentation']}
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [base, docs]})
    render(<App/>)
    const select = await screen.findByRole('combobox', {name: 'Label'})
    expect(select).toHaveTextContent('All labels')
    expect(screen.getAllByText('Authored by you')).toHaveLength(2)
    fireEvent.keyDown(select, {key: 'ArrowDown'})
    fireEvent.click(await screen.findByRole('option', {name: 'security'}))
    expect(screen.getByText('Security change')).toBeInTheDocument()
    expect(screen.queryByText('Documentation change')).not.toBeInTheDocument()
  })

  it('transitions immediately when pull request hydration is still running', async () => {
	const pr = {ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, number: 7}, title: 'Slow change', url: 'https://github.com/acme/api/pull/7', author: {login: 'sean', name: 'Sean', avatarUrl: ''}, updatedAt: '2026-07-12T00:00:00Z', isDraft: false, additions: 8, deletions: 2, changedFiles: 3, relationships: ['authored' as const], labels: [], analysisStatus: 'notStarted' as const, progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, riskLevel: 'unknown' as const}
	const state: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pr]}
	installBackend(state)
	window.go!.main!.App!.OpenPullRequest = vi.fn(() => new Promise(() => {}))
	render(<App/>)
	fireEvent.click((await screen.findByText('Slow change')).closest('button')!)
	expect(screen.getByText('Loading pull request context…')).toBeInTheDocument()
	expect(screen.getByRole('heading', {name: /#7 Slow change/})).toBeInTheDocument()
	expect(screen.queryByRole('heading', {name: 'Pull request inbox'})).not.toBeInTheDocument()
  })
})

describe('Settings', () => {
  it('shows the authenticated account and effective SSH protocol used for managed Git operations', () => {
    render(<SettingsScreen state={{dependencies: [{name: 'git', state: 'available', path: '/usr/bin/git'}, {name: 'gh', state: 'available', path: '/opt/homebrew/bin/gh'}, {name: 'codex', state: 'available', path: '/Users/sean/.local/bin/codex'}], paths, account: {login: 'strantalis', name: 'Sean', avatarUrl: ''}, gitProtocol: 'ssh', selections: [], inbox: []}} onSources={vi.fn()}/>)
    expect(screen.getByText('Authenticated as @strantalis')).toBeInTheDocument()
    expect(screen.getByText('Git operations: SSH')).toBeInTheDocument()
    expect(screen.getByText(/follow your/)).toHaveTextContent('Managed repository fetches follow your gh protocol setting.')
    expect(screen.getByTitle('/opt/homebrew/bin/gh')).toHaveTextContent('/opt/homebrew/bin/gh')
  })

  it('locks the release channel while an update is ready and surfaces restart', () => {
    const onSetChannel = vi.fn()
    const onInstall = vi.fn()
    const update: SoftwareUpdateStatus = {currentVersion: '0.2.0-beta.3', currentBuild: '42', state: 'ready', channel: 'beta', release: {version: '0.2.0-beta.4', build: '45', releaseNotesUrl: 'https://github.com/strantalis/reviewarc/releases/tag/v0.2.0-beta.4'}}
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} update={update} onSetUpdateChannel={onSetChannel} onInstallUpdate={onInstall} onSources={vi.fn()}/>)
    expect(screen.getByText('v0.2.0-beta.3 · build 42')).toBeInTheDocument()
    expect(screen.getByText(/Returning to Stable does not downgrade/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Stable'})).toBeDisabled()
    expect(onSetChannel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Restart to update'}))
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('allows switching channels while the updater is idle', () => {
    const onSetChannel = vi.fn()
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} update={idleUpdate} onSetUpdateChannel={onSetChannel} onSources={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Beta'}))
    expect(onSetChannel).toHaveBeenCalledWith('beta')
  })

  it('shows a completed no-update check instead of an indefinite checking state', () => {
    const update = {...idleUpdate, lastCheckedAt: new Date().toISOString()}
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} update={update} onSources={vi.fn()}/>)
    expect(screen.getByText('You’re up to date.')).toBeInTheDocument()
    expect(screen.getByText('Last checked just now.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Check now'})).toBeEnabled()
  })

  it('keeps a failed update check actionable', () => {
    const onCheck = vi.fn()
    const update: SoftwareUpdateStatus = {...idleUpdate, state: 'failed', error: 'The update feed could not be loaded.'}
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} update={update} onCheckUpdate={onCheck} onSources={vi.fn()}/>)
    expect(screen.getByText('ReviewArc could not check for updates.')).toBeInTheDocument()
    expect(screen.getByText('The update feed could not be loaded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Try again'}))
    expect(onCheck).toHaveBeenCalledOnce()
  })
})

describe('Repository sources', () => {
  it('renders included source rules before GitHub owner discovery completes', () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'organization', key: 'acme', enabled: true}, {kind: 'repository', key: 'sean/reviewarc', enabled: true}], inbox: []}
    window.go = {main: {App: {ListSources: vi.fn(() => new Promise(() => {}))}}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    expect(screen.getByRole('heading', {name: 'Included sources'})).toBeInTheDocument()
    expect(screen.getByText('2 sources included')).toBeInTheDocument()
    expect(screen.getByText('Every active repository in this organization')).toBeInTheDocument()
    expect(screen.getByText('sean/reviewarc')).toBeInTheDocument()
  })

  it('loads owner repositories in bounded pages and appends without duplicates', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [], inbox: []}
    const repository = (name: string) => ({ref: {host: 'github.com', owner: 'sean', name, cloneUrl: '', databaseId: name}, description: '', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'})
    const first = Array.from({length: 50}, (_, index) => repository(`repo-${String(index).padStart(2, '0')}`))
    const refresh = vi.fn().mockImplementation(({cursor}: {cursor: string}) => Promise.resolve(cursor ? {items: [repository('repo-50')], totalCount: 51, hasNextPage: false, cached: false} : {items: first, totalCount: 51, endCursor: 'next', hasNextPage: true, cached: false}))
    window.go = {main: {App: {
	  ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [], selections: []}),
	  RefreshSourceAccess: vi.fn().mockResolvedValue([]),
	  RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListCachedOwnerRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true}),
      RefreshOwnerRepositories: refresh,
    }}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Show personal repositories from sean'}))
    expect(await screen.findByText('Showing 50 of 51')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Load 50 more'}))
    expect(await screen.findByText('sean/repo-50')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Load 50 more'})).not.toBeInTheDocument()
    expect(refresh).toHaveBeenNthCalledWith(2, {owner: 'sean', cursor: 'next'})
  })

  it('uses organization names to filter and a distinct control to include every repository', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [], inbox: []}
    const saveSelections = vi.fn().mockResolvedValue(undefined)
    const organizations = [{login: 'acme', name: 'Acme', avatarUrl: '', accessStatus: 'available'}, {login: 'other', name: 'Other', avatarUrl: '', accessStatus: 'available'}, {login: 'locked', name: 'Locked', avatarUrl: '', accessStatus: 'ssoRequired', ssoUrl: 'https://github.com/orgs/locked/sso?authorization_request=temporary'}]
    const ownerRepositories = {
      sean: [{ref: {host: 'github.com', owner: 'sean', name: 'reviewarc', cloneUrl: '', databaseId: '0'}, description: 'Personal project', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'}],
      acme: [
        {ref: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, description: 'API', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'},
        {ref: {host: 'github.com', owner: 'acme', name: 'web', cloneUrl: '', databaseId: '2'}, description: 'Web', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'},
        {ref: {host: 'github.com', owner: 'acme', name: 'archive', cloneUrl: '', databaseId: '4'}, description: 'Archived', isPrivate: true, isArchived: true, updatedAt: '2026-07-12T00:00:00Z'},
      ],
    }
    window.go = {main: {App: {
      ListSources: vi.fn().mockResolvedValue({
        organizations,
        repositories: [],
        selections: [],
      }),
	  RefreshSourceAccess: vi.fn().mockResolvedValue(organizations),
	  RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListCachedOwnerRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true}),
      RefreshOwnerRepositories: vi.fn().mockImplementation(({owner}: {owner: keyof typeof ownerRepositories}) => Promise.resolve({items: ownerRepositories[owner] ?? [], totalCount: owner === 'acme' ? 2 : 1, hasNextPage: false, cached: false})),
      SaveSelections: saveSelections,
    }}}
    const openURL = vi.fn()
    window.runtime = {BrowserOpenURL: openURL}
    const onDone = vi.fn().mockResolvedValue(undefined)
    render(<SourceSelector state={state} onDone={onDone}/>)

    expect(await screen.findByText('SSO authorization required')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Authorize SSO for locked'}))
    expect(openURL).toHaveBeenCalledWith('https://github.com/orgs/locked/sso?authorization_request=temporary')

    fireEvent.click(await screen.findByRole('button', {name: 'Show personal repositories from sean'}))
    expect(screen.getByRole('heading', {name: 'Personal repositories'})).toBeInTheDocument()
    expect(await screen.findByText('sean/reviewarc')).toBeInTheDocument()
    expect(screen.queryByText('acme/api')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', {name: 'Show repositories from acme'}))
    expect(screen.getByRole('heading', {name: 'acme repositories'})).toBeInTheDocument()
    expect(await screen.findByText('acme/api')).toBeInTheDocument()
    expect(screen.queryByText('acme/archive')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', {name: 'Include all repositories from acme'}))
    expect(screen.getByText('1 source included')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', {name: /acme\/api/i})).toBeChecked()
    expect(screen.getByRole('checkbox', {name: /acme\/api/i})).toBeDisabled()
    expect(screen.getAllByText('Included through acme')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', {name: 'Save sources'}))
    await waitFor(() => expect(saveSelections).toHaveBeenCalledWith([{kind: 'organization', key: 'acme', enabled: true}]))
	expect(onDone).toHaveBeenCalled()
  })

  it('removes a selected repository when GitHub reports that it was archived', async () => {
	const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'repository', key: 'acme/old', enabled: true}], inbox: []}
	window.go = {main: {App: {
	  ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [{ref: {host: 'github.com', owner: 'acme', name: 'old', cloneUrl: '', databaseId: '1'}, description: '', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'}], selections: state.selections}),
	  RefreshSourceAccess: vi.fn().mockResolvedValue([]),
	  RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: ['acme/old'], errors: {}}),
	}}}
	render(<SourceSelector state={state} onDone={vi.fn()}/>)
	expect(screen.getByText('1 source included')).toBeInTheDocument()
	await waitFor(() => expect(screen.getByText('0 sources included')).toBeInTheDocument())
	expect(screen.queryByText('acme/old')).not.toBeInTheDocument()
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
    const onReview = vi.fn()
    window.go = {main: {App: {StartAnalysis: start, GetSession: getSession}}}
    window.runtime = {EventsOn: vi.fn((name: string, handler: (value: unknown) => void) => { handlers[name] = handler; return () => {} })}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={onSession} onReview={onReview}/>)
    fireEvent.click(screen.getByRole('button', {name: /Existing chapter/}))
    expect(onReview).toHaveBeenCalledWith('chapter-1')
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
  const renderedDiffRoot = async () => {
	await waitFor(() => expect(document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')).toBeTruthy())
	return document.querySelector('diffs-container')!.shadowRoot!
  }

  it('navigates validated evidence and targets both diff sides', async () => {
	const onCommentRange = vi.fn()
	render(<DiffView diff={{file: {path: 'src/greet.ts', previousPath: '', status: 'modified', additions: 1, deletions: 1, isBinary: false}, patch: 'diff --git a/src/greet.ts b/src/greet.ts\n--- a/src/greet.ts\n+++ b/src/greet.ts\n@@ -4 +4 @@\n-old\n+new\n', hunks: [{header: '@@ -4 +4 @@', oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: [{kind: 'delete', content: 'old', oldLine: 4}, {kind: 'add', content: 'new', newLine: 4}]}]}} focus={{id: 'evidence', path: 'src/greet.ts', revision: 'head', startLine: 4, endLine: 4, validationStatus: 'valid'}} onCommentRange={onCommentRange}/>)
	const root = await renderedDiffRoot()
	const lineNumbers = [...root.querySelectorAll<HTMLElement>('[data-column-number="4"]')]
	expect(root.querySelector('[data-selected-line]')).toBeTruthy()
	expect(lineNumbers).toHaveLength(2)
	fireEvent.click(lineNumbers[0])
	fireEvent.click(lineNumbers[1])
	expect(onCommentRange).toHaveBeenNthCalledWith(1, {startLine: 4, startSide: 'LEFT', endLine: 4, endSide: 'LEFT'})
	expect(onCommentRange).toHaveBeenNthCalledWith(2, {startLine: 4, startSide: 'RIGHT', endLine: 4, endSide: 'RIGHT'})
  })

  it('renders GitHub review threads inline and opens them with the Wails browser bridge', async () => {
	const openURL = vi.fn()
	const onReply = vi.fn().mockResolvedValue(true)
	window.runtime = {BrowserOpenURL: openURL}
	const baseComment = {reviewId: 10, author: {login: 'alice', name: 'Alice', avatarUrl: ''}, path: 'src/greet.ts', startLine: 3, line: 4, startSide: 'RIGHT' as const, side: 'RIGHT' as const, commitSha: 'head', createdAt: '2026-07-12T12:00:00Z', updatedAt: '2026-07-12T12:00:00Z'}
	const comments = [
	  {...baseComment, id: 101, body: 'Root concern', url: 'https://github.com/acme/api/pull/1#discussion_r101'},
	  {...baseComment, id: 102, replyToId: 101, body: 'Reply detail', url: 'https://github.com/acme/api/pull/1#discussion_r102'},
	  {...baseComment, id: 103, line: undefined, originalLine: 4, body: 'Outdated concern', url: 'https://github.com/acme/api/pull/1#discussion_r103'},
	  {...baseComment, id: 105, author: {login: 'carol', name: 'Carol', avatarUrl: ''}, startLine: undefined, line: 5, body: 'Second root', url: 'https://github.com/acme/api/pull/1#discussion_r105'},
	]
	const diff = {file: {path: 'src/greet.ts', previousPath: '', status: 'modified' as const, additions: 2, deletions: 0, isBinary: false}, patch: 'diff --git a/src/greet.ts b/src/greet.ts\n--- a/src/greet.ts\n+++ b/src/greet.ts\n@@ -3,0 +4,2 @@\n+new\n+next\n', hunks: [{header: '@@ -3,0 +4,2 @@', oldStart: 3, oldLines: 0, newStart: 4, newLines: 2, lines: [{kind: 'add' as const, content: 'new', newLine: 4}, {kind: 'add' as const, content: 'next', newLine: 5}]}]}
	const view = render(<DiffView diff={diff} comments={comments} onCommentRange={vi.fn()} onReply={onReply}/>)
	expect(await screen.findByText('Root concern')).toBeInTheDocument()
	expect(screen.getByText('Reply detail')).toBeInTheDocument()
	expect(screen.getByText('2 messages')).toBeInTheDocument()
	expect(screen.getByText('New lines 3–4')).toBeInTheDocument()
	expect(screen.queryByText('Outdated concern')).not.toBeInTheDocument()
	fireEvent.click(screen.getAllByRole('button', {name: 'Open thread'})[0])
	expect(openURL).toHaveBeenCalledWith('https://github.com/acme/api/pull/1#discussion_r101')
	fireEvent.click(screen.getAllByRole('button', {name: 'Reply'})[0])
	const composer = screen.getByRole('textbox', {name: 'Reply to @alice'})
	fireEvent.change(composer, {target: {value: 'A focused follow-up'}})
	fireEvent.click(screen.getAllByRole('button', {name: 'Reply'})[1])
	fireEvent.change(screen.getByRole('textbox', {name: 'Reply to @carol'}), {target: {value: 'Keep this other draft'}})
	const remoteReply = {...baseComment, id: 104, replyToId: 101, body: 'Remote reply', url: 'https://github.com/acme/api/pull/1#discussion_r104'}
	view.rerender(<DiffView diff={diff} comments={[...comments, remoteReply]} onCommentRange={vi.fn()} onReply={onReply}/>)
	expect(screen.getByRole('textbox', {name: 'Reply to @alice'})).toHaveValue('A focused follow-up')
	fireEvent.click(screen.getAllByRole('button', {name: 'Review reply'})[0])
	await waitFor(() => expect(onReply).toHaveBeenCalledWith(expect.objectContaining({id: 101}), 'A focused follow-up'))
	view.rerender(<DiffView diff={diff} comments={[...comments, remoteReply]} onCommentRange={vi.fn()} onReply={onReply} replyReset={{rootId: 101, version: 1}}/>)
	expect(screen.queryByRole('textbox', {name: 'Reply to @alice'})).not.toBeInTheDocument()
	expect(screen.getByRole('textbox', {name: 'Reply to @carol'})).toHaveValue('Keep this other draft')
  })

  it('selects a multi-line range for an inline comment', async () => {
	const onCommentRange = vi.fn()
	render(<SplitDiffView diff={{file: {path: 'src/greet.ts', previousPath: '', status: 'modified', additions: 1, deletions: 1, isBinary: false}, patch: 'diff --git a/src/greet.ts b/src/greet.ts\n--- a/src/greet.ts\n+++ b/src/greet.ts\n@@ -4,3 +4,3 @@\n same\n-old\n+new\n last\n', hunks: [{header: '@@ -4,3 +4,3 @@', oldStart: 4, oldLines: 3, newStart: 4, newLines: 3, lines: [{kind: 'context', content: 'same', oldLine: 4, newLine: 4}, {kind: 'delete', content: 'old', oldLine: 5}, {kind: 'add', content: 'new', newLine: 5}, {kind: 'context', content: 'last', oldLine: 6, newLine: 6}]}]}} onCommentRange={onCommentRange}/>)
	const root = await renderedDiffRoot()
	const rightLine = (line: number) => [...root.querySelectorAll<HTMLElement>(`[data-column-number="${line}"]`)].find((item) => item.closest('[data-additions]'))!
	const originalElementFromPoint = document.elementFromPoint
	document.elementFromPoint = vi.fn().mockReturnValue(rightLine(6))
	fireEvent.pointerDown(rightLine(4), {pointerType: 'mouse', button: 0, pointerId: 1})
	fireEvent.pointerMove(document, {pointerType: 'mouse', button: 0, pointerId: 1, clientX: 1, clientY: 1})
	await waitFor(() => expect(root.querySelectorAll('[data-selected-line]').length).toBeGreaterThan(2))
	fireEvent.pointerUp(document, {pointerType: 'mouse', button: 0, pointerId: 1, clientX: 1, clientY: 1})
	document.elementFromPoint = originalElementFromPoint
	expect(onCommentRange).toHaveBeenLastCalledWith({startLine: 4, startSide: 'RIGHT', endLine: 6, endSide: 'RIGHT'})
  })

  it('shows evidence outside diff hunks in full-file context', async () => {
	const onCommentRange = vi.fn()
	render(<FileContextView file={{path: 'src/greet.ts', revision: 'base', sha: 'base', content: 'one\ntwo\nthree\n', isBinary: false, lineCount: 3}} focus={{id: 'outside-hunk', path: 'src/greet.ts', revision: 'base', startLine: 2, endLine: 2, validationStatus: 'valid'}} onCommentRange={onCommentRange}/>)
	const root = await renderedDiffRoot()
	expect(root.querySelector('[data-line="2"]')).toHaveTextContent('two')
	fireEvent.click(root.querySelector<HTMLElement>('[data-column-number="2"]')!)
	expect(onCommentRange).toHaveBeenCalledWith({startLine: 2, startSide: 'LEFT', endLine: 2, endSide: 'LEFT'})
  })

  it('does not reuse full-file contents between paths at the same revision', async () => {
	const focus = {id: 'line', path: 'src/first.ts', revision: 'head' as const, startLine: 1, endLine: 1, validationStatus: 'valid' as const}
	const {rerender} = render(<FileContextView file={{path: 'src/first.ts', revision: 'head', sha: 'shared-head', content: 'first file\n', isBinary: false, lineCount: 1}} focus={focus} onCommentRange={vi.fn()}/>)
	let root = await renderedDiffRoot()
	expect(root.querySelector('[data-line="1"]')).toHaveTextContent('first file')
	rerender(<FileContextView file={{path: 'src/second.ts', revision: 'head', sha: 'shared-head', content: 'second file\n', isBinary: false, lineCount: 1}} focus={{...focus, path: 'src/second.ts'}} onCommentRange={vi.fn()}/>)
	await waitFor(() => {
	  root = document.querySelector('diffs-container')!.shadowRoot!
	  expect(root.querySelector('[data-line="1"]')).toHaveTextContent('second file')
	})
  })

  it('ignores stale evidence file responses after a newer selection', async () => {
	const evidence = (id: string, path: string) => ({id, path, revision: 'head' as const, startLine: 1, endLine: 1, validationStatus: 'valid' as const})
	const firstEvidence = evidence('first', 'src/first.ts')
	const secondEvidence = evidence('second', 'src/second.ts')
	const session: ReviewSession = {
	  id: 'review-session', baseSha: 'base', headSha: 'head', status: 'ready', analysisStatus: 'ready', isStale: false,
	  createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z', notes: [], comments: [], chapters: [{chapterId: 'chapter', status: 'notReviewed', updatedAt: '2026-07-12T00:00:00Z'}], progress: {total: 1, reviewed: 0, blocked: 0, clarify: 0, percent: 0},
	  pullRequest: {ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, number: 1}, title: 'Evidence race', url: '', author: {login: 'sean', name: 'Sean', avatarUrl: ''}, updatedAt: '2026-07-12T00:00:00Z', isDraft: false, additions: 2, deletions: 0, changedFiles: 2, relationships: ['authored'], labels: [], analysisStatus: 'ready', progress: {total: 1, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, riskLevel: 'low', body: '', baseRef: 'main', headRef: 'feature', baseSha: 'base', headSha: 'head', headRepository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, commits: [], requestedReviewers: [], assignees: [], reviews: [], reviewComments: [], checkRuns: [], reviewState: ''},
	  analysis: {schemaVersion: 1, baseSha: 'base', headSha: 'head', summary: 'Summary', summaryEvidence: [], summaryValidation: 'valid', affectedAreas: [], behavioralChanges: [], risks: [], facts: [], inferences: [], unknowns: [], createdAt: '2026-07-12T00:00:00Z', validationIssues: [], chapters: [{id: 'chapter', order: 1, title: 'Evidence', description: 'Inspect evidence', purpose: 'Inspect both files', status: 'notReviewed', evidence: [], files: [{path: 'src/first.ts', description: 'First file'}, {path: 'src/second.ts', description: 'Second file'}], symbols: Array.from({length: 7}, (_, index) => ({path: 'src/first.ts', name: `Symbol ${index + 1}`, evidence: [firstEvidence]})), behavioralChanges: [], risks: [], facts: [{id: 'fact-first', kind: 'fact', text: 'First fact', validationStatus: 'valid', evidence: [firstEvidence]}, {id: 'fact-second', kind: 'fact', text: 'Second fact', validationStatus: 'valid', evidence: [secondEvidence]}], inferences: [], unknowns: [], relatedTests: [], suggestedQuestions: []}]},
	}
	let resolveFirst!: (value: unknown) => void
	let resolveSecond!: (value: unknown) => void
	let resolveFirstDiff!: (value: unknown) => void
	let resolveSecondDiff!: (value: unknown) => void
	const first = new Promise((resolve) => { resolveFirst = resolve })
	const second = new Promise((resolve) => { resolveSecond = resolve })
	const firstDiff = new Promise((resolve) => { resolveFirstDiff = resolve })
	const secondDiff = new Promise((resolve) => { resolveSecondDiff = resolve })
	window.go = {main: {App: {
	  GetChangedFiles: vi.fn().mockResolvedValue([
	    {path: 'src/first.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false},
	    {path: 'src/second.ts', previousPath: '', status: 'modified', additions: 0, deletions: 0, isBinary: true},
	  ]),
	  GetDiff: vi.fn((...args: unknown[]) => args[1] === 'src/first.ts' ? firstDiff : secondDiff),
	  GetFile: vi.fn((...args: unknown[]) => args[1] === 'src/first.ts' ? first : second),
	}}}
	render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)
	expect(screen.getByRole('combobox', {name: 'Chapter progress'})).toHaveTextContent('Not reviewed')
	expect(screen.getByText('Saved privately')).toBeInTheDocument()
	fireEvent.click(screen.getByRole('button', {name: 'Show 1 more'}))
	expect(screen.getByRole('button', {name: 'Symbol 7'})).toBeInTheDocument()
	await waitFor(() => expect(document.querySelector('.file-section span[title="src/second.ts"]')).toBeTruthy())
	const secondFileButton = document.querySelector('.file-section span[title="src/second.ts"]')!.closest('button')!
	fireEvent.click(screen.getByRole('button', {name: /src\/first\.tsL1/}))
	fireEvent.click(screen.getByRole('button', {name: /src\/second\.tsL1/}))
	resolveSecond({path: 'src/second.ts', revision: 'head', sha: 'head', content: 'second file wins\n', isBinary: false, lineCount: 1})
	await waitFor(() => expect(document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="1"]')).toHaveTextContent('second file wins'))
	resolveFirst({path: 'src/first.ts', revision: 'head', sha: 'head', content: 'stale first file\n', isBinary: false, lineCount: 1})
	await Promise.resolve()
	expect(document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="1"]')).toHaveTextContent('second file wins')
	resolveSecondDiff({file: {path: 'src/second.ts', previousPath: '', status: 'modified', additions: 0, deletions: 0, isBinary: true}, patch: '', hunks: []})
	resolveFirstDiff({file: {path: 'src/first.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}, patch: 'diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -0,0 +1 @@\n+stale\n', hunks: []})
	fireEvent.click(secondFileButton)
	expect(await screen.findByRole('heading', {name: 'Binary file'})).toBeInTheDocument()
  })

  it('renders split diffs with comment targets on both revisions', async () => {
	const onCommentRange = vi.fn()
	render(<SplitDiffView diff={{file: {path: 'src/greet.ts', previousPath: '', status: 'modified', additions: 1, deletions: 1, isBinary: false}, patch: 'diff --git a/src/greet.ts b/src/greet.ts\n--- a/src/greet.ts\n+++ b/src/greet.ts\n@@ -4 +4 @@\n-old\n+new\n', hunks: [{header: '@@ -4 +4 @@', oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: [{kind: 'delete', content: 'old', oldLine: 4}, {kind: 'add', content: 'new', newLine: 4}]}]}} onCommentRange={onCommentRange}/>)
	const root = await renderedDiffRoot()
	const lineNumbers = [...root.querySelectorAll<HTMLElement>('[data-column-number="4"]')]
	expect(lineNumbers).toHaveLength(2)
	fireEvent.click(lineNumbers[0])
	fireEvent.click(lineNumbers[1])
    expect(onCommentRange).toHaveBeenNthCalledWith(1, {startLine: 4, startSide: 'LEFT', endLine: 4, endSide: 'LEFT'})
    expect(onCommentRange).toHaveBeenNthCalledWith(2, {startLine: 4, startSide: 'RIGHT', endLine: 4, endSide: 'RIGHT'})
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
