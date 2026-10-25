import { useState } from 'react'

// Icons come from Wowhead's CDN by texture basename (C4 v3 `icon`). The rendered box is fixed
// so nothing shifts while the image loads; the quality colour is on the border.
const FALLBACK = 'inv_misc_questionmark'
const SIZES = {
  // zamimg image sizes: small 18px, medium 36px, large 56px
  small: { px: 18, box: 'size-5 border rounded-sm' },
  medium: { px: 36, box: 'size-[38px] border rounded' },
  large: { px: 56, box: 'size-[60px] border-2 rounded-md' },
} as const
const BORDER = ['border-q0', 'border-q1', 'border-q2', 'border-q3', 'border-q4', 'border-q5', 'border-q6', 'border-q7']

type IconSize = keyof typeof SIZES

function iconUrl(icon: string, size: IconSize): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${encodeURIComponent(icon.toLowerCase())}.jpg`
}

export function ItemIcon({ icon, quality, size }: { icon?: string | null; quality: number; size: IconSize }) {
  const name = icon || FALLBACK
  // Remember which icon failed, so a new `icon` prop gets a fresh attempt.
  const [failed, setFailed] = useState<string | null>(null)
  const shown = failed === name ? FALLBACK : name
  const s = SIZES[size]
  const outer = size === 'large' ? s.px + 4 : s.px + 2
  return (
    <img
      src={iconUrl(shown, size)}
      alt=""
      width={outer}
      height={outer}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        if (shown !== FALLBACK) setFailed(name)
      }}
      className={`inline-block shrink-0 bg-surface-2 align-middle ${s.box} ${BORDER[quality] ?? 'border-q1'}`}
    />
  )
}
