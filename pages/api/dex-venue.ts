/**
 * GET /api/dex-venue — the other site's pools, for routing.
 *
 * Terra Swap routes a swap through Astroport's pools when that pays better, and
 * the Astroport interface routes through Terra Swap's pools when one of those
 * is the better price. Both need the other factory's pools with live reserves,
 * real spot prices and a dollar depth. Only pairs of tokens we can name.
 * The pool-scan workflow builds it (lib/poolScans, lib/scanPlan); the page
 * loads it on the side.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { AWAY_VENUE } from 'lib/dex'
import { venueScan, type VenueResponse } from 'lib/poolScans'
import { SCAN_PLAN } from 'lib/scanPlan'
import { stale } from 'lib/sharedCache'

export type { VenueResponse }

async function handler(_req: NextApiRequest, res: NextApiResponse<VenueResponse>) {
  // Other venues' pools move slowly and a swap is re-checked on chain before signing; three minutes at the CDN is enough, and each region revalidates on its own.
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900')
  const { key } = SCAN_PLAN.venue
  try {
    const body = await venueScan()
    if (body.pools.length > 0) return res.status(200).json(body)
    return res.status(200).json((await stale<VenueResponse>(key)) ?? body)
  } catch {
    return res.status(200).json((await stale<VenueResponse>(key)) ?? { venue: AWAY_VENUE, pools: [], at: 0 })
  }
}

export default withCpu('dex-venue', handler)
