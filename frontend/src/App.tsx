import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Download,
  Columns2, Command, ExternalLink, FileDiff, GitPullRequest, Inbox, LoaderCircle,
  Maximize2, MessageSquare, Minimize2, Monitor, Moon, PanelRight, RefreshCw, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Sun, X,
} from 'lucide-react'
import { backend } from './bridge'
import { AnalysisBadge, DependencyPills, ErrorBanner, Logo, Markdown, RiskBadge, SelectControl, Skeleton, WindowControls } from './components'
import { useDialogFocus } from './dialog'
import { errorText } from './errors'
import { InboxScreen } from './features/inbox/InboxScreen'
import {
  ChapterEvidenceIndex, ChapterReader, DiffView, DraftsPanel, FileContextView, NotesPanel, PublishConfirmation, ReviewSummary,
  SplitDiffView, SymbolNavigator, ThreadReplyConfirmation, draftTargetFor, type DraftTarget,
} from './features/review/ReviewContent'
import { AgentFindingDetail, AgentReviewBrief, ReviewGatePanel } from './features/review/DecisionMode'
import { buildAgentReviewBrief, reviewGate, type DecisionReview, type DecisionReviewMap } from './features/review/decision'
import { SourceSelector } from './features/sources/SourceSelector'
import { WindowToggleMaximise } from '../wailsjs/runtime/runtime'
import { relativeTime, repoName } from './lib'
import { useTheme, type ThemePreference } from './theme'
import {
  AIAnalysisSettings, AnalysisFailurePanel, AnalysisProfilePicker, AnalysisProfileSummary, AnalysisProgress,
  AnalysisRunDetails, NoHarnessState, analysisCoverageBreakdown, analysisProfileReady, legacyAnalysisConfiguration, recommendedProfile,
} from './features/analysis/analysis'
import type {
  AnalysisConfiguration, AnalysisFailure, AnalysisProfile, AnalysisRun, BootstrapState, ChangedFile, ChapterStatus, DependencyStatus, DiffFile, EnvironmentState, EvidenceReference, FileContent, Operation,
  OperationEvent, PublishPreview, PullRequestReviewComment, PullRequestSummary,
  ReviewComment, ReviewSession, SoftwareUpdateStatus, UpdateChannel,
  ThreadReplyPreview,
} from './types'

export { DiffView, FileContextView, SourceSelector, SplitDiffView }

type Screen = 'inbox' | 'sources' | 'settings' | 'overview' | 'review'
function toggleWindowOnHeaderDoubleClick(event: ReactMouseEvent<HTMLElement>) {
  if ((event.target as HTMLElement).closest('button, a, input, textarea, select, label')) return
  WindowToggleMaximise()
}


function withEnvironment(state: BootstrapState, environment: EnvironmentState): BootstrapState {
  return {...state, dependencies: environment.dependencies, account: environment.account, gitProtocol: environment.gitProtocol, environmentCached: false}
}

export function App() {
  const theme = useTheme()
  const [bootstrap, setBootstrap] = useState<BootstrapState>()
  const [screen, setScreen] = useState<Screen>('inbox')
  const [session, setSession] = useState<ReviewSession>()
  const [openingPR, setOpeningPR] = useState<PullRequestSummary>()
  const [reviewChapterId, setReviewChapterId] = useState('')
  const [reviewFindingId, setReviewFindingId] = useState('')
  const [decisionReview, setDecisionReview] = useState<DecisionReviewMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [softwareUpdate, setSoftwareUpdate] = useState<SoftwareUpdateStatus>()
  const [updateBusy, setUpdateBusy] = useState(false)
  const [dismissedUpdateBuild, setDismissedUpdateBuild] = useState('')
  const [installUpdateOpen, setInstallUpdateOpen] = useState(false)
  const [analysisConfiguration, setAnalysisConfiguration] = useState<AnalysisConfiguration>()
  const [analysisConfigurationBusy, setAnalysisConfigurationBusy] = useState(false)
  const [analysisConfigurationError, setAnalysisConfigurationError] = useState('')
  const updateInbox = useCallback((update: (items: PullRequestSummary[]) => PullRequestSummary[]) => setBootstrap((current) => current ? {...current, inbox: update(current.inbox)} : current), [])
  const openRequest = useRef(0)
  const environmentRequest = useRef(0)

  const refreshEnvironment = async (foreground = false, sourceState = bootstrap) => {
    const request = ++environmentRequest.current
    if (foreground) { setLoading(true); setError('') }
    try {
      const environment = await backend.refreshEnvironment()
      if (environmentRequest.current === request) {
        setBootstrap((current) => current ? withEnvironment(current, environment) : current)
        if (environment.account && sourceState && !sourceState.selections.some((selection) => selection.enabled)) setScreen('sources')
      }
    } catch (err) {
      if (foreground && environmentRequest.current === request) setError(errorText(err))
    } finally {
      if (foreground && environmentRequest.current === request) setLoading(false)
    }
  }

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [state, updateStatus] = await Promise.all([backend.bootstrap(), backend.getUpdateStatus()])
      setBootstrap(state)
      setSoftwareUpdate(updateStatus)
      state.selections ??= []
      state.inbox ??= []
      if (state.account && !state.selections.some((s) => s.enabled)) setScreen('sources')
      if (state.environmentCached) void refreshEnvironment(false, state)
    } catch (err) { setError(errorText(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => backend.on('reviewarc:update:v1', (raw) => setSoftwareUpdate(raw as SoftwareUpdateStatus)), [])
  useEffect(() => {
    if (!bootstrap || analysisConfiguration || typeof window.go?.main?.App?.GetAnalysisConfiguration !== 'function') return
    void (async () => {
      try { setAnalysisConfigurationError(''); setAnalysisConfiguration(await backend.getAnalysisConfiguration()) }
      catch (err) { setAnalysisConfigurationError(errorText(err)) }
    })()
  }, [analysisConfiguration, bootstrap])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openPR = async (pr: PullRequestSummary) => {
	const request = ++openRequest.current
	setError(''); setSession(undefined); setOpeningPR(pr); setReviewChapterId(''); setReviewFindingId(''); setDecisionReview({}); setScreen('overview')
	let value: ReviewSession
	try { value = await backend.openPullRequest(pr.ref) }
	catch (err) { if (openRequest.current === request) { setOpeningPR(undefined); setScreen('inbox'); setError(errorText(err)) }; return }
	if (openRequest.current !== request) return
	setSession(value); setOpeningPR(undefined)
	try {
	  const hydrated = await backend.refreshPullRequestContext(value.id)
	  if (openRequest.current === request && hydrated.id === value.id) setSession(hydrated)
	} catch (err) {
	  if (openRequest.current === request) setError(`Pull request opened, but GitHub discussion and checks could not be loaded: ${errorText(err)}`)
	}
  }
  const checkForUpdates = async () => {
    setUpdateBusy(true)
    try { setSoftwareUpdate(await backend.checkForUpdates()) }
    catch (err) { setError(errorText(err)) }
    finally { setUpdateBusy(false) }
  }
  const setUpdateChannel = async (channel: UpdateChannel) => {
    setUpdateBusy(true)
    try { setSoftwareUpdate(await backend.setUpdateChannel(channel)); setDismissedUpdateBuild('') }
    catch (err) { setError(errorText(err)) }
    finally { setUpdateBusy(false) }
  }
  const installUpdate = async () => {
    setUpdateBusy(true)
    try { await backend.installUpdate() }
    catch (err) { setError(errorText(err)) }
    finally { setUpdateBusy(false) }
  }
  const refreshAnalysisHarnesses = async () => {
    if (typeof window.go?.main?.App?.RefreshAnalysisHarnesses !== 'function') return
    setAnalysisConfigurationBusy(true); setAnalysisConfigurationError('')
    try { setAnalysisConfiguration(await backend.refreshAnalysisHarnesses()) }
    catch (err) { setAnalysisConfigurationError(errorText(err)) }
    finally { setAnalysisConfigurationBusy(false) }
  }
  const saveAnalysisDefaults = async (profile: AnalysisProfile) => {
    if (typeof window.go?.main?.App?.SaveAnalysisDefaults !== 'function') return
    setAnalysisConfigurationBusy(true); setAnalysisConfigurationError('')
    try { setAnalysisConfiguration(await backend.saveAnalysisDefaults(profile)) }
    catch (err) { setAnalysisConfigurationError(errorText(err)); throw err }
    finally { setAnalysisConfigurationBusy(false) }
  }

  useEffect(() => backend.on('reviewarc:check-for-updates:v1', () => {
    setScreen('settings')
    setError('')
    void (async () => {
      setUpdateBusy(true)
      try {
        const status = await backend.getUpdateStatus()
        setSoftwareUpdate(status)
        if (status.state === 'idle' || status.state === 'failed') setSoftwareUpdate(await backend.checkForUpdates())
      } catch (err) { setError(errorText(err)) }
      finally { setUpdateBusy(false) }
    })()
  }), [])

  if (loading && !bootstrap) return <StartupLoading />
  if (!bootstrap) return <main className="startup"><WindowControls/><Logo/><ErrorBanner message={error || 'ReviewArc could not load its local state.'} onRetry={() => void load()}/></main>

  const missingRequired = bootstrap.dependencies.filter((dep) => dep.name !== 'codex' && dep.state !== 'available')
  if (missingRequired.length || !bootstrap.account) return <DependencyGate state={bootstrap} onRefresh={() => void refreshEnvironment(true)} refreshing={loading} error={error}/>

  const configurableAnalysisBackend = typeof window.go?.main?.App?.GetAnalysisConfiguration === 'function'
  const effectiveAnalysisConfiguration = analysisConfiguration ?? (configurableAnalysisBackend ? undefined : legacyAnalysisConfiguration(bootstrap.dependencies))

  return <div className="app-shell">
    <AppHeader state={bootstrap} analysisConfiguration={effectiveAnalysisConfiguration} screen={screen} onNavigate={(next) => { setScreen(next); if (next === 'inbox') { openRequest.current++; setSession(undefined); setOpeningPR(undefined) } }}/>
    {(softwareUpdate?.state === 'available' || softwareUpdate?.state === 'ready') && softwareUpdate.release && softwareUpdate.release.build !== dismissedUpdateBuild && <UpdateBanner update={softwareUpdate} busy={updateBusy} onLater={() => setDismissedUpdateBuild(softwareUpdate.release!.build)} onInstall={() => setInstallUpdateOpen(true)}/>}
    {error && <div className="global-error"><ErrorBanner message={error} onRetry={() => setError('')} actionLabel="Dismiss"/></div>}
    {screen === 'sources' && <SourceSelector state={bootstrap} onDone={async () => { const next = await backend.bootstrap(); setBootstrap({...next, account: bootstrap.account}); setScreen('inbox') }} />}
    {screen === 'settings' && (
      <SettingsScreen state={bootstrap} theme={theme.preference} onThemeChange={theme.setPreference} update={softwareUpdate} updateBusy={updateBusy} onCheckUpdate={() => void checkForUpdates()} onSetUpdateChannel={(channel) => void setUpdateChannel(channel)} onInstallUpdate={() => setInstallUpdateOpen(true)} onSources={() => setScreen('sources')} analysisConfiguration={effectiveAnalysisConfiguration} analysisConfigurationLoading={configurableAnalysisBackend && !analysisConfiguration && !analysisConfigurationError} analysisConfigurationBusy={analysisConfigurationBusy} analysisConfigurationError={analysisConfigurationError} onRefreshAnalysis={() => void refreshAnalysisHarnesses()} onSaveAnalysisDefaults={saveAnalysisDefaults}/>
    )}
    {screen === 'inbox' && <InboxScreen state={bootstrap} onUpdate={updateInbox} onOpen={(pr) => void openPR(pr)}/>}
    {openingPR && screen === 'overview' && <OpeningPullRequest pr={openingPR} onBack={() => { openRequest.current++; setOpeningPR(undefined); setScreen('inbox') }}/>}
    {session && screen === 'overview' && !effectiveAnalysisConfiguration && (
      <AnalysisConfigurationGate session={session} error={analysisConfigurationError} busy={analysisConfigurationBusy} onRetry={() => void refreshAnalysisHarnesses()} onBack={() => { openRequest.current++; setSession(undefined); setReviewChapterId(''); setReviewFindingId(''); setDecisionReview({}); setScreen('inbox') }}/>
    )}
    {session && screen === 'overview' && effectiveAnalysisConfiguration && (
      <OverviewScreen session={session} analysisConfiguration={effectiveAnalysisConfiguration} legacyAnalysis={!configurableAnalysisBackend} decisionReview={decisionReview} onAnalysisConfiguration={(configuration) => setAnalysisConfiguration(configuration)} onRefreshHarnesses={() => void refreshAnalysisHarnesses()} onOpenSettings={() => setScreen('settings')} onBack={() => { openRequest.current++; setSession(undefined); setReviewChapterId(''); setReviewFindingId(''); setDecisionReview({}); setScreen('inbox') }} onSession={setSession} onReview={(chapterId, findingId) => { setReviewChapterId(chapterId ?? ''); setReviewFindingId(findingId ?? ''); setScreen('review') }}/>
    )}
    {session && screen === 'review' && (
      <ReviewWorkspace session={session} initialChapterId={reviewChapterId} initialFindingId={reviewFindingId} initialSummaryOpen={reviewFindingId === '__summary__'} decisionReview={decisionReview} onDecisionReview={(id, review) => setDecisionReview((current) => ({...current, [id]: review}))} onSession={setSession} onBack={() => setScreen('overview')}/>
    )}
    {commandOpen && <CommandPalette items={bootstrap.inbox} onClose={() => setCommandOpen(false)} onOpen={(pr) => { setCommandOpen(false); void openPR(pr) }}/>}
    {installUpdateOpen && softwareUpdate?.release && <UpdateInstallConfirmation update={softwareUpdate} busy={updateBusy} onCancel={() => setInstallUpdateOpen(false)} onConfirm={() => { setInstallUpdateOpen(false); void installUpdate() }}/>}
  </div>
}

function AnalysisConfigurationGate({session, error, busy, onRetry, onBack}: {session: ReviewSession; error: string; busy: boolean; onRetry: () => void; onBack: () => void}) {
  const pr = session.pullRequest
  return <main className="detail-page opening-pr" aria-busy={!error || busy}><div className="detail-top"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Inbox</button></div><header className="pr-hero"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1></div><div className="opening-status">{!error || busy ? <><LoaderCircle className="spin" size={17}/><span>Loading AI analysis setup…</span></> : <><AlertTriangle size={17}/><span>AI analysis setup could not be loaded.</span><button className="button secondary small" onClick={onRetry}>Try again</button></>}</div></header>{error && !busy && <ErrorBanner message={error}/>}<section className="opening-detail"><Skeleton rows={4}/></section></main>
}

function OpeningPullRequest({pr, onBack}: {pr: PullRequestSummary; onBack: () => void}) {
  return <main className="detail-page opening-pr" aria-busy="true" aria-live="polite"><div className="detail-top"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Inbox</button></div><header className="pr-hero"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1><div className="hero-meta"><span>by @{pr.author.login}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="opening-status"><LoaderCircle className="spin" size={17}/><span>Loading pull request context…</span></div></header><section className="opening-detail"><Skeleton rows={6}/></section></main>
}

function StartupLoading() {
  return <main className="startup"><WindowControls/><Logo/><div className="startup-copy"><LoaderCircle className="spin" size={20}/><span>Checking your local review workspace…</span></div></main>
}

function dependencyLabel(name: DependencyStatus['name']) { return name === 'gh' ? 'GitHub CLI' : name === 'git' ? 'Git' : 'Codex CLI' }

function missingDependencyHelp(name: DependencyStatus['name']) {
  if (name === 'gh') return <>Finder-launched apps use a limited environment. Install with <code>brew install gh</code>, or ensure <code>command -v gh</code> reports a standard executable location, then check again.</>
  if (name === 'codex') return <>Finder-launched apps use a limited environment. Install or update Codex CLI, confirm <code>command -v codex</code> in Terminal, then check again.</>
  return <>Install Git, then check again. ReviewArc will not modify your shell configuration.</>
}

function DependencyGate({state, onRefresh, refreshing, error}: {state: BootstrapState; onRefresh: () => void; refreshing: boolean; error: string}) {
  const requiredDependencies = state.dependencies.filter((dependency) => dependency.name !== 'codex')
  return <main className="onboarding">
    <header onDoubleClick={toggleWindowOnHeaderDoubleClick}><WindowControls/><Logo/><DependencyPills dependencies={requiredDependencies}/></header>
    <section className="onboarding-body">
      <div className="onboarding-intro"><span className="arc-line"/><h1>Your pull requests,<br/>ready to understand.</h1><p>ReviewArc uses the tools already trusted on your machine and creates isolated Git caches for pull-request analysis. No existing local checkout is required.</p></div>
      <div className="setup-panel">
        <h2>Connect your review workspace</h2>
        <p>Git and GitHub CLI connect ReviewArc to your pull requests.</p>
        <div className="setup-list">{requiredDependencies.map((dep) => <div className="setup-row" key={dep.name}>
          <span className={`setup-status ${dep.state}`}>{dep.state === 'available' ? <Check size={15}/> : <X size={15}/>}</span>
          <div><strong>{dependencyLabel(dep.name)}</strong><small>{dep.state === 'available' ? dep.version || 'Available' : dep.message || 'Not detected by ReviewArc'}</small>{dep.state !== 'available' && <p className="dependency-help">{missingDependencyHelp(dep.name)}</p>}</div>
          <code title={dep.path}>{dep.path || dep.name}</code>
        </div>)}</div>
        {!state.account && state.dependencies.find((dep) => dep.name === 'gh')?.state === 'available' && <div className="auth-guidance"><ShieldCheck size={19}/><div><strong>GitHub sign-in required</strong><p>Open Terminal and run <code>gh auth login</code>. ReviewArc never stores your GitHub token.</p></div></div>}
        {error && <ErrorBanner message={error}/>}<button className="button primary wide" disabled={refreshing} onClick={onRefresh}>{refreshing ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} {refreshing ? 'Checking again' : 'Check again'}</button>
      </div>
    </section>
  </main>
}

export function headerDependencies(dependencies: DependencyStatus[], configuration?: AnalysisConfiguration): DependencyStatus[] {
  const coreDependencies = dependencies.filter((dependency) => dependency.name !== 'codex' && dependency.name !== 'claude')
  const selectedHarness = configuration?.harnesses.find((harness) => harness.id === configuration.defaultProfile?.harness)
  if (!selectedHarness || (selectedHarness.id !== 'codex' && selectedHarness.id !== 'claude')) return coreDependencies
  const state = selectedHarness.availability === 'available' && selectedHarness.eligible
    ? 'available'
    : selectedHarness.availability === 'missing' ? 'missing' : 'broken'
  return [...coreDependencies, {
    name: selectedHarness.id,
    state,
    path: selectedHarness.path,
    version: selectedHarness.version,
    message: selectedHarness.message,
  }]
}

function AppHeader({state, analysisConfiguration, screen, onNavigate}: {state: BootstrapState; analysisConfiguration?: AnalysisConfiguration; screen: Screen; onNavigate: (screen: Screen) => void}) {
  const accountName = state.account?.name || state.account?.login || 'GitHub account'
  const accountLogin = state.account?.login
  return <header className="app-header" onDoubleClick={toggleWindowOnHeaderDoubleClick}>
    <WindowControls/>
    <button className="brand-button" onClick={() => onNavigate('inbox')}><Logo/></button>
    <nav aria-label="Primary"><button className={screen === 'inbox' ? 'active' : ''} onClick={() => onNavigate('inbox')}><Inbox size={16}/>Inbox</button><button className={screen === 'sources' ? 'active' : ''} onClick={() => onNavigate('sources')}><SlidersHorizontal size={16}/>Sources</button></nav>
    <div className="header-spacer"/><DependencyPills dependencies={headerDependencies(state.dependencies, analysisConfiguration)}/>
    <button className={`account-chip${screen === 'settings' ? ' active' : ''}`} aria-label={`Open settings for ${accountName}${accountLogin ? ` (@${accountLogin})` : ''}`} aria-current={screen === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}>
      {state.account?.avatarUrl ? <img src={state.account.avatarUrl} alt=""/> : <span>{accountLogin?.slice(0, 1).toUpperCase()}</span>}
      <div><strong>{accountName}</strong>{accountLogin && <small>@{accountLogin}</small>}</div><Settings className="account-settings-icon" size={16}/>
    </button>
  </header>
}



function trapPanelFocus(event: KeyboardEvent, panel: HTMLElement) {
  if (event.key !== 'Tab') return
  const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}


const legacyOverviewAnalysisConfiguration = legacyAnalysisConfiguration([{name: 'codex', state: 'available'}])

function operationFailure(message: string, hasPreviousAnalysis: boolean): AnalysisFailure {
  const oversized = /input exceeds|maximum length|max_chars|input_too_large/i.test(message)
  return oversized ? {
    code: 'input_too_large', title: 'This change exceeded the analysis limit',
    message: 'ReviewArc did not repeat the same oversized request. Change the analysis setup or wait for ReviewArc to create a bounded plan.',
    action: 'changeProfile', technicalDetails: message,
  } : {
    code: 'analysis_failed', title: 'Analysis did not complete',
    message: hasPreviousAnalysis ? 'The previous guided review is still available.' : 'No guided review was created. Check the analysis setup and try again.',
    action: 'retry', technicalDetails: message,
  }
}

export function appendOperationEvent(current: OperationEvent[], event: OperationEvent) {
  return [...current.filter((existing) => existing.stage !== event.stage), event]
}

function eventForOperation(operation: Operation): OperationEvent {
  const completed = operation.state === 'complete' || operation.state === 'completed'
  const failed = operation.state === 'failed'
  const cancelled = operation.state === 'cancelled'
  return {stage: operation.stage, message: operation.message, progress: operation.progress, status: completed ? 'complete' : failed ? 'failed' : cancelled ? 'complete' : 'running', updatedAt: operation.updatedAt}
}

function mergeOperationEvents(history: Operation[], current: OperationEvent[]) {
  return [...history.map(eventForOperation), ...current].reduce<OperationEvent[]>((events, event) => appendOperationEvent(events, event), [])
}

export function OverviewScreen({session, analysisConfiguration = legacyOverviewAnalysisConfiguration, legacyAnalysis = true, decisionReview = {}, onAnalysisConfiguration = () => {}, onRefreshHarnesses = () => {}, onOpenSettings = () => {}, onBack, onSession, onReview}: {session: ReviewSession; analysisConfiguration?: AnalysisConfiguration; legacyAnalysis?: boolean; decisionReview?: DecisionReviewMap; onAnalysisConfiguration?: (configuration: AnalysisConfiguration) => void; onRefreshHarnesses?: () => void; onOpenSettings?: () => void; onBack: () => void; onSession: (session: ReviewSession) => void; onReview: (chapterId?: string, findingId?: string) => void}) {
  const pr = session.pullRequest; const analysis = session.analysis; const persistedFailure = session.latestAnalysisRun?.status === 'failed' ? session.latestAnalysisRun.failure : undefined; const [operation, setOperation] = useState<Operation>(); const [events, setEvents] = useState<OperationEvent[]>([]); const [failure, setFailure] = useState<AnalysisFailure | undefined>(persistedFailure); const [profile, setProfile] = useState<AnalysisProfile | undefined>(() => recommendedProfile(analysisConfiguration)); const [profileOpen, setProfileOpen] = useState(false); const [coverageOpen, setCoverageOpen] = useState(false); const [coverageFocus, setCoverageFocus] = useState<{kind: 'previewed' | 'unseen' | 'legacy'; request: number}>({kind: 'legacy', request: 0})
  const [checksRefreshing, setChecksRefreshing] = useState(false)
  const [checkRefreshError, setCheckRefreshError] = useState('')
  const gate = useMemo(() => reviewGate(pr.checkRuns), [pr.checkRuns])
  const previousGateStatus = useRef(gate.status)
  const reviewPaused = gate.status === 'blocked' || gate.status === 'waiting'
  useEffect(() => { setProfile(recommendedProfile(analysisConfiguration)); setProfileOpen(false) }, [analysisConfiguration])
  useEffect(() => { setFailure(session.latestAnalysisRun?.status === 'failed' ? session.latestAnalysisRun.failure : undefined) }, [session.id, session.latestAnalysisRun?.id, session.latestAnalysisRun?.status, session.latestAnalysisRun?.failure])
  useEffect(() => { setOperation(undefined); setEvents([]) }, [session.id])
  useEffect(() => { setCoverageOpen(false) }, [session.latestAnalysisRun?.id])
  useEffect(() => {
    if (!coverageOpen || coverageFocus.request === 0) return undefined
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-analysis-coverage-kind="${coverageFocus.kind}"]`)
      target?.focus({preventScroll: true})
      target?.scrollIntoView?.({behavior: 'smooth', block: 'nearest'})
    })
    return () => cancelAnimationFrame(frame)
  }, [coverageOpen, coverageFocus])
  useEffect(() => {
    let disposed = false
    let terminalSeen = false
    let liveSeen = false
    const reloadSession = async () => {
      try { const next = await backend.getSession(session.id); if (!disposed) onSession(next) }
      catch (err) { if (!disposed) setFailure({code: 'session_reload_failed', title: 'Analysis state could not be refreshed', message: 'Return to the inbox and reopen this pull request.', action: 'none', technicalDetails: errorText(err)}) }
    }
    const offOperation = backend.on('reviewarc:operation:v1', (raw) => {
      const op = raw as Operation
      if (op.sessionId && op.sessionId !== session.id) return
      liveSeen = true
      terminalSeen = ['complete', 'completed', 'failed', 'cancelled'].includes(op.state)
      setOperation(op)
      setEvents((current) => appendOperationEvent(current, eventForOperation(op)))
      if (op.state === 'failed') setFailure(op.failure ?? operationFailure(op.message || 'The analysis process stopped unexpectedly.', Boolean(analysis)))
      if (terminalSeen) void reloadSession()
    })
    const offSession = backend.on('reviewarc:session:v1', (raw) => { const value = raw as {sessionId?: string}; if (value.sessionId === session.id) void reloadSession() })
    if (session.analysisStatus === 'queued' || session.analysisStatus === 'running') {
      backend.getActiveAnalysisOperation(session.id).then((snapshot) => {
        if (disposed || terminalSeen) return
        if (!snapshot) { void reloadSession(); return }
        if (!liveSeen) setOperation(snapshot.operation)
        setEvents((current) => mergeOperationEvents(snapshot.events, current))
      }).catch((err) => { if (!disposed) setFailure(operationFailure(errorText(err), Boolean(analysis))) })
    }
    return () => { disposed = true; offOperation(); offSession() }
  }, [analysis, session.id, session.analysisStatus, onSession])
  const refreshChecks = useCallback(async () => {
    setChecksRefreshing(true); setCheckRefreshError('')
    try {
      const opened = await backend.openPullRequest(pr.ref)
      onSession(await backend.refreshPullRequestContext(opened.id))
    } catch (err) { setCheckRefreshError(errorText(err)) }
    finally { setChecksRefreshing(false) }
  }, [onSession, pr.ref])
  useEffect(() => {
    if (gate.status !== 'waiting' || checksRefreshing) return undefined
    const timeout = window.setTimeout(() => void refreshChecks(), 15000)
    return () => window.clearTimeout(timeout)
  }, [checksRefreshing, gate.status, refreshChecks])
  const analyze = useCallback(async () => {
    const selected = profile ?? recommendedProfile(analysisConfiguration)
    if (reviewPaused || !selected || !analysisProfileReady(analysisConfiguration, selected)) return
    setFailure(undefined); setEvents([])
    try {
      const saveAsDefault = !analysisConfiguration.defaultProfile
      const next = await backend.startAnalysis(session.id, legacyAnalysis ? undefined : {profile: selected, saveAsDefault})
      setOperation(next)
      if (saveAsDefault && !legacyAnalysis) onAnalysisConfiguration({...analysisConfiguration, defaultProfile: selected})
      setProfileOpen(false)
    } catch (err) { setFailure(operationFailure(errorText(err), Boolean(analysis))) }
  }, [analysis, analysisConfiguration, legacyAnalysis, onAnalysisConfiguration, profile, reviewPaused, session])
  const running = session.analysisStatus === 'queued' || session.analysisStatus === 'running' || Boolean(operation && !['complete', 'completed', 'failed', 'cancelled'].includes(operation.state))
  useEffect(() => {
    const previous = previousGateStatus.current
    previousGateStatus.current = gate.status
    if ((previous === 'waiting' || previous === 'blocked') && gate.status === 'clear' && !analysis && !running) void analyze()
  }, [analysis, analyze, gate.status, running])
  const profileReady = analysisProfileReady(analysisConfiguration, profile)
  const cancel = async () => { if (!operation) return; try { await backend.cancelOperation(operation.id) } catch (err) { setFailure(operationFailure(errorText(err), Boolean(analysis))) } }
  const configured = Boolean(analysisConfiguration.defaultProfile)
  const showCoverage = (kind: 'previewed' | 'unseen' | 'legacy') => {
    setCoverageOpen(true)
    setCoverageFocus((current) => ({kind, request: current.request + 1}))
  }
  const staleBanner = session.isStale ? <section className="stale-banner overview-stale-banner" role="status" aria-labelledby="stale-analysis-title">
    <AlertTriangle size={18} aria-hidden="true"/>
    <div className="stale-banner-copy">
      <strong id="stale-analysis-title">Analysis out of date</strong>
      <p>New commits were added after this review. Reanalyze before approving.</p>
    </div>
    <div className="stale-banner-actions">
      {profile
        ? <button className="button primary" aria-label={running ? 'Reanalysis running' : 'Reanalyze latest revision'} disabled={running || !profileReady} onClick={() => void analyze()}>{!running && <RefreshCw size={15}/>} {running ? 'Running' : 'Reanalyze'}</button>
        : <button className="button primary" aria-label="Configure reanalysis" onClick={onOpenSettings}><Settings size={15}/>Configure</button>}
      <button className="button text" aria-label="Open previous review" disabled={!analysis || running} onClick={() => onReview()}>Previous</button>
    </div>
  </section> : undefined
  return <main className="detail-page overview-page"><div className="detail-top"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Inbox</button><div className="detail-actions">{analysis && profile && <AnalysisProfileSummary configuration={analysisConfiguration} profile={profile} expanded={profileOpen} onChange={running ? undefined : () => setProfileOpen((open) => !open)}/>} {analysis && !profile && <button className="button secondary" onClick={onOpenSettings}><Settings size={15}/>Configure AI analysis</button>} {!session.isStale && <>{analysis && profile && <button className="button secondary" disabled={running || reviewPaused || !profileReady} onClick={() => void analyze()}>{!running && <RefreshCw size={15}/>} {running ? 'Reanalysis running' : 'Reanalyze'}</button>}<button className="button primary" disabled={!analysis || running || reviewPaused} title={reviewPaused ? 'Wait for the current checks before opening the review.' : ''} onClick={() => onReview()}>Open review<ArrowRight size={16}/></button></>}</div></div>
    {analysis && !running && profileOpen && profile && <div className="analysis-override" id="analysis-profile-override"><div><strong>For this run</strong><small>This changes the next analysis only. Your Settings default stays the same.</small></div><AnalysisProfilePicker configuration={analysisConfiguration} value={profile} onChange={setProfile}/><button className="button text small" onClick={() => { setProfile(recommendedProfile(analysisConfiguration)); setProfileOpen(false) }}>Use default</button></div>}
    {!analysis && staleBanner}
    {!analysis && <header className="pr-hero compact"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1><div className="hero-meta"><span>@{pr.author.login}</span><span>{pr.baseRef} ← {pr.headRef}</span><span>{pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</span><span>{pr.changedFiles} files</span>{pr.requestedReviewers.length > 0 && <span>Review: {pr.requestedReviewers.map((reviewer) => `@${reviewer.login}`).join(', ')}</span>}{pr.reviewState && <span>{pr.reviewState.replaceAll('_', ' ').toLowerCase()}</span>}<span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="hero-status"><AnalysisBadge status={running ? 'running' : session.analysisStatus}/><small>Head {pr.headSha.slice(0, 8)}</small></div></header>}
    {checkRefreshError && <ErrorBanner title="Checks could not be refreshed" message={checkRefreshError}/>}
    {!analysis ? reviewPaused ? <ReviewGatePanel gate={gate} refreshing={checksRefreshing} onRefresh={() => void refreshChecks()} onOpenCheck={(check) => backend.openGitHubURL(check.detailsUrl || check.url)}/> : <AnalysisPanel running={running} reanalysis={false} configured={configured} configuration={analysisConfiguration} profile={profile} profileOpen={profileOpen} events={events} failure={failure} onProfileChange={setProfile} onToggleProfile={() => setProfileOpen((open) => !open)} onStart={() => void analyze()} onCancel={() => void cancel()} onRefresh={onRefreshHarnesses} onOpenSettings={onOpenSettings}/> : <>{(running || failure) && !reviewPaused && <AnalysisPanel running={running} reanalysis configured configuration={analysisConfiguration} profile={profile} profileOpen={profileOpen} events={events} failure={failure} onProfileChange={setProfile} onToggleProfile={() => setProfileOpen((open) => !open)} onStart={() => void analyze()} onCancel={() => void cancel()} onRefresh={onRefreshHarnesses} onOpenSettings={onOpenSettings}/>}<AnalysisCoverageBanner run={session.latestAnalysisRun} onViewCoverage={showCoverage}/>{analysis.summaryValidation !== 'valid' && <div className="warning-banner"><AlertTriangle size={16}/><span><strong>Summary is unverified.</strong> {analysis.summaryMessage || 'No valid code evidence supports this summary.'}</span></div>}<AnalysisOverview session={session} analysisConfiguration={analysisConfiguration} coverageOpen={coverageOpen} onCoverageOpenChange={setCoverageOpen} decisionReview={decisionReview} onReview={onReview} statusBanner={staleBanner} gate={gate} checksRefreshing={checksRefreshing} onRefreshChecks={() => void refreshChecks()} reviewDisabled={running}/></>}
  </main>
}

function AnalysisPanel({running, reanalysis, configured, configuration, profile, profileOpen, events, failure, onProfileChange, onToggleProfile, onStart, onCancel, onRefresh, onOpenSettings}: {running: boolean; reanalysis: boolean; configured: boolean; configuration: AnalysisConfiguration; profile?: AnalysisProfile; profileOpen: boolean; events: OperationEvent[]; failure?: AnalysisFailure; onProfileChange: (profile: AnalysisProfile) => void; onToggleProfile: () => void; onStart: () => void; onCancel: () => void; onRefresh: () => void; onOpenSettings: () => void}) {
  const profileReady = analysisProfileReady(configuration, profile)
  return <section className="analysis-launch" aria-busy={running}><div className="analysis-promise"><span><Sparkles size={24}/></span><h2>{running ? 'Building the review arc' : configured ? 'Turn this change into a guided review' : 'Choose how to analyze this change'}</h2><p>{running ? 'ReviewArc is analyzing the complete current pull request through a controlled, read-only context.' : 'ReviewArc uses a read-only repository snapshot and validates the structured result before it reaches your review.'}</p>{!running && !profile && <NoHarnessState configuration={configuration} onRefresh={onRefresh} onOpenSettings={onOpenSettings}/>} {!running && profile && <div className="analysis-profile-launch">{configured ? <AnalysisProfileSummary configuration={configuration} profile={profile} expanded={profileOpen} onChange={onToggleProfile}/> : <AnalysisProfilePicker configuration={configuration} value={profile} onChange={onProfileChange}/>} {configured && profileOpen && <AnalysisProfilePicker configuration={configuration} value={profile} onChange={onProfileChange} id="analysis-profile-override"/>}<button className="button primary" disabled={!profileReady} onClick={onStart}><Sparkles size={16}/>Analyze pull request</button>{!configured && <small>This becomes your default. You can change it later in Settings.</small>}</div>}</div><div><AnalysisProgress events={events} running={running} reanalysis={reanalysis} onCancel={onCancel}/>{failure && <AnalysisFailurePanel failure={failure} onRetry={onStart} onRefresh={onRefresh} onChangeProfile={onToggleProfile} onOpenSettings={onOpenSettings}/>}</div></section>
}

function AnalysisCoverageBanner({run, onViewCoverage}: {run?: AnalysisRun; onViewCoverage: (kind: 'previewed' | 'unseen' | 'legacy') => void}) {
  if (!run) return null
  const coverage = analysisCoverageBreakdown(run.coverage)
  if (coverage.fullyRead >= coverage.total && coverage.partiallyRead === 0) return null
  const hasUnseen = coverage.unseen > 0
  return <div className={hasUnseen ? 'warning-banner analysis-coverage-warning' : 'coverage-banner analysis-coverage-warning'}>
    {hasUnseen ? <AlertTriangle size={16}/> : <FileDiff size={16}/>}
    <span><strong>{hasUnseen ? `${coverage.unseen} changed file${coverage.unseen === 1 ? ' was' : 's were'} not inspected.` : `All ${coverage.total} changed files were inspected.`}</strong> {coverage.parts.join(' · ')}. {hasUnseen ? 'Findings may not cover the unseen changes.' : 'Previewed files were triaged but their full diffs were not read.'}</span>
    <button className="analysis-coverage-action" onClick={() => onViewCoverage(hasUnseen ? 'unseen' : coverage.previewed ? 'previewed' : 'legacy')}>View coverage details</button>
  </div>
}

function AnalysisOverview({session, analysisConfiguration, coverageOpen, onCoverageOpenChange, onReview, statusBanner, gate, checksRefreshing, onRefreshChecks, reviewDisabled}: {session: ReviewSession; analysisConfiguration?: AnalysisConfiguration; coverageOpen: boolean; onCoverageOpenChange: (open: boolean) => void; decisionReview: DecisionReviewMap; onReview: (chapterId?: string, findingId?: string) => void; statusBanner?: ReactNode; gate: ReturnType<typeof reviewGate>; checksRefreshing: boolean; onRefreshChecks: () => void; reviewDisabled: boolean}) {
  const analysis = session.analysis!
  const pr = session.pullRequest
  const checks = pr.checkRuns ?? []
  const reviews = pr.reviews ?? []
  const comments = pr.reviewComments ?? []
  const brief = buildAgentReviewBrief(analysis, session.latestAnalysisRun?.coverage)
  const discussionCount = reviews.length + comments.length
  const visibleDiscussionCount = Math.min(reviews.length, 3) + Math.min(comments.length, 3)

  return <div className="review-brief-layout">
    <section className="overview-document" aria-label="Pull request review overview">
      <header className="overview-masthead"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1><div className="hero-meta"><span>@{pr.author.login}</span><span>{pr.baseRef} ← {pr.headRef}</span><span>{pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="hero-status">{!session.isStale && <AnalysisBadge status={session.analysisStatus}/>}<RiskBadge level={pr.riskLevel}/><small>Head {pr.headSha.slice(0, 8)}</small></div></header>
      {statusBanner}
      {gate.status === 'blocked' || gate.status === 'waiting'
        ? <ReviewGatePanel gate={gate} refreshing={checksRefreshing} onRefresh={onRefreshChecks} onOpenCheck={(check) => backend.openGitHubURL(check.detailsUrl || check.url)}/>
        : <AgentReviewBrief brief={brief} stale={session.isStale} disabled={reviewDisabled} onInspect={(finding) => onReview(finding.chapterId, finding.id)} onOpenReview={() => brief.findings.length ? onReview(brief.findings[0].chapterId, brief.findings[0].id) : onReview('', '__summary__')}/>
      }
      <section className="overview-support decision-support" aria-labelledby="overview-support-title" aria-label="Supporting context">
          <div className="section-title"><h2 id="overview-support-title">Supporting context</h2></div>
          {session.latestAnalysisRun && <AnalysisRunDetails run={session.latestAnalysisRun} configuration={analysisConfiguration} open={coverageOpen} onOpenChange={onCoverageOpenChange}/>}
          <details className="support-disclosure"><summary><span><ShieldCheck size={16}/>Full generated analysis</span><small>{analysis.affectedAreas.length} affected area{analysis.affectedAreas.length === 1 ? '' : 's'}</small></summary><div className="support-content"><Markdown className="overview-summary">{analysis.summary}</Markdown>{analysis.affectedAreas.length > 0 && <div className="overview-change-map"><span>Affected areas</span><ul aria-label="Affected areas">{analysis.affectedAreas.map((area) => <li key={area.name}>{area.name}</li>)}</ul><details className="overview-area-details"><summary>Area details</summary><div>{analysis.affectedAreas.map((area) => <article key={area.name}><strong>{area.name}</strong><p>{area.description}</p></article>)}</div></details></div>}</div></details>
          <details className="support-disclosure"><summary><span><BookOpen size={16}/>Author context</span><small>{pr.body ? 'Pull request description' : 'No description supplied'}</small></summary><div className="support-content">{pr.body ? <Markdown className="pr-description">{pr.body}</Markdown> : <p>No pull request description was provided.</p>}</div></details>
          {checks.length > 0 && <details className="support-disclosure"><summary><span><Check size={16}/>Checks</span><small>{gate.passing.length} of {checks.length} passing</small></summary><div className="support-content">{checks.map((check) => <div className="check-row" key={check.id}><span className={`check-state ${check.conclusion || check.status}`}/><div><strong>{check.name}</strong><small>{check.conclusion || check.status}{check.appName ? ` · ${check.appName}` : ''}</small></div></div>)}</div></details>}
          {discussionCount > 0 && <details className="support-disclosure"><summary><span><MessageSquare size={16}/>Existing discussion</span><small>{visibleDiscussionCount < discussionCount ? `Latest ${visibleDiscussionCount} of ${discussionCount}` : `${discussionCount} messages`}</small></summary><div className="support-content">{reviews.slice(-3).map((review) => <div className="discussion-row" key={`review-${review.id}`}><div className="discussion-row-heading"><strong>@{review.author.login} · {review.state.toLowerCase()}</strong>{review.url && <button className="discussion-link" type="button" aria-label={`Open review by @${review.author.login} on GitHub`} title="Open on GitHub" onClick={() => backend.openGitHubURL(review.url)}><ExternalLink size={13}/></button>}</div>{review.body && <p>{review.body}</p>}</div>)}{comments.slice(-3).map((comment) => <div className="discussion-row" key={`comment-${comment.id}`}><div className="discussion-row-heading"><strong>@{comment.author.login} on {comment.path}{comment.line ? `:${comment.line}` : ''}</strong>{comment.url && <button className="discussion-link" type="button" aria-label={`Open comment by @${comment.author.login} on GitHub`} title="Open on GitHub" onClick={() => backend.openGitHubURL(comment.url)}><ExternalLink size={13}/></button>}</div><p>{comment.body}</p></div>)}</div></details>}
          {analysis.validationIssues.length > 0 && <details className="support-disclosure"><summary><span><AlertTriangle size={16}/>Unsupported analysis</span><small>{analysis.validationIssues.length > 5 ? `Showing 5 of ${analysis.validationIssues.length}` : `${analysis.validationIssues.length} references`}</small></summary><div className="support-content">{analysis.validationIssues.slice(0, 5).map((issue) => <p className="context-copy" key={issue.code + issue.evidenceId}>{issue.message}</p>)}</div></details>}
      </section>
    </section>
  </div>
}

export function ReviewWorkspace({session, initialChapterId = '', initialFindingId = '', initialSummaryOpen = false, decisionReview: controlledDecisionReview, onDecisionReview, onSession, onBack}: {session: ReviewSession; initialChapterId?: string; initialFindingId?: string; initialSummaryOpen?: boolean; decisionReview?: DecisionReviewMap; onDecisionReview?: (findingId: string, review: DecisionReview) => void; onSession: (session: ReviewSession) => void; onBack: () => void}) {
  const analysis = session.analysis!
  const chapters = useMemo(() => analysis?.chapters ?? [], [analysis?.chapters])
  const brief = useMemo(() => analysis ? buildAgentReviewBrief(analysis, session.latestAnalysisRun?.coverage) : undefined, [analysis, session.latestAnalysisRun?.coverage])
  const findings = brief?.findings ?? []
  const [activeFindingId, setActiveFindingId] = useState(initialFindingId)
  const finding = findings.find((item) => item.id === activeFindingId) ?? findings.find((item) => item.chapterId === initialChapterId) ?? findings[0]
  const findingIndex = finding ? findings.findIndex((item) => item.id === finding.id) : -1
  const previousFinding = findingIndex > 0 ? findings[findingIndex - 1] : undefined
  const nextFinding = findingIndex >= 0 && findingIndex < findings.length - 1 ? findings[findingIndex + 1] : undefined
  const chapter = chapters.find((item) => item.id === finding?.chapterId) ?? chapters.find((item) => item.id === initialChapterId) ?? chapters[0]
  const suggestedPath = finding?.evidence[0]?.path ?? chapter?.files[0]?.path
  const [localDecisionReview, setLocalDecisionReview] = useState<DecisionReviewMap>({})
  const decisionReview = controlledDecisionReview ?? localDecisionReview
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [path, setPath] = useState(finding?.evidence[0]?.path ?? chapter?.files[0]?.path ?? '')
  const [diff, setDiff] = useState<DiffFile>()
  const [diffError, setDiffError] = useState('')
  const [panelTab, setPanelTab] = useState<'context'|'notes'|'drafts'>('context')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [draftTarget, setDraftTarget] = useState<DraftTarget>()
  const [busy, setBusy] = useState(false)
  const [publish, setPublish] = useState<PublishPreview>()
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set(session.comments.filter((comment) => comment.status === 'draft').map((comment) => comment.id)))
  const [actionError, setActionError] = useState('')
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceReference>()
  const [fileContext, setFileContext] = useState<FileContent>()
  const [workspaceView, setWorkspaceView] = useState<'finding' | 'analysis' | 'diff' | 'evidence'>('finding')
  const [focusMode, setFocusMode] = useState(false)
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified')
  const [summaryOpen, setSummaryOpen] = useState(initialSummaryOpen)
  const [threadReply, setThreadReply] = useState<ThreadReplyPreview>()
  const [threadReplyReset, setThreadReplyReset] = useState<{rootId: number; version: number}>()
  const pendingPublishToken = useRef('')
  const pendingThreadReplyToken = useRef('')
  const confirmingPublish = useRef(false)
  const confirmingThreadReply = useRef(false)
  const [editingNoteId, setEditingNoteId] = useState('')
  const [editingDraftId, setEditingDraftId] = useState('')
  const evidenceRequest = useRef(0)
  const diffRequest = useRef(0)
  const toolsTriggerRef = useRef<HTMLButtonElement>(null)
  const toolsPanelRef = useRef<HTMLElement>(null)
  const toolsPanelWasOpen = useRef(false)
  const updateDecisionReview = (findingId: string, review: DecisionReview) => {
    if (onDecisionReview) onDecisionReview(findingId, review)
    else setLocalDecisionReview((current) => ({...current, [findingId]: review}))
  }
  const openFinding = (targetFinding: (typeof findings)[number]) => {
    setActiveFindingId(targetFinding.id)
    setSummaryOpen(false)
    setWorkspaceView('finding')
  }
  useEffect(() => setActiveFindingId(initialFindingId), [initialFindingId])
  useEffect(() => () => {
    if (pendingPublishToken.current && !confirmingPublish.current) void backend.discardPublishPreview(pendingPublishToken.current).catch(() => {})
    if (pendingThreadReplyToken.current && !confirmingThreadReply.current) void backend.discardThreadReplyPreview(pendingThreadReplyToken.current).catch(() => {})
  }, [])
  useEffect(() => { backend.getChangedFiles(session.id).then((value) => { setFiles(value ?? []); setPath((current) => current || value?.[0]?.path || '') }).catch((err) => setDiffError(errorText(err))) }, [session.id])
  useEffect(() => {
    const request = ++diffRequest.current
    let active = true
    if (!path || workspaceView !== 'diff') { setDiff(undefined); return undefined }
    setDiff(undefined); setDiffError('')
    backend.getDiff(session.id, path)
      .then((value) => { if (active && request === diffRequest.current) setDiff(value) })
      .catch((err) => { if (active && request === diffRequest.current) setDiffError(errorText(err)) })
    return () => { active = false }
  }, [session.id, path, workspaceView])
  useEffect(() => {
    evidenceRequest.current++
    setFileContext(undefined)
    setEvidenceFocus(undefined)
    setWorkspaceView('finding')
    if (suggestedPath) setPath(suggestedPath)
  }, [chapter?.id, finding?.id, suggestedPath])
  useEffect(() => {
    if (toolsPanelOpen) toolsPanelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    else if (toolsPanelWasOpen.current) toolsTriggerRef.current?.focus()
    toolsPanelWasOpen.current = toolsPanelOpen
  }, [toolsPanelOpen])
  useEffect(() => {
    const panel = toolsPanelRef.current
    if (!toolsPanelOpen || !panel) return undefined
    const onKeyDown = (event: KeyboardEvent) => trapPanelFocus(event, panel)
    panel.addEventListener('keydown', onKeyDown)
    return () => panel.removeEventListener('keydown', onKeyDown)
  }, [toolsPanelOpen])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.key.toLowerCase() === 'f') { setFocusMode((value) => !value); setToolsPanelOpen(false) }
      if (event.key === 'Escape') setToolsPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!analysis) return <main className="detail-page"><ErrorBanner title="Agent review unavailable" message="This session does not contain a generated review." onRetry={onBack} actionLabel="Back to overview"/></main>
  const activeChapterId = chapter?.id ?? ''
  const status = chapter ? session.chapters.find((item) => item.chapterId === chapter.id)?.status ?? chapter.status : 'notReviewed'
  const setStatus = async (value: ChapterStatus) => { if (!chapter) return; setBusy(true); setActionError(''); try { onSession(await backend.updateChapter(session.id, chapter.id, value)) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const addNote = async () => { if (!note.trim()) return; setBusy(true); setActionError(''); try { const saved = await backend.saveNote(session.id, activeChapterId, note.trim(), editingNoteId); onSession({...session, notes: editingNoteId ? session.notes.map((item) => item.id === editingNoteId ? saved : item) : [...session.notes, saved]}); setNote(''); setEditingNoteId('') } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const deleteNote = async (id: string) => { setBusy(true); try { await backend.deleteNote(id); onSession({...session, notes: session.notes.filter((item) => item.id !== id)}); if (editingNoteId === id) { setEditingNoteId(''); setNote('') } } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const addDraft = async () => { if (!draft.trim()) return; setBusy(true); setActionError(''); const target = draftTarget; try { const saved = await backend.saveDraft(session.id, activeChapterId, draft.trim(), target?.path, target?.startLine, target?.startSide, target?.line, target?.side, editingDraftId); onSession({...session, comments: editingDraftId ? session.comments.map((item) => item.id === editingDraftId ? saved : item) : [...session.comments, saved]}); setSelectedDrafts((value) => new Set(value).add(saved.id)); setDraft(''); setDraftTarget(undefined); setEditingDraftId('') } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const deleteDraft = async (id: string) => { setBusy(true); try { await backend.deleteDraft(id); onSession({...session, comments: session.comments.filter((item) => item.id !== id)}); setSelectedDrafts((value) => { const next = new Set(value); next.delete(id); return next }); if (editingDraftId === id) { setEditingDraftId(''); setDraft('') } } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const preparePublish = async () => { setBusy(true); setActionError(''); try { const preview = await backend.preparePublish(session.id, [...selectedDrafts]); pendingPublishToken.current = preview.token; setPublish(preview) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const prepareDecision = async (event: 'APPROVE' | 'REQUEST_CHANGES') => { setBusy(true); setActionError(''); try { const preview = await backend.prepareReview(session.id, [...selectedDrafts], event); pendingPublishToken.current = preview.token; setPublish(preview); setSummaryOpen(false) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const startReanalysis = async () => {
    setBusy(true); setActionError('')
    try {
      await backend.startAnalysis(session.id)
      onSession({...session, analysisStatus: 'queued'})
      setSummaryOpen(false)
      onBack()
    } catch (err) { setActionError(errorText(err)) }
    finally { setBusy(false) }
  }
  const confirmPublish = async () => {
    if (!publish) return
    setBusy(true); setActionError('')
    let comments: ReviewComment[]
    confirmingPublish.current = true
    try { comments = await backend.confirmPublish(publish.token, publish.digest) }
    catch (err) { setActionError(`Publishing could not be confirmed locally. Refresh the pull request on GitHub before retrying: ${errorText(err)}`); setBusy(false); return }
    finally { confirmingPublish.current = false }
    pendingPublishToken.current = ''
    const ids = new Set(comments.map((comment) => comment.id))
    onSession({...session, comments: session.comments.map((comment) => ids.has(comment.id) ? comments.find((published) => published.id === comment.id)! : comment)})
    setPublish(undefined); setSelectedDrafts(new Set())
	try { onSession(await backend.refreshPullRequestContext(session.id)) }
    catch (err) { setActionError(`Published on GitHub, but ReviewArc could not refresh the local session: ${errorText(err)}`) }
    finally { setBusy(false) }
  }
  const cancelPublish = async () => {
    if (!publish || busy) return
    setBusy(true); setActionError('')
    try { await backend.discardPublishPreview(publish.token); pendingPublishToken.current = ''; setPublish(undefined) }
    catch (err) { setActionError(`Review preview could not be discarded: ${errorText(err)}`) }
    finally { setBusy(false) }
  }
  const prepareThreadReply = async (root: PullRequestReviewComment, body: string) => {
    setBusy(true); setActionError('')
    try { const preview = await backend.prepareThreadReply(session.id, root.id, body); pendingThreadReplyToken.current = preview.token; setThreadReply(preview); return true }
    catch (err) { setActionError(errorText(err)); return false }
    finally { setBusy(false) }
  }
  const confirmThreadReply = async () => {
    if (!threadReply) return
    setBusy(true); setActionError('')
    let reply: PullRequestReviewComment
    confirmingThreadReply.current = true
    try { reply = await backend.confirmThreadReply(threadReply.token, threadReply.digest) }
    catch (err) { pendingThreadReplyToken.current = ''; setThreadReply(undefined); setActionError(`Reply publication could not be confirmed locally. Check the GitHub thread, then review the reply again before retrying: ${errorText(err)}`); setBusy(false); return }
    finally { confirmingThreadReply.current = false }
    pendingThreadReplyToken.current = ''
    onSession({...session, pullRequest: {...session.pullRequest, reviewComments: [...session.pullRequest.reviewComments, reply]}})
    setThreadReply(undefined)
    setThreadReplyReset((value) => ({rootId: threadReply.rootCommentId, version: (value?.version ?? 0) + 1}))
	try { onSession(await backend.refreshPullRequestContext(session.id)) }
    catch (err) { setActionError(`Reply published on GitHub, but ReviewArc could not refresh the conversation: ${errorText(err)}`) }
    finally { setBusy(false) }
  }
  const cancelThreadReply = async () => {
    if (!threadReply || busy) return
    setBusy(true); setActionError('')
    try { await backend.discardThreadReplyPreview(threadReply.token); pendingThreadReplyToken.current = ''; setThreadReply(undefined) }
    catch (err) { setActionError(`Reply preview could not be discarded: ${errorText(err)}`) }
    finally { setBusy(false) }
  }
  const navigateEvidence = async (evidence: EvidenceReference) => {
    if (evidence.validationStatus !== 'valid') return
    const request = ++evidenceRequest.current
    setActionError(''); setEvidenceFocus(evidence); setFileContext(undefined); setPath(evidence.path); setWorkspaceView('evidence')
    try {
      const file = await backend.getFile(session.id, evidence.path, evidence.revision)
      if (request === evidenceRequest.current) setFileContext(file)
    } catch (err) {
      if (request === evidenceRequest.current) setActionError(`Validated evidence could not be loaded: ${errorText(err)}`)
    }
  }
  const openDiff = (nextPath = path || chapter?.files[0]?.path || files[0]?.path || '') => {
    evidenceRequest.current++
    setFileContext(undefined)
    setEvidenceFocus(undefined)
    setPath(nextPath)
    setWorkspaceView('diff')
  }
  const openTools = (tab: 'context' | 'notes' | 'drafts') => { setFocusMode(false); setPanelTab(tab); setToolsPanelOpen(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1040px)').matches) }
  const toggleFocusMode = () => { setFocusMode((value) => !value); setToolsPanelOpen(false) }
  const moveToolTab = (event: ReactKeyboardEvent<HTMLButtonElement>, current: 'context' | 'notes' | 'drafts') => {
    const tabs = ['context', 'notes', 'drafts'] as const
    const index = tabs.indexOf(current)
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length] : undefined
    if (!next) return
    event.preventDefault()
    setPanelTab(next)
    document.getElementById(`review-tool-tab-${next}`)?.focus()
  }
  const chapterIndex = chapter ? chapters.indexOf(chapter) : 0
  const draftFinding = () => {
    if (!finding) return
    if (!draft.trim()) {
      const observations = finding.observations.length > 1
        ? `\n\nSupporting observations:\n${finding.observations.map((observation) => `- ${observation.title}: ${observation.detail}`).join('\n')}`
        : ''
      setDraft(`Please address this review judgment:\n\n${finding.title}\n\n${finding.detail}${observations}`)
    }
    openTools('drafts')
  }
  return <main className={`review-shell${focusMode ? ' focus-mode' : ''}`}>
    <header className="review-header"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Review brief</button><div><strong>#{session.pullRequest.ref.number} {session.pullRequest.title}</strong><span>{repoName(session.pullRequest)}</span></div>{session.isStale && <span className="badge analysis-stale"><AlertTriangle size={12}/>Stale analysis</span>}<div className="review-header-spacer"/><button className="button text small full-diff-button" aria-label="Open full diff" title="Open full diff" onClick={() => openDiff()}><FileDiff size={15}/><span>Full diff</span></button><button className="icon-button" title="Focus finding (F)" aria-label="Focus finding" aria-pressed={focusMode} onClick={toggleFocusMode}>{focusMode ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button><button ref={toolsTriggerRef} className="button secondary small review-panel-trigger tools-trigger" aria-controls="review-tools-panel" aria-expanded={toolsPanelOpen} onClick={() => setToolsPanelOpen((value) => !value)}><PanelRight size={14}/>Review tools</button><button className="button secondary small decision-brief-trigger" aria-label="Open review decision" onClick={() => setSummaryOpen(true)}><ShieldCheck size={14}/>Review decision</button><button className="button secondary small desktop-drafts-button" onClick={() => openTools('drafts')}><MessageSquare size={14}/>{session.comments.filter((c) => c.status === 'draft').length} drafts</button></header>
    <div className="review-grid finding-review-grid">
      {workspaceView === 'finding' ? <section className="reader-panel finding-reader-panel">{finding && chapter ? <AgentFindingDetail key={finding.id} finding={finding} chapterTitle={chapter.title} review={decisionReview[finding.id]} reviews={session.pullRequest.reviews} comments={session.pullRequest.reviewComments} onReview={(review) => updateDecisionReview(finding.id, review)} onEvidence={(evidence) => void navigateEvidence(evidence)} onOpenDiff={openDiff} onDraft={draftFinding} onAnalysis={() => setWorkspaceView('analysis')} onOpenDiscussion={(url) => backend.openGitHubURL(url)}/> : <div className="finding-review-empty"><Check size={24}/><h1>No findings need inspection</h1><p>The agent reported no decision-critical findings for this revision. Review the final decision when you are ready.</p><button className="button primary" onClick={() => setSummaryOpen(true)}>Review approval</button></div>}</section> : workspaceView === 'analysis' && chapter ? <section className="reader-panel"><div className="decision-story-return"><div><strong>{finding?.title ?? chapter.title}</strong></div><button className="button secondary small" onClick={() => setWorkspaceView('finding')}><ArrowLeft size={14}/>Back to finding</button></div><ChapterReader sessionId={session.id} chapter={chapter} chapterIndex={chapterIndex} chapterCount={chapters.length} onOpenDiff={openDiff} onEvidence={(evidence) => void navigateEvidence(evidence)} onDraft={(text) => {setDraft(text); openTools('drafts')}}/></section> : <section className="code-panel"><div className="decision-code-context"><div><strong>{finding?.title ?? 'Agent review'}</strong></div><button className="button secondary small" onClick={() => setWorkspaceView('finding')}><ArrowLeft size={14}/>Back to finding</button></div><div className="code-toolbar narrative-code-toolbar"><div><FileDiff size={15}/><strong title={path}>{path || 'Select a changed file'}</strong></div><div><span className="range-hint"><MessageSquare size={12}/>Drag line numbers to comment</span>{fileContext ? <span className="revision head">{fileContext.revision} evidence</span> : <><button className={`view-toggle${diffMode === 'unified' ? ' active' : ''}`} title="Unified diff" aria-label="Unified diff" aria-pressed={diffMode === 'unified'} onClick={() => setDiffMode('unified')}><FileDiff size={14}/></button><button className={`view-toggle${diffMode === 'split' ? ' active' : ''}`} title="Split diff" aria-label="Split diff" aria-pressed={diffMode === 'split'} onClick={() => setDiffMode('split')}><Columns2 size={14}/></button><span className="revision">{session.pullRequest.baseRef}</span><ArrowRight size={13}/><span className="revision head">{session.pullRequest.headRef}</span></>}</div></div>{fileContext && evidenceFocus ? <FileContextView file={fileContext} focus={evidenceFocus} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(fileContext.path, range)); openTools('drafts')}}/> : diffError ? <ErrorBanner title="Diff unavailable" message={diffError}/> : !diff ? <div className="diff-loading"><Skeleton rows={9}/><span>Loading diff for {path}…</span></div> : diffMode === 'split' ? <SplitDiffView diff={diff} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(diff.file.path, range)); openTools('drafts')}}/> : <DiffView diff={diff} focus={evidenceFocus} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(diff.file.path, range)); openTools('drafts')}}/>}</section>}
      <aside ref={toolsPanelRef} id="review-tools-panel" className={`context-panel${toolsPanelOpen ? ' panel-open' : ''}`} role={toolsPanelOpen ? 'dialog' : undefined} aria-modal={toolsPanelOpen || undefined} aria-label={toolsPanelOpen ? 'Review tools' : undefined} tabIndex={toolsPanelOpen ? -1 : undefined}><div className="context-tabs" role="tablist" aria-label="Review tools"><button id="review-tool-tab-context" role="tab" aria-controls="review-tool-panel-context" aria-selected={panelTab === 'context'} tabIndex={panelTab === 'context' ? 0 : -1} className={panelTab === 'context' ? 'active' : ''} onKeyDown={(event) => moveToolTab(event, 'context')} onClick={() => setPanelTab('context')}><PanelRight size={14}/>Evidence</button><button id="review-tool-tab-notes" role="tab" aria-controls="review-tool-panel-notes" aria-selected={panelTab === 'notes'} tabIndex={panelTab === 'notes' ? 0 : -1} className={panelTab === 'notes' ? 'active' : ''} onKeyDown={(event) => moveToolTab(event, 'notes')} onClick={() => setPanelTab('notes')}>Notes</button><button id="review-tool-tab-drafts" role="tab" aria-controls="review-tool-panel-drafts" aria-selected={panelTab === 'drafts'} tabIndex={panelTab === 'drafts' ? 0 : -1} className={panelTab === 'drafts' ? 'active' : ''} onKeyDown={(event) => moveToolTab(event, 'drafts')} onClick={() => setPanelTab('drafts')}>Drafts</button></div>
        {panelTab === 'context' && <div className="context-tab-panel" id="review-tool-panel-context" role="tabpanel" aria-labelledby="review-tool-tab-context">{chapter ? <>{chapter.symbols.length > 0 && <SymbolNavigator symbols={chapter.symbols} onEvidence={(evidence) => void navigateEvidence(evidence)}/>}<ChapterEvidenceIndex chapter={chapter} onEvidence={(evidence) => void navigateEvidence(evidence)}/></> : <p className="panel-loading">No finding context is required.</p>}</div>}
        {panelTab === 'notes' && <div className="context-tab-panel" id="review-tool-panel-notes" role="tabpanel" aria-labelledby="review-tool-tab-notes"><NotesPanel notes={session.notes.filter((n) => !n.chapterId || n.chapterId === activeChapterId)} value={note} onChange={setNote} onSave={() => void addNote()} onEdit={(item) => {setEditingNoteId(item.id); setNote(item.body)}} onDelete={(id) => void deleteNote(id)} editing={Boolean(editingNoteId)} busy={busy}/></div>}
        {panelTab === 'drafts' && <div className="context-tab-panel" id="review-tool-panel-drafts" role="tabpanel" aria-labelledby="review-tool-tab-drafts"><DraftsPanel drafts={session.comments.filter((c) => c.status === 'draft')} published={session.comments.filter((c) => c.status === 'published')} selected={selectedDrafts} onSelected={setSelectedDrafts} value={draft} onChange={setDraft} onSave={() => void addDraft()} onPublish={() => void preparePublish()} onEdit={(item) => {setEditingDraftId(item.id); setDraft(item.body); setDraftTarget(item.path && item.line && item.side ? {path: item.path, startLine: item.startLine, startSide: item.startSide, line: item.line, side: item.side} : undefined)}} onDelete={(id) => void deleteDraft(id)} editing={Boolean(editingDraftId)} target={draftTarget} onClearTarget={() => setDraftTarget(undefined)} busy={busy}/></div>}
      </aside>
      {toolsPanelOpen && (
        <button className="review-panel-backdrop" aria-label="Close review panels" onClick={() => setToolsPanelOpen(false)}/>
      )}
    </div><footer className="review-footer">{workspaceView === 'analysis' && chapter && <><div className="chapter-progress-control"><span>Analysis state</span><SelectControl className="chapter-progress-select" label="Analysis progress" help="Saved privately in ReviewArc; this does not update GitHub." value={status} disabled={busy} onChange={(value) => void setStatus(value as ChapterStatus)} options={([
      ['notReviewed', 'Not reviewed'],
      ['inProgress', 'In progress'],
      ['reviewed', 'Reviewed'],
      ['needsClarification', 'Needs clarification'],
      ['blocked', 'Blocked'],
    ] as const).map(([value, label]) => ({value, label}))}/></div><span className="chapter-progress-note">Saved privately</span></>}<span className="shortcut-hint">F focus · ⌘K open</span><div className="footer-spacer"/>{finding && <nav className="judgment-navigation" aria-label="Review judgments"><span className="judgment-position"><strong>{findingIndex + 1}</strong> of {findings.length}</span><button className="button secondary small" disabled={!previousFinding} aria-label="Previous judgment" onClick={() => previousFinding && openFinding(previousFinding)}><ArrowLeft size={14}/>Previous</button>{nextFinding ? <button className="button primary small" aria-label="Next judgment" onClick={() => openFinding(nextFinding)}>Next<ArrowRight size={14}/></button> : <button className="button primary small" aria-label="Open final review decision" onClick={() => setSummaryOpen(true)}>Decision<ShieldCheck size={14}/></button>}</nav>}</footer>
    {actionError && <div className="global-error"><ErrorBanner title="Review action failed" message={actionError} onRetry={() => setActionError('')} actionLabel="Dismiss"/></div>}
    {publish && <PublishConfirmation preview={publish} busy={busy} onCancel={() => void cancelPublish()} onConfirm={() => void confirmPublish()}/>}
    {threadReply && <ThreadReplyConfirmation preview={threadReply} busy={busy} onCancel={() => void cancelThreadReply()} onConfirm={() => void confirmThreadReply()}/>}
    {summaryOpen && (
      <ReviewSummary
        session={session}
        busy={busy}
        selectedDrafts={selectedDrafts.size}
        findings={findings}
        decisionReview={decisionReview}
        onClose={() => setSummaryOpen(false)}
        onDrafts={() => {
          setSummaryOpen(false)
          openTools('drafts')
        }}
        onOpenFinding={openFinding}
        onReanalyze={() => void startReanalysis()}
        onDecision={(event) => void prepareDecision(event)}
      />
    )}
  </main>
}


function CommandPalette({items, onClose, onOpen}: {items: PullRequestSummary[]; onClose: () => void; onOpen: (pr: PullRequestSummary) => void}) {
  const [query, setQuery] = useState('')
  const results = items.filter((item) => `${repoName(item)} ${item.ref.number} ${item.title}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
  useDialogFocus(onClose)
  return <div className="modal-backdrop command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="quick-open-title"><header><Command size={17}/><label><span id="quick-open-title" className="sr-only">Quick open a pull request</span><input id="quick-open-input" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quick open a pull request…"/></label><kbd>esc</kbd></header><div className="command-results">{results.map((item) => <button key={`${repoName(item)}#${item.ref.number}`} onClick={() => onOpen(item)}><GitPullRequest size={15}/><span><strong>#{item.ref.number} {item.title}</strong><small>{repoName(item)}</small></span><ChevronRight size={15}/></button>)}{!results.length && <p>No matching pull requests.</p>}</div></section></div>
}

function updateStatusCopy(update: SoftwareUpdateStatus): {headline: string; detail?: string} {
  const version = update.release ? `ReviewArc ${update.release.version}` : 'The latest ReviewArc release'
  if (update.state === 'unsupported') return {headline: 'Automatic updates are available in signed release builds.'}
  if (update.state === 'checking') return {headline: 'Checking the selected release channel…'}
  if (update.state === 'available') return {headline: `${version} is available.`}
  if (update.state === 'downloading') return {headline: `Downloading ${version} in the background…`}
  if (update.state === 'ready') return {headline: `${version} is downloaded and ready to install.`}
  if (update.state === 'installing') return {headline: `Installing ${version}. ReviewArc will reopen when it is ready.`}
  if (update.state === 'failed') return {headline: 'ReviewArc could not check for updates.', detail: update.error || 'Try again in a moment.'}
  if (update.lastCheckedAt) return {headline: 'You’re up to date.', detail: `Last checked ${relativeTime(update.lastCheckedAt)}.`}
  return {headline: 'ReviewArc checks for updates in the background while the app is running.'}
}

function UpdateBanner({update, busy, onLater, onInstall}: {update: SoftwareUpdateStatus; busy: boolean; onLater: () => void; onInstall: () => void}) {
  const ready = update.state === 'ready'
  return <aside className="update-ready-banner" aria-live="polite"><span><Download size={17}/></span><div><strong>ReviewArc {update.release?.version} is {ready ? 'ready' : 'available'}</strong><small>{ready ? 'Restart ReviewArc to finish updating.' : 'Install when you are ready.'} Your local review state is preserved.</small></div>{update.release?.releaseNotesUrl && <button className="button text small" onClick={() => backend.openReleaseNotesURL(update.release!.releaseNotesUrl!)}>Release notes<ExternalLink size={12}/></button>}<button className="button secondary small" disabled={busy} onClick={onLater}>Later</button><button className="button primary small" disabled={busy} onClick={onInstall}>{busy ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>} {ready ? 'Install and restart…' : 'Install update…'}</button></aside>
}

function SoftwareUpdateSettings({update, busy, onCheck, onSetChannel, onInstall}: {update: SoftwareUpdateStatus; busy: boolean; onCheck: () => void; onSetChannel: (channel: UpdateChannel) => void; onInstall: () => void}) {
  const progress = update.totalBytes ? Math.min(100, Math.round(((update.downloadedBytes ?? 0) / update.totalBytes) * 100)) : undefined
  const unavailable = update.state !== 'idle' && update.state !== 'failed'
  const copy = updateStatusCopy(update)
  const showSuccess = update.state === 'idle' && update.lastCheckedAt
  const installable = update.state === 'available' || update.state === 'ready'
  return <section className="software-update-settings"><div className="settings-section-heading"><h2>Software updates</h2><p>Choose which signed releases ReviewArc should offer.</p><code>v{update.currentVersion} · build {update.currentBuild}</code></div><div className="settings-section-body"><div className="update-channel-control"><div><strong>Release channel</strong><small>{update.channel === 'beta' ? 'Beta includes early builds and all newer GA releases.' : 'Stable receives generally available releases only.'}</small></div><div role="group" aria-label="Release channel"><button type="button" aria-pressed={update.channel === 'stable'} disabled={busy || unavailable} onClick={() => onSetChannel('stable')}>Stable</button><button type="button" aria-pressed={update.channel === 'beta'} disabled={busy || unavailable} onClick={() => onSetChannel('beta')}>Beta</button></div></div>{update.channel === 'beta' && <p className="beta-channel-note"><AlertTriangle size={14}/>Beta builds may be less stable. Returning to Stable does not downgrade the installed app.</p>}<div className={`update-status-row state-${update.state}${showSuccess ? ' success' : ''}`} role="status"><span>{update.state === 'checking' || update.state === 'downloading' || update.state === 'installing' ? <LoaderCircle className="spin" size={15}/> : update.state === 'failed' ? <AlertTriangle size={15}/> : installable || showSuccess ? <Check size={15}/> : <RefreshCw size={15}/>}</span><div><strong>{copy.headline}</strong>{copy.detail && <small>{copy.detail}</small>}{progress !== undefined && <div className="update-download-progress" aria-label={`Download ${progress}% complete`}><i style={{width: `${progress}%`}}/></div>}</div><div className="update-actions">{update.release?.releaseNotesUrl && <button className="button text small" onClick={() => backend.openReleaseNotesURL(update.release!.releaseNotesUrl!)}>Release notes<ExternalLink size={12}/></button>}{installable ? <button className="button primary small" disabled={busy} onClick={onInstall}>{update.state === 'ready' ? 'Install and restart…' : 'Install update…'}</button> : <button className="button secondary small" disabled={busy || unavailable} onClick={onCheck}>{busy || update.state === 'checking' ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {update.state === 'failed' ? 'Try again' : 'Check now'}</button>}</div></div></div></section>
}

function UpdateInstallConfirmation({update, busy, onCancel, onConfirm}: {update: SoftwareUpdateStatus; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  const ready = update.state === 'ready'
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="update-install-title"><header><div><span><Download size={17}/></span><div><h2 id="update-install-title">Install ReviewArc {update.release?.version}?</h2><p>{ready ? 'The update is downloaded and ready.' : 'ReviewArc will download the signed update.'}</p></div></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onCancel}><X size={17}/></button></header><div className="publish-comments"><article><p>ReviewArc will close and reopen to finish the update. macOS may ask for an administrator username and password to replace the app in Applications.</p></article></div><footer><button className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <Download size={15}/>} {ready ? 'Install and restart' : 'Install update'}</button></footer></section></div>
}

export function SettingsScreen({state, theme = 'system', onThemeChange = () => {}, update, updateBusy = false, onCheckUpdate = () => {}, onSetUpdateChannel = () => {}, onInstallUpdate = () => {}, onSources, analysisConfiguration, analysisConfigurationLoading = false, analysisConfigurationBusy = false, analysisConfigurationError = '', onRefreshAnalysis = () => {}, onSaveAnalysisDefaults = () => {}}: {state: BootstrapState; theme?: ThemePreference; onThemeChange?: (theme: ThemePreference) => void; update?: SoftwareUpdateStatus; updateBusy?: boolean; onCheckUpdate?: () => void; onSetUpdateChannel?: (channel: UpdateChannel) => void; onInstallUpdate?: () => void; onSources: () => void; analysisConfiguration?: AnalysisConfiguration; analysisConfigurationLoading?: boolean; analysisConfigurationBusy?: boolean; analysisConfigurationError?: string; onRefreshAnalysis?: () => void; onSaveAnalysisDefaults?: (profile: AnalysisProfile) => Promise<void> | void}) {
  const protocol = (state.gitProtocol || 'https').toUpperCase()
  const selectedSources = state.selections.filter((selection) => selection.enabled).length
  const themeOptions = [
    {value: 'system' as const, label: 'System', icon: <Monitor size={15}/>},
    {value: 'light' as const, label: 'Light', icon: <Sun size={15}/>},
    {value: 'dark' as const, label: 'Dark', icon: <Moon size={15}/>},
  ]
  return <main className="page settings-page">
    <div className="page-heading"><div><h1>Settings</h1><p>Configure ReviewArc’s appearance, local tools, and GitHub sources.</p></div></div>
    <div className="settings-layout">
      <section>
        <div className="settings-section-heading"><h2>Appearance</h2><p>Use a fixed theme or match your Mac.</p></div>
        <div className="settings-section-body">
          <div className="theme-preference" role="group" aria-label="Appearance">{themeOptions.map((option) => <button type="button" key={option.value} aria-pressed={theme === option.value} onClick={() => onThemeChange(option.value)}>{option.icon}<span>{option.label}</span></button>)}</div>
          <p className="theme-preference-help">System follows the appearance selected in macOS and updates when it changes.</p>
        </div>
      </section>
      <AIAnalysisSettings configuration={analysisConfiguration ?? {harnesses: []}} loading={analysisConfigurationLoading} busy={analysisConfigurationBusy} error={analysisConfigurationError} onRefresh={onRefreshAnalysis} onSave={onSaveAnalysisDefaults}/>
      <section>
        <div className="settings-section-heading"><h2>Connections</h2><p>Tool readiness, GitHub identity, and Git transport.</p></div>
        <div className="settings-section-body settings-rows">
          {state.dependencies.filter((dependency) => dependency.name !== 'codex').map((dep) => <div key={dep.name}><span className={`setup-status ${dep.state}`}>{dep.state === 'available' ? <Check size={14}/> : <X size={14}/>}</span><div><strong>{dependencyLabel(dep.name)}</strong><small>{dep.version || dep.message || (dep.state === 'available' ? 'Available' : 'Not detected by ReviewArc')}</small>{dep.state !== 'available' && <p className="dependency-help">{missingDependencyHelp(dep.name)}</p>}</div><code title={dep.path}>{dep.path || 'Not found'}</code></div>)}
          <div><span className="setup-status available"><Check size={14}/></span><div><strong>Authenticated as @{state.account?.login || 'unknown'}</strong><small>Credentials are managed by GitHub CLI.</small></div><code>gh</code></div>
          <div><span className="setup-status available"><GitPullRequest size={14}/></span><div><strong>Git operations: {protocol}</strong><small>Managed repository fetches follow your <code>gh</code> protocol setting.</small></div><code>{state.gitProtocol || 'https'}</code></div>
        </div>
      </section>
      <section><div className="settings-section-heading"><h2>Review sources</h2><p>Choose which organizations and repositories feed your inbox.</p></div><div className="settings-section-body settings-rows"><div className="settings-action-row"><span className="setup-status available"><GitPullRequest size={14}/></span><div><strong>{selectedSources} source{selectedSources === 1 ? '' : 's'} selected</strong><small>Open pull requests are loaded only from enabled sources.</small></div><button className="button secondary" onClick={onSources}><SlidersHorizontal size={15}/>Manage sources</button></div></div></section>
      {update && (
        <SoftwareUpdateSettings update={update} busy={updateBusy} onCheck={onCheckUpdate} onSetChannel={onSetUpdateChannel} onInstall={onInstallUpdate}/>
      )}
      <section><div className="settings-section-heading"><h2>About &amp; legal</h2><p>ReviewArc and the open-source software it includes.</p></div><div className="settings-section-body settings-rows"><div className="settings-action-row"><span className="setup-status available"><CircleHelp size={14}/></span><div><strong>Third-party notices</strong><small>View license and attribution notices bundled with this copy of ReviewArc.</small></div><button className="button secondary" onClick={() => void backend.openThirdPartyNotices()}>View notices<ExternalLink size={13}/></button></div></div></section>
      <section><div className="settings-section-heading"><h2>Local data</h2><p>Application-owned storage used for repository analysis and saved review state.</p></div><div className="settings-section-body"><dl className="path-list"><div><dt>Application data</dt><dd>{state.paths.root}</dd></div><div><dt>Repository caches</dt><dd>{state.paths.repositories}</dd></div><div><dt>Analysis worktrees</dt><dd>{state.paths.worktrees}</dd></div><div><dt>Database</dt><dd>{state.paths.database}</dd></div><div><dt>Logs</dt><dd>{state.paths.logs}</dd></div><div><dt>Temporary cache</dt><dd>{state.paths.cache}</dd></div></dl><p className="safety-copy"><CircleHelp size={16}/><span>PR analysis uses the repository cache and isolated worktree listed above. ReviewArc invokes your installed <code>git</code>, <code>gh</code>, and selected AI harness, which may read their own configuration and credentials.</span></p></div></section>
    </div>
  </main>
}
