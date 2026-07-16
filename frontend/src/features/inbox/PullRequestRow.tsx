import { useId, useState } from 'react'
import { BookOpen, ChevronRight, ExternalLink, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react'
import { backend } from '../../bridge'
import { AnalysisBadge, RiskBadge } from '../../components'
import { analysisLabel, normalizeProgress, primaryRelationship, relationshipLabel, relativeTime, repoName } from '../../lib'
import type { PullRequestSummary } from '../../types'

export function PullRequestRow({pr, busy, error, onAnalyze, onCancel, onOpen}: {pr: PullRequestSummary; busy: boolean; error?: string; onAnalyze: () => void; onCancel: () => void; onOpen: () => void}) {
  const progress = normalizeProgress(pr.progress)
  const relationship = primaryRelationship(pr.relationships ?? [])
  const action = pr.analysisStatus === 'notStarted'
    ? {label: 'Analyze', help: 'Analyze pull request', icon: Sparkles, onClick: onAnalyze, kind: 'analyze'}
    : pr.analysisStatus === 'stale'
      ? {label: 'Reanalyze', help: 'Reanalyze latest revision', icon: RefreshCw, onClick: onAnalyze, kind: 'analyze'}
      : pr.analysisStatus === 'failed'
        ? {label: 'Retry', help: 'Retry analysis', icon: RefreshCw, onClick: onAnalyze, kind: 'analyze'}
        : pr.analysisStatus === 'queued'
          ? {label: 'Cancel', help: 'Cancel queued analysis', icon: X, onClick: onCancel, kind: 'cancel'}
          : pr.analysisStatus === 'running'
            ? {label: 'Cancel', help: 'Cancel analysis', icon: X, onClick: onCancel, kind: 'cancel'}
            : {label: 'Open review', help: 'Open review', icon: BookOpen, onClick: onOpen, kind: 'open'}
  return <div className="pr-row"><button className="pr-row-open" onClick={onOpen}><div className="pr-relation"><span className={`relation-mark ${relationship}`}/><div><span>{relationshipLabel(relationship)}</span><strong>{repoName(pr)}</strong></div></div><div className="pr-main"><div className="pr-title"><span>#{pr.ref.number}</span><strong>{pr.title}</strong>{pr.isDraft && <span className="badge neutral">Draft</span>}</div><div className="pr-meta"><span>by @{pr.author.login}</span><span>updated {relativeTime(pr.updatedAt)}</span><span>{pr.changedFiles} files</span><span className="additions">+{pr.additions}</span><span className="deletions">−{pr.deletions}</span>{pr.labels.slice(0, 2).map((item) => <span className="pr-label" key={item}>{item}</span>)}{pr.labels.length > 2 && <span className="pr-label-more">+{pr.labels.length - 2}</span>}</div></div><div className="pr-state"><div><AnalysisBadge status={pr.analysisStatus}/>{pr.analysisStatus === 'ready' && <RiskBadge level={pr.riskLevel}/>}</div>{progress.total > 0 ? <div className="progress-inline"><span><i style={{width: `${progress.percent}%`}}/></span><small>{progress.reviewed}/{progress.total} reviewed</small></div> : <small>{analysisLabel(pr.analysisStatus)}</small>}</div><span className="pr-action-space" aria-hidden="true"/><span className="pr-external-space" aria-hidden="true"/><ChevronRight size={18}/></button><RowActionButton action={action} busy={busy} error={error} pullRequest={pr}/>{pr.url && <button className="pr-external" aria-label={`Open ${repoName(pr)} pull request #${pr.ref.number} on GitHub`} title="Open on GitHub" onClick={() => backend.openGitHubURL(pr.url)}><ExternalLink size={15}/></button>}</div>
}
function RowActionButton({action, busy, error, pullRequest}: {action: {label: string; help: string; icon: typeof Sparkles; onClick: () => void; kind: string}; busy: boolean; error?: string; pullRequest: PullRequestSummary}) {
  const tooltipId = useId()
  const [tooltip, setTooltip] = useState(false)
  const Icon = action.icon
  const help = error || action.help
  const label = action.label === 'Open review' ? `${action.label} for ${repoName(pullRequest)} pull request #${pullRequest.ref.number}` : `${action.label} ${repoName(pullRequest)} pull request #${pullRequest.ref.number}`
  return <><button className={`pr-analysis-action ${action.kind}`} disabled={busy} aria-label={label} aria-describedby={tooltip ? tooltipId : undefined} onClick={action.onClick} onMouseEnter={() => setTooltip(true)} onMouseLeave={() => setTooltip(false)} onFocus={() => setTooltip(true)} onBlur={() => setTooltip(false)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Icon size={15}/>}</button>{tooltip && <span id={tooltipId} className={`row-action-tooltip${error ? ' error' : ''}`} role="tooltip">{help}</span>}</>
}
