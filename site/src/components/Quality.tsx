import { Link } from 'react-router'
import { keyToFile } from '../lib/data'
import { qualityClass } from '../lib/quality'
import { wowheadData } from '../lib/wowhead'

// No `title`: the Wowhead tooltip (index.html) shows on hover instead. Taps on touch screens
// just follow the link to our item page.
// A plain inline link: inside a `truncate` parent it ends in an ellipsis; elsewhere (Seller
// table cells) it wraps, breaking long words if it must so the cell can shrink.
export function ItemLink({ market, itemKey, name, quality }: { market: string; itemKey: string; name: string; quality: number }) {
  return (
    <Link
      to={`/${market}/item/${keyToFile(itemKey)}`}
      data-wowhead={wowheadData(itemKey)}
      className={`${qualityClass(quality)} font-medium wrap-break-word hover:underline focus-visible:underline`}
    >
      {name}
    </Link>
  )
}
