/**
 * GET /api/push-check — sends the price alerts that crossed their level to
 * browsers that asked for them with the page closed (lib/push).
 *
 * Called every ten minutes by the uptime workflow. It runs at most once a
 * minute however often it is called, and each alert is sent once. A browser
 * whose push address the push service reports as gone is forgotten.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import webpush from 'web-push'
import { DEX_FACTORY, marketPrices } from 'lib/dex'
import { fmtUsdPrice } from 'lib/alerts'
import { deleteSub, listIds, readSubs, writeSub } from 'lib/pushStore'

export const config = { maxDuration: 60 }

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
/** Who push services should contact about these messages: the site itself. */
const SUBJECT = process.env.VAPID_SUBJECT || 'https://swap.terraluna.app'
const LOCK = 'atrium:push:v1:lock'
/** The market reference /api/dex-market keeps; read from there when it is fresh, so a check does not scan Astroport again. */
const MARKET_KEY = `atrium:dex:market:v2:${DEX_FACTORY}`
let lastRun = 0

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!PUBLIC_KEY || !PRIVATE_KEY) return res.status(200).json({ sent: 0, reason: 'not configured on this host' })
  const now = Date.now()
  if (HAS_KV) {
    const got = await vercelKv.set(LOCK, now, { nx: true, ex: 50 })
    if (got !== 'OK') return res.status(200).json({ sent: 0, reason: 'checked less than a minute ago' })
  } else {
    if (now - lastRun < 50_000) return res.status(200).json({ sent: 0, reason: 'checked less than a minute ago' })
    lastRun = now
  }

  try {
    const kept = HAS_KV ? await vercelKv.get<{ px: Record<string, number>; at: number }>(MARKET_KEY) : null
    const px = kept && now - kept.at < 15 * 60_000 ? kept.px : await marketPrices()
    if (Object.keys(px).length < 2) return res.status(503).json({ sent: 0, reason: 'no market reference right now' })

    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
    const ids = await listIds()
    const subs = await readSubs(ids)
    let sent = 0, removed = 0
    for (let i = 0; i < ids.length; i++) {
      const sub = subs[i]
      if (!sub) { await deleteSub(ids[i]); continue }
      let changed = false, gone = false
      for (const a of sub.alerts) {
        if (a.firedAt) continue
        const p = px[a.tokenId]
        if (!(p > 0) || !((a.dir === 'above' && p >= a.usd) || (a.dir === 'below' && p <= a.usd))) continue
        const payload = JSON.stringify({
          title: `${a.label} is ${a.dir} $${fmtUsdPrice(a.usd)}`,
          body: `$${fmtUsdPrice(p)} at the market reference. Terra Swap`,
          url: `/token/${encodeURIComponent(a.key)}`,
          tag: a.id,
        })
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 6 * 3600, urgency: 'high' })
          a.firedAt = now
          a.firedUsd = p
          changed = true
          sent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) { await deleteSub(ids[i]); removed++; gone = true; break }
        }
      }
      if (changed && !gone) await writeSub(sub)
    }
    return res.status(200).json({ checked: ids.length, sent, removed })
  } catch {
    return res.status(503).json({ sent: 0, reason: 'the store or the chain did not answer' })
  }
}
