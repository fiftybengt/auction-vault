// Static class names so Tailwind can see them. Colours live in index.css (--q-*).
const QUALITY_TEXT = ['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4', 'text-q5', 'text-q6', 'text-q7']

export function qualityClass(q: number): string {
  return QUALITY_TEXT[q] ?? 'text-q1'
}
