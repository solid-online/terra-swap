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
  annotateValues, marketPrices, usdPrices, type PoolView, type Venue,
} from 'lib/dex'

export interface VenueResponse { venue: Venue; pools: PoolView[]; at: number }

const FRESH_MS = 20_000
let mem: VenueResponse | null = null
let inflight: Promise<VenueResponse> | null = null

async function build(): Promise<VenueResponse> {
  const pairs = knownPairs(await queryPairsOf(VENUE_FACTORY[AWAY_VENUE]))
  const views = await Promise.all(pairs.map(async p => toPoolView(p, await queryPool(p.contract_addr), AWAY_VENUE)))
  const pools = views.filter(p => !p.empty)
  await refineSpot(pools)
  // Astroport's markets set the price wherever they have one. A token they have no deep market for
  // (USDC.inj on 2026-09-14) is priced from these pools instead; without a dollar depth its pools
  // were never routed, so on the pools site USDC.inj could not be swapped at all.
  annotateValues(pools, { ...usdPrices(pools), ...(await marketPrices()) })
  return { venue: AWAY_VENUE, pools, at: Date.now() }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<VenueResponse>) {
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60')
  if (mem && Date.now() - mem.at < FRESH_MS) return res.status(200).json(mem)
  if (!inflight) inflight = build().finally(() => { inflight = null })
  try {
    const body = await inflight
    if (body.pools.length > 0) mem = body
    return res.status(200).json(mem ?? body)
  } catch {
    return res.status(200).json(mem ?? { venue: AWAY_VENUE, pools: [], at: 0 })
  }
}
