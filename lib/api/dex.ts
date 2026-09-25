/**
 * GET /api/dex — every pool this build lists, with live reserves and spot prices.
 *
 * One server-side fan-out so the swap page makes one request instead of
 * N+1 LCD calls from every visitor's browser. The pool-scan workflow builds
 * it (lib/dexHome, lib/scanPlan); this route reads it back.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { isDexLive, POOL_FEE_BPS, DEX_MODE } from 'lib/dex'
import type { DexResponse } from 'lib/dexHome'
import { homeScan } from 'lib/poolScans'
import { SCAN_PLAN } from 'lib/scanPlan'
import { stale } from 'lib/sharedCache'

export type { DexResponse }

async function handler(_req: NextApiRequest, res: NextApiResponse<DexResponse>) {
  // Each CDN region revalidates on its own, and each revalidation is a request Hobby counts; the scan behind it changes once a minute.
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')
  if (!isDexLive()) {
    return res.status(200).json({ live: false, mode: DEX_MODE, pools: [], feeBps: 0, poolFeeBps: POOL_FEE_BPS, tvlUsd: 0, height: 0, chainId: '', proposer: '', seoul: null })
  }
  try {
    return res.status(200).json((await homeScan()).body)
  } catch (e) {
    const last = await stale<{ at: number; body: DexResponse }>(SCAN_PLAN.home.key)
    if (last) return res.status(200).json(last.body)
    throw e
  }
}

export default handler
