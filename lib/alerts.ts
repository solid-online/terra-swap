/**
 * Favourite tokens and price alerts, kept in this browser only
 * (localStorage): nothing about them leaves the device or reaches any server.
 *
 * An alert goes off once, when an open Terra Swap page sees the market
 * reference cross its level: as a note on the page, and as a browser
 * notification when the person has allowed those. With no Terra Swap page
 * open, nothing watches; the page says so where alerts are set.
 */

import { useEffect, useState } from 'react'

const FAV_KEY = 'terraswap_favorites'
const ALERT_KEY = 'terraswap_alerts'
const EVENT = 'terra:prefs'

export interface PriceAlert {
  id: string
  /** asset id, the key into the market reference */
  tokenId: string
  key: string
  label: string
  dir: 'above' | 'below'
  /** US dollars per whole token */
  usd: number
  created: number
  firedAt?: number
  firedUsd?: number
}

function read(k: string): unknown {
  try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* private mode: nothing is kept */ }
}

export function readFavorites(): string[] {
  const v = read(FAV_KEY)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
export function toggleFavorite(id: string) {
  const f = readFavorites()
  write(FAV_KEY, f.includes(id) ? f.filter(x => x !== id) : [id, ...f].slice(0, 24))
}

export function readAlerts(): PriceAlert[] {
  const v = read(ALERT_KEY)
  return Array.isArray(v) ? v.filter((a): a is PriceAlert => !!a && typeof a === 'object' && typeof (a as PriceAlert).usd === 'number' && typeof (a as PriceAlert).tokenId === 'string') : []
}
export function addAlert(a: Pick<PriceAlert, 'tokenId' | 'key' | 'label' | 'dir' | 'usd'>) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  write(ALERT_KEY, [...readAlerts(), { ...a, id, created: Date.now() }].slice(-30))
}
export function removeAlert(id: string) {
  write(ALERT_KEY, readAlerts().filter(a => a.id !== id))
}

/** Favourites and alerts, re-read when they change in this tab or another. Empty until mounted, so server and browser render the same. */
export function usePrefs(): { favorites: string[]; alerts: PriceAlert[] } {
  const [n, bump] = useState(0)
  useEffect(() => {
    const f = () => bump(x => x + 1)
    f()
    window.addEventListener(EVENT, f)
    window.addEventListener('storage', f)
    return () => { window.removeEventListener(EVENT, f); window.removeEventListener('storage', f) }
  }, [])
  return n === 0 ? { favorites: [], alerts: [] } : { favorites: readFavorites(), alerts: readAlerts() }
}

export const notificationsAllowed = () => typeof Notification !== 'undefined' && Notification.permission === 'granted'

/** Asks for browser notifications, only ever from a click. False when the browser has none or they were refused. */
export async function askNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission !== 'default') return Notification.permission === 'granted'
  try { return (await Notification.requestPermission()) === 'granted' } catch { return false }
}

export const fmtUsdPrice = (n: number) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : Number(n.toPrecision(4)).toString())

/** Alerts `px` has crossed, marked as gone off so each fires once, with a browser notification where allowed. */
export function fireAlerts(px: Record<string, number> | null): PriceAlert[] {
  if (!px || typeof window === 'undefined') return []
  const fired: PriceAlert[] = []
  const next = readAlerts().map(a => {
    if (a.firedAt) return a
    const p = px[a.tokenId]
    if (!(p > 0)) return a
    if ((a.dir === 'above' && p >= a.usd) || (a.dir === 'below' && p <= a.usd)) {
      const f = { ...a, firedAt: Date.now(), firedUsd: p }
      fired.push(f)
      return f
    }
    return a
  })
  if (fired.length === 0) return []
  write(ALERT_KEY, next)
  if (notificationsAllowed()) {
    for (const f of fired) {
      try {
        new Notification(`${f.label} is ${f.dir} $${fmtUsdPrice(f.usd)}`, { body: `$${fmtUsdPrice(f.firedUsd ?? 0)} at the market reference. Terra Swap`, icon: '/img/icon-192.png', tag: f.id })
      } catch { /* phones only notify through a service worker; the note on the page still shows */ }
    }
  }
  return fired
}

/** Checks alerts whenever `px` changes, and hands the ones that went off to `onFire`. */
export function useAlertWatcher(px: Record<string, number> | null, onFire: (fired: PriceAlert[]) => void) {
  useEffect(() => {
    const fired = fireAlerts(px)
    if (fired.length) onFire(fired)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px])
}
