import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const storageKey = 'reviewarc:theme'
const systemThemeQuery = '(prefers-color-scheme: dark)'

function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function readThemePreference(): ThemePreference {
  try { return parseThemePreference(window.localStorage?.getItem?.(storageKey)) }
  catch { return 'system' }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return typeof window.matchMedia === 'function' && window.matchMedia(systemThemeQuery).matches ? 'dark' : 'light'
}

export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme() {
  applyTheme(resolveTheme(readThemePreference()))
}

type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue>({preference: 'system', resolvedTheme: 'light', setPreference: () => {}})

export function ThemeProvider({children}: {children: ReactNode}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => resolveTheme('system'))
  const resolvedTheme = preference === 'system' ? systemTheme : preference

  useLayoutEffect(() => applyTheme(resolvedTheme), [resolvedTheme])
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(systemThemeQuery)
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light')
    onChange()
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next)
    try { window.localStorage?.setItem?.(storageKey, next) }
    catch { /* Appearance still updates when WebView storage is unavailable. */ }
  }

  const value = useMemo(() => ({preference, resolvedTheme, setPreference}), [preference, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
