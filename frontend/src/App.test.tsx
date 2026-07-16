import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, appendOperationEvent, DiffView, FileContextView, OverviewScreen, ReviewWorkspace, SettingsScreen, SourceSelector, SplitDiffView } from './App'
import { AnalysisBadge, Markdown, WindowControls } from './components'
import type { DecisionReviewMap } from './features/review/decision'
import type { AnalysisConfiguration, BootstrapState, EnvironmentState, InboxAnalysis, OperationEvent, PullRequestRef, RepositoryPage, ReviewSession, SoftwareUpdateStatus } from './types'

const paths = {root: '/tmp/reviewarc', repositories: '/tmp/reviewarc/repos', worktrees: '/tmp/reviewarc/worktrees', database: '/tmp/reviewarc/db.sqlite', logs: '/tmp/reviewarc/logs', cache: '/tmp/reviewarc/cache'}
const idleUpdate: SoftwareUpdateStatus = {currentVersion: '0.1.0', currentBuild: '7', state: 'idle', channel: 'stable'}
const analysisConfiguration: AnalysisConfiguration = {defaultProfile: {harness: 'codex', model: 'gpt-5', reasoning: 'medium'}, harnesses: [{id: 'codex', label: 'Codex', availability: 'available', eligible: true, version: '1.2.3', capabilities: {jsonSchema: true, readOnly: true, progress: true, contextTransport: ['reviewarcTools']}, models: [{id: 'gpt-5', label: 'GPT-5', reasoningLevels: [{id: 'medium', label: 'Medium'}, {id: 'high', label: 'High'}]}, {id: 'gpt-5-mini', label: 'GPT-5 mini', reasoningLevels: [{id: 'low', label: 'Low'}]}]}]}
const dualHarnessConfiguration: AnalysisConfiguration = {
  defaultProfile: {harness: 'claude', model: 'sonnet', reasoning: 'high'},
  harnesses: [
    ...analysisConfiguration.harnesses,
    {id: 'claude', label: 'Claude Code', availability: 'available', eligible: true, path: '/Users/sean/.local/bin/claude', version: '2.1.0', capabilities: {jsonSchema: true, readOnly: true, progress: true, contextTransport: ['reviewarcTools']}, models: [{id: 'sonnet', label: 'Sonnet', reasoningLevels: [{id: 'medium', label: 'Medium'}, {id: 'high', label: 'High'}]}]},
  ],
}
const accessibleSourceMethods = () => ({
  ListAccessibleRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true, refreshRequired: false}),
  RefreshAccessibleRepositories: vi.fn().mockResolvedValue({syncId: 'sync', processed: 0, totalCount: 0, hasNextPage: false, completedAt: '2026-07-16T12:00:00Z'}),
})

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
  it('shows the selected analysis harness and its resolved path in the header', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available', path: '/opt/homebrew/bin/codex'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []})
    window.go!.main!.App!.GetAnalysisConfiguration = vi.fn().mockResolvedValue(dualHarnessConfiguration)
    render(<App/>)
    const dependencyStatus = await screen.findByLabelText('Dependency status')
    const claude = await screen.findByText('claude', {selector: '.dependency'})
    expect(dependencyStatus).toContainElement(claude)
    expect(claude).toHaveAttribute('title', '/Users/sean/.local/bin/claude')
    expect(dependencyStatus).not.toHaveTextContent('codex')
    expect(window.go?.main?.App?.GetAnalysisConfiguration).toHaveBeenCalledOnce()
  })

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

  it('uses a static icon for the analysis badge', () => {
    const {container} = render(<AnalysisBadge status="running"/>)
    expect(screen.getByText('Analyzing')).toBeInTheDocument()
    expect(container.querySelector('.spin')).not.toBeInTheDocument()
  })

  it('shows Finder-launch-aware dependency remediation when gh is missing', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available', path: '/usr/bin/git'}, {name: 'gh', state: 'missing', message: 'Not available on PATH'}, {name: 'codex', state: 'available', path: '/opt/homebrew/bin/codex'}], paths, selections: [], inbox: []})
    render(<App/>)
    expect(await screen.findByText('Connect your review workspace')).toBeInTheDocument()
    expect(screen.getByText(/Finder-launched apps use a limited environment/)).toBeInTheDocument()
    expect(screen.getByText('brew install gh')).toBeInTheDocument()
    expect(screen.queryByText('gh auth login')).not.toBeInTheDocument()
    expect(screen.queryByText('/opt/homebrew/bin/codex')).not.toBeInTheDocument()
    expect(screen.getByText('Git and GitHub CLI connect ReviewArc to your pull requests.')).toBeInTheDocument()
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

  it('refreshes the inbox after saving sources and preserves actionable partial errors', async () => {
    const pullRequest = reviewSession().pullRequest
    const state: BootstrapState = {dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pullRequest]}
    installBackend(state)
    const app = window.go!.main!.App!
    app.ListSources = vi.fn().mockResolvedValue({organizations: [], repositories: [], selections: state.selections})
    app.RefreshSourceAccess = vi.fn().mockResolvedValue([])
    app.RefreshSelectedRepositories = vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}})
    Object.assign(app, accessibleSourceMethods())
    app.SaveSelections = vi.fn().mockResolvedValue(undefined)
    app.RefreshInbox = vi.fn().mockResolvedValue({items: [pullRequest], errors: {'repository:acme/api': 'GitHub authorization is required.'}, partial: true})
    render(<App/>)
    fireEvent.click(await screen.findByRole('button', {name: 'Sources'}))
    fireEvent.click(await screen.findByRole('button', {name: 'Save sources'}))
    expect(await screen.findByText('Some sources could not be refreshed')).toBeInTheDocument()
    expect(screen.getByText('acme/api', {selector: 'code'})).toBeInTheDocument()
    expect(screen.getByText('GitHub authorization is required.')).toBeInTheDocument()
    expect(app.RefreshInbox).toHaveBeenCalledOnce()
  })

  it('keeps the inbox usable when no AI harness is installed', async () => {
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'missing'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: []})
    render(<App/>)
    expect(await screen.findByRole('heading', {name: 'Pull request inbox'})).toBeInTheDocument()
    expect(screen.queryByRole('heading', {name: 'Connect your review workspace'})).not.toBeInTheDocument()
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

  it('keeps a compact, explained action available for analyzed pull requests', async () => {
    const pullRequest = reviewSession().pullRequest
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pullRequest]})
    render(<App/>)

    const action = await screen.findByRole('button', {name: 'Open review for acme/api pull request #1'})
    expect(action).not.toHaveTextContent('Open review')
    fireEvent.focus(action)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open review')
    fireEvent.blur(action)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('opens an inbox pull request on GitHub without opening the ReviewArc overview', async () => {
    const pullRequest = reviewSession().pullRequest
    const openURL = vi.fn()
    const openPullRequest = vi.fn()
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pullRequest]})
    window.go!.main!.App!.OpenPullRequest = openPullRequest
    window.runtime = {BrowserOpenURL: openURL}
    render(<App/>)

    fireEvent.click(await screen.findByRole('button', {name: 'Open acme/api pull request #1 on GitHub'}))

    expect(openURL).toHaveBeenCalledWith('https://github.com/acme/api/pull/1')
    expect(openPullRequest).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', {name: 'Pull request inbox'})).toBeInTheDocument()
  })

  it('queues analysis from the inbox and keeps the user in the review queue', async () => {
    const session = reviewSession()
    const pullRequest = {...session.pullRequest, analysisStatus: 'notStarted' as const, sessionId: undefined}
    const queuedSession: ReviewSession = {...session, analysisStatus: 'queued', pullRequest: {...session.pullRequest, analysisStatus: 'queued'}}
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pullRequest]})
    const queue = vi.fn().mockResolvedValue({session: queuedSession, operation: {id: 'queued-run', sessionId: session.id, runId: 'queued-run', kind: 'analysis', stage: 'queued', state: 'queued', message: 'Waiting for an analysis worker'}})
    window.go!.main!.App!.QueueInboxAnalysis = queue
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<App/>)

    fireEvent.click(await screen.findByRole('button', {name: 'Analyze acme/api pull request #1'}))
    await waitFor(() => expect(queue).toHaveBeenCalledWith(pullRequest.ref))
    expect(screen.getByRole('heading', {name: 'Pull request inbox'})).toBeInTheDocument()
    expect(screen.getByText('1 queued')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Cancel acme/api pull request #1'})).toBeInTheDocument()
  })

  it('keeps overview analysis state synchronized when returning to the inbox', async () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, analysis: undefined, analysisStatus: 'notStarted', chapters: [], progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, pullRequest: {...base.pullRequest, analysisStatus: 'notStarted', progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}}}
    const operation = {id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingContext', message: 'Preparing context', state: 'running' as const}
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [session.pullRequest]})
    Object.assign(window.go!.main!.App!, {
      OpenPullRequest: vi.fn().mockResolvedValue(session),
      RefreshPullRequestContext: vi.fn().mockResolvedValue(session),
      StartAnalysis: vi.fn().mockResolvedValue(operation),
      GetActiveAnalysisOperation: vi.fn().mockResolvedValue({operation, events: []}),
    })
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<App/>)

    fireEvent.click((await screen.findByText(session.pullRequest.title)).closest('button')!)
    fireEvent.click(await screen.findByRole('button', {name: 'Analyze pull request'}))
    await waitFor(() => expect(window.go!.main!.App!.StartAnalysis).toHaveBeenCalledWith(session.id))
    fireEvent.click(screen.getAllByRole('button', {name: 'Inbox'})[0])

    expect(await screen.findByText('1 analyzing')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Cancel acme/api pull request #1'})).toBeInTheDocument()
  })

  it('preserves both queued states when inbox analysis requests resolve out of order', async () => {
    const base = reviewSession()
    const first = {...base, id: 'session-1', analysisStatus: 'notStarted' as const, pullRequest: {...base.pullRequest, analysisStatus: 'notStarted' as const, sessionId: undefined}}
    const second = {...base, id: 'session-2', analysisStatus: 'notStarted' as const, pullRequest: {...base.pullRequest, ref: {...base.pullRequest.ref, number: 2}, analysisStatus: 'notStarted' as const, sessionId: undefined}}
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [first.pullRequest, second.pullRequest]})
    let resolveFirst!: (result: InboxAnalysis) => void
    let resolveSecond!: (result: InboxAnalysis) => void
    const queue = vi.fn((input: unknown) => new Promise<InboxAnalysis>((resolve) => {
      const ref = input as PullRequestRef
      if (ref.number === 1) resolveFirst = resolve
      else resolveSecond = resolve
    }))
    window.go!.main!.App!.QueueInboxAnalysis = queue
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<App/>)

    fireEvent.click(await screen.findByRole('button', {name: 'Analyze acme/api pull request #1'}))
    fireEvent.click(screen.getByRole('button', {name: 'Analyze acme/api pull request #2'}))
    resolveSecond({session: {...second, analysisStatus: 'queued', pullRequest: {...second.pullRequest, analysisStatus: 'queued'}}, operation: {id: 'run-2', sessionId: second.id, kind: 'analysis', stage: 'queued', state: 'queued', message: 'Waiting'}})
    expect(await screen.findByRole('button', {name: 'Cancel acme/api pull request #2'})).toBeInTheDocument()
    resolveFirst({session: {...first, analysisStatus: 'queued', pullRequest: {...first.pullRequest, analysisStatus: 'queued'}}, operation: {id: 'run-1', sessionId: first.id, kind: 'analysis', stage: 'queued', state: 'queued', message: 'Waiting'}})

    expect(await screen.findByRole('button', {name: 'Cancel acme/api pull request #1'})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Cancel acme/api pull request #2'})).toBeInTheDocument()
    expect(screen.getByText('2 queued')).toBeInTheDocument()
  })

  it('cancels queued analysis from the inbox', async () => {
    const session = reviewSession()
    const pullRequest = {...session.pullRequest, analysisStatus: 'queued' as const, sessionId: session.id}
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [pullRequest]})
    const cancel = vi.fn().mockResolvedValue(undefined)
    window.go!.main!.App!.GetActiveAnalysisOperation = vi.fn().mockResolvedValue({operation: {id: 'queued-run', sessionId: session.id, kind: 'analysis', stage: 'queued', state: 'queued', message: 'Waiting'}, events: []})
    window.go!.main!.App!.CancelOperation = cancel
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<App/>)

    fireEvent.click(await screen.findByRole('button', {name: 'Cancel acme/api pull request #1'}))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('queued-run'))
  })

  it('updates inbox queue counts from analysis operation events', async () => {
	const session = reviewSession()
	const queued = {...session.pullRequest, analysisStatus: 'queued' as const, sessionId: session.id}
	const ready = {...session, analysisStatus: 'ready' as const, pullRequest: {...session.pullRequest, analysisStatus: 'ready' as const}}
	installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [queued]})
	window.go!.main!.App!.GetSession = vi.fn().mockResolvedValue(ready)
	const handlers: Record<string, (value: unknown) => void> = {}
	window.runtime = {EventsOn: vi.fn((name: string, handler: (value: unknown) => void) => { handlers[name] = handler; return () => {} })}
	render(<App/>)

	expect(await screen.findByText('1 queued')).toBeInTheDocument()
	handlers['reviewarc:operation:v1']({id: 'queued-run', sessionId: session.id, kind: 'analysis', stage: 'analyzingChange', state: 'running', message: 'Analyzing'})
	expect(await screen.findByText('1 analyzing')).toBeInTheDocument()
	expect(screen.queryByText('1 queued')).not.toBeInTheDocument()
	handlers['reviewarc:operation:v1']({id: 'queued-run', sessionId: session.id, kind: 'analysis', stage: 'complete', state: 'completed', message: 'Analysis ready'})
	await waitFor(() => expect(window.go!.main!.App!.GetSession).toHaveBeenCalledWith(session.id))
	await waitFor(() => expect(screen.queryByText('1 analyzing')).not.toBeInTheDocument())
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
    const walkthroughReady = screen.getByRole('button', {name: 'Guided review ready'})
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
  }, 15_000)

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
  it('opens the third-party notices bundled with the app', () => {
    const openThirdPartyNotices = vi.fn().mockResolvedValue(undefined)
    window.go = {main: {App: {OpenThirdPartyNotices: openThirdPartyNotices}}}
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} onSources={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'View notices'}))
    expect(openThirdPartyNotices).toHaveBeenCalledOnce()
  })

  it('offers system, light, and dark appearance preferences', () => {
    const onThemeChange = vi.fn()
    render(<SettingsScreen state={{dependencies: [], paths, selections: [], inbox: []}} theme="dark" onThemeChange={onThemeChange} onSources={vi.fn()}/>)
    expect(screen.getByRole('button', {name: 'Dark'})).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', {name: 'System'})).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', {name: 'Light'}))
    expect(onThemeChange).toHaveBeenCalledWith('light')
    expect(screen.getByText(/updates when it changes/)).toBeInTheDocument()
  })

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
    expect(screen.getByText(/PR analysis uses the repository cache/)).toHaveTextContent('ReviewArc invokes your installed git, gh, and selected AI harness, which may read their own configuration and credentials.')
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
  it('searches all repositories available to the account before an owner is selected', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [], inbox: []}
    const repositories = [
      {ref: {host: 'github.com', owner: 'acme', name: 'api', cloneUrl: '', databaseId: '1'}, description: 'Payments backend', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'},
      {ref: {host: 'github.com', owner: 'sean', name: 'reviewarc', cloneUrl: '', databaseId: '2'}, description: 'Desktop review client', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'},
    ]
    const listAccessible = vi.fn().mockImplementation(({query}: {query: string}) => {
      const items = query ? repositories.filter((repository) => `${repository.ref.owner}/${repository.ref.name} ${repository.description}`.toLowerCase().includes(query.toLowerCase())) : repositories
      return Promise.resolve({items, totalCount: items.length, hasNextPage: false, cached: true, refreshRequired: false})
    })
    window.go = {main: {App: {
      ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [], selections: []}),
      RefreshSourceAccess: vi.fn().mockResolvedValue([]),
      RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListAccessibleRepositories: listAccessible,
      RefreshAccessibleRepositories: vi.fn(),
    }}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    expect(await screen.findByRole('heading', {name: 'All accessible repositories'})).toBeInTheDocument()
    expect(await screen.findByText('acme/api')).toBeInTheDocument()
    expect(screen.getByText('sean/reviewarc')).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Search repositories you can access')
    fireEvent.change(input, {target: {value: 'review'}})
    await waitFor(() => expect(listAccessible).toHaveBeenLastCalledWith({account: 'sean', query: 'review', offset: 0}))
    expect(await screen.findByText('sean/reviewarc')).toBeInTheDocument()
    expect(screen.queryByText('acme/api')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', {name: 'Include sean/reviewarc'}))
    expect(screen.getByText('1 source included')).toBeInTheDocument()
  })

  it('renders included source rules before GitHub owner discovery completes', () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'organization', key: 'acme', enabled: true}, {kind: 'repository', key: 'sean/reviewarc', enabled: true}], inbox: []}
    window.go = {main: {App: {ListSources: vi.fn(() => new Promise(() => {})), ...accessibleSourceMethods()}}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    expect(screen.getByRole('button', {name: 'Included sources'})).toHaveAttribute('aria-pressed', 'true')
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

	it('keeps saved sources usable when GitHub owner discovery is unavailable', async () => {
	  const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'repository', key: 'sean/reviewarc', enabled: true}], inbox: []}
	  const listSources = vi.fn().mockResolvedValue({organizations: [], repositories: [{ref: {host: 'github.com', owner: 'sean', name: 'reviewarc', cloneUrl: '', databaseId: '1'}, description: '', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'}], selections: state.selections, organizationError: 'GitHub is temporarily unavailable. Try again in a moment.'})
	  window.go = {main: {App: {ListSources: listSources, RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}), ...accessibleSourceMethods()}}}
	  render(<SourceSelector state={state} onDone={vi.fn()}/>)
	  expect(await screen.findByText('Owners unavailable')).toBeInTheDocument()
	  expect(screen.getByText(/Saved sources still work/)).toBeInTheDocument()
	  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
	  expect(screen.getByText('sean/reviewarc')).toBeInTheDocument()
	  fireEvent.click(screen.getByRole('button', {name: 'Retry loading owners'}))
	  await waitFor(() => expect(listSources).toHaveBeenCalledTimes(2))
	})

  it('keeps loaded included repositories removable instead of rendering selection checkboxes', async () => {
    const state: BootstrapState = {dependencies: [], paths, account: {login: 'sean', name: 'Sean', avatarUrl: ''}, selections: [{kind: 'repository', key: 'sean/reviewarc', enabled: true}], inbox: []}
    window.go = {main: {App: {ListSources: vi.fn().mockResolvedValue({organizations: [], repositories: [{ref: {host: 'github.com', owner: 'sean', name: 'reviewarc', cloneUrl: '', databaseId: '1'}, description: 'Local-first pull request review', isPrivate: true, isArchived: false, updatedAt: '2026-07-12T00:00:00Z'}], selections: state.selections}), ...accessibleSourceMethods()}}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: /Included sources/}))
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
	  ...accessibleSourceMethods(),
	  RefreshSourceAccess: vi.fn().mockResolvedValue([]),
	  RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListCachedOwnerRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true}),
      RefreshOwnerRepositories: refresh,
      SearchOwnerRepositories: search,
    }}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Show personal repositories from sean'}))
    expect(await screen.findByText('Showing 50 of 12000')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search sean repositories'), {target: {value: 'repo-50'}})
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
      ...accessibleSourceMethods(),
      RefreshSourceAccess: vi.fn().mockResolvedValue([]),
      RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: [], errors: {}}),
      ListCachedOwnerRepositories: vi.fn().mockResolvedValue({items: [], totalCount: 0, hasNextPage: false, cached: true}),
      RefreshOwnerRepositories: vi.fn().mockResolvedValue({items: [repository('browse')], totalCount: 1, hasNextPage: false, cached: false}),
      SearchOwnerRepositories: search,
    }}}
    render(<SourceSelector state={state} onDone={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', {name: 'Show personal repositories from sean'}))
    expect(await screen.findByText('sean/browse')).toBeInTheDocument()
    const input = screen.getByPlaceholderText('Search sean repositories')
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
	  ...accessibleSourceMethods(),
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
    expect(screen.getByText('Some organization repositories are not searchable')).toBeInTheDocument()
    expect(screen.getByText(/locked requires authorization or restored access/)).toBeInTheDocument()
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
	  ...accessibleSourceMethods(),
	  RefreshSourceAccess: vi.fn().mockResolvedValue([]),
	  RefreshSelectedRepositories: vi.fn().mockResolvedValue({repositories: [], archivedKeys: ['acme/old'], errors: {}}),
	}}}
	render(<SourceSelector state={state} onDone={vi.fn()}/>)
	expect(screen.getByText('1 source included')).toBeInTheDocument()
	await waitFor(() => expect(screen.getByText('0 sources included')).toBeInTheDocument())
	expect(screen.queryByText('acme/old')).not.toBeInTheDocument()
  })
})

describe('Analysis setup', () => {
  it('keeps completed phases while replacing repeated activity within the current phase', () => {
    const loading = {stage: 'loadingPullRequestContext', message: 'Loading GitHub discussion and checks', status: 'running' as const}
    const preparing = {stage: 'preparingContext', message: 'Preparing bounded review context', status: 'running' as const}
    const firstRead = {stage: 'analyzingChange', message: 'Reading diff for src/first.go', status: 'running' as const, progress: 20}
    let events: OperationEvent[] = [loading, preparing, firstRead]
    for (let index = 0; index < 20; index++) {
      events = appendOperationEvent(events, {...firstRead, message: `Reading diff for src/file-${index}.go`, progress: index})
    }
    expect(events).toEqual([
      loading,
      preparing,
      {...firstRead, message: 'Reading diff for src/file-19.go', progress: 19},
    ])
  })

  it('does not expose a fake Codex profile while the saved Claude configuration is loading', async () => {
    const session = reviewSession()
    installBackend({dependencies: [{name: 'git', state: 'available'}, {name: 'gh', state: 'available'}, {name: 'codex', state: 'available'}], paths, selections: [{kind: 'repository', key: 'acme/api', enabled: true}], inbox: [session.pullRequest]})
    let resolveConfiguration!: (configuration: AnalysisConfiguration) => void
    const getConfiguration = vi.fn(() => new Promise<AnalysisConfiguration>((resolve) => { resolveConfiguration = resolve }))
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingContext', message: 'Preparing context', state: 'running'})
    Object.assign(window.go!.main!.App!, {
      GetAnalysisConfiguration: getConfiguration,
      OpenPullRequest: vi.fn().mockResolvedValue(session),
      RefreshPullRequestContext: vi.fn().mockResolvedValue(session),
      StartAnalysisWithProfile: start,
    })
    window.runtime = {EventsOn: vi.fn(() => () => {})}

    render(<App/>)
    fireEvent.click(await screen.findByRole('button', {name: /Record quota decisions/}))
    expect(await screen.findByText('Loading AI analysis setup…')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Reanalyze'})).not.toBeInTheDocument()
    expect(start).not.toHaveBeenCalled()

    resolveConfiguration(dualHarnessConfiguration)
    expect(await screen.findByLabelText('Analysis profile: Claude Code, Sonnet, High')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze'}))
    await waitFor(() => expect(start).toHaveBeenCalledWith(session.id, {profile: {harness: 'claude', model: 'sonnet', reasoning: 'high'}, saveAsDefault: false}))
  })

  it('replaces the legacy toolbar profile with the persisted profile when configuration resolves', async () => {
    const session = reviewSession()
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingContext', message: 'Preparing context', state: 'running'})
    window.go = {main: {App: {StartAnalysisWithProfile: start}}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    const {rerender} = render(<OverviewScreen session={session} analysisConfiguration={analysisConfiguration} legacyAnalysis onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByLabelText('Analysis profile: Codex, GPT-5, Medium')).toBeInTheDocument()
    rerender(<OverviewScreen session={session} analysisConfiguration={dualHarnessConfiguration} legacyAnalysis={false} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)
    expect(await screen.findByLabelText('Analysis profile: Claude Code, Sonnet, High')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze'}))
    await waitFor(() => expect(start).toHaveBeenCalledWith(session.id, {profile: {harness: 'claude', model: 'sonnet', reasoning: 'high'}, saveAsDefault: false}))
  })

  it('configures the recommended profile inline on the first analysis', async () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, analysis: undefined, analysisStatus: 'notStarted', chapters: [], progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}, pullRequest: {...base.pullRequest, analysisStatus: 'notStarted', progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0}}}
    const configuration = {...analysisConfiguration, defaultProfile: undefined}
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingContext', message: 'Preparing context', state: 'running'})
    const onConfiguration = vi.fn()
    window.go = {main: {App: {StartAnalysisWithProfile: start}}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} analysisConfiguration={configuration} legacyAnalysis={false} onAnalysisConfiguration={onConfiguration} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByRole('heading', {name: 'Choose how to analyze this change'})).toBeInTheDocument()
    expect(screen.getByRole('combobox', {name: 'Analysis harness'})).toHaveTextContent('Codex')
    fireEvent.click(screen.getByRole('button', {name: 'Analyze pull request'}))
    await waitFor(() => expect(start).toHaveBeenCalledWith(session.id, {profile: {harness: 'codex', model: 'gpt-5', reasoning: 'medium'}, saveAsDefault: true}))
    expect(onConfiguration).toHaveBeenCalledWith(expect.objectContaining({defaultProfile: {harness: 'codex', model: 'gpt-5', reasoning: 'medium'}}))
  })

  it('uses a per-run override without changing the saved default', async () => {
    const session = reviewSession()
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingContext', message: 'Preparing context', state: 'running'})
    const onConfiguration = vi.fn()
    window.go = {main: {App: {StartAnalysisWithProfile: start}}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} analysisConfiguration={analysisConfiguration} legacyAnalysis={false} onAnalysisConfiguration={onConfiguration} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', {name: 'Change'}))
    expect(screen.getByText('For this run')).toBeInTheDocument()
    const model = screen.getByRole('combobox', {name: 'Analysis model'})
    fireEvent.keyDown(model, {key: 'ArrowDown'})
    fireEvent.click(await screen.findByRole('option', {name: 'GPT-5 mini'}))
    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze'}))
    await waitFor(() => expect(start).toHaveBeenCalledWith(session.id, {profile: {harness: 'codex', model: 'gpt-5-mini', reasoning: 'low'}, saveAsDefault: false}))
    expect(onConfiguration).not.toHaveBeenCalled()
  })
})

describe('Reanalysis state', () => {
  it('reattaches to a running analysis with history and a working cancel action', async () => {
    const current = reviewSession()
    const session: ReviewSession = {...current, analysis: undefined, analysisStatus: 'running', chapters: []}
    const cancel = vi.fn().mockResolvedValue(undefined)
    window.go = {main: {App: {
      GetActiveAnalysisOperation: vi.fn().mockResolvedValue({
        operation: {id: 'operation-1', sessionId: session.id, runId: 'run-1', kind: 'analysis', stage: 'analyzingChange', state: 'running', message: 'Reading src/limiter.ts lines 10–24'},
        events: [
          {id: 'operation-1', sessionId: session.id, runId: 'run-1', kind: 'analysis', stage: 'preparingContext', state: 'running', message: 'Preparing bounded review context'},
          {id: 'operation-1', sessionId: session.id, runId: 'run-1', kind: 'analysis', stage: 'analyzingChange', state: 'running', message: 'Reading src/limiter.ts lines 10–24'},
        ],
      }),
      CancelOperation: cancel,
      GetSession: vi.fn().mockResolvedValue(session),
    }}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} analysisConfiguration={dualHarnessConfiguration} legacyAnalysis={false} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(await screen.findByText('Preparing bounded review context')).toBeInTheDocument()
    expect(screen.getByText('Reading src/limiter.ts lines 10–24')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('operation-1'))
  })

  it('restores the persisted harness failure after reopening a session', () => {
    const current = reviewSession()
    const session: ReviewSession = {
      ...current,
      analysis: undefined,
      analysisStatus: 'failed',
      chapters: [],
      progress: {total: 0, reviewed: 0, blocked: 0, clarify: 0, percent: 0},
      latestAnalysisRun: {
        id: 'failed-run', sessionId: current.id, profile: {harness: 'claude', model: 'sonnet', reasoning: 'high'}, harnessVersion: '2.1.210', contextTransport: 'reviewarcTools', schemaVersion: 1, inputFingerprint: 'fixture',
        coverage: {changedFilesTotal: 1, diffFilesFullyRead: 0, diffFilesPartiallyRead: 0, diffFilesUnread: 1, diffBytesTotal: 100, diffBytesRead: 0, segments: 0, omittedPaths: ['src/file.go'], accesses: []},
        status: 'failed', startedAt: '2026-07-15T12:00:00Z', completedAt: '2026-07-15T12:00:01Z', updatedAt: '2026-07-15T12:00:01Z',
        failure: {code: 'authentication_required', title: 'The analysis harness needs authentication', message: 'Sign in to the selected harness, then check the analysis setup again.', action: 'authenticate', retryable: false, technicalDetails: 'Not logged in · Please run /login'},
      },
    }
    const onOpenSettings = vi.fn()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} analysisConfiguration={dualHarnessConfiguration} legacyAnalysis={false} onOpenSettings={onOpenSettings} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByRole('alert')).toHaveTextContent('The analysis harness needs authentication')
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByRole('button', {name: 'Open settings'}))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('gives stale analysis one primary recovery action without hiding the old walkthrough', async () => {
    const current = reviewSession()
    const session: ReviewSession = {...current, headSha: 'old-head', isStale: true, staleReason: '', pullRequest: {...current.pullRequest, headSha: 'new-head'}}
    const start = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingSnapshot', message: 'Preparing isolated repository snapshot', state: 'running'})
    const onReview = vi.fn()
    window.go = {main: {App: {StartAnalysis: start}}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={onReview}/>)

    const banner = screen.getByText('Analysis out of date').closest('.stale-banner')!
    const masthead = screen.getByRole('heading', {name: '#1 Record quota decisions'}).closest('.overview-masthead')!
    expect(masthead.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('New commits were added after this review. Reanalyze before approving.')).toBeInTheDocument()
    expect(screen.getByText('Previous agent review')).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', {name: 'Run again'})).not.toBeInTheDocument()
    const continueReview = screen.getByRole('button', {name: 'Open previous review'})
    const reanalyze = screen.getByRole('button', {name: 'Reanalyze latest revision'})
    expect(continueReview).toHaveTextContent('Previous')
    expect(reanalyze).toHaveTextContent('Reanalyze')
    expect(banner).toContainElement(continueReview)
    expect(banner).toContainElement(reanalyze)
    fireEvent.click(continueReview)
    expect(onReview).toHaveBeenCalled()
    fireEvent.click(reanalyze)
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
    fireEvent.click(screen.getByRole('button', {name: 'Review approval readiness'}))
    expect(onReview).toHaveBeenCalledWith('', '__summary__')
    fireEvent.click(screen.getByRole('button', {name: 'Change'}))
    expect(screen.getByRole('combobox', {name: 'Analysis model'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze'}))
    const runningButton = await screen.findByRole('button', {name: 'Reanalysis running'})
    expect(runningButton).toBeDisabled()
    expect(runningButton.querySelector('.spin')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Change'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Done'})).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', {name: 'Analysis model'})).not.toBeInTheDocument()
    expect(screen.getByText('Reanalysis progress')).toBeInTheDocument()
    expect(screen.getAllByText('Previous validated walkthrough')).not.toHaveLength(0)
    expect(screen.getByRole('button', {name: 'Review approval readiness'})).toBeDisabled()
    handlers['reviewarc:operation:v1']({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'cancelled', message: 'Analysis cancelled', state: 'cancelled'})
    await waitFor(() => expect(getSession).toHaveBeenCalledWith(session.id))
    expect(onSession).toHaveBeenCalledWith(session)
  })

  it('opens and focuses targeted coverage when every changed file was at least previewed', async () => {
    const session = reviewSession()
    session.latestAnalysisRun = {
      id: 'run-coverage', sessionId: session.id, profile: {harness: 'claude', model: 'sonnet', reasoning: 'medium'}, contextTransport: 'reviewarcTools', schemaVersion: 1, inputFingerprint: 'fixture',
      coverage: {changedFilesTotal: 21, diffFilesFullyRead: 18, diffFilesPartiallyRead: 0, diffFilesPreviewed: 3, diffFilesUnseen: 0, diffFilesUnread: 3, diffBytesTotal: 2100, diffBytesRead: 1800, segments: 18, omittedPaths: ['generated/a.ts', 'generated/b.ts', 'package-lock.json'], previewedPaths: ['generated/a.ts', 'generated/b.ts', 'package-lock.json'], unseenPaths: [], accesses: []},
      status: 'completed', startedAt: '2026-07-15T12:00:00Z', completedAt: '2026-07-15T12:01:00Z', updatedAt: '2026-07-15T12:01:00Z',
    }
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    const banner = screen.getByText('All 21 changed files were inspected.').closest('.analysis-coverage-warning')
    expect(banner).toHaveTextContent('18 fully read · 3 previewed')
    expect(banner).toHaveTextContent('Previewed files were triaged')
    expect(screen.queryByText(/Full diffs were available/)).not.toBeInTheDocument()
    const coverageDetails = screen.getByText('Analysis details').closest('details')
    expect(coverageDetails).not.toHaveAttribute('open')
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    fireEvent.click(screen.getByRole('button', {name: 'View coverage details'}))
    expect(coverageDetails).toHaveAttribute('open')
    const coverageHeading = screen.getByRole('heading', {name: '3 files previewed only'})
    await waitFor(() => expect(coverageHeading).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalledWith({behavior: 'smooth', block: 'nearest'})
  })

  it('warns and focuses unseen coverage when changed files were never inventoried', async () => {
    const session = reviewSession()
    session.latestAnalysisRun = {
      id: 'run-unseen', sessionId: session.id, profile: {harness: 'codex', model: 'gpt-5', reasoning: 'medium'}, contextTransport: 'reviewarcTools', schemaVersion: 1, inputFingerprint: 'fixture',
      coverage: {changedFilesTotal: 21, diffFilesFullyRead: 15, diffFilesPartiallyRead: 1, diffFilesPreviewed: 3, diffFilesUnseen: 2, diffFilesUnread: 5, diffBytesTotal: 2100, diffBytesRead: 1600, segments: 16, omittedPaths: ['a', 'b', 'c', 'd', 'e'], previewedPaths: ['a', 'b', 'c'], unseenPaths: ['d', 'e'], accesses: []},
      status: 'completed', startedAt: '2026-07-15T12:00:00Z', completedAt: '2026-07-15T12:01:00Z', updatedAt: '2026-07-15T12:01:00Z',
    }
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    const banner = screen.getAllByText('2 changed files were not inspected.')[0].closest('.warning-banner')
    expect(banner).toHaveTextContent('15 fully read · 1 partially read · 3 previewed · 2 unseen')
    expect(banner).toHaveTextContent('Findings may not cover the unseen changes')
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    fireEvent.click(screen.getByRole('button', {name: 'View coverage details'}))
    const unseenHeading = screen.getByRole('heading', {name: '2 files not inspected'})
    await waitFor(() => expect(unseenHeading).toHaveFocus())
    expect(screen.getByRole('heading', {name: '3 files previewed only'})).not.toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({behavior: 'smooth', block: 'nearest'})
  })
})

describe('Review brief and chapter reader', () => {
  it('pauses the review on failing CI and links directly to the failed check', () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, pullRequest: {...base.pullRequest, checkRuns: [{id: 21, name: 'test', status: 'completed', conclusion: 'failure', appName: 'GitHub Actions', url: 'https://github.com/acme/api/actions/runs/21', detailsUrl: 'https://github.com/acme/api/actions/runs/21', startedAt: '', completedAt: ''}]}}
    const openURL = vi.fn()
    window.runtime = {EventsOn: vi.fn(() => () => {}), BrowserOpenURL: openURL}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByRole('heading', {name: 'Review paused — CI is failing'})).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Open review'})).toBeDisabled()
    expect(screen.queryByText('Agent review complete')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Open check'}))
    expect(openURL).toHaveBeenCalledWith('https://github.com/acme/api/actions/runs/21')
  })

  it('polls pending checks and exposes the agent review when CI passes', async () => {
    vi.useFakeTimers()
    try {
      const base = reviewSession()
      const pending: ReviewSession = {...base, pullRequest: {...base.pullRequest, checkRuns: [{id: 21, name: 'test', status: 'in_progress', url: 'https://github.com/acme/api/actions/runs/21', detailsUrl: '', startedAt: '', completedAt: ''}]}}
      const passing: ReviewSession = {...base, pullRequest: {...base.pullRequest, checkRuns: [{id: 21, name: 'test', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/api/actions/runs/21', detailsUrl: '', startedAt: '', completedAt: ''}]}}
      const openPullRequest = vi.fn().mockResolvedValue({...pending, id: 'refreshed-session'})
      const refreshPullRequestContext = vi.fn().mockResolvedValue(passing)
      window.go = {main: {App: {OpenPullRequest: openPullRequest, RefreshPullRequestContext: refreshPullRequestContext}}}
      window.runtime = {EventsOn: vi.fn(() => () => {})}
      function ControlledOverview() {
        const [current, setCurrent] = useState(pending)
        return <OverviewScreen session={current} onBack={vi.fn()} onSession={setCurrent} onReview={vi.fn()}/>
      }
      render(<ControlledOverview/>)

      expect(screen.getByRole('heading', {name: 'Waiting for CI before deep review'})).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(openPullRequest).toHaveBeenCalledWith(pending.pullRequest.ref)
      expect(refreshPullRequestContext).toHaveBeenCalledWith('refreshed-session')
      expect(screen.getByText('Agent review complete')).toBeInTheDocument()
      expect(screen.queryByRole('heading', {name: 'Waiting for CI before deep review'})).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts the deferred agent review automatically after checks turn green', async () => {
    vi.useFakeTimers()
    try {
      const base = reviewSession()
      const withoutAnalysis: ReviewSession = {...base, analysis: undefined, analysisStatus: 'notStarted'}
      const pending: ReviewSession = {...withoutAnalysis, pullRequest: {...withoutAnalysis.pullRequest, analysisStatus: 'notStarted', checkRuns: [{id: 21, name: 'test', status: 'in_progress', url: 'https://github.com/acme/api/actions/runs/21', detailsUrl: '', startedAt: '', completedAt: ''}]}}
      const passing: ReviewSession = {...withoutAnalysis, pullRequest: {...withoutAnalysis.pullRequest, analysisStatus: 'notStarted', checkRuns: [{id: 21, name: 'test', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/api/actions/runs/21', detailsUrl: '', startedAt: '', completedAt: ''}]}}
      const startAnalysis = vi.fn().mockResolvedValue({id: 'deferred-analysis', sessionId: passing.id, kind: 'analysis', stage: 'loadingPullRequestContext', state: 'running', message: 'Loading context'})
      window.go = {main: {App: {
        OpenPullRequest: vi.fn().mockResolvedValue({...pending, id: 'refreshed-session'}),
        RefreshPullRequestContext: vi.fn().mockResolvedValue(passing),
        StartAnalysis: startAnalysis,
      }}}
      window.runtime = {EventsOn: vi.fn(() => () => {})}
      function ControlledOverview() {
        const [current, setCurrent] = useState(pending)
        return <OverviewScreen session={current} onBack={vi.fn()} onSession={setCurrent} onReview={vi.fn()}/>
      }
      render(<ControlledOverview/>)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(startAnalysis).toHaveBeenCalledWith(passing.id)
      expect(screen.getByRole('heading', {name: 'Building the review arc'})).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the ReviewArc brief before collapsed author context', () => {
    const session = reviewSession()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    const brief = screen.getByRole('region', {name: 'Pull request review overview'})
    expect(brief).toHaveTextContent('Adds an optional quota-decision recorder')
    fireEvent.click(screen.getByText('Full generated analysis'))
    const areaDetails = screen.getByText('Area details').closest('details')!
    expect(areaDetails).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Area details'))
    expect(areaDetails).toHaveAttribute('open')
    expect(areaDetails).toHaveTextContent('Changes the decision path.')
    expect(brief).toHaveTextContent('Callback runs while locked')
    expect(brief).toHaveTextContent('Whether reentrant recorders are supported is unspecified')
    const agentReview = screen.getByRole('region', {name: 'Hold'})
    const supportingContext = screen.getByRole('region', {name: 'Supporting context'})
    const disclosure = screen.getByText('Author context').closest('details')!
    expect(agentReview).not.toContainElement(disclosure)
    expect(brief).toContainElement(agentReview)
    expect(brief).toContainElement(supportingContext)
    expect(agentReview.compareDocumentPosition(supportingContext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(disclosure).not.toHaveAttribute('open')
    expect(brief.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByText('Author context'))
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByText('A long implementation appendix that belongs in author context.')).toBeInTheDocument()
  })

  it('renders the generated overview summary as safe Markdown', () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, analysis: {...base.analysis!, summary: '**Quota recorder**\n\n- Emits allowed decisions\n- Emits rejected decisions'}}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByText('Quota recorder', {selector: 'strong'})).toBeInTheDocument()
    expect(screen.getByText('Emits allowed decisions').closest('li')).toBeInTheDocument()
    expect(screen.getByText('Emits rejected decisions').closest('li')).toBeInTheDocument()
  })

  it('opens overview discussion entries on GitHub when a permalink is available', () => {
    const session = reviewSession()
    const openURL = vi.fn()
    session.pullRequest.reviews = [{id: 11, author: {login: 'alice', name: 'Alice', avatarUrl: ''}, state: 'COMMENTED', body: 'Please cover the retry path.', commitSha: 'head', submittedAt: '2026-07-12T01:00:00Z', url: 'https://github.com/acme/api/pull/1#pullrequestreview-11'}]
    session.pullRequest.reviewComments = [{id: 101, reviewId: 11, author: {login: 'bob', name: 'Bob', avatarUrl: ''}, body: 'Can this race?', path: 'quota/limiter.go', line: 13, side: 'RIGHT', commitSha: 'head', createdAt: '2026-07-12T01:01:00Z', updatedAt: '2026-07-12T01:01:00Z', url: 'https://github.com/acme/api/pull/1#discussion_r101'}]
    window.runtime = {EventsOn: vi.fn(() => () => {}), BrowserOpenURL: openURL}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    fireEvent.click(screen.getByText('Existing discussion'))
    fireEvent.click(screen.getByRole('button', {name: 'Open review by @alice on GitHub'}))
    fireEvent.click(screen.getByRole('button', {name: 'Open comment by @bob on GitHub'}))

    expect(openURL).toHaveBeenNthCalledWith(1, 'https://github.com/acme/api/pull/1#pullrequestreview-11')
    expect(openURL).toHaveBeenNthCalledWith(2, 'https://github.com/acme/api/pull/1#discussion_r101')
  })

  it('turns the highest risks into concrete findings inside the agent brief', () => {
    const base = reviewSession()
    const originalChapter = base.analysis!.chapters[0]
    const chapterRisk = originalChapter.risks[0]
    const extraEvidence = {...chapterRisk.evidence[0], id: 'secondary-evidence', startLine: 1, endLine: 2}
    const session: ReviewSession = {...base, analysis: {...base.analysis!, risks: [{...base.analysis!.risks[0], id: 'overview-risk'}], judgments: [{
      id: 'callback-lock',
      title: 'Callback runs while locked',
      description: 'A slow or reentrant recorder can block callers.',
      kind: 'risk',
      level: 'high',
      groupingRationale: 'All three observations are caused by invoking the recorder before the same limiter mutex is released.',
      observations: [
        {id: 'overview', title: 'Callback runs while locked', description: 'The callback runs before unlock.', evidence: chapterRisk.evidence},
        {id: 'broad', title: 'Broad lock concern', description: 'The critical section includes caller code.', evidence: [...chapterRisk.evidence, extraEvidence]},
        {id: 'specific', title: 'Specific callback concern', description: 'A reentrant callback can deadlock.', evidence: chapterRisk.evidence},
      ],
    }, {
      id: 'reentrant-contract',
      title: 'Whether reentrant recorders are supported is unspecified.',
      description: 'The available repository evidence does not define the callback contract.',
      kind: 'unknown',
      level: 'unknown',
      groupingRationale: '',
      observations: [{id: 'contract', title: 'Recorder reentrancy is unspecified', description: 'No contract establishes whether a recorder may call the limiter.', evidence: chapterRisk.evidence}],
    }], chapters: [
      {...originalChapter, id: 'chapter-1', title: 'Recorder setup', risks: [{...chapterRisk, id: 'broad-chapter-risk', title: 'Broad lock concern', evidence: [...chapterRisk.evidence, extraEvidence]}]},
      {...originalChapter, id: 'chapter-2', order: 2, title: 'Decision path', risks: [{...chapterRisk, id: 'chapter-risk', title: 'Specific callback concern'}]},
    ]}}
    const onReview = vi.fn()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={onReview}/>)

    const brief = screen.getByRole('region', {name: 'Pull request review overview'})
    expect(brief).toHaveTextContent('#1 Record quota decisions')
    expect(brief).toHaveTextContent('Callback runs while locked')
    expect(brief).toHaveTextContent('3 observations')
    expect(brief).not.toHaveTextContent('Broad lock concern')
    expect(brief).not.toHaveTextContent('Specific callback concern')
    expect(brief).not.toHaveTextContent('Decision map')
    expect(screen.getByRole('heading', {name: 'Needs your judgment 2'})).toBeInTheDocument()
    expect(screen.getAllByText('High risk')).not.toHaveLength(0)
    expect(screen.getAllByText(/validated reference/)).not.toHaveLength(0)
    expect(screen.getAllByText('Resolve or accept with rationale')).not.toHaveLength(0)
    expect(screen.getByRole('heading', {name: 'What was verified'}).closest('details')).toBeNull()
    expect(screen.getByRole('heading', {name: 'What remains unknown'}).closest('details')).toBeNull()
    expect(screen.queryByText('Blind spots')).not.toBeInTheDocument()
    const groupedJudgment = screen.getByText('Callback runs while locked').closest('.agent-finding')!
    fireEvent.click(groupedJudgment.querySelector('button')!)
    expect(onReview).toHaveBeenCalledWith('chapter-1', 'judgment:callback-lock')
  })

  it('keeps consequential findings visible and progressively reveals a long judgment list', () => {
    const session = reviewSession()
    const chapter = session.analysis!.chapters[0]
    const sourceRisk = chapter.risks[0]
    const risks = Array.from({length: 8}, (_, index) => ({
      ...sourceRisk,
      id: `risk-${index + 1}`,
      title: `Independent finding ${index + 1}`,
      description: `Independent failure mode ${index + 1} affects a separate code path.`,
      evidence: [{...sourceRisk.evidence[0], id: `risk-evidence-${index + 1}`, path: `src/finding-${index + 1}.ts`}],
      level: index === 0 ? 'critical' as const : index < 4 ? 'high' as const : 'medium' as const,
    }))
    session.analysis = {...session.analysis!, risks: [], unknowns: [], chapters: [{...chapter, risks, unknowns: []}]}
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByRole('heading', {name: 'Needs your judgment 8'})).toBeInTheDocument()
    expect(screen.getByText('Independent finding 1')).toBeInTheDocument()
    expect(screen.getByText('Independent finding 2')).toBeInTheDocument()
    expect(screen.queryByText('Independent finding 8')).not.toBeInTheDocument()

    expect(screen.queryByText('Independent finding 4')).not.toBeInTheDocument()
    const disclosure = screen.getByRole('button', {name: 'Show 5 more · 1 high risk'})
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(disclosure)

    expect(screen.getByText('Independent finding 8')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Show fewer judgments'})).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not turn an unsupported overview risk into an authoritative finding', () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, analysis: {...base.analysis!, risks: [{...base.analysis!.risks[0], evidence: []}], chapters: base.analysis!.chapters.map((chapter) => ({...chapter, risks: []}))}}
    const onReview = vi.fn()
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={onReview}/>)

    const attention = screen.getByRole('heading', {name: /Needs your judgment/}).closest('section')!
    expect(attention).not.toHaveTextContent('Callback runs while locked')
    expect(screen.getByText('The risk “Callback runs while locked” was not backed by a validated code reference.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Open judgment: Whether reentrant recorders are supported is unspecified.'}))
    expect(onReview).toHaveBeenCalledWith('chapter-1', 'unknown:unknown-1')
  })

  it('does not combine legacy findings even when their text and evidence overlap', () => {
    const session = reviewSession()
    const chapter = session.analysis!.chapters[0]
    session.analysis = {
      ...session.analysis!,
      risks: [{...session.analysis!.risks[0], id: 'overview-risk'}],
      chapters: [{...chapter, risks: [{...chapter.risks[0], id: 'chapter-risk', title: ' Callback runs while locked! '}]}],
    }
    window.runtime = {EventsOn: vi.fn(() => () => {})}
    render(<OverviewScreen session={session} onBack={vi.fn()} onSession={vi.fn()} onReview={vi.fn()}/>)

    expect(screen.getByRole('heading', {name: 'Needs your judgment 3'})).toBeInTheDocument()
    expect(screen.getAllByText(/Callback runs while locked!?/)).toHaveLength(2)
  })

  it('opens one focused agent finding while keeping analysis and full diff optional', async () => {
    const session = reviewSession()
    session.pullRequest.reviewComments = [{id: 101, reviewId: 11, author: {login: 'bob', name: 'Bob', avatarUrl: ''}, body: 'Can this race?', path: 'src/limiter.ts', line: 13, side: 'RIGHT', commitSha: 'head', createdAt: '2026-07-12T01:01:00Z', updatedAt: '2026-07-12T01:01:00Z', url: 'https://github.com/acme/api/pull/1#discussion_r101'}]
    const getDiff = vi.fn().mockResolvedValue({file: {path: 'src/limiter.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}, patch: '', hunks: []})
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([{path: 'src/limiter.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}]),
      GetDiff: getDiff,
    }}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    const workbench = screen.getByRole('region', {name: 'Agent judgment: Callback runs while locked'})
    expect(workbench).toHaveTextContent('From Decision recording')
    expect(workbench).toHaveTextContent('Why this matters')
    expect(workbench).toHaveTextContent('Evidence')
    expect(workbench).toHaveTextContent('Existing discussion')
    expect(workbench).toHaveTextContent('Can this race?')
    expect(workbench).toHaveTextContent('Your decision')
    expect(workbench).not.toHaveTextContent('What would need to be true')
    expect(screen.queryByText(/questions judged/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: /Next question/})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Read full generated analysis'}))
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
    const chapterProgress = screen.getByRole('combobox', {name: 'Analysis progress'})
    expect(chapterProgress).toHaveTextContent('In progress')
    fireEvent.click(chapterProgress)
    expect(await screen.findByRole('option', {name: 'Not reviewed'})).toBeInTheDocument()
    expect(screen.getByRole('option', {name: 'Needs clarification'})).toBeInTheDocument()
    expect(screen.queryByText('You have not started this chapter.')).not.toBeInTheDocument()
    fireEvent.keyDown(chapterProgress, {key: 'Escape'})

    const fullDiff = screen.getByRole('button', {name: 'Open full diff'})
    expect(fullDiff.closest('.review-header')).toBeInTheDocument()
    expect(reader).not.toContainElement(fullDiff)
    fireEvent.click(fullDiff)
    await waitFor(() => expect(getDiff).toHaveBeenCalledWith(session.id, 'src/limiter.ts'))
    expect(await screen.findByRole('button', {name: 'Back to finding'})).toBeInTheDocument()
    const unified = screen.getByRole('button', {name: 'Unified diff'})
    const split = screen.getByRole('button', {name: 'Split diff'})
    expect(unified).toHaveAttribute('aria-pressed', 'true')
    expect(split).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(split)
    expect(split).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', {name: 'No textual changes'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Back to finding'}))
    expect(screen.getByRole('region', {name: 'Agent judgment: Callback runs while locked'})).toBeInTheDocument()
    expect(screen.queryByRole('combobox', {name: 'Analysis progress'})).not.toBeInTheDocument()
  })

  it('moves directly between judgments and ends at the review decision', () => {
    const session = reviewSession()
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/> )

    expect(screen.getByRole('region', {name: 'Agent judgment: Callback runs while locked'})).toBeInTheDocument()
    expect(document.querySelector('.judgment-position')).toHaveTextContent('1 of 2')
    expect(screen.getByRole('button', {name: 'Previous judgment'})).toBeDisabled()

    fireEvent.click(screen.getByRole('button', {name: 'Next judgment'}))
    expect(screen.getByRole('region', {name: 'Agent judgment: Whether reentrant recorders are supported is unspecified.'})).toBeInTheDocument()
    expect(document.querySelector('.judgment-position')).toHaveTextContent('2 of 2')
    expect(screen.queryByRole('button', {name: 'Next judgment'})).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Previous judgment'}))
    expect(screen.getByRole('region', {name: 'Agent judgment: Callback runs while locked'})).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Next judgment'}))
    fireEvent.click(screen.getByRole('button', {name: 'Open final review decision'}))
    expect(screen.getByRole('heading', {name: 'Can this PR be approved?'})).toBeInTheDocument()
  })

  it('enables approval after the agent findings are explicitly accepted', async () => {
    const session = reviewSession()
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    function ControlledReview() {
      const [reviews, setReviews] = useState<DecisionReviewMap>({'unknown:unknown-1': {disposition: 'accepted', note: 'The unsupported behavior is outside the public contract.'}})
      return <ReviewWorkspace session={session} decisionReview={reviews} onDecisionReview={(id, review) => setReviews((current) => ({...current, [id]: review}))} onSession={vi.fn()} onBack={vi.fn()}/>
    }
    render(<ControlledReview/>)

    fireEvent.click(screen.getByRole('button', {name: 'Accept with rationale'}))
    const rationale = screen.getByRole('textbox', {name: 'Why can this be approved?'})
    expect(screen.getByRole('button', {name: 'Confirm acceptance'})).toBeDisabled()
    fireEvent.change(rationale, {target: {value: 'The recorder is internal and guaranteed to be non-reentrant.'}})
    fireEvent.click(screen.getByRole('button', {name: 'Confirm acceptance'}))
    expect(screen.getByRole('button', {name: 'Undo accepted tradeoff'})).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/questions judged/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Open review decision'}))
    expect(screen.getByRole('heading', {name: 'Can this PR be approved?'})).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getAllByText('The recorder is internal and guaranteed to be non-reentrant.')).toHaveLength(2)
    expect(screen.getByText('No unresolved agent judgments.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Approve'})).toBeEnabled()
  })

  it('can open a clean agent review directly at the human approval decision', () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, analysis: {...base.analysis!, risks: [], unknowns: [], chapters: base.analysis!.chapters.map((chapter) => ({...chapter, risks: [], unknowns: []}))}}
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    render(<ReviewWorkspace session={session} initialSummaryOpen onSession={vi.fn()} onBack={vi.fn()}/>)

    expect(screen.getByRole('heading', {name: 'Can this PR be approved?'})).toBeInTheDocument()
    expect(screen.getByText('The agent reported no decision-critical findings.')).toBeInTheDocument()
    expect(screen.getByText('No checks configured')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Approve'})).toBeEnabled()
  })

  it('returns directly from the final decision to the selected unresolved finding', () => {
    const session = reviewSession()
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', {name: 'Open review decision'}))
    fireEvent.click(screen.getByRole('button', {name: 'Open judgment: Whether reentrant recorders are supported is unspecified.'}))

    expect(screen.queryByRole('heading', {name: 'Can this PR be approved?'})).not.toBeInTheDocument()
    expect(screen.getByRole('region', {name: 'Agent judgment: Whether reentrant recorders are supported is unspecified.'})).toBeInTheDocument()
  })

  it('explains stale decision blockers and starts reanalysis from the review summary', async () => {
    const base = reviewSession()
    const session: ReviewSession = {...base, isStale: true, staleReason: 'Pull request revisions changed.', analysisStatus: 'stale'}
    const startAnalysis = vi.fn().mockResolvedValue({id: 'operation-1', sessionId: session.id, kind: 'analysis', stage: 'preparingContext', message: 'Preparing context', state: 'running'})
    const onSession = vi.fn()
    const onBack = vi.fn()
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([]),
      StartAnalysis: startAnalysis,
    }}}
    render(<ReviewWorkspace session={session} onSession={onSession} onBack={onBack}/>)

    fireEvent.click(screen.getByRole('button', {name: 'Open review decision'}))
    expect(screen.getByText('This PR changed since it was analyzed.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Continue review'})).toBeEnabled()
    expect(screen.queryByRole('button', {name: 'Approve'})).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {name: 'Reanalyze latest revision'}))
    await waitFor(() => expect(startAnalysis).toHaveBeenCalledWith(session.id))
    expect(onSession).toHaveBeenCalledWith({...session, analysisStatus: 'queued'})
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('discards a review preview when the user keeps editing', async () => {
    const session = reviewSession()
    const discard = vi.fn().mockResolvedValue(undefined)
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([]),
      PreparePublish: vi.fn().mockResolvedValue({token: 'publish-token', digest: 'digest', repository: 'acme/api', number: 1, headSha: 'head', items: [{draftId: 'draft-1', kind: 'general', body: 'Draft question'}], event: 'COMMENT', expiresAt: '2026-07-12T00:05:00Z'}),
      DiscardPublishPreview: discard,
    }}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', {name: '1 drafts'}))
    fireEvent.click(screen.getByRole('button', {name: 'Preview 1 comment'}))
    expect(await screen.findByRole('heading', {name: 'Publish comments?'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Keep editing'}))

    await waitFor(() => expect(discard).toHaveBeenCalledWith('publish-token'))
    expect(screen.queryByRole('heading', {name: 'Publish comments?'})).not.toBeInTheDocument()
  })

  it('discards an open review preview when the workspace unmounts', async () => {
    const session = reviewSession()
    const discard = vi.fn().mockResolvedValue(undefined)
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([]),
      PreparePublish: vi.fn().mockResolvedValue({token: 'unmount-token', digest: 'digest', repository: 'acme/api', number: 1, headSha: 'head', items: [{draftId: 'draft-1', kind: 'general', body: 'Draft question'}], event: 'COMMENT', expiresAt: '2026-07-12T00:05:00Z'}),
      DiscardPublishPreview: discard,
    }}}
    const view = render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', {name: '1 drafts'}))
    fireEvent.click(screen.getByRole('button', {name: 'Preview 1 comment'}))
    expect(await screen.findByRole('heading', {name: 'Publish comments?'})).toBeInTheDocument()
    view.unmount()

    await waitFor(() => expect(discard).toHaveBeenCalledWith('unmount-token'))
  })

  it('opens validated surrounding code from the finding without loading the full diff', async () => {
    const session = reviewSession()
    const getFile = vi.fn().mockResolvedValue({path: 'src/limiter.ts', revision: 'head', sha: 'head', content: Array.from({length: 15}, (_, index) => index === 9 ? 'const answer = 42' : `line ${index + 1}`).join('\n'), isBinary: false, lineCount: 15})
    const getDiff = vi.fn()
    window.go = {main: {App: {
      GetChangedFiles: vi.fn().mockResolvedValue([{path: 'src/limiter.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}]),
      GetDiff: getDiff,
      GetFile: getFile,
    }}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    expect(screen.getByRole('region', {name: 'Agent judgment: Callback runs while locked'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Open surrounding code'}))
    await waitFor(() => expect(getFile).toHaveBeenCalledWith(session.id, 'src/limiter.ts', 'head'))
    expect(await screen.findByRole('region', {name: 'head file context for src/limiter.ts'})).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.evidence-file-renderer')).toHaveTextContent('const answer = 42'))
    expect(getDiff).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: 'Back to finding'}))
    expect(screen.getByRole('region', {name: 'Agent judgment: Callback runs while locked'})).toBeInTheDocument()
  })

  it('turns an agent finding into an editable local author draft', () => {
    const session = reviewSession()
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', {name: 'Draft comment'}))

    expect(screen.getByText('Review drafts')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Write a clear, actionable review comment…')).toHaveValue('Please address this review judgment:\n\nCallback runs while locked\n\nA slow or reentrant recorder can block callers.')
  })

  it('keeps evidence, notes, and drafts reachable without restoring a finding queue', async () => {
    const session = reviewSession()
    window.go = {main: {App: {GetChangedFiles: vi.fn().mockResolvedValue([])}}}
    render(<ReviewWorkspace session={session} onSession={vi.fn()} onBack={vi.fn()}/>)

    const tools = screen.getByRole('button', {name: 'Review tools'})
    expect(tools).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', {name: 'Questions'})).not.toBeInTheDocument()
    expect(document.getElementById('review-chapters-panel')).not.toBeInTheDocument()

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
	const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
	document.elementFromPoint = vi.fn().mockReturnValue(rightLine(6))
	fireEvent.pointerDown(rightLine(4), {pointerType: 'mouse', button: 0, pointerId: 1})
	fireEvent.pointerMove(document, {pointerType: 'mouse', button: 0, pointerId: 1, clientX: 1, clientY: 1})
	await waitFor(() => expect(root.querySelectorAll('[data-selected-line]').length).toBeGreaterThan(2))
	fireEvent.pointerUp(document, {pointerType: 'mouse', button: 0, pointerId: 1, clientX: 1, clientY: 1})
	if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
	else Reflect.deleteProperty(document, 'elementFromPoint')
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
	expect(screen.queryByRole('combobox', {name: 'Analysis progress'})).not.toBeInTheDocument()
	fireEvent.click(screen.getByRole('button', {name: 'Show 1 more'}))
	expect(screen.getByRole('button', {name: 'Symbol 7'})).toBeInTheDocument()
	fireEvent.click(screen.getAllByRole('button', {name: /src\/first\.tsL1/})[0])
	fireEvent.click(screen.getAllByRole('button', {name: /src\/second\.tsL1/})[0])
	resolveSecond({path: 'src/second.ts', revision: 'head', sha: 'head', content: 'second file wins\n', isBinary: false, lineCount: 1})
	await waitFor(() => expect(document.querySelector('.evidence-file-renderer [data-line="1"]')).toHaveTextContent('second file wins'))
	resolveFirst({path: 'src/first.ts', revision: 'head', sha: 'head', content: 'stale first file\n', isBinary: false, lineCount: 1})
	await Promise.resolve()
	expect(document.querySelector('.evidence-file-renderer [data-line="1"]')).toHaveTextContent('second file wins')
	resolveSecondDiff({file: {path: 'src/second.ts', previousPath: '', status: 'modified', additions: 0, deletions: 0, isBinary: true}, patch: '', hunks: []})
	resolveFirstDiff({file: {path: 'src/first.ts', previousPath: '', status: 'modified', additions: 1, deletions: 0, isBinary: false}, patch: 'diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -0,0 +1 @@\n+stale\n', hunks: []})
	fireEvent.click(screen.getByRole('button', {name: 'Open full diff'}))
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
