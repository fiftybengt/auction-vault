// Keeps the 1.2x Wowhead hover tooltip (see the "Wowhead tooltip overrides" block in index.css)
// inside the viewport. Wowhead measures and places the box itself, but two of its checks use
// unscaled numbers: whether the box is taller than the window (offsetHeight ignores transforms)
// and where its own icon sits (it assumes 44px). So after each time it moves or refills the box,
// before the next paint, this:
//   1. lowers the scale until the box fits the window height (below 1x only if even 1x would
//      not fit, never below MIN_SCALE), and
//   2. nudges the box so it and its icon are fully on screen.
// It ignores the mutations its own writes cause (takeRecords), resets the scale when the box
// hides, and gives up on a box (data-av-unfit: index.css then leaves it a plain, unscaled
// Wowhead tooltip) if moving it via inline left/top has no effect or it keeps re-firing.
const SCALE = 1.2
const MARGIN = 8
// Only for boxes taller than the window even at 1x (e.g. set items in a 640px-high window).
const MIN_SCALE = 0.8

const UNFIT = 'data-av-unfit' // set when we give up on a box; index.css then leaves it unscaled
const MAX_PASSES_PER_FRAME = 8

// Returns false when the box is not one we understand, so the caller stops managing it.
function fit(tip: HTMLElement): boolean {
  if (tip.style.display === 'none' || getComputedStyle(tip).visibility !== 'visible') {
    // Hidden: drop our scale so Wowhead measures the next tooltip at the default 1.2x.
    if (tip.style.getPropertyValue('--av-wh-scale')) tip.style.removeProperty('--av-wh-scale')
    return true
  }
  const h = tip.offsetHeight // layout height, unaffected by the transform
  if (h === 0) return true
  const scale = Math.max(MIN_SCALE, Math.min(SCALE, (window.innerHeight - 2 * MARGIN) / h))
  const want = scale.toFixed(3)
  if (tip.style.getPropertyValue('--av-wh-scale') !== want) tip.style.setProperty('--av-wh-scale', want)

  const r = tip.getBoundingClientRect()
  const icon = tip.querySelector<HTMLElement>('.whtt-tooltip-icon')
  const iconW = icon && icon.style.visibility === 'visible' ? r.left - icon.getBoundingClientRect().left : 0
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  let left = Math.min(r.left, vw - MARGIN - r.width)
  left = Math.max(left, MARGIN + iconW)
  let top = Math.min(r.top, vh - MARGIN - r.height)
  top = Math.max(top, MARGIN)
  const dx = left - r.left
  const dy = top - r.top
  if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) return true

  const was = { left: tip.style.left, top: tip.style.top }
  if (Math.abs(dx) > 0.5) tip.style.left = `${parseFloat(was.left || '0') + dx}px`
  if (Math.abs(dy) > 0.5) tip.style.top = `${parseFloat(was.top || '0') + dy}px`
  // Inline left/top must move the box (absolute/fixed, nothing !important). If not, Wowhead has
  // changed how it positions: undo, and leave this box alone.
  const moved = tip.getBoundingClientRect()
  if (Math.abs(moved.left - left) > 1 || Math.abs(moved.top - top) > 1) {
    tip.style.left = was.left
    tip.style.top = was.top
    return false
  }
  return true
}

function giveUp(tip: HTMLElement) {
  tip.setAttribute(UNFIT, '')
  tip.style.removeProperty('--av-wh-scale')
}

export function keepWowheadTooltipsInView() {
  const watched = new WeakSet<Element>()
  const passes = new WeakMap<Element, number>()
  let resetQueued = false
  const run = (tip: HTMLElement) => {
    if (tip.hasAttribute(UNFIT) || tip.parentElement !== document.body) return
    // Hard stop for anything that keeps re-triggering us within one frame.
    const n = (passes.get(tip) ?? 0) + 1
    passes.set(tip, n)
    if (!resetQueued) {
      resetQueued = true
      requestAnimationFrame(() => {
        resetQueued = false
        for (const t of document.querySelectorAll('body > .wowhead-tooltip')) passes.delete(t)
      })
    }
    if (n > MAX_PASSES_PER_FRAME || !fit(tip)) giveUp(tip)
  }
  const tipObserver = new MutationObserver((records) => {
    const tips = new Set(records.map((rec) => (rec.target instanceof Element ? rec.target.closest('.wowhead-tooltip') : null)))
    for (const tip of tips) if (tip instanceof HTMLElement) run(tip)
    // One pass is enough (layout reads already include our writes); drop the records our own
    // style writes just queued so they do not call us again.
    tipObserver.takeRecords()
  })
  const watch = () => {
    for (const tip of document.querySelectorAll<HTMLElement>('body > .wowhead-tooltip')) {
      if (watched.has(tip)) continue
      watched.add(tip)
      tipObserver.observe(tip, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true, characterData: true })
      run(tip) // its first fill and placement happened before we were watching
      tipObserver.takeRecords()
    }
  }
  // tooltips.js creates its box lazily, on the first hover.
  new MutationObserver(watch).observe(document.body, { childList: true })
  watch()
}
