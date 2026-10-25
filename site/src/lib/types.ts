// Shapes of the site JSON, contract C4 v4 in docs/contracts.md. Money is integer copper or null
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
  /** Texture basename (e.g. `inv_alchemy_elixir_04`), null when unknown. Never a URL. */
  icon: string | null
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
  icon: string | null
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
  icon: string | null
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
  items: { key: string; name: string; quality: number; icon: string | null; count: number; unit: Copper | null }[]
}

// ---------- dashboard.json (C4 v4) ----------

export interface DashboardParams {
  dealPct: number
  overPct: number
  minGainCopper: Copper
  indexMinListings: number
  refMinDays: number
  refWindowDays: number
  refHalfLifeDays: number
  breadthFlatPct: number
}

export interface DashboardGroup {
  id: string
  label: string
}

export interface IndexPoint {
  /** the day's latest complete scan */
  at: UnixSeconds
  /** `all` is 100 on the first point; any value, `all` included, is null on days with too few eligible items */
  values: { all: number | null } & Record<string, number | null>
  /** eligible items in `all` */
  items: number
}

export interface Breadth {
  at: UnixSeconds
  prevAt: UnixSeconds
  up: number
  down: number
  flat: number
}

interface ItemHead {
  key: string
  name: string
  quality: number
  icon: string | null
}

/** A deal or an overpriced item: `unit` vs the normal price `ref`, for `bundle` units. */
export interface PricedRow extends ItemHead {
  bundle: number
  unit: Copper
  ref: Copper
  /** percent, rounded to 0.1 */
  pct: number
  gain: Copper
  listings: number
}

export interface ExtremeRow extends ItemHead {
  unit: Copper
  /** the min (low) or max (high) of the item's other days in the window */
  prev: Copper
  pct: number
  listings: number
}

export interface ExtremeWindow {
  days: number
  haveDays: number
  needDays: number
  low: ExtremeRow[]
  high: ExtremeRow[]
}

export type ExtremeId = '7d' | '30d'

export interface ValuableRow extends ItemHead {
  unit: Copper
  min: Copper | null
  listings: number
}

export interface Dashboard {
  /** the current complete scan's `at`, null when there is none */
  asOf: UnixSeconds | null
  /** distinct UTC days with a complete scan */
  historyDays: number
  params: DashboardParams
  groups: DashboardGroup[]
  index: { series: IndexPoint[] }
  breadth: Breadth | null
  deals: PricedRow[]
  overpriced: PricedRow[]
  extremes: Record<ExtremeId, ExtremeWindow>
  valuable: ValuableRow[]
}
