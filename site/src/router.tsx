import { createHashRouter } from 'react-router'
import { Layout } from './components/Layout'
import { Loading } from './components/States'
import Home from './pages/Home'
import NotFound from './pages/NotFound'

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default })

// Hash routing: GitHub Pages has no SPA fallback.
export const router = createHashRouter([
  { path: '/', Component: Home, ErrorBoundary: NotFound },
  {
    path: '/:market',
    Component: Layout,
    ErrorBoundary: NotFound,
    HydrateFallback: Loading,
    children: [
      { index: true, lazy: page(() => import('./pages/Overview')) },
      { path: 'search', lazy: page(() => import('./pages/Search')) },
      { path: 'item/:key', lazy: page(() => import('./pages/Item')) },
      { path: 'seller/:name', lazy: page(() => import('./pages/Seller')) },
    ],
  },
  { path: '*', Component: NotFound },
])
