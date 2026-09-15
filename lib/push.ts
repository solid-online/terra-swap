/**
 * Price alerts that reach a phone or a desktop with no Terra Swap page open.
 *
 * Off until someone turns it on, per browser. Turning it on registers the
 * service worker (public/sw.js), asks the browser for a push subscription, and
 * sends that subscription with this browser's waiting alerts to /api/push. The
 * server keeps exactly that: the push address the browser handed out, its two
 * encryption keys, and the alert levels. No wallet, no name, no IP address.
 * Every ten minutes /api/push-check compares the alerts with the market
 * reference and sends the ones that crossed, once each. Turning it off, or
 * removing the last alert, deletes the record.
 */

import { useEffect, useState } from 'react'
import { markFired, readAlerts, type PriceAlert } from 'lib/alerts'

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const FLAG = 'terraswap_push'
const EVENT = 'terra:push'

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
}

/** iPhone and iPad deliver web notifications only to a site added to the home screen. */
export function needsInstall(): boolean {
  if (typeof window === 'undefined') return false
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return ios && !standalone
}

export function pushOn(): boolean {
  try { return localStorage.getItem(FLAG) === '1' } catch { return false }
}
function setFlag(on: boolean) {
  try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG) } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* ssr */ }
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const waiting = (alerts: PriceAlert[]) => alerts.filter(a => !a.firedAt).map(a => ({ id: a.id, tokenId: a.tokenId, dir: a.dir, usd: a.usd }))

const post = (body: object) => fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

export async function enablePush(): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!pushSupported()) return { ok: false, why: 'This browser cannot receive notifications while the page is closed.' }
  if (needsInstall()) return { ok: false, why: 'On iPhone and iPad this works once Terra Swap is on the home screen: Share, then Add to Home Screen, then turn it on from there.' }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (permission !== 'granted') return { ok: false, why: 'Notifications are blocked for this site in the browser settings.' }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
    const r = await post({ action: 'save', subscription: sub.toJSON(), alerts: waiting(readAlerts()) })
    if (!r.ok) return { ok: false, why: 'The server did not take it. Try again in a moment.' }
    setFlag(true)
    return { ok: true }
  } catch {
    return { ok: false, why: 'The browser refused the subscription. Try again, or in another browser.' }
  }
}

export async function disablePush(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (sub) {
      await post({ action: 'delete', endpoint: sub.endpoint }).catch(() => null)
      await sub.unsubscribe().catch(() => false)
    }
  } catch { /* the flag goes either way */ } finally { setFlag(false) }
}

/**
 * Whether this browser can take alerts with the page closed and has them on.
 * While on, the server is kept to this browser's current waiting alerts, and
 * the ones it sent in the meantime are marked as gone off. `alerts` only says
 * when to sync; what is sent is read from storage at that moment, so the empty
 * list a page holds before it mounts never wipes the server's copy.
 */
export function usePush(alerts: PriceAlert[]): { supported: boolean; on: boolean } {
  const [state, setState] = useState({ supported: false, on: false })
  useEffect(() => {
    const f = () => setState({ supported: pushSupported(), on: pushOn() })
    f()
    window.addEventListener(EVENT, f)
    return () => window.removeEventListener(EVENT, f)
  }, [])
  const sig = JSON.stringify(waiting(alerts))
  useEffect(() => {
    if (!state.on) return
    let alive = true
    ;(async () => {
      const sub = await currentSubscription().catch(() => null)
      if (!sub) { setFlag(false); return }
      const r = await post({ action: 'save', subscription: sub.toJSON(), alerts: waiting(readAlerts()) }).catch(() => null)
      const j = r?.ok ? ((await r.json().catch(() => null)) as { fired?: { id: string; firedAt: number; firedUsd: number }[] } | null) : null
      if (alive && j?.fired?.length) markFired(j.fired)
    })()
    return () => { alive = false }
  }, [state.on, sig])
  return state
}
