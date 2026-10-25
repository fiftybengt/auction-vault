import { useDeferredValue, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Money } from '../components/Money'
import { ItemLink } from '../components/Quality'
import { Empty, Gate } from '../components/States'
import { useIndex } from '../lib/data'
import { ago, formatInt, QUALITY_NAMES } from '../lib/format'
import { qualityClass } from '../lib/quality'
import type { IndexRow } from '../lib/types'

const PAGE = 100
type Sort = 'listings' | 'name' | 'price-asc' | 'price-desc'

export default function Search() {
  const { market = '' } = useParams()
  const index = useIndex(market)
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Search items</h1>
      <Gate r={index} what="item index">
        {(rows) => <SearchBody rows={rows} market={market} />}
      </Gate>
    </div>
  )
}

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function SearchBody({ rows, market }: { rows: IndexRow[]; market: string }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const qualityParam = params.get('quality') ?? ''
  const qualities = useMemo(() => qualityParam.split(',').filter(Boolean).map(Number), [qualityParam])
  const cls = params.get('class') ?? ''
  const sub = params.get('sub') ?? ''
  const sort = (params.get('sort') as Sort | null) ?? 'listings'
  const [limit, setLimit] = useState(PAGE)
  const dq = useDeferredValue(q)

  const update = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k === 'class') next.delete('sub')
    setParams(next, { replace: true })
    setLimit(PAGE)
  }

  const names = useMemo(() => rows.map((r) => norm(r.name)), [rows])
  const classes = useMemo(() => [...new Set(rows.map((r) => r.class))].filter(Boolean).sort(), [rows])
  const subclasses = useMemo(
    () => [...new Set(rows.filter((r) => r.class === cls).map((r) => r.subclass))].filter(Boolean).sort(),
    [rows, cls],
  )
  const presentQualities = useMemo(() => [...new Set(rows.map((r) => r.quality))].sort((a, b) => a - b), [rows])

  const results = useMemo(() => {
    const terms = norm(dq).split(/\s+/).filter(Boolean)
    const out: IndexRow[] = []
    rows.forEach((r, i) => {
      if (qualities.length && !qualities.includes(r.quality)) return
      if (cls && r.class !== cls) return
      if (sub && r.subclass !== sub) return
      if (terms.length && !terms.every((t) => (names[i] ?? '').includes(t))) return
      out.push(r)
    })
    const byPrice = (a: IndexRow, b: IndexRow, dir: number) =>
      a.median == null ? 1 : b.median == null ? -1 : (a.median - b.median) * dir
    out.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'price-asc') return byPrice(a, b, 1)
      if (sort === 'price-desc') return byPrice(a, b, -1)
      return b.listings - a.listings || a.name.localeCompare(b.name)
    })
    return out
  }, [rows, names, dq, qualities, cls, sub, sort])

  const toggleQuality = (qv: number) => {
    const set = new Set(qualities)
    if (set.has(qv)) set.delete(qv)
    else set.add(qv)
    update('quality', [...set].sort().join(','))
  }

  return (
    <>
      <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
        <label className="block">
          <span className="sr-only">Item name</span>
          <input
            type="search"
            value={q}
            onChange={(e) => update('q', e.target.value)}
            placeholder="Search items, e.g. frost lotus"
            autoFocus
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-base text-ink placeholder:text-muted"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quality">
          {presentQualities.map((qv) => {
            const on = qualities.includes(qv)
            return (
              <button
                key={qv}
                type="button"
                aria-pressed={on}
                onClick={() => toggleQuality(qv)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line'}`}
              >
                <span className={qualityClass(qv)}>{QUALITY_NAMES[qv] ?? qv}</span>
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select label="Class" value={cls} onChange={(v) => update('class', v)} options={classes} all="All classes" />
          <Select label="Subclass" value={sub} onChange={(v) => update('sub', v)} options={subclasses} all="All subclasses" disabled={!cls} />
          <label className="col-span-2 text-xs text-ink-2 sm:col-span-1">
            Sort
            <select
              value={sort}
              onChange={(e) => update('sort', e.target.value === 'listings' ? '' : e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink"
            >
              <option value="listings">Most listed</option>
              <option value="name">Name</option>
              <option value="price-asc">Cheapest</option>
              <option value="price-desc">Most expensive</option>
            </select>
          </label>
        </div>
      </div>

      <p className="text-xs text-muted" aria-live="polite">
        {formatInt(results.length)} of {formatInt(rows.length)} items
      </p>

      {results.length === 0 ? (
        <Empty>No items match. Try fewer words or clear a filter.</Empty>
      ) : (
        <ul className="divide-y divide-hairline rounded-xl border border-line bg-surface">
          {results.slice(0, limit).map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <ItemLink market={market} itemKey={r.key} name={r.name} quality={r.quality} icon={r.icon} />
                </div>
                <div className="truncate text-xs text-muted">
                  {r.class}
                  {r.subclass && r.subclass !== r.class ? ` · ${r.subclass}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {r.median == null ? <span className="text-xs text-muted">not listed</span> : <Money c={r.median} />}
                <div className="text-xs text-muted tabular">
                  {r.listings > 0 ? (
                    <>
                      {formatInt(r.listings)} listed{r.min != null && r.min !== r.median && <> · from <Money c={r.min} /></>}
                    </>
                  ) : r.lastSeenAt != null ? (
                    `seen ${ago(r.lastSeenAt)}`
                  ) : (
                    ''
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {results.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="w-full rounded-lg border border-line bg-surface py-2 text-sm text-ink-2">
          Show more ({formatInt(results.length - limit)} left)
        </button>
      )}
    </>
  )
}

function Select({ label, value, onChange, options, all, disabled }: { label: string; value: string; onChange: (v: string) => void; options: string[]; all: string; disabled?: boolean }) {
  return (
    <label className="text-xs text-ink-2">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded-lg border border-line bg-page px-2 py-1.5 text-sm text-ink disabled:opacity-50"
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
