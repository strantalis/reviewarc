import { useEffect, useState } from 'react'
import { ArchiveRestore, LoaderCircle, Trash2 } from 'lucide-react'
import { backend } from '../../bridge'
import { EmptyState, ErrorBanner, Skeleton } from '../../components'
import { errorText } from '../../errors'
import { repoName } from '../../lib'
import type { ReviewSession } from '../../types'

const retentionOptions = [
  {value: '7', label: '7 days'},
  {value: '30', label: '30 days'},
  {value: '90', label: '90 days'},
  {value: 'never', label: 'Never'},
]

function deletionLabel(archivedAt: string | undefined, retentionDays: number | null) {
  if (retentionDays === null) return 'Kept until you delete it'
  if (!archivedAt) return `Deleted ${retentionDays} days after archiving`
  const date = new Date(archivedAt)
  if (Number.isNaN(date.getTime())) return `Deleted ${retentionDays} days after archiving`
  date.setDate(date.getDate() + retentionDays)
  return `Deletes ${new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', year: 'numeric'}).format(date)}`
}

function archiveLabel(session: ReviewSession) {
  if (!session.archivedAt) return 'Archived review'
  const date = new Date(session.archivedAt)
  if (Number.isNaN(date.getTime())) return 'Archived review'
  return `Archived ${new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', year: 'numeric'}).format(date)}`
}

export function ArchiveRetentionSettings() {
  const [days, setDays] = useState<number | null>(30)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window.go?.main?.App?.GetArchiveRetentionDays !== 'function') { setLoading(false); return }
    void (async () => {
      try { setDays(await backend.getArchiveRetentionDays()) }
      catch (err) { setError(errorText(err)) }
      finally { setLoading(false) }
    })()
  }, [])

  const update = async (value: string) => {
    const next = value === 'never' ? null : Number(value)
    setBusy(true); setError('')
    try { await backend.setArchiveRetentionDays(next); setDays(next) }
    catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }

  return <section>
    <div className="settings-section-heading"><h2>Archived reviews</h2><p>Archived reviews stay restorable until their retention window expires.</p></div>
    <div className="settings-section-body archive-retention-settings">
      <label htmlFor="archive-retention-days">Delete archived reviews after</label>
      <select id="archive-retention-days" value={days === null ? 'never' : String(days)} disabled={loading || busy} onChange={(event) => void update(event.target.value)}>
        {retentionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <p>Temporary analysis files are removed as soon as a review is archived. Changing this only affects how long the saved review history remains.</p>
      {error && <ErrorBanner message={error} onRetry={() => setError('')} actionLabel="Dismiss"/>}
    </div>
  </section>
}

export function ArchivedReviewsScreen({onRestored}: {onRestored: () => void}) {
  const [sessions, setSessions] = useState<ReviewSession[]>([])
  const [retentionDays, setRetentionDays] = useState<number | null>(30)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [items, retention] = await Promise.all([backend.listArchivedSessions(), backend.getArchiveRetentionDays()])
      setSessions(items)
      setRetentionDays(retention)
    } catch (err) { setError(errorText(err)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const restore = async (id: string) => {
    setBusyId(id); setError('')
    try { await backend.restoreSession(id); setSessions((current) => current.filter((session) => session.id !== id)); onRestored() }
    catch (err) { setError(errorText(err)) }
    finally { setBusyId('') }
  }
  const remove = async (id: string) => {
    setBusyId(id); setError('')
    try { await backend.deleteArchivedSession(id); setSessions((current) => current.filter((session) => session.id !== id)) }
    catch (err) { setError(errorText(err)) }
    finally { setBusyId(''); setDeletingId('') }
  }

  return <main className="page archived-reviews-page">
    <div className="page-heading"><div><h1>Archived reviews</h1><p>Saved decisions, notes, drafts, and publication history. Temporary analysis files have already been removed.</p></div></div>
    {error && <ErrorBanner message={error} onRetry={() => void load()}/>} {loading ? <Skeleton rows={4}/> : !sessions.length ? <EmptyState icon={<ArchiveRestore/>} title="No archived reviews"><p>Archive a review whenever you want to remove it from the active inbox. You can restore it here until its retention window expires.</p></EmptyState> : <div className="archived-review-list" aria-label="Archived reviews">{sessions.map((session) => {
      const pr = session.pullRequest
      const busy = busyId === session.id
      return <article className="archived-review-row" key={session.id}>
        <div><span className="repo-label">{repoName(pr)} #{pr.ref.number}</span><strong>{pr.title}</strong><small>{archiveLabel(session)} · {deletionLabel(session.archivedAt, retentionDays)}</small></div>
        <div className="archived-review-actions"><button className="button secondary" disabled={Boolean(busyId)} onClick={() => void restore(session.id)}>{busy ? <LoaderCircle className="spin" size={15}/> : <ArchiveRestore size={15}/>}Restore</button>{deletingId === session.id ? <><span className="delete-confirmation">Delete saved analysis, notes, drafts, and history?</span><button className="button text danger" disabled={Boolean(busyId)} onClick={() => void remove(session.id)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Trash2 size={15}/>}Confirm delete</button><button className="button text" disabled={Boolean(busyId)} onClick={() => setDeletingId('')}>Cancel</button></> : <button className="button text danger" disabled={Boolean(busyId)} onClick={() => setDeletingId(session.id)}><Trash2 size={15}/>Delete now</button>}</div>
      </article>
    })}</div>}
  </main>
}
