import { useMemo, useState } from 'react'
import { shortDay } from '../../lib/format'
import type { Dashboard, IndexPoint } from '../../lib/types'
import { Empty } from '../States'
import { HeroChart, type HeroLine } from './HeroChart'
import { Sparkline } from './Sparkline'
import { ChangePill, ChangeText, Panel, Segmented, type SegOption } from './ui'

// Market index, styled like a finance quote page: a big headline value with its change over the
// selected range (following the crosshair while scrubbing), a range selector that filters the
// series client-side, an area chart coloured by the range's direction, and a strip of group
// "tickers" with sparklines. The range scopes everything in this section.
//
// Colour: alone, the `all` line is green when the range is up and red when it is down (always
// alongside a ▲/▼ pill). With comparisons it switches to the categorical trio (blue for `all`,
// orange and aqua for picks), which validates all-pairs in both themes; green or red next to those
// does not. A group keeps its colour while picked; a third pick replaces the oldest.

const DAY = 86400
const SLOTS = ['--series-2', '--series-3'] as const
const MAX_PICKS = SLOTS.length

type RangeId = '7d' | '30d' | '90d' | 'all'
const RANGES: { id: RangeId; label: string; days: number | null; long: string }[] = [
  { id: '7d', label: '7D', days: 7, long: '7 days' },
  { id: '30d', label: '30D', days: 30, long: '30 days' },
  { id: '90d', label: '90D', days: 90, long: '90 days' },
  { id: 'all', label: 'All', days: null, long: 'all history' },
]
const ALL_RANGE = RANGES[3] ?? { id: 'all' as const, label: 'All', days: null, long: 'all history' }

type Pick = { id: string; color: string }

const fmt1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1))
const fmt2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))
// Ticks can be 0.5 apart on a calm market; keep one decimal then so labels never repeat.
const yFormat = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

const dayOf = (at: number) => Math.floor(at / DAY)
type At = { v: number; i: number }

/** Newest non-null value of `id` at or before series index `upto`. */
function lastValue(series: IndexPoint[], id: string, upto: number): At | null {
  for (let i = Math.min(upto, series.length - 1); i >= 0; i--) {
    const v = series[i]?.values[id]
    if (v != null) return { v, i }
  }
  return null
}

/**
 * The value a change is measured from, strictly before `endIdx`: for a range, the newest non-null
 * value on or before the range's start day (it may sit just before the window), falling back to
 * the first one inside it; for All, the first non-null value. Null when there is none, so a range
 * whose only value is the end point shows "—", not 0%.
 */
function baseValue(series: IndexPoint[], id: string, startDay: number | null, endIdx: number): At | null {
  let before: At | null = null
  for (let i = 0; i < endIdx; i++) {
    const p = series[i]
    const v = p?.values[id]
    if (!p || v == null) continue
    if (startDay == null) return { v, i }
    if (dayOf(p.at) <= startDay) before = { v, i }
    else return before ?? { v, i }
  }
  return before
}

interface Change {
  end: At
  base: At | null
  pct: number | null
  pts: number | null
}

function changeOf(series: IndexPoint[], id: string, startDay: number | null, endIdx: number, minIdx = 0): Change | null {
  const end = lastValue(series, id, endIdx)
  // The end must lie inside the range (after its start day), else there is nothing to show for it.
  if (!end || end.i < minIdx) return null
  const endAt = series[end.i]?.at
  if (startDay != null && endAt != null && dayOf(endAt) <= startDay) return null
  const base = baseValue(series, id, startDay, end.i)
  if (!base || base.v === 0) return { end, base: null, pct: null, pts: null }
  return { end, base, pct: (end.v / base.v - 1) * 100, pts: end.v - base.v }
}

/** Where the range starts: its first day, and the first series index shown (the base may sit before). */
function windowFor(series: IndexPoint[], days: number | null): { startDay: number | null; from: number } {
  if (days == null || series.length === 0) return { startDay: null, from: 0 }
  const startDay = dayOf(series[series.length - 1]?.at ?? 0) - days
  const inWin = series.findIndex((p) => dayOf(p.at) >= startDay)
  const base = baseValue(series, 'all', startDay, series.length - 1)
  return { startDay, from: Math.max(0, Math.min(inWin < 0 ? series.length - 1 : inWin, base?.i ?? Infinity)) }
}

/** A group can be compared when it has 2+ values on days inside the range (the base point before it doesn't count). */
const usableIn = (series: IndexPoint[], startDay: number | null, id: string) =>
  series.filter((p) => p.values[id] != null && (startDay == null || dayOf(p.at) >= startDay)).length >= 2

/** Direction colour from the rounded change, so a rounded 0 is neutral. */
const dirColor = (pct: number | null | undefined, up: string, down: string, flat: string) => {
  const r = pct == null ? 0 : Math.round(pct * 10)
  return r > 0 ? up : r < 0 ? down : flat
}

export function MarketIndex({ d }: { d: Dashboard }) {
  const series = d.index.series
  const [rangePick, setRangePick] = useState<RangeId>('all')
  const [picksRaw, setPicks] = useState<Pick[]>([])
  const [scrub, setScrub] = useState<number | null>(null)
  const label = useMemo(() => new Map(d.groups.map((g) => [g.id, g.label])), [d.groups])

  const lastIdx = series.length - 1
  const span = dayOf(series.at(-1)?.at ?? 0) - dayOf(series[0]?.at ?? 0)
  // Whole UTC days: a range is offered only when there is data from before its start day.
  const enabled = (days: number | null) => days == null || span > days
  const range = RANGES.find((r) => r.id === rangePick && enabled(r.days)) ?? ALL_RANGE
  const { startDay, from } = useMemo(() => windowFor(series, range.days), [series, range.days])
  const shown = useMemo(() => series.slice(from), [series, from])
  const picks = useMemo(() => picksRaw.filter((p) => usableIn(series, startDay, p.id)), [picksRaw, series, startDay])
  const xs = useMemo(() => shown.map((p) => p.at), [shown])
  const allVals = useMemo(() => shown.map((p) => p.values.all), [shown])
  const now = useMemo(() => changeOf(series, 'all', startDay, lastIdx, from), [series, startDay, lastIdx, from])
  const mainColor = picks.length > 0 ? '--series-1' : dirColor(now?.pct, '--gain', '--loss', '--series-1')
  const main = useMemo<HeroLine>(() => ({ label: 'All items', color: mainColor, values: allVals }), [mainColor, allVals])
  const compares = useMemo<HeroLine[]>(
    () => picks.map((p) => ({ label: label.get(p.id) ?? p.id, color: p.color, values: shown.map((s) => s.values[p.id] ?? null) })),
    [picks, shown, label],
  )

  if (series.length < 2) {
    return (
      <Panel label="Market index">
        <Empty>
          The index compares prices between days, so it needs complete scans on at least 2 days. There{' '}
          {d.historyDays === 1 ? 'is 1 day' : `are ${d.historyDays} days`} so far.
        </Empty>
      </Panel>
    )
  }

  function setRange(id: RangeId) {
    setRangePick(id)
    // A pick that has too few values in the new range is dropped, not hidden.
    const w = windowFor(series, RANGES.find((r) => r.id === id)?.days ?? null)
    setPicks((cur) => cur.filter((p) => usableIn(series, w.startDay, p.id)))
  }

  function toggle(id: string) {
    setPicks(() => {
      const cur = picks
      if (cur.some((p) => p.id === id)) return cur.filter((p) => p.id !== id)
      if (cur.length < MAX_PICKS) {
        const free = SLOTS.find((c) => !cur.some((p) => p.color === c)) ?? SLOTS[0]
        return [...cur, { id, color: free }]
      }
      const [oldest, ...rest] = cur
      return [...rest, { id, color: oldest?.color ?? SLOTS[0] }]
    })
  }

  // Headline: the scrubbed day, or else the newest non-null value ("as of" its day).
  const scrubIdx = scrub != null && scrub < shown.length ? from + scrub : null
  const scrubPt = scrubIdx != null ? series[scrubIdx] : undefined
  const head: Change | null =
    scrubIdx == null ? now : scrubPt?.values.all == null ? null : changeOf(series, 'all', startDay, scrubIdx, from)
  const headPt = head ? series[head.end.i] : scrubPt
  const newest = series[lastIdx]
  const stale = scrubIdx == null && head != null && head.end.i !== lastIdx
  const baseAt = head?.base ? series[head.base.i]?.at : undefined
  const legendIdx = scrub != null && scrub < shown.length ? scrub : shown.length - 1
  const options: SegOption<RangeId>[] = RANGES.map((r) => ({
    id: r.id,
    label: r.label,
    disabled: !enabled(r.days),
    title: enabled(r.days) ? undefined : `Needs data from more than ${r.long} ago (oldest is ${span} ${span === 1 ? 'day' : 'days'} old)`,
  }))
  const someDisabled = options.some((o) => o.disabled)

  return (
    <>
      <Panel
        id="index-label"
        label="Market index · all items"
        actions={
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Segmented label="Range" value={range.id} options={options} onChange={setRange} />
            {someDisabled && <p className="text-[11px] text-muted">Longer ranges unlock as history grows</p>}
          </div>
        }
      >
        <div aria-live="polite">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="text-4xl leading-none font-semibold tracking-tight tabular sm:text-5xl">{fmt2(head?.end.v)}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-0.5 text-sm">
              <ChangePill p={head?.pct ?? null} className="text-sm" />
              <ChangeText p={head?.pts ?? null} suffix=" pts" digits={2} className="text-sm" />
              {baseAt != null && <span className="text-muted">vs {shortDay(baseAt)}</span>}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {scrubPt ? <span className="font-semibold text-ink-2">{shortDay(scrubPt.at)}</span> : headPt && `As of ${shortDay(headPt.at)}`}
            {headPt && ` · ${headPt.items.toLocaleString('en-US')} items in the index`}
            {stale && newest && ` · Too few items with enough listings on ${shortDay(newest.at)}.`}
            {scrubPt && scrubPt.values.all == null && ` · Too few items with enough listings on ${shortDay(scrubPt.at)}.`}
            {!head && !scrubPt && newest && ` Too few items with enough listings on ${shortDay(newest.at)}.`}
          </p>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          Typical price level of items traded on consecutive days, first day = 100. Items need {d.params.indexMinListings}+ listings on both days.
        </p>

        {compares.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {[main, ...compares].map((l) => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: `var(${l.color})` }} aria-hidden="true" />
                <span className="text-ink-2">{l.label}</span>
                <span className="font-semibold text-ink tabular">{fmt1(l.values[legendIdx])}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <HeroChart xs={xs} main={main} compares={compares} yFormat={yFormat} xTickFormat={shortDay} onScrub={setScrub} ariaLabel="Area chart of the market index per day" />
        </div>
        <p className="mt-2 text-xs text-muted">
          A gap means fewer than 5 items had {d.params.indexMinListings}+ listings on both days; the line picks up again from its last value.
          Days without a complete scan are skipped, not drawn as gaps.
        </p>

        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-ink-2">Show as table</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-left text-xs tabular">
              <thead className="sticky top-0 bg-surface text-[11px] text-muted uppercase">
                <tr>
                  <th className="py-1 pr-2 font-medium">Day</th>
                  <th className="py-1 pr-2 text-right font-medium">All</th>
                  {d.groups.map((g) => (
                    <th key={g.id} className="py-1 pr-2 text-right font-medium whitespace-nowrap">
                      {g.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...shown].reverse().map((p) => (
                  <tr key={p.at} className="border-t border-hairline">
                    <td className="py-1 pr-2 whitespace-nowrap">{shortDay(p.at)}</td>
                    <td className="py-1 pr-2 text-right font-semibold">{fmt2(p.values.all)}</td>
                    {d.groups.map((g) => (
                      <td key={g.id} className="py-1 pr-2 text-right">
                        {fmt1(p.values[g.id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Panel>

      <Panel label="Groups" sub={`Index per group, change over ${range.id === 'all' ? 'all history' : `the last ${range.long}`}. Tap up to ${MAX_PICKS} to compare on the chart.`}>
        <ul className="-mx-3 flex snap-x scroll-px-3 gap-2 overflow-x-auto px-3 pb-1 sm:scroll-px-0 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6">
          {d.groups.map((g) => {
            const pick = picks.find((p) => p.id === g.id)
            const vals = shown.map((p) => p.values[g.id] ?? null)
            const c = changeOf(series, g.id, startDay, lastIdx, from)
            const usable = usableIn(series, startDay, g.id)
            const asOf = c && c.end.i !== lastIdx ? series[c.end.i]?.at : undefined
            return (
              <li key={g.id} className="w-36 shrink-0 snap-start sm:w-auto">
                <button
                  type="button"
                  aria-pressed={!!pick}
                  disabled={!usable}
                  onClick={() => toggle(g.id)}
                  title={usable ? undefined : 'Too few days with enough listings in this range'}
                  className={`block w-full rounded-md border p-2 text-left transition-colors ${
                    pick ? 'bg-surface-2' : 'border-line hover:bg-surface-2/60'
                  } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`}
                  style={pick ? { borderColor: `var(${pick.color})`, boxShadow: `inset 0 0 0 1px var(${pick.color})` } : undefined}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    {pick && <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: `var(${pick.color})` }} aria-hidden="true" />}
                    <span className="truncate">{g.label}</span>
                  </span>
                  <span className="mt-0.5 flex items-baseline justify-between gap-1">
                    <span className="text-sm font-semibold text-ink tabular">{fmt1(c?.end.v)}</span>
                    <ChangeText p={c?.pct ?? null} className="text-xs" />
                  </span>
                  {asOf != null && <span className="block text-[10px] text-muted">as of {shortDay(asOf)}</span>}
                  <span className="mt-1 block">
                    <Sparkline values={vals} color={dirColor(c?.pct, '--gain', '--loss', '--ink-muted')} />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Panel>
    </>
  )
}
