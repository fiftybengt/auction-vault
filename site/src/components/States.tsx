import type { ReactNode } from 'react'
import type { Resource } from '../lib/data'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted" role="status">
      {label}
    </p>
  )
}

export function Problem({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4" role="alert">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>
}

/** Renders loading / missing / error for a resource, or the children with its data. */
export function Gate<T>({ r, what, children }: { r: Resource<T>; what: string; children: (data: T) => ReactNode }) {
  if (r.status === 'loading') return <Loading label={`Loading ${what}…`} />
  if (r.status === 'missing') return <Problem title={`No ${what} found`}>The data export does not include it.</Problem>
  if (r.status === 'error') return <Problem title={`Could not load ${what}`}>{r.error}</Problem>
  return <>{children(r.data)}</>
}

export function Card({ title, subtitle, children, actions }: { title?: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      {(title || actions) && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatTile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-1 text-lg font-semibold">{children}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  )
}

/** Shown wherever "current" data is needed but meta.lastCompleteScan is null. */
export function NoCompleteScan({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-warning bg-surface p-4" role="status">
      <p className="font-semibold">
        <span aria-hidden="true" className="text-warning-ink">
          ⚠{' '}
        </span>
        No complete scan yet
      </p>
      <p className="mt-1 text-sm text-ink-2">
        Only partial scans have been uploaded so far, and partial scans are never used for prices. {what} will appear after the
        first full auction house scan.
      </p>
    </div>
  )
}
