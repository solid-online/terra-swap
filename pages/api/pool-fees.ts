/**
 * GET /api/pool-fees?pair=terra1… — what a pool paid its liquidity providers
 * in the last 7 and 30 days, read from its own swap events.
 *
 * A pair writes each swap's fee as commission_amount, in the token that came
 * out. Astroport's pairs send part of it to Astroport's maker
 * (maker_fee_amount) and, on some pools, a share to a third address
 * (fee_share_amount); liquidity providers keep the rest. Terra Swap's factory
 * sends no maker fee. Dollars use today's reference prices, so they are a
 * size, not a record of what the fees were worth on the day. History, never a
 * projection: nothing here says what a pool will pay.
 *
 * A busy pool has thousands of swaps a month, so the scan stops after
 * MAX_PAGES pages and says how far back it read. Results are kept for half an
 * hour per pool.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fromBech32 } from '@cosmjs/encoding'
import { lcdFetch } from 'lib/lcd'
import { marketPrices, resolveToken } from 'lib/dex'

/** A busy pool's fifteen pages of transactions can take twenty seconds to read. */
export const config = { maxDuration: 60 }

export interface PoolFeesResponse {
  pair: string
  /** in US dollars at today's reference prices; null when a fee token has no price */
  day7: { usd: number | null; swaps: number }
  day30: { usd: number | null; swaps: number }
  /** the oldest swap read, ISO time */
  since: string | null
  /** false when the scan stopped before it reached 30 days back */
  complete: boolean
  at: number
}

const MAX_PAGES = 15
const KEEP_MS = 30 * 60_000
const DAY = 86_400_000
const BUILDS_PER_MINUTE = 40
const UA = { 'User-Agent': 'Mozilla/5.0 terra-swap-pool-fees', accept: 'application/json' }
const cache = new Map<string, PoolFeesResponse>()
const inflight = new Map<string, Promise<PoolFeesResponse>>()
let windowAt = 0
let windowBuilds = 0

function contractAddress(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 90) return null
  try {
    const { prefix, data } = fromBech32(v)
    return prefix === 'terra' && data.length === 32 ? v : null
  } catch { return null }
}

interface Ev { type: string; attributes: { key: string; value: string }[] }

async function build(pair: string): Promise<PoolFeesResponse> {
  const now = Date.now()
  const q = encodeURIComponent(`wasm._contract_address='${pair}'`)
  const fees7 = new Map<string, bigint>(), fees30 = new Map<string, bigint>()
  let swaps7 = 0, swaps30 = 0
  let since: string | null = null
  let complete = false
  const addTo = (m: Map<string, bigint>, id: string, v: bigint) => m.set(id, (m.get(id) ?? BigInt(0)) + v)
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await lcdFetch(`/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&limit=100&page=${page}`, { headers: UA, kind: 'txs', timeoutMs: 20_000 })
    if (!r.ok) break
    const rs: { timestamp: string; events: Ev[] }[] = (await r.json())?.tx_responses ?? []
    let past = false
    for (const tx of rs) {
      const t = Date.parse(tx.timestamp)
      if (now - t > 30 * DAY) { past = true; continue }
      since = tx.timestamp
      for (const ev of tx.events) {
        if (ev.type !== 'wasm') continue
        const at: Record<string, string> = {}
        for (const a of ev.attributes) if (!(a.key in at)) at[a.key] = a.value
        if (at._contract_address !== pair || at.action !== 'swap' || !at.ask_asset) continue
        const kept = BigInt(at.commission_amount ?? '0') - BigInt(at.maker_fee_amount ?? '0') - BigInt(at.fee_share_amount ?? '0')
        if (kept <= BigInt(0)) continue
        addTo(fees30, at.ask_asset, kept); swaps30++
        if (now - t <= 7 * DAY) { addTo(fees7, at.ask_asset, kept); swaps7++ }
      }
    }
    if (past || rs.length < 100) { complete = true; break }
  }
  const px = await marketPrices().catch(() => ({} as Record<string, number>))
  // No reference prices at all means the market read failed, not that nothing has a price. Not worth keeping.
  if (Object.keys(px).length === 0) throw new Error('no reference prices')
  const usd = async (m: Map<string, bigint>): Promise<number | null> => {
    let total = 0
    for (const [id, amount] of Array.from(m.entries())) {
      const price = px[id]
      if (!(price > 0)) return null
      const t = await resolveToken(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } })
      total += (Number(amount) / 10 ** t.decimals) * price
    }
    return total
  }
  return { pair, day7: { usd: await usd(fees7), swaps: swaps7 }, day30: { usd: await usd(fees30), swaps: swaps30 }, since, complete, at: Date.now() }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<PoolFeesResponse | { error: string }>) {
  const pair = contractAddress(req.query.pair)
  if (!pair) return res.status(400).json({ error: 'pair required' })
  const hit = cache.get(pair)
  if (hit && Date.now() - hit.at < KEEP_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400')
    return res.status(200).json(hit)
  }
  let job = inflight.get(pair)
  if (!job) {
    const now = Date.now()
    if (now - windowAt > 60_000) { windowAt = now; windowBuilds = 0 }
    if (windowBuilds >= BUILDS_PER_MINUTE) {
      res.setHeader('Cache-Control', 'no-store')
      return hit ? res.status(200).json(hit) : res.status(503).json({ error: 'busy, try again in a moment' })
    }
    windowBuilds++
    job = build(pair).finally(() => { inflight.delete(pair) })
    inflight.set(pair, job)
  }
  try {
    const body = await job
    cache.set(pair, body)
    if (cache.size > 400) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400')
    return res.status(200).json(body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return hit ? res.status(200).json(hit) : res.status(502).json({ error: 'could not read the pool' })
  }
}
