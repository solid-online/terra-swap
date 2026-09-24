/**
 * Whether anyone is looking at the page: it is visible, and someone touched it
 * in the last ten minutes. The page's background reads (`poll`) ask this before
 * each request, so a tab left open on a second screen overnight stops asking.
 * The first touch or return to the tab after that catches every poll up at once.
 *
 * Why (2026-09-24): Vercel's Hobby plan counts every request to the site,
 * served from the CDN or not (a million a month for every site together), and
 * an open swap page asked about nine times a minute whether anyone was there
 * or not.
 */

const IDLE_MS = 10 * 60_000

let lastTouch = Date.now()
/** Set when a poll found nobody looking, so the next touch knows to catch up. */
let asleep = false
const wakers = new Set<() => void>()

function touch() {
  lastTouch = Date.now()
  if (!asleep || document.hidden) return
  asleep = false
  wakers.forEach(w => w())
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, touch, { passive: true, capture: true })
  }
  document.addEventListener('visibilitychange', touch)
  window.addEventListener('focus', touch)
}

export function pageActive(): boolean {
  if (typeof document === 'undefined') return false
  const on = !document.hidden && Date.now() - lastTouch < IDLE_MS
  if (!on) asleep = true
  return on
}

/**
 * Run `fn` now, then every `ms` while the page is active; when someone comes
 * back after it was not, run it at once if the last run is older than `ms`.
 * Returns the function that stops it.
 */
export function poll(fn: () => void, ms: number): () => void {
  let last = 0
  const run = () => { last = Date.now(); fn() }
  run()
  const iv = setInterval(() => { if (pageActive()) run() }, ms)
  const wake = () => { if (Date.now() - last >= ms) run() }
  wakers.add(wake)
  return () => { clearInterval(iv); wakers.delete(wake) }
}
