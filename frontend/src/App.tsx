import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Code2, Download,
  Columns2, Command, ExternalLink, FileCode2, FileDiff, Filter, GitPullRequest, Inbox, ListFilter, LoaderCircle,
  Maximize2, MessageSquare, Minimize2, Monitor, Moon, PanelRight, Pencil, Plus, RefreshCw, Reply, Search, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Sun, Trash2, X,
} from 'lucide-react'
import { backend, BridgeUnavailableError } from './bridge'
import { AnalysisBadge, DependencyPills, EmptyState, ErrorBanner, Logo, Markdown, RiskBadge, SelectControl, Skeleton, StatusDot, WindowControls } from './components'
import { WindowToggleMaximise } from '../wailsjs/runtime/runtime'
import { analysisLabel, chapterStatusLabel, filterInbox, normalizeProgress, primaryRelationship, relationshipLabel, relativeTime, repoName } from './lib'
import { useTheme, type ThemePreference } from './theme'
import {
  AIAnalysisSettings, AnalysisFailurePanel, AnalysisProfilePicker, AnalysisProfileSummary, AnalysisProgress,
  AnalysisRunDetails, NoHarnessState, legacyAnalysisConfiguration, recommendedProfile,
} from './features/analysis/analysis'
import type {
  AnalysisConfiguration, AnalysisFailure, AnalysisProfile, AnalysisStatus, BootstrapState, ChangedFile, ChapterStatus, CommentRange, DependencyStatus, DiffFile, EnvironmentState, EvidenceReference, FileContent, Operation,
  OperationEvent, PublishPreview, PullRequestRef, PullRequestReviewComment, PullRequestSummary, Relationship, ReviewChapter, ReviewRisk,
  Repository, RepositoryPage, ReviewComment, ReviewSession, SoftwareUpdateStatus, SourceSelection, SourceState, UpdateChannel, Organization,
  ThreadReplyPreview,
} from './types'

type Screen = 'inbox' | 'sources' | 'settings' | 'overview' | 'review'
type DraftTarget = {path: string; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; line: number; side: 'LEFT' | 'RIGHT'}

const PierreDiffRenderer = lazy(() => import('./PierreRenderer').then((module) => ({default: module.PierreDiffRenderer})))
const PierreFileRenderer = lazy(() => import('./PierreRenderer').then((module) => ({default: module.PierreFileRenderer})))
const PierreCodeExcerpt = lazy(() => import('./PierreRenderer').then((module) => ({default: module.PierreCodeExcerpt})))
const inboxPageSize = 100

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'The operation did not complete. Check the local logs and try again.'
}

function toggleWindowOnHeaderDoubleClick(event: ReactMouseEvent<HTMLElement>) {
  if ((event.target as HTMLElement).closest('button, a, input, textarea, select, label')) return
  WindowToggleMaximise()
}

function useDialogFocus(onClose: () => void) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? [])]
    focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusable(); if (!items.length) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0].focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])
}

function savedInboxFilters() {
  try { return JSON.parse(window.localStorage?.getItem?.('reviewarc:inbox-view') ?? '{}') as {relationship?: Relationship | 'all'; label?: string; analysis?: AnalysisStatus | 'all'} } catch { return {} }
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
	setError(''); setSession(undefined); setOpeningPR(pr); setReviewChapterId(''); setScreen('overview')
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
  if (!bootstrap) return <main className="startup"><WindowControls/><Logo/><ErrorBanner message={error || 'ReviewArc could not load its local state.'} onRetry={load}/></main>

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
      <SettingsScreen state={bootstrap} theme={theme.preference} onThemeChange={theme.setPreference} update={softwareUpdate} updateBusy={updateBusy} onCheckUpdate={checkForUpdates} onSetUpdateChannel={setUpdateChannel} onInstallUpdate={() => setInstallUpdateOpen(true)} onSources={() => setScreen('sources')} analysisConfiguration={effectiveAnalysisConfiguration} analysisConfigurationLoading={configurableAnalysisBackend && !analysisConfiguration && !analysisConfigurationError} analysisConfigurationBusy={analysisConfigurationBusy} analysisConfigurationError={analysisConfigurationError} onRefreshAnalysis={refreshAnalysisHarnesses} onSaveAnalysisDefaults={saveAnalysisDefaults}/>
    )}
    {screen === 'inbox' && <InboxScreen state={bootstrap} onUpdate={(inbox) => setBootstrap({...bootstrap, inbox})} onOpen={openPR}/>}
    {openingPR && screen === 'overview' && <OpeningPullRequest pr={openingPR} onBack={() => { openRequest.current++; setOpeningPR(undefined); setScreen('inbox') }}/>}
    {session && screen === 'overview' && !effectiveAnalysisConfiguration && (
      <AnalysisConfigurationGate session={session} error={analysisConfigurationError} busy={analysisConfigurationBusy} onRetry={refreshAnalysisHarnesses} onBack={() => { openRequest.current++; setSession(undefined); setReviewChapterId(''); setScreen('inbox') }}/>
    )}
    {session && screen === 'overview' && effectiveAnalysisConfiguration && (
      <OverviewScreen session={session} analysisConfiguration={effectiveAnalysisConfiguration} legacyAnalysis={!configurableAnalysisBackend} onAnalysisConfiguration={(configuration) => setAnalysisConfiguration(configuration)} onRefreshHarnesses={refreshAnalysisHarnesses} onOpenSettings={() => setScreen('settings')} onBack={() => { openRequest.current++; setSession(undefined); setReviewChapterId(''); setScreen('inbox') }} onSession={setSession} onReview={(chapterId) => { setReviewChapterId(chapterId ?? ''); setScreen('review') }}/>
    )}
    {session && screen === 'review' && (
      <ReviewWorkspace session={session} initialChapterId={reviewChapterId} onSession={setSession} onBack={() => setScreen('overview')}/>
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

function OrganizationSourceRow({org, count, active, checked, onFilter, onToggle}: {org: Organization; count?: number; active: boolean; checked: boolean; onFilter: () => void; onToggle: () => void}) {
  const access = org.accessStatus ?? 'available'
  const detail = access === 'ssoRequired' ? 'SSO authorization required' : access === 'denied' ? 'Access denied' : count === undefined ? 'Open to load repositories' : `${count} ${count === 1 ? 'repository' : 'repositories'}`
  return <div className={`source-org-row${active ? ' active' : ''}${access !== 'available' ? ` access-${access}` : ''}`}>
    <button className="org-focus" aria-label={`Show repositories from ${org.login}`} aria-pressed={active} onClick={onFilter}>{org.avatarUrl ? <img src={org.avatarUrl} alt=""/> : <span className="org-avatar">{org.login.slice(0, 1).toUpperCase()}</span>}<span><b>{org.login}</b><small>{detail}</small></span></button>
    {access === 'ssoRequired' && org.ssoUrl ? <button className="org-sso-action" aria-label={`Authorize SSO for ${org.login}`} onClick={() => backend.openGitHubSSO(org.ssoUrl!)}>Authorize<ExternalLink size={11}/></button> : access === 'denied' ? <span className="org-access-badge">Denied</span> : <label className="org-include" title={`Include every repository from ${org.login}`}><span>Include all</span><input type="checkbox" checked={checked} aria-label={`Include all repositories from ${org.login}`} onChange={onToggle}/><span className="check-box"><Check size={13}/></span></label>}
  </div>
}

export function SourceSelector({state, onDone}: {state: BootstrapState; onDone: () => Promise<void>}) {
  const [catalog, setCatalog] = useState<SourceState>()
  const [selected, setSelected] = useState<Set<string>>(new Set(state.selections.filter((x) => x.enabled).map((x) => `${x.kind}:${x.key}`)))
  const [query, setQuery] = useState('')
  const [organization, setOrganization] = useState('included')
  const [ownerPage, setOwnerPage] = useState<RepositoryPage>()
  const [browsePage, setBrowsePage] = useState<RepositoryPage>()
  const [ownerCounts, setOwnerCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [accessBusy, setAccessBusy] = useState(false)
  const [ownerBusy, setOwnerBusy] = useState(false)
  const [error, setError] = useState('')
  const ownerRequest = useRef(0)
  const searchRequest = useRef(0)
  const previousSearch = useRef('')
  const selectedOrganization = catalog?.organizations.find((org) => org.login.toLowerCase() === organization.toLowerCase())
  const refreshAccess = async (organizations = catalog?.organizations ?? []) => {
	setAccessBusy(true)
	try {
	  const checked = await backend.refreshSourceAccess(organizations)
	  setCatalog((current) => current ? {...current, organizations: checked} : current)
	} catch (err) { setError(errorText(err)) } finally { setAccessBusy(false) }
  }
  const refreshSelectedRepositories = async () => {
	try {
	  const refreshed = await backend.refreshSelectedRepositories()
	  setCatalog((current) => current ? {...current, repositories: refreshed.repositories ?? []} : current)
	  if (refreshed.archivedKeys?.length) {
		setSelected((current) => {
		  const next = new Set(current)
		  for (const key of refreshed.archivedKeys) next.delete(`repository:${key}`)
		  return next
		})
	  }
	} catch (err) { setError(errorText(err)) }
  }
  const loadCatalog = async () => {
    setError('')
    try {
	  const next = await backend.listSources()
	  setCatalog(next)
	  void refreshAccess(next.organizations)
	  void refreshSelectedRepositories()
    } catch (err) { setError(errorText(err)) }
  }
  useEffect(() => { void loadCatalog() }, [])
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next })
  const loadOwner = async (owner: string) => {
    const request = ++ownerRequest.current
    searchRequest.current++
    previousSearch.current = ''
    const activeSearch = searchRequest.current
    setOrganization(owner); setQuery(''); setOwnerBusy(true); setError(''); setOwnerPage(undefined); setBrowsePage(undefined)
    try {
      const cached = await backend.listCachedOwnerRepositories(owner)
      if (ownerRequest.current === request && cached.items.length) {
        setBrowsePage(cached)
        if (searchRequest.current === activeSearch) setOwnerPage(cached)
      }
      const fresh = await backend.refreshOwnerRepositories(owner)
      if (ownerRequest.current === request) {
        setBrowsePage(fresh)
        if (searchRequest.current === activeSearch) setOwnerPage(fresh)
        setOwnerCounts((counts) => ({...counts, [owner.toLowerCase()]: fresh.totalCount}))
      }
    } catch (err) { if (ownerRequest.current === request && searchRequest.current === activeSearch) setError(errorText(err)) } finally { if (ownerRequest.current === request && searchRequest.current === activeSearch) setOwnerBusy(false) }
  }
  const loadMore = async () => {
    if (!ownerPage?.hasNextPage || !ownerPage.endCursor || ownerBusy) return
    const request = ownerRequest.current
    const activeSearch = searchRequest.current
    setOwnerBusy(true); setError('')
    try {
      const search = query.trim()
      const next = search
        ? await backend.searchOwnerRepositories(organization, search, ownerPage.endCursor, selectedOrganization !== undefined)
        : await backend.refreshOwnerRepositories(organization, ownerPage.endCursor)
      if (ownerRequest.current === request && searchRequest.current === activeSearch) {
        const items = new Map(ownerPage.items.map((repo) => [`${repo.ref.owner}/${repo.ref.name}`.toLowerCase(), repo]))
        for (const repo of next.items) items.set(`${repo.ref.owner}/${repo.ref.name}`.toLowerCase(), repo)
        const merged = {...next, items: [...items.values()]}
        setOwnerPage(merged)
        if (!search) setBrowsePage(merged)
        setOwnerCounts((counts) => ({...counts, [organization.toLowerCase()]: next.totalCount}))
      }
    } catch (err) { if (ownerRequest.current === request && searchRequest.current === activeSearch) setError(errorText(err)) } finally { if (ownerRequest.current === request && searchRequest.current === activeSearch) setOwnerBusy(false) }
  }
  useEffect(() => {
    const search = query.trim()
    if (organization === 'included') return
    if (!search) {
      if (previousSearch.current) {
        previousSearch.current = ''
        searchRequest.current++
        setOwnerPage(browsePage)
        setOwnerBusy(false)
      }
      return
    }
    previousSearch.current = search
    const request = ++searchRequest.current
    const ownerVersion = ownerRequest.current
    const owner = organization
    const organizationSearch = selectedOrganization !== undefined
    const timer = window.setTimeout(() => {
      setOwnerBusy(true); setError('')
      void backend.searchOwnerRepositories(owner, search, '', organizationSearch).then((page) => {
        if (ownerRequest.current === ownerVersion && searchRequest.current === request) setOwnerPage(page)
      }).catch((err) => {
        if (ownerRequest.current === ownerVersion && searchRequest.current === request) setError(errorText(err))
      }).finally(() => {
        if (ownerRequest.current === ownerVersion && searchRequest.current === request) setOwnerBusy(false)
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, organization, selectedOrganization])
  const save = async () => {
    setBusy(true); setError('')
    const selections: SourceSelection[] = [...selected].map((entry) => { const [kind, ...parts] = entry.split(':'); return {kind: kind as SourceSelection['kind'], key: parts.join(':'), enabled: true} })
    try { await backend.saveSelections(selections); await onDone() } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  const repositories = organization === 'included' ? catalog?.repositories ?? [] : ownerPage?.items ?? []
  const personalLogin = state.account?.login ?? ''
  const personalCount = ownerCounts[personalLogin.toLowerCase()]
  const personalSelected = personalLogin !== '' && organization.toLowerCase() === personalLogin.toLowerCase()
  useEffect(() => {
    if (selectedOrganization?.accessStatus === 'ssoRequired' || selectedOrganization?.accessStatus === 'denied') {
      ownerRequest.current++
      searchRequest.current++
      setOwnerPage({items: [], totalCount: 0, hasNextPage: false, cached: false})
      setBrowsePage(undefined)
      setOwnerBusy(false)
    }
  }, [selectedOrganization?.accessStatus, organization])
  const repos = repositories.filter((repo) => {
    if (repo.isArchived) return false
    return `${repo.ref.owner}/${repo.ref.name} ${repo.description}`.toLowerCase().includes(query.toLowerCase())
  })
  const selectedOrganizations = [...selected].filter((key) => key.startsWith('organization:')).map((key) => key.slice('organization:'.length)).sort()
  const selectedRepositoryKeys = [...selected].filter((key) => key.startsWith('repository:')).map((key) => key.slice('repository:'.length)).sort()
  const includedRepositories = selectedRepositoryKeys.filter((name) => {
    const repository = catalog?.repositories.find((repo) => `${repo.ref.owner}/${repo.ref.name}`.toLowerCase() === name.toLowerCase())
    return `${name} ${repository?.description ?? ''}`.toLowerCase().includes(query.toLowerCase())
  })
  return <main className="page source-page"><div className="page-heading"><div><h1>Repository sources</h1><p>Choose where ReviewArc should look for open pull requests. Repositories are only fetched when you open a PR.</p></div><button className="button primary" disabled={busy || selected.size === 0} onClick={save}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Save sources</button></div>
    {error && <ErrorBanner message={error}/>}<div className="source-toolbar"><label className="search-field"><Search size={16}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={organization === 'included' ? 'Search included repositories' : 'Search all repositories'}/></label><button className="button secondary small" disabled={accessBusy} onClick={() => void refreshAccess()}>{accessBusy ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}Refresh access</button><span>{selected.size} {selected.size === 1 ? 'source' : 'sources'} included</span></div>
    <div className="source-layout">
      <aside>
        <div className="source-section-heading">
          <h2>Repository owners</h2>
          <button className={organization === 'included' ? 'active' : ''} aria-pressed={organization === 'included'} onClick={() => { ownerRequest.current++; searchRequest.current++; setOrganization('included'); setOwnerPage(undefined); setBrowsePage(undefined); setQuery('') }}>Included</button>
        </div>
        <div className="organization-choices">
          {personalLogin && <><p className="source-group-label">Personal account</p><div className={`source-org-row personal${personalSelected ? ' active' : ''}`}><button className="org-focus" aria-label={`Show personal repositories from ${personalLogin}`} aria-pressed={personalSelected} onClick={() => void loadOwner(personalLogin)}>{state.account?.avatarUrl ? <img src={state.account.avatarUrl} alt=""/> : <span className="org-avatar">{personalLogin.slice(0, 1).toUpperCase()}</span>}<span><b>{personalLogin}</b><small>{personalCount === undefined ? 'Open to load repositories' : `${personalCount} personal ${personalCount === 1 ? 'repository' : 'repositories'}`}</small></span></button></div></>}
          <p className="source-group-label">Organizations</p>
          {catalog?.organizations.map((org) => {
            const key = `organization:${org.login}`
            const blocked = org.accessStatus === 'ssoRequired' || org.accessStatus === 'denied'
            return <OrganizationSourceRow key={key} org={org} count={ownerCounts[org.login.toLowerCase()]} active={organization.toLowerCase() === org.login.toLowerCase()} checked={selected.has(key)} onFilter={() => blocked ? (ownerRequest.current++, searchRequest.current++, setOrganization(org.login), setOwnerPage({items: [], totalCount: 0, hasNextPage: false, cached: false}), setBrowsePage(undefined)) : void loadOwner(org.login)} onToggle={() => toggle(key)}/>
          })}
          {!catalog && <div className="owner-loading"><LoaderCircle className="spin" size={13}/>Loading owners…</div>}
        </div>
      </aside>
      <section>
        <div className="source-section-heading"><h2>{organization === 'included' ? 'Included sources' : personalSelected ? 'Personal repositories' : `${organization} repositories`}</h2><span>{organization === 'included' ? selected.size : ownerPage?.totalCount ?? '—'}</span></div>
        <div className="repository-choices">
          {organization === 'included' && selectedOrganizations.map((owner) => <div className="source-rule" key={`included:${owner}`}><span className="included-mark"><Check size={13}/></span><span className="source-rule-copy"><strong>{owner}</strong><small>Every active repository in this organization</small></span><button className="button text small" aria-label={`Remove ${owner} organization from included sources`} onClick={() => toggle(`organization:${owner}`)}>Remove</button></div>)}
          {organization === 'included' ? includedRepositories.map((name) => {
            const repository = catalog?.repositories.find((repo) => `${repo.ref.owner}/${repo.ref.name}`.toLowerCase() === name.toLowerCase())
            return <div className="source-rule" key={`included:${name}`}><span className="included-mark"><Check size={13}/></span><span className="source-rule-copy"><strong>{name}</strong><small>{repository?.description || 'Repository'}</small></span><button className="button text small" aria-label={`Remove ${name} repository from included sources`} onClick={() => toggle(`repository:${name}`)}>Remove</button></div>
          }) : repos.map((repo) => {
            const name = `${repo.ref.owner}/${repo.ref.name}`
            const key = `repository:${name}`
            const inherited = selected.has(`organization:${repo.ref.owner}`)
            return <label className={`repo-choice${inherited ? ' inherited' : ''}`} key={key}><input type="checkbox" checked={inherited || selected.has(key)} disabled={inherited} onChange={() => toggle(key)}/><span className="check-box"><Check size={13}/></span><span><strong>{name}</strong><small>{inherited ? `Included through ${repo.ref.owner}` : repo.description || (repo.isPrivate ? 'Private repository' : 'GitHub repository')}</small></span>{repo.isPrivate && <span className="privacy">Private</span>}</label>
          })}
          {ownerBusy && !repos.length && <div className="owner-page-loading"><LoaderCircle className="spin" size={17}/><p>{query.trim() ? 'Searching repositories…' : 'Loading the first 50 active repositories…'}</p></div>}
          {!ownerBusy && !repos.length && organization !== 'included' && <div className="source-empty">{selectedOrganization?.accessStatus === 'ssoRequired' ? <ShieldCheck size={18}/> : <Search size={18}/>}<p>{selectedOrganization?.accessStatus === 'ssoRequired' ? `Authorize SSO for ${selectedOrganization.login}, then refresh access to load its repositories.` : selectedOrganization?.accessStatus === 'denied' ? `GitHub denied access to ${selectedOrganization.login}.` : 'No active repositories match this owner and search.'}</p></div>}
          {organization === 'included' && !selected.size && <div className="source-empty"><Search size={18}/><p>Select a repository or include an organization to build your review inbox.</p></div>}
        </div>
        {ownerPage && organization !== 'included' && <div className="source-pagination"><span>{query.trim() ? `Showing ${ownerPage.items.length} of ${ownerPage.totalCount} matching repositories` : `Showing ${ownerPage.items.length} of ${ownerPage.totalCount}`}</span>{ownerPage.hasNextPage && <button className="button secondary small" disabled={ownerBusy} onClick={() => void loadMore()}>{ownerBusy ? <LoaderCircle className="spin" size={14}/> : null}Load 50 more</button>}</div>}
      </section>
    </div>
  </main>
}

function InboxScreen({state, onUpdate, onOpen}: {state: BootstrapState; onUpdate: (items: PullRequestSummary[]) => void; onOpen: (pr: PullRequestSummary) => void}) {
  const saved = useMemo(savedInboxFilters, [])
  const [query, setQuery] = useState(''); const [relationship, setRelationship] = useState<Relationship | 'all'>(saved.relationship ?? 'all'); const [organization, setOrganization] = useState('all'); const [repository, setRepository] = useState('all'); const [label, setLabel] = useState(saved.label ?? 'all'); const [analysis, setAnalysis] = useState<AnalysisStatus | 'all'>(saved.analysis ?? 'all'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [partial, setPartial] = useState<string[]>([])
  const [visibility, setVisibility] = useState({source: state.inbox, limit: inboxPageSize})
  const visibleLimit = visibility.source === state.inbox ? visibility.limit : inboxPageSize
  const resetVisibleLimit = () => setVisibility({source: state.inbox, limit: inboxPageSize})
  const refresh = async () => { setBusy(true); setError(''); try { const result = await backend.refreshInbox(); onUpdate(result.items ?? []); setPartial(Object.values(result.errors ?? {})) } catch (err) { setError(errorText(err)) } finally { setBusy(false) } }
  useEffect(() => { if (!state.inbox.length) void refresh() }, [])
  useEffect(() => { try { window.localStorage?.setItem?.('reviewarc:inbox-view', JSON.stringify({relationship, label, analysis})) } catch { /* The inbox remains usable when WebView storage is unavailable. */ } }, [relationship, label, analysis])
  const repositories = useMemo(() => [...new Set(state.inbox.map(repoName))].sort(), [state.inbox])
  const organizations = useMemo(() => [...new Set(state.inbox.map((pr) => pr.ref.repository.owner))].sort(), [state.inbox])
  const labels = useMemo(() => {
    const values = new Map<string, string>()
    for (const item of state.inbox.flatMap((pr) => pr.labels)) if (item.trim() && !values.has(item.toLocaleLowerCase())) values.set(item.toLocaleLowerCase(), item)
    return [...values.values()].sort((a, b) => a.localeCompare(b))
  }, [state.inbox])
  useEffect(() => {
    if (label === 'all') return
    const current = labels.find((item) => item.localeCompare(label, undefined, {sensitivity: 'accent'}) === 0)
    if ((current ?? 'all') !== label) { setVisibility({source: state.inbox, limit: inboxPageSize}); setLabel(current ?? 'all') }
  }, [label, labels, state.inbox])
  const items = useMemo(() => filterInbox(state.inbox, query, relationship, repository, label, analysis).filter((pr) => organization === 'all' || pr.ref.repository.owner === organization), [state.inbox, query, relationship, organization, repository, label, analysis])
  const visibleItems = items.slice(0, visibleLimit)
  const remainingItems = items.length - visibleItems.length
  const allOpen = !query.trim() && relationship === 'all' && organization === 'all' && repository === 'all' && label === 'all' && analysis === 'all'
  const resetFilters = () => { resetVisibleLimit(); setQuery(''); setRelationship('all'); setOrganization('all'); setRepository('all'); setLabel('all'); setAnalysis('all') }
  return <main className="page inbox-page"><div className="page-heading"><div><h1>Pull request inbox</h1><p>Open work across {repositories.length || 'your selected'} repositories, ordered by recent activity.</p></div><button className="button secondary" disabled={busy} onClick={refresh}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}Refresh</button></div>
    {error && <ErrorBanner message={error} onRetry={refresh}/>} {partial.length > 0 && <div className="warning-banner"><AlertTriangle size={16}/><span>Some repositories could not be refreshed. Showing the available results.</span></div>}
    <div className="inbox-controls"><label className="search-field inbox-search"><Search size={17}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => {resetVisibleLimit(); setQuery(e.target.value)}} placeholder="Search title, repository, author, PR number, or label"/></label><Select label="Relationship" value={relationship} onChange={(value) => {resetVisibleLimit(); setRelationship(value as typeof relationship)}} options={[['all','All relationships'],['reviewRequested','Needs your review'],['assigned','Assigned'],['authored','Authored by you'],['selectedRepo','All selected']]}/><Select label="Organization" value={organization} onChange={(value) => {resetVisibleLimit(); setOrganization(value)}} options={[['all','All organizations'], ...organizations.map((org) => [org,org])]}/><Select label="Repository" value={repository} onChange={(value) => {resetVisibleLimit(); setRepository(value)}} options={[['all','All repositories'], ...repositories.map((r) => [r,r])]}/><Select label="Label" value={label} onChange={(value) => {resetVisibleLimit(); setLabel(value)}} options={[['all','All labels'], ...labels.map((item) => [item,item])]}/><Select label="Analysis" value={analysis} onChange={(value) => {resetVisibleLimit(); setAnalysis(value as typeof analysis)}} options={[['all','All analysis states'],['ready','Guided review ready'],['notStarted','Not analyzed'],['running','Analyzing'],['stale','Stale'],['failed','Failed']]}/></div>
    <div className="saved-views" aria-label="Saved inbox views"><span>Views</span><button className={relationship === 'reviewRequested' ? 'active' : ''} aria-pressed={relationship === 'reviewRequested'} onClick={() => {resetVisibleLimit(); setRelationship('reviewRequested')}}>Needs my review</button><button className={relationship === 'authored' ? 'active' : ''} aria-pressed={relationship === 'authored'} onClick={() => {resetVisibleLimit(); setRelationship('authored')}}>Authored by me</button><button className={analysis === 'ready' ? 'active' : ''} aria-pressed={analysis === 'ready'} onClick={() => {resetVisibleLimit(); setAnalysis('ready')}}>Guided review ready</button><button className={allOpen ? 'active' : ''} aria-pressed={allOpen} onClick={resetFilters}>All open</button></div><div className="inbox-summary"><div className="result-count" role="status" aria-label="Inbox result count">Showing <strong>{items.length}</strong>{items.length === state.inbox.length ? '' : ` of ${state.inbox.length}`} open pull request{state.inbox.length === 1 ? '' : 's'}</div><span>Sorted by last updated</span></div>
    {busy && !state.inbox.length ? <Skeleton rows={7}/> : !items.length ? <EmptyState icon={<GitPullRequest/>} title={state.inbox.length ? 'No pull requests match these filters' : 'Your review queue is clear'}><p>{state.inbox.length ? 'Broaden the search or reset one of the filters.' : 'ReviewArc found no open pull requests in the selected sources. Refresh after new work is opened.'}</p>{state.inbox.length > 0 && <button className="button secondary" onClick={resetFilters}>Reset filters</button>}</EmptyState> : <div className="pr-list" id="pull-request-results" aria-label="Pull request results">{visibleItems.map((pr) => <PRRow key={`${repoName(pr)}#${pr.ref.number}`} pr={pr} onOpen={() => onOpen(pr)}/>)}{remainingItems > 0 && <div className="inbox-pagination"><span aria-live="polite">Showing {visibleItems.length} of {items.length}</span><button className="button secondary small" aria-controls="pull-request-results" aria-label={`Show ${Math.min(inboxPageSize, remainingItems)} more pull requests`} onClick={() => setVisibility({source: state.inbox, limit: visibleLimit + inboxPageSize})}>Show more</button></div>}</div>}
  </main>
}

function Select({label, value, onChange, options}: {label: string; value: string; onChange: (value: string) => void; options: string[][]}) { return <SelectControl label={label} value={value} onChange={onChange} icon={<Filter size={14}/>} options={options.map(([optionValue, optionLabel]) => ({value: optionValue, label: optionLabel}))}/> }

function trapPanelFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function PRRow({pr, onOpen}: {pr: PullRequestSummary; onOpen: () => void}) {
  const progress = normalizeProgress(pr.progress)
  const relationship = primaryRelationship(pr.relationships ?? [])
  return <button className="pr-row" onClick={onOpen}><div className="pr-relation"><span className={`relation-mark ${relationship}`}/><div><span>{relationshipLabel(relationship)}</span><strong>{repoName(pr)}</strong></div></div><div className="pr-main"><div className="pr-title"><span>#{pr.ref.number}</span><strong>{pr.title}</strong>{pr.isDraft && <span className="badge neutral">Draft</span>}</div><div className="pr-meta"><span>by @{pr.author.login}</span><span>updated {relativeTime(pr.updatedAt)}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span>{pr.labels.slice(0, 2).map((item) => <span className="pr-label" key={item}>{item}</span>)}{pr.labels.length > 2 && <span className="pr-label-more">+{pr.labels.length - 2}</span>}</div></div><div className="pr-state"><div><AnalysisBadge status={pr.analysisStatus}/>{pr.analysisStatus === 'ready' && <RiskBadge level={pr.riskLevel}/>}</div>{progress.total > 0 ? <div className="progress-inline"><span><i style={{width: `${progress.percent}%`}}/></span><small>{progress.reviewed}/{progress.total} reviewed</small></div> : <small>{analysisLabel(pr.analysisStatus)}</small>}</div><ChevronRight size={18}/></button>
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
  const last = current.at(-1)
  if (last && last.stage === event.stage && last.message === event.message && last.status === event.status) {
    return [...current.slice(0, -1), event]
  }
  return [...current.slice(-7), event]
}

function eventForOperation(operation: Operation): OperationEvent {
  const completed = operation.state === 'complete' || operation.state === 'completed'
  const failed = operation.state === 'failed'
  const cancelled = operation.state === 'cancelled'
  return {stage: operation.stage, message: operation.message, progress: operation.progress, status: completed ? 'complete' : failed ? 'failed' : cancelled ? 'complete' : 'running'}
}

function mergeOperationEvents(history: Operation[], current: OperationEvent[]) {
  return [...history.map(eventForOperation), ...current].reduce<OperationEvent[]>((events, event) => appendOperationEvent(events, event), [])
}

export function OverviewScreen({session, analysisConfiguration = legacyOverviewAnalysisConfiguration, legacyAnalysis = true, onAnalysisConfiguration = () => {}, onRefreshHarnesses = () => {}, onOpenSettings = () => {}, onBack, onSession, onReview}: {session: ReviewSession; analysisConfiguration?: AnalysisConfiguration; legacyAnalysis?: boolean; onAnalysisConfiguration?: (configuration: AnalysisConfiguration) => void; onRefreshHarnesses?: () => void; onOpenSettings?: () => void; onBack: () => void; onSession: (session: ReviewSession) => void; onReview: (chapterId?: string) => void}) {
  const pr = session.pullRequest; const analysis = session.analysis; const persistedFailure = session.latestAnalysisRun?.status === 'failed' ? session.latestAnalysisRun.failure : undefined; const [operation, setOperation] = useState<Operation>(); const [events, setEvents] = useState<OperationEvent[]>([]); const [failure, setFailure] = useState<AnalysisFailure | undefined>(persistedFailure); const [profile, setProfile] = useState<AnalysisProfile | undefined>(() => recommendedProfile(analysisConfiguration)); const [profileOpen, setProfileOpen] = useState(false)
  useEffect(() => { setProfile(recommendedProfile(analysisConfiguration)); setProfileOpen(false) }, [analysisConfiguration])
  useEffect(() => { setFailure(session.latestAnalysisRun?.status === 'failed' ? session.latestAnalysisRun.failure : undefined) }, [session.id, session.latestAnalysisRun?.id, session.latestAnalysisRun?.status, session.latestAnalysisRun?.failure])
  useEffect(() => { setOperation(undefined); setEvents([]) }, [session.id])
  useEffect(() => {
    let disposed = false
    let terminalSeen = false
    let liveSeen = false
    const reloadSession = () => backend.getSession(session.id).then((next) => { if (!disposed) onSession(next) }).catch((err) => { if (!disposed) setFailure({code: 'session_reload_failed', title: 'Analysis state could not be refreshed', message: 'Return to the inbox and reopen this pull request.', action: 'none', technicalDetails: errorText(err)}) })
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
    if (session.analysisStatus === 'running') {
      backend.getActiveAnalysisOperation(session.id).then((snapshot) => {
        if (disposed || terminalSeen) return
        if (!snapshot) { void reloadSession(); return }
        if (!liveSeen) setOperation(snapshot.operation)
        setEvents((current) => mergeOperationEvents(snapshot.events, current))
      }).catch((err) => { if (!disposed) setFailure(operationFailure(errorText(err), Boolean(analysis))) })
    }
    return () => { disposed = true; offOperation(); offSession() }
  }, [analysis, session.id, session.analysisStatus, onSession])
  const analyze = async () => {
    const selected = profile ?? recommendedProfile(analysisConfiguration)
    if (!selected) return
    setFailure(undefined); setEvents([])
    try {
      const saveAsDefault = !analysisConfiguration.defaultProfile
      const next = await backend.startAnalysis(session.id, legacyAnalysis ? undefined : {profile: selected, saveAsDefault})
      setOperation(next)
      if (saveAsDefault && !legacyAnalysis) onAnalysisConfiguration({...analysisConfiguration, defaultProfile: selected})
      setProfileOpen(false)
    } catch (err) { setFailure(operationFailure(errorText(err), Boolean(analysis))) }
  }
  const running = session.analysisStatus === 'running' || Boolean(operation && !['complete', 'completed', 'failed', 'cancelled'].includes(operation.state))
  const cancel = async () => { if (!operation) return; try { await backend.cancelOperation(operation.id) } catch (err) { setFailure(operationFailure(errorText(err), Boolean(analysis))) } }
  const configured = Boolean(analysisConfiguration.defaultProfile)
  return <main className="detail-page overview-page"><div className="detail-top"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Inbox</button><div className="detail-actions">{analysis && profile && <AnalysisProfileSummary configuration={analysisConfiguration} profile={profile} expanded={profileOpen} onChange={() => setProfileOpen((open) => !open)}/>} {analysis && !profile && <button className="button secondary" onClick={onOpenSettings}><Settings size={15}/>Configure AI analysis</button>} {session.isStale ? <><button className="button secondary" disabled={!analysis || running} onClick={() => onReview()}>Continue stale review</button>{profile && <button className="button primary" disabled={running} onClick={() => void analyze()}>{running ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {running ? 'Reanalyzing' : 'Reanalyze current revision'}</button>}</> : <>{analysis && profile && <button className="button secondary" disabled={running} onClick={() => void analyze()}>{running ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {running ? 'Reanalyzing' : 'Reanalyze'}</button>}<button className="button primary" disabled={!analysis || running} onClick={() => onReview()}>Start guided review<ArrowRight size={16}/></button></>}</div></div>
    {analysis && profileOpen && profile && <div className="analysis-override" id="analysis-profile-override"><div><strong>For this run</strong><small>This changes the next analysis only. Your Settings default stays the same.</small></div><AnalysisProfilePicker configuration={analysisConfiguration} value={profile} onChange={setProfile}/><button className="button text small" onClick={() => { setProfile(recommendedProfile(analysisConfiguration)); setProfileOpen(false) }}>Use default</button></div>}
    {session.isStale && <div className="stale-banner"><AlertTriangle size={18}/><div><strong>Analysis covers an older revision</strong><p>{session.staleReason || `This guided review covers ${session.headSha.slice(0, 8)}; the pull request is now ${pr.headSha.slice(0, 8)}. Notes, drafts, and progress are preserved.`}</p></div></div>}
    {!analysis && <header className="pr-hero compact"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1><div className="hero-meta"><span>@{pr.author.login}</span><span>{pr.baseRef} ← {pr.headRef}</span><span>{pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</span><span>{pr.changedFiles} files</span>{pr.requestedReviewers.length > 0 && <span>Review: {pr.requestedReviewers.map((reviewer) => `@${reviewer.login}`).join(', ')}</span>}{pr.reviewState && <span>{pr.reviewState.replaceAll('_', ' ').toLowerCase()}</span>}<span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="hero-status"><AnalysisBadge status={running ? 'running' : session.analysisStatus}/><small>Head {pr.headSha.slice(0, 8)}</small></div></header>}
    {!analysis ? <AnalysisPanel running={running} reanalysis={false} configured={configured} configuration={analysisConfiguration} profile={profile} profileOpen={profileOpen} events={events} failure={failure} onProfileChange={setProfile} onToggleProfile={() => setProfileOpen((open) => !open)} onStart={() => void analyze()} onCancel={() => void cancel()} onRefresh={onRefreshHarnesses} onOpenSettings={onOpenSettings}/> : <>{(running || failure) && <AnalysisPanel running={running} reanalysis configured configuration={analysisConfiguration} profile={profile} profileOpen={profileOpen} events={events} failure={failure} onProfileChange={setProfile} onToggleProfile={() => setProfileOpen((open) => !open)} onStart={() => void analyze()} onCancel={() => void cancel()} onRefresh={onRefreshHarnesses} onOpenSettings={onOpenSettings}/>} {session.latestAnalysisRun && (session.latestAnalysisRun.coverage.diffFilesFullyRead < session.latestAnalysisRun.coverage.changedFilesTotal || session.latestAnalysisRun.coverage.diffFilesPartiallyRead > 0) && <div className="warning-banner analysis-coverage-warning"><AlertTriangle size={16}/><span><strong>Analysis coverage is incomplete.</strong> Full diffs were available for {session.latestAnalysisRun.coverage.diffFilesFullyRead} of {session.latestAnalysisRun.coverage.changedFilesTotal} changed files{session.latestAnalysisRun.coverage.diffFilesPartiallyRead ? `; ${session.latestAnalysisRun.coverage.diffFilesPartiallyRead} were partially paged` : ''}. <a href="#analysis-run-details">View details</a></span></div>} {analysis.summaryValidation !== 'valid' && <div className="warning-banner"><AlertTriangle size={16}/><span><strong>Summary is unverified.</strong> {analysis.summaryMessage || 'No valid code evidence supports this summary.'}</span></div>}<AnalysisOverview session={session} analysisConfiguration={analysisConfiguration} onReview={onReview}/></>}
  </main>
}

function AnalysisPanel({running, reanalysis, configured, configuration, profile, profileOpen, events, failure, onProfileChange, onToggleProfile, onStart, onCancel, onRefresh, onOpenSettings}: {running: boolean; reanalysis: boolean; configured: boolean; configuration: AnalysisConfiguration; profile?: AnalysisProfile; profileOpen: boolean; events: OperationEvent[]; failure?: AnalysisFailure; onProfileChange: (profile: AnalysisProfile) => void; onToggleProfile: () => void; onStart: () => void; onCancel: () => void; onRefresh: () => void; onOpenSettings: () => void}) {
  return <section className="analysis-launch" aria-busy={running}><div className="analysis-promise"><span><Sparkles size={24}/></span><h2>{running ? 'Building the review arc' : configured ? 'Turn this change into a guided review' : 'Choose how to analyze this change'}</h2><p>{running ? 'ReviewArc is analyzing the complete current pull request through a controlled, read-only context.' : 'ReviewArc uses a read-only repository snapshot and validates the structured result before it reaches your review.'}</p>{!running && !profile && <NoHarnessState configuration={configuration} onRefresh={onRefresh} onOpenSettings={onOpenSettings}/>} {!running && profile && <div className="analysis-profile-launch">{configured ? <AnalysisProfileSummary configuration={configuration} profile={profile} expanded={profileOpen} onChange={onToggleProfile}/> : <AnalysisProfilePicker configuration={configuration} value={profile} onChange={onProfileChange}/>} {configured && profileOpen && <AnalysisProfilePicker configuration={configuration} value={profile} onChange={onProfileChange} id="analysis-profile-override"/>}<button className="button primary" onClick={onStart}><Sparkles size={16}/>Analyze pull request</button>{!configured && <small>This becomes your default. You can change it later in Settings.</small>}</div>}</div><div><AnalysisProgress events={events} running={running} reanalysis={reanalysis} onCancel={onCancel}/>{failure && <AnalysisFailurePanel failure={failure} onRetry={onStart} onRefresh={onRefresh} onChangeProfile={onToggleProfile} onOpenSettings={onOpenSettings}/>}</div></section>
}

function AnalysisOverview({session, analysisConfiguration, onReview}: {session: ReviewSession; analysisConfiguration?: AnalysisConfiguration; onReview: (chapterId?: string) => void}) {
  const analysis = session.analysis!
  const pr = session.pullRequest
  const checks = pr.checkRuns ?? []
  const reviews = pr.reviews ?? []
  const comments = pr.reviewComments ?? []
  const riskIsVerified = (risk: ReviewRisk) => risk.evidence.some((reference) => reference.validationStatus === 'valid')
  const highestRisk = analysis.risks.find(riskIsVerified) ?? analysis.risks[0]
  const highestRiskVerified = highestRisk ? riskIsVerified(highestRisk) : false
  const blockingUnknown = analysis.unknowns[0]
  const validChecks = checks.filter((check) => ['success', 'completed', 'neutral', 'skipped'].includes(check.conclusion || check.status)).length
  const sameReference = (left: EvidenceReference, right: EvidenceReference) => left.path === right.path && left.revision === right.revision && left.startLine === right.startLine && left.endLine === right.endLine
  const overlapsReference = (left: EvidenceReference, right: EvidenceReference) => left.path === right.path && left.revision === right.revision && left.startLine <= right.endLine && right.startLine <= left.endLine
  const riskMatchScore = (candidate: ReviewRisk) => {
    if (!highestRisk) return 0
    if (candidate.id === highestRisk.id) return 10_000
    if (candidate.title === highestRisk.title) return 9_000
    const exactMatches = highestRisk.evidence.filter((reference) => candidate.evidence.some((other) => sameReference(reference, other))).length
    const overlapMatches = highestRisk.evidence.filter((reference) => candidate.evidence.some((other) => overlapsReference(reference, other))).length
    const exactEvidenceSet = highestRisk.evidence.length > 0 && exactMatches === highestRisk.evidence.length && exactMatches === candidate.evidence.length
    return (exactEvidenceSet ? 5_000 : 0) + (exactMatches * 100) + (overlapMatches * 10) - Math.abs(candidate.evidence.length - highestRisk.evidence.length)
  }
  const focusMatch = highestRiskVerified ? analysis.chapters.reduce<{chapter: ReviewChapter; score: number} | undefined>((best, chapter) => {
    const score = chapter.risks.reduce((highest, risk) => Math.max(highest, riskMatchScore(risk)), 0)
    return !best || score > best.score ? {chapter, score} : best
  }, undefined) : undefined
  const focusChapter = focusMatch && focusMatch.score > 0 ? focusMatch.chapter : undefined
  const discussionCount = reviews.length + comments.length
  const visibleDiscussionCount = Math.min(reviews.length, 3) + Math.min(comments.length, 3)

  return <div className="review-brief-layout">
    <section className="overview-document" aria-label="Pull request review overview">
      <header className="overview-masthead"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1><div className="hero-meta"><span>@{pr.author.login}</span><span>{pr.baseRef} ← {pr.headRef}</span><span>{pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="hero-status">{!session.isStale && <AnalysisBadge status={session.analysisStatus}/>}<RiskBadge level={highestRisk?.level ?? pr.riskLevel}/><small>Head {pr.headSha.slice(0, 8)}</small></div></header>

      <section className="overview-change" aria-labelledby="review-brief-title">
        <h2 id="review-brief-title">What changed</h2>
        <p>{analysis.summary}</p>
        {analysis.affectedAreas.length > 0 && <div className="overview-change-map"><span>Affected areas</span><ul aria-label="Affected areas">{analysis.affectedAreas.map((area) => <li key={area.name}>{area.name}</li>)}</ul><details className="overview-area-details"><summary>Area details</summary><div>{analysis.affectedAreas.map((area) => <article key={area.name}><strong>{area.name}</strong><p>{area.description}</p></article>)}</div></details></div>}
      </section>

      <section className={highestRisk ? `overview-focus priority-risk-${highestRisk.level}` : 'overview-focus clear'} aria-labelledby="review-focus-title">
        <div className="overview-focus-copy"><div className="overview-focus-label"><span>{highestRiskVerified ? 'Critical attention' : highestRisk ? 'Concern to verify' : 'Review posture'}</span>{highestRiskVerified ? <RiskBadge level={highestRisk.level}/> : highestRisk ? <span className="badge neutral">Unverified</span> : <ShieldCheck size={18}/>}</div><h2 id="review-focus-title">{highestRisk?.title ?? 'No elevated risks identified'}</h2><p>{highestRisk?.description ?? 'ReviewArc produced a valid guided review without elevating a material risk. Verify the chapter evidence before deciding.'}</p></div>
        <div className="overview-focus-action">{focusChapter && <small>Best starting point · {focusChapter.title}</small>}{focusChapter ? <button className="button primary" onClick={() => onReview(focusChapter.id)}>Start with chapter {focusChapter.order}<ArrowRight size={15}/></button> : <button className="button secondary" onClick={() => onReview()}>Open guided review<ArrowRight size={15}/></button>}</div>
      </section>

      <div className="overview-reading-layout">
        <section className="review-path" aria-labelledby="review-path-title"><div className="section-title"><h2 id="review-path-title">Review path</h2><span>{analysis.chapters.length} chapter{analysis.chapters.length === 1 ? '' : 's'}</span></div><div className="overview-chapters">{analysis.chapters.map((chapter) => <button key={chapter.id} onClick={() => onReview(chapter.id)}><span>{chapter.order}</span><div><strong>{chapter.title}</strong><small>{chapter.files.length} file{chapter.files.length === 1 ? '' : 's'}{chapter.risks.length ? ` · ${chapter.risks.length} risk${chapter.risks.length === 1 ? '' : 's'}` : ''}</small></div><StatusDot status={chapter.status}/><ChevronRight size={16}/></button>)}</div></section>

        <aside className="overview-context" aria-label="Review context">
          <details className="overview-context-disclosure"><summary><span>Review context</span><small>{blockingUnknown ? '1 open question' : 'No open questions'} · {analysis.validationIssues.length ? `${analysis.validationIssues.length} unsupported` : 'Evidence checked'}</small></summary><div className="overview-context-content"><article className={blockingUnknown ? 'overview-note unknown' : 'overview-note clear'}><CircleHelp size={18}/><div><span>{blockingUnknown ? 'Open question' : 'Questions'}</span><strong>{blockingUnknown?.text ?? 'No blocking unknowns'}</strong></div></article><article className="overview-note evidence"><ShieldCheck size={18}/><div><span>Evidence</span><strong>{analysis.validationIssues.length ? `${analysis.validationIssues.length} unsupported reference${analysis.validationIssues.length === 1 ? '' : 's'}` : 'References checked'}</strong><small>{checks.length ? `${validChecks} of ${checks.length} GitHub checks are complete or passing.` : 'CI status was not available in this snapshot.'}</small></div></article></div></details>
          <div className="overview-support" aria-label="Supporting pull request context">
            {session.latestAnalysisRun && <div id="analysis-run-details"><AnalysisRunDetails run={session.latestAnalysisRun} configuration={analysisConfiguration}/></div>}
            <details className="support-disclosure"><summary><span><BookOpen size={16}/>Author context</span><small>{pr.body ? 'Pull request description' : 'No description supplied'}</small></summary><div className="support-content">{pr.body ? <Markdown className="pr-description">{pr.body}</Markdown> : <p>No pull request description was provided.</p>}</div></details>
            {checks.length > 0 && <details className="support-disclosure"><summary><span><Check size={16}/>Checks</span><small>{validChecks} of {checks.length} complete or passing</small></summary><div className="support-content">{checks.map((check) => <div className="check-row" key={check.id}><span className={`check-state ${check.conclusion || check.status}`}/><div><strong>{check.name}</strong><small>{check.conclusion || check.status}{check.appName ? ` · ${check.appName}` : ''}</small></div></div>)}</div></details>}
            {discussionCount > 0 && <details className="support-disclosure"><summary><span><MessageSquare size={16}/>Existing discussion</span><small>{visibleDiscussionCount < discussionCount ? `Latest ${visibleDiscussionCount} of ${discussionCount}` : `${discussionCount} messages`}</small></summary><div className="support-content">{reviews.slice(-3).map((review) => <div className="discussion-row" key={`review-${review.id}`}><strong>@{review.author.login} · {review.state.toLowerCase()}</strong>{review.body && <p>{review.body}</p>}</div>)}{comments.slice(-3).map((comment) => <div className="discussion-row" key={`comment-${comment.id}`}><strong>@{comment.author.login} on {comment.path}{comment.line ? `:${comment.line}` : ''}</strong><p>{comment.body}</p></div>)}</div></details>}
            {analysis.validationIssues.length > 0 && <details className="support-disclosure"><summary><span><AlertTriangle size={16}/>Unsupported analysis</span><small>{analysis.validationIssues.length > 5 ? `Showing 5 of ${analysis.validationIssues.length}` : `${analysis.validationIssues.length} references`}</small></summary><div className="support-content">{analysis.validationIssues.slice(0, 5).map((issue) => <p className="context-copy" key={issue.code + issue.evidenceId}>{issue.message}</p>)}</div></details>}
          </div>
        </aside>
      </div>
    </section>
  </div>
}

export function ReviewWorkspace({session, initialChapterId = '', onSession, onBack}: {session: ReviewSession; initialChapterId?: string; onSession: (session: ReviewSession) => void; onBack: () => void}) {
  const analysis = session.analysis!; const chapters = analysis?.chapters ?? []; const firstChapterId = chapters.some((chapter) => chapter.id === initialChapterId) ? initialChapterId : chapters[0]?.id ?? ''; const [chapterId, setChapterId] = useState(firstChapterId); const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0]; const [files, setFiles] = useState<ChangedFile[]>([]); const [filesLoading, setFilesLoading] = useState(true); const [path, setPath] = useState(chapter?.files[0]?.path ?? ''); const [diff, setDiff] = useState<DiffFile>(); const [diffError, setDiffError] = useState(''); const [panelTab, setPanelTab] = useState<'context'|'notes'|'drafts'>('context'); const [note, setNote] = useState(''); const [draft, setDraft] = useState(''); const [draftTarget, setDraftTarget] = useState<DraftTarget>(); const [busy, setBusy] = useState(false); const [publish, setPublish] = useState<PublishPreview>(); const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set(session.comments.filter((c) => c.status === 'draft').map((c) => c.id)))
  const [actionError, setActionError] = useState('')
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceReference>()
  const [fileContext, setFileContext] = useState<FileContent>()
  const [workspaceView, setWorkspaceView] = useState<'chapter' | 'diff' | 'evidence'>('chapter')
  const [focusMode, setFocusMode] = useState(false)
  const [chapterPanelOpen, setChapterPanelOpen] = useState(false)
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [threadReply, setThreadReply] = useState<ThreadReplyPreview>()
  const [threadReplyReset, setThreadReplyReset] = useState<{rootId: number; version: number}>()
  const [editingNoteId, setEditingNoteId] = useState('')
  const [editingDraftId, setEditingDraftId] = useState('')
  const evidenceRequest = useRef(0)
  const diffRequest = useRef(0)
  const chapterTriggerRef = useRef<HTMLButtonElement>(null)
  const toolsTriggerRef = useRef<HTMLButtonElement>(null)
  const chapterPanelRef = useRef<HTMLElement>(null)
  const toolsPanelRef = useRef<HTMLElement>(null)
  const chapterPanelWasOpen = useRef(false)
  const toolsPanelWasOpen = useRef(false)
  useEffect(() => { setFilesLoading(true); backend.getChangedFiles(session.id).then((value) => { setFiles(value ?? []); if (!path && value?.[0]) setPath(value[0].path) }).catch((err) => setDiffError(errorText(err))).finally(() => setFilesLoading(false)) }, [session.id])
  useEffect(() => {
    const request = ++diffRequest.current
    if (!path || workspaceView !== 'diff') { setDiff(undefined); return }
    setDiff(undefined); setDiffError('')
    backend.getDiff(session.id, path)
      .then((value) => { if (request === diffRequest.current) setDiff(value) })
      .catch((err) => { if (request === diffRequest.current) setDiffError(errorText(err)) })
    return () => { if (request === diffRequest.current) diffRequest.current++ }
  }, [session.id, path, workspaceView])
  useEffect(() => { const suggested = chapter?.files[0]?.path; evidenceRequest.current++; setFileContext(undefined); setEvidenceFocus(undefined); setWorkspaceView('chapter'); if (suggested) setPath(suggested) }, [chapterId])
  useEffect(() => {
    if (chapterPanelOpen) chapterPanelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    else if (chapterPanelWasOpen.current) chapterTriggerRef.current?.focus()
    chapterPanelWasOpen.current = chapterPanelOpen
  }, [chapterPanelOpen])
  useEffect(() => {
    if (toolsPanelOpen) toolsPanelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    else if (toolsPanelWasOpen.current) toolsTriggerRef.current?.focus()
    toolsPanelWasOpen.current = toolsPanelOpen
  }, [toolsPanelOpen])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      const index = chapters.findIndex((item) => item.id === chapterId)
      if (event.key === ']') setChapterId(chapters[Math.min(chapters.length - 1, index + 1)]?.id ?? chapterId)
      if (event.key === '[') setChapterId(chapters[Math.max(0, index - 1)]?.id ?? chapterId)
      if (event.key.toLowerCase() === 'f') { setFocusMode((value) => !value); setChapterPanelOpen(false); setToolsPanelOpen(false) }
      if (event.key === 'Escape') { setChapterPanelOpen(false); setToolsPanelOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapterId, chapters])
  if (!analysis || !chapter) return <main className="detail-page"><ErrorBanner title="Guided review unavailable" message="This session does not contain validated review chapters." onRetry={onBack} actionLabel="Back to overview"/></main>
  const status = session.chapters.find((item) => item.chapterId === chapter.id)?.status ?? chapter.status
  const setStatus = async (value: ChapterStatus) => { setBusy(true); setActionError(''); try { onSession(await backend.updateChapter(session.id, chapter.id, value)) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const addNote = async () => { if (!note.trim()) return; setBusy(true); setActionError(''); try { const saved = await backend.saveNote(session.id, chapter.id, note.trim(), editingNoteId); onSession({...session, notes: editingNoteId ? session.notes.map((item) => item.id === editingNoteId ? saved : item) : [...session.notes, saved]}); setNote(''); setEditingNoteId('') } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const deleteNote = async (id: string) => { setBusy(true); try { await backend.deleteNote(id); onSession({...session, notes: session.notes.filter((item) => item.id !== id)}); if (editingNoteId === id) { setEditingNoteId(''); setNote('') } } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const addDraft = async () => { if (!draft.trim()) return; setBusy(true); setActionError(''); const target = draftTarget; try { const saved = await backend.saveDraft(session.id, chapter.id, draft.trim(), target?.path, target?.startLine, target?.startSide, target?.line, target?.side, editingDraftId); onSession({...session, comments: editingDraftId ? session.comments.map((item) => item.id === editingDraftId ? saved : item) : [...session.comments, saved]}); setSelectedDrafts((value) => new Set(value).add(saved.id)); setDraft(''); setDraftTarget(undefined); setEditingDraftId('') } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const deleteDraft = async (id: string) => { setBusy(true); try { await backend.deleteDraft(id); onSession({...session, comments: session.comments.filter((item) => item.id !== id)}); setSelectedDrafts((value) => { const next = new Set(value); next.delete(id); return next }); if (editingDraftId === id) { setEditingDraftId(''); setDraft('') } } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const preparePublish = async () => { setBusy(true); setActionError(''); try { setPublish(await backend.preparePublish(session.id, [...selectedDrafts])) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const prepareDecision = async (event: 'APPROVE' | 'REQUEST_CHANGES') => { setBusy(true); setActionError(''); try { setPublish(await backend.prepareReview(session.id, [...selectedDrafts], event)); setSummaryOpen(false) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const confirmPublish = async () => {
    if (!publish) return
    setBusy(true); setActionError('')
    let comments: ReviewComment[]
    try { comments = await backend.confirmPublish(publish.token, publish.digest) }
    catch (err) { setActionError(`Publishing could not be confirmed locally. Refresh the pull request on GitHub before retrying: ${errorText(err)}`); setBusy(false); return }
    const ids = new Set(comments.map((comment) => comment.id))
    onSession({...session, comments: session.comments.map((comment) => ids.has(comment.id) ? comments.find((published) => published.id === comment.id)! : comment)})
    setPublish(undefined); setSelectedDrafts(new Set())
	try { onSession(await backend.refreshPullRequestContext(session.id)) }
    catch (err) { setActionError(`Published on GitHub, but ReviewArc could not refresh the local session: ${errorText(err)}`) }
    finally { setBusy(false) }
  }
  const prepareThreadReply = async (root: PullRequestReviewComment, body: string) => {
    setBusy(true); setActionError('')
    try { setThreadReply(await backend.prepareThreadReply(session.id, root.id, body)); return true }
    catch (err) { setActionError(errorText(err)); return false }
    finally { setBusy(false) }
  }
  const confirmThreadReply = async () => {
    if (!threadReply) return
    setBusy(true); setActionError('')
    let reply: PullRequestReviewComment
    try { reply = await backend.confirmThreadReply(threadReply.token, threadReply.digest) }
    catch (err) { setThreadReply(undefined); setActionError(`Reply publication could not be confirmed locally. Check the GitHub thread, then review the reply again before retrying: ${errorText(err)}`); setBusy(false); return }
    onSession({...session, pullRequest: {...session.pullRequest, reviewComments: [...session.pullRequest.reviewComments, reply]}})
    setThreadReply(undefined)
    setThreadReplyReset((value) => ({rootId: threadReply.rootCommentId, version: (value?.version ?? 0) + 1}))
	try { onSession(await backend.refreshPullRequestContext(session.id)) }
    catch (err) { setActionError(`Reply published on GitHub, but ReviewArc could not refresh the conversation: ${errorText(err)}`) }
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
  const openDiff = (nextPath = path || chapter.files[0]?.path || files[0]?.path || '') => {
    evidenceRequest.current++
    setFileContext(undefined)
    setEvidenceFocus(undefined)
    setPath(nextPath)
    setWorkspaceView('diff')
  }
  const openTools = (tab: 'context' | 'notes' | 'drafts') => { setFocusMode(false); setPanelTab(tab); setChapterPanelOpen(false); setToolsPanelOpen(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1040px)').matches) }
  const toggleFocusMode = () => { setFocusMode((value) => !value); setChapterPanelOpen(false); setToolsPanelOpen(false) }
  const moveToolTab = (event: ReactKeyboardEvent<HTMLButtonElement>, current: 'context' | 'notes' | 'drafts') => {
    const tabs = ['context', 'notes', 'drafts'] as const
    const index = tabs.indexOf(current)
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length] : undefined
    if (!next) return
    event.preventDefault()
    setPanelTab(next)
    document.getElementById(`review-tool-tab-${next}`)?.focus()
  }
  const chapterIndex = chapters.indexOf(chapter)
  const chapterPaths = new Set(chapter.files.map((file) => file.path))
  const chapterFiles = files.filter((file) => chapterPaths.has(file.path))
  const visibleFiles = chapterFiles.length ? chapterFiles : files
  return <main className={`review-shell${focusMode ? ' focus-mode' : ''}`}>
    <header className="review-header"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Overview</button><div><strong>#{session.pullRequest.ref.number} {session.pullRequest.title}</strong><span>{repoName(session.pullRequest)}</span></div>{session.isStale && <span className="badge analysis-stale"><AlertTriangle size={12}/>Stale analysis</span>}<div className="review-progress"><span><i style={{width: `${session.progress.percent}%`}}/></span><small>{session.progress.reviewed} of {session.progress.total} chapters reviewed</small></div><button className="button text small full-diff-button" aria-label="Open full diff" title="Open full diff" onClick={() => openDiff()}><FileDiff size={15}/><span>Full diff</span></button><button className="icon-button" title="Focus chapter (F)" aria-label="Focus chapter" aria-pressed={focusMode} onClick={toggleFocusMode}>{focusMode ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button><button ref={chapterTriggerRef} className="button secondary small review-panel-trigger chapter-trigger" aria-controls="review-chapters-panel" aria-expanded={chapterPanelOpen} onClick={() => {setToolsPanelOpen(false); setChapterPanelOpen((value) => !value)}}><ListFilter size={14}/>Chapters</button><button ref={toolsTriggerRef} className="button secondary small review-panel-trigger tools-trigger" aria-controls="review-tools-panel" aria-expanded={toolsPanelOpen} onClick={() => {setChapterPanelOpen(false); setToolsPanelOpen((value) => !value)}}><PanelRight size={14}/>Review tools</button><button className="button secondary small desktop-drafts-button" onClick={() => openTools('drafts')}><MessageSquare size={14}/>{session.comments.filter((c) => c.status === 'draft').length} drafts</button></header>
    <div className="review-grid"><aside ref={chapterPanelRef} id="review-chapters-panel" className={`chapter-panel${chapterPanelOpen ? ' panel-open' : ''}`} role={chapterPanelOpen ? 'dialog' : undefined} aria-modal={chapterPanelOpen || undefined} aria-label={chapterPanelOpen ? 'Review chapters' : undefined} onKeyDown={trapPanelFocus}><div className="panel-heading"><div><h2>Review chapters</h2><span>{chapterIndex + 1} of {chapters.length}</span></div></div><div className="chapter-list">{chapters.map((item) => { const state = session.chapters.find((entry) => entry.chapterId === item.id)?.status ?? item.status; return <button className={item.id === chapter.id ? 'active' : ''} key={item.id} onClick={() => {setChapterId(item.id); setChapterPanelOpen(false)}}><StatusDot status={state}/><span><strong>{item.order}. {item.title}</strong><small>{item.files.length} file{item.files.length === 1 ? '' : 's'}{item.risks.length ? ` · ${item.risks.length} risk${item.risks.length === 1 ? '' : 's'}` : ''}</small></span><ChevronRight size={14}/></button>})}</div><div className="file-section"><h3>Chapter files <span>{filesLoading ? '…' : visibleFiles.length}</span></h3>{filesLoading ? <p className="panel-loading">Loading changed files…</p> : visibleFiles.map((file) => <button className={workspaceView !== 'chapter' && file.path === path ? 'active' : ''} key={file.path} onClick={() => {openDiff(file.path); setChapterPanelOpen(false)}}><FileCode2 size={14}/><span title={file.path}>{file.path}</span><em className="additions">+{file.additions}</em><em className="deletions">−{file.deletions}</em></button>)}</div></aside>
      {workspaceView === 'chapter' ? <section className="reader-panel"><ChapterReader sessionId={session.id} chapter={chapter} chapterIndex={chapterIndex} chapterCount={chapters.length} onOpenDiff={openDiff} onEvidence={navigateEvidence} onDraft={(text) => {setDraft(text); openTools('drafts')}}/></section> : <section className="code-panel"><div className="code-toolbar narrative-code-toolbar"><div><button className="button text small" onClick={() => setWorkspaceView('chapter')}><ArrowLeft size={14}/>Back to chapter</button><span className="toolbar-separator"/><FileDiff size={15}/><strong title={path}>{path || 'Select a changed file'}</strong></div><div><span className="range-hint"><MessageSquare size={12}/>Drag line numbers to comment</span>{fileContext ? <span className="revision head">{fileContext.revision} evidence</span> : <><button className={`view-toggle${diffMode === 'unified' ? ' active' : ''}`} title="Unified diff" aria-label="Unified diff" aria-pressed={diffMode === 'unified'} onClick={() => setDiffMode('unified')}><FileDiff size={14}/></button><button className={`view-toggle${diffMode === 'split' ? ' active' : ''}`} title="Split diff" aria-label="Split diff" aria-pressed={diffMode === 'split'} onClick={() => setDiffMode('split')}><Columns2 size={14}/></button><span className="revision">{session.pullRequest.baseRef}</span><ArrowRight size={13}/><span className="revision head">{session.pullRequest.headRef}</span></>}</div></div>{fileContext && evidenceFocus ? <FileContextView file={fileContext} focus={evidenceFocus} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(fileContext.path, range)); openTools('drafts')}}/> : diffError ? <ErrorBanner title="Diff unavailable" message={diffError}/> : !diff ? <div className="diff-loading"><Skeleton rows={9}/><span>Loading diff for {path}…</span></div> : diffMode === 'split' ? <SplitDiffView diff={diff} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(diff.file.path, range)); openTools('drafts')}}/> : <DiffView diff={diff} focus={evidenceFocus} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(diff.file.path, range)); openTools('drafts')}}/>}</section>}
      <aside ref={toolsPanelRef} id="review-tools-panel" className={`context-panel${toolsPanelOpen ? ' panel-open' : ''}`} role={toolsPanelOpen ? 'dialog' : undefined} aria-modal={toolsPanelOpen || undefined} aria-label={toolsPanelOpen ? 'Review tools' : undefined} onKeyDown={trapPanelFocus}><div className="context-tabs" role="tablist" aria-label="Review tools"><button id="review-tool-tab-context" role="tab" aria-controls="review-tool-panel-context" aria-selected={panelTab === 'context'} tabIndex={panelTab === 'context' ? 0 : -1} className={panelTab === 'context' ? 'active' : ''} onKeyDown={(event) => moveToolTab(event, 'context')} onClick={() => setPanelTab('context')}><PanelRight size={14}/>Evidence</button><button id="review-tool-tab-notes" role="tab" aria-controls="review-tool-panel-notes" aria-selected={panelTab === 'notes'} tabIndex={panelTab === 'notes' ? 0 : -1} className={panelTab === 'notes' ? 'active' : ''} onKeyDown={(event) => moveToolTab(event, 'notes')} onClick={() => setPanelTab('notes')}>Notes</button><button id="review-tool-tab-drafts" role="tab" aria-controls="review-tool-panel-drafts" aria-selected={panelTab === 'drafts'} tabIndex={panelTab === 'drafts' ? 0 : -1} className={panelTab === 'drafts' ? 'active' : ''} onKeyDown={(event) => moveToolTab(event, 'drafts')} onClick={() => setPanelTab('drafts')}>Drafts</button></div>
        {panelTab === 'context' && <div className="context-tab-panel" id="review-tool-panel-context" role="tabpanel" aria-labelledby="review-tool-tab-context">{chapter.symbols.length > 0 && <SymbolNavigator symbols={chapter.symbols} onEvidence={navigateEvidence}/>}<ChapterEvidenceIndex chapter={chapter} onEvidence={navigateEvidence}/></div>}
        {panelTab === 'notes' && <div className="context-tab-panel" id="review-tool-panel-notes" role="tabpanel" aria-labelledby="review-tool-tab-notes"><NotesPanel notes={session.notes.filter((n) => !n.chapterId || n.chapterId === chapter.id)} value={note} onChange={setNote} onSave={addNote} onEdit={(item) => {setEditingNoteId(item.id); setNote(item.body)}} onDelete={deleteNote} editing={Boolean(editingNoteId)} busy={busy}/></div>}
        {panelTab === 'drafts' && <div className="context-tab-panel" id="review-tool-panel-drafts" role="tabpanel" aria-labelledby="review-tool-tab-drafts"><DraftsPanel drafts={session.comments.filter((c) => c.status === 'draft')} published={session.comments.filter((c) => c.status === 'published')} selected={selectedDrafts} onSelected={setSelectedDrafts} value={draft} onChange={setDraft} onSave={addDraft} onPublish={preparePublish} onEdit={(item) => {setEditingDraftId(item.id); setDraft(item.body); setDraftTarget(item.path && item.line && item.side ? {path: item.path, startLine: item.startLine, startSide: item.startSide, line: item.line, side: item.side} : undefined)}} onDelete={deleteDraft} editing={Boolean(editingDraftId)} target={draftTarget} onClearTarget={() => setDraftTarget(undefined)} busy={busy}/></div>}
      </aside>
      {(chapterPanelOpen || toolsPanelOpen) && <button className="review-panel-backdrop" aria-label="Close review panels" onClick={() => {setChapterPanelOpen(false); setToolsPanelOpen(false)}}/>}
    </div><footer className="review-footer"><div className="chapter-progress-control"><span>Chapter progress</span><SelectControl className="chapter-progress-select" label="Chapter progress" help="Saved privately in ReviewArc; this does not update GitHub." value={status} disabled={busy} onChange={(value) => setStatus(value as ChapterStatus)} options={([
      ['notReviewed', 'Not reviewed', 'You have not started this chapter.'],
      ['inProgress', 'In progress', 'You are actively reviewing this chapter.'],
      ['reviewed', 'Reviewed', 'You have finished reviewing this chapter.'],
      ['needsClarification', 'Needs clarification', 'An unresolved question remains.'],
      ['blocked', 'Blocked', 'Missing context or access prevents completion.'],
    ] as const).map(([value, label, description]) => ({value, label, description}))}/></div><span className="chapter-progress-note">Saved privately</span><span className="shortcut-hint">[ previous · ] next · F focus · ⌘K open</span><div className="footer-spacer"/><button className="button secondary small" disabled={chapterIndex === 0} onClick={() => setChapterId(chapters[chapterIndex - 1].id)}><ArrowLeft size={14}/>Previous</button>{chapterIndex === chapters.length - 1 ? <button className="button primary small" onClick={() => setSummaryOpen(true)}>Review summary<ShieldCheck size={14}/></button> : <button className="button primary small" onClick={() => setChapterId(chapters[chapterIndex + 1].id)}>Next chapter<ArrowRight size={14}/></button>}</footer>
    {actionError && <div className="global-error"><ErrorBanner title="Review action failed" message={actionError} onRetry={() => setActionError('')} actionLabel="Dismiss"/></div>}
    {publish && <PublishConfirmation preview={publish} busy={busy} onCancel={() => setPublish(undefined)} onConfirm={confirmPublish}/>}
    {threadReply && <ThreadReplyConfirmation preview={threadReply} busy={busy} onCancel={() => setThreadReply(undefined)} onConfirm={confirmThreadReply}/>}
    {summaryOpen && (
      <ReviewSummary
        session={session}
        busy={busy}
        selectedDrafts={selectedDrafts.size}
        onClose={() => setSummaryOpen(false)}
        onDrafts={() => {
          setSummaryOpen(false)
          openTools('drafts')
        }}
        onDecision={prepareDecision}
      />
    )}
  </main>
}

type InlineEvidenceState = {scope: string; evidence: EvidenceReference; file?: FileContent; loading?: boolean; error?: string}

function ChapterReader({sessionId, chapter, chapterIndex, chapterCount, onOpenDiff, onEvidence, onDraft}: {sessionId: string; chapter: ReviewChapter; chapterIndex: number; chapterCount: number; onOpenDiff: (path?: string) => void; onEvidence: (evidence: EvidenceReference) => void; onDraft: (value: string) => void}) {
  const hasInterpretation = chapter.facts.length > 0 || chapter.inferences.length > 0
  const [preview, setPreview] = useState<InlineEvidenceState>()
  const previewRequest = useRef(0)
  useEffect(() => { previewRequest.current++; setPreview(undefined) }, [chapter.id])
  const toggleEvidence = async (scope: string, evidence: EvidenceReference) => {
    if (evidence.validationStatus !== 'valid') return
    if (preview?.scope === scope && preview.evidence.id === evidence.id) { previewRequest.current++; setPreview(undefined); return }
    const request = ++previewRequest.current
    setPreview({scope, evidence, loading: true})
    try {
      const file = await backend.getFile(sessionId, evidence.path, evidence.revision)
      if (request === previewRequest.current) setPreview({scope, evidence, file})
    } catch (err) {
      if (request === previewRequest.current) setPreview({scope, evidence, error: errorText(err)})
    }
  }
  const inlineEvidence = (scope: string, evidence: EvidenceReference[]) => <InlineEvidenceList scope={scope} evidence={evidence} preview={preview} onToggle={toggleEvidence} onOpenContext={onEvidence} onOpenDiff={onOpenDiff}/>
  return <div className="chapter-reader" role="region" aria-label={`Chapter ${chapter.order}: ${chapter.title}`}>
    <article className="chapter-reader-page">
      <header className="reader-hero"><div className="reader-position"><BookOpen size={15}/><span>Chapter {chapterIndex + 1} of {chapterCount}</span></div><h1>{chapter.title}</h1><p className="reader-deck">{chapter.purpose}</p><details className="reader-intro-details"><summary>Chapter context</summary><p>{chapter.description}</p></details></header>

      {(chapter.risks.length > 0 || chapter.unknowns.length > 0) && <section className="reader-section critical-section"><div className="reader-section-heading"><h2>Review closely</h2><span>{chapter.risks.length} risk{chapter.risks.length === 1 ? '' : 's'} · {chapter.unknowns.length} open question{chapter.unknowns.length === 1 ? '' : 's'}</span></div>{chapter.risks.map((risk) => <article className="reader-critical" key={risk.id}><div><RiskBadge level={risk.level}/><h3>{risk.title}</h3></div><p>{risk.description}</p>{inlineEvidence(`risk-${risk.id}`, risk.evidence)}</article>)}{chapter.unknowns.map((claim) => <article className="reader-unknown" key={claim.id}><div><CircleHelp size={17}/><span>Open question</span></div><p>{claim.text}</p>{inlineEvidence(`unknown-${claim.id}`, claim.evidence)}</article>)}</section>}

      {chapter.behavioralChanges.length > 0 && <section className="reader-section behavior-section"><div className="reader-section-heading"><h2>Behavioral change</h2><span>{chapter.behavioralChanges.length} change{chapter.behavioralChanges.length === 1 ? '' : 's'}</span></div>{chapter.behavioralChanges.map((change) => <article className="reader-behavior" key={change.id}><h3>{change.summary}</h3><div className="reader-transition"><div><span>Before</span><p>{change.before}</p></div><ArrowRight size={18}/><div><span>After</span><p>{change.after}</p></div></div>{inlineEvidence(`change-${change.id}`, change.evidence)}</article>)}</section>}

      {chapter.relatedTests.length > 0 && <section className="reader-section test-section"><div className="reader-section-heading"><h2>Test posture</h2><span>{chapter.relatedTests.length} related test{chapter.relatedTests.length === 1 ? '' : 's'}</span></div><div className="reader-test-list">{chapter.relatedTests.map((test) => <article key={test.id}><div><FileCode2 size={16}/><div><strong>{test.path}</strong><p>{test.description}</p></div><span className={`validation ${test.relationship}`}>{test.relationship}</span></div>{inlineEvidence(`test-${test.id}`, test.evidence)}</article>)}</div></section>}

      {hasInterpretation && <details className="reader-disclosure"><summary><span><ShieldCheck size={16}/>Evidence and interpretation</span><small>{chapter.facts.length} facts · {chapter.inferences.length} inferences</small></summary><div>{chapter.facts.length > 0 && <section><h3>What the evidence establishes</h3>{chapter.facts.map((claim) => <article className="reader-claim" key={claim.id}><p>{claim.text}</p>{inlineEvidence(`fact-${claim.id}`, claim.evidence)}</article>)}</section>}{chapter.inferences.length > 0 && <section><h3>What ReviewArc infers</h3>{chapter.inferences.map((claim) => <article className="reader-claim inference" key={claim.id}><p>{claim.text}</p>{inlineEvidence(`inference-${claim.id}`, claim.evidence)}</article>)}</section>}</div></details>}

      {chapter.suggestedQuestions.length > 0 && <section className="reader-section author-questions"><div className="reader-section-heading"><h2>Questions for the author</h2><span>{chapter.suggestedQuestions.length} prompt{chapter.suggestedQuestions.length === 1 ? '' : 's'}</span></div>{chapter.suggestedQuestions.map((question) => <article key={question.id}><div><p>{question.text}</p>{question.rationale && <small>{question.rationale}</small>}</div><button className="button secondary small" onClick={() => onDraft(question.text)}><Plus size={13}/>Add to drafts</button>{inlineEvidence(`question-${question.id}`, question.evidence)}</article>)}</section>}
    </article>
  </div>
}

function InlineEvidenceList({scope, evidence, preview, onToggle, onOpenContext, onOpenDiff}: {scope: string; evidence: EvidenceReference[]; preview?: InlineEvidenceState; onToggle: (scope: string, evidence: EvidenceReference) => void; onOpenContext: (evidence: EvidenceReference) => void; onOpenDiff: (path?: string) => void}) {
  return <div className="inline-evidence-list">{evidence.map((item) => {
    const active = preview?.scope === scope && preview.evidence.id === item.id
    const lineLabel = `L${item.startLine}${item.endLine !== item.startLine ? `–${item.endLine}` : ''}`
    return <div className={`inline-evidence${active ? ' active' : ''}`} key={item.id}><button disabled={item.validationStatus !== 'valid'} aria-expanded={active} aria-label={`${active ? 'Hide' : 'Show'} code for ${item.path} ${lineLabel}`} onClick={() => onToggle(scope, item)}><Code2 size={13}/><span>{item.path}</span><em>{lineLabel}</em>{item.validationStatus !== 'valid' ? <><AlertTriangle size={11}/><small>Unverified</small></> : <ChevronRight className="evidence-chevron" size={13}/>}</button>{active && <InlineEvidencePreview state={preview} onOpenContext={() => onOpenContext(item)} onOpenDiff={() => onOpenDiff(item.path)}/>}</div>
  })}</div>
}

function InlineEvidencePreview({state, onOpenContext, onOpenDiff}: {state: InlineEvidenceState; onOpenContext: () => void; onOpenDiff: () => void}) {
  const {evidence, file, loading, error} = state
  if (loading) return <div className="inline-evidence-body loading"><LoaderCircle className="spin" size={15}/><span>Loading surrounding code…</span></div>
  if (error) return <div className="inline-evidence-body error"><AlertTriangle size={15}/><span>{error}</span></div>
  if (!file) return null
  if (file.isBinary) return <div className="inline-evidence-body error"><FileCode2 size={15}/><span>This reference is in a binary file.</span></div>
  const lines = file.content.split(/\r?\n/)
  const first = Math.max(1, evidence.startLine - 3)
  const last = Math.min(lines.length, evidence.endLine + 3)
  return <div className="inline-evidence-body"><header><div><strong>{file.path}</strong><span>{file.revision} · {first}–{last}</span></div><div><button className="button text small" onClick={onOpenContext}>Full context</button><button className="button text small" onClick={onOpenDiff}>Open diff</button></div></header><Suspense fallback={<div className="inline-evidence-highlight-loading"><LoaderCircle className="spin" size={14}/>Highlighting code…</div>}><PierreCodeExcerpt file={file} firstLine={first} lastLine={last} focusStart={evidence.startLine} focusEnd={evidence.endLine}/></Suspense></div>
}

function ChapterEvidenceIndex({chapter, onEvidence}: {chapter: ReviewChapter; onEvidence: (evidence: EvidenceReference) => void}) {
  const evidence = [
    ...chapter.evidence,
    ...chapter.behavioralChanges.flatMap((item) => item.evidence),
    ...chapter.risks.flatMap((item) => item.evidence),
    ...chapter.facts.flatMap((item) => item.evidence),
    ...chapter.inferences.flatMap((item) => item.evidence),
    ...chapter.unknowns.flatMap((item) => item.evidence),
    ...chapter.relatedTests.flatMap((item) => item.evidence),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.path === item.path && candidate.revision === item.revision && candidate.startLine === item.startLine && candidate.endLine === item.endLine) === index)
  return <div className="context-scroll evidence-index"><header><div><h2>Evidence</h2><p>{evidence.length} unique reference{evidence.length === 1 ? '' : 's'} in this chapter</p></div></header>{evidence.length ? <EvidenceList evidence={evidence} onClick={onEvidence}/> : <div className="evidence-empty"><CircleHelp size={18}/><strong>No validated references</strong><p>This chapter needs stronger evidence before it can support a confident decision.</p></div>}</div>
}

export function FileContextView({file, focus, comments = [], onCommentRange, onReply, replyReset}: {file: FileContent; focus: EvidenceReference; comments?: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  if (file.isBinary) return <EmptyState icon={<FileCode2/>} title="Binary evidence"><p>This validated path is binary and has no displayable line context.</p></EmptyState>
  return <div className="diff-view pierre-diff file-context-view" role="region" aria-label={`${file.revision} file context for ${file.path}`}><Suspense fallback={<Skeleton rows={9}/>}><PierreFileRenderer file={file} focus={focus} comments={comments} onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/></Suspense></div>
}

export function DiffView({diff, focus, comments = [], onCommentRange, onReply, replyReset}: {diff: DiffFile; focus?: EvidenceReference; comments?: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  return <PierreDiffView diff={diff} focus={focus} comments={comments} layout="unified" onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/>
}

export function SplitDiffView({diff, comments = [], onCommentRange, onReply, replyReset}: {diff: DiffFile; comments?: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  return <PierreDiffView diff={diff} comments={comments} layout="split" onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/>
}

function PierreDiffView({diff, focus, comments, layout, onCommentRange, onReply, replyReset}: {diff: DiffFile; focus?: EvidenceReference; comments: PullRequestReviewComment[]; layout: 'unified' | 'split'; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  if (diff.file.isBinary) return <EmptyState icon={<FileCode2/>} title="Binary file"><p>ReviewArc cannot render a textual diff for this file.</p></EmptyState>
  if (!diff.hunks?.length || !diff.patch) return <EmptyState icon={<FileDiff/>} title="No textual changes"><p>The file metadata changed without a displayable text hunk.</p></EmptyState>
  return <div className="diff-view pierre-diff" role="region" aria-label={`${layout === 'split' ? 'Split diff' : 'Diff'} for ${diff.file.path}`}><Suspense fallback={<Skeleton rows={9}/>}><PierreDiffRenderer diff={diff} focus={focus} comments={comments} layout={layout} onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/></Suspense></div>
}

function draftTargetFor(path: string, range: CommentRange): DraftTarget {
  const multiLine = range.startLine !== range.endLine || range.startSide !== range.endSide
  return {path, startLine: multiLine ? range.startLine : undefined, startSide: multiLine ? range.startSide : undefined, line: range.endLine, side: range.endSide}
}

function commentLocation(comment: {path?: string; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; line?: number; side?: 'LEFT' | 'RIGHT'}) {
  if (!comment.path) return 'General review comment'
  if (!comment.line) return comment.path
  if (comment.startLine && comment.startSide && comment.side && comment.startSide !== comment.side) return `${comment.path}:${comment.startLine} ${comment.startSide}–${comment.line} ${comment.side}`
  return `${comment.path}:${comment.startLine && comment.startLine !== comment.line ? `${comment.startLine}–${comment.line}` : comment.line}`
}

function SymbolNavigator({symbols, onEvidence}: {symbols: ReviewChapter['symbols']; onEvidence: (evidence: EvidenceReference) => void}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? symbols : symbols.slice(0, 6)
  return <div className="symbol-nav"><div><span>Changed symbols</span><small>{symbols.length}</small></div><div className="symbol-nav-list">{visible.map((symbol) => <button title={`${symbol.name} · ${symbol.path}`} key={`${symbol.path}:${symbol.name}`} onClick={() => symbol.evidence[0] && onEvidence(symbol.evidence[0])}><Code2 size={12}/><span>{symbol.name}</span></button>)}{symbols.length > 6 && <button className="symbol-nav-more" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer' : `Show ${symbols.length - 6} more`}</button>}</div></div>
}

function EvidenceList({evidence, onClick}: {evidence: EvidenceReference[]; onClick: (evidence: EvidenceReference) => void}) { return <div className="evidence-list">{evidence.map((item) => <button disabled={item.validationStatus !== 'valid'} title={item.validationMessage} onClick={() => onClick(item)} key={item.id}><Code2 size={12}/><span>{item.path}</span><em>L{item.startLine}{item.endLine !== item.startLine ? `–${item.endLine}` : ''}</em>{item.validationStatus !== 'valid' && <AlertTriangle size={11}/>}</button>)}</div> }

function NotesPanel({notes, value, onChange, onSave, onEdit, onDelete, editing, busy}: {notes: ReviewSession['notes']; value: string; onChange: (value: string) => void; onSave: () => void; onEdit: (note: ReviewSession['notes'][number]) => void; onDelete: (id: string) => void; editing: boolean; busy: boolean}) { return <div className="composer-panel"><div className="composer-intro"><h2>Private notes</h2><p>Stored only in ReviewArc. Notes are never sent to GitHub.</p></div><textarea autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Capture a concern, decision, or follow-up…"/><button className="button primary small" disabled={busy || !value.trim()} onClick={onSave}>{editing ? 'Update' : 'Save'} note</button><div className="saved-items">{notes.map((note) => <article key={note.id}><p>{note.body}</p><footer><small>{relativeTime(note.updatedAt)}</small><button aria-label="Edit note" onClick={() => onEdit(note)}><Pencil size={13}/></button><button aria-label="Delete note" onClick={() => onDelete(note.id)}><Trash2 size={13}/></button></footer></article>)}</div></div> }

function DraftsPanel({drafts, published, selected, onSelected, value, onChange, onSave, onPublish, onEdit, onDelete, editing, target, onClearTarget, busy}: {drafts: ReviewComment[]; published: ReviewComment[]; selected: Set<string>; onSelected: (value: Set<string>) => void; value: string; onChange: (value: string) => void; onSave: () => void; onPublish: () => void; onEdit: (draft: ReviewComment) => void; onDelete: (id: string) => void; editing: boolean; target?: DraftTarget; onClearTarget: () => void; busy: boolean}) {
  const toggle = (id: string) => { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); onSelected(next) }
  return <div className="composer-panel"><div className="composer-intro"><h2>Review drafts</h2><p>Drag across line numbers to comment on a range. Publishing always requires confirmation.</p></div>{target && <div className="draft-target"><Code2 size={12}/><span>{commentLocation(target)}</span><button aria-label="Make this a general comment" onClick={onClearTarget}><X size={12}/></button></div>}<textarea autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder={target ? `Comment on ${commentLocation(target)}…` : 'Write a clear, actionable review comment…'}/><button className="button primary small" disabled={busy || !value.trim()} onClick={onSave}>{editing ? 'Update' : 'Save'} {target ? 'inline ' : ''}draft</button><div className="saved-items drafts">{drafts.map((draft) => <label key={draft.id}><input type="checkbox" checked={selected.has(draft.id)} onChange={() => toggle(draft.id)}/><article><p>{draft.body}</p><footer><small>{commentLocation(draft)}</small><button aria-label="Edit draft" onClick={() => onEdit(draft)}><Pencil size={13}/></button><button aria-label="Delete draft" onClick={() => onDelete(draft.id)}><Trash2 size={13}/></button></footer></article></label>)}</div>{drafts.length > 0 && <button className="button danger wide" disabled={busy || !selected.size} onClick={onPublish}>Preview {selected.size} comment{selected.size === 1 ? '' : 's'}</button>}{published.length > 0 && <section className="publication-history"><h3>Published from ReviewArc</h3>{published.map((comment) => <button type="button" key={comment.id} disabled={!comment.githubUrl} onClick={() => comment.githubUrl && backend.openGitHubURL(comment.githubUrl)}><Check size={13}/><span>{comment.body}</span><ExternalLink size={12}/></button>)}</section>}</div>
}

function ReviewSummary({session, busy, selectedDrafts, onClose, onDrafts, onDecision}: {session: ReviewSession; busy: boolean; selectedDrafts: number; onClose: () => void; onDrafts: () => void; onDecision: (event: 'APPROVE' | 'REQUEST_CHANGES') => void}) {
  useDialogFocus(onClose)
  const states = session.chapters.map((item) => ({...item, chapter: session.analysis?.chapters.find((chapter) => chapter.id === item.chapterId)}))
  const unresolved = states.filter((item) => item.status !== 'reviewed')
  const drafts = session.comments.filter((comment) => comment.status === 'draft')
  const ready = unresolved.length === 0 && !session.isStale
  return <div className="modal-backdrop"><section className="review-summary-modal" role="dialog" aria-modal="true" aria-labelledby="review-summary-title"><header><div><ShieldCheck size={20}/><div><h2 id="review-summary-title">Review summary</h2><p>{ready ? 'All chapters are reviewed. Choose the review event to send to GitHub.' : 'Resolve the items below before making a final decision.'}</p></div></div><button className="icon-button" aria-label="Close review summary" onClick={onClose}><X size={18}/></button></header><div className="summary-status"><div><strong>{session.progress.reviewed}/{session.progress.total}</strong><span>chapters reviewed</span></div><div><strong>{unresolved.length}</strong><span>unresolved</span></div><div><strong>{drafts.length}</strong><span>local drafts</span></div></div>{session.isStale && <div className="warning-banner"><AlertTriangle size={16}/>Analysis is stale. Reanalyze before deciding.</div>}<div className="summary-unresolved"><h3>Unresolved chapters</h3>{unresolved.length ? unresolved.map((item) => <div key={item.chapterId}><StatusDot status={item.status}/><span><strong>{item.chapter?.title ?? item.chapterId}</strong><small>{chapterStatusLabel(item.status)}</small></span></div>) : <p><Check size={16}/>No unresolved chapters.</p>}</div><footer><button className="button secondary" onClick={onDrafts}><MessageSquare size={15}/>Review {drafts.length} draft{drafts.length === 1 ? '' : 's'}</button><button className="button danger" disabled={busy || selectedDrafts === 0 || session.isStale} title={selectedDrafts === 0 ? 'Select at least one draft explaining the requested changes' : ''} onClick={() => onDecision('REQUEST_CHANGES')}>Request changes</button><button className="button primary" disabled={busy || !ready} onClick={() => onDecision('APPROVE')}><Check size={15}/>Approve</button></footer></section></div>
}

function PublishConfirmation({preview, busy, onCancel, onConfirm}: {preview: PublishPreview; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  const label = preview.event === 'APPROVE' ? 'Approve pull request' : preview.event === 'REQUEST_CHANGES' ? 'Request changes' : 'Publish comments'
  return <div className="modal-backdrop"><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title"><header><div><span><ExternalLink size={17}/></span><div><h2 id="publish-title">{label}?</h2><p>This review is externally visible on GitHub and requires your explicit confirmation.</p></div></div><button className="icon-button" aria-label="Close" onClick={onCancel}><X size={17}/></button></header><div className="publish-target"><GitPullRequest size={16}/><span>{preview.repository} #{preview.number}</span><strong>{preview.event.replace('_', ' ').toLowerCase()}</strong></div>{preview.items.length > 0 && <div className="publish-comments">{preview.items.map((comment) => <article key={comment.draftId}><p>{comment.body}</p><small>{commentLocation(comment)}</small></article>)}</div>}<footer><button className="button secondary" disabled={busy} onClick={onCancel}>Keep editing</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <ExternalLink size={15}/>}Confirm {label.toLowerCase()}</button></footer></section></div>
}

function ThreadReplyConfirmation({preview, busy, onCancel, onConfirm}: {preview: ThreadReplyPreview; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  return <div className="modal-backdrop"><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="thread-reply-title"><header><div><span><Reply size={17}/></span><div><h2 id="thread-reply-title">Publish thread reply?</h2><p>This reply will be externally visible on GitHub.</p></div></div><button className="icon-button" aria-label="Close" onClick={onCancel}><X size={17}/></button></header><div className="publish-target"><MessageSquare size={16}/><span>{preview.repository} #{preview.number}</span><strong>Reply to @{preview.rootAuthor}</strong></div><div className="publish-comments"><article><p>{preview.body}</p><small>{preview.path}</small></article></div><footer><button className="button secondary" disabled={busy} onClick={onCancel}>Keep editing</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <ExternalLink size={15}/>}Confirm reply</button></footer></section></div>
}

function CommandPalette({items, onClose, onOpen}: {items: PullRequestSummary[]; onClose: () => void; onOpen: (pr: PullRequestSummary) => void}) {
  const [query, setQuery] = useState('')
  const results = items.filter((item) => `${repoName(item)} ${item.ref.number} ${item.title}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
  useDialogFocus(onClose)
  return <div className="modal-backdrop command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="quick-open-title"><header><Command size={17}/><label><span id="quick-open-title" className="sr-only">Quick open a pull request</span><input id="quick-open-input" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quick open a pull request…"/></label><kbd>esc</kbd></header><div className="command-results">{results.map((item) => <button key={`${repoName(item)}#${item.ref.number}`} onClick={() => onOpen(item)}><GitPullRequest size={15}/><span><strong>#{item.ref.number} {item.title}</strong><small>{repoName(item)}</small></span><ChevronRight size={15}/></button>)}{!results.length && <p>No matching pull requests.</p>}</div></section></div>
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
  return <section className="software-update-settings"><div className="settings-section-heading"><h2>Software updates</h2><p>Choose which signed releases ReviewArc should offer.</p><code>v{update.currentVersion} · build {update.currentBuild}</code></div><div className="settings-section-body"><div className="update-channel-control"><div><strong>Release channel</strong><small>{update.channel === 'beta' ? 'Beta includes early builds and all newer GA releases.' : 'Stable receives generally available releases only.'}</small></div><div role="group" aria-label="Release channel"><button type="button" aria-pressed={update.channel === 'stable'} disabled={busy || unavailable} onClick={() => onSetChannel('stable')}>Stable</button><button type="button" aria-pressed={update.channel === 'beta'} disabled={busy || unavailable} onClick={() => onSetChannel('beta')}>Beta</button></div></div>{update.channel === 'beta' && <p className="beta-channel-note"><AlertTriangle size={14}/>Beta builds may be less stable. Returning to Stable does not downgrade the installed app.</p>}<div className={`update-status-row state-${update.state}${showSuccess ? ' success' : ''}`} role="status"><span>{update.state === 'checking' || update.state === 'downloading' || update.state === 'installing' ? <LoaderCircle className="spin" size={15}/> : update.state === 'failed' ? <AlertTriangle size={15}/> : installable || showSuccess ? <Check size={15}/> : <RefreshCw size={15}/>}</span><div><strong>{copy.headline}</strong>{copy.detail && <small>{copy.detail}</small>}{progress != null && <div className="update-download-progress" aria-label={`Download ${progress}% complete`}><i style={{width: `${progress}%`}}/></div>}</div><div className="update-actions">{update.release?.releaseNotesUrl && <button className="button text small" onClick={() => backend.openReleaseNotesURL(update.release!.releaseNotesUrl!)}>Release notes<ExternalLink size={12}/></button>}{installable ? <button className="button primary small" disabled={busy} onClick={onInstall}>{update.state === 'ready' ? 'Install and restart…' : 'Install update…'}</button> : <button className="button secondary small" disabled={busy || unavailable} onClick={onCheck}>{busy || update.state === 'checking' ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {update.state === 'failed' ? 'Try again' : 'Check now'}</button>}</div></div></div></section>
}

function UpdateInstallConfirmation({update, busy, onCancel, onConfirm}: {update: SoftwareUpdateStatus; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  const ready = update.state === 'ready'
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="update-install-title"><header><div><span><Download size={17}/></span><div><h2 id="update-install-title">Install ReviewArc {update.release?.version}?</h2><p>{ready ? 'The update is downloaded and ready.' : 'ReviewArc will download the signed update.'}</p></div></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onCancel}><X size={17}/></button></header><div className="publish-comments"><article><p>ReviewArc will close and reopen to finish the update. macOS may ask for an administrator username and password to replace the app in Applications.</p></article></div><footer><button className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <Download size={15}/>} {ready ? 'Install and restart' : 'Install update'}</button></footer></section></div>
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
      <section><div className="settings-section-heading"><h2>Local data</h2><p>Application-owned storage used for repository analysis and saved review state.</p></div><div className="settings-section-body"><dl className="path-list"><div><dt>Application data</dt><dd>{state.paths.root}</dd></div><div><dt>Repository caches</dt><dd>{state.paths.repositories}</dd></div><div><dt>Analysis worktrees</dt><dd>{state.paths.worktrees}</dd></div><div><dt>Database</dt><dd>{state.paths.database}</dd></div><div><dt>Logs</dt><dd>{state.paths.logs}</dd></div><div><dt>Temporary cache</dt><dd>{state.paths.cache}</dd></div></dl><p className="safety-copy"><CircleHelp size={16}/><span>PR analysis uses the repository cache and isolated worktree listed above. ReviewArc invokes your installed <code>git</code>, <code>gh</code>, and selected AI harness, which may read their own configuration and credentials.</span></p></div></section>
    </div>
  </main>
}
