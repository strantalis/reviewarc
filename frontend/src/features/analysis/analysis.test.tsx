import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AIAnalysisSettings, AnalysisFailurePanel, AnalysisProgress, AnalysisRunDetails, NoHarnessState, recommendedProfile,
} from './analysis'
import type { AnalysisConfiguration, AnalysisRun } from '../../types'

const configuration: AnalysisConfiguration = {
  harnesses: [{
    id: 'codex', label: 'Codex', availability: 'available', eligible: true, version: '1.2.3',
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
    render(<AnalysisProgress running events={[{stage: 'runningCodex', message: 'Running Codex', status: 'running', progress: 42}]} onCancel={vi.fn()}/>)
    expect(screen.getByText('Analyzing the change', {selector: 'strong'})).toBeInTheDocument()
    expect(screen.getByText('Reading changed code and repository context as needed.')).toBeInTheDocument()
    expect(screen.queryByText('Running Codex')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', {name: 'Analyzing the change'})).toHaveAttribute('aria-valuenow', '42')
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
    expect(screen.getByText(/Full diff coverage for 18 of 22 changed files/)).toBeInTheDocument()
    expect(screen.getByText('large.generated.ts')).toBeInTheDocument()
  })
})
