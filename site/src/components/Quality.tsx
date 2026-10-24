import { Link } from 'react-router'
import { keyToFile } from '../lib/data'
import { qualityName } from '../lib/format'
import { qualityClass } from '../lib/quality'

export function ItemLink({ market, itemKey, name, quality }: { market: string; itemKey: string; name: string; quality: number }) {
  return (
    <Link
      to={`/${market}/item/${keyToFile(itemKey)}`}
      className={`${qualityClass(quality)} font-medium hover:underline focus-visible:underline`}
      title={qualityName(quality)}
    >
      {name}
    </Link>
  )
}
