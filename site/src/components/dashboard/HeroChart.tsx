import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { cssVar, useResolvedTheme } from '../../lib/theme'

// The Overview's hero chart (uPlot, the site's one chart library): one main series drawn as a
// 2px line over a vertical gradient wash that fades to transparent, optional comparison lines,
// minimal horizontal gridlines, the y-axis on the right, and a hairline crosshair that snaps to
// the nearest day. It reports the scrubbed index so the headline can follow the pointer.
// Nulls break the line; time gaps never do (the index chains across missing days).

export interface HeroLine {
  label: string
  /** CSS custom property, e.g. '--gain' */
  color: string
  values: (number | null)[]
}

interface Props {
  /** unix seconds, ascending */
  xs: number[]
  main: HeroLine
  compares: HeroLine[]
  yFormat: (v: number) => string
  xTickFormat: (at: number) => string
  onScrub: (i: number | null) => void
  ariaLabel: string
  height?: number
}

function rgba(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m?.[1]) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Isolated observations (no neighbour on either side) get a dot, else they would be invisible.
const isolated: uPlot.Series.Points.Filter = (u, s) => {
  const ys = u.data[s] ?? []
  const out: number[] = []
  for (let i = 0; i < ys.length; i++) if (ys[i] != null && ys[i - 1] == null && ys[i + 1] == null) out.push(i)
  return out
}

export function HeroChart({ xs, main, compares, yFormat, xTickFormat, onScrub, ariaLabel, height = 240 }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const uRef = useRef<uPlot | null>(null)
  const scrubRef = useRef(onScrub)
  const theme = useResolvedTheme()

  useEffect(() => {
    scrubRef.current = onScrub
  }, [onScrub])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const muted = cssVar('--ink-muted')
    const grid = cssVar('--hairline')
    const surface = cssVar('--surface')
    const font = `11px ${getComputedStyle(document.body).fontFamily}`
    const mainColor = cssVar(main.color)
    const line = (l: HeroLine, fill?: uPlot.Series.Fill): uPlot.Series => {
      const c = cssVar(l.color)
      return {
        label: l.label,
        stroke: c,
        width: 2,
        fill,
        spanGaps: false,
        points: { show: true, filter: isolated, size: 8, fill: c, stroke: surface, width: 2 },
      }
    }
    const gradient: uPlot.Series.Fill = (u) => {
      const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height)
      g.addColorStop(0, rgba(mainColor, 0.22))
      g.addColorStop(1, rgba(mainColor, 0))
      return g
    }
    const opts: uPlot.Options = {
      width: el.clientWidth || 320,
      height,
      legend: { show: false },
      // left: room for the first day label, which is centred on the first point
      padding: [10, 0, 0, 26],
      series: [{}, line(main, gradient), ...compares.map((c) => line(c))],
      scales: {
        x: { time: true },
        y: {
          range: (_u, min, max) => {
            if (min == null || max == null) return [0, 1]
            if (min === max) return [min - 1, max + 1]
            const pad = (max - min) * 0.12
            return [min - pad, max + pad]
          },
        },
      },
      axes: [
        {
          stroke: muted,
          font,
          grid: { show: false },
          ticks: { show: false },
          border: { show: true, stroke: grid, width: 1 },
          space: 64,
          // Ticks on real days only, every k-th so labels stay ~64px apart, always including the last.
          splits: (u) => {
            const k = Math.max(1, Math.ceil((xs.length * 64) / Math.max(1, u.bbox.width / devicePixelRatio)))
            return xs.filter((_, i) => (xs.length - 1 - i) % k === 0)
          },
          values: (_u, vals) => vals.map((v) => (v == null ? '' : xTickFormat(v))),
        },
        {
          side: 1,
          stroke: muted,
          font,
          size: 44,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          values: (_u, vals) => vals.map((v) => (v == null ? '' : yFormat(v))),
        },
      ],
      cursor: {
        drag: { x: false, y: false },
        y: false,
        points: {
          size: 9,
          width: 2,
          stroke: surface,
          fill: (u, s) => {
            const st = u.series[s]?.stroke
            return typeof st === 'string' ? st : mainColor
          },
        },
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            scrubRef.current(idx == null || u.cursor.left == null || u.cursor.left < 0 ? null : idx)
          },
        ],
      },
    }
    const data = [xs, main.values, ...compares.map((c) => c.values)] as uPlot.AlignedData
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
  }, [xs, main, compares, yFormat, xTickFormat, height, theme])

  function onKey(e: React.KeyboardEvent) {
    const u = uRef.current
    if (!u || xs.length === 0) return
    let idx = u.cursor.idx ?? -1
    if (e.key === 'ArrowRight') idx = idx < 0 ? 0 : idx + 1
    else if (e.key === 'ArrowLeft') idx = idx < 0 ? xs.length - 1 : idx - 1
    else if (e.key === 'Home') idx = 0
    else if (e.key === 'End') idx = xs.length - 1
    else if (e.key === 'Escape') {
      u.setCursor({ left: -10, top: -10 })
      onScrub(null)
      return
    } else return
    e.preventDefault()
    idx = Math.max(0, Math.min(xs.length - 1, idx))
    const x = xs[idx]
    if (x != null) u.setCursor({ left: u.valToPos(x, 'x'), top: 10 })
  }

  return (
    <div
      className="hero-chart rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use left and right arrow keys to read values; the headline above follows.`}
      onKeyDown={onKey}
      onBlur={() => {
        uRef.current?.setCursor({ left: -10, top: -10 })
        onScrub(null)
      }}
    >
      <div ref={plotRef} className="w-full" style={{ minHeight: height }} />
    </div>
  )
}
