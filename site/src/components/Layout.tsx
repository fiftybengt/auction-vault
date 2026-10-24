import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { useMarkets } from '../lib/data'
import { useThemePref, type ThemePref } from '../lib/theme'
import { Freshness } from './Freshness'
import { Loading, Problem } from './States'

export function Layout() {
  const { market = '' } = useParams()
  const markets = useMarkets()

  let body: React.ReactNode
  if (markets.status === 'loading') body = <Loading label="Loading markets…" />
  else if (markets.status !== 'ready') body = <Problem title="Could not load markets.json">No data has been exported yet, or the file is unreachable.</Problem>
  else if (!markets.data.some((m) => m.slug === market))
    body = <Problem title={`Unknown market “${market}”`}>Pick a realm and faction from the menu above.</Problem>
  else body = <Outlet />

  const known = markets.status === 'ready' && markets.data.some((m) => m.slug === market)

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <NavLink to={`/${market}`} className="mr-auto text-lg font-bold tracking-tight whitespace-nowrap">
          Auction <span className="text-gold">Vault</span>
        </NavLink>
        <MarketSwitcher market={market} />
        <nav className="flex w-full items-center gap-1 text-sm sm:w-auto" aria-label="Main">
          <Tab to={`/${market}`} end>
            Overview
          </Tab>
          <Tab to={`/${market}/search`}>Search</Tab>
          <span className="ml-auto sm:ml-2">
            <ThemeToggle />
          </span>
        </nav>
      </header>
      {known && <Freshness market={market} />}
      <main className="flex-1 py-4">{body}</main>
      <footer className="border-t border-line py-4 text-xs text-muted">
        Prices are per unit, from complete auction house scans. Sellers show as “unknown” when the server sent no name.
      </footer>
    </div>
  )
}

function Tab({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 ${isActive ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2/60'}`
      }
    >
      {children}
    </NavLink>
  )
}

function MarketSwitcher({ market }: { market: string }) {
  const markets = useMarkets()
  const navigate = useNavigate()
  const location = useLocation()
  if (markets.status !== 'ready' || markets.data.length === 0) return null
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Realm and faction</span>
      <select
        value={market}
        onChange={(e) => navigate(location.pathname.replace(/^\/[^/]*/, `/${e.target.value}`) + location.search)}
        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-ink"
      >
        {!markets.data.some((m) => m.slug === market) && <option value={market}>Choose a market</option>}
        {markets.data.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.realm} · {m.faction}
          </option>
        ))}
      </select>
    </label>
  )
}

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<ThemePref, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }

function ThemeToggle() {
  const [pref, setPref] = useThemePref()
  return (
    <button
      type="button"
      onClick={() => setPref(NEXT[pref])}
      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink-2"
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}.`}
    >
      <span aria-hidden="true">{pref === 'dark' ? '☾' : pref === 'light' ? '☀' : '◐'}</span>
      <span className="hidden sm:inline"> {LABEL[pref]}</span>
    </button>
  )
}
