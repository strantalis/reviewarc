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
