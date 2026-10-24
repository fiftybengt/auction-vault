import { Link, useRouteError } from 'react-router'
import { Problem } from '../components/States'

export default function NotFound() {
  const err = useRouteError()
  return (
    <div className="mx-auto max-w-xl p-4">
      <Problem title={err ? 'Something went wrong' : 'Page not found'}>
        {err instanceof Error ? err.message : null}{' '}
        <Link to="/" className="text-accent underline">
          Go to the overview
        </Link>
      </Problem>
    </div>
  )
}
