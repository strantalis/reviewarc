import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Code2, Download,
  Columns2, Command, ExternalLink, FileCode2, FileDiff, Filter, GitPullRequest, Inbox, ListFilter, LoaderCircle,
  Maximize2, MessageSquare, Minimize2, PanelRight, Pencil, Plus, RefreshCw, Reply, Search, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, X,
} from 'lucide-react'
import { backend, BridgeUnavailableError } from './bridge'
import { AnalysisBadge, DependencyPills, EmptyState, ErrorBanner, Logo, Markdown, RiskBadge, SelectControl, Skeleton, StatusDot, WindowControls } from './components'
import { WindowToggleMaximise } from '../wailsjs/runtime/runtime'
import { analysisLabel, chapterStatusLabel, filterInbox, normalizeProgress, primaryRelationship, relationshipLabel, relativeTime, repoName } from './lib'
import type {
  AnalysisStatus, BootstrapState, ChangedFile, ChapterStatus, Claim, CommentRange, DependencyStatus, DiffFile, EvidenceReference, FileContent, Operation,
  OperationEvent, PublishPreview, PullRequestRef, PullRequestReviewComment, PullRequestSummary, Relationship, ReviewChapter,
  Repository, RepositoryPage, ReviewComment, ReviewSession, SoftwareUpdateStatus, SourceSelection, SourceState, UpdateChannel, Organization,
  ThreadReplyPreview,
} from './types'

type Screen = 'inbox' | 'sources' | 'settings' | 'overview' | 'review'
type DraftTarget = {path: string; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; line: number; side: 'LEFT' | 'RIGHT'}

const PierreDiffRenderer = lazy(() => import('./PierreRenderer').then((module) => ({default: module.PierreDiffRenderer})))
const PierreFileRenderer = lazy(() => import('./PierreRenderer').then((module) => ({default: module.PierreFileRenderer})))

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

export function App() {
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
  const openRequest = useRef(0)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [state, updateStatus] = await Promise.all([backend.bootstrap(), backend.getUpdateStatus()])
      const gh = state.dependencies.find((dep) => dep.name === 'gh')
      if (gh?.state === 'available') {
        const account = await backend.refreshAccount()
        if (account.user) state.account = account.user
      }
      setBootstrap(state)
      setSoftwareUpdate(updateStatus)
      state.selections ??= []
      state.inbox ??= []
      if (state.account && !state.selections.some((s) => s.enabled)) setScreen('sources')
    } catch (err) { setError(errorText(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => backend.on('reviewarc:update:v1', (raw) => setSoftwareUpdate(raw as SoftwareUpdateStatus)), [])
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
	try { const value = await backend.openPullRequest(pr.ref); if (openRequest.current === request) { setSession(value); setOpeningPR(undefined) } }
	catch (err) { if (openRequest.current === request) { setOpeningPR(undefined); setScreen('inbox'); setError(errorText(err)) } }
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
  if (missingRequired.length || !bootstrap.account) return <DependencyGate state={bootstrap} onRefresh={load} refreshing={loading} error={error}/>

  return <div className="app-shell">
    <AppHeader state={bootstrap} screen={screen} onNavigate={(next) => { setScreen(next); if (next === 'inbox') { openRequest.current++; setSession(undefined); setOpeningPR(undefined) } }}/>
    {(softwareUpdate?.state === 'available' || softwareUpdate?.state === 'ready') && softwareUpdate.release && softwareUpdate.release.build !== dismissedUpdateBuild && <UpdateBanner update={softwareUpdate} busy={updateBusy} onLater={() => setDismissedUpdateBuild(softwareUpdate.release!.build)} onInstall={() => setInstallUpdateOpen(true)}/>}
    {error && <div className="global-error"><ErrorBanner message={error} onRetry={() => setError('')} actionLabel="Dismiss"/></div>}
    {screen === 'sources' && <SourceSelector state={bootstrap} onDone={async () => { const next = await backend.bootstrap(); setBootstrap({...next, account: bootstrap.account}); setScreen('inbox') }} />}
    {screen === 'settings' && <SettingsScreen state={bootstrap} update={softwareUpdate} updateBusy={updateBusy} onCheckUpdate={checkForUpdates} onSetUpdateChannel={setUpdateChannel} onInstallUpdate={() => setInstallUpdateOpen(true)} onSources={() => setScreen('sources')}/>}
    {screen === 'inbox' && <InboxScreen state={bootstrap} onUpdate={(inbox) => setBootstrap({...bootstrap, inbox})} onOpen={openPR}/>}
    {openingPR && screen === 'overview' && <OpeningPullRequest pr={openingPR} onBack={() => { openRequest.current++; setOpeningPR(undefined); setScreen('inbox') }}/>}
    {session && screen === 'overview' && (
      <OverviewScreen session={session} onBack={() => { setSession(undefined); setReviewChapterId(''); setScreen('inbox') }} onSession={setSession} onReview={(chapterId) => { setReviewChapterId(chapterId ?? ''); setScreen('review') }}/>
    )}
    {session && screen === 'review' && (
      <ReviewWorkspace session={session} initialChapterId={reviewChapterId} onSession={setSession} onBack={() => setScreen('overview')}/>
    )}
    {commandOpen && <CommandPalette items={bootstrap.inbox} onClose={() => setCommandOpen(false)} onOpen={(pr) => { setCommandOpen(false); void openPR(pr) }}/>}
    {installUpdateOpen && softwareUpdate?.release && <UpdateInstallConfirmation update={softwareUpdate} busy={updateBusy} onCancel={() => setInstallUpdateOpen(false)} onConfirm={() => { setInstallUpdateOpen(false); void installUpdate() }}/>}
  </div>
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
  return <main className="onboarding">
    <header onDoubleClick={toggleWindowOnHeaderDoubleClick}><WindowControls/><Logo/><DependencyPills dependencies={state.dependencies}/></header>
    <section className="onboarding-body">
      <div className="onboarding-intro"><span className="arc-line"/><h1>Your pull requests,<br/>ready to understand.</h1><p>ReviewArc uses the tools already trusted on your machine. It creates its own isolated Git caches and never touches your working repositories.</p></div>
      <div className="setup-panel">
        <h2>Connect your review workspace</h2>
        <p>Three local tools power the ReviewArc workflow.</p>
        <div className="setup-list">{state.dependencies.map((dep) => <div className="setup-row" key={dep.name}>
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

function AppHeader({state, screen, onNavigate}: {state: BootstrapState; screen: Screen; onNavigate: (screen: Screen) => void}) {
  return <header className="app-header" onDoubleClick={toggleWindowOnHeaderDoubleClick}>
    <WindowControls/>
    <button className="brand-button" onClick={() => onNavigate('inbox')}><Logo/></button>
    <nav aria-label="Primary"><button className={screen === 'inbox' ? 'active' : ''} onClick={() => onNavigate('inbox')}><Inbox size={16}/>Inbox</button><button className={screen === 'sources' ? 'active' : ''} onClick={() => onNavigate('sources')}><SlidersHorizontal size={16}/>Sources</button></nav>
    <div className="header-spacer"/><DependencyPills dependencies={state.dependencies}/>
    <button className={`icon-button ${screen === 'settings' ? 'active' : ''}`} aria-label="Settings" onClick={() => onNavigate('settings')}><Settings size={18}/></button>
    <div className="account-chip">{state.account?.avatarUrl ? <img src={state.account.avatarUrl} alt=""/> : <span>{state.account?.login?.slice(0, 1).toUpperCase()}</span>}<div><strong>{state.account?.name || state.account?.login}</strong><small>@{state.account?.login}</small></div></div>
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
  const [ownerCounts, setOwnerCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [accessBusy, setAccessBusy] = useState(false)
  const [ownerBusy, setOwnerBusy] = useState(false)
  const [error, setError] = useState('')
  const ownerRequest = useRef(0)
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
    setOrganization(owner); setQuery(''); setOwnerBusy(true); setError(''); setOwnerPage(undefined)
    try {
      const cached = await backend.listCachedOwnerRepositories(owner)
      if (ownerRequest.current === request && cached.items.length) setOwnerPage(cached)
      const fresh = await backend.refreshOwnerRepositories(owner)
      if (ownerRequest.current === request) {
        setOwnerPage(fresh)
        setOwnerCounts((counts) => ({...counts, [owner.toLowerCase()]: fresh.totalCount}))
      }
    } catch (err) { if (ownerRequest.current === request) setError(errorText(err)) } finally { if (ownerRequest.current === request) setOwnerBusy(false) }
  }
  const loadMore = async () => {
    if (!ownerPage?.hasNextPage || !ownerPage.endCursor || ownerBusy) return
    const request = ownerRequest.current
    setOwnerBusy(true); setError('')
    try {
      const next = await backend.refreshOwnerRepositories(organization, ownerPage.endCursor)
      if (ownerRequest.current === request) {
        const items = new Map(ownerPage.items.map((repo) => [`${repo.ref.owner}/${repo.ref.name}`.toLowerCase(), repo]))
        for (const repo of next.items) items.set(`${repo.ref.owner}/${repo.ref.name}`.toLowerCase(), repo)
        setOwnerPage({...next, items: [...items.values()]})
        setOwnerCounts((counts) => ({...counts, [organization.toLowerCase()]: next.totalCount}))
      }
    } catch (err) { if (ownerRequest.current === request) setError(errorText(err)) } finally { if (ownerRequest.current === request) setOwnerBusy(false) }
  }
  useEffect(() => {
    if (!query.trim() || organization === 'included' || !ownerPage?.hasNextPage || !ownerPage.endCursor || ownerBusy) return
    void loadMore()
  }, [query, organization, ownerPage?.hasNextPage, ownerPage?.endCursor, ownerBusy])
  const save = async () => {
    setBusy(true); setError('')
    const selections: SourceSelection[] = [...selected].map((entry) => { const [kind, ...parts] = entry.split(':'); return {kind: kind as SourceSelection['kind'], key: parts.join(':'), enabled: true} })
    try { await backend.saveSelections(selections); await onDone() } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  const repositories = organization === 'included' ? catalog?.repositories ?? [] : ownerPage?.items ?? []
  const personalLogin = state.account?.login ?? ''
  const personalCount = ownerCounts[personalLogin.toLowerCase()]
  const personalSelected = personalLogin !== '' && organization.toLowerCase() === personalLogin.toLowerCase()
  const selectedOrganization = catalog?.organizations.find((org) => org.login.toLowerCase() === organization.toLowerCase())
  useEffect(() => {
    if (selectedOrganization?.accessStatus === 'ssoRequired' || selectedOrganization?.accessStatus === 'denied') {
      ownerRequest.current++
      setOwnerPage({items: [], totalCount: 0, hasNextPage: false, cached: false})
      setOwnerBusy(false)
    }
  }, [selectedOrganization?.accessStatus, organization])
  const repos = repositories.filter((repo) => {
    if (repo.isArchived) return false
    return `${repo.ref.owner}/${repo.ref.name} ${repo.description}`.toLowerCase().includes(query.toLowerCase())
  })
  const selectedOrganizations = [...selected].filter((key) => key.startsWith('organization:')).map((key) => key.slice('organization:'.length)).sort()
  const selectedRepositoryKeys = [...selected].filter((key) => key.startsWith('repository:')).map((key) => key.slice('repository:'.length)).sort()
  return <main className="page source-page"><div className="page-heading"><div><h1>Repository sources</h1><p>Choose where ReviewArc should look for open pull requests. Repositories are only fetched when you open a PR.</p></div><button className="button primary" disabled={busy || selected.size === 0} onClick={save}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Save sources</button></div>
    {error && <ErrorBanner message={error}/>}<div className="source-toolbar"><label className="search-field"><Search size={16}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={organization === 'included' ? 'Search included repositories' : 'Search all repositories'}/></label><button className="button secondary small" disabled={accessBusy} onClick={() => void refreshAccess()}>{accessBusy ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}Refresh access</button><span>{selected.size} {selected.size === 1 ? 'source' : 'sources'} included</span></div>
    <div className="source-layout"><aside><div className="source-section-heading"><h2>Repository owners</h2><button className={organization === 'included' ? 'active' : ''} aria-pressed={organization === 'included'} onClick={() => { ownerRequest.current++; setOrganization('included'); setOwnerPage(undefined); setQuery('') }}>Included</button></div><div className="organization-choices">{personalLogin && <><p className="source-group-label">Personal account</p><div className={`source-org-row personal${personalSelected ? ' active' : ''}`}><button className="org-focus" aria-label={`Show personal repositories from ${personalLogin}`} aria-pressed={personalSelected} onClick={() => void loadOwner(personalLogin)}>{state.account?.avatarUrl ? <img src={state.account.avatarUrl} alt=""/> : <span className="org-avatar">{personalLogin.slice(0, 1).toUpperCase()}</span>}<span><b>{personalLogin}</b><small>{personalCount === undefined ? 'Open to load repositories' : `${personalCount} personal ${personalCount === 1 ? 'repository' : 'repositories'}`}</small></span></button></div></>}<p className="source-group-label">Organizations</p>{catalog?.organizations.map((org) => { const key = `organization:${org.login}`; const blocked = org.accessStatus === 'ssoRequired' || org.accessStatus === 'denied'; return <OrganizationSourceRow key={key} org={org} count={ownerCounts[org.login.toLowerCase()]} active={organization.toLowerCase() === org.login.toLowerCase()} checked={selected.has(key)} onFilter={() => blocked ? (setOrganization(org.login), setOwnerPage({items: [], totalCount: 0, hasNextPage: false, cached: false})) : void loadOwner(org.login)} onToggle={() => toggle(key)}/>})}{!catalog && <div className="owner-loading"><LoaderCircle className="spin" size={13}/>Loading owners…</div>}</div></aside><section><div className="source-section-heading"><h2>{organization === 'included' ? 'Included sources' : personalSelected ? 'Personal repositories' : `${organization} repositories`}</h2><span>{organization === 'included' ? selected.size : ownerPage?.totalCount ?? '—'}</span></div><div className="repository-choices">{organization === 'included' && selectedOrganizations.map((owner) => <div className="source-rule" key={`included:${owner}`}><span className="check-box"><Check size={13}/></span><span><strong>{owner}</strong><small>Every active repository in this organization</small></span></div>)}{repos.map((repo) => { const name = `${repo.ref.owner}/${repo.ref.name}`; const key = `repository:${name}`; const inherited = selected.has(`organization:${repo.ref.owner}`); return <label className={`repo-choice${inherited ? ' inherited' : ''}`} key={key}><input type="checkbox" checked={inherited || selected.has(key)} disabled={inherited} onChange={() => toggle(key)}/><span className="check-box"><Check size={13}/></span><span><strong>{name}</strong><small>{inherited ? `Included through ${repo.ref.owner}` : repo.description || (repo.isPrivate ? 'Private repository' : 'GitHub repository')}</small></span>{repo.isPrivate && <span className="privacy">Private</span>}</label>})}{organization === 'included' && selectedRepositoryKeys.filter((name) => !repos.some((repo) => `${repo.ref.owner}/${repo.ref.name}`.toLowerCase() === name.toLowerCase())).map((name) => <div className="source-rule" key={`included:${name}`}><span className="check-box"><Check size={13}/></span><span><strong>{name}</strong><small>Repository</small></span></div>)}{ownerBusy && !repos.length && <div className="owner-page-loading"><LoaderCircle className="spin" size={17}/><p>Loading the first 50 active repositories…</p></div>}{!ownerBusy && !repos.length && organization !== 'included' && <div className="source-empty">{selectedOrganization?.accessStatus === 'ssoRequired' ? <ShieldCheck size={18}/> : <Search size={18}/>}<p>{selectedOrganization?.accessStatus === 'ssoRequired' ? `Authorize SSO for ${selectedOrganization.login}, then refresh access to load its repositories.` : selectedOrganization?.accessStatus === 'denied' ? `GitHub denied access to ${selectedOrganization.login}.` : 'No active repositories match this owner and search.'}</p></div>}{organization === 'included' && !selected.size && <div className="source-empty"><Search size={18}/><p>Select a repository or include an organization to build your review inbox.</p></div>}</div>{ownerPage?.hasNextPage && <div className="source-pagination"><span>{query.trim() ? `Searching all ${ownerPage.totalCount} repositories…` : `Showing ${ownerPage.items.length} of ${ownerPage.totalCount}`}</span>{!query.trim() && <button className="button secondary small" disabled={ownerBusy} onClick={() => void loadMore()}>{ownerBusy ? <LoaderCircle className="spin" size={14}/> : null}Load 50 more</button>}</div>}</section></div>
  </main>
}

function InboxScreen({state, onUpdate, onOpen}: {state: BootstrapState; onUpdate: (items: PullRequestSummary[]) => void; onOpen: (pr: PullRequestSummary) => void}) {
  const saved = useMemo(savedInboxFilters, [])
  const [query, setQuery] = useState(''); const [relationship, setRelationship] = useState<Relationship | 'all'>(saved.relationship ?? 'all'); const [organization, setOrganization] = useState('all'); const [repository, setRepository] = useState('all'); const [label, setLabel] = useState(saved.label ?? 'all'); const [analysis, setAnalysis] = useState<AnalysisStatus | 'all'>(saved.analysis ?? 'all'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [partial, setPartial] = useState<string[]>([])
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
    setLabel(current ?? 'all')
  }, [label, labels])
  const items = useMemo(() => filterInbox(state.inbox, query, relationship, repository, label, analysis).filter((pr) => organization === 'all' || pr.ref.repository.owner === organization), [state.inbox, query, relationship, organization, repository, label, analysis])
  return <main className="page inbox-page"><div className="page-heading"><div><h1>Pull request inbox</h1><p>Open work across {repositories.length || 'your selected'} repositories, ordered by recent activity.</p></div><button className="button secondary" disabled={busy} onClick={refresh}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}Refresh</button></div>
    {error && <ErrorBanner message={error} onRetry={refresh}/>} {partial.length > 0 && <div className="warning-banner"><AlertTriangle size={16}/><span>Some repositories could not be refreshed. Showing the available results.</span></div>}
    <div className="inbox-controls"><label className="search-field inbox-search"><Search size={17}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, repository, author, PR number, or label"/></label><Select label="Relationship" value={relationship} onChange={(value) => setRelationship(value as typeof relationship)} options={[['all','All relationships'],['reviewRequested','Needs your review'],['assigned','Assigned'],['authored','Authored by you'],['selectedRepo','All selected']]}/><Select label="Organization" value={organization} onChange={setOrganization} options={[['all','All organizations'], ...organizations.map((org) => [org,org])]}/><Select label="Repository" value={repository} onChange={setRepository} options={[['all','All repositories'], ...repositories.map((r) => [r,r])]}/><Select label="Label" value={label} onChange={setLabel} options={[['all','All labels'], ...labels.map((item) => [item,item])]}/><Select label="Analysis" value={analysis} onChange={(value) => setAnalysis(value as typeof analysis)} options={[['all','All analysis states'],['ready','Walkthrough ready'],['notStarted','Not analyzed'],['running','Analyzing'],['stale','Stale'],['failed','Failed']]}/></div>
    <div className="saved-views" aria-label="Saved inbox views"><span>Views</span><button className={relationship === 'reviewRequested' ? 'active' : ''} onClick={() => setRelationship('reviewRequested')}>Needs my review</button><button className={relationship === 'authored' ? 'active' : ''} onClick={() => setRelationship('authored')}>Authored by me</button><button className={analysis === 'ready' ? 'active' : ''} onClick={() => setAnalysis('ready')}>Walkthrough ready</button><button onClick={() => {setRelationship('all'); setAnalysis('all')}}>All open</button></div><div className="inbox-summary"><div><ListFilter size={15}/><strong>{items.length}</strong> open pull request{items.length === 1 ? '' : 's'}</div><span>Sorted by last updated</span></div>
    {busy && !state.inbox.length ? <Skeleton rows={7}/> : !items.length ? <EmptyState icon={<GitPullRequest/>} title={state.inbox.length ? 'No pull requests match these filters' : 'Your review queue is clear'}><p>{state.inbox.length ? 'Broaden the search or reset one of the filters.' : 'ReviewArc found no open pull requests in the selected sources. Refresh after new work is opened.'}</p>{state.inbox.length > 0 && <button className="button secondary" onClick={() => {setQuery(''); setRelationship('all'); setOrganization('all'); setRepository('all'); setLabel('all'); setAnalysis('all')}}>Reset filters</button>}</EmptyState> : <div className="pr-list" aria-label="Pull request results">{items.map((pr) => <PRRow key={`${repoName(pr)}#${pr.ref.number}`} pr={pr} onOpen={() => onOpen(pr)}/>)}</div>}
  </main>
}

function Select({label, value, onChange, options}: {label: string; value: string; onChange: (value: string) => void; options: string[][]}) { return <SelectControl label={label} value={value} onChange={onChange} icon={<Filter size={14}/>} options={options.map(([optionValue, optionLabel]) => ({value: optionValue, label: optionLabel}))}/> }

function PRRow({pr, onOpen}: {pr: PullRequestSummary; onOpen: () => void}) {
  const progress = normalizeProgress(pr.progress)
  const relationship = primaryRelationship(pr.relationships ?? [])
  return <button className="pr-row" onClick={onOpen}><div className="pr-relation"><span className={`relation-mark ${relationship}`}/><div><span>{relationshipLabel(relationship)}</span><strong>{repoName(pr)}</strong></div></div><div className="pr-main"><div className="pr-title"><span>#{pr.ref.number}</span><strong>{pr.title}</strong>{pr.isDraft && <span className="badge neutral">Draft</span>}</div><div className="pr-meta"><span>by @{pr.author.login}</span><span>updated {relativeTime(pr.updatedAt)}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span>{pr.labels.slice(0, 2).map((item) => <span className="pr-label" key={item}>{item}</span>)}{pr.labels.length > 2 && <span className="pr-label-more">+{pr.labels.length - 2}</span>}</div></div><div className="pr-state"><div><AnalysisBadge status={pr.analysisStatus}/>{pr.analysisStatus === 'ready' && <RiskBadge level={pr.riskLevel}/>}</div>{progress.total > 0 ? <div className="progress-inline"><span><i style={{width: `${progress.percent}%`}}/></span><small>{progress.reviewed}/{progress.total} reviewed</small></div> : <small>{analysisLabel(pr.analysisStatus)}</small>}</div><ChevronRight size={18}/></button>
}

export function OverviewScreen({session, onBack, onSession, onReview}: {session: ReviewSession; onBack: () => void; onSession: (session: ReviewSession) => void; onReview: (chapterId?: string) => void}) {
  const pr = session.pullRequest; const analysis = session.analysis; const [operation, setOperation] = useState<Operation>(); const [events, setEvents] = useState<OperationEvent[]>([]); const [error, setError] = useState('')
  useEffect(() => { const offOperation = backend.on('reviewarc:operation:v1', (raw) => { const op = raw as Operation; if (op.sessionId && op.sessionId !== session.id) return; setOperation(op); const completed = op.state === 'complete' || op.state === 'completed'; const failed = op.state === 'failed'; const cancelled = op.state === 'cancelled'; const terminal = completed || failed || cancelled; const event: OperationEvent = {stage: op.stage, message: op.message, status: completed ? 'complete' : failed || cancelled ? 'failed' : 'running'}; setEvents((current) => [...current.slice(-7), event]); if (failed) setError(op.message || 'Reanalysis failed. The previous walkthrough is still available.'); if (terminal) backend.getSession(session.id).then(onSession).catch(() => setError(`${completed ? 'Analysis completed' : cancelled ? 'Analysis was cancelled' : 'Analysis failed'}, but the restored walkthrough could not be loaded. Return to the inbox and reopen this pull request.`)) }); const offSession = backend.on('reviewarc:session:v1', (raw) => { const value = raw as {sessionId?: string}; if (value.sessionId === session.id) backend.getSession(session.id).then(onSession).catch(() => {}) }); return () => { offOperation(); offSession() } }, [session.id, onSession])
  const analyze = async () => { setError(''); setEvents([]); try { setOperation(await backend.startAnalysis(session.id)) } catch (err) { setError(errorText(err)) } }
  const running = session.analysisStatus === 'running' || Boolean(operation && !['complete', 'completed', 'failed', 'cancelled'].includes(operation.state))
  const cancel = async () => { if (!operation) return; try { await backend.cancelOperation(operation.id) } catch (err) { setError(errorText(err)) } }
  return <main className="detail-page"><div className="detail-top"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Inbox</button><div className="detail-actions">{analysis && <button className="button secondary" disabled={running} onClick={analyze}>{running ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {running ? 'Reanalyzing' : 'Reanalyze'}</button>}<button className="button primary" disabled={!analysis || running} onClick={() => onReview()}>Start guided review<ArrowRight size={16}/></button></div></div>
    {session.isStale && <div className="stale-banner"><AlertTriangle size={18}/><div><strong>Analysis is out of date</strong><p>{session.staleReason || 'The pull request head revision changed after this walkthrough was generated.'}</p></div><button className="button secondary small" disabled={running} onClick={analyze}>Run again</button></div>}
    <header className="pr-hero"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1>{pr.body ? <Markdown className="pr-description">{pr.body}</Markdown> : <p>No pull request description was provided.</p>}<div className="hero-meta"><span>@{pr.author.login}</span><span>{pr.baseRef} ← {pr.headRef}</span><span>{pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</span><span>{pr.changedFiles} files</span>{pr.requestedReviewers.length > 0 && <span>Review: {pr.requestedReviewers.map((reviewer) => `@${reviewer.login}`).join(', ')}</span>}{pr.reviewState && <span>{pr.reviewState.replaceAll('_', ' ').toLowerCase()}</span>}<span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="hero-status"><AnalysisBadge status={running ? 'running' : session.analysisStatus}/>{analysis && <RiskBadge level={analysis.risks[0]?.level ?? pr.riskLevel}/>}<small>Head {pr.headSha.slice(0, 8)}</small></div></header>
    {!analysis ? <AnalysisPanel status={running ? 'running' : session.analysisStatus} operation={operation} events={events} error={error} onStart={analyze} onCancel={cancel}/> : <>{(running || error) && <AnalysisPanel status={running ? 'running' : session.analysisStatus} operation={operation} events={events} error={error} onStart={analyze} onCancel={cancel}/>} {analysis.summaryValidation !== 'valid' && <div className="warning-banner"><AlertTriangle size={16}/><span><strong>Summary is unverified.</strong> {analysis.summaryMessage || 'No valid code evidence supports this summary.'}</span></div>}<AnalysisOverview session={session} onReview={onReview}/></>}
  </main>
}

function AnalysisPanel({status, operation, events, error, onStart, onCancel}: {status: AnalysisStatus; operation?: Operation; events: OperationEvent[]; error: string; onStart: () => void; onCancel: () => void}) {
  const running = status === 'running' || Boolean(operation && operation.state !== 'complete' && operation.state !== 'completed' && operation.state !== 'failed' && operation.state !== 'cancelled')
  return <section className="analysis-launch" aria-live="polite" aria-busy={running}><div className="analysis-promise"><span><Sparkles size={24}/></span><h2>{running ? 'Building the review arc' : 'Turn this change into a guided review'}</h2><p>{running ? 'The previous walkthrough remains visible below while Codex reevaluates the complete current pull request.' : 'Codex reads the isolated managed repository in read-only mode. ReviewArc validates every referenced path and line range before it reaches the walkthrough.'}</p>{!running && <button className="button primary" onClick={onStart}><Sparkles size={16}/>Analyze pull request</button>}</div><div className="analysis-events"><div className="event-heading"><strong>{running ? 'Reanalysis progress' : 'Analysis progress'}</strong>{running && <button className="button text small" onClick={onCancel}>Cancel</button>}</div>{error && <ErrorBanner message={error} onRetry={onStart}/>} {!events.length ? <div className="event-placeholder"><CircleHelp size={17}/><p>{running ? 'Starting the managed snapshot and Codex analysis…' : 'Progress will appear here: cache preparation, revision fetch, Codex analysis, evidence validation, and persistence.'}</p></div> : events.map((event, index) => <div className="event-row" key={`${event.stage}-${index}`}><span className={event.status ?? 'running'}>{event.status === 'complete' ? <Check size={13}/> : event.status === 'failed' ? <X size={13}/> : <LoaderCircle className="spin" size={13}/>}</span><div><strong>{event.stage}</strong><small>{event.message}</small></div>{event.progress != null && <em>{Math.round(event.progress)}%</em>}</div>)}</div></section>
}

function AnalysisOverview({session, onReview}: {session: ReviewSession; onReview: (chapterId?: string) => void}) {
  const analysis = session.analysis!; const pr = session.pullRequest
  const checks = pr.checkRuns ?? []; const reviews = pr.reviews ?? []; const comments = pr.reviewComments ?? []
  return <div className="overview-grid"><section className="overview-main"><div className="summary-block"><h2>What changed</h2><p>{analysis.summary}</p><div className="area-list">{analysis.affectedAreas.map((area) => <span key={area.name}>{area.name}</span>)}</div></div><div className="overview-section"><div className="section-title"><h2>Review chapters</h2><span>{analysis.chapters.length} guided sections</span></div><div className="overview-chapters">{analysis.chapters.map((chapter) => <button key={chapter.id} onClick={() => onReview(chapter.id)}><span>{chapter.order}</span><div><strong>{chapter.title}</strong><small>{chapter.description}</small></div><StatusDot status={chapter.status}/><ChevronRight size={16}/></button>)}</div></div></section><aside className="overview-aside"><div className="stat-strip"><div><strong>{pr.changedFiles}</strong><span>files changed</span></div><div><strong className="additions">+{pr.additions}</strong><span>additions</span></div><div><strong className="deletions">−{pr.deletions}</strong><span>deletions</span></div></div>{checks.length > 0 && <ContextGroup title="Checks" icon={<Check size={16}/>} count={checks.length}>{checks.map((check) => <div className="check-row" key={check.id}><span className={`check-state ${check.conclusion || check.status}`}/><div><strong>{check.name}</strong><small>{check.conclusion || check.status}{check.appName ? ` · ${check.appName}` : ''}</small></div></div>)}</ContextGroup>}<ContextGroup title="Highest risks" icon={<AlertTriangle size={16}/>} count={analysis.risks.length}>{analysis.risks.slice(0, 4).map((risk) => <div className="risk-row" key={risk.id}><RiskBadge level={risk.level}/><strong>{risk.title}</strong><p>{risk.description}</p></div>)}</ContextGroup><ContextGroup title="Open unknowns" icon={<CircleHelp size={16}/>} count={analysis.unknowns.length}>{analysis.unknowns.slice(0, 4).map((claim) => <p className="context-copy" key={claim.id}>{claim.text}</p>)}</ContextGroup>{(reviews.length > 0 || comments.length > 0) && <ContextGroup title="Existing discussion" icon={<MessageSquare size={16}/>} count={reviews.length + comments.length}>{reviews.slice(-3).map((review) => <div className="discussion-row" key={`review-${review.id}`}><strong>@{review.author.login} · {review.state.toLowerCase()}</strong>{review.body && <p>{review.body}</p>}</div>)}{comments.slice(-3).map((comment) => <div className="discussion-row" key={`comment-${comment.id}`}><strong>@{comment.author.login} on {comment.path}{comment.line ? `:${comment.line}` : ''}</strong><p>{comment.body}</p></div>)}</ContextGroup>}{analysis.validationIssues.length > 0 && <ContextGroup title="Unverified analysis" icon={<ShieldCheck size={16}/>} count={analysis.validationIssues.length}>{analysis.validationIssues.slice(0, 3).map((issue) => <p className="context-copy" key={issue.code + issue.evidenceId}>{issue.message}</p>)}</ContextGroup>}</aside></div>
}

export function ReviewWorkspace({session, initialChapterId = '', onSession, onBack}: {session: ReviewSession; initialChapterId?: string; onSession: (session: ReviewSession) => void; onBack: () => void}) {
  const analysis = session.analysis!; const chapters = analysis?.chapters ?? []; const firstChapterId = chapters.some((chapter) => chapter.id === initialChapterId) ? initialChapterId : chapters[0]?.id ?? ''; const [chapterId, setChapterId] = useState(firstChapterId); const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0]; const [files, setFiles] = useState<ChangedFile[]>([]); const [path, setPath] = useState(chapter?.files[0]?.path ?? ''); const [diff, setDiff] = useState<DiffFile>(); const [diffError, setDiffError] = useState(''); const [panelTab, setPanelTab] = useState<'context'|'notes'|'drafts'>('context'); const [note, setNote] = useState(''); const [draft, setDraft] = useState(''); const [draftTarget, setDraftTarget] = useState<DraftTarget>(); const [busy, setBusy] = useState(false); const [publish, setPublish] = useState<PublishPreview>(); const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set(session.comments.filter((c) => c.status === 'draft').map((c) => c.id)))
  const [actionError, setActionError] = useState('')
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceReference>()
  const [fileContext, setFileContext] = useState<FileContent>()
  const [focusMode, setFocusMode] = useState(false)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [threadReply, setThreadReply] = useState<ThreadReplyPreview>()
  const [threadReplyReset, setThreadReplyReset] = useState<{rootId: number; version: number}>()
  const [editingNoteId, setEditingNoteId] = useState('')
  const [editingDraftId, setEditingDraftId] = useState('')
  const evidenceRequest = useRef(0)
  const diffRequest = useRef(0)
  useEffect(() => { backend.getChangedFiles(session.id).then((value) => { setFiles(value ?? []); if (!path && value?.[0]) setPath(value[0].path) }).catch((err) => setDiffError(errorText(err))) }, [session.id])
  useEffect(() => {
    const request = ++diffRequest.current
    if (!path) { setDiff(undefined); return }
    setDiff(undefined); setDiffError('')
    backend.getDiff(session.id, path)
      .then((value) => { if (request === diffRequest.current) setDiff(value) })
      .catch((err) => { if (request === diffRequest.current) setDiffError(errorText(err)) })
    return () => { if (request === diffRequest.current) diffRequest.current++ }
  }, [session.id, path])
  useEffect(() => { const suggested = chapter?.files[0]?.path; evidenceRequest.current++; setFileContext(undefined); setEvidenceFocus(undefined); if (suggested) setPath(suggested) }, [chapterId])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      const index = chapters.findIndex((item) => item.id === chapterId)
      if (event.key === ']') setChapterId(chapters[Math.min(chapters.length - 1, index + 1)]?.id ?? chapterId)
      if (event.key === '[') setChapterId(chapters[Math.max(0, index - 1)]?.id ?? chapterId)
      if (event.key.toLowerCase() === 'f') setFocusMode((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapterId, chapters])
  if (!analysis || !chapter) return <main className="detail-page"><ErrorBanner title="Walkthrough unavailable" message="This session does not contain validated review chapters." onRetry={onBack} actionLabel="Back to overview"/></main>
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
    try { onSession(await backend.openPullRequest(session.pullRequest.ref)) }
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
    try { onSession(await backend.openPullRequest(session.pullRequest.ref)) }
    catch (err) { setActionError(`Reply published on GitHub, but ReviewArc could not refresh the conversation: ${errorText(err)}`) }
    finally { setBusy(false) }
  }
  const navigateEvidence = async (evidence: EvidenceReference) => {
    if (evidence.validationStatus !== 'valid') return
    const request = ++evidenceRequest.current
    setActionError(''); setEvidenceFocus(evidence); setFileContext(undefined); setPath(evidence.path)
    try {
      const file = await backend.getFile(session.id, evidence.path, evidence.revision)
      if (request === evidenceRequest.current) setFileContext(file)
    } catch (err) {
      if (request === evidenceRequest.current) setActionError(`Validated evidence could not be loaded: ${errorText(err)}`)
    }
  }
  const chapterIndex = chapters.indexOf(chapter)
  return <main className={`review-shell${focusMode ? ' focus-mode' : ''}`}>
    <header className="review-header"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Overview</button><div><strong>#{session.pullRequest.ref.number} {session.pullRequest.title}</strong><span>{repoName(session.pullRequest)}</span></div>{session.isStale && <span className="badge analysis-stale"><AlertTriangle size={12}/>Stale analysis</span>}<div className="review-progress"><span><i style={{width: `${session.progress.percent}%`}}/></span><small>{session.progress.reviewed} of {session.progress.total} chapters reviewed</small></div><button className="icon-button" title="Toggle focus mode (F)" aria-label="Toggle focus mode" onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button><button className="button secondary small" onClick={() => setPanelTab('drafts')}><MessageSquare size={14}/>{session.comments.filter((c) => c.status === 'draft').length} drafts</button></header>
    <div className="review-grid"><aside className="chapter-panel"><div className="panel-heading"><div><h2>Review chapters</h2><span>{chapterIndex + 1} of {chapters.length}</span></div></div><div className="chapter-list">{chapters.map((item) => { const state = session.chapters.find((entry) => entry.chapterId === item.id)?.status ?? item.status; return <button className={item.id === chapter.id ? 'active' : ''} key={item.id} onClick={() => setChapterId(item.id)}><StatusDot status={state}/><span><strong>{item.order}. {item.title}</strong><small>{item.description}</small></span><ChevronRight size={14}/></button>})}</div><div className="file-section"><h3>Changed files <span>{files.length}</span></h3>{files.map((file) => <button className={file.path === path ? 'active' : ''} key={file.path} onClick={() => {evidenceRequest.current++; setFileContext(undefined); setEvidenceFocus(undefined); setPath(file.path)}}><FileCode2 size={14}/><span title={file.path}>{file.path}</span><em className="additions">+{file.additions}</em><em className="deletions">−{file.deletions}</em></button>)}</div></aside>
      <section className="code-panel"><div className="review-objective"><span>Chapter {chapter.order}</span><div><h2>{chapter.title}</h2><p>{chapter.purpose}</p></div>{chapter.risks.length > 0 && <RiskBadge level={chapter.risks[0].level}/>}</div><div className="code-toolbar"><div><FileDiff size={15}/><strong title={path}>{path || 'Select a changed file'}</strong></div><div><span className="range-hint"><MessageSquare size={12}/>Drag line numbers to comment</span>{fileContext ? <span className="revision head">{fileContext.revision} evidence</span> : <><button className={`view-toggle${diffMode === 'unified' ? ' active' : ''}`} title="Unified diff" onClick={() => setDiffMode('unified')}><FileDiff size={14}/></button><button className={`view-toggle${diffMode === 'split' ? ' active' : ''}`} title="Split diff" onClick={() => setDiffMode('split')}><Columns2 size={14}/></button><span className="revision">{session.pullRequest.baseRef}</span><ArrowRight size={13}/><span className="revision head">{session.pullRequest.headRef}</span></>}</div></div>{fileContext && evidenceFocus ? <FileContextView file={fileContext} focus={evidenceFocus} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(fileContext.path, range)); setPanelTab('drafts')}}/> : diffError ? <ErrorBanner title="Diff unavailable" message={diffError}/> : !diff ? <Skeleton rows={9}/> : diffMode === 'split' ? <SplitDiffView diff={diff} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(diff.file.path, range)); setPanelTab('drafts')}}/> : <DiffView diff={diff} focus={evidenceFocus} comments={session.pullRequest.reviewComments} onReply={prepareThreadReply} replyReset={threadReplyReset} onCommentRange={(range) => {setDraftTarget(draftTargetFor(diff.file.path, range)); setPanelTab('drafts')}}/>}</section>
      <aside className="context-panel"><div className="context-tabs"><button className={panelTab === 'context' ? 'active' : ''} onClick={() => setPanelTab('context')}><PanelRight size={14}/>Context</button><button className={panelTab === 'notes' ? 'active' : ''} onClick={() => setPanelTab('notes')}>Notes</button><button className={panelTab === 'drafts' ? 'active' : ''} onClick={() => setPanelTab('drafts')}>Drafts</button></div>
        {panelTab === 'context' && <>{chapter.symbols.length > 0 && <SymbolNavigator symbols={chapter.symbols} onEvidence={navigateEvidence}/>}<ChapterContext chapter={chapter} onEvidence={navigateEvidence} onDraft={(text) => {setDraft(text); setPanelTab('drafts')}}/></>}
        {panelTab === 'notes' && <NotesPanel notes={session.notes.filter((n) => !n.chapterId || n.chapterId === chapter.id)} value={note} onChange={setNote} onSave={addNote} onEdit={(item) => {setEditingNoteId(item.id); setNote(item.body)}} onDelete={deleteNote} editing={Boolean(editingNoteId)} busy={busy}/>}
        {panelTab === 'drafts' && (
          <DraftsPanel drafts={session.comments.filter((c) => c.status === 'draft')} published={session.comments.filter((c) => c.status === 'published')} selected={selectedDrafts} onSelected={setSelectedDrafts} value={draft} onChange={setDraft} onSave={addDraft} onPublish={preparePublish} onEdit={(item) => {setEditingDraftId(item.id); setDraft(item.body); setDraftTarget(item.path && item.line && item.side ? {path: item.path, startLine: item.startLine, startSide: item.startSide, line: item.line, side: item.side} : undefined)}} onDelete={deleteDraft} editing={Boolean(editingDraftId)} target={draftTarget} onClearTarget={() => setDraftTarget(undefined)} busy={busy}/>
        )}
      </aside>
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
    {summaryOpen && <ReviewSummary session={session} busy={busy} selectedDrafts={selectedDrafts.size} onClose={() => setSummaryOpen(false)} onDrafts={() => {setSummaryOpen(false); setPanelTab('drafts')}} onDecision={prepareDecision}/>}
  </main>
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

function ChapterContext({chapter, onEvidence, onDraft}: {chapter: ReviewChapter; onEvidence: (evidence: EvidenceReference) => void; onDraft: (value: string) => void}) {
  return <div className="context-scroll"><section className="chapter-purpose"><span><Sparkles size={16}/></span><div><h2>{chapter.title}</h2><p>{chapter.purpose}</p></div></section>{chapter.risks.length > 0 && <ContextGroup title="Risks" icon={<AlertTriangle size={15}/>} count={chapter.risks.length}>{chapter.risks.map((risk) => <div className="risk-row" key={risk.id}><RiskBadge level={risk.level}/><strong>{risk.title}</strong><p>{risk.description}</p><EvidenceList evidence={risk.evidence} onClick={onEvidence}/></div>)}</ContextGroup>}{chapter.unknowns.length > 0 && <ClaimGroup title="Blocking unknowns" claims={chapter.unknowns} icon={<CircleHelp size={15}/>} onEvidence={onEvidence}/>} {chapter.behavioralChanges.length > 0 && <ContextGroup title="Behavioral changes" icon={<GitPullRequest size={15}/>} count={chapter.behavioralChanges.length}>{chapter.behavioralChanges.map((change) => <div className="behavior" key={change.id}><strong>{change.summary}</strong><dl><div><dt>Before</dt><dd>{change.before}</dd></div><div><dt>After</dt><dd>{change.after}</dd></div></dl><EvidenceList evidence={change.evidence} onClick={onEvidence}/></div>)}</ContextGroup>}{chapter.facts.length > 0 && <ClaimGroup title="Verified facts" claims={chapter.facts} icon={<ShieldCheck size={15}/>} onEvidence={onEvidence}/>} {chapter.inferences.length > 0 && <ClaimGroup title="Inferences" claims={chapter.inferences} icon={<CircleHelp size={15}/>} onEvidence={onEvidence}/>} {chapter.relatedTests.length > 0 && <ContextGroup title="Related tests" icon={<Check size={15}/>} count={chapter.relatedTests.length}>{chapter.relatedTests.map((test) => <div className="test-ref" key={test.id}><strong>{test.path}</strong><p>{test.description}</p><span className={`validation ${test.relationship}`}>{test.relationship}</span><EvidenceList evidence={test.evidence} onClick={onEvidence}/></div>)}</ContextGroup>} {chapter.suggestedQuestions.length > 0 && <ContextGroup title="Suggested questions" icon={<MessageSquare size={15}/>} count={chapter.suggestedQuestions.length}>{chapter.suggestedQuestions.map((question) => <button className="question" key={question.id} onClick={() => onDraft(question.text)}><span>{question.text}</span><Plus size={14}/></button>)}</ContextGroup>}</div>
}

function ClaimGroup({title, claims, icon, onEvidence}: {title: string; claims: Claim[]; icon: React.ReactNode; onEvidence: (evidence: EvidenceReference) => void}) { return <ContextGroup title={title} icon={icon} count={claims.length}>{claims.map((claim) => <div className="claim" key={claim.id}><p>{claim.text}</p><span className={`validation ${claim.validationStatus}`}>{claim.validationStatus === 'valid' ? 'Evidence verified' : claim.validationStatus === 'invalid' ? 'Invalid reference' : 'Unverified claim'}</span><EvidenceList evidence={claim.evidence} onClick={onEvidence}/></div>)}</ContextGroup> }

function EvidenceList({evidence, onClick}: {evidence: EvidenceReference[]; onClick: (evidence: EvidenceReference) => void}) { return <div className="evidence-list">{evidence.map((item) => <button disabled={item.validationStatus !== 'valid'} title={item.validationMessage} onClick={() => onClick(item)} key={item.id}><Code2 size={12}/><span>{item.path}</span><em>L{item.startLine}{item.endLine !== item.startLine ? `–${item.endLine}` : ''}</em>{item.validationStatus !== 'valid' && <AlertTriangle size={11}/>}</button>)}</div> }

function ContextGroup({title, icon, count, children}: {title: string; icon: React.ReactNode; count: number; children: React.ReactNode}) { return <section className="context-group"><header>{icon}<h3>{title}</h3><span>{count}</span></header><div>{children}</div></section> }

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
  return <section className="software-update-settings"><div className="settings-section-heading"><div><h2>Software updates</h2><p>ReviewArc updates forward within your selected release channel. It never installs an older build.</p></div><code>v{update.currentVersion} · build {update.currentBuild}</code></div><div className="update-channel-control"><div><strong>Release channel</strong><small>{update.channel === 'beta' ? 'Beta includes early builds and all newer GA releases.' : 'Stable receives generally available releases only.'}</small></div><div role="group" aria-label="Release channel"><button type="button" aria-pressed={update.channel === 'stable'} disabled={busy || unavailable} onClick={() => onSetChannel('stable')}>Stable</button><button type="button" aria-pressed={update.channel === 'beta'} disabled={busy || unavailable} onClick={() => onSetChannel('beta')}>Beta</button></div></div>{update.channel === 'beta' && <p className="beta-channel-note"><AlertTriangle size={14}/>Beta builds may be less stable. Returning to Stable does not downgrade the installed app.</p>}<div className={`update-status-row state-${update.state}${showSuccess ? ' success' : ''}`} role="status"><span>{update.state === 'checking' || update.state === 'downloading' || update.state === 'installing' ? <LoaderCircle className="spin" size={15}/> : update.state === 'failed' ? <AlertTriangle size={15}/> : installable || showSuccess ? <Check size={15}/> : <RefreshCw size={15}/>}</span><div><strong>{copy.headline}</strong>{copy.detail && <small>{copy.detail}</small>}{progress != null && <div className="update-download-progress" aria-label={`Download ${progress}% complete`}><i style={{width: `${progress}%`}}/></div>}</div><div className="update-actions">{update.release?.releaseNotesUrl && <button className="button text small" onClick={() => backend.openReleaseNotesURL(update.release!.releaseNotesUrl!)}>Release notes<ExternalLink size={12}/></button>}{installable ? <button className="button primary small" disabled={busy} onClick={onInstall}>{update.state === 'ready' ? 'Install and restart…' : 'Install update…'}</button> : <button className="button secondary small" disabled={busy || unavailable} onClick={onCheck}>{busy || update.state === 'checking' ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {update.state === 'failed' ? 'Try again' : 'Check now'}</button>}</div></div></section>
}

function UpdateInstallConfirmation({update, busy, onCancel, onConfirm}: {update: SoftwareUpdateStatus; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  const ready = update.state === 'ready'
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="update-install-title"><header><div><span><Download size={17}/></span><div><h2 id="update-install-title">Install ReviewArc {update.release?.version}?</h2><p>{ready ? 'The update is downloaded and ready.' : 'ReviewArc will download the signed update.'}</p></div></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onCancel}><X size={17}/></button></header><div className="publish-comments"><article><p>ReviewArc will close and reopen to finish the update. macOS may ask for an administrator username and password to replace the app in Applications.</p></article></div><footer><button className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <Download size={15}/>} {ready ? 'Install and restart' : 'Install update'}</button></footer></section></div>
}

export function SettingsScreen({state, update, updateBusy = false, onCheckUpdate = () => {}, onSetUpdateChannel = () => {}, onInstallUpdate = () => {}, onSources}: {state: BootstrapState; update?: SoftwareUpdateStatus; updateBusy?: boolean; onCheckUpdate?: () => void; onSetUpdateChannel?: (channel: UpdateChannel) => void; onInstallUpdate?: () => void; onSources: () => void}) {
  const protocol = (state.gitProtocol || 'https').toUpperCase()
  return <main className="page settings-page"><div className="page-heading"><div><h1>Settings</h1><p>Local integrations, GitHub connection, updates, data locations, and review sources.</p></div></div><div className="settings-layout">{update && <SoftwareUpdateSettings update={update} busy={updateBusy} onCheck={onCheckUpdate} onSetChannel={onSetUpdateChannel} onInstall={onInstallUpdate}/>}<section><h2>Local integrations</h2><div className="settings-rows">{state.dependencies.map((dep) => <div key={dep.name}><span className={`setup-status ${dep.state}`}>{dep.state === 'available' ? <Check size={14}/> : <X size={14}/>}</span><div><strong>{dependencyLabel(dep.name)}</strong><small>{dep.version || dep.message || (dep.state === 'available' ? 'Available' : 'Not detected by ReviewArc')}</small>{dep.state !== 'available' && <p className="dependency-help">{missingDependencyHelp(dep.name)}</p>}</div><code title={dep.path}>{dep.path || 'Not found'}</code></div>)}</div></section><section><h2>GitHub connection</h2><div className="settings-rows"><div><span className="setup-status available"><Check size={14}/></span><div><strong>Authenticated as @{state.account?.login || 'unknown'}</strong><small>Credentials are managed by GitHub CLI.</small></div><code>gh</code></div><div><span className="setup-status available"><GitPullRequest size={14}/></span><div><strong>Git operations: {protocol}</strong><small>Managed repository fetches follow your <code>gh</code> protocol setting.</small></div><code>{state.gitProtocol || 'https'}</code></div></div></section><section><h2>GitHub sources</h2><p>{state.selections.filter((x) => x.enabled).length} organizations or repositories selected.</p><button className="button secondary" onClick={onSources}><SlidersHorizontal size={15}/>Manage sources</button></section><section><h2>Managed data</h2><dl className="path-list"><div><dt>Repository caches</dt><dd>{state.paths.repositories}</dd></div><div><dt>Database</dt><dd>{state.paths.database}</dd></div><div><dt>Logs</dt><dd>{state.paths.logs}</dd></div></dl><p className="safety-copy"><ShieldCheck size={16}/>ReviewArc operates only in these managed locations. It never checks out or modifies your working repositories.</p></section></div></main>
}
