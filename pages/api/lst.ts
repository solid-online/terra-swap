/**
 * GET /api/lst — liquid staking tokens in the pools against their hubs, for a
 * $100 and a $5,000 trade each way. See lib/lstBoard. Kept five minutes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { sitePools } from 'lib/sitePools'
import { lstBoard, type LstRow } from 'lib/lstBoard'
import { LST_HUBS } from 'lib/lst'

export const config = { maxDuration: 60 }

export interface LstResponse { rows: LstRow[]; at: number }

const KEEP_MS = 5 * 60_000
let mem: LstResponse | null = null
let inflight: Promise<LstResponse> | null = null

async function build(): Promise<LstResponse> {
  const { pools, px } = await sitePools()
  return { rows: await lstBoard(pools, px), at: Date.now() }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<LstResponse | { error: string }>) {
  if (mem && Date.now() - mem.at < KEEP_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
    return res.status(200).json(mem)
  }
  if (!inflight) inflight = build().finally(() => { inflight = null })
  try {
    const body = await inflight
    // Kept only when every hub answered and every size was priced both ways. A partial reading, which a busy
    // endpoint produces, is shown once and asked for again rather than served to everyone for five minutes.
    const whole = body.rows.length === LST_HUBS.length && body.rows.every(r => r.sizes.every(s => s.sell && s.buy))
    if (whole) mem = body
    res.setHeader('Cache-Control', whole ? 'public, s-maxage=300, stale-while-revalidate=900' : 'no-store')
    return res.status(200).json(whole ? body : mem ?? body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return mem ? res.status(200).json(mem) : res.status(502).json({ error: 'could not price the hubs' })
  }
}
