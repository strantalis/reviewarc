import { useEffect, useMemo, useState } from 'react'
import { File as PierreFile, PatchDiff } from '@pierre/diffs/react'
import type { DiffBasePropsReact, DiffLineAnnotation, FileProps, LineAnnotation, SelectedLineRange } from '@pierre/diffs/react'
import { ExternalLink, MessageSquare, Reply } from 'lucide-react'
import { backend } from './bridge'
import type { CommentRange, DiffFile, EvidenceReference, FileContent, PullRequestReviewComment } from './types'

interface ReviewThread { root: PullRequestReviewComment; replies: PullRequestReviewComment[] }
interface ReplyDraft { open: boolean; body: string }
interface ReplyReset { rootId: number; version: number }
type ReplyHandler = (root: PullRequestReviewComment, body: string) => Promise<boolean>

export function PierreFileRenderer({file, focus, comments, onCommentRange, onReply, replyReset}: {file: FileContent; focus: EvidenceReference; comments: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: ReplyHandler; replyReset?: ReplyReset}) {
  const side = file.revision === 'base' ? 'LEFT' : 'RIGHT'
  const focusedLines = useMemo<SelectedLineRange>(() => ({start: focus.startLine, end: focus.endLine}), [focus.startLine, focus.endLine])
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(focusedLines)
  const [replyDrafts, setReplyDrafts] = useState<Record<number, ReplyDraft>>({})
  useEffect(() => setSelectedLines(focusedLines), [file.path, file.revision, focusedLines])
  useEffect(() => { if (replyReset) setReplyDrafts((current) => { const next = {...current}; delete next[replyReset.rootId]; return next }) }, [replyReset])
  const annotations = useMemo<LineAnnotation<ReviewThread>[]>(() => reviewThreads(comments, file.path).filter((thread) => (thread.root.side ?? 'RIGHT') === side).flatMap((thread) => thread.root.line ? [{lineNumber: thread.root.line, metadata: thread}] : []), [comments, file.path, side])
  const options = useMemo<NonNullable<FileProps<ReviewThread>['options']>>(() => ({
    theme: 'pierre-light', themeType: 'light', disableFileHeader: true, overflow: 'scroll', lineHoverHighlight: 'number',
    enableLineSelection: true,
    onLineSelectionChange: setSelectedLines,
    onLineNumberClick: ({lineNumber}) => onCommentRange({startLine: lineNumber, startSide: side, endLine: lineNumber, endSide: side}),
    onLineSelectionEnd: (range) => { setSelectedLines(range); if (range) onCommentRange(toCommentRange(range, side)) },
    onPostRender: (node) => scrollLineIntoView(node, focus.startLine),
  }), [focus.startLine, onCommentRange, side])
  return <PierreFile file={{name: file.path, contents: file.content, cacheKey: `${file.sha}:${file.revision}:${file.path}`}} options={options} selectedLines={selectedLines} lineAnnotations={annotations} renderAnnotation={(annotation) => annotation.metadata ? <ReviewThreadAnnotation thread={annotation.metadata} onReply={onReply} draft={replyDrafts[annotation.metadata.root.id] ?? {open: false, body: ''}} onDraft={(draft) => setReplyDrafts((current) => ({...current, [annotation.metadata!.root.id]: draft}))}/> : null} disableWorkerPool/>
}

export function PierreDiffRenderer({diff, focus, comments, layout, onCommentRange, onReply, replyReset}: {diff: DiffFile; focus?: EvidenceReference; comments: PullRequestReviewComment[]; layout: 'unified' | 'split'; onCommentRange: (range: CommentRange) => void; onReply?: ReplyHandler; replyReset?: ReplyReset}) {
  const focusedLines = useMemo<SelectedLineRange | null>(() => focus?.path === diff.file.path ? ({start: focus.startLine, end: focus.endLine, side: focus.revision === 'base' ? 'deletions' : 'additions'}) : null, [diff.file.path, focus])
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(focusedLines)
  const [replyDrafts, setReplyDrafts] = useState<Record<number, ReplyDraft>>({})
  useEffect(() => setSelectedLines(focusedLines), [diff.file.path, focusedLines])
  useEffect(() => { if (replyReset) setReplyDrafts((current) => { const next = {...current}; delete next[replyReset.rootId]; return next }) }, [replyReset])
  const annotations = useMemo<DiffLineAnnotation<ReviewThread>[]>(() => reviewThreads(comments, diff.file.path).flatMap((thread) => thread.root.line ? [{lineNumber: thread.root.line, side: thread.root.side === 'LEFT' ? 'deletions' : 'additions', metadata: thread}] : []), [comments, diff.file.path])
  const options = useMemo<NonNullable<DiffBasePropsReact<ReviewThread>['options']>>(() => ({
    theme: 'pierre-light', themeType: 'light', diffStyle: layout, diffIndicators: 'bars', lineDiffType: 'word-alt', overflow: 'scroll', disableFileHeader: true, hunkSeparators: 'metadata', lineHoverHighlight: 'number',
    enableLineSelection: true,
    onLineSelectionChange: setSelectedLines,
    onLineNumberClick: ({lineNumber, annotationSide}) => { const side = annotationSide === 'deletions' ? 'LEFT' : 'RIGHT'; onCommentRange({startLine: lineNumber, startSide: side, endLine: lineNumber, endSide: side}) },
    onLineSelectionEnd: (range) => { setSelectedLines(range); if (range) onCommentRange(toCommentRange(range)) },
    onPostRender: (node) => { if (focus?.path === diff.file.path) scrollLineIntoView(node, focus.startLine, focus.revision === 'base' ? 'deletions' : 'additions') },
  }), [diff.file.path, focus, layout, onCommentRange])
  return <PatchDiff patch={diff.patch} options={options} selectedLines={selectedLines} lineAnnotations={annotations} renderAnnotation={(annotation) => annotation.metadata ? <ReviewThreadAnnotation thread={annotation.metadata} onReply={onReply} draft={replyDrafts[annotation.metadata.root.id] ?? {open: false, body: ''}} onDraft={(draft) => setReplyDrafts((current) => ({...current, [annotation.metadata!.root.id]: draft}))}/> : null} disableWorkerPool/>
}

function reviewThreads(comments: PullRequestReviewComment[], path: string): ReviewThread[] {
  const relevant = comments.filter((comment) => comment.path === path)
  const roots = new Map<number, ReviewThread>()
  for (const comment of relevant) if (!comment.replyToId) roots.set(comment.id, {root: comment, replies: []})
  for (const comment of relevant) {
    if (!comment.replyToId) continue
    const thread = roots.get(comment.replyToId)
    if (thread) thread.replies.push(comment)
    else roots.set(comment.id, {root: comment, replies: []})
  }
  return [...roots.values()].sort((a, b) => a.root.id - b.root.id)
}

function ReviewThreadAnnotation({thread, onReply, draft, onDraft}: {thread: ReviewThread; onReply?: ReplyHandler; draft: ReplyDraft; onDraft: (draft: ReplyDraft) => void}) {
  const comments = [thread.root, ...thread.replies]
  const [preparing, setPreparing] = useState(false)
  const prepare = async () => {
    if (!onReply || !draft.body.trim()) return
    setPreparing(true)
    await onReply(thread.root, draft.body.trim())
    setPreparing(false)
  }
  return <article className="review-thread"><header><span><MessageSquare size={13}/>{comments.length === 1 ? 'Review comment' : `${comments.length} messages`}<small>{threadLocation(thread.root)}</small></span><div className="thread-actions">{onReply && <button onClick={() => onDraft({...draft, open: !draft.open})}><Reply size={12}/>Reply</button>}<button onClick={() => backend.openGitHubURL(thread.root.url)}><ExternalLink size={12}/>Open thread</button></div></header><div>{comments.map((comment, index) => <section key={comment.id} className={index ? 'thread-reply' : ''}><div><strong>@{comment.author.login}</strong><time>{new Date(comment.createdAt).toLocaleString()}</time></div><p>{comment.body}</p>{index > 0 && <Reply size={12}/>}</section>)}</div>{draft.open && <div className="thread-reply-composer"><label><span className="sr-only">Reply to @{thread.root.author.login}</span><textarea autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={65536} value={draft.body} onChange={(event) => onDraft({...draft, body: event.target.value})} placeholder={`Reply to @${thread.root.author.login}…`}/></label><footer><button disabled={preparing} onClick={() => onDraft({open: false, body: ''})}>Cancel</button><button className="primary" disabled={preparing || !draft.body.trim()} onClick={() => void prepare()}>{preparing ? 'Preparing…' : 'Review reply'}</button></footer></div>}</article>
}

function threadLocation(comment: PullRequestReviewComment) {
  const endLine = comment.line
  if (!endLine) return 'Outdated'
  const endSide = comment.side === 'LEFT' ? 'Old' : 'New'
  if (!comment.startLine || comment.startLine === endLine) return `${endSide} line ${endLine}`
  const startSide = comment.startSide === 'LEFT' ? 'Old' : 'New'
  return startSide === endSide ? `${endSide} lines ${comment.startLine}–${endLine}` : `${startSide} line ${comment.startLine} – ${endSide.toLowerCase()} line ${endLine}`
}

function toCommentRange(range: SelectedLineRange, fallbackSide: 'LEFT' | 'RIGHT' = 'RIGHT'): CommentRange {
  const side = range.side === 'deletions' ? 'LEFT' : range.side === 'additions' ? 'RIGHT' : fallbackSide
  const endSide = range.endSide === 'deletions' ? 'LEFT' : range.endSide === 'additions' ? 'RIGHT' : side
  if (side === endSide && range.start > range.end) return {startLine: range.end, startSide: side, endLine: range.start, endSide}
  return {startLine: range.start, startSide: side, endLine: range.end, endSide}
}

function scrollLineIntoView(node: HTMLElement, line: number, side?: 'deletions' | 'additions') {
  requestAnimationFrame(() => {
    const root = node.shadowRoot ?? node
    const candidates = [...root.querySelectorAll<HTMLElement>(`[data-column-number="${line}"]`)]
    const target = side ? candidates.find((candidate) => candidate.closest(`[data-${side}]`)) ?? candidates[0] : candidates[0]
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({block: 'center', behavior: 'smooth'})
  })
}
