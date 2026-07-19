import { useEffect, useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import { backend } from '../../bridge'
import type { RevisionDelta, RevisionDeltaFile } from '../../types'

const INITIAL_FILE_COUNT = 6

const shortSha = (sha: string) => sha.slice(0, 8)

function fileIsAnnotated(file: RevisionDeltaFile) {
  return (file.citedByFindings?.length ?? 0) > 0 || file.hasDraftComment
}

export function revisionDeltaSummary(delta: RevisionDelta): string {
  const commits = `${delta.commitCount} commit${delta.commitCount === 1 ? '' : 's'}`
  if (!delta.files.length) return `${commits} · no file content changed`
  const files = `${delta.files.length} file${delta.files.length === 1 ? '' : 's'} changed`
  const annotated = delta.files.filter(fileIsAnnotated).length
  if (!annotated) return `${commits} · ${files}`
  return `${commits} · ${files} · ${annotated} tied to your review`
}

export function StaleRevisionDelta({sessionId}: {sessionId: string}) {
  const [delta, setDelta] = useState<RevisionDelta>()
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let active = true
    setDelta(undefined)
    setExpanded(false)
    backend.getRevisionDelta(sessionId)
      .then((value) => { if (active) setDelta(value) })
      .catch(() => { if (active) setDelta(undefined) })
    return () => { active = false }
  }, [sessionId])
  if (!delta?.available) return null
  const visible = expanded ? delta.files : delta.files.slice(0, INITIAL_FILE_COUNT)
  const hidden = delta.files.length - visible.length
  return <section className="stale-delta" aria-labelledby="stale-delta-title">
    <header>
      <strong id="stale-delta-title">Since the revision you reviewed</strong>
      <code>{shortSha(delta.fromHeadSha)}…{shortSha(delta.toHeadSha)}</code>
      <span>{revisionDeltaSummary(delta)}</span>
    </header>
    {delta.baseChanged && <p className="stale-delta-caveat">The base branch also moved, so this list can include changes merged upstream.</p>}
    {delta.files.length === 0
      ? <p className="stale-delta-caveat">No file content changed between the two revisions; the branch was likely rebased. Reanalysis is still required before approval.</p>
      : <ul className="stale-delta-files">
        {visible.map((entry) => <li key={entry.file.path}>
          <code>{entry.file.previousPath ? `${entry.file.previousPath} → ` : ''}{entry.file.path}</code>
          {entry.file.isBinary
            ? <span className="stale-delta-stat">binary</span>
            : <span className="stale-delta-stat"><i className="additions">+{entry.file.additions}</i><i className="deletions">−{entry.file.deletions}</i></span>}
          {(entry.citedByFindings ?? []).slice(0, 2).map((title) => <span key={title} className="stale-delta-chip" title={`Cited by the finding “${title}”`}>Cited: {title}</span>)}
          {entry.hasDraftComment && <span className="stale-delta-chip draft">Your draft</span>}
        </li>)}
      </ul>}
    {hidden > 0 && <button className="button text small" onClick={() => setExpanded(true)}>Show {hidden} more file{hidden === 1 ? '' : 's'}</button>}
    {delta.commits.length > 0 && <details className="stale-delta-commits">
      <summary><GitCommitHorizontal size={13} aria-hidden="true"/>{delta.commitCount} new commit{delta.commitCount === 1 ? '' : 's'}{delta.commitCount > delta.commits.length ? ` (showing ${delta.commits.length})` : ''}</summary>
      <ul>{delta.commits.map((commit) => <li key={commit.sha}><code>{shortSha(commit.sha)}</code><span>{commit.message}</span><small>{commit.author.name}</small></li>)}</ul>
    </details>}
  </section>
}
