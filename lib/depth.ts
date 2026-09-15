/**
 * How large a trade can be before its price moves.
 *
 * Price impact at a ladder of sizes, in dollars of the token paid: through the
 * best route over both sites' pools, priced with the routing the swap signs
 * (lib/route: up to three pools, a split when it pays), or through one pool
 * selling one side into it. Between the rungs, the sizes where impact crosses
 * 0.5%, 1% and 2% are interpolated on a log scale, which is how impact grows
 * with size on these curves. It says what the pools would do right now; the
 * next trade changes it.
 */

import { assetId, simulateSwap, toMicro, type KnownToken, type PoolView } from 'lib/dex'
import { planTrade, quoteBest } from 'lib/route'

export const SIZES_USD = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000]
export const MARKS_PCT = [0.5, 1, 2]
/** Past this impact the ladder stops: every mark is behind it. */
const STOP_PCT = 5

export interface DepthPoint { usd: number; impactPct: number }
/** `usd` null: the ladder ended before impact reached `pct`. `below`: it crossed before the first rung, so the size is estimated from that rung. */
export interface DepthMark { pct: number; usd: number | null; below?: boolean }
export interface Depth { from: string; to: string; points: DepthPoint[]; marks: DepthMark[] }

export function marksFor(points: DepthPoint[]): DepthMark[] {
  return MARKS_PCT.map(pct => {
    const i = points.findIndex(p => p.impactPct >= pct)
    if (i === -1) return { pct, usd: null }
    const b = points[i]
    if (i === 0) return { pct, usd: b.impactPct > 0 ? b.usd * (pct / b.impactPct) : b.usd, below: true }
    const a = points[i - 1]
    const t = b.impactPct > a.impactPct ? (pct - a.impactPct) / (b.impactPct - a.impactPct) : 0
    return { pct, usd: Math.exp(Math.log(a.usd) + t * (Math.log(b.usd) - Math.log(a.usd))) }
  })
}

const round = (n: number) => Math.round(n * 1000) / 1000
const microFor = (usd: number, price: number, t: KnownToken) => toMicro((usd / price).toFixed(Math.min(t.decimals, 8)), t.decimals)

/** Through the best route, the way the swap page signs it. One size at a time: public endpoints refuse a burst of simulations. */
export async function routeDepth(pools: PoolView[], from: KnownToken, to: KnownToken, px: Record<string, number>): Promise<Depth | null> {
  const price = px[assetId(from.info)]
  if (!(price > 0)) return null
  const points: DepthPoint[] = []
  for (const usd of SIZES_USD) {
    const micro = microFor(usd, price, from)
    if (!micro || micro === '0') continue
    const q = await quoteBest(pools, from, to, micro, undefined, { slip: 0.01, split: true })
    if (!q.best) break
    const trade = planTrade(q.split ?? [{ quote: q.best, share: 1 }], 0.01)
    points.push({ usd, impactPct: round(trade.impactPct) })
    if (trade.impactPct >= STOP_PCT) break
  }
  return points.length ? { from: from.key, to: to.key, points, marks: marksFor(points) } : null
}

/** Selling token `inIdx` into one pool. Impact is measured against the pool's spot price with the fee added back, so it is the move alone. */
export async function poolDepth(pool: PoolView, px: Record<string, number>, inIdx: 0 | 1): Promise<Depth | null> {
  const tIn = pool.tokens[inIdx], tOut = pool.tokens[inIdx === 0 ? 1 : 0]
  const price = px[assetId(tIn.info)]
  const spot = inIdx === 0 ? pool.price : pool.price > 0 ? 1 / pool.price : 0
  if (pool.empty || !(price > 0) || !(spot > 0)) return null
  const rungs = await Promise.all(SIZES_USD.map(async usd => {
    const micro = microFor(usd, price, tIn)
    if (!micro || micro === '0') return null
    const s = await simulateSwap(pool.contract_addr, { info: tIn.info, amount: micro })
    if (!s) return null
    const got = (Number(s.return_amount) + Number(s.commission_amount)) / 10 ** tOut.decimals
    const fair = (Number(micro) / 10 ** tIn.decimals) * spot
    return fair > 0 ? { usd, impactPct: round(Math.max(0, (1 - got / fair) * 100)) } : null
  }))
  const points: DepthPoint[] = []
  for (const r of rungs) {
    if (!r) continue
    points.push(r)
    if (r.impactPct >= STOP_PCT) break
  }
  return points.length ? { from: tIn.key, to: tOut.key, points, marks: marksFor(points) } : null
}
