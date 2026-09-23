/**
 * GET /api/stats — router use and routing gains over the last 30 days, a few
 * trades re-priced now, and this month's uptime. See lib/stats. Kept fifteen
 * minutes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { sitePools } from 'lib/sitePools'
import { computeStats, type StatsResponse } from 'lib/stats'
import { shared, stale } from 'lib/sharedCache'

export const config = { maxDuration: 60 }

export type { StatsResponse }

const KEEP_MS = 15 * 60_000

async function build(): Promise<StatsResponse> {
  const { pools, px } = await sitePools()
  return computeStats(pools, px)
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<StatsResponse | { error: string }>) {
  try {
    const body = await shared<StatsResponse>('atrium:stats:v1', KEEP_MS, build, v => v.router.read !== false && v.tagged.read !== false && v.benchmark.length >= 3)
    const whole = body.router.read !== false && body.tagged.read !== false && body.benchmark.length >= 3
    if (whole) {
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
      return res.status(200).json(body)
    }
    // A partial reading, which a busy endpoint produces, is shown once and asked for again rather than served to everyone.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json((await stale<StatsResponse>('atrium:stats:v1')) ?? body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    const last = await stale<StatsResponse>('atrium:stats:v1')
    return last ? res.status(200).json(last) : res.status(502).json({ error: 'could not read the chain' })
  }
}
