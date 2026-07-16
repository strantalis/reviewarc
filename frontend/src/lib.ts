import type { AnalysisStatus, ChapterStatus, PullRequestSummary, Relationship, ReviewProgress, RiskLevel } from './types'

export function repoName(pr: PullRequestSummary) { return `${pr.ref.repository.owner}/${pr.ref.repository.name}` }

export function relativeTime(value: string, now = Date.now()): string {
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return 'Unknown update time'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(new Date(value))
}

export function chapterStatusLabel(value: ChapterStatus) {
  return ({notReviewed: 'Not reviewed', inProgress: 'In progress', reviewed: 'Reviewed', needsClarification: 'Needs clarification', blocked: 'Blocked'} satisfies Record<ChapterStatus, string>)[value]
}

export function analysisLabel(value: AnalysisStatus) {
  return ({notStarted: 'Not analyzed', queued: 'Queued', running: 'Analyzing', ready: 'Walkthrough ready', failed: 'Analysis failed', stale: 'Analysis stale'} satisfies Record<AnalysisStatus, string>)[value]
}

export function riskLabel(value: RiskLevel) { return value === 'unknown' ? 'Risk pending' : `${value[0].toUpperCase()}${value.slice(1)} risk` }

export function relationshipLabel(value: Relationship) {
  return ({reviewRequested: 'Needs your review', assigned: 'Assigned to you', authored: 'Authored by you', selectedRepo: 'Selected repository'} satisfies Record<Relationship, string>)[value]
}

export function primaryRelationship(relationships: Relationship[]): Relationship {
  return (['reviewRequested', 'assigned', 'authored', 'selectedRepo'] as const).find((relationship) => relationships.includes(relationship)) ?? 'selectedRepo'
}

export function normalizeProgress(progress?: Partial<ReviewProgress>): ReviewProgress {
  const total = progress?.total ?? 0
  const reviewed = progress?.reviewed ?? 0
  return {total, reviewed, blocked: progress?.blocked ?? 0, clarify: progress?.clarify ?? 0, percent: progress?.percent ?? (total ? Math.round(reviewed / total * 100) : 0)}
}

export function filterInbox(items: PullRequestSummary[], query: string, relationship: Relationship | 'all', repository: string, label: string, analysis: AnalysisStatus | 'all') {
  const normalized = query.trim().toLowerCase()
  return items.filter((pr) => {
    const haystack = `${repoName(pr)} ${pr.title} ${pr.author.login} ${pr.ref.number} ${pr.labels.join(' ')}`.toLowerCase()
    return (!normalized || haystack.includes(normalized)) &&
      (relationship === 'all' || pr.relationships.includes(relationship)) &&
      (repository === 'all' || repoName(pr) === repository) &&
      (label === 'all' || pr.labels.some((item) => item.localeCompare(label, undefined, {sensitivity: 'accent'}) === 0)) &&
      (analysis === 'all' || pr.analysisStatus === analysis)
  })
}
