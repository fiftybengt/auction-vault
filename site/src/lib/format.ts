import type { Copper, UnixSeconds } from './types'

export function splitCopper(c: Copper) {
  const v = Math.round(Math.abs(c))
  return { neg: c < 0, g: Math.floor(v / 10000), s: Math.floor((v % 10000) / 100), c: v % 100 }
}

/** Plain-text money, e.g. `12g 34s 56c`. Zero units are dropped (`8g 83s`); 0 renders as `0c`. */
export function moneyText(c: Copper): string {
  const { neg, g, s, c: cu } = splitCopper(c)
  const parts: string[] = []
  if (g) parts.push(`${g.toLocaleString('en-US')}g`)
  if (s) parts.push(`${s}s`)
  if (cu || parts.length === 0) parts.push(`${cu}c`)
  return (neg ? '-' : '') + parts.join(' ')
}

/** Compact money for axis ticks: 1.2Kg, 340g, 12s, 50c. */
export function moneyCompact(c: Copper): string {
  const a = Math.abs(c)
  if (a >= 10000 * 1000) return `${trim(c / 10000 / 1000)}Kg`
  if (a >= 10000) return `${trim(c / 10000)}g`
  if (a >= 100) return `${trim(c / 100)}s`
  return `${Math.round(c)}c`
}

export function countCompact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e6) return `${trim(n / 1e6)}M`
  if (a >= 1e3) return `${trim(n / 1e3)}K`
  return String(Math.round(n))
}

function trim(v: number): string {
  const a = Math.abs(v)
  return (a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '')
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function ago(at: UnixSeconds, now: number = Date.now() / 1000): string {
  const d = Math.max(0, now - at)
  if (d < 90) return 'just now'
  if (d < 3600) return `${Math.round(d / 60)}m ago`
  if (d < 86400 * 2) return `${Math.round(d / 3600)}h ago`
  return `${Math.round(d / 86400)}d ago`
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export const fullTime = (at: UnixSeconds) => dateTime.format(new Date(at * 1000))
export const shortTime = (at: UnixSeconds) => shortDate.format(new Date(at * 1000))

export const TIME_LEFT: Record<number, string> = { 1: '< 30m', 2: '30m–2h', 3: '2–12h', 4: '12–48h' }

export const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'] as const
export function qualityName(q: number): string {
  return QUALITY_NAMES[q] ?? `Quality ${q}`
}

export function pct(p: number): string {
  return `${p > 0 ? '+' : ''}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`
}
