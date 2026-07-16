import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Filter, GitPullRequest, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { backend } from '../../bridge'
import { EmptyState, ErrorBanner, SelectControl, Skeleton } from '../../components'
import { errorText } from '../../errors'
import { filterInbox, repoName } from '../../lib'
import type { AnalysisStatus, BootstrapState, Operation, PullRequestSummary, Relationship, ReviewSession } from '../../types'
import { PullRequestRow } from './PullRequestRow'

const inboxPageSize = 100

function savedInboxFilters() {
  try { return JSON.parse(window.localStorage?.getItem?.('reviewarc:inbox-view') ?? '{}') as {relationship?: Relationship | 'all'; label?: string; analysis?: AnalysisStatus | 'all'} } catch { return {} }
}

function analysisKey(pr: PullRequestSummary) {
  return `${repoName(pr)}#${pr.ref.number}`
}

export function InboxScreen({state, onUpdate, onOpen}: {state: BootstrapState; onUpdate: (update: (items: PullRequestSummary[]) => PullRequestSummary[]) => void; onOpen: (pr: PullRequestSummary) => void}) {
  const saved = useMemo(savedInboxFilters, [])
  const [query, setQuery] = useState(''); const [relationship, setRelationship] = useState<Relationship | 'all'>(saved.relationship ?? 'all'); const [organization, setOrganization] = useState('all'); const [repository, setRepository] = useState('all'); const [label, setLabel] = useState(saved.label ?? 'all'); const [analysis, setAnalysis] = useState<AnalysisStatus | 'all'>(saved.analysis ?? 'all'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [partial, setPartial] = useState<string[]>([])
  const [visibility, setVisibility] = useState({source: state.inbox, limit: inboxPageSize})
  const [analysisBusy, setAnalysisBusy] = useState<Set<string>>(new Set())
  const analysisBusyRef = useRef(new Set<string>())
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({})
  const visibleLimit = visibility.source === state.inbox ? visibility.limit : inboxPageSize
  const resetVisibleLimit = () => setVisibility({source: state.inbox, limit: inboxPageSize})
  const refresh = useCallback(async () => { setBusy(true); setError(''); try { const result = await backend.refreshInbox(); onUpdate(() => result.items ?? []); setPartial(Object.values(result.errors ?? {})) } catch (err) { setError(errorText(err)) } finally { setBusy(false) } }, [onUpdate])
  useEffect(() => { if (!state.inbox.length) void refresh() }, [refresh, state.inbox.length])
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
  const patchSession = useCallback((session: ReviewSession) => onUpdate((current) => current.map((item) => item.sessionId === session.id || (repoName(item) === repoName(session.pullRequest) && item.ref.number === session.pullRequest.ref.number) ? {...item, sessionId: session.id, analysisStatus: session.analysisStatus, progress: session.progress, riskLevel: session.pullRequest.riskLevel} : item)), [onUpdate])
  useEffect(() => backend.on('reviewarc:operation:v1', (raw) => {
    const operation = raw as Operation
    if (!operation.sessionId) return
    if (operation.state === 'queued' || operation.state === 'running') {
      const status = operation.state
      onUpdate((current) => current.map((candidate) => candidate.sessionId === operation.sessionId ? {...candidate, analysisStatus: status} : candidate))
      return
    }
    if (['completed', 'complete', 'failed', 'cancelled'].includes(operation.state)) void backend.getSession(operation.sessionId).then(patchSession).catch(() => {})
  }), [onUpdate, patchSession])
  const startInboxAnalysis = async (pr: PullRequestSummary) => {
    const key = analysisKey(pr)
    if (analysisBusyRef.current.has(key)) return
    analysisBusyRef.current.add(key)
    setAnalysisBusy((current) => new Set(current).add(key)); setAnalysisErrors((current) => ({...current, [key]: ''}))
    try { patchSession((await backend.queueInboxAnalysis(pr.ref)).session) }
    catch (err) { setAnalysisErrors((current) => ({...current, [key]: errorText(err)})) }
    finally { analysisBusyRef.current.delete(key); setAnalysisBusy((current) => { const next = new Set(current); next.delete(key); return next }) }
  }
  const cancelInboxAnalysis = async (pr: PullRequestSummary) => {
    if (!pr.sessionId) return
    const key = analysisKey(pr)
    if (analysisBusyRef.current.has(key)) return
    analysisBusyRef.current.add(key)
    setAnalysisBusy((current) => new Set(current).add(key)); setAnalysisErrors((current) => ({...current, [key]: ''}))
    try {
      const snapshot = await backend.getActiveAnalysisOperation(pr.sessionId)
      if (!snapshot) throw new Error('The analysis operation is no longer active.')
      await backend.cancelOperation(snapshot.operation.id)
    } catch (err) { setAnalysisErrors((current) => ({...current, [key]: errorText(err)})) }
    finally { analysisBusyRef.current.delete(key); setAnalysisBusy((current) => { const next = new Set(current); next.delete(key); return next }) }
  }
  const queuedCount = state.inbox.filter((item) => item.analysisStatus === 'queued').length
  const runningCount = state.inbox.filter((item) => item.analysisStatus === 'running').length
  return <main className="page inbox-page"><div className="page-heading"><div><h1>Pull request inbox</h1><p>Open work across {repositories.length || 'your selected'} repositories, ordered by recent activity.</p></div><div className="inbox-heading-actions">{(runningCount > 0 || queuedCount > 0) && <span className="inbox-analysis-activity" role="status">{runningCount > 0 && <strong>{runningCount} analyzing</strong>}{runningCount > 0 && queuedCount > 0 && <i>·</i>}{queuedCount > 0 && <span>{queuedCount} queued</span>}</span>}<button className="button secondary" disabled={busy} onClick={() => void refresh()}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}Refresh</button></div></div>
    {error && <ErrorBanner message={error} onRetry={() => void refresh()}/>} {partial.length > 0 && <div className="warning-banner"><AlertTriangle size={16}/><span>Some repositories could not be refreshed. Showing the available results.</span></div>}
    <div className="inbox-controls"><label className="search-field inbox-search"><Search size={17}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => {resetVisibleLimit(); setQuery(e.target.value)}} placeholder="Search title, repository, author, PR number, or label"/></label><Select label="Relationship" value={relationship} onChange={(value) => {resetVisibleLimit(); setRelationship(value as typeof relationship)}} options={[['all','All relationships'],['reviewRequested','Needs your review'],['assigned','Assigned'],['authored','Authored by you'],['selectedRepo','All selected']]}/><Select label="Organization" value={organization} onChange={(value) => {resetVisibleLimit(); setOrganization(value)}} options={[['all','All organizations'], ...organizations.map((org) => [org,org])]}/><Select label="Repository" value={repository} onChange={(value) => {resetVisibleLimit(); setRepository(value)}} options={[['all','All repositories'], ...repositories.map((r) => [r,r])]}/><Select label="Label" value={label} onChange={(value) => {resetVisibleLimit(); setLabel(value)}} options={[['all','All labels'], ...labels.map((item) => [item,item])]}/><Select label="Analysis" value={analysis} onChange={(value) => {resetVisibleLimit(); setAnalysis(value as typeof analysis)}} options={[['all','All analysis states'],['ready','Guided review ready'],['notStarted','Not analyzed'],['queued','Queued'],['running','Analyzing'],['stale','Stale'],['failed','Failed']]}/></div>
    <div className="saved-views" aria-label="Saved inbox views"><span>Views</span><button className={relationship === 'reviewRequested' ? 'active' : ''} aria-pressed={relationship === 'reviewRequested'} onClick={() => {resetVisibleLimit(); setRelationship('reviewRequested')}}>Needs my review</button><button className={relationship === 'authored' ? 'active' : ''} aria-pressed={relationship === 'authored'} onClick={() => {resetVisibleLimit(); setRelationship('authored')}}>Authored by me</button><button className={analysis === 'ready' ? 'active' : ''} aria-pressed={analysis === 'ready'} onClick={() => {resetVisibleLimit(); setAnalysis('ready')}}>Guided review ready</button><button className={allOpen ? 'active' : ''} aria-pressed={allOpen} onClick={resetFilters}>All open</button></div><div className="inbox-summary"><div className="result-count" role="status" aria-label="Inbox result count">Showing <strong>{items.length}</strong>{items.length === state.inbox.length ? '' : ` of ${state.inbox.length}`} open pull request{state.inbox.length === 1 ? '' : 's'}</div><span>Sorted by last updated</span></div>
    {busy && !state.inbox.length ? <Skeleton rows={7}/> : !items.length ? <EmptyState icon={<GitPullRequest/>} title={state.inbox.length ? 'No pull requests match these filters' : 'Your review queue is clear'}><p>{state.inbox.length ? 'Broaden the search or reset one of the filters.' : 'ReviewArc found no open pull requests in the selected sources. Refresh after new work is opened.'}</p>{state.inbox.length > 0 && <button className="button secondary" onClick={resetFilters}>Reset filters</button>}</EmptyState> : <div className="pr-list" id="pull-request-results" aria-label="Pull request results">{visibleItems.map((pr) => <PullRequestRow key={`${repoName(pr)}#${pr.ref.number}`} pr={pr} busy={analysisBusy.has(analysisKey(pr))} error={analysisErrors[analysisKey(pr)]} onAnalyze={() => void startInboxAnalysis(pr)} onCancel={() => void cancelInboxAnalysis(pr)} onOpen={() => onOpen(pr)}/>)}{remainingItems > 0 && <div className="inbox-pagination"><span aria-live="polite">Showing {visibleItems.length} of {items.length}</span><button className="button secondary small" aria-controls="pull-request-results" aria-label={`Show ${Math.min(inboxPageSize, remainingItems)} more pull requests`} onClick={() => setVisibility({source: state.inbox, limit: visibleLimit + inboxPageSize})}>Show more</button></div>}</div>}
  </main>
}

function Select({label, value, onChange, options}: {label: string; value: string; onChange: (value: string) => void; options: string[][]}) { return <SelectControl label={label} value={value} onChange={onChange} icon={<Filter size={14}/>} options={options.map(([optionValue, optionLabel]) => ({value: optionValue, label: optionLabel}))}/> }
