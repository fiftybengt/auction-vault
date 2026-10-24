import { moneyText, splitCopper } from '../lib/format'
import type { Copper } from '../lib/types'

/** Integer copper rendered as `12g 34s 56c`. Zero units are dropped (`8g 83s`, `5g 7c`); 0 is `0c`. */
export function Money({ c, className = '', none = 'No buyout' }: { c: Copper | null | undefined; className?: string; none?: string }) {
  if (c == null) {
    return (
      <span className={`text-muted ${className}`} title={none}>
        —<span className="sr-only">{none}</span>
      </span>
    )
  }
  const { neg, g, s, c: cu } = splitCopper(c)
  const units: [number, string, string][] = []
  if (g) units.push([g, 'g', 'text-gold'])
  if (s) units.push([s, 's', 'text-silver'])
  if (cu || units.length === 0) units.push([cu, 'c', 'text-copper'])
  return (
    <span className={`tabular whitespace-nowrap ${className}`} aria-label={moneyText(c)}>
      {neg && '-'}
      {units.map(([v, u, cls], i) => (
        <span key={u}>
          {i > 0 && ' '}
          {u === 'g' ? v.toLocaleString('en-US') : v}
          <span className={cls}>{u}</span>
        </span>
      ))}
    </span>
  )
}
