import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { TimeChart, TipRow } from '../components/charts/TimeChart'
import { Money } from '../components/Money'
import { RangePicker } from '../components/RangePicker'
import { Card, Empty, Gate, NoCompleteScan, StatTile } from '../components/States'
import { fileToKey, useIndex, useItem, useMeta } from '../lib/data'
import { ago, countCompact, formatInt, fullTime, moneyCompact, qualityName, shortTime, TIME_LEFT } from '../lib/format'
import { qualityClass } from '../lib/quality'
import { inRange, type Range } from '../lib/series'
import { wowheadData, wowheadUrl } from '../lib/wowhead'
import type { HistoryPoint, ItemFile, Listing } from '../lib/types'

export default function Item() {
  const { market = '', key = '' } = useParams()
  const itemKey = fileToKey(key)
  const item = useItem(market, itemKey)
  const meta = useMeta(market)
  const index = useIndex(market)
  const lastSeenAt = index.status === 'ready' ? (index.data.find((r) => r.key === itemKey)?.lastSeenAt ?? null) : null
  return (
    <Gate r={item} what={`item ${itemKey}`}>
      {(data) => (
        <Gate r={meta} what="market metadata">
          {(m) => <ItemBody data={data} market={market} current={m.lastCompleteScan?.at ?? null} lastSeenAt={lastSeenAt} />}
        </Gate>
      )}
    </Gate>
  )
}

function ItemBody({ data, market, current, lastSeenAt }: { data: ItemFile; market: string; current: number | null; lastSeenAt: number | null }) {
  const { item, listings } = data
  // C4 v2: history is complete scans only and ascending by `at`.
  const history = useMemo(() => data.history.filter((p) => p.median != null || p.min != null), [data.history])
  const latest = history.at(-1)
  const now = current !== null && latest?.at === current ? latest : undefined
  const [range, setRange] = useState<Range>('30d')
  const shown = useMemo(() => inRange(history, range, current ?? history.at(-1)?.at ?? 0), [history, range, current])
  const note = now ? 'latest complete scan' : lastSeenAt ? `not listed now · last seen ${ago(lastSeenAt)}` : 'not listed now'

  return (
    <div className="space-y-4">
      <header>
        {/* Wowhead's tooltip only attaches to <a href>, so the name links to Wowhead. */}
        <div className="min-w-0">
          <h1 className={`text-2xl font-bold break-words ${qualityClass(item.quality)}`}>
            <a href={wowheadUrl(item.key)} target="_blank" rel="noopener" data-wowhead={wowheadData(item.key)} className="hover:underline focus-visible:underline">
              {item.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {qualityName(item.quality)} · {item.itemType}
            {item.itemSubtype && item.itemSubtype !== item.itemType ? ` · ${item.itemSubtype}` : ''}
            {item.itemLevel > 0 && ` · item level ${item.itemLevel}`}
            {item.reqLevel > 0 && ` · requires level ${item.reqLevel}`}
          </p>
          <p className="mt-1 text-sm">
            <a href={wowheadUrl(item.key)} target="_blank" rel="noopener" className="text-accent hover:underline">
              View on Wowhead<span aria-hidden="true"> ↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </header>

      {current === null ? (
        <NoCompleteScan what="Prices, trends and listings for this item" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Median unit price" sub={note}>
              <Money c={now?.median ?? null} none="Not listed" />
            </StatTile>
            <StatTile label="Lowest unit price" sub={note}>
              <Money c={now?.min ?? null} none="Not listed" />
            </StatTile>
            <StatTile label="Listings now">{formatInt(listings.length)}</StatTile>
            <StatTile label="Vendor sells for">
              <Money c={item.vendorSell} none="Cannot be sold to a vendor" />
            </StatTile>
          </div>

          {history.length === 0 ? (
            <Empty>No buyout prices recorded for this item in any complete scan.</Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <RangePicker value={range} onChange={setRange} />
                {history.length < 10 && <span className="text-xs text-muted">Sparse history: seen in {history.length} scans.</span>}
              </div>
              {shown.length === 0 ? (
                <Empty>Not listed in this time range.</Empty>
              ) : (
                <>
                  <PriceChart points={shown} />
                  <SupplyChart points={shown} />
                </>
              )}
            </>
          )}

          <Card title="Current listings" subtitle={`From the latest complete scan, ${ago(current)}`}>
            <ListingsTable listings={listings} market={market} />
          </Card>
        </>
      )}
    </div>
  )
}

function PriceChart({ points }: { points: HistoryPoint[] }) {
  const xs = useMemo(() => points.map((p) => p.at), [points])
  const lines = useMemo(
    () => [
      { label: 'Median', color: '--series-1', values: points.map((p) => p.median) },
      { label: 'Lowest', color: '--series-2', values: points.map((p) => p.min) },
    ],
    [points],
  )
  const band = useMemo(
    () => ({ label: 'Middle half (p25–p75)', fill: '--band-1', lo: points.map((p) => p.p25), hi: points.map((p) => p.p75) }),
    [points],
  )
  return (
    <Card title="Unit price" subtitle="Per complete scan">
      <TimeChart
        xs={xs}
        lines={lines}
        band={band}
        yFormat={moneyCompact}
        ariaLabel="Line chart of median and lowest unit buyout price, with the 25th to 75th percentile band"
        tooltip={(i) => {
          const p = points[i]
          if (!p) return null
          return (
            <>
              <p className="mb-1 text-muted">{shortTime(p.at)}</p>
              <TipRow color="--series-1" label="median">
                <Money c={p.median} />
              </TipRow>
              <TipRow color="--series-2" label="lowest">
                <Money c={p.min} />
              </TipRow>
              <TipRow label="p25 – p75">
                <Money c={p.p25} /> – <Money c={p.p75} />
              </TipRow>
              <TipRow label="listings">{formatInt(p.listings)}</TipRow>
            </>
          )
        }}
      />
      <HistoryTable points={points} />
    </Card>
  )
}

function SupplyChart({ points }: { points: HistoryPoint[] }) {
  const xs = useMemo(() => points.map((p) => p.at), [points])
  const lines = useMemo(() => [{ label: 'Quantity', color: '--series-1', values: points.map((p) => p.quantity) }], [points])
  return (
    <Card title="Supply" subtitle="Quantity for sale per complete scan">
      <TimeChart
        xs={xs}
        lines={lines}
        height={160}
        yFormat={countCompact}
        ariaLabel="Line chart of quantity for sale per complete scan"
        tooltip={(i) => {
          const p = points[i]
          if (!p) return null
          return (
            <>
              <p className="mb-1 text-muted">{shortTime(p.at)}</p>
              <TipRow color="--series-1" label="quantity">
                {formatInt(p.quantity)}
              </TipRow>
              <TipRow label="listings">{formatInt(p.listings)}</TipRow>
            </>
          )
        }}
      />
    </Card>
  )
}

function HistoryTable({ points }: { points: HistoryPoint[] }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-ink-2">Show as table</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-left text-xs tabular">
          <thead className="sticky top-0 bg-surface text-ink-2">
            <tr>
              <th className="py-1 pr-2 font-medium">Scan</th>
              <th className="py-1 pr-2 text-right font-medium">Lowest</th>
              <th className="py-1 pr-2 text-right font-medium">Median</th>
              <th className="hidden py-1 pr-2 text-right font-medium sm:table-cell">p25</th>
              <th className="hidden py-1 pr-2 text-right font-medium sm:table-cell">p75</th>
              <th className="py-1 pr-2 text-right font-medium">Listed</th>
              <th className="py-1 text-right font-medium">Qty</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.at} className="border-t border-hairline">
                <td className="py-1 pr-2 whitespace-nowrap" title={fullTime(p.at)}>
                  {shortTime(p.at)}
                </td>
                <td className="py-1 pr-2 text-right"><Money c={p.min} /></td>
                <td className="py-1 pr-2 text-right"><Money c={p.median} /></td>
                <td className="hidden py-1 pr-2 text-right sm:table-cell"><Money c={p.p25} /></td>
                <td className="hidden py-1 pr-2 text-right sm:table-cell"><Money c={p.p75} /></td>
                <td className="py-1 pr-2 text-right">{formatInt(p.listings)}</td>
                <td className="py-1 text-right">{formatInt(p.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

type SortKey = 'unit' | 'stack' | 'timeLeft'

function ListingsTable({ listings, market }: { listings: Listing[]; market: string }) {
  const [sort, setSort] = useState<SortKey>('unit')
  const rows = useMemo(() => {
    const val = (l: Listing) => (sort === 'unit' ? (l.unit ?? Infinity) : sort === 'stack' ? -l.stack : l.timeLeft)
    return [...listings].sort((a, b) => val(a) - val(b))
  }, [listings, sort])
  if (listings.length === 0) return <Empty>Not listed in the latest complete scan.</Empty>
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={`py-1.5 pr-2 font-medium ${cls}`} aria-sort={sort === k ? 'ascending' : 'none'}>
      <button type="button" onClick={() => setSort(k)} className={sort === k ? 'font-semibold text-ink' : 'hover:text-ink'}>
        {label}
        {sort === k && <span aria-hidden="true"> ↓</span>}
      </button>
    </th>
  )
  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[20rem] text-left text-sm tabular">
        <thead className="text-xs text-ink-2">
          <tr>
            {th('stack', 'Stack', 'text-right')}
            {th('unit', 'Unit', 'text-right')}
            <th className="hidden py-1.5 pr-2 text-right font-medium sm:table-cell">Buyout</th>
            <th className="hidden py-1.5 pr-2 text-right font-medium sm:table-cell">Bid</th>
            {th('timeLeft', 'Left')}
            <th className="py-1.5 font-medium">Seller</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i} className="border-t border-hairline">
              <td className="py-1.5 pr-2 text-right">{l.stack}</td>
              <td className="py-1.5 pr-2 text-right">
                {l.unit == null ? <span className="text-xs text-muted">bid only</span> : <Money c={l.unit} />}
                {l.stack > 1 && l.buyout != null && (
                  <div className="text-xs text-muted sm:hidden">
                    <Money c={l.buyout} /> total
                  </div>
                )}
              </td>
              <td className="hidden py-1.5 pr-2 text-right sm:table-cell"><Money c={l.buyout} /></td>
              <td className="hidden py-1.5 pr-2 text-right sm:table-cell">
                {l.bid != null ? (
                  <Money c={l.bid} />
                ) : (
                  <span className="text-muted" title="No bids yet; minimum bid shown">
                    <Money c={l.minBid} /> min
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-ink-2">{TIME_LEFT[l.timeLeft] ?? '?'}</td>
              <td className="max-w-28 truncate py-1.5">
                {l.seller ? (
                  <Link to={`/${market}/seller/${encodeURIComponent(l.seller)}`} className="text-accent hover:underline">
                    {l.seller}
                  </Link>
                ) : (
                  <span className="text-muted italic">unknown</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
