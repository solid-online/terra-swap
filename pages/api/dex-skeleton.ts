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
import { annotateValues, marketPrices, usdPrices, type PoolView } from 'lib/dex'
import { skeletonPools } from 'lib/skeleton'
import { withCpu } from 'lib/cpuLog'

export interface SkeletonResponse { pools: PoolView[]; at: number }

const FRESH_MS = 170_000
let mem: SkeletonResponse | null = null
let inflight: Promise<SkeletonResponse> | null = null

async function build(): Promise<SkeletonResponse> {
  const [pools, market] = await Promise.all([skeletonPools(), marketPrices()])
  annotateValues(pools, { ...usdPrices(pools), ...market })
  return { pools, at: Date.now() }
}

async function handler(_req: NextApiRequest, res: NextApiResponse<SkeletonResponse>) {
  // Other venues' pools move slowly and a swap is re-checked on chain before signing; three minutes at the CDN is enough, and each region revalidates on its own.
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900')
  if (mem && Date.now() - mem.at < FRESH_MS) return res.status(200).json(mem)
  if (!inflight) inflight = build().finally(() => { inflight = null })
  try {
    const body = await inflight
    if (body.pools.length > 0) mem = body
    return res.status(200).json(mem ?? body)
  } catch {
    return res.status(200).json(mem ?? { pools: [], at: 0 })
  }
}

export default withCpu('api/dex-skeleton', handler)
