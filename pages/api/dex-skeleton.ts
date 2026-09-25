/**
 * GET /api/dex-skeleton: Skeleton Swap's pools (lib/skeleton), for the swap and
 * the Pools tab, each with its fee parts and its owner's switches. The swap
 * page routes only through those with swaps on.
 *
 * Valued at the same market reference as the other pools, so the page ranks
 * them by the same dollar depth. The pool-scan workflow builds it
 * (lib/poolScans, lib/scanPlan); the page loads it on the side, and swaps work
 * without it.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { skeletonScan, type SkeletonResponse } from 'lib/poolScans'
import { SCAN_PLAN } from 'lib/scanPlan'
import { stale } from 'lib/sharedCache'

export type { SkeletonResponse }

async function handler(_req: NextApiRequest, res: NextApiResponse<SkeletonResponse>) {
  // Other venues' pools move slowly and a swap is re-checked on chain before signing; three minutes at the CDN is enough, and each region revalidates on its own.
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900')
  const { key } = SCAN_PLAN.skeleton
  try {
    const body = await skeletonScan()
    if (body.pools.length > 0) return res.status(200).json(body)
    return res.status(200).json((await stale<SkeletonResponse>(key)) ?? body)
  } catch {
    return res.status(200).json((await stale<SkeletonResponse>(key)) ?? { pools: [], at: 0 })
  }
}

export default withCpu('dex-skeleton', handler)
