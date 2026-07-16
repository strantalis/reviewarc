import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AIAnalysisSettings, AnalysisFailurePanel, AnalysisProgress, AnalysisRunDetails, NoHarnessState, recommendedProfile,
} from './analysis'
import type { AnalysisConfiguration, AnalysisRun } from '../../types'

const configuration: AnalysisConfiguration = {
  harnesses: [{
    id: 'codex', label: 'Codex', availability: 'available', eligible: true, version: '1.2.3', path: '/opt/homebrew/bin/codex',
    capabilities: {jsonSchema: true, readOnly: true, progress: true, contextTransport: ['reviewarcTools']},
    models: [
      {id: 'gpt-5', label: 'GPT-5', recommended: true, reasoningLevels: [{id: 'medium', label: 'Medium', recommended: true}, {id: 'high', label: 'High'}]},
      {id: 'gpt-5-mini', label: 'GPT-5 mini', reasoningLevels: [{id: 'low', label: 'Low'}]},
    ],
  }],
}

describe('analysis configuration components', () => {
  it('selects a complete recommended profile', () => {
    expect(recommendedProfile(configuration)).toEqual({harness: 'codex', model: 'gpt-5', reasoning: 'medium'})
  })

  it('prefers Codex for a first run but honors a saved Claude default', () => {
    const claude = {
      id: 'claude', label: 'Claude Code', availability: 'available' as const, eligible: true,
      capabilities: {jsonSchema: true, readOnly: true, progress: true, contextTransport: ['reviewarcTools' as const]},
      models: [{id: 'sonnet', label: 'Sonnet', recommended: true, reasoningLevels: [{id: 'high', label: 'High', recommended: true}]}],
    }
    const harnesses = [claude, ...configuration.harnesses]
    expect(recommendedProfile({harnesses})).toEqual({harness: 'codex', model: 'gpt-5', reasoning: 'medium'})
    expect(recommendedProfile({harnesses: [claude]})).toEqual({harness: 'claude', model: 'sonnet', reasoning: 'high'})
    expect(recommendedProfile({harnesses, defaultProfile: {harness: 'claude', model: 'sonnet', reasoning: 'high'}})).toEqual({harness: 'claude', model: 'sonnet', reasoning: 'high'})
  })

  it('saves the three-part default from the single AI Analysis section', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<AIAnalysisSettings configuration={configuration} onRefresh={vi.fn()} onSave={onSave}/>)
    expect(screen.getByRole('heading', {name: 'AI Analysis'})).toBeInTheDocument()
    expect(screen.getByRole('combobox', {name: 'Analysis harness'})).toHaveTextContent('Codex')
    expect(screen.getByRole('combobox', {name: 'Analysis model'})).toHaveTextContent('GPT-5')
    expect(screen.getByRole('combobox', {name: 'Analysis reasoning level'})).toHaveTextContent('Medium')
    expect(screen.getByText('/opt/homebrew/bin/codex')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Save defaults'}))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({harness: 'codex', model: 'gpt-5', reasoning: 'medium'}))
    expect(await screen.findByRole('status')).toHaveTextContent('Defaults saved.')
  })

  it('does not show a fallback harness while settings are still loading', () => {
    render(<AIAnalysisSettings configuration={{harnesses: []}} loading onRefresh={vi.fn()} onSave={vi.fn()}/>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading installed analysis harnesses')
    expect(screen.queryByRole('combobox', {name: 'Analysis harness'})).not.toBeInTheDocument()
    expect(screen.queryByText('No compatible AI harness found')).not.toBeInTheDocument()
  })

  it('keeps provider output behind technical details and suppresses unchanged retry', () => {
    const raw = 'codex exited with status 1: input exceeds maximum length'
    const retry = vi.fn()
    const changeProfile = vi.fn()
    render(<AnalysisFailurePanel failure={{code: 'input_too_large', title: 'This change exceeded the analysis limit', message: 'ReviewArc did not repeat the same oversized request.', action: 'replan', technicalDetails: raw}} onRetry={retry} onChangeProfile={changeProfile}/>)
    expect(screen.getByRole('alert')).toHaveTextContent('ReviewArc did not repeat the same oversized request.')
    expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Change analysis setup'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Change analysis setup'}))
    expect(changeProfile).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open')
  })

  it('maps provider-shaped stages to harness-neutral progress copy', () => {
    render(<AnalysisProgress running events={[{stage: 'runningCodex', message: 'Reading src/greet.go lines 10–24', status: 'running', progress: 42}]} onCancel={vi.fn()}/>)
    expect(screen.getByText('Reading src/greet.go lines 10–24', {selector: 'strong'})).toBeInTheDocument()
    expect(screen.getByText('Analyzing the change', {selector: 'small'})).toBeInTheDocument()
    expect(screen.getByRole('progressbar', {name: 'Analyzing the change'})).toHaveAttribute('aria-valuenow', '42')
  })

  it('shows one active indicator and consolidates repeated progress phases', () => {
    const {container} = render(<AnalysisProgress running events={[
      {stage: 'loadingPullRequestContext', message: 'Loading GitHub discussion and checks', status: 'running'},
      {stage: 'preparingSnapshot', message: 'Preparing isolated repository snapshot', status: 'running'},
      {stage: 'preparingContext', message: 'Preparing bounded review context', status: 'running'},
      {stage: 'runningCodex', message: 'Starting read-only analysis', status: 'running'},
      {stage: 'runningCodex', message: 'Reading src/greet.go lines 10–24', status: 'running'},
    ]} onCancel={vi.fn()}/>)
    expect(container.querySelectorAll('.event-row')).toHaveLength(3)
    expect(container.querySelectorAll('.event-row .spin')).toHaveLength(1)
    expect(container.querySelectorAll('.event-row.complete')).toHaveLength(2)
    expect(screen.getAllByText('Preparing review context', {selector: 'strong'})).toHaveLength(1)
    expect(screen.getAllByText('Analyzing the change', {selector: 'small'})).toHaveLength(1)
    expect(screen.getByText('Reading src/greet.go lines 10–24', {selector: 'strong'})).toBeInTheDocument()
  })

  it('shows elapsed and last-activity timing without inventing progress events', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:02:05Z'))
    try {
      render(<AnalysisProgress running events={[
        {stage: 'preparingContext', message: 'Preparing bounded review context', status: 'running', updatedAt: '2026-07-15T12:01:00Z'},
        {stage: 'runningCodex', message: 'Reading src/greet.go lines 10–24', status: 'running', updatedAt: '2026-07-15T12:01:34Z'},
      ]} onCancel={vi.fn()}/>)
      expect(screen.getByText('Running 1m 5s · Last activity 31s ago')).toBeInTheDocument()
      expect(screen.getByText(/No new observable activity for 31s/)).toHaveTextContent('models can be quiet while reasoning or composing a response')
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers recovery when the harness has been quiet for two minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:03:01Z'))
    try {
      render(<AnalysisProgress running events={[
        {stage: 'runningCodex', message: 'Reading src/greet.go lines 10–24', status: 'running', updatedAt: '2026-07-15T12:01:00Z'},
      ]} onCancel={vi.fn()}/>)
      expect(screen.getByText(/No new observable activity for 2m 1s/)).toHaveTextContent('cancel and retry if this appears stuck')
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains the current phase when no concrete model activity is available', () => {
    render(<AnalysisProgress running events={[{stage: 'validatingOutput', message: 'Validating structured output', status: 'running'}]} onCancel={vi.fn()}/>)
    expect(screen.getByText('Validating structured output', {selector: 'strong'})).toBeInTheDocument()
    expect(screen.getByText('Checking the generated review against ReviewArc’s schema.')).toBeInTheDocument()
  })

  it('explains that missing harnesses do not block the rest of ReviewArc', () => {
    const onRefresh = vi.fn()
    render(<NoHarnessState configuration={{harnesses: []}} onRefresh={onRefresh}/>)
    expect(screen.getByRole('heading', {name: 'No compatible AI harness found'})).toBeInTheDocument()
    expect(screen.getByText(/inbox and existing reviews remain available/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Check again'}))
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})

describe('analysis provenance', () => {
  it('renders auditable coverage while keeping old sessions optional at the type boundary', () => {
    const run: AnalysisRun = {
      id: 'run-1', sessionId: 'session-1', profile: {harness: 'codex', model: 'gpt-5', reasoning: 'medium'}, harnessVersion: '1.2.3', contextTransport: 'reviewarcTools', schemaVersion: 2, inputFingerprint: 'fixture',
      coverage: {changedFilesTotal: 22, diffFilesFullyRead: 18, diffFilesPartiallyRead: 4, diffFilesUnread: 0, diffBytesTotal: 1200, diffBytesRead: 1000, segments: 1, omittedPaths: ['large.generated.ts'], accesses: []},
      startedAt: '2026-07-15T12:00:00Z', completedAt: '2026-07-15T12:04:00Z', updatedAt: '2026-07-15T12:04:00Z', status: 'completed',
    }
    render(<AnalysisRunDetails run={run} configuration={configuration}/>)
    expect(screen.getByText('Analysis details')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Analysis details'))
    expect(screen.getByText(/22 changed files · 18 fully read · 4 partially read/)).toBeInTheDocument()
    expect(screen.getByText('large.generated.ts')).toBeInTheDocument()
  })

  it('explains preview-only files and reports separate source reads', () => {
    const run: AnalysisRun = {
      id: 'run-preview', sessionId: 'session-1', profile: {harness: 'claude', model: 'sonnet', reasoning: 'medium'}, contextTransport: 'reviewarcTools', schemaVersion: 1, inputFingerprint: 'fixture',
      coverage: {changedFilesTotal: 3, diffFilesFullyRead: 1, diffFilesPartiallyRead: 0, diffFilesPreviewed: 2, diffFilesUnseen: 0, diffFilesUnread: 2, diffBytesTotal: 1200, diffBytesRead: 500, segments: 1, omittedPaths: ['README.md', 'examples/tool/main.go'], previewedPaths: ['README.md', 'examples/tool/main.go'], unseenPaths: [], accesses: [{kind: 'read_file', path: 'examples/tool/main.go', revision: 'head', startLine: 1, endLine: 30, bytes: 900, at: '2026-07-15T12:00:30Z'}]},
      startedAt: '2026-07-15T12:00:00Z', completedAt: '2026-07-15T12:04:00Z', updatedAt: '2026-07-15T12:04:00Z', status: 'completed',
    }
    render(<AnalysisRunDetails run={run} configuration={configuration} open/>)
    expect(screen.getByText(/bounded sample from each diff/)).toHaveTextContent('does not receive a file-specific skip reason')
    expect(screen.getByText('README.md').nextSibling).toHaveTextContent('Bounded diff sample only')
    expect(screen.getByText('examples/tool/main.go').nextSibling).toHaveTextContent('1 source range opened separately')
  })
})
