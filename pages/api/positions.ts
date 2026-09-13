/**
 * GET /api/positions?address=terra1… — every pool position a wallet holds on
 * Terra Swap or Astroport, staked LP included. See lib/positions.
 *
 * Chain data only, the same anyone can read from an explorer. A build reads
 * a few dozen contracts plus the wallet's recent history, so results are kept
 * briefly per address and only a handful of builds run at once.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { VENUE_INCENTIVES } from 'lib/dex'
import { readPositions, type Position } from 'lib/positions'

export interface PositionsResponse {
  address: string
  positions: Position[]
  /** Astroport's incentives contract, which unstake and claim talk to */
  incentives: string | null
  at: number
}

const ADDR = /^terra1[0-9a-z]{38,58}$/
const FRESH_MS = 20_000
const MAX_BUILDS = 6
const cache = new Map<string, PositionsResponse>()
const inflight = new Map<string, Promise<PositionsResponse>>()

export default async function handler(req: NextApiRequest, res: NextApiResponse<PositionsResponse | { error: string }>) {
  const address = typeof req.query.address === 'string' && ADDR.test(req.query.address) ? req.query.address : null
  if (!address) return res.status(400).json({ error: 'address required' })
  res.setHeader('Cache-Control', 'no-store')

  const hit = cache.get(address)
  const fresh = typeof req.query._ === 'string'   // after a transaction the page asks for a re-read
  if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return res.status(200).json(hit)

  let build = inflight.get(address)
  if (!build) {
    if (inflight.size >= MAX_BUILDS) return res.status(503).json({ error: 'busy, try again in a moment' })
    build = readPositions(address)
      .then(positions => ({ address, positions, incentives: VENUE_INCENTIVES.astroport, at: Date.now() }))
      .finally(() => { inflight.delete(address) })
    inflight.set(address, build)
  }
  try {
    const body = await build
    cache.set(address, body)
    if (cache.size > 500) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    return res.status(200).json(body)
  } catch {
    return hit ? res.status(200).json(hit) : res.status(502).json({ error: 'could not read positions' })
  }
}
