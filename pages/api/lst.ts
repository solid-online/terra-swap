/**
 * GET /api/lst — liquid staking tokens in the pools against their hubs, for a
 * $100 and a $5,000 trade each way. See lib/lstBoard. Kept five minutes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { sitePools } from 'lib/sitePools'
import { lstBoard, type LstRow } from 'lib/lstBoard'
import { LST_HUBS } from 'lib/lst'
import { shared, stale } from 'lib/sharedCache'

export const config = { maxDuration: 60 }

export interface LstResponse { rows: LstRow[]; at: number }

const KEEP_MS = 5 * 60_000

async function build(): Promise<LstResponse> {
  const { pools, px } = await sitePools()
  return { rows: await lstBoard(pools, px), at: Date.now() }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<LstResponse | { error: string }>) {
  try {
    const body = await shared<LstResponse>('atrium:lst:v1', KEEP_MS, build, v => v.rows.length === LST_HUBS.length && v.rows.every(r => r.sizes.every(s => s.sell && s.buy)))
    const whole = body.rows.length === LST_HUBS.length && body.rows.every(r => r.sizes.every(s => s.sell && s.buy))
    if (whole) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      return res.status(200).json(body)
    }
    // A partial reading, which a busy endpoint produces, is shown once and asked for again rather than served to everyone.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json((await stale<LstResponse>('atrium:lst:v1')) ?? body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    const last = await stale<LstResponse>('atrium:lst:v1')
    return last ? res.status(200).json(last) : res.status(502).json({ error: 'could not price the hubs' })
  }
}
