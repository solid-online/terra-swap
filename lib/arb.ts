/**
 * Mispriced pools, sized.
 *
 * A pool drifts away from the wider market whenever someone trades it and
 * nobody trades it back. The gap is worth money to whoever closes it, and the
 * amount that captures the most is a specific number — trade less and you
 * leave some behind, trade more and you push the pool past the market and give
 * it away again.
 *
 * On a constant-product pool with reserves (x, y), fee f, and an outside price
 * p, buying the cheap side maximises what you keep at
 *
 *     in = (sqrt(p · x · y · (1-f)) - y) / (1-f)
 *
 * which is the input that leaves the pool's marginal price exactly at p. This
 * module does that arithmetic for every pool and reports it in dollars.
 *
 * Two honest caveats travel with every number here:
 *   • the reference price is Astroport's deepest pool for the pair, which on
 *     Terra can itself be thin;
 *   • the gap is first-come. Anyone can take it, and it moves on every trade.
 */

import { assetId, toMicro, type KnownToken, type PoolView } from 'lib/dex'
import { POOL_FEE_BPS } from 'lib/dex'

export interface ArbPlan {
  pool: PoolView
  /** Index in pool.tokens of the token you spend. */
  inIdx: 0 | 1
  inToken: KnownToken
  outToken: KnownToken
  /** Optimal input, smallest units, ready for the swap panel. */
  inMicro: string
  /** Optimal input, display units. */
  inAmount: number
  /** What the pool returns for it, display units. */
  outAmount: number
  /** How far off the reference the pool sits, always >= 1. */
  off: number
  inUsd: number
  /** Value of the output at reference prices, minus what you put in. */
  profitUsd: number
  /** profitUsd as a share of inUsd. */
  roiPct: number
}

/** Below this the arithmetic is real but the attention isn't worth it. */
export const DUST_USD = 0.25
/** Inside this band a pool counts as on-market and is left alone. */
const FLAT = 0.03

/**
 * Every pool that is off market by enough to be worth closing, best first.
 * `px` is the USD reference map from /api/dex-market, keyed by asset id.
 */
export function arbPlans(pools: PoolView[], px: Record<string, number> | null): ArbPlan[] {
  if (!px) return []
  const g = 1 - POOL_FEE_BPS / 10_000
  const out: ArbPlan[] = []

  for (const pool of pools) {
    if (pool.empty) continue
    const [a, b] = pool.tokens
    const pa = px[assetId(a.info)], pb = px[assetId(b.info)]
    if (!(pa > 0) || !(pb > 0)) continue

    // Reserves in display units so decimals never skew the comparison.
    const x = Number(pool.reserves[0]) / 10 ** a.decimals
    const y = Number(pool.reserves[1]) / 10 ** b.decimals
    if (!(x > 0) || !(y > 0)) continue

    const market = pa / pb          // 1 a = market b, out in the wider market
    const here = y / x              // 1 a = here b, in this pool
    const off = here > market ? here / market : market / here
    if (!Number.isFinite(off) || off < 1 + FLAT) continue

    // Buy whichever side this pool sells too cheaply.
    let inIdx: 0 | 1, rIn: number, rOut: number, price: number
    if (here < market) {
      // a is cheap here: spend b, receive a. Reference price of a is `market` b.
      inIdx = 1; rIn = y; rOut = x; price = market
    } else {
      // b is cheap here: spend a, receive b. Reference price of b is 1/market a.
      inIdx = 0; rIn = x; rOut = y; price = 1 / market
    }
    const inToken = pool.tokens[inIdx]
    const outToken = pool.tokens[inIdx === 0 ? 1 : 0]

    const inAmount = (Math.sqrt(price * rOut * rIn * g) - rIn) / g
    if (!(inAmount > 0)) continue
    const outAmount = (rOut * g * inAmount) / (rIn + g * inAmount)
    if (!(outAmount > 0)) continue

    // Both legs valued at the reference, so the number is what you are up
    // once the position is unwound at those prices.
    const unit = inIdx === 0 ? pa : pb
    const inUsd = inAmount * unit
    const profitUsd = (outAmount * price - inAmount) * unit
    if (!(inUsd > 0) || !(profitUsd >= DUST_USD)) continue

    // Fixed-point before micro so a float never loses the low digits.
    const micro = toMicro(inAmount.toFixed(Math.min(inToken.decimals, 8)), inToken.decimals)
    if (!micro || micro === '0') continue
    // Never propose spending more than the pool holds of that side.
    if (BigInt(micro) >= BigInt(pool.reserves[inIdx])) continue

    out.push({
      pool, inIdx, inToken, outToken,
      inMicro: micro, inAmount, outAmount, off,
      inUsd, profitUsd, roiPct: (profitUsd / inUsd) * 100,
    })
  }

  return out.sort((m, n) => n.profitUsd - m.profitUsd)
}

/** What all the open gaps add up to right now. */
export const totalUsd = (plans: ArbPlan[]) => plans.reduce((s, p) => s + p.profitUsd, 0)

/** "$4.74" / "$0.31" — small numbers keep their cents. */
export function fmtUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${n.toFixed(2)}`
}

/** Compact display amount: 91.8M, 5,039, 3.738, 0.0000031 */
export function fmtAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 1) return n.toFixed(3).replace(/\.?0+$/, '')
  return n.toPrecision(2)
}
