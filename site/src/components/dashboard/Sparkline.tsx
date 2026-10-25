// A tiny no-axis trend line for ticker cards. Nulls break the line; a lone value is a dot.
export function Sparkline({ values, color, height = 28 }: { values: (number | null)[]; color: string; height?: number }) {
  const W = 100
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return <div style={{ height }} aria-hidden="true" />
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const x = (i: number) => (values.length > 1 ? i * step : W / 2)
  const y = (v: number) => 2 + (1 - (v - min) / span) * (height - 4)
  const runs: string[] = []
  const dots: [number, number][] = []
  let cur: string[] = []
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length > 1) runs.push(cur.join(' '))
      cur = []
      return
    }
    cur.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    if (values[i - 1] == null && values[i + 1] == null) dots.push([x(i), y(v)])
  })
  if (cur.length > 1) runs.push(cur.join(' '))
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true">
      {runs.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke={`var(${color})`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {dots.map(([cx, cy], i) => (
        <line key={`d${i}`} x1={cx} x2={cx} y1={cy} y2={cy} stroke={`var(${color})`} strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
