import { Navigate } from 'react-router'
import { Loading, Problem } from '../components/States'
import { useMarkets } from '../lib/data'

/** `/` -> the first market in markets.json. */
export default function Home() {
  const markets = useMarkets()
  if (markets.status === 'loading') return <Loading label="Loading markets…" />
  const first = markets.status === 'ready' ? markets.data[0] : undefined
  if (!first)
    return (
      <div className="mx-auto max-w-xl p-4">
        <Problem title="No market data yet">markets.json is missing or empty. Run the export, or `npm run fixture` locally.</Problem>
      </div>
    )
  return <Navigate to={`/${first.slug}`} replace />
}
