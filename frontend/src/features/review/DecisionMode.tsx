import { useEffect, useId, useState } from 'react'
import { AlertTriangle, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Code2, ExternalLink, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react'
import type { CheckRun, EvidenceReference, PullRequestReview, PullRequestReviewComment } from '../../types'
import {
  evidencePosture, evidencePostureLabel, findingDecisionRequirement, findingEvidenceLabel, findingPriorityLabel, findingRequiresRationale,
  type AgentReviewBrief as AgentReviewBriefModel, type AgentReviewFinding,
  type DecisionReview, type ReviewGate,
} from './decision'

const emptyReview: DecisionReview = {disposition: 'unreviewed'}

function recommendationCopy(recommendation: AgentReviewBriefModel['recommendation']) {
  if (recommendation === 'ready') return {label: 'Ready for human approval', detail: 'The agent found no decision-critical blockers in the analyzed change.'}
  if (recommendation === 'hold') return {label: 'Hold', detail: 'The agent found a consequential risk that should be resolved or explicitly accepted.'}
  return {label: 'Insufficient evidence', detail: 'The agent completed its review, but important uncertainty remains.'}
}

export function ReviewGatePanel({gate, refreshing = false, onRefresh, onOpenCheck}: {gate: ReviewGate; refreshing?: boolean; onRefresh: () => void; onOpenCheck: (check: CheckRun) => void}) {
  const blocked = gate.status === 'blocked'
  const checks = blocked ? gate.failing : gate.waiting
  return <section className={`review-gate state-${gate.status}`} aria-labelledby="review-gate-title">
    <header><span className="review-gate-icon">{blocked ? <AlertTriangle size={22}/> : <RefreshCw className={refreshing ? 'spin' : ''} size={22}/>}</span><div><span className="review-gate-label">Review gate</span><h2 id="review-gate-title">{blocked ? 'Review paused — CI is failing' : 'Waiting for CI before deep review'}</h2><p>{blocked ? 'ReviewArc stopped before spending agent or reviewer attention. Open the failed check to determine whether the code or its infrastructure needs a rerun.' : 'ReviewArc will refresh the current checks and make the review available once they finish successfully.'}</p></div></header>
    <div className="review-gate-status"><div><strong>{gate.passing.length}/{gate.checks.length}</strong><span>checks passing</span></div><div><strong>{checks.length}</strong><span>{blocked ? 'failing' : 'not complete'}</span></div></div>
    {checks.length > 0 && <div className="review-gate-checks">{checks.slice(0, 4).map((check) => <div key={check.id}><span><strong>{check.name}</strong><small>{check.conclusion || check.status}{check.appName ? ` · ${check.appName}` : ''}</small></span>{(check.detailsUrl || check.url) && <button className="button text small" onClick={() => onOpenCheck(check)}>Open check<ExternalLink size={12}/></button>}</div>)}</div>}
    <footer><span>{blocked ? 'Resolve or rerun the failing checks, then refresh.' : 'You can leave this page; no review judgment is needed yet.'}</span><button className="button secondary" disabled={refreshing} onClick={onRefresh}>{refreshing ? <RefreshCw className="spin" size={14}/> : <RefreshCw size={14}/>}Refresh checks</button></footer>
  </section>
}

function FindingRow({finding, onInspect}: {finding: AgentReviewFinding; onInspect: (finding: AgentReviewFinding) => void}) {
  const priority = findingPriorityLabel(finding)
  return <li className={`agent-finding ${finding.kind} risk-${finding.riskLevel ?? 'unrated'}`}>
    <span className="agent-finding-icon" aria-hidden="true">{finding.kind === 'unknown' ? <CircleHelp size={15}/> : <AlertTriangle size={15}/>}</span>
    <div className="agent-finding-copy">
      <div className="agent-finding-meta"><span className="agent-finding-priority">{priority}</span>{finding.observations.length > 1 && <span>{finding.observations.length} observations</span>}<span>{findingEvidenceLabel(finding)}</span></div>
      <strong>{finding.title}</strong>
      <small>{finding.detail}</small>
      <span className="agent-finding-requirement">{findingDecisionRequirement(finding)}</span>
    </div>
    <button className="button text small" aria-label={`Open judgment: ${finding.title}`} onClick={() => onInspect(finding)}>Inspect<ChevronRight size={13}/></button>
  </li>
}

export function AgentReviewBrief({brief, stale = false, disabled = false, onInspect, onOpenReview}: {brief: AgentReviewBriefModel; stale?: boolean; disabled?: boolean; onInspect: (finding: AgentReviewFinding) => void; onOpenReview: () => void}) {
  const recommendation = recommendationCopy(brief.recommendation)
  const findingListId = useId()
  const findingSetKey = brief.findings.map((finding) => finding.id).join('\u0000')
  const [expandedFindingSet, setExpandedFindingSet] = useState('')
  const allFindingsVisible = expandedFindingSet === findingSetKey
  const initialFindingCount = 3
  const hiddenFindings = brief.findings.slice(initialFindingCount)
  const hiddenHighRiskFindings = hiddenFindings.filter((finding) => finding.kind === 'risk' && (finding.riskLevel === 'critical' || finding.riskLevel === 'high')).length
  const visibleFindings = allFindingsVisible ? brief.findings : brief.findings.slice(0, initialFindingCount)
  const disclosureLabel = hiddenHighRiskFindings
    ? `Show ${hiddenFindings.length} more · ${hiddenHighRiskFindings} high risk`
    : `Show ${hiddenFindings.length} more judgment${hiddenFindings.length === 1 ? '' : 's'}`
  const disclosureText = hiddenHighRiskFindings
    ? `${hiddenFindings.length} more · ${hiddenHighRiskFindings} high risk`
    : `${hiddenFindings.length} more`
  return <section className={`agent-review-brief recommendation-${brief.recommendation}`} aria-labelledby="agent-review-title">
    <header className="agent-review-verdict"><span>{brief.recommendation === 'ready' ? <Check size={22}/> : <AlertTriangle size={22}/>}</span><div><span className="agent-review-label">{stale ? 'Previous agent review' : 'Agent review complete'}</span><h2 id="agent-review-title">{recommendation.label}</h2><p>{recommendation.detail}</p></div><button className="button primary" aria-label={brief.findings.length ? `Review ${brief.findings.length} judgment${brief.findings.length === 1 ? '' : 's'}` : 'Review approval readiness'} disabled={disabled} onClick={onOpenReview}>Review<ArrowRight size={15}/></button></header>
    <div className="agent-review-body">
      <section><h3>What changed</h3>{brief.changes.length ? <ul>{brief.changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p>No concise behavioral change summary was available.</p>}</section>
      <section className="agent-review-attention"><h3>Needs your judgment <span>{brief.findings.length}</span></h3>{brief.findings.length ? <><p className="agent-review-attention-intro">High-risk judgments first. The agent groups observations only when it found a shared root cause.</p><ol className="agent-finding-list" id={findingListId}>{visibleFindings.map((finding) => <FindingRow key={finding.id} finding={finding} onInspect={onInspect}/>)}</ol>{brief.findings.length > initialFindingCount && <button className="button text small agent-findings-disclosure" aria-label={allFindingsVisible ? 'Show fewer judgments' : disclosureLabel} aria-controls={findingListId} aria-expanded={allFindingsVisible} onClick={() => setExpandedFindingSet(allFindingsVisible ? '' : findingSetKey)}>{allFindingsVisible ? 'Fewer' : disclosureText}<ChevronRight size={13}/></button>}</> : <p className="agent-review-clear"><Check size={15}/>No decision-critical judgments.</p>}</section>
    </div>
    <div className="agent-review-evidence">
      <section className="agent-review-signal" aria-labelledby="agent-review-verified-title"><header><span><ShieldCheck size={15}/><h3 id="agent-review-verified-title">What was verified</h3></span><small>{brief.verified.length} item{brief.verified.length === 1 ? '' : 's'}</small></header><div>{brief.verified.length ? <ul>{brief.verified.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No verification evidence was recorded.</p>}</div></section>
      <section className="agent-review-signal" aria-labelledby="agent-review-unknown-title"><header><span><CircleHelp size={15}/><h3 id="agent-review-unknown-title">What remains unknown</h3></span><small>{brief.blindSpots.length} item{brief.blindSpots.length === 1 ? '' : 's'}</small></header><div>{brief.blindSpots.length ? <ul>{brief.blindSpots.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No material unknowns were recorded by this analysis.</p>}</div></section>
    </div>
  </section>
}

function findingImpact(finding: AgentReviewFinding) {
  if (finding.kind === 'unknown') return 'The available repository evidence did not resolve this. Approval means explicitly accepting the remaining uncertainty.'
  if (finding.riskLevel === 'critical' || finding.riskLevel === 'high') return 'This could materially affect correctness or availability. It should be resolved or explicitly accepted before approval.'
  return 'This tradeoff can affect the behavior under review. Confirm that it is acceptable before approval.'
}

function FindingEvidence({finding, onEvidence, onOpenDiff}: {finding: AgentReviewFinding; onEvidence: (evidence: EvidenceReference) => void; onOpenDiff: (path?: string) => void}) {
  if (!finding.evidence.length) return <div className="finding-evidence-empty"><AlertTriangle size={16}/><span>No code reference is attached to this finding.</span></div>
  return <div className="finding-evidence-list">{finding.evidence.map((evidence) => {
    const lines = `L${evidence.startLine}${evidence.endLine !== evidence.startLine ? `–${evidence.endLine}` : ''}`
    const valid = evidence.validationStatus === 'valid'
    return <article key={evidence.id}><div><Code2 size={15}/><span><strong>{evidence.path}</strong><small>{evidence.revision} · {lines}</small></span></div><span className={valid ? 'evidence-validated' : 'evidence-unverified'}>{valid ? <ShieldCheck size={13}/> : <AlertTriangle size={13}/>} {valid ? 'Validated' : 'Unverified'}</span><div><button className="button secondary small" disabled={!valid} onClick={() => onEvidence(evidence)}>Open surrounding code</button><button className="button text small" onClick={() => onOpenDiff(evidence.path)}>View file diff</button></div></article>
  })}</div>
}

type FindingDiscussion = {id: string; author: string; body: string; location: string; url: string}

function relatedDiscussion(finding: AgentReviewFinding, reviews: PullRequestReview[], comments: PullRequestReviewComment[]): FindingDiscussion[] {
  const paths = new Set(finding.evidence.map((item) => item.path))
  const reviewItems = reviews.filter((review) => review.body.trim()).map((review) => ({id: `review-${review.id}`, author: review.author.login, body: review.body, location: review.state.toLowerCase(), url: review.url}))
  const commentItems = comments.filter((comment) => paths.has(comment.path)).map((comment) => ({id: `comment-${comment.id}`, author: comment.author.login, body: comment.body, location: `${comment.path}${comment.line ? `:${comment.line}` : ''}`, url: comment.url}))
  return [...reviewItems, ...commentItems].slice(-4)
}

export function AgentFindingDetail({finding, chapterTitle, review = emptyReview, reviews = [], comments = [], onReview, onEvidence, onOpenDiff, onDraft, onAnalysis, onOpenDiscussion}: {finding: AgentReviewFinding; chapterTitle: string; review?: DecisionReview; reviews?: PullRequestReview[]; comments?: PullRequestReviewComment[]; onReview: (review: DecisionReview) => void; onEvidence: (evidence: EvidenceReference) => void; onOpenDiff: (path?: string) => void; onDraft: () => void; onAnalysis: () => void; onOpenDiscussion: (url: string) => void}) {
  const accepted = review.disposition === 'accepted'
  const posture = evidencePosture(finding.evidence)
  const discussion = relatedDiscussion(finding, reviews, comments)
  const requiresRationale = findingRequiresRationale(finding)
  const rationaleId = useId()
  const [accepting, setAccepting] = useState(false)
  const [rationale, setRationale] = useState(review.note ?? '')
  useEffect(() => {
    setAccepting(false)
    setRationale(review.note ?? '')
  }, [finding.id, review.note])
  const beginAcceptance = () => {
    if (accepted) {
      onReview({disposition: 'unreviewed'})
      setRationale('')
      return
    }
    if (requiresRationale) {
      setAccepting(true)
      return
    }
    onReview({disposition: 'accepted'})
  }
  const confirmAcceptance = () => {
    const note = rationale.trim()
    if (!note) return
    onReview({disposition: 'accepted', note})
    setAccepting(false)
  }
  return <div className="finding-detail" role="region" aria-label={`Agent judgment: ${finding.title}`}>
    <article className="finding-detail-page">
      <header className="finding-detail-hero"><div className="finding-detail-context"><span className={`finding-kind ${finding.kind}`}><AlertTriangle size={14}/>{finding.kind === 'risk' ? `${finding.riskLevel ?? 'Unrated'} risk` : 'Unresolved uncertainty'}</span><span>{finding.observations.length > 1 ? `${finding.observations.length} observations` : `From ${chapterTitle}`}</span></div><h1>{finding.title}</h1><p>{finding.detail}</p></header>
      <section className="finding-impact" aria-labelledby="finding-impact-title"><h2 id="finding-impact-title">Why this matters</h2><p>{findingImpact(finding)}</p></section>
      {finding.observations.length > 1 && <section className="finding-section" aria-labelledby="finding-observations-title"><div className="finding-section-heading"><div><h2 id="finding-observations-title">Supporting observations</h2><p>{finding.groupingRationale ?? 'The agent identified one shared root cause and one approval decision.'}</p></div><span>{finding.observations.length}</span></div><ol className="finding-observation-list">{finding.observations.map((observation, index) => <li key={observation.id}><span>{index + 1}</span><div><strong>{observation.title}</strong><p>{observation.detail}</p></div></li>)}</ol></section>}
      <section className="finding-section" aria-labelledby="finding-evidence-title"><div className="finding-section-heading"><div><h2 id="finding-evidence-title">Evidence</h2><p>{evidencePostureLabel(posture)}. Open the surrounding code only when you need to challenge the agent’s assessment.</p></div><span>{finding.evidence.length} reference{finding.evidence.length === 1 ? '' : 's'}</span></div><FindingEvidence finding={finding} onEvidence={onEvidence} onOpenDiff={onOpenDiff}/></section>
      <section className="finding-section" aria-labelledby="finding-discussion-title"><div className="finding-section-heading"><div><h2 id="finding-discussion-title">Existing discussion</h2><p>Comments already attached to the affected code, plus review-level context.</p></div><span>{discussion.length}</span></div>{discussion.length ? <div className="finding-discussion">{discussion.map((item) => <article key={item.id}><div><strong>@{item.author}</strong><small>{item.location}</small>{item.url && <button className="discussion-link" aria-label={`Open discussion by @${item.author} on GitHub`} title="Open on GitHub" onClick={() => onOpenDiscussion(item.url)}><ExternalLink size={13}/></button>}</div><p>{item.body}</p></article>)}</div> : <p className="finding-discussion-empty">No existing discussion is attached to this finding.</p>}</section>
      <section className={`finding-decision${accepting ? ' is-accepting' : ''}`} aria-labelledby="finding-decision-title">
        <div className="finding-decision-copy"><h2 id="finding-decision-title">Your decision</h2><p>{requiresRationale ? 'Accept only when you can explain why the remaining tradeoff is safe enough for this PR. Otherwise draft a change for the author.' : 'Accept this as an understood tradeoff, or turn it into an editable local draft for the author.'} Nothing is published without confirmation.</p>{accepted && review.note && <div className="acceptance-summary"><strong>Accepted as a tradeoff</strong><span>{review.note}</span></div>}</div>
        {!accepting && <div className="finding-decision-actions"><button className={`button secondary${accepted ? ' finding-accepted' : ''}`} aria-pressed={accepted} aria-label={accepted ? 'Undo accepted tradeoff' : requiresRationale ? 'Accept with rationale' : 'Accept tradeoff'} onClick={beginAcceptance}><Check size={16}/>{accepted ? 'Accepted as tradeoff' : requiresRationale ? 'Accept with rationale' : 'Accept tradeoff'}</button><button className="button primary" onClick={onDraft}><MessageSquare size={16}/>Draft comment</button></div>}
        {accepting && <div className="acceptance-form"><label htmlFor={rationaleId}>Why can this be approved?</label><textarea id={rationaleId} maxLength={500} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Explain the constraint, safeguard, or tradeoff you are accepting."/><div><small>Stored with this local review and shown in the final decision.</small><span><button className="button text small" onClick={() => {setAccepting(false); setRationale(review.note ?? '')}}>Cancel</button><button className="button primary small" disabled={!rationale.trim()} onClick={confirmAcceptance}>Confirm acceptance</button></span></div></div>}
      </section>
      <footer className="finding-detail-footer"><span>{accepted ? <><Check size={14}/>Accepted as a tradeoff for this local review.</> : <>The judgment remains open until you accept it or request a change.</>}</span><button className="button text" onClick={onAnalysis}><BookOpen size={15}/>Read full generated analysis</button></footer>
    </article>
  </div>
}
