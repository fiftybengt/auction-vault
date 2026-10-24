import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { cssVar, useResolvedTheme } from '../../lib/theme'

// The site's one charting primitive: a time-series line chart on a single y-axis, drawn with
// uPlot. Marks follow the dataviz spec: 2px lines, a ~16% wash for bands, hairline solid grid,
// a crosshair that snaps to the nearest scan, one tooltip listing every series, keyboard access.

export interface LineSpec {
  label: string
  /** CSS custom property holding the colour, e.g. '--series-1' */
  color: string
  values: (number | null)[]
}

export interface BandSpec {
  label: string
  /** CSS custom property for the fill */
  fill: string
  lo: (number | null)[]
  hi: (number | null)[]
}

interface Props {
  /** unix seconds, ascending */
  xs: number[]
  lines: LineSpec[]
  band?: BandSpec
  yFormat: (v: number) => string
  height?: number
  /** Tooltip body for point i (index into xs). */
  tooltip: (i: number) => ReactNode
  ariaLabel: string
  /** Break the line where consecutive points are further apart than this (seconds). */
  gapSeconds?: number
}

type Hover = { i: number; left: number; width: number; offL: number; offT: number }

export function TimeChart({ xs, lines, band, yFormat, height = 220, tooltip, ariaLabel, gapSeconds = 16 * 3600 }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const uRef = useRef<uPlot | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const theme = useResolvedTheme()

  // Insert null rows into long gaps so sparse items show breaks instead of invented trends.
  // map[k] = index into the caller's xs for plotted row k, or -1 for an inserted gap row.
  const { data, map } = useMemo(() => {
    const px: number[] = []
    const map: number[] = []
    const sources = [...(band ? [band.hi, band.lo] : []), ...lines.map((l) => l.values)]
    const cols: (number | null)[][] = sources.map(() => [])
    xs.forEach((x, i) => {
      const prev = xs[i - 1]
      if (prev !== undefined && x - prev > gapSeconds) {
        px.push(prev + (x - prev) / 2)
        map.push(-1)
        for (const c of cols) c.push(null)
      }
      px.push(x)
      map.push(i)
      sources.forEach((src, s) => cols[s]?.push(src[i] ?? null))
    })
    return { data: [px, ...cols] as uPlot.AlignedData, map }
  }, [xs, lines, band, gapSeconds])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const muted = cssVar('--ink-muted')
    const grid = cssVar('--hairline')
    const axis = cssVar('--axis')
    const surface = cssVar('--surface')
    const font = `11px ${getComputedStyle(document.body).fontFamily}`
    const axisCommon = {
      stroke: muted,
      font,
      grid: { stroke: grid, width: 1 },
      ticks: { stroke: axis, width: 1, size: 4 },
      border: { show: true, stroke: axis, width: 1 },
    }
    const series: uPlot.Series[] = [{}]
    if (band) {
      series.push({ label: `${band.label} high`, stroke: 'transparent', width: 0, points: { show: false } })
      series.push({ label: `${band.label} low`, stroke: 'transparent', width: 0, points: { show: false } })
    }
    for (const l of lines) {
      const c = cssVar(l.color)
      series.push({
        label: l.label,
        stroke: c,
        width: 2,
        spanGaps: false,
        // Isolated observations (no neighbour on either side) get a dot, else they would be invisible.
        points: {
          show: true,
          filter: (u, s) => {
            const ys = u.data[s] ?? []
            const out: number[] = []
            for (let i = 0; i < ys.length; i++) if (ys[i] != null && ys[i - 1] == null && ys[i + 1] == null) out.push(i)
            return out
          },
          size: 8,
          fill: c,
          stroke: surface,
          width: 2,
        },
      })
    }
    const opts: uPlot.Options = {
      width: el.clientWidth || 320,
      height,
      series,
      bands: band ? [{ series: [1, 2], fill: cssVar(band.fill) }] : [],
      legend: { show: false },
      padding: [8, 8, 0, 0],
      scales: { x: { time: true }, y: { range: (_u, min, max) => yRange(min, max) } },
      axes: [
        { ...axisCommon, space: 70 },
        { ...axisCommon, size: 52, values: (_u, vals) => vals.map((v) => (v == null ? '' : yFormat(v))) },
      ],
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 8,
          width: 2,
          stroke: surface,
          fill: (u, s) => {
            const st = u.series[s]?.stroke
            return typeof st === 'string' && st !== 'transparent' ? st : 'transparent'
          },
        },
        y: false,
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            if (idx == null || u.cursor.left == null || u.cursor.left < 0) {
              setHover(null)
              return
            }
            setHover({ i: idx, left: u.cursor.left, width: u.over.clientWidth, offL: u.over.offsetLeft, offT: u.over.offsetTop })
          },
        ],
      },
    }
    const u = new uPlot(opts, data, el)
    uRef.current = u
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0 && w !== u.width) u.setSize({ width: w, height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      uRef.current = null
    }
    // theme: re-read colour tokens when the effective theme flips
  }, [data, lines, band, yFormat, height, theme])

  function onKey(e: React.KeyboardEvent) {
    const u = uRef.current
    if (!u) return
    const xsPlotted = data[0]
    let idx = u.cursor.idx ?? -1
    const step = (dir: number) => {
      do idx += dir
      while (idx >= 0 && idx < map.length && map[idx] === -1)
    }
    if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(idx < 0 ? map.length + 1 : -1)
    else if (e.key === 'Home') idx = map.findIndex((m) => m !== -1)
    else if (e.key === 'End') idx = map.length - 1
    else if (e.key === 'Escape') {
      u.setCursor({ left: -10, top: -10 })
      setHover(null)
      return
    } else return
    e.preventDefault()
    idx = Math.max(0, Math.min(map.length - 1, idx))
    const x = xsPlotted[idx]
    if (x == null) return
    u.setCursor({ left: u.valToPos(x, 'x'), top: 10 })
  }

  const srcIndex = hover ? (map[hover.i] ?? -1) : -1
  const flip = hover ? hover.left > hover.width / 2 : false

  return (
    <div
      className="relative outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use left and right arrow keys to read values.`}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      {(lines.length > 1 || band) && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-hidden="true">
          {lines.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: `var(${l.color})` }} />
              {l.label}
            </li>
          ))}
          {band && (
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: `var(${band.fill})` }} />
              {band.label}
            </li>
          )}
        </ul>
      )}
      <div ref={plotRef} className="w-full" style={{ minHeight: height }} />
      {hover && srcIndex >= 0 && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{
            top: hover.offT + 4,
            left: flip ? undefined : hover.offL + hover.left + 12,
            right: flip ? `calc(100% - ${hover.offL + hover.left - 12}px)` : undefined,
          }}
          role="status"
        >
          {tooltip(srcIndex)}
        </div>
      )}
    </div>
  )
}

function yRange(min: number | null, max: number | null): uPlot.Range.MinMax {
  if (min == null || max == null) return [0, 1]
  if (min === max) return [Math.max(0, min * 0.9), max * 1.1 || 1]
  const pad = (max - min) * 0.08
  return [Math.max(0, min - pad), max + pad]
}

/** A row in a chart tooltip: value first (strong), series name after, keyed by a line swatch. */
export function TipRow({ color, label, children }: { color?: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {color ? (
        <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: `var(${color})` }} />
      ) : (
        <span className="inline-block w-3 shrink-0" />
      )}
      <span className="font-semibold text-ink">{children}</span>
      <span className="text-ink-2">{label}</span>
    </div>
  )
}
