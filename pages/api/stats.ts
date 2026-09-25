/**
 * GET /api/stats — router use and routing gains over the last 30 days, a few
 * trades re-priced now, and this month's uptime. See lib/stats. The pool-scan
 * workflow builds it every fifteen minutes (lib/poolScans, lib/scanPlan).
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { statsScan, wholeStats } from 'lib/poolScans'
import { SCAN_PLAN } from 'lib/scanPlan'
import { stale } from 'lib/sharedCache'
import type { StatsResponse } from 'lib/stats'

export const config = { maxDuration: 60 }

export type { StatsResponse }

async function handler(_req: NextApiRequest, res: NextApiResponse<StatsResponse | { error: string }>) {
  const { key } = SCAN_PLAN.stats
  try {
    const body = await statsScan()
    if (wholeStats(body)) {
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
      return res.status(200).json(body)
    }
    // A partial reading, which a busy endpoint produces, is shown once and asked for again rather than served to everyone.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json((await stale<StatsResponse>(key)) ?? body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    const last = await stale<StatsResponse>(key)
    return last ? res.status(200).json(last) : res.status(502).json({ error: 'could not read the chain' })
  }
}

export default withCpu('stats', handler)
