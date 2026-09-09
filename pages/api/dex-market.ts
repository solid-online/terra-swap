/**
 * GET /api/dex-market — USD reference prices from Astroport's deepest
 * pools, for the "off market" warnings.
 *
 * Split out of /api/dex on purpose (2026-09-09): scanning Astroport's
 * ~850 pairs on a cold instance took long enough that the swap page showed
 * "Loading…" for ten-plus seconds — a user's first impression was "not
 * loading". Now the main API never waits for this; the page fetches it on the
 * side and paints deviations when they arrive.
 *
 * Two caches in KV, namespaced by factory: the relevant-pairs list (a day — it
 * barely changes) and the prices (five minutes).
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY, marketPrices } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
// v2 (2026-09-09): v1 holds prices computed before usdPrices learned to prefer
// the deepest route, so its ROAR is 91% low. Bumping the key retires those
// values outright rather than waiting for them to age out.
const KEY = `atrium:dex:market:v2:${DEX_FACTORY}`
const FRESH_MS = 300_000

export interface MarketResponse { px: Record<string, number>; at: number }

let mem: MarketResponse | null = null

export default async function handler(_req: NextApiRequest, res: NextApiResponse<MarketResponse>) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
  const cached = HAS_KV ? await vercelKv.get<MarketResponse>(KEY) : mem
  if (cached && Date.now() - cached.at < FRESH_MS) return res.status(200).json(cached)
  const px = await marketPrices()
  const body: MarketResponse = { px, at: Date.now() }
  if (Object.keys(px).length > 1) {
    if (HAS_KV) await vercelKv.set(KEY, body, { ex: 1800 }); else mem = body
    return res.status(200).json(body)
  }
  // Scan failed or came back empty: serve whatever we last had rather than nothing.
  return res.status(200).json(cached ?? body)
}
