import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleHelp, LoaderCircle, RefreshCw, Settings, ShieldCheck, Sparkles, X } from 'lucide-react'
import { SelectControl } from '../../components'
import type {
  AnalysisConfiguration, AnalysisFailure, AnalysisProfile, AnalysisRun, DependencyStatus,
  OperationEvent,
} from '../../types'

export function recommendedProfile(configuration: AnalysisConfiguration): AnalysisProfile | undefined {
  if (configuration.defaultProfile) return configuration.defaultProfile
  const harness = configuration.harnesses.find((item) => item.eligible && item.availability === 'available')
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
  const selectedModel = selectedHarness?.models.find((model) => model.id === value?.model) ?? selectedHarness?.models[0]
  const selectedReasoning = selectedModel?.reasoningLevels.find((level) => level.id === value?.reasoning) ?? selectedModel?.reasoningLevels[0]

  const selectHarness = (harnessId: string) => {
    const harness = eligible.find((item) => item.id === harnessId)
    const model = harness?.models.find((item) => item.recommended) ?? harness?.models[0]
    const reasoning = model?.reasoningLevels.find((item) => item.recommended) ?? model?.reasoningLevels[0]
    if (harness && model && reasoning) onChange({harness: harness.id, model: model.id, reasoning: reasoning.id})
  }
  const selectModel = (modelId: string) => {
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
    <label><span>Model</span><SelectControl label="Analysis model" value={selectedModel.id} disabled={disabled} onChange={selectModel} options={selectedHarness.models.map((model) => ({value: model.id, label: model.label}))}/></label>
    <label><span>Reasoning</span><SelectControl label="Analysis reasoning level" value={selectedReasoning.id} disabled={disabled} onChange={selectReasoning} options={selectedModel.reasoningLevels.map((level) => ({value: level.id, label: level.label}))}/></label>
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

export function AnalysisProgress({events, running, reanalysis = false, onCancel}: {events: OperationEvent[]; running: boolean; reanalysis?: boolean; onCancel: () => void}) {
  const current = events.at(-1)
  const currentCopy = current ? (stageCopy[current.stage] ?? {label: 'Analysis in progress', detail: 'ReviewArc is processing the change.'}) : undefined
  return <div className="analysis-events" aria-busy={running}>
    <div className="event-heading"><strong>{running ? (reanalysis ? 'Reanalysis progress' : 'Analysis progress') : 'What happens next'}</strong>{running && <button className="button text small" onClick={onCancel}>Cancel</button>}</div>
    <div className="analysis-live-status" role="status" aria-live="polite">{running ? currentCopy?.label ?? 'Starting analysis' : 'Ready to analyze'}</div>
    {!events.length ? <div className="event-placeholder"><CircleHelp size={17}/><p>{running ? 'Preparing the read-only analysis context…' : 'ReviewArc prepares a bounded context, validates the structured result, checks evidence, and saves the guided review.'}</p></div> : <ol className="event-list">{events.map((event, index) => {
      const copy = stageCopy[event.stage] ?? {label: event.status === 'failed' ? 'Analysis stopped' : 'Analysis in progress', detail: event.status === 'failed' ? 'ReviewArc could not complete this step.' : 'ReviewArc is processing the change.'}
      return <li className="event-row" key={`${event.stage}-${index}`}><span className={event.status ?? 'running'}>{event.status === 'complete' ? <Check size={13}/> : event.status === 'failed' ? <X size={13}/> : <LoaderCircle className="spin" size={13}/>}</span><div><strong>{copy.label}</strong><small>{copy.detail}</small></div>{event.progress != null && <em role="progressbar" aria-label={copy.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(event.progress)}>{Math.round(event.progress)}%</em>}</li>
    })}</ol>}
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

export function AnalysisRunDetails({run, configuration}: {run: AnalysisRun; configuration?: AnalysisConfiguration}) {
  const labels = configuration ? profileLabels(configuration, run.profile) : {harness: run.profile.harness, model: run.profile.model, reasoning: run.profile.reasoning}
  const coverage = `Full diff coverage for ${run.coverage.diffFilesFullyRead} of ${run.coverage.changedFilesTotal} changed files${run.coverage.diffFilesPartiallyRead ? ` · ${run.coverage.diffFilesPartiallyRead} partial` : ''}`
  const completed = run.completedAt ? new Date(run.completedAt).toLocaleString() : 'In progress'
  return <details className="support-disclosure analysis-run-details"><summary><span><ShieldCheck size={16}/>Analysis details</span><small>{labels.harness} · {labels.model} · {labels.reasoning}</small></summary><div className="support-content"><dl>
    <div><dt>Harness</dt><dd>{labels.harness}{run.harnessVersion ? ` ${run.harnessVersion}` : ''}</dd></div>
    <div><dt>Model</dt><dd>{labels.model}</dd></div><div><dt>Reasoning</dt><dd>{labels.reasoning}</dd></div>
    <div><dt>Schema</dt><dd>Version {run.schemaVersion}</dd></div>
    <div><dt>Coverage</dt><dd>{coverage}</dd></div><div><dt>Completed</dt><dd>{completed}</dd></div>
  </dl>{run.coverage.omittedPaths.length ? <details><summary>Files not inspected</summary><ul>{run.coverage.omittedPaths.map((path) => <li key={path}><code>{path}</code></li>)}</ul></details> : null}</div></details>
}

export function AIAnalysisSettings({configuration, busy = false, error = '', onRefresh, onSave}: {configuration: AnalysisConfiguration; busy?: boolean; error?: string; onRefresh: () => void; onSave: (profile: AnalysisProfile) => Promise<void> | void}) {
  const initial = useMemo(() => recommendedProfile(configuration), [configuration])
  const [profile, setProfile] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setProfile(initial); setSaved(false) }, [initial])
  const available = configuration.harnesses.filter((harness) => harness.eligible && harness.availability === 'available')
  const selected = harnessFor(configuration, profile)
  const save = async () => {
    if (!profile) return
    setSaving(true); setSaved(false)
    try { await onSave(profile); setSaved(true) } finally { setSaving(false) }
  }
  return <section className="ai-analysis-settings"><div className="settings-section-heading"><h2>AI Analysis</h2><p>Choose the local AI harness ReviewArc uses for guided reviews.</p></div><div className="settings-section-body">
    {available.length > 0 && profile ? <>
      <AnalysisProfilePicker configuration={configuration} value={profile} onChange={(next) => { setProfile(next); setSaved(false) }} disabled={busy || saving} id="settings-analysis-profile"/>
      <div className="analysis-settings-status"><span className="setup-status available"><Check size={14}/></span><div><strong>{selected?.label} {selected?.version || 'detected'}</strong><small>Structured output and read-only analysis are available.</small></div><button className="button secondary small" disabled={busy || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={13}/> : <Check size={13}/>}Save defaults</button></div>
    </> : <NoHarnessState configuration={configuration} onRefresh={onRefresh}/>}
    <div className="analysis-settings-footer">{available.length > 0 && <button className="button text small" disabled={busy || saving} onClick={onRefresh}>{busy ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>}Check again</button>}{saved && <span role="status">Defaults saved.</span>}{error && <span className="analysis-settings-error" role="alert">{error}</span>}</div>
  </div></section>
}
