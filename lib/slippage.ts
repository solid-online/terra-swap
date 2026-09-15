/**
 * A slippage setting that fits the trade.
 *
 * A swap signs its quote less the slippage setting as the least it accepts.
 * Too tight, and a trade that was fine fails because someone else traded in
 * one of its pools first. Too loose, and it lets through a worse price than it
 * needed to. What fits depends on the route: how much its pools have moved
 * over their last trades, how thin the thinnest of them is, and how many pools
 * it crosses. Auto adds those up from a floor of 0.5%; picking a number still
 * works, and the swap panel says when that number is tighter than the pools
 * have lately been moving.
 */

export const SLIP_FLOOR = 0.5
export const SLIP_CEIL = 5

/**
 * How far a pool's last trades spread around their middle, in %: half the
 * range over the median. They are execution prices, so a thin pool's own
 * trades moving it count too. Zero with fewer than three trades to go on.
 */
export function recentMovePct(points: { p: number }[], n = 10): number {
  const xs = points.slice(-n).map(x => x.p).filter(v => Number.isFinite(v) && v > 0)
  if (xs.length < 3) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted[Math.floor(sorted.length / 2)]
  return Math.min(20, ((sorted[sorted.length - 1] - sorted[0]) / 2 / mid) * 100)
}

export interface SlipAdvice {
  /** percent, one decimal */
  pct: number
  /** what raised it above the floor, in words */
  reasons: string[]
}

export interface RoutePool { label: string; tvlUsd?: number; movePct: number }

/**
 * `separateLegs` is a route signed as one swap per pool (lib/route planRoute
 * 'legs'), where every leg carries its own limit, so each extra pool needs a
 * little more room than it does through a router.
 */
export function suggestSlippage(a: { pools: RoutePool[]; separateLegs: boolean }): SlipAdvice {
  let pct = SLIP_FLOOR
  const reasons: string[] = []
  const mover = [...a.pools].sort((x, y) => y.movePct - x.movePct)[0]
  if (mover && mover.movePct >= 0.3) {
    pct += mover.movePct * 0.6
    reasons.push(`${mover.label} moved about ${mover.movePct.toFixed(1)}% over its last trades`)
  }
  const thin = a.pools.filter(p => p.tvlUsd != null).sort((x, y) => (x.tvlUsd ?? 0) - (y.tvlUsd ?? 0))[0]
  if (thin && (thin.tvlUsd ?? 0) < 1_000) { pct += 1; reasons.push(`${thin.label} holds under $1,000`) }
  else if (thin && (thin.tvlUsd ?? 0) < 10_000) { pct += 0.3; reasons.push(`${thin.label} holds under $10,000`) }
  if (a.pools.length > 1) {
    pct += (a.pools.length - 1) * (a.separateLegs ? 0.25 : 0.1)
    reasons.push(`${a.pools.length} pools on the route`)
  }
  return { pct: Math.max(SLIP_FLOOR, Math.min(SLIP_CEIL, Math.ceil(pct * 10 - 1e-9) / 10)), reasons }
}
