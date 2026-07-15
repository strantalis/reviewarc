import { afterEach, describe, expect, it, vi } from 'vitest'
import { backend } from './bridge'

afterEach(() => {
  window.runtime = undefined
})

describe('release notes links', () => {
  it('opens the exact public ReviewArc release origin', () => {
    const openURL = vi.fn()
    window.runtime = {BrowserOpenURL: openURL}
    backend.openReleaseNotesURL('https://www.reviewarc.dev/releases/v0.1.0-beta.6')
    expect(openURL).toHaveBeenCalledWith('https://www.reviewarc.dev/releases/v0.1.0-beta.6')
  })

  it.each([
    'https://reviewarc.dev/releases/v0.1.0-beta.6',
    'https://www.reviewarc.dev.evil.example/releases/v0.1.0-beta.6',
    'https://www.reviewarc.dev:444/releases/v0.1.0-beta.6',
    'https://www.reviewarc.dev/releases/v0.1.0-beta.6?next=evil',
  ])('rejects a noncanonical release URL: %s', (url) => {
    expect(() => backend.openReleaseNotesURL(url)).toThrow('ReviewArc returned an invalid release notes link.')
  })
})

describe('analysis harness bridge', () => {
  it('passes the canonical profile contract to analysis methods', async () => {
    const configuration = {harnesses: []}
    const get = vi.fn().mockResolvedValue(configuration)
    const refresh = vi.fn().mockResolvedValue(configuration)
    const save = vi.fn().mockResolvedValue(configuration)
    const start = vi.fn().mockResolvedValue({id: 'operation-1'})
    window.go = {main: {App: {GetAnalysisConfiguration: get, RefreshAnalysisHarnesses: refresh, SaveAnalysisDefaults: save, StartAnalysisWithProfile: start}}}
    const profile = {harness: 'codex', model: 'gpt-5', reasoning: 'medium'}

    await backend.getAnalysisConfiguration()
    await backend.refreshAnalysisHarnesses()
    await backend.saveAnalysisDefaults(profile)
    await backend.startAnalysis('session-1', {profile, saveAsDefault: true})

    expect(get).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(profile)
    expect(start).toHaveBeenCalledWith('session-1', {profile, saveAsDefault: true})
  })

  it('keeps the one-argument legacy StartAnalysis call', async () => {
    const start = vi.fn().mockResolvedValue({id: 'operation-1'})
    window.go = {main: {App: {StartAnalysis: start}}}
    await backend.startAnalysis('session-1')
    expect(start).toHaveBeenCalledWith('session-1')
  })
})
