import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './theme'

function ThemeProbe() {
  const {preference, resolvedTheme, setPreference} = useTheme()
  return <><output>{preference}:{resolvedTheme}</output><button onClick={() => setPreference('light')}>Use light</button></>
}

function systemAppearance(dark: boolean) {
  let listener: (() => void) | undefined
  const media = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_event: string, next: () => void) => { listener = next }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList
  window.matchMedia = vi.fn(() => media)
  return {media, change: (next: boolean) => { Object.defineProperty(media, 'matches', {value: next, configurable: true}); listener?.() }}
}

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  }})
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('color-scheme')
  vi.restoreAllMocks()
})

describe('ThemeProvider', () => {
  it('follows system appearance and updates when macOS changes', () => {
    const system = systemAppearance(true)
    render(<ThemeProvider><ThemeProbe/></ThemeProvider>)
    expect(screen.getByText('system:dark')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    act(() => system.change(false))
    expect(screen.getByText('system:light')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('persists an explicit preference instead of following system appearance', () => {
    const system = systemAppearance(true)
    render(<ThemeProvider><ThemeProbe/></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', {name: 'Use light'}))
    expect(screen.getByText('light:light')).toBeInTheDocument()
    expect(window.localStorage.getItem('reviewarc:theme')).toBe('light')
    act(() => system.change(false))
    expect(screen.getByText('light:light')).toBeInTheDocument()
  })
})
