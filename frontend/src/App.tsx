import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Code2,
  Columns2, Command, ExternalLink, FileCode2, FileDiff, Filter, GitPullRequest, Inbox, ListFilter, LoaderCircle,
  Maximize2, MessageSquare, Minimize2, PanelRight, Pencil, Plus, RefreshCw, Search, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, X,
} from 'lucide-react'
import { backend, BridgeUnavailableError } from './bridge'
import { AnalysisBadge, DependencyPills, EmptyState, ErrorBanner, Logo, Markdown, RiskBadge, Skeleton, StatusDot } from './components'
import { analysisLabel, chapterStatusLabel, filterInbox, normalizeProgress, relationshipLabel, relativeTime, repoName } from './lib'
import type {
  AnalysisStatus, BootstrapState, ChangedFile, ChapterStatus, Claim, DiffFile, EvidenceReference, FileContent, Operation,
  OperationEvent, PublishPreview, PullRequestRef, PullRequestSummary, Relationship, ReviewChapter,
  ReviewComment, ReviewSession, SourceSelection, SourceState,
} from './types'

type Screen = 'inbox' | 'sources' | 'settings' | 'overview' | 'review'

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'The operation did not complete. Check the local logs and try again.'
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
  try { return JSON.parse(window.localStorage?.getItem?.('reviewarc:inbox-view') ?? '{}') as {relationship?: Relationship | 'all'; analysis?: AnalysisStatus | 'all'} } catch { return {} }
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>()
  const [screen, setScreen] = useState<Screen>('inbox')
  const [session, setSession] = useState<ReviewSession>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const state = await backend.bootstrap()
      const gh = state.dependencies.find((dep) => dep.name === 'gh')
      if (gh?.state === 'available') {
        const account = await backend.refreshAccount()
        if (account.user) state.account = account.user
      }
      setBootstrap(state)
      state.selections ??= []
      state.inbox ??= []
      if (state.account && !state.selections.some((s) => s.enabled)) setScreen('sources')
    } catch (err) { setError(errorText(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openPR = async (ref: PullRequestRef) => {
    setLoading(true); setError('')
    try { const value = await backend.openPullRequest(ref); setSession(value); setScreen(value.analysis ? 'overview' : 'overview') }
    catch (err) { setError(errorText(err)) }
    finally { setLoading(false) }
  }

  if (loading && !bootstrap) return <StartupLoading />
  if (!bootstrap) return <main className="startup"><Logo/><ErrorBanner message={error || 'ReviewArc could not load its local state.'} onRetry={load}/></main>

  const missingRequired = bootstrap.dependencies.filter((dep) => dep.name !== 'codex' && dep.state !== 'available')
  if (missingRequired.length || !bootstrap.account) return <DependencyGate state={bootstrap} onRefresh={load} error={error}/>

  return <div className="app-shell">
    <AppHeader state={bootstrap} screen={screen} onNavigate={(next) => { setScreen(next); if (next === 'inbox') setSession(undefined) }}/>
    {error && <div className="global-error"><ErrorBanner message={error} onRetry={() => setError('')}/></div>}
    {screen === 'sources' && <SourceSelector state={bootstrap} onDone={async () => { const next = await backend.bootstrap(); setBootstrap({...next, account: bootstrap.account}); setScreen('inbox') }} />}
    {screen === 'settings' && <SettingsScreen state={bootstrap} onSources={() => setScreen('sources')}/>}
    {screen === 'inbox' && <InboxScreen state={bootstrap} onUpdate={(inbox) => setBootstrap({...bootstrap, inbox})} onOpen={openPR}/>}
    {session && screen === 'overview' && <OverviewScreen session={session} onBack={() => { setSession(undefined); setScreen('inbox') }} onSession={setSession} onReview={() => setScreen('review')}/>}
    {session && screen === 'review' && <ReviewWorkspace session={session} onSession={setSession} onBack={() => setScreen('overview')}/>}
    {commandOpen && <CommandPalette items={bootstrap.inbox} onClose={() => setCommandOpen(false)} onOpen={(ref) => { setCommandOpen(false); void openPR(ref) }}/>}
  </div>
}

function StartupLoading() {
  return <main className="startup"><Logo/><div className="startup-copy"><LoaderCircle className="spin" size={20}/><span>Checking your local review workspace…</span></div></main>
}

function DependencyGate({state, onRefresh, error}: {state: BootstrapState; onRefresh: () => void; error: string}) {
  return <main className="onboarding">
    <header><Logo/><DependencyPills dependencies={state.dependencies}/></header>
    <section className="onboarding-body">
      <div className="onboarding-intro"><span className="arc-line"/><h1>Your pull requests,<br/>ready to understand.</h1><p>ReviewArc uses the tools already trusted on your machine. It creates its own isolated Git caches and never touches your working repositories.</p></div>
      <div className="setup-panel">
        <h2>Connect your review workspace</h2>
        <p>Three local tools power the ReviewArc workflow.</p>
        <div className="setup-list">{state.dependencies.map((dep) => <div className="setup-row" key={dep.name}>
          <span className={`setup-status ${dep.state}`}>{dep.state === 'available' ? <Check size={15}/> : <X size={15}/>}</span>
          <div><strong>{dep.name === 'gh' ? 'GitHub CLI' : dep.name === 'git' ? 'Git' : 'Codex CLI'}</strong><small>{dep.state === 'available' ? dep.version || dep.path || 'Available' : dep.message || 'Not detected'}</small></div>
          <code>{dep.name}</code>
        </div>)}</div>
        {!state.account && <div className="auth-guidance"><ShieldCheck size={19}/><div><strong>GitHub sign-in required</strong><p>Open Terminal and run <code>gh auth login</code>. ReviewArc never stores your GitHub token.</p></div></div>}
        {error && <ErrorBanner message={error}/>}<button className="button primary wide" onClick={onRefresh}><RefreshCw size={16}/>Check again</button>
      </div>
    </section>
  </main>
}

function AppHeader({state, screen, onNavigate}: {state: BootstrapState; screen: Screen; onNavigate: (screen: Screen) => void}) {
  return <header className="app-header">
    <button className="brand-button" onClick={() => onNavigate('inbox')}><Logo/></button>
    <nav aria-label="Primary"><button className={screen === 'inbox' ? 'active' : ''} onClick={() => onNavigate('inbox')}><Inbox size={16}/>Inbox</button><button className={screen === 'sources' ? 'active' : ''} onClick={() => onNavigate('sources')}><SlidersHorizontal size={16}/>Sources</button></nav>
    <div className="header-spacer"/><DependencyPills dependencies={state.dependencies}/>
    <button className={`icon-button ${screen === 'settings' ? 'active' : ''}`} aria-label="Settings" onClick={() => onNavigate('settings')}><Settings size={18}/></button>
    <div className="account-chip">{state.account?.avatarUrl ? <img src={state.account.avatarUrl} alt=""/> : <span>{state.account?.login?.slice(0, 1).toUpperCase()}</span>}<div><strong>{state.account?.name || state.account?.login}</strong><small>@{state.account?.login}</small></div></div>
  </header>
}

function SourceSelector({state, onDone}: {state: BootstrapState; onDone: () => Promise<void>}) {
  const [catalog, setCatalog] = useState<SourceState>()
  const [selected, setSelected] = useState<Set<string>>(new Set(state.selections.filter((x) => x.enabled).map((x) => `${x.kind}:${x.key}`)))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { backend.listSources().then(setCatalog).catch((err) => setError(errorText(err))).finally(() => setBusy(false)) }, [])
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next })
  const save = async () => {
    setBusy(true); setError('')
    const selections: SourceSelection[] = [...selected].map((entry) => { const [kind, ...parts] = entry.split(':'); return {kind: kind as SourceSelection['kind'], key: parts.join(':'), enabled: true} })
    try { await backend.saveSelections(selections); await onDone() } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  const repos = (catalog?.repositories ?? []).filter((r) => `${r.ref.owner}/${r.ref.name} ${r.description}`.toLowerCase().includes(query.toLowerCase()))
  return <main className="page source-page"><div className="page-heading"><div><h1>Repository sources</h1><p>Choose where ReviewArc should look for open pull requests. Repositories are only fetched when you open a PR.</p></div><button className="button primary" disabled={busy || selected.size === 0} onClick={save}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Save sources</button></div>
    {error && <ErrorBanner message={error}/>}<div className="source-toolbar"><label className="search-field"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories"/></label><span>{selected.size} selected</span></div>
    {busy && !catalog ? <Skeleton rows={8}/> : <div className="source-layout"><aside><h2>Organizations</h2>{catalog?.organizations.map((org) => { const key = `organization:${org.login}`; return <label className="source-choice" key={key}><input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)}/><span>{org.avatarUrl && <img src={org.avatarUrl} alt=""/>}<b>{org.login}</b><small>All repositories</small></span></label>})}</aside><section><h2>Repositories <span>{repos.length}</span></h2><div className="repository-choices">{repos.map((repo) => { const name = `${repo.ref.owner}/${repo.ref.name}`; const key = `repository:${name}`; return <label className="repo-choice" key={key}><input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)}/><span className="check-box"><Check size={13}/></span><span><strong>{name}</strong><small>{repo.description || (repo.isPrivate ? 'Private repository' : 'GitHub repository')}</small></span>{repo.isPrivate && <span className="privacy">Private</span>}</label>})}</div></section></div>}
  </main>
}

function InboxScreen({state, onUpdate, onOpen}: {state: BootstrapState; onUpdate: (items: PullRequestSummary[]) => void; onOpen: (ref: PullRequestRef) => void}) {
  const saved = useMemo(savedInboxFilters, [])
  const [query, setQuery] = useState(''); const [relationship, setRelationship] = useState<Relationship | 'all'>(saved.relationship ?? 'all'); const [organization, setOrganization] = useState('all'); const [repository, setRepository] = useState('all'); const [analysis, setAnalysis] = useState<AnalysisStatus | 'all'>(saved.analysis ?? 'all'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [partial, setPartial] = useState<string[]>([])
  const refresh = async () => { setBusy(true); setError(''); try { const result = await backend.refreshInbox(); onUpdate(result.items ?? []); setPartial(Object.values(result.errors ?? {})) } catch (err) { setError(errorText(err)) } finally { setBusy(false) } }
  useEffect(() => { if (!state.inbox.length) void refresh() }, [])
  useEffect(() => { try { window.localStorage?.setItem?.('reviewarc:inbox-view', JSON.stringify({relationship, analysis})) } catch { /* The inbox remains usable when WebView storage is unavailable. */ } }, [relationship, analysis])
  const repositories = useMemo(() => [...new Set(state.inbox.map(repoName))].sort(), [state.inbox])
  const organizations = useMemo(() => [...new Set(state.inbox.map((pr) => pr.ref.repository.owner))].sort(), [state.inbox])
  const items = useMemo(() => filterInbox(state.inbox, query, relationship, repository, analysis).filter((pr) => organization === 'all' || pr.ref.repository.owner === organization), [state.inbox, query, relationship, organization, repository, analysis])
  return <main className="page inbox-page"><div className="page-heading"><div><h1>Pull request inbox</h1><p>Open work across {repositories.length || 'your selected'} repositories, ordered by recent activity.</p></div><button className="button secondary" disabled={busy} onClick={refresh}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}Refresh</button></div>
    {error && <ErrorBanner message={error} onRetry={refresh}/>} {partial.length > 0 && <div className="warning-banner"><AlertTriangle size={16}/><span>Some repositories could not be refreshed. Showing the available results.</span></div>}
    <div className="inbox-controls"><label className="search-field inbox-search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, repository, author, or PR number"/></label><Select label="Relationship" value={relationship} onChange={(value) => setRelationship(value as typeof relationship)} options={[['all','All relationships'],['reviewRequested','Needs your review'],['assigned','Assigned'],['authored','Authored by you'],['selectedRepo','All selected']]}/><Select label="Organization" value={organization} onChange={setOrganization} options={[['all','All organizations'], ...organizations.map((org) => [org,org])]}/><Select label="Repository" value={repository} onChange={setRepository} options={[['all','All repositories'], ...repositories.map((r) => [r,r])]}/><Select label="Analysis" value={analysis} onChange={(value) => setAnalysis(value as typeof analysis)} options={[['all','All analysis states'],['ready','Walkthrough ready'],['notStarted','Not analyzed'],['running','Analyzing'],['stale','Stale'],['failed','Failed']]}/></div>
    <div className="saved-views" aria-label="Saved inbox views"><span>Views</span><button className={relationship === 'reviewRequested' ? 'active' : ''} onClick={() => setRelationship('reviewRequested')}>Needs my review</button><button className={relationship === 'authored' ? 'active' : ''} onClick={() => setRelationship('authored')}>Authored by me</button><button className={analysis === 'ready' ? 'active' : ''} onClick={() => setAnalysis('ready')}>Walkthrough ready</button><button onClick={() => {setRelationship('all'); setAnalysis('all')}}>All open</button></div><div className="inbox-summary"><div><ListFilter size={15}/><strong>{items.length}</strong> open pull request{items.length === 1 ? '' : 's'}</div><span>Sorted by last updated</span></div>
    {busy && !state.inbox.length ? <Skeleton rows={7}/> : !items.length ? <EmptyState icon={<GitPullRequest/>} title={state.inbox.length ? 'No pull requests match these filters' : 'Your review queue is clear'}><p>{state.inbox.length ? 'Broaden the search or reset one of the filters.' : 'ReviewArc found no open pull requests in the selected sources. Refresh after new work is opened.'}</p>{state.inbox.length > 0 && <button className="button secondary" onClick={() => {setQuery(''); setRelationship('all'); setOrganization('all'); setRepository('all'); setAnalysis('all')}}>Reset filters</button>}</EmptyState> : <div className="pr-list">{items.map((pr) => <PRRow key={`${repoName(pr)}#${pr.ref.number}`} pr={pr} onOpen={() => onOpen(pr.ref)}/>)}</div>}
  </main>
}

function Select({label, value, onChange, options}: {label: string; value: string; onChange: (value: string) => void; options: string[][]}) { return <label className="select-field"><span className="sr-only">{label}</span><Filter size={14}/><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><ChevronDown size={14}/></label> }

function PRRow({pr, onOpen}: {pr: PullRequestSummary; onOpen: () => void}) {
  const progress = normalizeProgress(pr.progress)
  const relationship = pr.relationships?.[0]
  return <button className="pr-row" onClick={onOpen}><div className="pr-relation"><span className={`relation-mark ${relationship ?? 'selectedRepo'}`}/><div><span>{relationship ? relationshipLabel(relationship) : 'Selected repository'}</span><strong>{repoName(pr)}</strong></div></div><div className="pr-main"><div className="pr-title"><span>#{pr.ref.number}</span><strong>{pr.title}</strong>{pr.isDraft && <span className="badge neutral">Draft</span>}</div><div className="pr-meta"><span>by @{pr.author.login}</span><span>updated {relativeTime(pr.updatedAt)}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="pr-state"><div><AnalysisBadge status={pr.analysisStatus}/>{pr.analysisStatus === 'ready' && <RiskBadge level={pr.riskLevel}/>}</div>{progress.total > 0 ? <div className="progress-inline"><span><i style={{width: `${progress.percent}%`}}/></span><small>{progress.reviewed}/{progress.total} reviewed</small></div> : <small>{analysisLabel(pr.analysisStatus)}</small>}</div><ChevronRight size={18}/></button>
}

export function OverviewScreen({session, onBack, onSession, onReview}: {session: ReviewSession; onBack: () => void; onSession: (session: ReviewSession) => void; onReview: () => void}) {
  const pr = session.pullRequest; const analysis = session.analysis; const [operation, setOperation] = useState<Operation>(); const [events, setEvents] = useState<OperationEvent[]>([]); const [error, setError] = useState('')
  useEffect(() => { const offOperation = backend.on('reviewarc:operation:v1', (raw) => { const op = raw as Operation; if (op.sessionId && op.sessionId !== session.id) return; setOperation(op); const completed = op.state === 'complete' || op.state === 'completed'; const failed = op.state === 'failed'; const cancelled = op.state === 'cancelled'; const terminal = completed || failed || cancelled; const event: OperationEvent = {stage: op.stage, message: op.message, status: completed ? 'complete' : failed || cancelled ? 'failed' : 'running'}; setEvents((current) => [...current.slice(-7), event]); if (failed) setError(op.message || 'Reanalysis failed. The previous walkthrough is still available.'); if (terminal) backend.getSession(session.id).then(onSession).catch(() => setError(`${completed ? 'Analysis completed' : cancelled ? 'Analysis was cancelled' : 'Analysis failed'}, but the restored walkthrough could not be loaded. Return to the inbox and reopen this pull request.`)) }); const offSession = backend.on('reviewarc:session:v1', (raw) => { const value = raw as {sessionId?: string}; if (value.sessionId === session.id) backend.getSession(session.id).then(onSession).catch(() => {}) }); return () => { offOperation(); offSession() } }, [session.id, onSession])
  const analyze = async () => { setError(''); setEvents([]); try { setOperation(await backend.startAnalysis(session.id)) } catch (err) { setError(errorText(err)) } }
  const running = session.analysisStatus === 'running' || Boolean(operation && !['complete', 'completed', 'failed', 'cancelled'].includes(operation.state))
  const cancel = async () => { if (!operation) return; try { await backend.cancelOperation(operation.id) } catch (err) { setError(errorText(err)) } }
  return <main className="detail-page"><div className="detail-top"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Inbox</button><div className="detail-actions">{analysis && <button className="button secondary" disabled={running} onClick={analyze}>{running ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {running ? 'Reanalyzing' : 'Reanalyze'}</button>}<button className="button primary" disabled={!analysis || running} onClick={onReview}>Start guided review<ArrowRight size={16}/></button></div></div>
    {session.isStale && <div className="stale-banner"><AlertTriangle size={18}/><div><strong>Analysis is out of date</strong><p>{session.staleReason || 'The pull request head revision changed after this walkthrough was generated.'}</p></div><button className="button secondary small" disabled={running} onClick={analyze}>Run again</button></div>}
    <header className="pr-hero"><div><span className="repo-label">{repoName(pr)}</span><h1><span>#{pr.ref.number}</span> {pr.title}</h1>{pr.body ? <Markdown className="pr-description">{pr.body}</Markdown> : <p>No pull request description was provided.</p>}<div className="hero-meta"><span>@{pr.author.login}</span><span>{pr.baseRef} ← {pr.headRef}</span><span>{pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</span><span>{pr.changedFiles} files</span>{pr.requestedReviewers.length > 0 && <span>Review: {pr.requestedReviewers.map((reviewer) => `@${reviewer.login}`).join(', ')}</span>}{pr.reviewState && <span>{pr.reviewState.replaceAll('_', ' ').toLowerCase()}</span>}<span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span></div></div><div className="hero-status"><AnalysisBadge status={running ? 'running' : session.analysisStatus}/>{analysis && <RiskBadge level={analysis.risks[0]?.level ?? pr.riskLevel}/>}<small>Head {pr.headSha.slice(0, 8)}</small></div></header>
    {!analysis ? <AnalysisPanel status={running ? 'running' : session.analysisStatus} operation={operation} events={events} error={error} onStart={analyze} onCancel={cancel}/> : <>{(running || error) && <AnalysisPanel status={running ? 'running' : session.analysisStatus} operation={operation} events={events} error={error} onStart={analyze} onCancel={cancel}/>} {analysis.summaryValidation !== 'valid' && <div className="warning-banner"><AlertTriangle size={16}/><span><strong>Summary is unverified.</strong> {analysis.summaryMessage || 'No valid code evidence supports this summary.'}</span></div>}<AnalysisOverview session={session} onReview={onReview}/></>}
  </main>
}

function AnalysisPanel({status, operation, events, error, onStart, onCancel}: {status: AnalysisStatus; operation?: Operation; events: OperationEvent[]; error: string; onStart: () => void; onCancel: () => void}) {
  const running = status === 'running' || Boolean(operation && operation.state !== 'complete' && operation.state !== 'completed' && operation.state !== 'failed' && operation.state !== 'cancelled')
  return <section className="analysis-launch" aria-live="polite" aria-busy={running}><div className="analysis-promise"><span><Sparkles size={24}/></span><h2>{running ? 'Building the review arc' : 'Turn this change into a guided review'}</h2><p>{running ? 'The previous walkthrough remains visible below while Codex reevaluates the complete current pull request.' : 'Codex reads the isolated managed repository in read-only mode. ReviewArc validates every referenced path and line range before it reaches the walkthrough.'}</p>{!running && <button className="button primary" onClick={onStart}><Sparkles size={16}/>Analyze pull request</button>}</div><div className="analysis-events"><div className="event-heading"><strong>{running ? 'Reanalysis progress' : 'Analysis progress'}</strong>{running && <button className="button text small" onClick={onCancel}>Cancel</button>}</div>{error && <ErrorBanner message={error} onRetry={onStart}/>} {!events.length ? <div className="event-placeholder"><CircleHelp size={17}/><p>{running ? 'Starting the managed snapshot and Codex analysis…' : 'Progress will appear here: cache preparation, revision fetch, Codex analysis, evidence validation, and persistence.'}</p></div> : events.map((event, index) => <div className="event-row" key={`${event.stage}-${index}`}><span className={event.status ?? 'running'}>{event.status === 'complete' ? <Check size={13}/> : event.status === 'failed' ? <X size={13}/> : <LoaderCircle className="spin" size={13}/>}</span><div><strong>{event.stage}</strong><small>{event.message}</small></div>{event.progress != null && <em>{Math.round(event.progress)}%</em>}</div>)}</div></section>
}

function AnalysisOverview({session, onReview}: {session: ReviewSession; onReview: () => void}) {
  const analysis = session.analysis!; const pr = session.pullRequest
  const checks = pr.checkRuns ?? []; const reviews = pr.reviews ?? []; const comments = pr.reviewComments ?? []
  return <div className="overview-grid"><section className="overview-main"><div className="summary-block"><h2>What changed</h2><p>{analysis.summary}</p><div className="area-list">{analysis.affectedAreas.map((area) => <span key={area.name}>{area.name}</span>)}</div></div><div className="overview-section"><div className="section-title"><h2>Review chapters</h2><span>{analysis.chapters.length} guided sections</span></div><div className="overview-chapters">{analysis.chapters.map((chapter) => <button key={chapter.id} onClick={onReview}><span>{chapter.order}</span><div><strong>{chapter.title}</strong><small>{chapter.description}</small></div><StatusDot status={chapter.status}/><ChevronRight size={16}/></button>)}</div></div></section><aside className="overview-aside"><div className="stat-strip"><div><strong>{pr.changedFiles}</strong><span>files changed</span></div><div><strong className="additions">+{pr.additions}</strong><span>additions</span></div><div><strong className="deletions">−{pr.deletions}</strong><span>deletions</span></div></div>{checks.length > 0 && <ContextGroup title="Checks" icon={<Check size={16}/>} count={checks.length}>{checks.map((check) => <div className="check-row" key={check.id}><span className={`check-state ${check.conclusion || check.status}`}/><div><strong>{check.name}</strong><small>{check.conclusion || check.status}{check.appName ? ` · ${check.appName}` : ''}</small></div></div>)}</ContextGroup>}<ContextGroup title="Highest risks" icon={<AlertTriangle size={16}/>} count={analysis.risks.length}>{analysis.risks.slice(0, 4).map((risk) => <div className="risk-row" key={risk.id}><RiskBadge level={risk.level}/><strong>{risk.title}</strong><p>{risk.description}</p></div>)}</ContextGroup><ContextGroup title="Open unknowns" icon={<CircleHelp size={16}/>} count={analysis.unknowns.length}>{analysis.unknowns.slice(0, 4).map((claim) => <p className="context-copy" key={claim.id}>{claim.text}</p>)}</ContextGroup>{(reviews.length > 0 || comments.length > 0) && <ContextGroup title="Existing discussion" icon={<MessageSquare size={16}/>} count={reviews.length + comments.length}>{reviews.slice(-3).map((review) => <div className="discussion-row" key={`review-${review.id}`}><strong>@{review.author.login} · {review.state.toLowerCase()}</strong>{review.body && <p>{review.body}</p>}</div>)}{comments.slice(-3).map((comment) => <div className="discussion-row" key={`comment-${comment.id}`}><strong>@{comment.author.login} on {comment.path}{comment.line ? `:${comment.line}` : ''}</strong><p>{comment.body}</p></div>)}</ContextGroup>}{analysis.validationIssues.length > 0 && <ContextGroup title="Unverified analysis" icon={<ShieldCheck size={16}/>} count={analysis.validationIssues.length}>{analysis.validationIssues.slice(0, 3).map((issue) => <p className="context-copy" key={issue.code + issue.evidenceId}>{issue.message}</p>)}</ContextGroup>}</aside></div>
}

function ReviewWorkspace({session, onSession, onBack}: {session: ReviewSession; onSession: (session: ReviewSession) => void; onBack: () => void}) {
  const analysis = session.analysis!; const chapters = analysis?.chapters ?? []; const [chapterId, setChapterId] = useState(chapters[0]?.id ?? ''); const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0]; const [files, setFiles] = useState<ChangedFile[]>([]); const [path, setPath] = useState(chapter?.files[0]?.path ?? ''); const [diff, setDiff] = useState<DiffFile>(); const [diffError, setDiffError] = useState(''); const [panelTab, setPanelTab] = useState<'context'|'notes'|'drafts'>('context'); const [note, setNote] = useState(''); const [draft, setDraft] = useState(''); const [draftTarget, setDraftTarget] = useState<{path: string; line: number; side?: 'LEFT' | 'RIGHT'}>(); const [busy, setBusy] = useState(false); const [publish, setPublish] = useState<PublishPreview>(); const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set(session.comments.filter((c) => c.status === 'draft').map((c) => c.id)))
  const [actionError, setActionError] = useState('')
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceReference>()
  const [fileContext, setFileContext] = useState<FileContent>()
  const [focusMode, setFocusMode] = useState(false)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState('')
  const [editingDraftId, setEditingDraftId] = useState('')
  useEffect(() => { backend.getChangedFiles(session.id).then((value) => { setFiles(value ?? []); if (!path && value?.[0]) setPath(value[0].path) }).catch((err) => setDiffError(errorText(err))) }, [session.id])
  useEffect(() => { if (!path) return; setDiff(undefined); setDiffError(''); backend.getDiff(session.id, path).then(setDiff).catch((err) => setDiffError(errorText(err))) }, [session.id, path])
  useEffect(() => { const suggested = chapter?.files[0]?.path; setFileContext(undefined); setEvidenceFocus(undefined); if (suggested) setPath(suggested) }, [chapterId])
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
  if (!analysis || !chapter) return <main className="detail-page"><ErrorBanner title="Walkthrough unavailable" message="This session does not contain validated review chapters." onRetry={onBack}/></main>
  const status = session.chapters.find((item) => item.chapterId === chapter.id)?.status ?? chapter.status
  const setStatus = async (value: ChapterStatus) => { setBusy(true); setActionError(''); try { onSession(await backend.updateChapter(session.id, chapter.id, value)) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const addNote = async () => { if (!note.trim()) return; setBusy(true); setActionError(''); try { const saved = await backend.saveNote(session.id, chapter.id, note.trim(), editingNoteId); onSession({...session, notes: editingNoteId ? session.notes.map((item) => item.id === editingNoteId ? saved : item) : [...session.notes, saved]}); setNote(''); setEditingNoteId('') } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const deleteNote = async (id: string) => { setBusy(true); try { await backend.deleteNote(id); onSession({...session, notes: session.notes.filter((item) => item.id !== id)}); if (editingNoteId === id) { setEditingNoteId(''); setNote('') } } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const addDraft = async () => { if (!draft.trim()) return; setBusy(true); setActionError(''); const target = draftTarget as ({path: string; line: number; side?: 'LEFT' | 'RIGHT'} | undefined); try { const saved = await backend.saveDraft(session.id, chapter.id, draft.trim(), target?.path, target?.line, target?.side, editingDraftId); onSession({...session, comments: editingDraftId ? session.comments.map((item) => item.id === editingDraftId ? saved : item) : [...session.comments, saved]}); setSelectedDrafts((value) => new Set(value).add(saved.id)); setDraft(''); setDraftTarget(undefined); setEditingDraftId('') } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const deleteDraft = async (id: string) => { setBusy(true); try { await backend.deleteDraft(id); onSession({...session, comments: session.comments.filter((item) => item.id !== id)}); setSelectedDrafts((value) => { const next = new Set(value); next.delete(id); return next }); if (editingDraftId === id) { setEditingDraftId(''); setDraft('') } } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const preparePublish = async () => { setBusy(true); setActionError(''); try { setPublish(await backend.preparePublish(session.id, [...selectedDrafts])) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const prepareDecision = async (event: 'APPROVE' | 'REQUEST_CHANGES') => { setBusy(true); setActionError(''); try { setPublish(await backend.prepareReview(session.id, [...selectedDrafts], event)); setSummaryOpen(false) } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) } }
  const confirmPublish = async () => { if (!publish) return; setBusy(true); setActionError(''); try { const comments = await backend.confirmPublish(publish.token, publish.digest); const ids = new Set(comments.map((c) => c.id)); onSession({...session, comments: session.comments.map((c) => ids.has(c.id) ? comments.find((x) => x.id === c.id)! : c)}); setPublish(undefined); setSelectedDrafts(new Set()) } catch (err) { setActionError(`Publishing could not be confirmed locally. Refresh the pull request on GitHub before retrying: ${errorText(err)}`) } finally { setBusy(false) } }
  const navigateEvidence = async (evidence: EvidenceReference) => { if (evidence.validationStatus !== 'valid') return; setActionError(''); setEvidenceFocus(evidence); setFileContext(undefined); setPath(evidence.path); try { setFileContext(await backend.getFile(session.id, evidence.path, evidence.revision)) } catch (err) { setActionError(`Validated evidence could not be loaded: ${errorText(err)}`) } }
  const chapterIndex = chapters.indexOf(chapter)
  return <main className={`review-shell${focusMode ? ' focus-mode' : ''}`}>
    <header className="review-header"><button className="button text" onClick={onBack}><ArrowLeft size={16}/>Overview</button><div><strong>#{session.pullRequest.ref.number} {session.pullRequest.title}</strong><span>{repoName(session.pullRequest)}</span></div>{session.isStale && <span className="badge analysis-stale"><AlertTriangle size={12}/>Stale analysis</span>}<div className="review-progress"><span><i style={{width: `${session.progress.percent}%`}}/></span><small>{session.progress.reviewed} of {session.progress.total} chapters reviewed</small></div><button className="icon-button" title="Toggle focus mode (F)" aria-label="Toggle focus mode" onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button><button className="button secondary small" onClick={() => setPanelTab('drafts')}><MessageSquare size={14}/>{session.comments.filter((c) => c.status === 'draft').length} drafts</button></header>
    <div className="review-grid"><aside className="chapter-panel"><div className="panel-heading"><div><h2>Review chapters</h2><span>{chapterIndex + 1} of {chapters.length}</span></div></div><div className="chapter-list">{chapters.map((item) => { const state = session.chapters.find((entry) => entry.chapterId === item.id)?.status ?? item.status; return <button className={item.id === chapter.id ? 'active' : ''} key={item.id} onClick={() => setChapterId(item.id)}><StatusDot status={state}/><span><strong>{item.order}. {item.title}</strong><small>{item.description}</small></span><ChevronRight size={14}/></button>})}</div><div className="file-section"><h3>Changed files <span>{files.length}</span></h3>{files.map((file) => <button className={file.path === path ? 'active' : ''} key={file.path} onClick={() => {setFileContext(undefined); setEvidenceFocus(undefined); setPath(file.path)}}><FileCode2 size={14}/><span title={file.path}>{file.path}</span><em className="additions">+{file.additions}</em><em className="deletions">−{file.deletions}</em></button>)}</div></aside>
      <section className="code-panel"><div className="review-objective"><span>Chapter {chapter.order}</span><div><h2>{chapter.title}</h2><p>{chapter.purpose}</p></div>{chapter.risks.length > 0 && <RiskBadge level={chapter.risks[0].level}/>}</div><div className="code-toolbar"><div><FileDiff size={15}/><strong title={path}>{path || 'Select a changed file'}</strong></div><div>{fileContext ? <span className="revision head">{fileContext.revision} evidence</span> : <><button className={`view-toggle${diffMode === 'unified' ? ' active' : ''}`} title="Unified diff" onClick={() => setDiffMode('unified')}><FileDiff size={14}/></button><button className={`view-toggle${diffMode === 'split' ? ' active' : ''}`} title="Split diff" onClick={() => setDiffMode('split')}><Columns2 size={14}/></button><span className="revision">{session.pullRequest.baseRef}</span><ArrowRight size={13}/><span className="revision head">{session.pullRequest.headRef}</span></>}</div></div>{fileContext && evidenceFocus ? <FileContextView file={fileContext} focus={evidenceFocus} onCommentLine={(line, side) => {setDraftTarget({path: fileContext.path, line, side} as typeof draftTarget); setPanelTab('drafts')}}/> : diffError ? <ErrorBanner title="Diff unavailable" message={diffError}/> : !diff ? <Skeleton rows={9}/> : diffMode === 'split' ? <SplitDiffView diff={diff} onCommentLine={(line, side) => {setDraftTarget({path: diff.file.path, line, side} as typeof draftTarget); setPanelTab('drafts')}}/> : <DiffView diff={diff} focus={evidenceFocus} onCommentLine={(line, side) => {setDraftTarget({path: diff.file.path, line, side} as typeof draftTarget); setPanelTab('drafts')}}/>}</section>
      <aside className="context-panel"><div className="context-tabs"><button className={panelTab === 'context' ? 'active' : ''} onClick={() => setPanelTab('context')}><PanelRight size={14}/>Context</button><button className={panelTab === 'notes' ? 'active' : ''} onClick={() => setPanelTab('notes')}>Notes</button><button className={panelTab === 'drafts' ? 'active' : ''} onClick={() => setPanelTab('drafts')}>Drafts</button></div>
        {panelTab === 'context' && <>{chapter.symbols.length > 0 && <div className="symbol-strip"><span>Changed symbols</span>{chapter.symbols.slice(0, 4).map((symbol) => <button key={`${symbol.path}:${symbol.name}`} onClick={() => symbol.evidence[0] && navigateEvidence(symbol.evidence[0])}><Code2 size={12}/>{symbol.name}</button>)}</div>}<ChapterContext chapter={chapter} onEvidence={navigateEvidence} onDraft={(text) => {setDraft(text); setPanelTab('drafts')}}/></>}
        {panelTab === 'notes' && <NotesPanel notes={session.notes.filter((n) => !n.chapterId || n.chapterId === chapter.id)} value={note} onChange={setNote} onSave={addNote} onEdit={(item) => {setEditingNoteId(item.id); setNote(item.body)}} onDelete={deleteNote} editing={Boolean(editingNoteId)} busy={busy}/>}
        {panelTab === 'drafts' && <DraftsPanel drafts={session.comments.filter((c) => c.status === 'draft')} published={session.comments.filter((c) => c.status === 'published')} selected={selectedDrafts} onSelected={setSelectedDrafts} value={draft} onChange={setDraft} onSave={addDraft} onPublish={preparePublish} onEdit={(item) => {setEditingDraftId(item.id); setDraft(item.body); setDraftTarget(item.path && item.line ? {path: item.path, line: item.line, side: item.side} : undefined)}} onDelete={deleteDraft} editing={Boolean(editingDraftId)} target={draftTarget} onClearTarget={() => setDraftTarget(undefined)} busy={busy}/>}
      </aside>
    </div><footer className="review-footer"><select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as ChapterStatus)}>{(['notReviewed','inProgress','reviewed','needsClarification','blocked'] as ChapterStatus[]).map((value) => <option key={value} value={value}>{chapterStatusLabel(value)}</option>)}</select><span className="shortcut-hint">[ previous · ] next · F focus · ⌘K open</span><div className="footer-spacer"/><button className="button secondary small" disabled={chapterIndex === 0} onClick={() => setChapterId(chapters[chapterIndex - 1].id)}><ArrowLeft size={14}/>Previous</button>{chapterIndex === chapters.length - 1 ? <button className="button primary small" onClick={() => setSummaryOpen(true)}>Review summary<ShieldCheck size={14}/></button> : <button className="button primary small" onClick={() => setChapterId(chapters[chapterIndex + 1].id)}>Next chapter<ArrowRight size={14}/></button>}</footer>
    {actionError && <div className="global-error"><ErrorBanner title="Review action failed" message={actionError} onRetry={() => setActionError('')}/></div>}
    {publish && <PublishConfirmation preview={publish} busy={busy} onCancel={() => setPublish(undefined)} onConfirm={confirmPublish}/>}
    {summaryOpen && <ReviewSummary session={session} busy={busy} selectedDrafts={selectedDrafts.size} onClose={() => setSummaryOpen(false)} onDrafts={() => {setSummaryOpen(false); setPanelTab('drafts')}} onDecision={prepareDecision}/>}
  </main>
}

export function FileContextView({file, focus, onCommentLine}: {file: FileContent; focus: EvidenceReference; onCommentLine: (line: number, side: 'LEFT' | 'RIGHT') => void}) {
  useEffect(() => {
    requestAnimationFrame(() => document.getElementById('focused-file-line')?.scrollIntoView({block: 'center', behavior: 'smooth'}))
  }, [file.path, file.revision, focus.id])
  if (file.isBinary) return <EmptyState icon={<FileCode2/>} title="Binary evidence"><p>This validated path is binary and has no displayable line context.</p></EmptyState>
  const side = file.revision === 'base' ? 'LEFT' : 'RIGHT'
  const lines = file.content.endsWith('\n') ? file.content.slice(0, -1).split('\n') : file.content.split('\n')
  return <div className="diff-view file-context-view" role="table" aria-label={`${file.revision} file context for ${file.path}`}>{lines.map((content, index) => { const line = index + 1; const focused = line >= focus.startLine && line <= focus.endLine; return <div id={line === focus.startLine ? 'focused-file-line' : undefined} className={`diff-line line-context${focused ? ' evidence-focused' : ''}`} role="row" key={line}><span className="line-number"><button title={`Draft a comment on ${file.revision} line ${line}`} aria-label={`Draft a comment on ${file.revision} line ${line}`} onClick={() => onCommentLine(line, side)}>{line}</button></span><span className="line-number new-line"/><span className="line-prefix"> </span><code>{content || ' '}</code></div>})}</div>
}

export function DiffView({diff, focus, onCommentLine}: {diff: DiffFile; focus?: EvidenceReference; onCommentLine: (line: number, side: 'LEFT' | 'RIGHT') => void}) {
  useEffect(() => {
    if (!focus || focus.path !== diff.file.path) return
    requestAnimationFrame(() => document.getElementById('focused-evidence-line')?.scrollIntoView({block: 'center', behavior: 'smooth'}))
  }, [diff.file.path, focus?.id])
  if (diff.file.isBinary) return <EmptyState icon={<FileCode2/>} title="Binary file"><p>ReviewArc cannot render a textual diff for this file.</p></EmptyState>
  if (!diff.hunks?.length) return <EmptyState icon={<FileDiff/>} title="No textual changes"><p>The file metadata changed without a displayable text hunk.</p></EmptyState>
  let focusAssigned = false
  return <div className="diff-view" role="table" aria-label={`Diff for ${diff.file.path}`}>{diff.hunks.map((hunk, hunkIndex) => <div className="diff-hunk" key={`${hunk.header}-${hunkIndex}`}><div className="hunk-header">{hunk.header}</div>{hunk.lines.map((line, index) => { const evidenceLine = focus?.revision === 'base' ? line.oldLine : line.newLine; const focused = !focusAssigned && focus?.path === diff.file.path && evidenceLine != null && evidenceLine >= focus.startLine && evidenceLine <= focus.endLine; if (focused) focusAssigned = true; return <div id={focused ? 'focused-evidence-line' : undefined} className={`diff-line line-${line.kind}${focused ? ' evidence-focused' : ''}`} role="row" key={`${index}-${line.oldLine}-${line.newLine}`}><span className="line-number">{line.oldLine != null ? <button title={`Draft a comment on base line ${line.oldLine}`} aria-label={`Draft a comment on base line ${line.oldLine}`} onClick={() => onCommentLine(line.oldLine!, 'LEFT')}>{line.oldLine}</button> : ''}</span><span className="line-number new-line">{line.newLine != null ? <button title={`Draft a comment on head line ${line.newLine}`} aria-label={`Draft a comment on head line ${line.newLine}`} onClick={() => onCommentLine(line.newLine!, 'RIGHT')}>{line.newLine}</button> : ''}</span><span className="line-prefix">{line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ' '}</span><code>{line.content || ' '}</code></div>})}</div>)}</div>
}

export function SplitDiffView({diff, onCommentLine}: {diff: DiffFile; onCommentLine: (line: number, side: 'LEFT' | 'RIGHT') => void}) {
  if (diff.file.isBinary || !diff.hunks?.length) return <DiffView diff={diff} onCommentLine={onCommentLine}/>
  return <div className="split-diff" role="table" aria-label={`Split diff for ${diff.file.path}`}>{diff.hunks.map((hunk, hunkIndex) => <div className="split-hunk" key={`${hunk.header}-${hunkIndex}`}><div className="hunk-header">{hunk.header}</div>{hunk.lines.map((line, index) => <div className={`split-row line-${line.kind}`} role="row" key={`${index}-${line.oldLine}-${line.newLine}`}><div className={line.kind === 'add' ? 'split-empty' : 'split-cell'}><span className="line-number">{line.oldLine != null ? <button aria-label={`Draft a comment on base line ${line.oldLine}`} onClick={() => onCommentLine(line.oldLine!, 'LEFT')}>{line.oldLine}</button> : ''}</span><code>{line.kind === 'add' ? '' : line.content || ' '}</code></div><div className={line.kind === 'delete' ? 'split-empty' : 'split-cell'}><span className="line-number">{line.newLine != null ? <button aria-label={`Draft a comment on head line ${line.newLine}`} onClick={() => onCommentLine(line.newLine!, 'RIGHT')}>{line.newLine}</button> : ''}</span><code>{line.kind === 'delete' ? '' : line.content || ' '}</code></div></div>)}</div>)}</div>
}

function ChapterContext({chapter, onEvidence, onDraft}: {chapter: ReviewChapter; onEvidence: (evidence: EvidenceReference) => void; onDraft: (value: string) => void}) {
  return <div className="context-scroll"><section className="chapter-purpose"><span><Sparkles size={16}/></span><div><h2>{chapter.title}</h2><p>{chapter.purpose}</p></div></section>{chapter.risks.length > 0 && <ContextGroup title="Risks" icon={<AlertTriangle size={15}/>} count={chapter.risks.length}>{chapter.risks.map((risk) => <div className="risk-row" key={risk.id}><RiskBadge level={risk.level}/><strong>{risk.title}</strong><p>{risk.description}</p><EvidenceList evidence={risk.evidence} onClick={onEvidence}/></div>)}</ContextGroup>}{chapter.unknowns.length > 0 && <ClaimGroup title="Blocking unknowns" claims={chapter.unknowns} icon={<CircleHelp size={15}/>} onEvidence={onEvidence}/>} {chapter.behavioralChanges.length > 0 && <ContextGroup title="Behavioral changes" icon={<GitPullRequest size={15}/>} count={chapter.behavioralChanges.length}>{chapter.behavioralChanges.map((change) => <div className="behavior" key={change.id}><strong>{change.summary}</strong><dl><div><dt>Before</dt><dd>{change.before}</dd></div><div><dt>After</dt><dd>{change.after}</dd></div></dl><EvidenceList evidence={change.evidence} onClick={onEvidence}/></div>)}</ContextGroup>}{chapter.facts.length > 0 && <ClaimGroup title="Verified facts" claims={chapter.facts} icon={<ShieldCheck size={15}/>} onEvidence={onEvidence}/>} {chapter.inferences.length > 0 && <ClaimGroup title="Inferences" claims={chapter.inferences} icon={<CircleHelp size={15}/>} onEvidence={onEvidence}/>} {chapter.relatedTests.length > 0 && <ContextGroup title="Related tests" icon={<Check size={15}/>} count={chapter.relatedTests.length}>{chapter.relatedTests.map((test) => <div className="test-ref" key={test.id}><strong>{test.path}</strong><p>{test.description}</p><span className={`validation ${test.relationship}`}>{test.relationship}</span><EvidenceList evidence={test.evidence} onClick={onEvidence}/></div>)}</ContextGroup>} {chapter.suggestedQuestions.length > 0 && <ContextGroup title="Suggested questions" icon={<MessageSquare size={15}/>} count={chapter.suggestedQuestions.length}>{chapter.suggestedQuestions.map((question) => <button className="question" key={question.id} onClick={() => onDraft(question.text)}><span>{question.text}</span><Plus size={14}/></button>)}</ContextGroup>}</div>
}

function ClaimGroup({title, claims, icon, onEvidence}: {title: string; claims: Claim[]; icon: React.ReactNode; onEvidence: (evidence: EvidenceReference) => void}) { return <ContextGroup title={title} icon={icon} count={claims.length}>{claims.map((claim) => <div className="claim" key={claim.id}><p>{claim.text}</p><span className={`validation ${claim.validationStatus}`}>{claim.validationStatus === 'valid' ? 'Evidence verified' : claim.validationStatus === 'invalid' ? 'Invalid reference' : 'Unverified claim'}</span><EvidenceList evidence={claim.evidence} onClick={onEvidence}/></div>)}</ContextGroup> }

function EvidenceList({evidence, onClick}: {evidence: EvidenceReference[]; onClick: (evidence: EvidenceReference) => void}) { return <div className="evidence-list">{evidence.map((item) => <button disabled={item.validationStatus !== 'valid'} title={item.validationMessage} onClick={() => onClick(item)} key={item.id}><Code2 size={12}/><span>{item.path}</span><em>L{item.startLine}{item.endLine !== item.startLine ? `–${item.endLine}` : ''}</em>{item.validationStatus !== 'valid' && <AlertTriangle size={11}/>}</button>)}</div> }

function ContextGroup({title, icon, count, children}: {title: string; icon: React.ReactNode; count: number; children: React.ReactNode}) { return <section className="context-group"><header>{icon}<h3>{title}</h3><span>{count}</span></header><div>{children}</div></section> }

function NotesPanel({notes, value, onChange, onSave, onEdit, onDelete, editing, busy}: {notes: ReviewSession['notes']; value: string; onChange: (value: string) => void; onSave: () => void; onEdit: (note: ReviewSession['notes'][number]) => void; onDelete: (id: string) => void; editing: boolean; busy: boolean}) { return <div className="composer-panel"><div className="composer-intro"><h2>Private notes</h2><p>Stored only in ReviewArc. Notes are never sent to GitHub.</p></div><textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="Capture a concern, decision, or follow-up…"/><button className="button primary small" disabled={busy || !value.trim()} onClick={onSave}>{editing ? 'Update' : 'Save'} note</button><div className="saved-items">{notes.map((note) => <article key={note.id}><p>{note.body}</p><footer><small>{relativeTime(note.updatedAt)}</small><button aria-label="Edit note" onClick={() => onEdit(note)}><Pencil size={13}/></button><button aria-label="Delete note" onClick={() => onDelete(note.id)}><Trash2 size={13}/></button></footer></article>)}</div></div> }

function DraftsPanel({drafts, published, selected, onSelected, value, onChange, onSave, onPublish, onEdit, onDelete, editing, target, onClearTarget, busy}: {drafts: ReviewComment[]; published: ReviewComment[]; selected: Set<string>; onSelected: (value: Set<string>) => void; value: string; onChange: (value: string) => void; onSave: () => void; onPublish: () => void; onEdit: (draft: ReviewComment) => void; onDelete: (id: string) => void; editing: boolean; target?: {path: string; line: number}; onClearTarget: () => void; busy: boolean}) {
  const toggle = (id: string) => { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); onSelected(next) }
  return <div className="composer-panel"><div className="composer-intro"><h2>Review drafts</h2><p>Draft locally first. Publishing always requires a separate confirmation.</p></div>{target && <div className="draft-target"><Code2 size={12}/><span>{target.path}:{target.line}</span><button aria-label="Make this a general comment" onClick={onClearTarget}><X size={12}/></button></div>}<textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={target ? `Comment on ${target.path}:${target.line}…` : 'Write a clear, actionable review comment…'}/><button className="button primary small" disabled={busy || !value.trim()} onClick={onSave}>{editing ? 'Update' : 'Save'} {target ? 'inline ' : ''}draft</button><div className="saved-items drafts">{drafts.map((draft) => <label key={draft.id}><input type="checkbox" checked={selected.has(draft.id)} onChange={() => toggle(draft.id)}/><article><p>{draft.body}</p><footer><small>{draft.path ? `${draft.path}${draft.line ? `:${draft.line}` : ''}` : 'General review comment'}</small><button aria-label="Edit draft" onClick={() => onEdit(draft)}><Pencil size={13}/></button><button aria-label="Delete draft" onClick={() => onDelete(draft.id)}><Trash2 size={13}/></button></footer></article></label>)}</div>{drafts.length > 0 && <button className="button danger wide" disabled={busy || !selected.size} onClick={onPublish}>Preview {selected.size} comment{selected.size === 1 ? '' : 's'}</button>}{published.length > 0 && <section className="publication-history"><h3>Published from ReviewArc</h3>{published.map((comment) => <a key={comment.id} href={comment.githubUrl} target="_blank" rel="noreferrer"><Check size={13}/><span>{comment.body}</span><ExternalLink size={12}/></a>)}</section>}</div>
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
  return <div className="modal-backdrop"><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title"><header><div><span><ExternalLink size={17}/></span><div><h2 id="publish-title">{label}?</h2><p>This review is externally visible on GitHub and requires your explicit confirmation.</p></div></div><button className="icon-button" aria-label="Close" onClick={onCancel}><X size={17}/></button></header><div className="publish-target"><GitPullRequest size={16}/><span>{preview.repository} #{preview.number}</span><strong>{preview.event.replace('_', ' ').toLowerCase()}</strong></div>{preview.items.length > 0 && <div className="publish-comments">{preview.items.map((comment) => <article key={comment.draftId}><p>{comment.body}</p><small>{comment.path ? `${comment.path}${comment.line ? `:${comment.line}` : ''}` : 'General review comment'}</small></article>)}</div>}<footer><button className="button secondary" disabled={busy} onClick={onCancel}>Keep editing</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <ExternalLink size={15}/>}Confirm {label.toLowerCase()}</button></footer></section></div>
}

function CommandPalette({items, onClose, onOpen}: {items: PullRequestSummary[]; onClose: () => void; onOpen: (ref: PullRequestRef) => void}) {
  const [query, setQuery] = useState('')
  const results = items.filter((item) => `${repoName(item)} ${item.ref.number} ${item.title}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
  useDialogFocus(onClose)
  return <div className="modal-backdrop command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="quick-open-title"><header><Command size={17}/><label><span id="quick-open-title" className="sr-only">Quick open a pull request</span><input id="quick-open-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Quick open a pull request…"/></label><kbd>esc</kbd></header><div className="command-results">{results.map((item) => <button key={`${repoName(item)}#${item.ref.number}`} onClick={() => onOpen(item.ref)}><GitPullRequest size={15}/><span><strong>#{item.ref.number} {item.title}</strong><small>{repoName(item)}</small></span><ChevronRight size={15}/></button>)}{!results.length && <p>No matching pull requests.</p>}</div></section></div>
}

export function SettingsScreen({state, onSources}: {state: BootstrapState; onSources: () => void}) { const protocol = (state.gitProtocol || 'https').toUpperCase(); return <main className="page settings-page"><div className="page-heading"><div><h1>Settings</h1><p>Local integrations, GitHub connection, data locations, and review sources.</p></div></div><div className="settings-layout"><section><h2>Local integrations</h2><div className="settings-rows">{state.dependencies.map((dep) => <div key={dep.name}><span className={`setup-status ${dep.state}`}>{dep.state === 'available' ? <Check size={14}/> : <X size={14}/>}</span><div><strong>{dep.name}</strong><small>{dep.version || dep.message || dep.path}</small></div><code>{dep.path || 'Not found'}</code></div>)}</div></section><section><h2>GitHub connection</h2><div className="settings-rows"><div><span className="setup-status available"><Check size={14}/></span><div><strong>Authenticated as @{state.account?.login || 'unknown'}</strong><small>Credentials are managed by GitHub CLI.</small></div><code>gh</code></div><div><span className="setup-status available"><GitPullRequest size={14}/></span><div><strong>Git operations: {protocol}</strong><small>Managed repository fetches follow your <code>gh</code> protocol setting.</small></div><code>{state.gitProtocol || 'https'}</code></div></div></section><section><h2>GitHub sources</h2><p>{state.selections.filter((x) => x.enabled).length} organizations or repositories selected.</p><button className="button secondary" onClick={onSources}><SlidersHorizontal size={15}/>Manage sources</button></section><section><h2>Managed data</h2><dl className="path-list"><div><dt>Repository caches</dt><dd>{state.paths.repositories}</dd></div><div><dt>Database</dt><dd>{state.paths.database}</dd></div><div><dt>Logs</dt><dd>{state.paths.logs}</dd></div></dl><p className="safety-copy"><ShieldCheck size={16}/>ReviewArc operates only in these managed locations. It never checks out or modifies your working repositories.</p></section></div></main> }
