import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleHelp, Clock3, LoaderCircle, RefreshCw, Settings, ShieldCheck, Sparkles, X } from 'lucide-react'
import { SelectControl } from '../../components'
import type {
  AnalysisConfiguration, AnalysisCoverage, AnalysisFailure, AnalysisProfile, AnalysisRun, DependencyStatus, HarnessDescriptor,
  OperationEvent,
} from '../../types'

const customModelOption = '__reviewarc_custom_model__'

function validCustomModelID(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 256 && !trimmed.startsWith('-') && !/[\s\u0000-\u001f\u007f]/u.test(trimmed)
}

function fixedModel(harness: HarnessDescriptor | undefined, modelID: string | undefined) {
  return harness?.models.find((model) => model.id === modelID)
}

export function analysisProfileReady(configuration: AnalysisConfiguration, profile?: AnalysisProfile) {
  const harness = configuration.harnesses.find((item) => item.id === profile?.harness && item.eligible && item.availability === 'available')
  const model = fixedModel(harness, profile?.model)
  if (model) return model.reasoningLevels.some((level) => level.id === profile?.reasoning)
  return Boolean(harness?.customModel && profile && validCustomModelID(profile.model) && harness.customModel.reasoningLevels.some((level) => level.id === profile.reasoning))
}

export function recommendedProfile(configuration: AnalysisConfiguration): AnalysisProfile | undefined {
  if (configuration.defaultProfile) return configuration.defaultProfile
  const available = configuration.harnesses.filter((item) => item.eligible && item.availability === 'available')
  const harness = available.find((item) => item.id === 'codex') ?? available[0]
  const model = harness?.models.find((item) => item.recommended) ?? harness?.models[0]
  const reasoning = model?.reasoningLevels.find((item) => item.recommended) ?? model?.reasoningLevels[0]
  return harness && model && reasoning ? {harness: harness.id, model: model.id, reasoning: reasoning.id} : undefined
}

export function legacyAnalysisConfiguration(dependencies: DependencyStatus[]): AnalysisConfiguration {
  const codex = dependencies.find((dependency) => dependency.name === 'codex')
  if (!codex || codex.state !== 'available') return {harnesses: []}
  const profile = {harness: 'codex', model: 'default', reasoning: 'default'}
  return {
    defaultProfile: profile,
    harnesses: [{
      id: 'codex', label: 'Codex', availability: 'available', eligible: true, path: codex.path, version: codex.version,
      capabilities: {jsonSchema: true, readOnly: true, progress: true, contextTransport: ['artifactFiles']},
      models: [{id: 'default', label: 'Default model', recommended: true, reasoningLevels: [{id: 'default', label: 'Default', recommended: true}]}],
    }],
  }
}

function harnessFor(configuration: AnalysisConfiguration, profile?: AnalysisProfile) {
  return configuration.harnesses.find((harness) => harness.id === profile?.harness)
}

export function profileLabels(configuration: AnalysisConfiguration, profile?: AnalysisProfile) {
  const harness = harnessFor(configuration, profile)
  const model = harness?.models.find((item) => item.id === profile?.model)
  const reasoning = model?.reasoningLevels.find((item) => item.id === profile?.reasoning)
  return {
    harness: harness?.label ?? profile?.harness ?? 'Not configured',
    model: model?.label ?? profile?.model ?? 'No model',
    reasoning: reasoning?.label ?? profile?.reasoning ?? 'No reasoning level',
  }
}

export function AnalysisProfileSummary({configuration, profile, onChange, expanded = false}: {configuration: AnalysisConfiguration; profile?: AnalysisProfile; onChange?: () => void; expanded?: boolean}) {
  const labels = profileLabels(configuration, profile)
  return <div className="analysis-profile-summary" aria-label={`Analysis profile: ${labels.harness}, ${labels.model}, ${labels.reasoning}`}>
    <span><Sparkles size={14}/><strong>{labels.harness}</strong><i>·</i><span>{labels.model}</span><i>·</i><span>{labels.reasoning}</span></span>
    {onChange && <button type="button" className="button text small" aria-expanded={expanded} aria-controls="analysis-profile-override" onClick={onChange}>{expanded ? 'Done' : 'Change'}</button>}
  </div>
}

export function AnalysisProfilePicker({configuration, value, onChange, disabled = false, id = 'analysis-profile-picker'}: {configuration: AnalysisConfiguration; value?: AnalysisProfile; onChange: (profile: AnalysisProfile) => void; disabled?: boolean; id?: string}) {
  const eligible = configuration.harnesses.filter((harness) => harness.eligible && harness.availability === 'available' && harness.models.length > 0)
  const selectedHarness = eligible.find((harness) => harness.id === value?.harness) ?? eligible[0]
  const selectedFixedModel = fixedModel(selectedHarness, value?.model)
  const customSelected = Boolean(selectedHarness?.customModel && value?.harness === selectedHarness.id && !selectedFixedModel)
  const selectedModel = selectedFixedModel ?? (customSelected ? selectedHarness?.customModel : selectedHarness?.models[0])
  const selectedReasoning = selectedModel?.reasoningLevels.find((level) => level.id === value?.reasoning) ?? selectedModel?.reasoningLevels[0]

  const selectHarness = (harnessId: string) => {
    const harness = eligible.find((item) => item.id === harnessId)
    const model = harness?.models.find((item) => item.recommended) ?? harness?.models[0]
    const reasoning = model?.reasoningLevels.find((item) => item.recommended) ?? model?.reasoningLevels[0]
    if (harness && model && reasoning) onChange({harness: harness.id, model: model.id, reasoning: reasoning.id})
  }
  const selectModel = (modelId: string) => {
    if (modelId === customModelOption) {
      const model = selectedHarness?.customModel
      const reasoning = model?.reasoningLevels.find((item) => item.recommended) ?? model?.reasoningLevels[0]
      if (selectedHarness && model && reasoning) onChange({harness: selectedHarness.id, model: '', reasoning: reasoning.id})
      return
    }
    const model = selectedHarness?.models.find((item) => item.id === modelId)
    const reasoning = model?.reasoningLevels.find((item) => item.recommended) ?? model?.reasoningLevels[0]
    if (selectedHarness && model && reasoning) onChange({harness: selectedHarness.id, model: model.id, reasoning: reasoning.id})
  }
  const selectReasoning = (reasoning: string) => {
    if (selectedHarness && selectedModel) onChange({harness: selectedHarness.id, model: selectedModel.id, reasoning})
  }

  if (!selectedHarness || !selectedModel || !selectedReasoning) return null
  return <div className="analysis-profile-picker" id={id}>
    <label><span>Harness</span><SelectControl label="Analysis harness" value={selectedHarness.id} disabled={disabled} onChange={selectHarness} options={eligible.map((harness) => ({value: harness.id, label: harness.label, description: harness.version}))}/></label>
    <label><span>Model</span><SelectControl label="Analysis model" value={customSelected ? customModelOption : selectedModel.id} disabled={disabled} onChange={selectModel} options={[...selectedHarness.models.map((model) => ({value: model.id, label: model.label})), ...(selectedHarness.customModel ? [{value: customModelOption, label: 'Custom model ID…'}] : [])]}/></label>
    <label><span>Reasoning</span><SelectControl label="Analysis reasoning level" value={selectedReasoning.id} disabled={disabled} onChange={selectReasoning} options={selectedModel.reasoningLevels.map((level) => ({value: level.id, label: level.label}))}/></label>
    {customSelected && <label className="analysis-custom-model"><span>Custom model ID</span><input aria-label="Custom model ID" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} disabled={disabled} value={value?.model ?? ''} onChange={(event) => onChange({harness: selectedHarness.id, model: event.target.value, reasoning: selectedReasoning.id})} placeholder="Exact model ID accepted by Claude Code"/><small>Use the provider or managed model ID exactly as Claude Code expects it.</small></label>}
  </div>
}

const stageCopy: Record<string, {label: string; detail: string}> = {
  loadingPullRequestContext: {label: 'Loading review context', detail: 'Collecting pull request discussion and checks.'},
  preparingSnapshot: {label: 'Preparing review context', detail: 'Creating an isolated, read-only repository snapshot.'},
  preparingContext: {label: 'Preparing review context', detail: 'Creating a bounded analysis bundle.'},
  planningAnalysis: {label: 'Planning analysis', detail: 'Choosing the relevant changes and evidence to inspect.'},
  runningCodex: {label: 'Analyzing the change', detail: 'Reading changed code and repository context as needed.'},
  analyzingChange: {label: 'Analyzing the change', detail: 'Reading changed code and repository context as needed.'},
  validatingOutput: {label: 'Validating structured output', detail: 'Checking the generated review against ReviewArc’s schema.'},
  validatingEvidence: {label: 'Checking evidence', detail: 'Verifying referenced paths and line ranges.'},
  savingAnalysis: {label: 'Saving guided review', detail: 'Persisting the validated review and its provenance.'},
  savingReview: {label: 'Saving guided review', detail: 'Persisting the validated review and its provenance.'},
  cancelled: {label: 'Analysis canceled', detail: 'No repository files were changed.'},
}

function durationLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

export function AnalysisProgress({events, running, reanalysis = false, onCancel}: {events: OperationEvent[]; running: boolean; reanalysis?: boolean; onCancel: () => void}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const current = events.at(-1)
  const currentCopy = current ? (stageCopy[current.stage] ?? {label: 'Analysis in progress', detail: 'ReviewArc is processing the change.'}) : undefined
  const liveStatus = current && currentCopy ? `${currentCopy.label}: ${current.message || currentCopy.detail}` : 'Starting analysis'
  const steps = events.reduce<Array<{event: OperationEvent; copy: {label: string; detail: string}}>>((result, event) => {
    const copy = stageCopy[event.stage] ?? {label: event.status === 'failed' ? 'Analysis stopped' : 'Analysis in progress', detail: event.status === 'failed' ? 'ReviewArc could not complete this step.' : 'ReviewArc is processing the change.'}
    const existing = result.findIndex((step) => step.copy.label === copy.label)
    if (existing >= 0) result[existing] = {event, copy}
    else result.push({event, copy})
    return result
  }, [])
  const startedAt = events.find((event) => event.updatedAt)?.updatedAt
  const lastActivityAt = current?.updatedAt
  const startedTime = startedAt ? Date.parse(startedAt) : Number.NaN
  const lastActivityTime = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN
  const elapsed = Number.isFinite(startedTime) ? Math.max(0, now - startedTime) : undefined
  const quietFor = Number.isFinite(lastActivityTime) ? Math.max(0, now - lastActivityTime) : undefined
  const timing = elapsed == null || quietFor == null ? '' : `Running ${durationLabel(elapsed)} · ${quietFor < 5000 ? 'Activity just now' : `Last activity ${durationLabel(quietFor)} ago`}`
  const quietMessage = quietFor != null && quietFor >= 120000
    ? `No new harness event for ${durationLabel(quietFor)}. The process is still running; cancel and retry if this appears stuck.`
    : quietFor != null && quietFor >= 30000
      ? `No new harness event for ${durationLabel(quietFor)}. It may still be working; some harness phases do not expose intermediate activity.`
      : ''
  return <div className="analysis-events" aria-busy={running}>
    <div className="event-heading"><strong>{running ? (reanalysis ? 'Reanalysis progress' : 'Analysis progress') : 'What happens next'}</strong>{running && <button className="button text small" onClick={onCancel}>Cancel</button>}</div>
    <div className="analysis-live-status" role="status" aria-live="polite">{running ? liveStatus : 'Ready to analyze'}</div>
    {running && timing && <div className="event-timing"><Clock3 size={13}/><span>{timing}</span></div>}
    {!steps.length ? <div className="event-placeholder"><CircleHelp size={17}/><p>{running ? 'Preparing the read-only analysis context…' : 'ReviewArc prepares a bounded context, validates the structured result, checks evidence, and saves the guided review.'}</p></div> : <ol className="event-list">{steps.map(({event, copy}, index) => {
      const currentStep = index === steps.length - 1
      const status = event.status === 'failed' ? 'failed' : currentStep && running && event.status !== 'complete' ? 'running' : 'complete'
      const activity = event.message?.trim()
      const distinctActivity = activity && activity !== copy.label && activity !== copy.detail
      const primary = status === 'running' && distinctActivity ? activity : copy.label
      const secondary = status === 'running' ? (distinctActivity ? copy.label : copy.detail) : activity || copy.detail
      return <li className={`event-row ${status}`} key={copy.label}><span className={status}>{status === 'complete' ? <Check size={13}/> : status === 'failed' ? <X size={13}/> : <LoaderCircle className="spin" size={13}/>}</span><div><strong>{primary}</strong>{secondary !== primary && <small>{secondary}</small>}</div>{status === 'running' && event.progress != null && <em role="progressbar" aria-label={copy.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(event.progress)}>{Math.round(event.progress)}%</em>}</li>
    })}</ol>}
    {running && quietMessage && <p className="event-quiet-note">{quietMessage}</p>}
  </div>
}

export function AnalysisFailurePanel({failure, onRetry, onRefresh, onChangeProfile, onOpenSettings}: {failure: AnalysisFailure; onRetry?: () => void; onRefresh?: () => void; onChangeProfile?: () => void; onOpenSettings?: () => void}) {
  const action = failure.action === 'retry' ? {label: 'Try again', run: onRetry}
    : failure.action === 'replan' ? {label: 'Change analysis setup', run: onChangeProfile}
      : failure.action === 'changeProfile' ? {label: 'Change analysis setup', run: onChangeProfile}
        : failure.action === 'configure' || failure.action === 'authenticate' ? {label: 'Open settings', run: onOpenSettings}
          : undefined
  return <div className="analysis-failure" role="alert"><AlertTriangle size={18}/><div><strong>{failure.title}</strong><p>{failure.message}</p>{failure.technicalDetails && <details><summary>Technical details</summary><pre>{failure.technicalDetails}</pre></details>}</div>{action?.run && <button className="button secondary small" onClick={action.run}>{action.label}</button>}</div>
}

export function NoHarnessState({configuration, onRefresh, onOpenSettings}: {configuration: AnalysisConfiguration; onRefresh: () => void; onOpenSettings?: () => void}) {
  const unavailable = configuration.harnesses.filter((harness) => !harness.eligible || harness.availability !== 'available')
  return <div className="no-harness-state"><span><AlertTriangle size={20}/></span><div><h3>No compatible AI harness found</h3><p>Install or update a supported harness, then check again. Your inbox and existing reviews remain available.</p><div className="no-harness-actions"><button className="button secondary" onClick={onRefresh}><RefreshCw size={14}/>Check again</button>{onOpenSettings && <button className="button text" onClick={onOpenSettings}><Settings size={14}/>Open AI Analysis settings</button>}</div>{unavailable.length > 0 && <details><summary>Why isn’t my harness available?</summary>{unavailable.map((harness) => <p key={harness.id}><strong>{harness.label}:</strong> {harness.message || 'This harness does not meet ReviewArc’s structured-output and read-only requirements.'}</p>)}</details>}</div></div>
}

export function AnalysisRunDetails({run, configuration, open, onOpenChange}: {run: AnalysisRun; configuration?: AnalysisConfiguration; open?: boolean; onOpenChange?: (open: boolean) => void}) {
  const labels = configuration ? profileLabels(configuration, run.profile) : {harness: run.profile.harness, model: run.profile.model, reasoning: run.profile.reasoning}
  const breakdown = analysisCoverageBreakdown(run.coverage)
  const coverage = `${breakdown.total} changed files · ${breakdown.parts.join(' · ')}`
  const completed = run.completedAt ? new Date(run.completedAt).toLocaleString() : 'In progress'
  const sourceReads = (path: string) => run.coverage.accesses.filter((access) => access.kind === 'read_file' && access.path === path).length
  const previewDecision = (path: string) => run.coverage.previewDecisions?.find((decision) => decision.path === path)
  const coveragePaths = (paths: string[], kind: 'previewed' | 'unseen' | 'legacy') => <section className="analysis-coverage-files" aria-label={kind === 'previewed' ? 'Files previewed without a full diff read' : 'Files not fully inspected'}>
    <header><h3 data-analysis-coverage-kind={kind} tabIndex={-1}>{paths.length} {kind === 'previewed' ? `file${paths.length === 1 ? '' : 's'} previewed only` : kind === 'unseen' ? `file${paths.length === 1 ? '' : 's'} not inspected` : `file${paths.length === 1 ? '' : 's'} not fully read`}</h3><small>{kind === 'previewed' ? 'Full diff not read' : 'Coverage gap'}</small></header>
    <ul>{paths.map((path) => {
      const reads = sourceReads(path)
      const decision = previewDecision(path)
      return <li key={path}><code title={path}>{path}</code>{kind === 'previewed' && <small>{decision ? <>Harness reason · {decision.reason}</> : 'No harness reason recorded for this run'}</small>}{kind === 'previewed' && reads > 0 && <small>{reads} source range{reads === 1 ? '' : 's'} opened separately</small>}</li>
    })}</ul>
  </section>
  return <details id="analysis-run-details" className="support-disclosure analysis-run-details" open={open} onToggle={(event) => onOpenChange?.(event.currentTarget.open)}><summary><span><ShieldCheck size={16}/>Analysis details</span><small>{labels.harness} · {labels.model} · {labels.reasoning}</small></summary><div className="support-content"><dl>
    <div><dt>Harness</dt><dd>{labels.harness}{run.harnessVersion ? ` ${run.harnessVersion}` : ''}</dd></div>
    <div><dt>Model</dt><dd>{labels.model}</dd></div><div><dt>Reasoning</dt><dd>{labels.reasoning}</dd></div>
    <div><dt>Schema</dt><dd>Version {run.schemaVersion}</dd></div>
    <div><dt>Coverage</dt><dd>{coverage}</dd></div><div><dt>Completed</dt><dd>{completed}</dd></div>
  </dl>{run.coverage.previewedPaths?.length ? coveragePaths(run.coverage.previewedPaths, 'previewed') : null}{run.coverage.unseenPaths?.length ? coveragePaths(run.coverage.unseenPaths, 'unseen') : null}{!run.coverage.previewedPaths && !run.coverage.unseenPaths && run.coverage.omittedPaths.length ? coveragePaths(run.coverage.omittedPaths, 'legacy') : null}</div></details>
}

export function analysisCoverageBreakdown(coverage: AnalysisCoverage) {
  const previewed = coverage.diffFilesPreviewed ?? 0
  const unseen = coverage.diffFilesUnseen ?? Math.max(0, coverage.diffFilesUnread - previewed)
  const parts = [
    `${coverage.diffFilesFullyRead} fully read`,
    coverage.diffFilesPartiallyRead ? `${coverage.diffFilesPartiallyRead} partially read` : '',
    previewed ? `${previewed} previewed` : '',
    unseen ? `${unseen} unseen` : '',
  ].filter(Boolean)
  return {total: coverage.changedFilesTotal, fullyRead: coverage.diffFilesFullyRead, partiallyRead: coverage.diffFilesPartiallyRead, previewed, unseen, parts}
}

export function AIAnalysisSettings({configuration, loading = false, busy = false, error = '', onRefresh, onSave}: {configuration: AnalysisConfiguration; loading?: boolean; busy?: boolean; error?: string; onRefresh: () => void; onSave: (profile: AnalysisProfile) => Promise<void> | void}) {
  const initial = useMemo(() => recommendedProfile(configuration), [configuration])
  const [profile, setProfile] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setProfile(initial); setSaved(false) }, [initial])
  const available = configuration.harnesses.filter((harness) => harness.eligible && harness.availability === 'available')
  const selected = harnessFor(configuration, profile)
  const profileReady = analysisProfileReady(configuration, profile)
  const save = async () => {
    if (!profile) return
    setSaving(true); setSaved(false)
    try { await onSave(profile); setSaved(true) } finally { setSaving(false) }
  }
  return <section className="ai-analysis-settings"><div className="settings-section-heading"><h2>AI Analysis</h2><p>Choose the local AI harness ReviewArc uses for guided reviews.</p></div><div className="settings-section-body">
    {loading ? <div className="analysis-settings-status" role="status"><LoaderCircle className="spin" size={14}/><div><strong>Loading installed analysis harnesses…</strong><small>ReviewArc will show the saved default when inspection completes.</small></div></div> : available.length > 0 && profile ? <>
      <AnalysisProfilePicker configuration={configuration} value={profile} onChange={(next) => { setProfile(next); setSaved(false) }} disabled={busy || saving} id="settings-analysis-profile"/>
      <div className="analysis-settings-status"><span className="setup-status available"><Check size={14}/></span><div><strong>{selected?.label} {selected?.version || 'detected'}</strong><small>Structured output and read-only analysis are available.</small>{selected?.path && <code title={selected.path}>{selected.path}</code>}</div><button className="button secondary small" disabled={busy || saving || !profileReady} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={13}/> : <Check size={13}/>}Save defaults</button></div>
    </> : <NoHarnessState configuration={configuration} onRefresh={onRefresh}/>}
    <div className="analysis-settings-footer">{available.length > 0 && <button className="button text small" disabled={busy || saving} onClick={onRefresh}>{busy ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>}Check again</button>}{saved && <span role="status">Defaults saved.</span>}{error && <span className="analysis-settings-error" role="alert">{error}</span>}</div>
  </div></section>
}
