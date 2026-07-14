import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { getFiletypeFromFileName, getSharedHighlighter, type ThemedToken } from '@pierre/diffs'
import { PatchDiff } from '@pierre/diffs/react'
import type { DiffBasePropsReact, DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs/react'
import { ExternalLink, LoaderCircle, MessageSquare, Reply } from 'lucide-react'
import { backend } from './bridge'
import type { CommentRange, DiffFile, EvidenceReference, FileContent, PullRequestReviewComment } from './types'

interface ReviewThread { root: PullRequestReviewComment; replies: PullRequestReviewComment[] }
interface ReplyDraft { open: boolean; body: string }
interface ReplyReset { rootId: number; version: number }
type ReplyHandler = (root: PullRequestReviewComment, body: string) => Promise<boolean>

export function PierreCodeExcerpt({file, firstLine, lastLine, focusStart, focusEnd}: {file: FileContent; firstLine: number; lastLine: number; focusStart: number; focusEnd: number}) {
  const code = useMemo(() => file.content.split(/\r?\n/).slice(firstLine - 1, lastLine).join('\n'), [file.content, firstLine, lastLine])
  const [tokens, setTokens] = useState<ThemedToken[][]>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setTokens(undefined)
    setFailed(false)
    const language = getFiletypeFromFileName(file.path)
    void getSharedHighlighter({themes: ['pierre-light'], langs: [language]}).then((highlighter) => {
      const highlighted = highlighter.codeToTokensBase(code, {lang: language, theme: 'pierre-light'})
      if (active) setTokens(highlighted)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [code, file.path])
  if (!tokens && !failed) return <div className="inline-evidence-highlight-loading"><LoaderCircle className="spin" size={14}/>Highlighting code…</div>
  const lines = tokens ?? code.split('\n').map((line) => [{content: line} as ThemedToken])
  return <pre aria-label={`Code excerpt from ${file.path}`}>{lines.map((line, index) => { const number = firstLine + index; return <span className={number >= focusStart && number <= focusEnd ? 'focus' : ''} key={number}><i>{number}</i><code>{line.length ? line.map((token, tokenIndex) => <span key={`${number}-${tokenIndex}`} style={token.color ? {color: token.color} : undefined}>{token.content}</span>) : ' '}</code></span> })}</pre>
}

export function PierreFileRenderer({file, focus, comments, onCommentRange, onReply, replyReset}: {file: FileContent; focus: EvidenceReference; comments: PullRequestReviewComment[]; onCommentRange: (range: CommentRange) => void; onReply?: ReplyHandler; replyReset?: ReplyReset}) {
  const side = file.revision === 'base' ? 'LEFT' : 'RIGHT'
  const focusedLines = useMemo<SelectedLineRange>(() => ({start: focus.startLine, end: focus.endLine}), [focus.startLine, focus.endLine])
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(focusedLines)
  const [replyDrafts, setReplyDrafts] = useState<Record<number, ReplyDraft>>({})
  const [tokens, setTokens] = useState<ThemedToken[][]>()
  const [highlightFailed, setHighlightFailed] = useState(false)
  const dragAnchor = useRef<number | null>(null)
  const dragLine = useRef<number | null>(null)
  const focusRow = useRef<HTMLDivElement | null>(null)
  useEffect(() => setSelectedLines(focusedLines), [file.path, file.revision, focusedLines])
  useEffect(() => { if (replyReset) setReplyDrafts((current) => { const next = {...current}; delete next[replyReset.rootId]; return next }) }, [replyReset])
  useEffect(() => {
    let active = true
    setTokens(undefined)
    setHighlightFailed(false)
    const language = getFiletypeFromFileName(file.path)
    void getSharedHighlighter({themes: ['pierre-light'], langs: [language]}).then((highlighter) => {
      const highlighted = highlighter.codeToTokensBase(file.content, {lang: language, theme: 'pierre-light'})
      if (active) setTokens(highlighted)
    }).catch(() => { if (active) setHighlightFailed(true) })
    return () => { active = false }
  }, [file.content, file.path])
  useEffect(() => {
    if (!tokens && !highlightFailed) return
    requestAnimationFrame(() => focusRow.current?.scrollIntoView?.({block: 'center'}))
  }, [file.path, file.revision, focus.startLine, tokens, highlightFailed])
  useEffect(() => {
    const finishSelection = () => {
      if (dragAnchor.current === null || dragLine.current === null) return
      const range = normalizedLineRange(dragAnchor.current, dragLine.current)
      dragAnchor.current = null
      dragLine.current = null
      setSelectedLines(range)
      onCommentRange(toCommentRange(range, side))
    }
    window.addEventListener('pointerup', finishSelection)
    window.addEventListener('pointercancel', finishSelection)
    return () => {
      window.removeEventListener('pointerup', finishSelection)
      window.removeEventListener('pointercancel', finishSelection)
    }
  }, [onCommentRange, side])
  const annotations = useMemo(() => {
    const byLine = new Map<number, ReviewThread[]>()
    for (const thread of reviewThreads(comments, file.path).filter((item) => (item.root.side ?? 'RIGHT') === side)) {
      if (!thread.root.line) continue
      byLine.set(thread.root.line, [...(byLine.get(thread.root.line) ?? []), thread])
    }
    return byLine
  }, [comments, file.path, side])
  if (!tokens && !highlightFailed) return <div className="evidence-file-loading"><LoaderCircle className="spin" size={14}/>Highlighting file…</div>
  const lines = tokens ?? file.content.split(/\r?\n/).map((line) => [{content: line} as ThemedToken])
  return <div className="evidence-file-renderer" role="table" aria-label={`Highlighted contents of ${file.path}`}>
    {lines.map((line, index) => {
      const number = index + 1
      const focused = number >= focus.startLine && number <= focus.endLine
      const selected = !!selectedLines && number >= Math.min(selectedLines.start, selectedLines.end) && number <= Math.max(selectedLines.start, selectedLines.end)
      const threads = annotations.get(number) ?? []
      return <Fragment key={number}>
        <div ref={number === focus.startLine ? focusRow : undefined} className={`evidence-file-line${focused ? ' focus' : ''}${selected ? ' selected' : ''}`} data-line={number} data-selected-line={selected ? '' : undefined} role="row">
          <button
            type="button"
            data-column-number={number}
            aria-label={`Comment on ${file.revision} line ${number}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              dragAnchor.current = number
              dragLine.current = number
              setSelectedLines({start: number, end: number})
            }}
            onPointerEnter={() => {
              if (dragAnchor.current === null) return
              dragLine.current = number
              setSelectedLines(normalizedLineRange(dragAnchor.current, number))
            }}
            onClick={(event) => {
              if (event.detail !== 0) return
              const range = {start: number, end: number}
              setSelectedLines(range)
              onCommentRange(toCommentRange(range, side))
            }}
          >{number}</button>
          <code role="cell">{line.length ? line.map((token, tokenIndex) => <span key={`${number}-${tokenIndex}`} style={token.color ? {color: token.color} : undefined}>{token.content}</span>) : ' '}</code>
        </div>
        {threads.map((thread) => <div className="evidence-file-annotation" key={thread.root.id}><ReviewThreadAnnotation thread={thread} onReply={onReply} draft={replyDrafts[thread.root.id] ?? {open: false, body: ''}} onDraft={(draft) => setReplyDrafts((current) => ({...current, [thread.root.id]: draft}))}/></div>)}
      </Fragment>
    })}
  </div>
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

function normalizedLineRange(start: number, end: number): SelectedLineRange {
  return start <= end ? {start, end} : {start: end, end: start}
}

function scrollLineIntoView(node: HTMLElement, line: number, side?: 'deletions' | 'additions') {
  requestAnimationFrame(() => {
    const root = node.shadowRoot ?? node
    const candidates = [...root.querySelectorAll<HTMLElement>(`[data-column-number="${line}"]`)]
    const target = side ? candidates.find((candidate) => candidate.closest(`[data-${side}]`)) ?? candidates[0] : candidates[0]
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({block: 'center', behavior: 'smooth'})
  })
}
