import { parseItemKey } from './data'

// Wowhead tooltips (index.html loads wow.zamimg.com/js/tooltips.js). Its delegated mouseover
// handler reads `data-wowhead` on any <a> with an href, walking up to 5 parents from the target.
// `domain=wotlk` selects the WotLK Classic data env (the script also accepts `wrath`);
// `rand` is the random-suffix (enchantment) id, which is negative for 3.3.5a suffixes.
const DOMAIN = 'wotlk'

export function wowheadData(itemKey: string): string {
  const { id, suffix } = parseItemKey(itemKey)
  return `item=${id}&domain=${DOMAIN}${suffix !== 0 ? `&rand=${suffix}` : ''}`
}

export function wowheadUrl(itemKey: string): string {
  const { id, suffix } = parseItemKey(itemKey)
  return `https://www.wowhead.com/wotlk/item=${id}${suffix !== 0 ? `?rand=${suffix}` : ''}`
}
