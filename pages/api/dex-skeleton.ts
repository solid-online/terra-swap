/**
 * GET /api/dex-skeleton: Skeleton Swap's pools (lib/skeleton), for the swap and
 * the Pools tab, each with its fee parts and its owner's switches. The swap
 * page routes only through those with swaps on.
 *
 * Valued at the same market reference as the other pools, so the page ranks
 * them by the same dollar depth. Cached briefly per instance; the page loads it
 * on the side, and swaps work without it.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { annotateValues, usdPrices, type PoolView } from 'lib/dex'
import { skeletonPools } from 'lib/skeleton'
import { shared, sharedMarketPrices, stale } from 'lib/sharedCache'

export interface SkeletonResponse { pools: PoolView[]; at: number }

const FRESH_MS = 170_000

async function build(): Promise<SkeletonResponse> {
  const [pools, market] = await Promise.all([skeletonPools(), sharedMarketPrices()])
  annotateValues(pools, { ...usdPrices(pools), ...market })
  return { pools, at: Date.now() }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<SkeletonResponse>) {
  // Other venues' pools move slowly and a swap is re-checked on chain before signing; three minutes at the CDN is enough, and each region revalidates on its own.
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900')
  try {
    const body = await shared('atrium:dex:skeleton:v1', FRESH_MS, build, v => v.pools.length > 0)
    if (body.pools.length > 0) return res.status(200).json(body)
    return res.status(200).json((await stale<typeof body>('atrium:dex:skeleton:v1')) ?? body)
  } catch {
    return res.status(200).json((await stale('atrium:dex:skeleton:v1')) ?? { pools: [], at: 0 })
  }
}
