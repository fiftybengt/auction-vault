import { useEffect, useState } from 'react'

/** Current unix seconds, refreshed every `everyMs` so relative times ("2h ago") stay true. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}
