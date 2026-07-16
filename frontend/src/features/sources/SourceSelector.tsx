import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Globe2, ListChecks, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { backend } from '../../bridge'
import { ErrorBanner } from '../../components'
import { errorText } from '../../errors'
import type { BootstrapState, Organization, RepositoryPage, SourceSelection, SourceState } from '../../types'

const accessibleScope = 'accessible'
const includedScope = 'included'

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
  const [scope, setScope] = useState(accessibleScope)
  const [page, setPage] = useState<RepositoryPage>()
  const [browsePage, setBrowsePage] = useState<RepositoryPage>()
  const [ownerCounts, setOwnerCounts] = useState<Record<string, number>>({})
  const [sync, setSync] = useState({running: false, processed: 0, total: 0})
  const [busy, setBusy] = useState(false)
  const [accessBusy, setAccessBusy] = useState(false)
  const [pageBusy, setPageBusy] = useState(true)
  const [error, setError] = useState('')
  const ownerRequest = useRef(0)
  const searchRequest = useRef(0)
  const syncRequest = useRef(0)
  const searchMounted = useRef(false)
  const previousSearch = useRef('')
  const queryRef = useRef('')
  const scopeRef = useRef(accessibleScope)
  queryRef.current = query
  scopeRef.current = scope
  const selectedOrganization = catalog?.organizations.find((org) => org.login.toLowerCase() === scope.toLowerCase())

  const loadAccessible = async (search: string, offset = 0, append = false) => {
    const request = ++searchRequest.current
    if (!append) setPageBusy(true)
    try {
      const next = await backend.listAccessibleRepositories(state.account?.login ?? '', search, offset)
      if (searchRequest.current === request && scopeRef.current === accessibleScope) {
        setPage((current) => append && current ? {...next, items: [...current.items, ...next.items]} : next)
      }
      return next
    } finally {
      if (searchRequest.current === request && scopeRef.current === accessibleScope) setPageBusy(false)
    }
  }
  const refreshAccessible = async () => {
    const request = ++syncRequest.current
    let syncId = ''
    let cursor = ''
    let processed = 0
    setSync({running: true, processed: 0, total: page?.totalCount ?? 0})
    try {
      do {
        const next = await backend.refreshAccessibleRepositories(state.account?.login ?? '', syncId, cursor)
        if (syncRequest.current !== request) return
        syncId = next.syncId
        cursor = next.endCursor ?? ''
        processed += next.processed
        setSync({running: next.hasNextPage, processed, total: next.totalCount})
        const pageNumber = Math.ceil(processed / 100)
        if (scopeRef.current === accessibleScope && (pageNumber === 1 || pageNumber % 5 === 0 || !next.hasNextPage)) await loadAccessible(queryRef.current)
        if (!next.hasNextPage) break
      } while (syncRequest.current === request)
    } catch (err) {
      if (syncRequest.current === request) setError(errorText(err))
    } finally {
      if (syncRequest.current === request) setSync((current) => ({...current, running: false}))
    }
  }
  const refreshOrganizationAccess = async (organizations = catalog?.organizations ?? []) => {
    const checked = await backend.refreshSourceAccess(organizations)
    setCatalog((current) => current ? {...current, organizations: checked} : current)
  }
  const refreshAccess = async () => {
    setAccessBusy(true); setError('')
    try {
      await refreshOrganizationAccess()
      await refreshAccessible()
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
      void refreshOrganizationAccess(next.organizations).catch((err) => setError(errorText(err)))
      void refreshSelectedRepositories()
    } catch (err) { setError(errorText(err)) }
  }
  useEffect(() => {
    void loadCatalog()
    const initializeAccessible = async () => {
      try {
        const initial = await loadAccessible('')
        if (initial.refreshRequired) await refreshAccessible()
      } catch (err) { setPageBusy(false); setError(errorText(err)) }
    }
    void initializeAccessible()
    // The catalog refresh intentionally continues if the user leaves this screen.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const selectStaticScope = (nextScope: string) => {
    ownerRequest.current++; searchRequest.current++; previousSearch.current = ''
    setScope(nextScope); setQuery(''); setBrowsePage(undefined); setError('')
    if (nextScope === accessibleScope) {
      setPageBusy(true)
      void loadAccessible('').catch((err) => { setPageBusy(false); setError(errorText(err)) })
    } else {
      setPage(undefined); setPageBusy(false)
    }
  }
  const loadOwner = async (owner: string) => {
    const request = ++ownerRequest.current
    searchRequest.current++
    previousSearch.current = ''
    const activeSearch = searchRequest.current
    setScope(owner); setQuery(''); setPageBusy(true); setError(''); setPage(undefined); setBrowsePage(undefined)
    try {
      const cached = await backend.listCachedOwnerRepositories(owner)
      if (ownerRequest.current === request && cached.items.length) {
        setBrowsePage(cached)
        if (searchRequest.current === activeSearch) setPage(cached)
      }
      const fresh = await backend.refreshOwnerRepositories(owner)
      if (ownerRequest.current === request) {
        setBrowsePage(fresh)
        if (searchRequest.current === activeSearch) setPage(fresh)
        setOwnerCounts((counts) => ({...counts, [owner.toLowerCase()]: fresh.totalCount}))
      }
    } catch (err) { if (ownerRequest.current === request && searchRequest.current === activeSearch) setError(errorText(err)) } finally { if (ownerRequest.current === request && searchRequest.current === activeSearch) setPageBusy(false) }
  }
  const loadMore = async () => {
    if (!page?.hasNextPage || pageBusy) return
    if (scope === accessibleScope) {
      setPageBusy(true); setError('')
      try { await loadAccessible(query.trim(), page.items.length, true) } catch (err) { setError(errorText(err)); setPageBusy(false) }
      return
    }
    if (!page.endCursor) return
    const request = ownerRequest.current
    const activeSearch = searchRequest.current
    setPageBusy(true); setError('')
    try {
      const search = query.trim()
      const next = search ? await backend.searchOwnerRepositories(scope, search, page.endCursor, selectedOrganization !== undefined) : await backend.refreshOwnerRepositories(scope, page.endCursor)
      if (ownerRequest.current === request && searchRequest.current === activeSearch) {
        const items = new Map(page.items.map((repo) => [`${repo.ref.owner}/${repo.ref.name}`.toLowerCase(), repo]))
        for (const repo of next.items) items.set(`${repo.ref.owner}/${repo.ref.name}`.toLowerCase(), repo)
        const merged = {...next, items: [...items.values()]}
        setPage(merged)
        if (!search) setBrowsePage(merged)
        setOwnerCounts((counts) => ({...counts, [scope.toLowerCase()]: next.totalCount}))
      }
    } catch (err) { if (ownerRequest.current === request && searchRequest.current === activeSearch) setError(errorText(err)) } finally { if (ownerRequest.current === request && searchRequest.current === activeSearch) setPageBusy(false) }
  }
  useEffect(() => {
    const search = query.trim()
    if (scope === includedScope) return undefined
    if (scope === accessibleScope) {
      if (!searchMounted.current) {
        searchMounted.current = true
        return undefined
      }
      const request = ++searchRequest.current
      const timer = window.setTimeout(async () => {
        setPageBusy(true); setError('')
        try {
          const next = await backend.listAccessibleRepositories(state.account?.login ?? '', search)
          if (searchRequest.current === request && scopeRef.current === accessibleScope) setPage(next)
        } catch (err) {
          if (searchRequest.current === request) setError(errorText(err))
        } finally {
          if (searchRequest.current === request && scopeRef.current === accessibleScope) setPageBusy(false)
        }
      }, 150)
      return () => window.clearTimeout(timer)
    }
    if (!search) {
      if (previousSearch.current) {
        previousSearch.current = ''
        searchRequest.current++
        setPage(browsePage)
        setPageBusy(false)
      }
      return undefined
    }
    previousSearch.current = search
    const request = ++searchRequest.current
    const ownerVersion = ownerRequest.current
    const owner = scope
    const organizationSearch = selectedOrganization !== undefined
    const timer = window.setTimeout(async () => {
      setPageBusy(true); setError('')
      try {
        const next = await backend.searchOwnerRepositories(owner, search, '', organizationSearch)
        if (ownerRequest.current === ownerVersion && searchRequest.current === request) setPage(next)
      } catch (err) {
        if (ownerRequest.current === ownerVersion && searchRequest.current === request) setError(errorText(err))
      } finally {
        if (ownerRequest.current === ownerVersion && searchRequest.current === request) setPageBusy(false)
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [browsePage, query, scope, selectedOrganization, state.account?.login])
  const save = async () => {
    setBusy(true); setError('')
    const selections: SourceSelection[] = [...selected].map((entry) => { const [kind, ...parts] = entry.split(':'); return {kind: kind as SourceSelection['kind'], key: parts.join(':'), enabled: true} })
    let saved = false
    try { await backend.saveSelections(selections); saved = true; await onDone() } catch (err) { setError(saved ? `Sources were saved, but the inbox could not be refreshed: ${errorText(err)}` : errorText(err)); setBusy(false) }
  }

  const personalLogin = state.account?.login ?? ''
  const personalCount = ownerCounts[personalLogin.toLowerCase()]
  const personalSelected = personalLogin !== '' && scope.toLowerCase() === personalLogin.toLowerCase()
  const filterOrganization = (org: Organization, blocked: boolean) => {
    if (!blocked) { void loadOwner(org.login); return }
    ownerRequest.current++; searchRequest.current++
    setScope(org.login); setPage({items: [], totalCount: 0, hasNextPage: false, cached: false}); setBrowsePage(undefined); setPageBusy(false)
  }
  useEffect(() => {
    if (selectedOrganization?.accessStatus === 'ssoRequired' || selectedOrganization?.accessStatus === 'denied') {
      ownerRequest.current++; searchRequest.current++
      setPage({items: [], totalCount: 0, hasNextPage: false, cached: false}); setBrowsePage(undefined); setPageBusy(false)
    }
  }, [selectedOrganization?.accessStatus, scope])
  const repositories = scope === includedScope ? catalog?.repositories ?? [] : page?.items ?? []
  const repos = scope === includedScope ? repositories : repositories.filter((repo) => !repo.isArchived)
  const selectedOrganizations = [...selected].filter((key) => key.startsWith('organization:')).map((key) => key.slice('organization:'.length)).sort()
  const selectedRepositoryKeys = [...selected].filter((key) => key.startsWith('repository:')).map((key) => key.slice('repository:'.length)).sort()
  const includedRepositories = selectedRepositoryKeys.filter((name) => {
    const repository = catalog?.repositories.find((repo) => `${repo.ref.owner}/${repo.ref.name}`.toLowerCase() === name.toLowerCase())
    return `${name} ${repository?.description ?? ''}`.toLowerCase().includes(query.toLowerCase())
  })
  const placeholder = scope === accessibleScope ? 'Search repositories you can access' : scope === includedScope ? 'Search included repositories' : `Search ${scope} repositories`
  const heading = scope === accessibleScope ? 'All accessible repositories' : scope === includedScope ? 'Included sources' : personalSelected ? 'Personal repositories' : `${scope} repositories`
  const shownCount = scope === includedScope ? selected.size : page?.totalCount ?? '—'
  const blockedOrganizations = catalog?.organizations.filter((org) => org.accessStatus === 'ssoRequired' || org.accessStatus === 'denied') ?? []

  return <main className="page source-page"><div className="page-heading"><div><h1>Repository sources</h1><p>Choose where ReviewArc should look for open pull requests. Repositories are only fetched when you open a PR.</p></div><button className="button primary" disabled={busy || selected.size === 0} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Save sources</button></div>
    {error && <ErrorBanner message={error}/>}<div className="source-toolbar"><label className="search-field"><Search size={16}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder}/></label><button className="button secondary small" disabled={accessBusy || sync.running} onClick={() => void refreshAccess()}>{accessBusy || sync.running ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}Refresh access</button><span>{selected.size} {selected.size === 1 ? 'source' : 'sources'} included</span></div>
    <div className="source-layout">
      <aside>
        <div className="source-section-heading"><h2>Repository scope</h2></div>
        <div className="source-scope-choices">
          <button className={`source-scope-row${scope === accessibleScope ? ' active' : ''}`} aria-pressed={scope === accessibleScope} onClick={() => selectStaticScope(accessibleScope)}><span><Globe2 size={15}/></span><span><b>All accessible</b><small>Owned, collaborator, and organization repositories</small></span>{page && scope === accessibleScope ? <em>{page.totalCount}</em> : null}</button>
          <button className={`source-scope-row${scope === includedScope ? ' active' : ''}`} aria-pressed={scope === includedScope} onClick={() => selectStaticScope(includedScope)}><span><ListChecks size={15}/></span><span><b>Included sources</b><small>Your current inbox scope</small></span><em>{selected.size}</em></button>
        </div>
        <div className="source-section-heading source-owner-heading"><h2>Repository owners</h2></div>
        <div className="organization-choices">
          {personalLogin && <><p className="source-group-label">Personal account</p><div className={`source-org-row personal${personalSelected ? ' active' : ''}`}><button className="org-focus" aria-label={`Show personal repositories from ${personalLogin}`} aria-pressed={personalSelected} onClick={() => void loadOwner(personalLogin)}>{state.account?.avatarUrl ? <img src={state.account.avatarUrl} alt=""/> : <span className="org-avatar">{personalLogin.slice(0, 1).toUpperCase()}</span>}<span><b>{personalLogin}</b><small>{personalCount === undefined ? 'Open to load repositories' : `${personalCount} personal ${personalCount === 1 ? 'repository' : 'repositories'}`}</small></span></button></div></>}
          <p className="source-group-label">Organizations</p>
          {catalog?.organizations.map((org) => {
            const key = `organization:${org.login}`
            const blocked = org.accessStatus === 'ssoRequired' || org.accessStatus === 'denied'
            return <OrganizationSourceRow key={key} org={org} count={ownerCounts[org.login.toLowerCase()]} active={scope.toLowerCase() === org.login.toLowerCase()} checked={selected.has(key)} onFilter={() => filterOrganization(org, blocked)} onToggle={() => toggle(key)}/>
          })}
          {!catalog && <div className="owner-loading"><LoaderCircle className="spin" size={13}/>Loading owners…</div>}
        </div>
      </aside>
      <section>
        <div className="source-section-heading"><h2>{heading}</h2><span>{shownCount}</span></div>
        {scope === accessibleScope && blockedOrganizations.length > 0 && <div className="warning-banner source-coverage-warning" role="status"><ShieldCheck size={16}/><div><strong>Some organization repositories are not searchable</strong><p>{blockedOrganizations.map((org) => org.login).join(', ')} {blockedOrganizations.length === 1 ? 'requires' : 'require'} authorization or restored access. Use the organization controls, then refresh access.</p></div></div>}
        {scope === accessibleScope && sync.running && <div className="source-sync-status" role="status"><LoaderCircle className="spin" size={13}/><span>Refreshing repository access</span><small>{sync.total ? `${Math.min(sync.processed, sync.total)} of ${sync.total}` : `${sync.processed} indexed`}</small></div>}
        <div className="repository-choices">
          {scope === includedScope && selectedOrganizations.map((owner) => <div className="source-rule" key={`included:${owner}`}><span className="included-mark"><Check size={13}/></span><span className="source-rule-copy"><strong>{owner}</strong><small>Every active repository in this organization</small></span><button className="button text small" aria-label={`Remove ${owner} organization from included sources`} onClick={() => toggle(`organization:${owner}`)}>Remove</button></div>)}
          {scope === includedScope ? includedRepositories.map((name) => {
            const repository = catalog?.repositories.find((repo) => `${repo.ref.owner}/${repo.ref.name}`.toLowerCase() === name.toLowerCase())
            return <div className="source-rule" key={`included:${name}`}><span className="included-mark"><Check size={13}/></span><span className="source-rule-copy"><strong>{name}</strong><small>{repository?.description || 'Repository'}</small></span><button className="button text small" aria-label={`Remove ${name} repository from included sources`} onClick={() => toggle(`repository:${name}`)}>Remove</button></div>
          }) : repos.map((repo) => {
            const name = `${repo.ref.owner}/${repo.ref.name}`
            const key = `repository:${name}`
            const inherited = selected.has(`organization:${repo.ref.owner}`)
            return <label className={`repo-choice${inherited ? ' inherited' : ''}`} key={key}><input type="checkbox" aria-label={`Include ${name}`} checked={inherited || selected.has(key)} disabled={inherited} onChange={() => toggle(key)}/><span className="check-box"><Check size={13}/></span><span><strong>{name}</strong><small>{inherited ? `Included through ${repo.ref.owner}` : repo.description || (repo.isPrivate ? 'Private repository' : 'GitHub repository')}</small></span>{repo.isPrivate && <span className="privacy">Private</span>}</label>
          })}
          {pageBusy && !repos.length && scope !== includedScope && <div className="owner-page-loading"><LoaderCircle className="spin" size={17}/><p>{query.trim() ? 'Searching repositories…' : scope === accessibleScope ? 'Loading repositories you can access…' : 'Loading the first 50 active repositories…'}</p></div>}
          {!pageBusy && !repos.length && scope !== includedScope && <div className="source-empty">{selectedOrganization?.accessStatus === 'ssoRequired' ? <ShieldCheck size={18}/> : <Search size={18}/>}<p>{selectedOrganization?.accessStatus === 'ssoRequired' ? `Authorize SSO for ${selectedOrganization.login}, then refresh access to load its repositories.` : selectedOrganization?.accessStatus === 'denied' ? `GitHub denied access to ${selectedOrganization.login}.` : query.trim() ? 'No repositories match this search.' : scope === accessibleScope ? 'No repositories are available through this GitHub account.' : 'No active repositories are available for this owner.'}</p></div>}
          {scope === includedScope && !selected.size && <div className="source-empty"><Search size={18}/><p>Select a repository or include an organization to build your review inbox.</p></div>}
        </div>
        {page && scope !== includedScope && <div className="source-pagination"><span>{query.trim() ? `Showing ${page.items.length} of ${page.totalCount} matching repositories` : scope === accessibleScope ? `Showing ${page.items.length} of ${page.totalCount} accessible repositories` : `Showing ${page.items.length} of ${page.totalCount}`}</span>{page.hasNextPage && <button className="button secondary small" disabled={pageBusy} onClick={() => void loadMore()}>{pageBusy ? <LoaderCircle className="spin" size={14}/> : null}Load 50 more</button>}</div>}
      </section>
    </div>
  </main>
}
