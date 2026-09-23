/**
 * GET /api/stats — router use and routing gains over the last 30 days, a few
 * trades re-priced now, and this month's uptime. See lib/stats. Kept fifteen
 * minutes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { sitePools } from 'lib/sitePools'
import { computeStats, type StatsResponse } from 'lib/stats'
import { withCpu } from 'lib/cpuLog'

export const config = { maxDuration: 60 }

export type { StatsResponse }

const KEEP_MS = 15 * 60_000
let mem: StatsResponse | null = null
let inflight: Promise<StatsResponse> | null = null

async function build(): Promise<StatsResponse> {
  const { pools, px } = await sitePools()
  return computeStats(pools, px)
}

async function handler(_req: NextApiRequest, res: NextApiResponse<StatsResponse | { error: string }>) {
  if (mem && Date.now() - mem.at < KEEP_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json(mem)
  }
  if (!inflight) inflight = build().finally(() => { inflight = null })
  try {
    const body = await inflight
    // A reading that could not reach the chain's history, or could not price the trades, is not kept, so the next
    // visitor gets a real one. A missing uptime log does not count against it.
    const whole = body.router.read !== false && body.tagged.read !== false && body.benchmark.length >= 3
    if (whole) mem = body
    res.setHeader('Cache-Control', whole ? 'public, s-maxage=900, stale-while-revalidate=3600' : 'no-store')
    return res.status(200).json(whole ? body : mem ?? body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return mem ? res.status(200).json(mem) : res.status(502).json({ error: 'could not read the chain' })
  }
}

export default withCpu('api/stats', handler)
