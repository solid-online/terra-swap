/**
 * GET /api/dex-venue — the other site's pools, for routing.
 *
 * Terra Swap routes a swap through Astroport's pools when that pays better, and
 * the Astroport interface routes through Terra Swap's pools when one of those
 * is the better price. Both need the other factory's pools with live reserves,
 * real spot prices and a dollar depth. Only pairs of tokens we can name.
 * Cached briefly per instance; the page loads it on the side.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  AWAY_VENUE, VENUE_FACTORY, knownPairs, queryPairsOf, queryPool, toPoolView, refineSpot,
  annotateValues, usdPrices, type PoolView, type Venue,
} from 'lib/dex'
import { shared, sharedMarketPrices, stale } from 'lib/sharedCache'

export interface VenueResponse { venue: Venue; pools: PoolView[]; at: number }

const FRESH_MS = 170_000

async function build(): Promise<VenueResponse> {
  const pairs = knownPairs(await queryPairsOf(VENUE_FACTORY[AWAY_VENUE]))
  const views = await Promise.all(pairs.map(async p => toPoolView(p, await queryPool(p.contract_addr), AWAY_VENUE)))
  const pools = views.filter(p => !p.empty)
  await refineSpot(pools)
  // Astroport's markets set the price wherever they have one. A token they have no deep market for
  // (USDC.inj on 2026-09-14) is priced from these pools instead; without a dollar depth its pools
  // were never routed, so on the pools site USDC.inj could not be swapped at all.
  annotateValues(pools, { ...usdPrices(pools), ...(await sharedMarketPrices()) })
  return { venue: AWAY_VENUE, pools, at: Date.now() }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<VenueResponse>) {
  // Other venues' pools move slowly and a swap is re-checked on chain before signing; three minutes at the CDN is enough, and each region revalidates on its own.
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900')
  try {
    const body = await shared('atrium:dex:venue:v1', FRESH_MS, build, v => v.pools.length > 0)
    if (body.pools.length > 0) return res.status(200).json(body)
    return res.status(200).json((await stale<typeof body>('atrium:dex:venue:v1')) ?? body)
  } catch {
    return res.status(200).json((await stale('atrium:dex:venue:v1')) ?? { venue: AWAY_VENUE, pools: [], at: 0 })
  }
}
