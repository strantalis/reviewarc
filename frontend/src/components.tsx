import { useRef, type ReactNode } from 'react'
import * as RadixSelect from '@radix-ui/react-select'
import { AlertTriangle, Check, ChevronDown, Circle, Clock3, LoaderCircle, Minus, Plus, ShieldAlert, Sparkles, X } from 'lucide-react'
import { Quit, WindowMinimise, WindowToggleMaximise } from '../wailsjs/runtime/runtime'
import type { AnalysisStatus, ChapterStatus, DependencyStatus, RiskLevel } from './types'
import { analysisLabel, chapterStatusLabel, riskLabel } from './lib'
import reviewArcMark from './assets/reviewarc-mark.svg'

export function Logo({compact = false}: {compact?: boolean}) {
  return <div className="brand" aria-label="ReviewArc"><img className="brand-mark" src={reviewArcMark} alt="" width="31" height="25"/>{!compact && <strong>ReviewArc</strong>}</div>
}

export function WindowControls() {
  return <div className="window-controls" role="group" aria-label="Window controls">
    <button className="window-control close" aria-label="Close ReviewArc" title="Close" onClick={Quit}><X size={10}/></button>
    <button className="window-control minimise" aria-label="Minimize ReviewArc" title="Minimize" onClick={WindowMinimise}><Minus size={10}/></button>
    <button className="window-control zoom" aria-label="Zoom ReviewArc" title="Zoom" onClick={WindowToggleMaximise}><Plus size={10}/></button>
  </div>
}

export type SelectOption = {value: string; label: string; description?: string}

export function SelectControl({label, value, options, onChange, disabled = false, className = '', help, icon}: {label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; className?: string; help?: string; icon?: ReactNode}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const openedByPointer = useRef(false)
  return <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
    <RadixSelect.Trigger ref={trigger} className={`select-trigger ${className}`.trim()} aria-label={label} title={help} onPointerDown={() => { openedByPointer.current = true }} onKeyDown={() => { openedByPointer.current = false }}>
      {icon}<RadixSelect.Value/><RadixSelect.Icon className="select-chevron"><ChevronDown size={14}/></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal>
      <RadixSelect.Content className="select-content" position="popper" sideOffset={5} collisionPadding={8} onCloseAutoFocus={(event) => {
        if (!openedByPointer.current) return
        event.preventDefault()
        trigger.current?.blur()
        openedByPointer.current = false
      }}>
        <RadixSelect.Viewport className="select-viewport">
          {options.map((option) => <RadixSelect.Item className="select-option" value={option.value} key={option.value}>
            <RadixSelect.ItemIndicator><Check size={14}/></RadixSelect.ItemIndicator>
            <span><RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>{option.description && <small>{option.description}</small>}</span>
          </RadixSelect.Item>)}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>
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

export function ErrorBanner({title = 'Something went wrong', message, onRetry, actionLabel = 'Try again'}: {title?: string; message: string; onRetry?: () => void; actionLabel?: string}) {
  return <div className="error-banner" role="alert"><AlertTriangle size={18}/><div><strong>{title}</strong><p>{message}</p></div>{onRetry && <button className="button secondary small" onClick={onRetry}>{actionLabel}</button>}</div>
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
