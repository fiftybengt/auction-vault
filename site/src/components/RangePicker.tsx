import { RANGES, type Range } from '../lib/series'

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={value === r.id}
          onClick={() => onChange(r.id)}
          className={`rounded-md px-3 py-1 ${value === r.id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2/60'}`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
