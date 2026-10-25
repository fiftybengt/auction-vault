import { useState } from 'react'
import { useParams } from 'react-router'
import { ExtremeTable, PricedTable, ValuableTable } from '../components/dashboard/ItemTables'
import { MarketIndex } from '../components/dashboard/MarketIndex'
import { Panel, Segmented, Tabs } from '../components/dashboard/ui'
import { Money } from '../components/Money'
import { Empty, Gate, NoCompleteScan } from '../components/States'
import { useDashboard } from '../lib/data'
import { ago, formatInt, fullTime } from '../lib/format'
import { useNow } from '../lib/useNow'
import type { Dashboard, ExtremeId } from '../lib/types'

// The market dashboard, driven by dashboard.json (C4 v4) only. Every number here comes from
// complete scans; partial scans never reach this file. `breadth` stays in the data and types but
// is not shown.
export default function Overview() {
  const { market = '' } = useParams()
  const dash = useDashboard(market)
  return (
    <div className="space-y-3 tabular">
      <h1 className="sr-only">Market dashboard</h1>
      <Gate r={dash} what="market dashboard">
        {(d) => <DashboardView d={d} market={market} />}
      </Gate>
    </div>
  )
}

function DashboardView({ d, market }: { d: Dashboard; market: string }) {
  if (d.asOf == null) return <NoCompleteScan what="The market index, deals and price extremes" />
  return (
    <>
      <StatusBar asOf={d.asOf} historyDays={d.historyDays} />
      <MarketIndex d={d} />
      <SignalsPanel d={d} market={market} />
      <ExtremesPanel d={d} market={market} />
      <Panel label="Most valuable on the AH" sub="Highest market value per unit in the current scan">
        {d.valuable.length === 0 ? <Empty>Nothing listed with a buyout in the current scan.</Empty> : <ValuableTable rows={d.valuable} market={market} />}
      </Panel>
    </>
  )
}

const STALE_AFTER = 36 * 3600

function StatusBar({ asOf, historyDays }: { asOf: number; historyDays: number }) {
  const now = useNow()
  const stale = now - asOf > STALE_AFTER
  return (
    <section
      aria-label="Data freshness"
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink-2"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`inline-block size-2 rounded-full ${stale ? 'bg-warning' : 'bg-gain'}`} />
        <span>
          Last complete scan{' '}
          <time dateTime={new Date(asOf * 1000).toISOString()} title={fullTime(asOf)} className="font-semibold text-ink">
            {ago(asOf, now)}
          </time>{' '}
          · <strong className="font-semibold text-ink">{formatInt(historyDays)}</strong> {historyDays === 1 ? 'day' : 'days'} of history
          {stale && <span className="font-semibold text-warning-ink"> · may be out of date</span>}
        </span>
      </span>
      <span className="text-[11px] text-muted sm:ml-auto">Each scan sees the newest 55,000 auctions; an item missing from a scan may still be listed.</span>
    </section>
  )
}

const DAY = 86400

/**
 * "Needs scans on 2 earlier days — 1 so far", for anything built on the normal price. Counts only
 * the UTC days with data in the reference window [today − refWindowDays, today − 1]; index.series
 * has one point per day with data, so its `at`s give those days.
 */
function refShortfall(d: Dashboard): string | null {
  if (d.asOf == null) return null
  const today = Math.floor(d.asOf / DAY)
  const from = today - d.params.refWindowDays
  const days = new Set(d.index.series.map((p) => Math.floor(p.at / DAY)).filter((x) => x >= from && x <= today - 1))
  const earlier = days.size
  const need = d.params.refMinDays
  if (earlier >= need) return null
  return `Needs scans on ${need} earlier ${need === 1 ? 'day' : 'days'} to know the normal price — ${earlier} so far.`
}

type SignalTab = 'deal' | 'over'

/** Deals now / Overpriced now, one card with tabs (like Gainers / Losers). */
function SignalsPanel({ d, market }: { d: Dashboard; market: string }) {
  const [tab, setTab] = useState<SignalTab>('deal')
  const rows = tab === 'deal' ? d.deals : d.overpriced
  const p = d.params
  const sub =
    tab === 'deal' ? (
      <>
        Cheapest units at least {p.dealPct}% under the normal price, saving at least <Money c={p.minGainCopper} /> per bundle. Normal = the
        last {p.refWindowDays} days, recent days weighted more.
      </>
    ) : (
      <>
        Market value at least {p.overPct}% over the normal price and at least <Money c={p.minGainCopper} /> more per bundle. Good time to
        sell, not to buy.
      </>
    )
  const short = refShortfall(d)
  return (
    <Panel label="Price signals">
      <Tabs
        label="Price signals"
        idBase="signals"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'deal', label: 'Deals now', count: d.deals.length },
          { id: 'over', label: 'Overpriced now', count: d.overpriced.length },
        ]}
      />
      <div id="signals-panel" role="tabpanel" aria-labelledby={`signals-tab-${tab}`}>
        <p className="mt-2 mb-1 text-xs text-ink-2">{sub}</p>
        {rows.length > 0 ? (
          <PricedTable key={tab} rows={rows} market={market} kind={tab} />
        ) : (
          <Empty>{short ?? (tab === 'deal' ? 'No item is far enough under its normal price right now.' : 'No item is far enough over its normal price right now.')}</Empty>
        )}
      </div>
    </Panel>
  )
}

const EXTREME_IDS: { id: ExtremeId; label: string }[] = [
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
]

type Side = 'low' | 'high'

function ExtremesPanel({ d, market }: { d: Dashboard; market: string }) {
  const [id, setId] = useState<ExtremeId>('7d')
  const [side, setSide] = useState<Side>('low')
  const w = d.extremes[id]
  const short = w.haveDays < w.needDays
  const shortMsg = `Needs ${w.needDays} days of scans in the last ${w.days} days (have ${w.haveDays}).`
  const rows = side === 'low' ? w.low : w.high
  return (
    <Panel
      label={`Lowest and highest in ${w.days} days`}
      actions={<Segmented label="Window" value={id} options={EXTREME_IDS} onChange={setId} />}
    >
      <Tabs
        label="Lows or highs"
        idBase="extremes"
        value={side}
        onChange={setSide}
        tabs={[
          { id: 'low', label: `${w.days}-day lows`, count: short ? undefined : w.low.length },
          { id: 'high', label: `${w.days}-day highs`, count: short ? undefined : w.high.length },
        ]}
      />
      <div id="extremes-panel" role="tabpanel" aria-labelledby={`extremes-tab-${side}`}>
        <p className="mt-2 mb-1 text-xs text-ink-2">
          Today's market value against the item's other days in the window. Items need a value on {w.needDays}+ days and 3+ listings today.
        </p>
        {short ? (
          <Empty>{shortMsg}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{side === 'low' ? `No item is at a ${w.days}-day low today.` : `No item is at a ${w.days}-day high today.`}</Empty>
        ) : (
          <ExtremeTable key={`${id}-${side}`} rows={rows} market={market} side={side} />
        )}
      </div>
    </Panel>
  )
}
