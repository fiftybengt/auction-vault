import { useCallback, useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'av-theme'
const listeners = new Set<() => void>()

function readPref(): ThemePref {
  const t = document.documentElement.dataset.theme
  return t === 'light' || t === 'dark' ? t : 'system'
}

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function subscribe(l: () => void) {
  listeners.add(l)
  mq?.addEventListener('change', l)
  return () => {
    listeners.delete(l)
    mq?.removeEventListener('change', l)
  }
}

export function setThemePref(p: ThemePref) {
  if (p === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = p
  try {
    if (p === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    // storage unavailable (private mode); the choice lasts for this page view only
  }
  for (const l of listeners) l()
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, readPref)
  return [pref, useCallback((p: ThemePref) => setThemePref(p), [])]
}

/** The theme actually in effect; charts re-read their colours when it changes. */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () => {
    const p = readPref()
    return p === 'system' ? (mq?.matches ? 'dark' : 'light') : p
  })
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
