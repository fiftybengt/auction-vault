import { useSyncExternalStore } from 'react'
import type { Dashboard, IndexFile, IndexRow, ItemFile, Market, Meta, Movers, Overview, SellerFile } from './types'

// One fetch per file per page load. Entries are immutable snapshots so useSyncExternalStore
// can compare them by reference.
export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'missing' }
  | { status: 'error'; error: string }

const cache = new Map<string, Resource<unknown>>()
const listeners = new Set<() => void>()
const LOADING: Resource<never> = { status: 'loading' }

function notify() {
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path}`
}

function load(path: string) {
  if (cache.has(path)) return
  cache.set(path, LOADING)
  fetch(dataUrl(path))
    .then(async (res) => {
      if (res.status === 404) return { status: 'missing' } as const
      if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` } as const
      // Vite's dev server answers unknown paths with index.html; treat non-JSON as missing.
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) return { status: 'missing' } as const
      return { status: 'ready', data: (await res.json()) as unknown } as const
    })
    .catch((e: unknown) => ({ status: 'error', error: e instanceof Error ? e.message : String(e) }) as const)
    .then((r) => {
      cache.set(path, r)
      notify()
    })
}

export function useJson<T>(path: string | null): Resource<T> {
  if (path) load(path)
  const snap = useSyncExternalStore(subscribe, () => (path ? (cache.get(path) ?? LOADING) : LOADING))
  return snap as Resource<T>
}

export const useMarkets = () => useJson<Market[]>('markets.json')
export const useMeta = (m: string) => useJson<Meta>(`${m}/meta.json`)
export const useOverview = (m: string) => useJson<Overview>(`${m}/overview.json`)
export const useMovers = (m: string) => useJson<Movers>(`${m}/movers.json`)
export const useDashboard = (m: string) => useJson<Dashboard>(`${m}/dashboard.json`)
export const useItem = (m: string, key: string) => useJson<ItemFile>(`${m}/items/${encodeURIComponent(keyToFile(key))}.json`)
export const useSeller = (m: string, name: string) => useJson<SellerFile>(`${m}/sellers/${encodeURIComponent(name)}.json`)

/** `13071:0` -> `13071_0` (C4 filename rule). Also used for URLs. */
export function keyToFile(key: string): string {
  return key.replace(':', '_')
}
export function fileToKey(file: string): string {
  return file.replace('_', ':')
}

/** `40211:0` -> `{ id: 40211, suffix: 0 }`. Accepts the file form `40211_0` too. */
export function parseItemKey(key: string): { id: number; suffix: number } {
  const [id = '', suffix = '0'] = key.split(/[:_]/)
  return { id: Number(id) || 0, suffix: Number(suffix) || 0 }
}

// index.json is columnar; decode it once per market.
const decoded = new WeakMap<IndexFile, IndexRow[]>()
export function decodeIndex(file: IndexFile): IndexRow[] {
  const hit = decoded.get(file)
  if (hit) return hit
  const at = (name: string) => file.cols.indexOf(name)
  const c = {
    key: at('key'),
    id: at('id'),
    name: at('name'),
    quality: at('quality'),
    icon: at('icon'),
    class: at('class'),
    subclass: at('subclass'),
    median: at('median'),
    min: at('min'),
    listings: at('listings'),
    lastSeenAt: at('lastSeenAt'),
  }
  const rows = file.rows.map(
    (r): IndexRow => ({
      key: String(r[c.key]),
      id: Number(r[c.id]),
      name: String(r[c.name] ?? ''),
      quality: Number(r[c.quality] ?? 1),
      // C4 v3; a pre-v3 index has no icon column (indexOf -1 -> undefined -> null).
      icon: r[c.icon] == null || r[c.icon] === '' ? null : String(r[c.icon]),
      class: String(r[c.class] ?? ''),
      subclass: String(r[c.subclass] ?? ''),
      median: r[c.median] == null ? null : Number(r[c.median]),
      min: r[c.min] == null ? null : Number(r[c.min]),
      listings: Number(r[c.listings] ?? 0),
      lastSeenAt: r[c.lastSeenAt] == null ? null : Number(r[c.lastSeenAt]),
    }),
  )
  decoded.set(file, rows)
  return rows
}

export function useIndex(m: string): Resource<IndexRow[]> {
  const r = useJson<IndexFile>(`${m}/index.json`)
  return r.status === 'ready' ? { status: 'ready', data: decodeIndex(r.data) } : r
}
