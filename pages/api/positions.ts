/**
 * GET /api/positions?address=terra1… — every pool position a wallet holds on
 * Terra Swap or Astroport, staked LP included. See lib/positions.
 *
 * Chain data only, the same anyone can read from an explorer. A build reads
 * well over a hundred contracts plus the wallet's recent history from a public
 * endpoint, so the address has to be a real terra address, results are kept
 * briefly per address, and each instance runs only so many builds a minute.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fromBech32 } from '@cosmjs/encoding'
import { VENUE_INCENTIVES } from 'lib/dex'
import { readAstroLegacy, readFlows, readPositions, type AstroLegacy, type Position } from 'lib/positions'
import { readUnstaking, type Unstaking } from 'lib/lst'
import type { LpFlow } from 'lib/dex-ledger'
import { withCpu } from 'lib/cpuLog'

export interface PositionsResponse {
  address: string
  positions: Position[]
  /** Astroport's incentives contract, which unstake and claim talk to */
  incentives: string | null
  /** old xASTRO and ASTRO.cw20 still in the wallet */
  astro: AstroLegacy | null
  /** liquid staking tokens queued for redemption at their hubs */
  unstaking: Unstaking[]
  /** what the wallet put into each position's pool, from its own history (lib/positions readFlows) */
  flows: Record<string, LpFlow>
  at: number
}

const FRESH_MS = 20_000
/** A re-read asked for right after a transaction still waits this long between builds. */
const REREAD_MS = 4_000
const MAX_BUILDS = 6
const BUILDS_PER_MINUTE = 60
const cache = new Map<string, PositionsResponse>()
const inflight = new Map<string, Promise<PositionsResponse>>()
let windowAt = 0
let windowBuilds = 0

/** A checksummed terra address, account or contract. Anything else would only cost a build. */
function terraAddress(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 90) return null
  try {
    const { prefix, data } = fromBech32(v)
    return prefix === 'terra' && (data.length === 20 || data.length === 32) ? v : null
  } catch { return null }
}

async function handler(req: NextApiRequest, res: NextApiResponse<PositionsResponse | { error: string }>) {
  const address = terraAddress(req.query.address)
  if (!address) return res.status(400).json({ error: 'address required' })
  res.setHeader('Cache-Control', 'no-store')

  const hit = cache.get(address)
  const age = hit ? Date.now() - hit.at : Infinity
  const fresh = typeof req.query._ === 'string'   // after a transaction the page asks for a re-read
  if (hit && (age < REREAD_MS || (!fresh && age < FRESH_MS))) return res.status(200).json(hit)

  let build = inflight.get(address)
  if (!build) {
    const now = Date.now()
    if (now - windowAt > 60_000) { windowAt = now; windowBuilds = 0 }
    if (inflight.size >= MAX_BUILDS || windowBuilds >= BUILDS_PER_MINUTE) {
      return hit ? res.status(200).json(hit) : res.status(503).json({ error: 'busy, try again in a moment' })
    }
    windowBuilds++
    build = Promise.all([readPositions(address), readAstroLegacy(address).catch(() => null), readUnstaking(address).catch(() => [])])
      .then(async ([positions, astro, unstaking]) => {
        const flows = await readFlows(address, new Set(positions.map(p => p.pool.contract_addr))).catch(() => ({}))
        return { address, positions, incentives: VENUE_INCENTIVES.astroport, astro, unstaking, flows, at: Date.now() }
      })
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

export default withCpu('api/positions', handler)
