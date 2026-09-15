/**
 * POST /api/push — a browser's price alerts, kept so they can reach it with no
 * Terra Swap page open (lib/push, lib/pushStore).
 *
 *   { action: 'save', subscription, alerts }  store or replace; an empty list deletes the record
 *   { action: 'delete', endpoint }            forget this browser
 *
 * A save answers with the alerts the server already sent, so the page can
 * mark them as gone off. The push address travels in the body, never in a URL.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { KNOWN_TOKENS, assetId } from 'lib/dex'
import { MAX_ALERTS, MAX_SUBS, countSubs, deleteSub, readSub, subId, writeSub, type StoredAlert } from 'lib/pushStore'

/** The push services browsers use: Google's, Mozilla's, Apple's and Microsoft's. */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]
const WRITES_PER_MINUTE = 120
let windowAt = 0
let windowWrites = 0

function endpointOf(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 800) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && PUSH_HOSTS.some(h => h.test(u.hostname)) ? v : null
  } catch { return null }
}

const b64url = (v: unknown, min: number, max: number) => typeof v === 'string' && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v)

function alertsOf(v: unknown): StoredAlert[] | null {
  if (!Array.isArray(v) || v.length > MAX_ALERTS) return null
  const out: StoredAlert[] = []
  for (const a of v) {
    const x = a as Partial<StoredAlert>
    const token = KNOWN_TOKENS.find(t => assetId(t.info) === x?.tokenId)
    if (!token || typeof x.id !== 'string' || !/^[a-z0-9]{4,24}$/i.test(x.id)) return null
    if (x.dir !== 'above' && x.dir !== 'below') return null
    if (typeof x.usd !== 'number' || !Number.isFinite(x.usd) || x.usd <= 0 || x.usd > 1e12) return null
    out.push({ id: x.id, tokenId: assetId(token.info), key: token.key, label: token.label, dir: x.dir, usd: x.usd })
  }
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const now = Date.now()
  if (now - windowAt > 60_000) { windowAt = now; windowWrites = 0 }
  if (++windowWrites > WRITES_PER_MINUTE) return res.status(429).json({ error: 'busy, try again in a moment' })
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>

  try {
    if (body.action === 'delete') {
      const endpoint = endpointOf(body.endpoint)
      if (!endpoint) return res.status(400).json({ error: 'endpoint must be a browser push address' })
      await deleteSub(subId(endpoint))
      return res.status(200).json({ ok: true })
    }
    if (body.action !== 'save') return res.status(400).json({ error: "action must be 'save' or 'delete'" })
    const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
    const endpoint = endpointOf(sub?.endpoint)
    if (!endpoint || !b64url(sub?.keys?.p256dh, 80, 100) || !b64url(sub?.keys?.auth, 16, 32)) return res.status(400).json({ error: 'subscription must be a browser push subscription' })
    const alerts = alertsOf(body.alerts)
    if (!alerts) return res.status(400).json({ error: `alerts must be at most ${MAX_ALERTS} alerts on listed tokens` })

    const id = subId(endpoint)
    const existing = await readSub(id)
    // What the server sent since the last sync goes back, so the page marks it; the page then stops sending it.
    const fired = (existing?.alerts ?? []).filter(a => a.firedAt).map(a => ({ id: a.id, firedAt: a.firedAt!, firedUsd: a.firedUsd ?? 0 }))
    if (alerts.length === 0) {
      if (existing) await deleteSub(id)
      return res.status(200).json({ ok: true, kept: 0, fired })
    }
    if (!existing && (await countSubs()) >= MAX_SUBS) return res.status(503).json({ error: 'full right now, try again later' })
    // An alert the server already sent stays sent, even if the page has not caught up yet.
    const merged = alerts.map(a => {
      const prev = existing?.alerts.find(x => x.id === a.id && x.dir === a.dir && x.usd === a.usd)
      return prev?.firedAt ? prev : a
    })
    await writeSub({ endpoint, keys: { p256dh: String(sub!.keys!.p256dh), auth: String(sub!.keys!.auth) }, alerts: merged, updated: now })
    return res.status(200).json({ ok: true, kept: merged.filter(a => !a.firedAt).length, fired })
  } catch {
    return res.status(503).json({ error: 'the store did not answer, try again in a moment' })
  }
}
