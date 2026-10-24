// Shapes of the site JSON, contract C4 v2 in docs/contracts.md. Money is integer copper or null
// (never 0 for "none"), times are unix seconds UTC, series are ascending by `at` (scan startedAt).
// "Current" means the newest complete scan; with none yet, current values are null.

export type Copper = number
export type UnixSeconds = number

export interface Market {
  slug: string
  realm: string
  faction: string
  lastScanAt: UnixSeconds
  lastCompleteScanAt: UnixSeconds | null
  scans: number
}

export interface Meta {
  generatedAt: UnixSeconds
  lastScan: { id: string; at: UnixSeconds; rowCount: number; expectedTotal: number; complete: boolean }
  lastCompleteScan: { id: string; at: UnixSeconds; rowCount: number } | null
  scanCount: number
  completeScanCount: number
  itemCount: number
}

export interface IndexFile {
  cols: string[]
  rows: unknown[][]
}

export interface IndexRow {
  key: string
  id: number
  name: string
  quality: number
  class: string
  subclass: string
  median: Copper | null
  min: Copper | null
  listings: number
  lastSeenAt: UnixSeconds | null
}

export interface OverviewPoint {
  at: UnixSeconds
  complete: boolean
  /** rowCount / expectedTotal */
  coverage: number
  listings: number
  quantity: number
  items: number
  sellers: number
}

export interface Overview {
  series: OverviewPoint[]
}

export interface Mover {
  key: string
  name: string
  quality: number
  median: Copper
  prev: Copper
  pct: number
  listings: number
}

export interface MoverWindow {
  prevAt: UnixSeconds
  up: Mover[]
  down: Mover[]
}

export type WindowId = '1d' | '7d'

export interface Movers {
  minListings: number
  /** A window whose prevAt would be missing is omitted. */
  windows: Partial<Record<WindowId, MoverWindow>>
}

export interface ItemInfo {
  key: string
  id: number
  suffixId: number
  name: string
  quality: number
  itemLevel: number
  reqLevel: number
  itemType: string
  itemSubtype: string
  stackMax: number
  vendorSell: Copper | null
  equipLoc: string
}

export interface HistoryPoint {
  at: UnixSeconds
  min: Copper | null
  p25: Copper | null
  median: Copper | null
  p75: Copper | null
  listings: number
  quantity: number
}

export interface Listing {
  stack: number
  minBid: Copper
  buyout: Copper | null
  unit: Copper | null
  /** null when nobody has bid */
  bid: Copper | null
  timeLeft: 1 | 2 | 3 | 4
  seller: string | null
}

export interface ItemFile {
  item: ItemInfo
  history: HistoryPoint[]
  listings: Listing[]
}

export interface SellerFile {
  seller: string
  listings: number
  items: { key: string; name: string; quality: number; count: number; unit: Copper | null }[]
}
