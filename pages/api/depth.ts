/**
 * GET /api/depth — how large a trade can be before its price moves (lib/depth).
 *
 *   ?from=LUNA&to=USDC   through the best route over both sites' pools, as the swap signs it
 *   ?pool=terra1…        one pool, selling each of its tokens into it
 *
 * Sizes are US dollars of the token paid, at the market reference. Open to any
 * origin. A pair is priced once every five minutes per server; pricing one
 * reads a dozen full quotes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fromBech32 } from '@cosmjs/encoding'
import { KNOWN_TOKENS, assetId, type KnownToken } from 'lib/dex'
import { poolDepth, routeDepth, type Depth } from 'lib/depth'
import { sitePools } from 'lib/sitePools'
import { withCpu } from 'lib/cpuLog'

export const config = { maxDuration: 60 }

export type DepthResponse =
  | ({ kind: 'route'; at: number } & Depth)
  | { kind: 'pool'; pool: string; sell0: Depth | null; sell1: Depth | null; at: number }

const FRESH_MS = 5 * 60_000
const BUILDS_PER_MINUTE = 20
const cache = new Map<string, DepthResponse>()
const inflight = new Map<string, Promise<DepthResponse | null>>()
let windowAt = 0
let windowBuilds = 0

const find = (v: unknown): KnownToken | undefined =>
  typeof v === 'string' ? KNOWN_TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase() || assetId(t.info) === v) : undefined
const contract = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 90) return null
  try { const { prefix, data } = fromBech32(v); return prefix === 'terra' && data.length === 32 ? v : null } catch { return null }
}

async function build(key: string, q: NextApiRequest['query']): Promise<DepthResponse | null> {
  const { pools, px } = await sitePools()
  if (key.startsWith('pool|')) {
    const pool = pools.find(p => p.contract_addr === key.slice(5))
    if (!pool) return null
    const [sell0, sell1] = await Promise.all([poolDepth(pool, px, 0), poolDepth(pool, px, 1)])
    return { kind: 'pool', pool: pool.contract_addr, sell0, sell1, at: Date.now() }
  }
  const from = find(q.from)!, to = find(q.to)!
  const d = await routeDepth(pools, from, to, px)
  return d ? { kind: 'route', ...d, at: Date.now() } : null
}

async function handler(req: NextApiRequest, res: NextApiResponse<DepthResponse | { error: string }>) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  let key: string
  if (req.query.pool !== undefined) {
    const addr = contract(req.query.pool)
    if (!addr) return res.status(400).json({ error: 'pool must be a pool contract address' })
    key = `pool|${addr}`
  } else {
    const from = find(req.query.from), to = find(req.query.to)
    if (!from || !to || from.key === to.key) return res.status(400).json({ error: 'from and to must be two different listed tokens, by ticker or id' })
    key = `route|${from.key}|${to.key}`
  }
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(hit)
  }
  let job = inflight.get(key)
  if (!job) {
    const now = Date.now()
    if (now - windowAt > 60_000) { windowAt = now; windowBuilds = 0 }
    if (windowBuilds >= BUILDS_PER_MINUTE) return hit ? res.status(200).json(hit) : res.status(429).json({ error: 'busy, try again in a moment' })
    windowBuilds++
    job = build(key, req.query).finally(() => { inflight.delete(key) })
    inflight.set(key, job)
  }
  try {
    const body = await job
    if (!body) return res.status(404).json({ error: key.startsWith('pool|') ? 'not a pool with liquidity that this site lists' : 'no route or no market price for that pair right now' })
    cache.set(key, body)
    if (cache.size > 300) cache.delete(cache.keys().next().value as string)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(body)
  } catch {
    return hit ? res.status(200).json(hit) : res.status(503).json({ error: 'the chain did not answer, try again in a moment' })
  }
}

export default withCpu('api/depth', handler)
