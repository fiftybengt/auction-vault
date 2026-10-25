import type { KeyboardEvent, ReactNode } from 'react'

// Overview building blocks in a finance-terminal style: flat hairline panels, small uppercase
// labels, compact segmented controls and tabs, and up/down pills that always carry ▲/▼ and a
// sign, so colour is never the only cue.

export function Panel({ label, sub, actions, children, id }: { label: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-3 sm:p-4" aria-labelledby={id}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
            {label}
          </h2>
          {sub && <p className="mt-0.5 text-xs text-ink-2">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/**
 * Roving tabindex for a radiogroup or tablist: one Tab stop (the selected item); arrow keys,
 * Home and End move the selection to the next enabled item and focus it.
 */
function rovingKey<T extends string>(e: KeyboardEvent<HTMLElement>, ids: T[], enabled: (id: T) => boolean, value: T, select: (id: T) => void) {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 0, End: 0 }
  if (!(e.key in keys)) return
  e.preventDefault()
  const live = ids.filter(enabled)
  if (live.length === 0) return
  let next: T | undefined
  if (e.key === 'Home') next = live[0]
  else if (e.key === 'End') next = live[live.length - 1]
  else {
    const at = live.indexOf(value)
    const step = keys[e.key] ?? 1
    next = live[(at + step + live.length) % live.length]
  }
  if (next == null) return
  select(next)
  const el = e.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)
  el?.focus()
}

export interface SegOption<T extends string> {
  id: T
  label: string
  disabled?: boolean
  /** shown on hover, e.g. why an option is disabled */
  title?: string
}

/** Compact single-choice control (radiogroup), e.g. 7D · 30D · 90D · All. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md border border-line bg-page p-0.5 text-xs"
      onKeyDown={(e) =>
        rovingKey(
          e,
          options.map((o) => o.id),
          (id) => !options.find((o) => o.id === id)?.disabled,
          value,
          onChange,
        )
      }
    >
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-id={o.id}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={`rounded px-2.5 py-1 font-semibold tracking-wide ${
              on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'
            } disabled:cursor-not-allowed disabled:font-normal disabled:text-muted disabled:opacity-60 disabled:hover:text-muted`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Underlined tabs, like Gainers / Losers on a market site. The caller renders the active panel. */
export function Tabs<T extends string>({ label, value, tabs, onChange, idBase }: { label: string; value: T; tabs: { id: T; label: string; count?: number }[]; onChange: (v: T) => void; idBase: string }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={(e) =>
        rovingKey(
          e,
          tabs.map((t) => t.id),
          () => true,
          value,
          onChange,
        )
      }
      className="-mx-3 mb-1 flex gap-4 overflow-x-auto border-b border-hairline px-3 text-sm sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            id={`${idBase}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            data-id={t.id}
            tabIndex={on ? 0 : -1}
            aria-controls={`${idBase}-panel`}
            onClick={() => onChange(t.id)}
            className={`-mb-px border-b-2 pt-1 pb-2 whitespace-nowrap ${on ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-px text-[11px] font-medium text-ink-2">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Round first, then take sign and direction from the rounded value, so a rounded 0 is neutral. */
function rounded(p: number, digits: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  const r = Number(p.toFixed(digits))
  const dir = r > 0 ? 'up' : r < 0 ? 'down' : 'flat'
  return { text: `${dir === 'up' ? '+' : dir === 'down' ? '−' : ''}${Math.abs(r).toFixed(digits)}`, dir }
}

/** Coloured % pill: green up, red down (finance convention), with ▲/▼ and a sign. */
export function ChangePill({ p, className = '' }: { p: number | null; className?: string }) {
  if (p == null) return <span className={`text-xs text-muted ${className}`}>—</span>
  const { text, dir } = rounded(p, 1)
  const tone = dir === 'up' ? 'bg-gain-wash text-gain-ink' : dir === 'down' ? 'bg-loss-wash text-loss-ink' : 'bg-surface-2 text-ink-2'
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular ${tone} ${className}`}>
      <span aria-hidden="true" className="text-[0.75em]">
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'}
      </span>
      {text}%
      <span className="sr-only">{dir === 'up' ? ' up' : dir === 'down' ? ' down' : ' unchanged'}</span>
    </span>
  )
}

/** Plain coloured change text (no pill), for dense spots like ticker cards. */
export function ChangeText({ p, suffix = '%', digits = 1, className = '' }: { p: number | null; suffix?: string; digits?: number; className?: string }) {
  if (p == null) return <span className={`text-muted ${className}`}>—</span>
  const { text, dir } = rounded(p, digits)
  const tone = dir === 'up' ? 'text-gain-ink' : dir === 'down' ? 'text-loss-ink' : 'text-ink-2'
  return (
    <span className={`font-semibold whitespace-nowrap tabular ${tone} ${className}`}>
      <span aria-hidden="true" className="mr-0.5 text-[0.75em]">
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'}
      </span>
      {text}
      {suffix}
    </span>
  )
}
