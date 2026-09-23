/**
 * GET /api/volume — dollar volume through Terra Swap's own pools (lib/markets
 * volumeBetween), for DefiLlama's volume adapter (integrations/defillama).
 *
 *   ?date=2026-09-20            one UTC day
 *   ?start=<unix s>&end=<unix s>  any window up to 31 days
 *
 * Swaps are valued at their day's average recorded price; a day before the
 * price history began has none, and its swaps come back as unpriced.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { volumeBetween, type VolumeResponse } from 'lib/markets'
import { withCpu } from 'lib/cpuLog'

export const config = { maxDuration: 60 }

const MAX_WINDOW_S = 31 * 86_400

async function handler(req: NextApiRequest, res: NextApiResponse<VolumeResponse | { error: string }>) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  let start: number, end: number
  if (typeof req.query.date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date) || Number.isNaN(Date.parse(`${req.query.date}T00:00:00Z`))) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
    start = Date.parse(`${req.query.date}T00:00:00Z`) / 1000
    end = start + 86_400
  } else {
    start = Number(req.query.start)
    end = Number(req.query.end)
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || end - start > MAX_WINDOW_S) return res.status(400).json({ error: 'give date=YYYY-MM-DD, or start and end in unix seconds at most 31 days apart' })
  }
  try {
    const body = await volumeBetween(start, end)
    // A window that has ended does not change; one still open does.
    res.setHeader('Cache-Control', end * 1000 < Date.now() - 3_600_000 ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'public, s-maxage=120')
    return res.status(200).json(body)
  } catch {
    return res.status(503).json({ error: 'the store or the chain did not answer, try again in a moment' })
  }
}

export default withCpu('api/volume', handler)
