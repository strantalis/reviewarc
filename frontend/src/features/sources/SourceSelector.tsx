import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { backend } from '../../bridge'
import { ErrorBanner } from '../../components'
import { errorText } from '../../errors'
import type { BootstrapState, Organization, RepositoryPage, SourceSelection, SourceState } from '../../types'

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
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
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
    if (organization === 'included') return undefined
    if (!search) {
      if (previousSearch.current) {
        previousSearch.current = ''
        searchRequest.current++
        setOwnerPage(browsePage)
        setOwnerBusy(false)
      }
      return undefined
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
  }, [browsePage, query, organization, selectedOrganization])
  const save = async () => {
    setBusy(true); setError('')
    const selections: SourceSelection[] = [...selected].map((entry) => { const [kind, ...parts] = entry.split(':'); return {kind: kind as SourceSelection['kind'], key: parts.join(':'), enabled: true} })
    try { await backend.saveSelections(selections); await onDone() } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  const repositories = organization === 'included' ? catalog?.repositories ?? [] : ownerPage?.items ?? []
  const personalLogin = state.account?.login ?? ''
  const personalCount = ownerCounts[personalLogin.toLowerCase()]
  const personalSelected = personalLogin !== '' && organization.toLowerCase() === personalLogin.toLowerCase()
  const filterOrganization = (org: Organization, blocked: boolean) => {
    if (!blocked) { void loadOwner(org.login); return }
    ownerRequest.current++
    searchRequest.current++
    setOrganization(org.login)
    setOwnerPage({items: [], totalCount: 0, hasNextPage: false, cached: false})
    setBrowsePage(undefined)
  }
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
  return <main className="page source-page"><div className="page-heading"><div><h1>Repository sources</h1><p>Choose where ReviewArc should look for open pull requests. Repositories are only fetched when you open a PR.</p></div><button className="button primary" disabled={busy || selected.size === 0} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Save sources</button></div>
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
            return <OrganizationSourceRow key={key} org={org} count={ownerCounts[org.login.toLowerCase()]} active={organization.toLowerCase() === org.login.toLowerCase()} checked={selected.has(key)} onFilter={() => filterOrganization(org, blocked)} onToggle={() => toggle(key)}/>
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
