import type { UnixSeconds } from './types'

/** Partial scans are never plotted. */
export function completeOnly<T extends { complete: boolean }>(points: T[]): T[] {
  return points.filter((p) => p.complete)
}

export type Range = '7d' | '30d' | 'all'
export const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All' },
]

export function inRange<T extends { at: UnixSeconds }>(points: T[], range: Range, end: UnixSeconds): T[] {
  if (range === 'all') return points
  const days = range === '7d' ? 7 : 30
  const from = end - days * 86400
  return points.filter((p) => p.at >= from)
}
