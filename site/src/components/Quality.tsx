import { Link } from 'react-router'
import { keyToFile } from '../lib/data'
import { qualityClass } from '../lib/quality'
import { wowheadData } from '../lib/wowhead'
import { ItemIcon } from './ItemIcon'

// No `title`: the Wowhead tooltip (index.html) shows on hover instead. Taps on touch screens
// just follow the link to our item page.
export function ItemLink({
  market,
  itemKey,
  name,
  quality,
  icon,
}: {
  market: string
  itemKey: string
  name: string
  quality: number
  icon: string | null | undefined
}) {
  return (
    <Link
      to={`/${market}/item/${keyToFile(itemKey)}`}
      data-wowhead={wowheadData(itemKey)}
      className={`${qualityClass(quality)} group inline-flex max-w-full items-center gap-1.5 align-middle font-medium`}
    >
      <ItemIcon icon={icon} quality={quality} size="small" />
      <span className="truncate group-hover:underline group-focus-visible:underline">{name}</span>
    </Link>
  )
}
