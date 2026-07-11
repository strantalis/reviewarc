import type { ReactNode } from 'react'
import { AlertTriangle, Check, Circle, Clock3, LoaderCircle, ShieldAlert, Sparkles } from 'lucide-react'
import type { AnalysisStatus, ChapterStatus, DependencyStatus, RiskLevel } from './types'
import { analysisLabel, chapterStatusLabel, riskLabel } from './lib'

export function Logo({compact = false}: {compact?: boolean}) {
  return <div className="brand" aria-label="ReviewArc"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>{!compact && <strong>ReviewArc</strong>}</div>
}

export function StatusDot({status}: {status: ChapterStatus}) {
  const Icon = status === 'reviewed' ? Check : status === 'blocked' ? ShieldAlert : status === 'needsClarification' ? AlertTriangle : status === 'inProgress' ? Clock3 : Circle
  return <span className={`chapter-dot status-${status}`} title={chapterStatusLabel(status)}><Icon size={13}/></span>
}

export function RiskBadge({level}: {level: RiskLevel}) { return <span className={`badge risk-${level}`}><ShieldAlert size={12}/>{riskLabel(level)}</span> }
export function AnalysisBadge({status}: {status: AnalysisStatus}) {
  const Icon = status === 'running' ? LoaderCircle : status === 'ready' ? Sparkles : status === 'failed' || status === 'stale' ? AlertTriangle : Circle
  return <span className={`badge analysis-${status}`}><Icon className={status === 'running' ? 'spin' : ''} size={12}/>{analysisLabel(status)}</span>
}

export function DependencyPills({dependencies}: {dependencies: DependencyStatus[]}) {
  return <div className="dependency-pills" aria-label="Dependency status">{dependencies.map((dep) => <span key={dep.name} className={`dependency ${dep.state}`} title={dep.message || dep.path}><span aria-hidden="true">{dep.state === 'available' ? '●' : '!'}</span>{dep.name}</span>)}</div>
}

export function EmptyState({icon, title, children, action}: {icon: ReactNode; title: string; children: ReactNode; action?: ReactNode}) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><div className="empty-copy">{children}</div>{action}</div>
}

export function Skeleton({rows = 5}: {rows?: number}) { return <div className="skeleton-list" aria-label="Loading">{Array.from({length: rows}, (_, i) => <div className="skeleton-row" key={i}><i/><span/><b/></div>)}</div> }

export function ErrorBanner({title = 'Something went wrong', message, onRetry}: {title?: string; message: string; onRetry?: () => void}) {
  return <div className="error-banner" role="alert"><AlertTriangle size={18}/><div><strong>{title}</strong><p>{message}</p></div>{onRetry && <button className="button secondary small" onClick={onRetry}>Try again</button>}</div>
}

function inlineMarkdown(value: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g)
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    return part
  })
}

/** A deliberately small, safe renderer for GitHub-flavoured PR descriptions. React escapes all text. */
export function Markdown({children, className = ''}: {children: string; className?: string}) {
  const blocks: ReactNode[] = []
  const lines = children.replaceAll('\r\n', '\n').split('\n')
  let paragraph: string[] = []
  let list: string[] = []
  let code: string[] | undefined
  const flushParagraph = () => { if (paragraph.length) blocks.push(<p key={`p-${blocks.length}`}>{inlineMarkdown(paragraph.join(' '))}</p>); paragraph = [] }
  const flushList = () => { if (list.length) blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</ul>); list = [] }
  const flushCode = () => { if (code) blocks.push(<pre key={`pre-${blocks.length}`}><code>{code.join('\n')}</code></pre>); code = undefined }
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) { flushParagraph(); flushList(); code ? flushCode() : code = []; continue }
    if (code) { code.push(line); continue }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; blocks.push(level === 1 ? <h2 key={`h-${blocks.length}`}>{inlineMarkdown(heading[2])}</h2> : <h3 key={`h-${blocks.length}`}>{inlineMarkdown(heading[2])}</h3>); continue }
    const item = line.match(/^\s*[-*]\s+(.+)$/)
    if (item) { flushParagraph(); list.push(item[1]); continue }
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    flushList(); paragraph.push(line.trim())
  }
  flushParagraph(); flushList(); flushCode()
  return <div className={`markdown ${className}`.trim()}>{blocks}</div>
}
