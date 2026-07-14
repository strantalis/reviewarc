import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, DiffView, FileContextView, OverviewScreen, ReviewWorkspace, SettingsScreen, SourceSelector, SplitDiffView } from './App'
import { Markdown, WindowControls } from './components'
import type { BootstrapState, EnvironmentState, RepositoryPage, ReviewSession, SoftwareUpdateStatus } from './types'

const paths = {root: '/tmp/reviewarc', repositories: '/tmp/reviewarc/repos', worktrees: '/tmp/reviewarc/worktrees', database: '/tmp/reviewarc/db.sqlite', logs: '/tmp/reviewarc/logs', cache: '/tmp/reviewarc/cache'}
const idleUpdate: SoftwareUpdateStatus = {currentVersion: '0.1.0', currentBuild: '7', state: 'idle', channel: 'stable'}

function reviewSession(): ReviewSession {
  const evidence = {id: 'evidence-1', path: 'src/limiter.ts', revision: 'head' as const, startLine: 10, endLine: 13, validationStatus: 'valid' as const}
  return {
    id: 'review-session', baseSha: 'base', headSha: 'head', status: 'ready', analysisStatus: 'ready', isStale: false,
    createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z',
    notes: [{id: 'note-1', sessionId: 'review-session', chapterId: 'chapter-1', body: 'Private note', createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z'}],
    comments: [{id: 'draft-1', sessionId: 'review-session', chapterId: 'chapter-1', kind: 'general', body: 'Draft question', status: 'draft', createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z'}],
    chapters: [{chapterId: 'chapter-1', status: 'inProgress', updatedAt: '2026-07-12T00:00:00Z'}], progress: {total: 1, reviewed: 0, blocked: 0, clarify: 0, percent: 0},
    pullRequest: {ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, number: 1}, title: 'Record quota decisions', url: 'https://github.com/acme/api/pull/1', author: {login: 'sean', name: 'Sean', avatarUrl: ''}, updatedAt: '2026-07-12T00:00:00Z', isDraft: false, additions: 36, deletions: 6, changedFiles: 1, relationships: ['authored'], labels: ['audit'], analysisStatus: 'ready', progress: {total: 1, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, riskLevel: 'high', body: '## Motivation\nIntroduce audit recording.\n\nA long implementation appendix that belongs in author context.', baseRef: 'main', headRef: 'feature/audit', baseSha: 'base', headSha: 'head', headRepository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, commits: [], requestedReviewers: [], assignees: [], reviews: [], reviewComments: [], checkRuns: [], reviewState: ''},
    analysis: {schemaVersion: 1, baseSha: 'base', headSha: 'head', summary: 'Adds an optional quota-decision recorder and emits decisions from the limiter.', summaryEvidence: [evidence], summaryValidation: 'valid', affectedAreas: [{name: 'Quota decisions', description: 'Changes the decision path.', evidence: [evidence]}], behavioralChanges: [], risks: [{id: 'risk-1', title: 'Callback runs while locked', description: 'A slow or reentrant recorder can block callers.', level: 'high', evidence: [evidence]}], facts: [], inferences: [], unknowns: [{id: 'unknown-1', kind: 'unknown', text: 'Whether reentrant recorders are supported is unspecified.', evidence: [evidence], validationStatus: 'valid'}], createdAt: '2026-07-12T00:00:00Z', validationIssues: [], chapters: [{id: 'chapter-1', order: 1, title: 'Decision recording', description: 'Follow the recorder from configuration to emission.', purpose: 'Understand when callbacks run and what state they observe.', status: 'inProgress', evidence: [evidence], files: [{path: 'src/limiter.ts', description: 'Limiter implementation'}], symbols: [{path: 'src/limiter.ts', name: 'Limiter.record', evidence: [evidence]}], behavioralChanges: [{id: 'change-1', summary: 'Decisions are now observable.', before: 'Allow returned a result without retaining an event.', after: 'Allow sends the result to an optional recorder.', evidence: [evidence]}], risks: [{id: 'risk-1', title: 'Callback runs while locked', description: 'A slow or reentrant recorder can block callers.', level: 'high', evidence: [evidence]}], facts: [{id: 'fact-1', kind: 'fact', text: 'The recorder receives allowed and rejected decisions.', evidence: [evidence], validationStatus: 'valid'}], inferences: [{id: 'inference-1', kind: 'inference', text: 'Configuration is expected before concurrent use.', evidence: [evidence], validationStatus: 'valid'}], unknowns: [{id: 'unknown-1', kind: 'unknown', text: 'Whether reentrant recorders are supported is unspecified.', evidence: [evidence], validationStatus: 'valid'}], relatedTests: [{id: 'test-1', path: 'src/limiter.test.ts', description: 'Covers one allowed and one rejected decision.', evidence: [evidence], relationship: 'valid'}], suggestedQuestions: [{id: 'question-1', text: 'Should Recorder run after releasing the lock?', rationale: 'The callback is application-controlled.', evidence: [evidence]}]}]},
  }
}

function installBackend(state: BootstrapState) {
	const bootstrapState = {...state, account: state.account ?? {login: 'sean', name: 'Sean', avatarUrl: ''}}
  const environment: EnvironmentState = {dependencies: bootstrapState.dependencies, account: bootstrapState.account, gitProtocol: bootstrapState.gitProtocol ?? 'https', refreshedAt: '2026-07-14T12:00:00Z'}
  window.go = {main: {App: {
    Bootstrap: vi.fn().mockResolvedValue(bootstrapState),
    RefreshEnvironment: vi.fn().mockResolvedValue(environment),
    GetUpdateStatus: vi.fn().mockResolvedValue(idleUpdate),
    CheckForUpdates: vi.fn().mockResolvedValue({...idleUpdate, state: 'checking'}),
    InstallUpdate: vi.fn().mockResolvedValue(undefined),
    RefreshAccount: vi.fn(),
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
    const ready: BootstrapState = {...missing, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}]}
    installBackend(missing)
    window.go!.main!.App!.RefreshEnvironment = vi.fn().mockResolvedValue({dependencies: ready.dependencies, account: ready.account, gitProtocol: 'https', refreshedAt: '2026-07-14T12:00:00Z'})
    render(<App/>)
    fireEvent.click(await screen.findByRole('button', {name: 'Check again'}))
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    expect(window.go?.main?.App?.Bootstrap).toHaveBeenCalledOnce()
    expect(window.go?.main?.App?.RefreshEnvironment).toHaveBeenCalledOnce()
  })

  it('renders a warm cached gate immediately and repairs it in the background', async () => {
    const cached: BootstrapState = {environmentCached: true, dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'missing'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []}
    installBackend(cached)
    let finishRefresh!: (state: EnvironmentState) => void
    window.go!.main!.App!.RefreshEnvironment = vi.fn(() => new Promise((resolve) => { finishRefresh = resolve }))
    render(<App/>)
    expect(await screen.findByText('Connect your review workspace')).toBeInTheDocument()
    finishRefresh({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], account: {login: 'sean', name: 'Sean', avatarUrl: ''}, gitProtocol: 'ssh', refreshedAt: '2026-07-14T12:00:00Z'})
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    expect(window.go?.main?.App?.Bootstrap).toHaveBeenCalledOnce()
    expect(window.go?.main?.App?.RefreshEnvironment).toHaveBeenCalledOnce()
  })

  it('opens the real-data inbox for an authenticated configured account', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []})
    render(<App/>)
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    await waitFor(() => expect(window.go?.main?.App?.RefreshInbox).toHaveBeenCalled())
	expect(window.go?.main?.App?.RefreshAccount).not.toHaveBeenCalled()
	expect(window.go?.main?.App?.RefreshEnvironment).not.toHaveBeenCalled()
	expect(screen.getByText('Your review queue is clear')).toBeInTheDocument()
  })

  it('opens Settings and checks from the native application menu event', async () => {
    const handlers: Record<string, (value: unknown) => void> = {}
    const state: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []}
    installBackend(state)
    window.runtime = {EventsOn: vi.fn((name: string, handler: (value: unknown) => void) => { handlers[name] = handler; return () => {} })}
    render(<App/>)
    expect(await screen.findByText('Pull request inbox')).toBeInTheDocument()
    handlers['reviewarc:check-for-updates:v1'](undefined)
    expect(await screen.findByRole('heading', {name: 'Settings'})).toBeInTheDocument()
    await waitFor(() => expect(window.go?.main?.App?.CheckForUpdates).toHaveBeenCalledOnce())
  })

  it('uses the authenticated account control as the Settings entry point', async () => {
    const state: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []}
    installBackend(state)
    render(<App/>)

    const accountControl = await screen.findByRole('button', {name: 'Open settings for Sean (@sean)'})
    expect(screen.queryByRole('button', {name: 'Settings'})).not.toBeInTheDocument()
    fireEvent.click(accountControl)

    expect(await screen.findByRole('heading', {name: 'Settings'})).toBeInTheDocument()
    expect(accountControl).toHaveAttribute('aria-current', 'page')
  })

  it('presents the inbox result count as passive status text', async () => {
    const pullRequest = reviewSession().pullRequest
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pullRequest]})
    render(<App/>)

    const resultCount = await screen.findByRole('status', {name: 'Inbox result count'})
    expect(resultCount).toHaveTextContent('Showing 1 open pull request')
    expect(resultCount.closest('button')).toBeNull()
    expect(resultCount.querySelector('svg')).toBeNull()
  })

  it('asks before installing and explains possible macOS authorization', async () => {
    const state: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []}
    const available: SoftwareUpdateStatus = {currentVersion: '0.1.0-beta.6', currentBuild: '6', state: 'available', channel: 'beta', release: {version: '0.1.0-beta.7', build: '7'}}
    installBackend(state)
    window.go!.main!.App!.GetUpdateStatus = vi.fn().mockResolvedValue(available)
    render(<App/>)
    fireEvent.click(await screen.findByRole('button', {name: 'Install update…'}))
    expect(screen.getByRole('dialog', {name: 'Install ReviewArc 0.1.0-beta.7?'})).toBeInTheDocument()
    expect(screen.getByText(/administrator username and password/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}))
    expect(window.go?.main?.App?.InstallUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Install update…'}))
    fireEvent.click(screen.getByRole('button', {name: 'Install update'}))
    await waitFor(() => expect(window.go?.main?.App?.InstallUpdate).toHaveBeenCalledOnce())
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
    const search = screen.getByPlaceholderText('Search title, repository, author, PR number, or label')
    fireEvent.change(search, {target: {value: 'Security'}})
    const walkthroughReady = screen.getByRole('button', {name: 'Walkthrough ready'})
    fireEvent.click(walkthroughReady)
    const allOpen = screen.getByRole('button', {name: 'All open'})
    expect(allOpen).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(allOpen)
    expect(search).toHaveValue('')
    expect(select).toHaveTextContent('All labels')
    expect(walkthroughReady).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Security change')).toBeInTheDocument()
    expect(screen.getByText('Documentation change')).toBeInTheDocument()
    expect(allOpen).toHaveAttribute('aria-pressed', 'true')
  })

  it('bounds mounted inbox rows while filtering the complete result set', async () => {
    const inbox = Array.from({length: 250}, (_, index) => ({
      ref: {repository: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, number: index + 1},
      title: `Performance change ${index + 1}`,
      url: '',
      author: {login: 'sean', name: '', avatarUrl: ''},
      updatedAt: '2026-07-12T00:00:00Z',
      isDraft: false,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      relationships: ['selectedRepo' as const],
      labels: [],
      analysisStatus: 'notStarted' as const,
      progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0},
      riskLevel: 'unknown' as const,
    }))
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox})
    const {container} = render(<App/>)

    expect(await screen.findByText('Performance change 1')).toBeInTheDocument()
    expect(screen.getByText('250', {selector: '.inbox-summary strong'})).toBeInTheDocument()
    expect(container.querySelectorAll('.pr-row')).toHaveLength(100)
    expect(screen.queryByText('Performance change 101')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Show 100 more pull requests'}))
    expect(container.querySelectorAll('.pr-row')).toHaveLength(200)
    expect(screen.getByText('Performance change 200')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Show 50 more pull requests'}))
    expect(container.querySelectorAll('.pr-row')).toHaveLength(250)
    expect(screen.queryByRole('button', {name: /more pull requests/})).not.toBeInTheDocument()

    const search = screen.getByPlaceholderText('Search title, repository, author, PR number, or label')
    fireEvent.change(search, {target: {value: 'Performance change 250'}})
    expect(container.querySelectorAll('.pr-row')).toHaveLength(1)
    expect(screen.getByText('Performance change 250')).toBeInTheDocument()
    fireEvent.change(search, {target: {value: ''}})
    expect(container.querySelectorAll('.pr-row')).toHaveLength(100)
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

  it('renders the core session before lazy discussion and checks finish', async () => {
	const core = reviewSession()
	const pr = {...core.pullRequest, analysisStatus: core.analysisStatus, progress: core.progress}
	const state: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pr]}
	installBackend(state)
	let resolveContext!: (value: ReviewSession) => void
	const context = new Promise<ReviewSession>((resolve) => { resolveContext = resolve })
	window.go!.main!.App!.OpenPullRequest = vi.fn().mockResolvedValue(core)
	window.go!.main!.App!.RefreshPullRequestContext = vi.fn(() => context)
	window.runtime = {EventsOn: vi.fn(() => () => {})}
	render(<App/>)

	fireEvent.click((await screen.findByText(core.pullRequest.title)).closest('button')!)
	expect(await screen.findByText(core.analysis!.summary)).toBeInTheDocument()
	expect(screen.queryByText('Loading pull request context…')).not.toBeInTheDocument()
	expect(window.go?.main?.App?.RefreshPullRequestContext).toHaveBeenCalledWith(core.id)

	resolveContext({...core, pullRequest: {...core.pullRequest, reviews: [{id: 11, author: {login: 'alice', name: '', avatarUrl: ''}, state: 'COMMENTED', body: 'Please cover the retry path.', commitSha: 'head', submittedAt: '2026-07-12T01:00:00Z', url: ''}]}})
	expect(await screen.findByText('Existing discussion')).toBeInTheDocument()
  })

  it('keeps the core session usable when lazy context exceeds its output limit', async () => {
	const core = reviewSession()
	const pr = {...core.pullRequest, analysisStatus: core.analysisStatus, progress: core.progress}
	installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pr]})
	window.go!.main!.App!.OpenPullRequest = vi.fn().mockResolvedValue(core)
	window.go!.main!.App!.RefreshPullRequestContext = vi.fn().mockRejectedValue(new Error('gh stdout exceeded the 16777216-byte output limit'))
	window.runtime = {EventsOn: vi.fn(() => () => {})}
	render(<App/>)

	fireEvent.click((await screen.findByText(core.pullRequest.title)).closest('button')!)
	expect(await screen.findByText(core.analysis!.summary)).toBeInTheDocument()
	expect(await screen.findByText(/Pull request opened, but GitHub discussion and checks could not be loaded/)).toBeInTheDocument()
	expect(screen.getByRole('heading', {name: new RegExp(core.pullRequest.title)})).toBeInTheDocument()
  })

  it('ignores a lazy context response after navigating to another pull request', async () => {
	const first = reviewSession()
	first.id = 'first-session'
	first.pullRequest = {...first.pullRequest, ref: {...first.pullRequest.ref, number: 7}, title: 'First change'}
	const second = reviewSession()
	second.id = 'second-session'
	second.pullRequest = {...second.pullRequest, ref: {...second.pullRequest.ref, number: 8}, title: 'Second change'}
	const summaries = [first, second].map((item) => ({...item.pullRequest, analysisStatus: item.analysisStatus, progress: item.progress}))
	installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: summaries})
	let resolveFirst!: (value: ReviewSession) => void
	const firstContext = new Promise<ReviewSession>((resolve) => { resolveFirst = resolve })
	window.go!.main!.App!.OpenPullRequest = vi.fn((ref: unknown) => Promise.resolve((ref as {number: number}).number === 7 ? first : second))
	window.go!.main!.App!.RefreshPullRequestContext = vi.fn((id: unknown) => id === first.id ? firstContext : new Promise(() => {}))
	window.runtime = {EventsOn: vi.fn(() => () => {})}
	render(<App/>)

	fireEvent.click((await screen.findByText('First change')).closest('button')!)
	await waitFor(() => expect(window.go?.main?.App?.RefreshPullRequestContext).toHaveBeenCalledWith(first.id))
	expect(screen.getByRole('heading', {name: /First change/})).toBeInTheDocument()
	fireEvent.click(screen.getAllByRole('button', {name: 'Inbox'})[0])
	fireEvent.click((await screen.findByText('Second change')).closest('button')!)
	await waitFor(() => expect(window.go?.main?.App?.RefreshPullRequestContext).toHaveBeenCalledWith(second.id))
	expect(screen.getByRole('heading', {name: /Second change/})).toBeInTheDocument()

	resolveFirst({...first, pullRequest: {...first.pullRequest, title: 'Stale first response'}})
	await waitFor(() => expect(screen.getByRole('heading', {name: /Second change/})).toBeInTheDocument())
	expect(screen.queryByText('Stale first response')).not.toBeInTheDocument()
  })
})

describe('Settings', () => {
  it('shows the authenticated account and effective SSH protocol used for managed Git operations', () => {
    render(<SettingsScreen state={{dependencies: [{name: 'git', state: 'available', path: '/usr/bin/git'}, {name: 'gh', state: 'available', path: '/opt/homebrew/bin/gh'}, {name: 'codex', state: 'available', path: '/Users/sean/.local/bin/codex'}], paths, account: {login: 'strantalis', name: 'Sean', avatarUrl: ''}, gitProtocol: 'ssh', selections: [], inbox: []}} onSources={vi.fn()}/>)
    expect(screen.getByText('Authenticated as @strantalis')).toBeInTheDocument()
    expect(screen.getByText('Git operations: SSH')).toBeInTheDocument()
    expect(screen.getByText(/follow your/)).toHaveTextContent('Managed repository fetches follow your gh protocol setting.')
    expect(screen.getByTitle('/opt/homebrew/bin/gh')).toHaveTextContent('/opt/homebrew/bin/gh')
    expect(screen.getByText('Analysis worktrees')).toBeInTheDocument()
    expect(screen.getByText(paths.worktrees)).toBeInTheDocument()
    expect(screen.getByText('Temporary cache')).toBeInTheDocument()
    expect(screen.getByText(paths.cache)).toBeInTheDocument()
    expect(screen.getByText(/PR analysis uses the repository cache/)).toHaveTextContent('ReviewArc also invokes your installed git, gh, and codex tools, which may read their own configuration and credentials.')
    expect(screen.queryByText(/operates only in these managed locations/)).not.toBeInTheDocument()
  })

  it('locks the release channel while an update is ready and surfaces restart', () => {
    const onSetChannel = vi.fn()
    const onInstall = vi.fn()
    const openURL = vi.fn()
    window.runtime = {BrowserOpenURL: openURL}
    const update: SoftwareUpdateStatus = {currentVersion: '0.2.0-beta.3', currentBuild: '42', state: 'ready', channel: 'beta', release: {version: '0.2.0-beta.4', build: '45', releaseNotesUrl: 'https://www.reviewarc.dev/releases/v0.2.0-beta.4'}}
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} update={update} onSetUpdateChannel={onSetChannel} onInstallUpdate={onInstall} onSources={vi.fn()}/>)
    expect(screen.getByText('v0.2.0-beta.3 · build 42')).toBeInTheDocument()
    expect(screen.getByText(/Returning to Stable does not downgrade/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Stable'})).toBeDisabled()
    expect(onSetChannel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Release notes'}))
    expect(openURL).toHaveBeenCalledWith('https://www.reviewarc.dev/releases/v0.2.0-beta.4')
    fireEvent.click(screen.getByRole('button', {name: 'Install and restart…'}))
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('offers an explicit install action before an available update downloads', () => {
    const onInstall = vi.fn()
    const update: SoftwareUpdateStatus = {currentVersion: '0.2.0-beta.3', currentBuild: '42', state: 'available', channel: 'beta', release: {version: '0.2.0-beta.4', build: '45'}}
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} update={update} onInstallUpdate={onInstall} onSources={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Install update…'}))
    expect(onInstall).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', {name: 'Stable'})).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', {name: 'Remove sean/reviewarc repository from included sources'}))
    expect(screen.queryByText('sean/reviewarc')).not.toBeInTheDocument()
    expect(screen.getByText('1 source included')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Remove acme organization from included sources'}))
    expect(screen.getByText('0 sources included')).toBeInTheDocument()
    expect(screen.getByText('Select a repository or include an organization to build your review inbox.')).toBeInTheDocument()
    const search = screen.getByPlaceholderText('Search included repositories')
    expect(search).toHaveAttribute('autocapitalize', 'none')
    expect(search).toHaveAttribute('autocorrect', 'off')
    expect(search).toHaveAttribute('spellcheck', 'false')
  })

  it('keeps loaded included repositories removable instead of rendering selection checkboxes', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'repository', key: 'sean/reviewarc', enabled: true}], inbox: []}
    window.go = {main: {App: {ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [{ref: {host: 'github.com', owner: 'sean', name: 'reviewarc', cloneUrl: '', databaseId: '1'}, description: 'Local-first pull request review', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'}], selections: state.selections})}}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    const remove = await screen.findByRole('button', {name: 'Remove sean/reviewarc repository from included sources'})
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(remove)
    expect(screen.queryByText('sean/reviewarc')).not.toBeInTheDocument()
  })

  it('searches a large owner with one debounced server request instead of draining browse pages', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [], inbox: []}
    const repository = (name: string) => ({ref: {host: 'github.com', owner: 'sean', name, cloneUrl: '', databaseId: name}, description: '', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'})
    const first = Array.from({length: 50}, (_, index) => repository(`repo-${String(index).padStart(2, '0')}`))
    const refresh = vi.fn().mockResolvedValue({items: first, totalCount: 12000, endCursor: 'next', hasNextPage: true, cached: false})
    const search = vi.fn().mockResolvedValue({items: [repository('repo-50')], totalCount: 1, hasNextPage: false, cached: false})
    window.go = {main: {App: {
	  ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [], selections: []}),
	  RefreshSourceAccess: vi.fn().mockResolvedValue([]),
	  RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListCachedOwnerRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true}),
      RefreshOwnerRepositories: refresh,
      SearchOwnerRepositories: search,
    }}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Show personal repositories from sean'}))
    expect(await screen.findByText('Showing 50 of 12000')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search all repositories'), {target: {value: 'repo-50'}})
    expect(await screen.findByText('sean/repo-50')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith({owner: 'sean', query: 'repo-50', cursor: '', organization: false})
  })

  it('ignores stale owner search responses', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [], inbox: []}
    const repository = (name: string) => ({ref: {host: 'github.com', owner: 'sean', name, cloneUrl: '', databaseId: name}, description: '', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'})
    let resolveOld!: (page: RepositoryPage) => void
    let resolveNew!: (page: RepositoryPage) => void
    const oldResponse = new Promise<RepositoryPage>((resolve) => { resolveOld = resolve })
    const newResponse = new Promise<RepositoryPage>((resolve) => { resolveNew = resolve })
    const search = vi.fn().mockImplementation(({query}: {query: string}) => query === 'old' ? oldResponse : newResponse)
    window.go = {main: {App: {
      ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [], selections: []}),
      RefreshSourceAccess: vi.fn().mockResolvedValue([]),
      RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListCachedOwnerRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true}),
      RefreshOwnerRepositories: vi.fn().mockResolvedValue({items: [repository('browse')], totalCount: 1, hasNextPage: false, cached: false}),
      SearchOwnerRepositories: search,
    }}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Show personal repositories from sean'}))
    expect(await screen.findByText('sean/browse')).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Search all repositories')
    fireEvent.change(input, {target: {value: 'old'}})
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    fireEvent.change(input, {target: {value: 'new'}})
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    resolveNew({items: [repository('new-result')], totalCount: 1, hasNextPage: false, cached: false})
    expect(await screen.findByText('sean/new-result')).toBeInTheDocument()
    resolveOld({items: [repository('old-result')], totalCount: 1, hasNextPage: false, cached: false})
    await waitFor(() => expect(screen.queryByText('sean/old-result')).not.toBeInTheDocument())
    expect(screen.getByText('sean/new-result')).toBeInTheDocument()
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
  it('gives stale analysis one primary recovery action without hiding the old walkthrough', async () => {
    const current = reviewSession()
    const session: ReviewSession = {...current, headSha: 'old-head', isStale: true, staleReason: '', pullRequest: {...current.pullRequest, headSha: 'new-head'}}
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingSnapshot', message: 'Preparing isolated repository snapshot', state: 'running'})
    const onReview = vi.fn()
    window.go = {main: {App: {StartAnalysis: start}}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={onReview}/>)

    expect(screen.getByText('Analysis covers an older revision')).toBeInTheDocument()
    expect(screen.getByText(/old-head.*new-head/)).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Run again'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Continue stale review'}))
    expect(onReview).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze current revision'}))
    await waitFor(() => expect(start).toHaveBeenCalledWith(session.id))
  })

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

describe('Review brief and chapter reader', () => {
  it('puts the ReviewArc brief before collapsed author context', () => {
    const session = reviewSession()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    const brief = screen.getByRole('region', {name: 'Pull request review overview'})
    expect(brief).toHaveTextContent('Adds an optional quota-decision recorder')
    const areaDetails = screen.getByText('Area details').closest('details')!
    expect(areaDetails).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Area details'))
    expect(areaDetails).toHaveAttribute('open')
    expect(areaDetails).toHaveTextContent('Changes the decision path.')
    expect(brief).toHaveTextContent('Callback runs while locked')
    expect(brief).toHaveTextContent('Whether reentrant recorders are supported is unspecified')
    const disclosure = screen.getByText('Author context').closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    expect(brief.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByText('Author context'))
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByText('A long implementation appendix that belongs in author context.')).toBeInTheDocument()
  })

  it('turns the highest risk into a concrete starting chapter inside the unified brief', () => {
    const base = reviewSession()
    const originalChapter = base.analysis!.chapters[0]
    const chapterRisk = originalChapter.risks[0]
    const extraEvidence = {...chapterRisk.evidence[0], id: 'secondary-evidence', startLine: 1, endLine: 2}
    const session: ReviewSession = {...base, analysis: {...base.analysis!, risks: [{...base.analysis!.risks[0], id: 'overview-risk'}], chapters: [
      {...originalChapter, id: 'chapter-1', title: 'Recorder setup', risks: [{...chapterRisk, id: 'broad-chapter-risk', title: 'Broad lock concern', evidence: [...chapterRisk.evidence, extraEvidence]}]},
      {...originalChapter, id: 'chapter-2', order: 2, title: 'Decision path', risks: [{...chapterRisk, id: 'chapter-risk', title: 'Specific callback concern'}]},
    ]}}
    const onReview = vi.fn()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={onReview}/>)

    const brief = screen.getByRole('region', {name: 'Pull request review overview'})
    expect(brief).toHaveTextContent('#1 Record quota decisions')
    expect(brief).toHaveTextContent('Callback runs while locked')
    expect(brief).toHaveTextContent('Review path')
    fireEvent.click(screen.getByRole('button', {name: 'Start with chapter 2'}))
    expect(onReview).toHaveBeenCalledWith('chapter-2')
  })

  it('does not turn an unsupported risk into an authoritative starting chapter', () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, analysis: {...base.analysis!, risks: [{...base.analysis!.risks[0], evidence: []}], chapters: base.analysis!.chapters.map((chapter) => ({...chapter, risks: []}))}}
    const onReview = vi.fn()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={onReview}/>)

    expect(screen.getByText('Concern to verify')).toBeInTheDocument()
    expect(screen.getByText('Unverified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Open guided review'}))
    expect(onReview).toHaveBeenCalledWith()
  })

  it('opens chapters as a narrative and keeps the full diff one click away', async () => {
    const session = reviewSession()
    const getDiff = vi.fn().mockResolvedValue({file: {path: 'src/limiter.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}, patch: '', hunks: []})
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([{path: 'src/limiter.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}]),
      GetDiff: getDiff,
    }}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    const reader = screen.getByRole('region', {name: 'Chapter 1: Decision recording'})
    expect(reader).toHaveTextContent('Behavioral change')
    expect(reader).toHaveTextContent('Allow returned a result without retaining an event.')
    expect(reader).toHaveTextContent('Callback runs while locked')
    expect(reader).toHaveTextContent('Test posture')
    const chapterContext = screen.getByText('Chapter context').closest('details')!
    expect(chapterContext).not.toHaveAttribute('open')
    expect(screen.getByText('Review closely').compareDocumentPosition(screen.getByText('Behavioral change')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('1 unique reference in this chapter')).toBeInTheDocument()
    expect(screen.queryByRole('region', {name: /diff for/i})).not.toBeInTheDocument()
    expect(getDiff).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', {name: 'Chapter progress'})).toHaveTextContent('In progress')

    const fullDiff = screen.getByRole('button', {name: 'Open full diff'})
    expect(fullDiff.closest('.review-header')).toBeInTheDocument()
    expect(reader).not.toContainElement(fullDiff)
    fireEvent.click(fullDiff)
    await waitFor(() => expect(getDiff).toHaveBeenCalledWith(session.id, 'src/limiter.ts'))
    expect(await screen.findByRole('button', {name: 'Back to chapter'})).toBeInTheDocument()
    const unified = screen.getByRole('button', {name: 'Unified diff'})
    const split = screen.getByRole('button', {name: 'Split diff'})
    expect(unified).toHaveAttribute('aria-pressed', 'true')
    expect(split).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(split)
    expect(split).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', {name: 'No textual changes'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Back to chapter'}))
    expect(screen.getByRole('region', {name: 'Chapter 1: Decision recording'})).toBeInTheDocument()
    expect(screen.getByRole('combobox', {name: 'Chapter progress'})).toHaveTextContent('In progress')
  })

  it('expands validated code evidence inline before offering deeper context', async () => {
    const session = reviewSession()
    const getFile = vi.fn().mockResolvedValue({path: 'src/limiter.ts', revision: 'head', sha: 'head', content: Array.from({length: 15}, (_, index) => index === 9 ? 'const answer = 42' : `line ${index + 1}`).join('\n'), isBinary: false, lineCount: 15})
    const getDiff = vi.fn()
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([{path: 'src/limiter.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}]),
      GetDiff: getDiff,
      GetFile: getFile,
    }}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    fireEvent.click(screen.getAllByRole('button', {name: 'Show code for src/limiter.ts L10–13'})[0])
    await waitFor(() => expect(getFile).toHaveBeenCalledWith(session.id, 'src/limiter.ts', 'head'))
    const excerpt = await screen.findByLabelText('Code excerpt from src/limiter.ts')
    expect(excerpt).toHaveTextContent('const answer = 42')
    expect(excerpt).toHaveTextContent('line 13')
    expect(excerpt.querySelector('[style*="color"]')).toBeTruthy()
    expect(screen.getByRole('region', {name: 'Chapter 1: Decision recording'})).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Back to chapter'})).not.toBeInTheDocument()
    expect(getDiff).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', {name: 'Full context'}))
    expect(await screen.findByRole('region', {name: 'head file context for src/limiter.ts'})).toBeInTheDocument()
    expect(getDiff).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Back to chapter'}))
    expect(screen.getByRole('region', {name: 'Chapter 1: Decision recording'})).toBeInTheDocument()
  })

  it('keeps chapters, evidence, notes, and drafts reachable through responsive panel triggers', async () => {
    const session = reviewSession()
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    const chapters = screen.getByRole('button', {name: 'Chapters'})
    const tools = screen.getByRole('button', {name: 'Review tools'})
    expect(chapters).toHaveAttribute('aria-expanded', 'false')
    expect(tools).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(chapters)
    expect(chapters).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('review-chapters-panel')).toHaveClass('panel-open')
    expect(screen.getByRole('dialog', {name: 'Review chapters'})).toContainElement(document.activeElement as HTMLElement)
    fireEvent.click(screen.getByRole('button', {name: 'Close review panels'}))
    expect(chapters).toHaveAttribute('aria-expanded', 'false')
    expect(chapters).toHaveFocus()

    fireEvent.click(tools)
    expect(tools).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('review-tools-panel')).toHaveClass('panel-open')
    expect(screen.getByRole('dialog', {name: 'Review tools'})).toContainElement(document.activeElement as HTMLElement)
    const evidence = screen.getByRole('tab', {name: 'Evidence'})
    const notes = screen.getByRole('tab', {name: 'Notes'})
    expect(evidence).toHaveAttribute('aria-selected', 'true')
    expect(notes).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(notes)
    expect(notes).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Notes')
    expect(screen.getByRole('heading', {name: 'Private notes'})).toBeInTheDocument()
    fireEvent.keyDown(window, {key: 'Escape'})
    expect(tools).toHaveAttribute('aria-expanded', 'false')
    expect(tools).toHaveFocus()
  })
})

describe('Diff review interactions', () => {
  const renderedDiffRoot = async () => {
	await waitFor(() => expect(document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')).toBeTruthy())
	return document.querySelector('diffs-container')!.shadowRoot!
  }
  const renderedFileRoot = async () => {
	await waitFor(() => expect(document.querySelector('.evidence-file-renderer [data-column-number]')).toBeTruthy())
	return document.querySelector<HTMLElement>('.evidence-file-renderer')!
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
	const root = await renderedFileRoot()
	expect(root.querySelector('[data-line="2"]')).toHaveTextContent('two')
	fireEvent.click(root.querySelector<HTMLElement>('[data-column-number="2"]')!)
	expect(onCommentRange).toHaveBeenCalledWith({startLine: 2, startSide: 'LEFT', endLine: 2, endSide: 'LEFT'})
  })

  it('selects a multi-line range in full-file evidence context', async () => {
	const onCommentRange = vi.fn()
	render(<FileContextView file={{path: 'src/greet.ts', revision: 'head', sha: 'head', content: 'one\ntwo\nthree\n', isBinary: false, lineCount: 3}} focus={{id: 'outside-hunk', path: 'src/greet.ts', revision: 'head', startLine: 1, endLine: 1, validationStatus: 'valid'}} onCommentRange={onCommentRange}/>)
	const root = await renderedFileRoot()
	const first = root.querySelector<HTMLElement>('[data-column-number="1"]')!
	const third = root.querySelector<HTMLElement>('[data-column-number="3"]')!
	fireEvent.pointerDown(first, {pointerType: 'mouse', button: 0, pointerId: 1})
	fireEvent.pointerEnter(third, {pointerType: 'mouse', buttons: 1, pointerId: 1})
	fireEvent.pointerUp(window, {pointerType: 'mouse', button: 0, pointerId: 1})
	expect(onCommentRange).toHaveBeenCalledWith({startLine: 1, startSide: 'RIGHT', endLine: 3, endSide: 'RIGHT'})
	expect(root.querySelectorAll('[data-selected-line]')).toHaveLength(3)
  })

  it('does not reuse full-file contents between paths at the same revision', async () => {
	const focus = {id: 'line', path: 'src/first.ts', revision: 'head' as const, startLine: 1, endLine: 1, validationStatus: 'valid' as const}
	const {rerender} = render(<FileContextView file={{path: 'src/first.ts', revision: 'head', sha: 'shared-head', content: 'first file\n', isBinary: false, lineCount: 1}} focus={focus} onCommentRange={vi.fn()}/>)
	let root = await renderedFileRoot()
	expect(root.querySelector('[data-line="1"]')).toHaveTextContent('first file')
	rerender(<FileContextView file={{path: 'src/second.ts', revision: 'head', sha: 'shared-head', content: 'second file\n', isBinary: false, lineCount: 1}} focus={{...focus, path: 'src/second.ts'}} onCommentRange={vi.fn()}/>)
	await waitFor(() => {
	  root = document.querySelector<HTMLElement>('.evidence-file-renderer')!
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
	fireEvent.click(screen.getAllByRole('button', {name: /src\/first\.tsL1/})[0])
	fireEvent.click(screen.getAllByRole('button', {name: /src\/second\.tsL1/})[0])
	resolveSecond({path: 'src/second.ts', revision: 'head', sha: 'head', content: 'second file wins\n', isBinary: false, lineCount: 1})
	await waitFor(() => expect(document.querySelector('.evidence-file-renderer [data-line="1"]')).toHaveTextContent('second file wins'))
	resolveFirst({path: 'src/first.ts', revision: 'head', sha: 'head', content: 'stale first file\n', isBinary: false, lineCount: 1})
	await Promise.resolve()
	expect(document.querySelector('.evidence-file-renderer [data-line="1"]')).toHaveTextContent('second file wins')
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
