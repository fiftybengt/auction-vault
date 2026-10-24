import type { ReactNode } from 'react'
import { useMeta } from '../lib/data'
import { ago, formatInt, fullTime } from '../lib/format'
import { useNow } from '../lib/useNow'

const STALE_AFTER = 36 * 3600

function When({ at, now }: { at: number; now: number }) {
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={fullTime(at)} className="font-semibold text-ink">
      {ago(at, now)}
    </time>
  )
}

/** Always-visible data freshness for a market. */
export function Freshness({ market }: { market: string }) {
  const meta = useMeta(market)
  const now = useNow()

  if (meta.status === 'loading') return <Bar>Checking data freshness…</Bar>
  if (meta.status !== 'ready') return <Bar warn>Data freshness unknown: meta.json could not be loaded.</Bar>

  const { lastScan: last, lastCompleteScan: done } = meta.data
  const coverage = last.expectedTotal > 0 ? Math.round((last.rowCount / last.expectedTotal) * 100) : null
  const partialNote = (
    <>
      was partial ({formatInt(last.rowCount)}
      {last.expectedTotal > 0 && ` of ${formatInt(last.expectedTotal)}`} rows{coverage !== null && `, ${coverage}%`}) and is not shown.
    </>
  )

  if (!done) {
    return (
      <Bar warn>
        <span>
          <strong className="text-ink">No complete scan yet.</strong> Last scan <When at={last.at} now={now} /> {partialNote}
        </span>
        <Footnote meta={meta.data} now={now} />
      </Bar>
    )
  }

  const stale = now - done.at > STALE_AFTER
  return (
    <Bar warn={stale}>
      <span>
        Last scan <When at={last.at} now={now} />
        {!last.complete && (
          <>
            {' '}
            {partialNote} Prices are from the complete scan <When at={done.at} now={now} />.
          </>
        )}
      </span>
      {stale && <span className="font-semibold text-warning-ink">Data may be out of date.</span>}
      <Footnote meta={meta.data} now={now} />
    </Bar>
  )
}

function Footnote({ meta, now }: { meta: { scanCount: number; completeScanCount: number; generatedAt: number }; now: number }) {
  return (
    <span className="text-muted">
      {formatInt(meta.completeScanCount)} of {formatInt(meta.scanCount)} scans complete · exported {ago(meta.generatedAt, now)}
    </span>
  )
}

function Bar({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-1.5 text-xs text-ink-2 ${warn ? 'border-warning' : 'border-line'} bg-surface`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className={warn ? 'text-warning-ink' : 'text-up'}>
        {warn ? '⚠' : '●'}
      </span>
      {children}
    </div>
  )
}
