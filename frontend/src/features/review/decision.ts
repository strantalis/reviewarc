import type { AnalysisCoverage, CheckRun, EvidenceReference, ReviewAnalysis, RiskLevel } from '../../types'

export type EvidencePosture = 'supported' | 'partial' | 'missing'
export type DecisionDisposition = 'unreviewed' | 'accepted' | 'concern' | 'needsEvidence'

export interface DecisionReview {
  disposition: DecisionDisposition
  note?: string
}

export type DecisionReviewMap = Record<string, DecisionReview>

export type ReviewGateStatus = 'clear' | 'waiting' | 'blocked' | 'unknown'

export interface ReviewGate {
  status: ReviewGateStatus
  checks: CheckRun[]
  passing: CheckRun[]
  waiting: CheckRun[]
  failing: CheckRun[]
}

export type ReviewRecommendation = 'ready' | 'hold' | 'inconclusive'

export interface AgentReviewObservation {
  id: string
  title: string
  detail: string
  evidence: EvidenceReference[]
  chapterId: string
}

export interface AgentReviewFinding {
  id: string
  title: string
  detail: string
  kind: 'risk' | 'unknown'
  evidence: EvidenceReference[]
  chapterId: string
  riskLevel?: RiskLevel
  observations: AgentReviewObservation[]
  groupingRationale?: string
}

export interface AgentReviewBrief {
  recommendation: ReviewRecommendation
  changes: string[]
  findings: AgentReviewFinding[]
  verified: string[]
  blindSpots: string[]
}

const PASSING_CHECK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const FAILING_CHECK_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure'])

function checkResult(check: CheckRun) {
  return (check.conclusion || check.status || '').toLowerCase()
}

export function reviewGate(checks: CheckRun[] = []): ReviewGate {
  if (!checks.length) return {status: 'unknown', checks, passing: [], waiting: [], failing: []}
  const passing = checks.filter((check) => PASSING_CHECK_CONCLUSIONS.has(checkResult(check)))
  const failing = checks.filter((check) => FAILING_CHECK_CONCLUSIONS.has(checkResult(check)))
  const waiting = checks.filter((check) => !passing.includes(check) && !failing.includes(check))
  return {status: failing.length ? 'blocked' : waiting.length ? 'waiting' : 'clear', checks, passing, waiting, failing}
}

function uniqueEvidence(evidence: EvidenceReference[]) {
  return evidence.filter((item, index, items) => items.findIndex((candidate) =>
    candidate.path === item.path && candidate.revision === item.revision && candidate.startLine === item.startLine && candidate.endLine === item.endLine,
  ) === index)
}

export function evidencePosture(evidence: EvidenceReference[]): EvidencePosture {
  if (!evidence.length) return 'missing'
  const valid = evidence.filter((item) => item.validationStatus === 'valid').length
  if (valid === evidence.length) return 'supported'
  return valid > 0 ? 'partial' : 'missing'
}

function riskRank(level?: RiskLevel) {
  return level === 'critical' ? 0 : level === 'high' ? 1 : level === 'medium' ? 2 : 3
}

function uniqueById<T extends {id: string}>(items: T[]) {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.id === item.id) === index)
}

function chapterForEvidence(analysis: ReviewAnalysis, evidence: EvidenceReference[]) {
  return analysis.chapters.find((chapter) => chapter.evidence.some((chapterEvidence) => evidence.some((item) => item.path === chapterEvidence.path)))
    ?? analysis.chapters.find((chapter) => chapter.risks.some((risk) => risk.evidence.some((riskEvidence) => evidence.some((item) => item.path === riskEvidence.path))))
    ?? analysis.chapters[0]
}

export function buildAgentReviewBrief(analysis: ReviewAnalysis, coverage?: AnalysisCoverage): AgentReviewBrief {
  const changes = uniqueById([
    ...analysis.behavioralChanges,
    ...analysis.chapters.flatMap((chapter) => chapter.behavioralChanges),
  ]).map((change) => change.summary).slice(0, 3)
  if (!changes.length) changes.push(...analysis.affectedAreas.map((area) => area.description || area.name).slice(0, 3))
  if (!changes.length && analysis.summary) changes.push(analysis.summary)

  const chapterByRisk = new Map(analysis.chapters.flatMap((chapter) => chapter.risks.map((risk) => [risk.id, chapter] as const)))
  const chapterByUnknown = new Map(analysis.chapters.flatMap((chapter) => chapter.unknowns.map((unknown) => [unknown.id, chapter] as const)))
  const risks = uniqueById([...analysis.risks, ...analysis.chapters.flatMap((chapter) => chapter.risks)])
  const supportedRisks = risks.filter((risk) => risk.evidence.some((item) => item.validationStatus === 'valid'))
  const unsupportedRisks = risks.filter((risk) => !risk.evidence.some((item) => item.validationStatus === 'valid'))
  const unknowns = uniqueById([...analysis.unknowns, ...analysis.chapters.flatMap((chapter) => chapter.unknowns)])
  const legacyFindings: AgentReviewFinding[] = [
    ...supportedRisks.map((risk) => {
      const chapter = chapterByRisk.get(risk.id) ?? analysis.chapters[0]
      const observation = {
        id: `risk:${risk.id}`,
        title: risk.title,
        detail: risk.description,
        evidence: uniqueEvidence(risk.evidence),
        chapterId: chapter?.id ?? '',
      }
      return {
        id: observation.id,
        title: observation.title,
        detail: observation.detail,
        evidence: observation.evidence,
        chapterId: observation.chapterId,
        kind: 'risk' as const,
        riskLevel: risk.level,
        observations: [observation],
      }
    }),
    ...unknowns.map((unknown) => {
      const chapter = chapterByUnknown.get(unknown.id) ?? analysis.chapters[0]
      const observation = {
        id: `unknown:${unknown.id}`,
        title: unknown.text,
        detail: unknown.validationMessage || 'The analysis could not establish this from the available repository evidence.',
        evidence: uniqueEvidence(unknown.evidence),
        chapterId: chapter?.id ?? '',
      }
      return {
        id: observation.id,
        title: observation.title,
        detail: observation.detail,
        evidence: observation.evidence,
        chapterId: observation.chapterId,
        kind: 'unknown' as const,
        observations: [observation],
      }
    }),
  ].sort((left, right) => {
    const leftRank = left.kind === 'risk' ? riskRank(left.riskLevel) : 4
    const rightRank = right.kind === 'risk' ? riskRank(right.riskLevel) : 4
    return leftRank - rightRank
  })
  const explicitJudgments: AgentReviewFinding[] = (analysis.judgments ?? []).map((judgment) => {
    const evidence = uniqueEvidence(judgment.observations.flatMap((observation) => observation.evidence))
    const chapter = chapterForEvidence(analysis, evidence)
    return {
      id: `judgment:${judgment.id}`,
      title: judgment.title,
      detail: judgment.description,
      kind: judgment.kind,
      evidence,
      chapterId: chapter?.id ?? '',
      riskLevel: judgment.kind === 'risk' ? judgment.level : undefined,
      observations: judgment.observations.map((observation) => ({
        id: `observation:${judgment.id}:${observation.id}`,
        title: observation.title,
        detail: observation.description,
        evidence: uniqueEvidence(observation.evidence),
        chapterId: chapterForEvidence(analysis, observation.evidence)?.id ?? chapter?.id ?? '',
      })),
      groupingRationale: judgment.groupingRationale || undefined,
    }
  }).sort((left, right) => {
    const leftRank = left.kind === 'risk' ? riskRank(left.riskLevel) : 4
    const rightRank = right.kind === 'risk' ? riskRank(right.riskLevel) : 4
    return leftRank - rightRank
  })
  const findings = explicitJudgments.length ? explicitJudgments : legacyFindings

  const evidence = uniqueEvidence([
    ...analysis.summaryEvidence,
    ...analysis.chapters.flatMap((chapter) => chapter.evidence),
  ])
  const validEvidence = evidence.filter((item) => item.validationStatus === 'valid').length
  const relatedTests = uniqueById(analysis.chapters.flatMap((chapter) => chapter.relatedTests))
  const verified: string[] = []
  if (analysis.summaryValidation === 'valid') verified.push('The change summary is linked to the analyzed revision.')
  if (validEvidence) verified.push(`${validEvidence} code reference${validEvidence === 1 ? '' : 's'} validated against pinned Git objects.`)
  if (coverage?.changedFilesTotal) verified.push(`${coverage.diffFilesFullyRead} of ${coverage.changedFilesTotal} changed file diffs read in full.`)
  if (relatedTests.length) verified.push(`${relatedTests.length} related test${relatedTests.length === 1 ? '' : 's'} connected to changed behavior.`)

  const blindSpots: string[] = []
  if (coverage?.diffFilesUnseen) blindSpots.push(`${coverage.diffFilesUnseen} changed file${coverage.diffFilesUnseen === 1 ? ' was' : 's were'} not inspected.`)
  if (coverage?.diffFilesPartiallyRead || coverage?.diffFilesPreviewed) {
    const previewed = coverage.diffFilesPreviewed ?? coverage.diffFilesPartiallyRead
    if (previewed) blindSpots.push(`${previewed} changed file${previewed === 1 ? ' was' : 's were'} triaged without reading the full diff.`)
  }
  if (analysis.validationIssues.length) blindSpots.push(`${analysis.validationIssues.length} generated claim${analysis.validationIssues.length === 1 ? '' : 's'} could not be validated.`)
  blindSpots.push(...unsupportedRisks.map((risk) => `The risk “${risk.title}” was not backed by a validated code reference.`))
  if (unknowns.length) blindSpots.push(`${unknowns.length} uncertainty item${unknowns.length === 1 ? ' remains' : 's remain'} unresolved.`)

  const hasHighRisk = findings.some((finding) => finding.kind === 'risk'
    && (finding.riskLevel === 'critical' || finding.riskLevel === 'high')
    && finding.evidence.some((item) => item.validationStatus === 'valid'))
  const recommendation: ReviewRecommendation = hasHighRisk ? 'hold' : blindSpots.length || findings.length ? 'inconclusive' : 'ready'
  return {recommendation, changes, findings, verified, blindSpots}
}

export function dispositionLabel(disposition: DecisionDisposition) {
  if (disposition === 'accepted') return 'Accepted as tradeoff'
  if (disposition === 'concern') return 'Concern'
  if (disposition === 'needsEvidence') return 'Not enough information'
  return 'Not reviewed'
}

export function evidencePostureLabel(posture: EvidencePosture) {
  if (posture === 'supported') return 'Code references validated'
  if (posture === 'partial') return 'Some code references validated'
  return 'No validated code reference'
}

export function findingPriorityLabel(finding: AgentReviewFinding) {
  if (finding.kind === 'unknown') return 'Unknown'
  const level = finding.riskLevel ?? 'unrated'
  return `${level.charAt(0).toUpperCase()}${level.slice(1)} risk`
}

export function findingEvidenceLabel(finding: AgentReviewFinding) {
  const valid = finding.evidence.filter((item) => item.validationStatus === 'valid').length
  if (!valid) return 'No validated reference'
  if (valid === finding.evidence.length) return `${valid} validated reference${valid === 1 ? '' : 's'}`
  return `${valid} of ${finding.evidence.length} references validated`
}

export function findingDecisionRequirement(finding: AgentReviewFinding) {
  if (finding.kind === 'unknown') return 'Investigate or accept with rationale'
  if (finding.riskLevel === 'critical' || finding.riskLevel === 'high') return 'Resolve or accept with rationale'
  return 'Review before approval'
}

export function findingRequiresRationale(finding: AgentReviewFinding) {
  return finding.kind === 'unknown' || finding.riskLevel === 'critical' || finding.riskLevel === 'high'
}

export function findingAcceptanceIsComplete(finding: AgentReviewFinding, review?: DecisionReview) {
  if (review?.disposition !== 'accepted') return false
  return !findingRequiresRationale(finding) || Boolean(review.note?.trim())
}
