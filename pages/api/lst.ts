/**
 * GET /api/lst — liquid staking tokens in the pools against their hubs, for a
 * $100 and a $5,000 trade each way. See lib/lstBoard. The pool-scan workflow
 * builds it every five minutes (lib/poolScans, lib/scanPlan).
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { lstScan, wholeLst, type LstResponse } from 'lib/poolScans'
import { SCAN_PLAN } from 'lib/scanPlan'
import { stale } from 'lib/sharedCache'

export const config = { maxDuration: 60 }

export type { LstResponse }

async function handler(_req: NextApiRequest, res: NextApiResponse<LstResponse | { error: string }>) {
  const { key } = SCAN_PLAN.lst
  try {
    const body = await lstScan()
    if (wholeLst(body)) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      return res.status(200).json(body)
    }
    // A partial reading, which a busy endpoint produces, is shown once and asked for again rather than served to everyone.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json((await stale<LstResponse>(key)) ?? body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    const last = await stale<LstResponse>(key)
    return last ? res.status(200).json(last) : res.status(502).json({ error: 'could not price the hubs' })
  }
}

export default withCpu('lst', handler)
