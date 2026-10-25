import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { TimeChart, TipRow } from '../components/charts/TimeChart'
import { Money } from '../components/Money'
import { ItemLink } from '../components/Quality'
import { RangePicker } from '../components/RangePicker'
import { Card, Empty, Gate, NoCompleteScan, StatTile } from '../components/States'
import { useMovers, useOverview } from '../lib/data'
import { countCompact, formatInt, fullTime, pct, shortTime } from '../lib/format'
import { completeOnly, inRange, type Range } from '../lib/series'
import type { Mover, Movers, OverviewPoint, WindowId } from '../lib/types'

export default function Overview() {
  const { market = '' } = useParams()
  const overview = useOverview(market)
  const movers = useMovers(market)
  const [range, setRange] = useState<Range>('30d')

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Market overview</h1>
      <Gate r={overview} what="market overview">
        {(o) => <MarketSize all={o.series} range={range} setRange={setRange} />}
      </Gate>
      <Gate r={movers} what="movers">
        {(m) => <MoversSection movers={m} market={market} />}
      </Gate>
    </div>
  )
}

function MarketSize({ all, range, setRange }: { all: OverviewPoint[]; range: Range; setRange: (r: Range) => void }) {
  const series = useMemo(() => completeOnly(all), [all])
  const last = series.at(-1)
  const end = all.at(-1)?.at ?? 0
  const shown = useMemo(() => inRange(series, range, end), [series, range, end])
  const partials = useMemo(() => inRange(all, range, end).filter((p) => !p.complete), [all, range, end])
  const xs = useMemo(() => shown.map((p) => p.at), [shown])
  const lines = useMemo(() => [{ label: 'Listings', color: '--series-1', values: shown.map((p) => p.listings) }], [shown])

  if (!last) {
    const lastPartial = all.at(-1)
    return (
      <>
        <NoCompleteScan what="Market size, prices and movers" />
        {lastPartial && (
          <Card title="Partial scans so far" subtitle="Not plotted: a partial scan misses part of the auction house">
            <PartialList points={[...all].reverse()} />
          </Card>
        )}
      </>
    )
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Listings" sub="in the latest complete scan">
          {formatInt(last.listings)}
        </StatTile>
        <StatTile label="Quantity" sub="items for sale">
          {formatInt(last.quantity)}
        </StatTile>
        <StatTile label="Distinct items">{formatInt(last.items)}</StatTile>
        <StatTile label="Known sellers" sub="most sellers are unknown">
          {formatInt(last.sellers)}
        </StatTile>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <Card title="Market size" subtitle="Listings per complete scan">
        <TimeChart
          xs={xs}
          lines={lines}
          yFormat={countCompact}
          ariaLabel="Line chart of auction listings per complete scan"
          tooltip={(i) => {
            const p = shown[i]
            if (!p) return null
            return (
              <>
                <p className="mb-1 text-muted">{shortTime(p.at)}</p>
                <TipRow color="--series-1" label="listings">
                  {formatInt(p.listings)}
                </TipRow>
                <TipRow label="quantity">{formatInt(p.quantity)}</TipRow>
                <TipRow label="items">{formatInt(p.items)}</TipRow>
                <TipRow label="known sellers">{formatInt(p.sellers)}</TipRow>
              </>
            )
          }}
        />
        {partials.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {partials.length} partial {partials.length === 1 ? 'scan' : 'scans'} in this range not plotted (coverage{' '}
            {partials.map((p) => `${Math.round(p.coverage * 100)}%`).join(', ')}).
          </p>
        )}
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-2">Show as table</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-left text-xs tabular">
              <thead className="sticky top-0 bg-surface text-ink-2">
                <tr>
                  <th className="py-1 pr-2 font-medium">Scan</th>
                  <th className="py-1 pr-2 text-right font-medium">Listings</th>
                  <th className="py-1 pr-2 text-right font-medium">Quantity</th>
                  <th className="py-1 pr-2 text-right font-medium">Items</th>
                  <th className="py-1 text-right font-medium">Sellers</th>
                </tr>
              </thead>
              <tbody>
                {[...shown].reverse().map((p) => (
                  <tr key={p.at} className="border-t border-hairline">
                    <td className="py-1 pr-2" title={fullTime(p.at)}>
                      {shortTime(p.at)}
                    </td>
                    <td className="py-1 pr-2 text-right">{formatInt(p.listings)}</td>
                    <td className="py-1 pr-2 text-right">{formatInt(p.quantity)}</td>
                    <td className="py-1 pr-2 text-right">{formatInt(p.items)}</td>
                    <td className="py-1 text-right">{formatInt(p.sellers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </>
  )
}

function PartialList({ points }: { points: OverviewPoint[] }) {
  return (
    <ul className="divide-y divide-hairline text-sm">
      {points.map((p) => (
        <li key={p.at} className="flex items-center justify-between gap-3 py-1.5 tabular">
          <span className="whitespace-nowrap" title={fullTime(p.at)}>{shortTime(p.at)}</span>
          <span className="text-ink-2">
            {Math.round(p.coverage * 100)}% coverage · {formatInt(p.listings)} listings
          </span>
        </li>
      ))}
    </ul>
  )
}

const WINDOW_LABEL: Record<WindowId, string> = { '1d': '24 hours', '7d': '7 days' }

function MoversSection({ movers, market }: { movers: Movers; market: string }) {
  const ids = (['1d', '7d'] as const).filter((w) => movers.windows[w])
  const [pick, setPick] = useState<WindowId>('1d')
  const id = ids.includes(pick) ? pick : ids[0]
  const w = id ? movers.windows[id] : undefined
  if (!id || !w)
    return (
      <Card title="Biggest movers">
        <Empty>Movers need complete scans at least a day apart.</Empty>
      </Card>
    )
  const sub = `Median unit price now vs ${shortTime(w.prevAt)} · at least ${movers.minListings} listings at both times`
  return (
    <div className="space-y-3">
      {ids.length > 1 && (
        <div role="radiogroup" aria-label="Movers period" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
          {ids.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={x === id}
              onClick={() => setPick(x)}
              className={`rounded-md px-3 py-1 ${x === id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2/60'}`}
            >
              {WINDOW_LABEL[x]}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <MoverList title={`Biggest risers, ${WINDOW_LABEL[id]}`} subtitle={sub} rows={w.up} market={market} />
        <MoverList title={`Biggest fallers, ${WINDOW_LABEL[id]}`} subtitle={sub} rows={w.down} market={market} />
      </div>
    </div>
  )
}

function MoverList({ title, subtitle, rows, market }: { title: string; subtitle: string; rows: Mover[]; market: string }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <Empty>Nothing moved enough.</Empty>
      ) : (
        <ol className="divide-y divide-hairline">
          {rows.map((m) => (
            <li key={m.key} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <ItemLink market={market} itemKey={m.key} name={m.name} quality={m.quality} icon={m.icon} />
                </div>
                <div className="text-xs text-muted">
                  was <Money c={m.prev} /> · {formatInt(m.listings)} listed
                </div>
              </div>
              <div className="text-right">
                <Money c={m.median} />
                <div className={`text-xs font-semibold tabular ${m.pct >= 0 ? 'text-up' : 'text-down'}`}>
                  <span aria-hidden="true">{m.pct >= 0 ? '▲' : '▼'}</span> {pct(m.pct)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
