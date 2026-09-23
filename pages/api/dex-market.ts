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
 * The pool-scan workflow builds it every five minutes (lib/sharedCache,
 * lib/scanPlan), under a key namespaced by factory. v2 of that key
 * (2026-09-09) retired prices computed before usdPrices learned to prefer the
 * deepest route, whose ROAR was 91% low.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { SCAN_PLAN } from 'lib/scanPlan'
import { keepMarket, marketScan, stale, type MarketScan } from 'lib/sharedCache'

export type MarketResponse = MarketScan

export default async function handler(_req: NextApiRequest, res: NextApiResponse<MarketResponse>) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
  const body = await marketScan().catch(() => ({ px: {}, at: 0 }))
  if (keepMarket(body)) return res.status(200).json(body)
  // Scan failed or came back empty: serve whatever we last had rather than nothing.
  return res.status(200).json((await stale<MarketResponse>(SCAN_PLAN.market.key)) ?? body)
}
