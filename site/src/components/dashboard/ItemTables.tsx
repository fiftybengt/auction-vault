import { useState, type ReactNode } from 'react'
import { formatInt } from '../../lib/format'
import type { ExtremeRow, PricedRow, ValuableRow } from '../../lib/types'
import { Money } from '../Money'
import { ItemLink } from '../Quality'
import { ChangePill } from './ui'

// Ranked lists from dashboard.json, styled like a market-cap table: rank, item, right-aligned
// tabular numbers, a coloured change pill, thin dividers and a subtle row hover. The export has
// already sorted and capped them; the site shows the first rows and lets the viewer expand.
// Under 640px the secondary columns fold into a muted line under the item and the pill moves
// under the price, so there is never a horizontal page scroll.

const FIRST = 10

function useShowMore<T>(rows: T[]) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST)
  const more =
    rows.length > FIRST ? (
      <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-semibold text-accent hover:underline">
        {all ? 'Show fewer' : `Show all ${rows.length}`}
      </button>
    ) : null
  return { shown, more }
}

const th = 'sticky top-0 z-[1] bg-surface py-2 pr-3 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase last:pr-0'
const td = 'py-2 pr-3 align-top last:pr-0'
const tr = 'border-t border-hairline transition-colors hover:bg-surface-2/50'
const sm = 'hidden sm:table-cell'

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-sm tabular">
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

function Rank({ n }: { n: number }) {
  return <td className={`${td} w-6 text-right text-xs text-muted`}>{n}</td>
}

function ItemCell({ market, r, children }: { market: string; r: { key: string; name: string; quality: number }; children?: ReactNode }) {
  return (
    <td className={`${td} w-full min-w-0`}>
      <ItemLink market={market} itemKey={r.key} name={r.name} quality={r.quality} />
      {children && <div className="mt-0.5 text-xs text-muted">{children}</div>}
    </td>
  )
}

/** Price cell; on mobile the change pill sits under the price. */
function PriceCell({ c, pct }: { c: number | null; pct: number }) {
  return (
    <td className={`${td} text-right whitespace-nowrap`}>
      <Money c={c} className="font-semibold" />
      <div className="mt-1 sm:hidden">
        <ChangePill p={pct} />
      </div>
    </td>
  )
}

export function PricedTable({ rows, market, kind }: { rows: PricedRow[]; market: string; kind: 'deal' | 'over' }) {
  const { shown, more } = useShowMore(rows)
  const gainLabel = kind === 'deal' ? 'Saving' : 'Above normal'
  return (
    <>
      <Table
        head={
          <>
            <th className={`${th} text-right`}>#</th>
            <th className={th}>Item</th>
            <th className={`${th} ${sm} text-right`}>Bundle</th>
            <th className={`${th} text-right`}>{kind === 'deal' ? 'Unit price' : 'Market value'}</th>
            <th className={`${th} ${sm} text-right`}>Normal</th>
            <th className={`${th} ${sm} text-right`}>Change</th>
            <th className={`${th} ${sm} text-right`}>{gainLabel}</th>
          </>
        }
      >
        {shown.map((r, i) => (
          <tr key={r.key} className={tr}>
            <Rank n={i + 1} />
            <ItemCell market={market} r={r}>
              <span className="sm:hidden">
                {r.bundle}× · normal <Money c={r.ref} /> · {gainLabel.toLowerCase()} <Money c={r.gain} />
              </span>
              <span className="hidden sm:inline">{formatInt(r.listings)} listed</span>
            </ItemCell>
            <td className={`${td} ${sm} text-right text-ink-2`}>{r.bundle}×</td>
            <PriceCell c={r.unit} pct={r.pct} />
            <td className={`${td} ${sm} text-right whitespace-nowrap text-ink-2`}>
              <Money c={r.ref} />
            </td>
            <td className={`${td} ${sm} text-right`}>
              <ChangePill p={r.pct} />
            </td>
            <td className={`${td} ${sm} text-right whitespace-nowrap`}>
              <Money c={r.gain} />
              <div className="text-xs text-muted">per {r.bundle}</div>
            </td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}

export function ExtremeTable({ rows, market, side }: { rows: ExtremeRow[]; market: string; side: 'low' | 'high' }) {
  const { shown, more } = useShowMore(rows)
  const prevLabel = side === 'low' ? 'Previous low' : 'Previous high'
  return (
    <>
      <Table
        head={
          <>
            <th className={`${th} text-right`}>#</th>
            <th className={th}>Item</th>
            <th className={`${th} text-right`}>Today</th>
            <th className={`${th} ${sm} text-right`}>{prevLabel}</th>
            <th className={`${th} ${sm} text-right`}>Change</th>
            <th className={`${th} ${sm} text-right`}>Listed</th>
          </>
        }
      >
        {shown.map((r, i) => (
          <tr key={r.key} className={tr}>
            <Rank n={i + 1} />
            <ItemCell market={market} r={r}>
              <span className="sm:hidden">
                {prevLabel.toLowerCase()} <Money c={r.prev} /> · {formatInt(r.listings)} listed
              </span>
            </ItemCell>
            <PriceCell c={r.unit} pct={r.pct} />
            <td className={`${td} ${sm} text-right whitespace-nowrap text-ink-2`}>
              <Money c={r.prev} />
            </td>
            <td className={`${td} ${sm} text-right`}>
              <ChangePill p={r.pct} />
            </td>
            <td className={`${td} ${sm} text-right text-ink-2`}>{formatInt(r.listings)}</td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}

export function ValuableTable({ rows, market }: { rows: ValuableRow[]; market: string }) {
  const { shown, more } = useShowMore(rows)
  return (
    <>
      <Table
        head={
          <>
            <th className={`${th} text-right`}>#</th>
            <th className={th}>Item</th>
            <th className={`${th} text-right`}>Market value</th>
            <th className={`${th} ${sm} text-right`}>Lowest</th>
            <th className={`${th} ${sm} text-right`}>Listed</th>
          </>
        }
      >
        {shown.map((r, i) => (
          <tr key={r.key} className={tr}>
            <Rank n={i + 1} />
            <ItemCell market={market} r={r}>
              <span className="sm:hidden">
                lowest <Money c={r.min} none="No buyout" /> · {formatInt(r.listings)} listed
              </span>
            </ItemCell>
            <td className={`${td} text-right whitespace-nowrap`}>
              <Money c={r.unit} className="font-semibold" />
            </td>
            <td className={`${td} ${sm} text-right whitespace-nowrap text-ink-2`}>
              <Money c={r.min} none="No buyout" />
            </td>
            <td className={`${td} ${sm} text-right text-ink-2`}>{formatInt(r.listings)}</td>
          </tr>
        ))}
      </Table>
      {more}
    </>
  )
}
