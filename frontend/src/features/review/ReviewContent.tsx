import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Code2, ExternalLink, FileCode2, FileDiff, GitPullRequest, LoaderCircle, MessageSquare, Pencil, Plus, RefreshCw, Reply, ShieldCheck, Trash2, X } from 'lucide-react'
import { backend } from '../../bridge'
import { EmptyState, RiskBadge, Skeleton } from '../../components'
import { useDialogFocus } from '../../dialog'
import { errorText } from '../../errors'
import { relativeTime } from '../../lib'
import { findingAcceptanceIsComplete, findingDecisionRequirement, findingEvidenceLabel, findingPriorityLabel, reviewGate, type AgentReviewFinding, type DecisionReviewMap } from './decision'
import type { CommentRange, DiffFile, EvidenceReference, FileContent, PublishPreview, PullRequestReviewComment, ReviewChapter, ReviewComment, ReviewSession, ThreadReplyPreview } from '../../types'

export type DraftTarget = {path: string; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; line: number; side: 'LEFT' | 'RIGHT'}

const PierreDiffRenderer = lazy(() => import('../../PierreRenderer').then((module) => ({default: module.PierreDiffRenderer})))
const PierreFileRenderer = lazy(() => import('../../PierreRenderer').then((module) => ({default: module.PierreFileRenderer})))
const PierreCodeExcerpt = lazy(() => import('../../PierreRenderer').then((module) => ({default: module.PierreCodeExcerpt})))

type InlineEvidenceState = {scope: string; evidence: EvidenceReference; file?: FileContent; loading?: boolean; error?: string}

export function ChapterReader({sessionId, chapter, chapterIndex, chapterCount, onOpenDiff, onEvidence, onDraft}: {sessionId: string; chapter: ReviewChapter; chapterIndex: number; chapterCount: number; onOpenDiff: (path?: string) => void; onEvidence: (evidence: EvidenceReference) => void; onDraft: (value: string) => void}) {
  const hasInterpretation = chapter.facts.length > 0 || chapter.inferences.length > 0
  const [preview, setPreview] = useState<InlineEvidenceState>()
  const previewRequest = useRef(0)
  useEffect(() => { previewRequest.current++; setPreview(undefined) }, [chapter.id])
  const toggleEvidence = async (scope: string, evidence: EvidenceReference) => {
    if (evidence.validationStatus !== 'valid') return
    if (preview?.scope === scope && preview.evidence.id === evidence.id) { previewRequest.current++; setPreview(undefined); return }
    const request = ++previewRequest.current
    setPreview({scope, evidence, loading: true})
    try {
      const file = await backend.getFile(sessionId, evidence.path, evidence.revision)
      if (request === previewRequest.current) setPreview({scope, evidence, file})
    } catch (err) {
      if (request === previewRequest.current) setPreview({scope, evidence, error: errorText(err)})
    }
  }
  const inlineEvidence = (scope: string, evidence: EvidenceReference[]) => <InlineEvidenceList scope={scope} evidence={evidence} preview={preview} onToggle={(nextScope, nextEvidence) => void toggleEvidence(nextScope, nextEvidence)} onOpenContext={onEvidence} onOpenDiff={onOpenDiff}/>
  return <div className="chapter-reader" role="region" aria-label={`Chapter ${chapter.order}: ${chapter.title}`}>
    <article className="chapter-reader-page">
      <header className="reader-hero"><div className="reader-position"><BookOpen size={15}/><span>Chapter {chapterIndex + 1} of {chapterCount}</span></div><h1>{chapter.title}</h1><p className="reader-deck">{chapter.purpose}</p><details className="reader-intro-details"><summary>Chapter context</summary><p>{chapter.description}</p></details></header>

      {(chapter.risks.length > 0 || chapter.unknowns.length > 0) && <section className="reader-section critical-section"><div className="reader-section-heading"><h2>Review closely</h2><span>{chapter.risks.length} risk{chapter.risks.length === 1 ? '' : 's'} · {chapter.unknowns.length} open question{chapter.unknowns.length === 1 ? '' : 's'}</span></div>{chapter.risks.map((risk) => <article className="reader-critical" key={risk.id}><div><RiskBadge level={risk.level}/><h3>{risk.title}</h3></div><p>{risk.description}</p>{inlineEvidence(`risk-${risk.id}`, risk.evidence)}</article>)}{chapter.unknowns.map((claim) => <article className="reader-unknown" key={claim.id}><div><CircleHelp size={17}/><span>Open question</span></div><p>{claim.text}</p>{inlineEvidence(`unknown-${claim.id}`, claim.evidence)}</article>)}</section>}

      {chapter.behavioralChanges.length > 0 && <section className="reader-section behavior-section"><div className="reader-section-heading"><h2>Behavioral change</h2><span>{chapter.behavioralChanges.length} change{chapter.behavioralChanges.length === 1 ? '' : 's'}</span></div>{chapter.behavioralChanges.map((change) => <article className="reader-behavior" key={change.id}><h3>{change.summary}</h3><div className="reader-transition"><div><span>Before</span><p>{change.before}</p></div><ArrowRight size={18}/><div><span>After</span><p>{change.after}</p></div></div>{inlineEvidence(`change-${change.id}`, change.evidence)}</article>)}</section>}

      {chapter.relatedTests.length > 0 && <section className="reader-section test-section"><div className="reader-section-heading"><h2>Test posture</h2><span>{chapter.relatedTests.length} related test{chapter.relatedTests.length === 1 ? '' : 's'}</span></div><div className="reader-test-list">{chapter.relatedTests.map((test) => <article key={test.id}><div><FileCode2 size={16}/><div><strong>{test.path}</strong><p>{test.description}</p></div><span className={`validation ${test.relationship}`}>{test.relationship}</span></div>{inlineEvidence(`test-${test.id}`, test.evidence)}</article>)}</div></section>}

      {hasInterpretation && <details className="reader-disclosure"><summary><span><ShieldCheck size={16}/>Evidence and interpretation</span><small>{chapter.facts.length} facts · {chapter.inferences.length} inferences</small></summary><div>{chapter.facts.length > 0 && <section><h3>What the evidence establishes</h3>{chapter.facts.map((claim) => <article className="reader-claim" key={claim.id}><p>{claim.text}</p>{inlineEvidence(`fact-${claim.id}`, claim.evidence)}</article>)}</section>}{chapter.inferences.length > 0 && <section><h3>What ReviewArc infers</h3>{chapter.inferences.map((claim) => <article className="reader-claim inference" key={claim.id}><p>{claim.text}</p>{inlineEvidence(`inference-${claim.id}`, claim.evidence)}</article>)}</section>}</div></details>}

      {chapter.suggestedQuestions.length > 0 && <section className="reader-section author-questions"><div className="reader-section-heading"><h2>Questions for the author</h2><span>{chapter.suggestedQuestions.length} prompt{chapter.suggestedQuestions.length === 1 ? '' : 's'}</span></div>{chapter.suggestedQuestions.map((question) => <article key={question.id}><div><p>{question.text}</p>{question.rationale && <small>{question.rationale}</small>}</div><button className="button secondary small" onClick={() => onDraft(question.text)}><Plus size={13}/>Add to drafts</button>{inlineEvidence(`question-${question.id}`, question.evidence)}</article>)}</section>}
    </article>
  </div>
}

function InlineEvidenceList({scope, evidence, preview, onToggle, onOpenContext, onOpenDiff}: {scope: string; evidence: EvidenceReference[]; preview?: InlineEvidenceState; onToggle: (scope: string, evidence: EvidenceReference) => void; onOpenContext: (evidence: EvidenceReference) => void; onOpenDiff: (path?: string) => void}) {
  return <div className="inline-evidence-list">{evidence.map((item) => {
    const active = preview?.scope === scope && preview.evidence.id === item.id
    const lineLabel = `L${item.startLine}${item.endLine !== item.startLine ? `–${item.endLine}` : ''}`
    return <div className={`inline-evidence${active ? ' active' : ''}`} key={item.id}><button disabled={item.validationStatus !== 'valid'} aria-expanded={active} aria-label={`${active ? 'Hide' : 'Show'} code for ${item.path} ${lineLabel}`} onClick={() => onToggle(scope, item)}><Code2 size={13}/><span>{item.path}</span><em>{lineLabel}</em>{item.validationStatus !== 'valid' ? <><AlertTriangle size={11}/><small>Unverified</small></> : <ChevronRight className="evidence-chevron" size={13}/>}</button>{active && <InlineEvidencePreview state={preview} onOpenContext={() => onOpenContext(item)} onOpenDiff={() => onOpenDiff(item.path)}/>}</div>
  })}</div>
}

function InlineEvidencePreview({state, onOpenContext, onOpenDiff}: {state: InlineEvidenceState; onOpenContext: () => void; onOpenDiff: () => void}) {
  const {evidence, file, loading, error} = state
  if (loading) return <div className="inline-evidence-body loading"><LoaderCircle className="spin" size={15}/><span>Loading surrounding code…</span></div>
  if (error) return <div className="inline-evidence-body error"><AlertTriangle size={15}/><span>{error}</span></div>
  if (!file) return null
  if (file.isBinary) return <div className="inline-evidence-body error"><FileCode2 size={15}/><span>This reference is in a binary file.</span></div>
  const lines = file.content.split(/\r?\n/)
  const first = Math.max(1, evidence.startLine - 3)
  const last = Math.min(lines.length, evidence.endLine + 3)
  return <div className="inline-evidence-body"><header><div><strong>{file.path}</strong><span>{file.revision} · {first}–{last}</span></div><div><button className="button text small" onClick={onOpenContext}>Full context</button><button className="button text small" onClick={onOpenDiff}>Open diff</button></div></header><Suspense fallback={<div className="inline-evidence-highlight-loading"><LoaderCircle className="spin" size={14}/>Highlighting code…</div>}><PierreCodeExcerpt file={file} firstLine={first} lastLine={last} focusStart={evidence.startLine} focusEnd={evidence.endLine}/></Suspense></div>
}

export function ChapterEvidenceIndex({chapter, onEvidence}: {chapter: ReviewChapter; onEvidence: (evidence: EvidenceReference) => void}) {
  const evidence = [
    ...chapter.evidence,
    ...chapter.behavioralChanges.flatMap((item) => item.evidence),
    ...chapter.risks.flatMap((item) => item.evidence),
    ...chapter.facts.flatMap((item) => item.evidence),
    ...chapter.inferences.flatMap((item) => item.evidence),
    ...chapter.unknowns.flatMap((item) => item.evidence),
    ...chapter.relatedTests.flatMap((item) => item.evidence),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.path === item.path && candidate.revision === item.revision && candidate.startLine === item.startLine && candidate.endLine === item.endLine) === index)
  return <div className="context-scroll evidence-index"><header><div><h2>Evidence</h2><p>{evidence.length} unique reference{evidence.length === 1 ? '' : 's'} in this chapter</p></div></header>{evidence.length ? <EvidenceList evidence={evidence} onClick={onEvidence}/> : <div className="evidence-empty"><CircleHelp size={18}/><strong>No validated references</strong><p>This chapter needs stronger evidence before it can support a confident decision.</p></div>}</div>
}

export function FileContextView({file, focus, comments = [], onCommentRange, onReply, replyReset}: {file: FileContent; focus: EvidenceReference; comments?: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  if (file.isBinary) return <EmptyState icon={<FileCode2/>} title="Binary evidence"><p>This validated path is binary and has no displayable line context.</p></EmptyState>
  return <div className="diff-view pierre-diff file-context-view" role="region" aria-label={`${file.revision} file context for ${file.path}`}><Suspense fallback={<Skeleton rows={9}/>}><PierreFileRenderer file={file} focus={focus} comments={comments} onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/></Suspense></div>
}

export function DiffView({diff, focus, comments = [], onCommentRange, onReply, replyReset}: {diff: DiffFile; focus?: EvidenceReference; comments?: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  return <PierreDiffView diff={diff} focus={focus} comments={comments} layout="unified" onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/>
}

export function SplitDiffView({diff, comments = [], onCommentRange, onReply, replyReset}: {diff: DiffFile; comments?: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  return <PierreDiffView diff={diff} comments={comments} layout="split" onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/>
}

function PierreDiffView({diff, focus, comments, layout, onCommentRange, onReply, replyReset}: {diff: DiffFile; focus?: EvidenceReference; comments: PullRequestReviewComment[]; layout: 'unified' | 'split'; onCommentRange: (range: CommentRange) => void; onReply?: (root: PullRequestReviewComment, body: string) => Promise<boolean>; replyReset?: {rootId: number; version: number}}) {
  if (diff.file.isBinary) return <EmptyState icon={<FileCode2/>} title="Binary file"><p>ReviewArc cannot render a textual diff for this file.</p></EmptyState>
  if (!diff.hunks?.length || !diff.patch) return <EmptyState icon={<FileDiff/>} title="No textual changes"><p>The file metadata changed without a displayable text hunk.</p></EmptyState>
  return <div className="diff-view pierre-diff" role="region" aria-label={`${layout === 'split' ? 'Split diff' : 'Diff'} for ${diff.file.path}`}><Suspense fallback={<Skeleton rows={9}/>}><PierreDiffRenderer diff={diff} focus={focus} comments={comments} layout={layout} onCommentRange={onCommentRange} onReply={onReply} replyReset={replyReset}/></Suspense></div>
}

export function draftTargetFor(path: string, range: CommentRange): DraftTarget {
  const multiLine = range.startLine !== range.endLine || range.startSide !== range.endSide
  return {path, startLine: multiLine ? range.startLine : undefined, startSide: multiLine ? range.startSide : undefined, line: range.endLine, side: range.endSide}
}

function commentLocation(comment: {path?: string; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; line?: number; side?: 'LEFT' | 'RIGHT'}) {
  if (!comment.path) return 'General review comment'
  if (!comment.line) return comment.path
  if (comment.startLine && comment.startSide && comment.side && comment.startSide !== comment.side) return `${comment.path}:${comment.startLine} ${comment.startSide}–${comment.line} ${comment.side}`
  return `${comment.path}:${comment.startLine && comment.startLine !== comment.line ? `${comment.startLine}–${comment.line}` : comment.line}`
}

export function SymbolNavigator({symbols, onEvidence}: {symbols: ReviewChapter['symbols']; onEvidence: (evidence: EvidenceReference) => void}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? symbols : symbols.slice(0, 6)
  return <div className="symbol-nav"><div><span>Changed symbols</span><small>{symbols.length}</small></div><div className="symbol-nav-list">{visible.map((symbol) => <button title={`${symbol.name} · ${symbol.path}`} key={`${symbol.path}:${symbol.name}`} onClick={() => symbol.evidence[0] && onEvidence(symbol.evidence[0])}><Code2 size={12}/><span>{symbol.name}</span></button>)}{symbols.length > 6 && <button className="symbol-nav-more" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer' : `Show ${symbols.length - 6} more`}</button>}</div></div>
}

function EvidenceList({evidence, onClick}: {evidence: EvidenceReference[]; onClick: (evidence: EvidenceReference) => void}) { return <div className="evidence-list">{evidence.map((item) => <button disabled={item.validationStatus !== 'valid'} title={item.validationMessage} onClick={() => onClick(item)} key={item.id}><Code2 size={12}/><span>{item.path}</span><em>L{item.startLine}{item.endLine !== item.startLine ? `–${item.endLine}` : ''}</em>{item.validationStatus !== 'valid' && <AlertTriangle size={11}/>}</button>)}</div> }

export function NotesPanel({notes, value, onChange, onSave, onEdit, onDelete, editing, busy}: {notes: ReviewSession['notes']; value: string; onChange: (value: string) => void; onSave: () => void; onEdit: (note: ReviewSession['notes'][number]) => void; onDelete: (id: string) => void; editing: boolean; busy: boolean}) { return <div className="composer-panel"><div className="composer-intro"><h2>Private notes</h2><p>Stored only in ReviewArc. Notes are never sent to GitHub.</p></div><textarea autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Capture a concern, decision, or follow-up…"/><button className="button primary small" disabled={busy || !value.trim()} onClick={onSave}>{editing ? 'Update' : 'Save'} note</button><div className="saved-items">{notes.map((note) => <article key={note.id}><p>{note.body}</p><footer><small>{relativeTime(note.updatedAt)}</small><button aria-label="Edit note" onClick={() => onEdit(note)}><Pencil size={13}/></button><button aria-label="Delete note" onClick={() => onDelete(note.id)}><Trash2 size={13}/></button></footer></article>)}</div></div> }

export function DraftsPanel({drafts, published, selected, onSelected, value, onChange, onSave, onPublish, onEdit, onDelete, editing, target, onClearTarget, busy}: {drafts: ReviewComment[]; published: ReviewComment[]; selected: Set<string>; onSelected: (value: Set<string>) => void; value: string; onChange: (value: string) => void; onSave: () => void; onPublish: () => void; onEdit: (draft: ReviewComment) => void; onDelete: (id: string) => void; editing: boolean; target?: DraftTarget; onClearTarget: () => void; busy: boolean}) {
  const toggle = (id: string) => { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); onSelected(next) }
  return <div className="composer-panel"><div className="composer-intro"><h2>Review drafts</h2><p>Drag across line numbers to comment on a range. Publishing always requires confirmation.</p></div>{target && <div className="draft-target"><Code2 size={12}/><span>{commentLocation(target)}</span><button aria-label="Make this a general comment" onClick={onClearTarget}><X size={12}/></button></div>}<textarea autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder={target ? `Comment on ${commentLocation(target)}…` : 'Write a clear, actionable review comment…'}/><button className="button primary small" disabled={busy || !value.trim()} onClick={onSave}>{editing ? 'Update' : 'Save'} {target ? 'inline ' : ''}draft</button><div className="saved-items drafts">{drafts.map((draft) => <label key={draft.id} aria-label={`Select draft: ${draft.body}`}><input type="checkbox" checked={selected.has(draft.id)} onChange={() => toggle(draft.id)}/><article><p>{draft.body}</p><footer><small>{commentLocation(draft)}</small><button aria-label="Edit draft" onClick={() => onEdit(draft)}><Pencil size={13}/></button><button aria-label="Delete draft" onClick={() => onDelete(draft.id)}><Trash2 size={13}/></button></footer></article></label>)}</div>{drafts.length > 0 && <button className="button danger wide" disabled={busy || !selected.size} onClick={onPublish}>Preview {selected.size} comment{selected.size === 1 ? '' : 's'}</button>}{published.length > 0 && <section className="publication-history"><h3>Published from ReviewArc</h3>{published.map((comment) => <button type="button" key={comment.id} disabled={!comment.githubUrl} onClick={() => comment.githubUrl && backend.openGitHubURL(comment.githubUrl)}><Check size={13}/><span>{comment.body}</span><ExternalLink size={12}/></button>)}</section>}</div>
}

export function ReviewSummary({session, busy, selectedDrafts, findings = [], decisionReview = {}, onClose, onDrafts, onOpenFinding, onReanalyze, onDecision}: {session: ReviewSession; busy: boolean; selectedDrafts: number; findings?: AgentReviewFinding[]; decisionReview?: DecisionReviewMap; onClose: () => void; onDrafts: () => void; onOpenFinding: (finding: AgentReviewFinding) => void; onReanalyze: () => void; onDecision: (event: 'APPROVE' | 'REQUEST_CHANGES') => void}) {
  useDialogFocus(onClose)
  const drafts = session.comments.filter((comment) => comment.status === 'draft')
  const accepted = findings.filter((finding) => findingAcceptanceIsComplete(finding, decisionReview[finding.id]))
  const unresolved = findings.filter((finding) => !findingAcceptanceIsComplete(finding, decisionReview[finding.id]))
  const gate = reviewGate(session.pullRequest.checkRuns)
  const checksPaused = gate.status === 'blocked' || gate.status === 'waiting'
  const ready = unresolved.length === 0 && !session.isStale && !checksPaused
  const approveBlockers = [session.isStale ? 'Reanalyze the latest revision' : '', checksPaused ? 'wait for CI to pass' : '', unresolved.length ? `resolve ${unresolved.length} agent judgment${unresolved.length === 1 ? '' : 's'}` : ''].filter(Boolean)
  const approveTitle = approveBlockers.length ? `${approveBlockers.join(' and ')} before approving.` : ''
  const requestChangesTitle = session.isStale ? 'Reanalyze the latest revision before requesting changes.' : checksPaused ? 'Wait for CI to finish before completing this review.' : selectedDrafts === 0 ? 'Select at least one draft explaining the requested changes.' : ''
  const checkSummary = gate.status === 'unknown' ? 'No checks configured' : gate.status === 'clear' ? `${gate.passing.length}/${gate.checks.length} passing` : gate.status === 'blocked' ? `${gate.failing.length} failing` : `${gate.waiting.length} not complete`
  return <div className="modal-backdrop">
    <section className="review-summary-modal decision-brief-modal" role="dialog" aria-modal="true" aria-labelledby="review-summary-title">
      <header><div><ShieldCheck size={20}/><div><span className="decision-brief-kicker">Human decision</span><h2 id="review-summary-title">Can this PR be approved?</h2><p>{ready ? 'No decision-critical findings remain. Confirm the external signals, then approve.' : 'Complete only the findings that can change the approval decision.'}</p></div></div><button className="icon-button" aria-label="Close review summary" onClick={onClose}><X size={18}/></button></header>
      <div className="summary-status"><div><strong>{accepted.length}/{findings.length}</strong><span>tradeoffs accepted</span></div><div><strong>{unresolved.length}</strong><span>needs judgment</span></div><div><strong>{drafts.length}</strong><span>local drafts</span></div></div>
      {session.isStale && <div className="warning-banner summary-stale-warning"><AlertTriangle size={16}/><span><strong>This PR changed since it was analyzed.</strong> You can inspect the previous analysis, but it cannot support approval. Reanalyze the latest revision to continue.</span><button className="button secondary small" disabled={busy} onClick={onReanalyze}>{busy ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}Reanalyze latest revision</button></div>}
      {checksPaused && <div className="warning-banner summary-stale-warning"><AlertTriangle size={16}/><span><strong>{gate.status === 'blocked' ? 'CI is failing.' : 'CI is still running.'}</strong> Review completion is paused until the checks pass.</span></div>}
      <div className="decision-brief-body">
        <section className="decision-brief-supported"><h3>Accepted tradeoffs</h3>{accepted.length ? accepted.map((finding) => <div key={finding.id}><Check size={15}/><span><strong>{finding.title}</strong>{decisionReview[finding.id]?.note && <small>{decisionReview[finding.id]?.note}</small>}</span></div>) : <p>{findings.length ? 'No tradeoffs have been accepted.' : 'The agent reported no decision-critical findings.'}</p>}</section>
        <section className="summary-unresolved"><h3>Still needs your judgment</h3>{unresolved.length ? <ol className="summary-finding-list">{unresolved.map((finding) => <li key={finding.id}><button type="button" aria-label={`Open judgment: ${finding.title}`} onClick={() => onOpenFinding(finding)}><span className={`summary-finding-icon ${finding.kind} risk-${finding.riskLevel ?? 'unrated'}`}>{finding.kind === 'unknown' ? <CircleHelp size={15}/> : <AlertTriangle size={15}/>}</span><span><small>{findingPriorityLabel(finding)}{finding.observations.length > 1 ? ` · ${finding.observations.length} observations` : ''} · {findingEvidenceLabel(finding)}</small><strong>{finding.title}</strong><em>{findingDecisionRequirement(finding)}</em></span><span>Inspect<ChevronRight size={13}/></span></button></li>)}</ol> : <p><Check size={16}/>No unresolved agent judgments.</p>}</section>
        <section className="decision-brief-signals"><h3>External signals</h3><div><span>Automated checks</span><strong>{checkSummary}</strong></div><div><span>Analysis revision</span><strong>{session.isStale ? 'Out of date' : 'Current'}</strong></div></section>
      </div>
      <footer><button className="button secondary" onClick={onDrafts}><MessageSquare size={15}/>Review {drafts.length} draft{drafts.length === 1 ? '' : 's'}</button><button className="button danger" disabled={busy || selectedDrafts === 0 || session.isStale || checksPaused} title={requestChangesTitle} onClick={() => onDecision('REQUEST_CHANGES')}>Request changes</button>{unresolved.length ? <button className="button primary" onClick={() => onOpenFinding(unresolved[0])}>Continue review<ArrowRight size={15}/></button> : <button className="button primary" disabled={busy || !ready} title={approveTitle} onClick={() => onDecision('APPROVE')}><Check size={15}/>Approve</button>}</footer>
    </section>
  </div>
}

export function PublishConfirmation({preview, busy, onCancel, onConfirm}: {preview: PublishPreview; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  const label = preview.event === 'APPROVE' ? 'Approve pull request' : preview.event === 'REQUEST_CHANGES' ? 'Request changes' : 'Publish comments'
  return <div className="modal-backdrop"><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title"><header><div><span><ExternalLink size={17}/></span><div><h2 id="publish-title">{label}?</h2><p>This review is externally visible on GitHub and requires your explicit confirmation.</p></div></div><button className="icon-button" aria-label="Close" onClick={onCancel}><X size={17}/></button></header><div className="publish-target"><GitPullRequest size={16}/><span>{preview.repository} #{preview.number}</span><strong>{preview.event.replace('_', ' ').toLowerCase()}</strong></div>{preview.items.length > 0 && <div className="publish-comments">{preview.items.map((comment) => <article key={comment.draftId}><p>{comment.body}</p><small>{commentLocation(comment)}</small></article>)}</div>}<footer><button className="button secondary" disabled={busy} onClick={onCancel}>Keep editing</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <ExternalLink size={15}/>}Confirm {label.toLowerCase()}</button></footer></section></div>
}

export function ThreadReplyConfirmation({preview, busy, onCancel, onConfirm}: {preview: ThreadReplyPreview; busy: boolean; onCancel: () => void; onConfirm: () => void}) {
  useDialogFocus(onCancel)
  return <div className="modal-backdrop"><section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="thread-reply-title"><header><div><span><Reply size={17}/></span><div><h2 id="thread-reply-title">Publish thread reply?</h2><p>This reply will be externally visible on GitHub.</p></div></div><button className="icon-button" aria-label="Close" onClick={onCancel}><X size={17}/></button></header><div className="publish-target"><MessageSquare size={16}/><span>{preview.repository} #{preview.number}</span><strong>Reply to @{preview.rootAuthor}</strong></div><div className="publish-comments"><article><p>{preview.body}</p><small>{preview.path}</small></article></div><footer><button className="button secondary" disabled={busy} onClick={onCancel}>Keep editing</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={15}/> : <ExternalLink size={15}/>}Confirm reply</button></footer></section></div>
}
