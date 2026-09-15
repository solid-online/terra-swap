/**
 * Selling what is left over, in one signature.
 *
 * A wallet collects small balances: the rest of an old trade, an airdrop, one
 * side of a pool that was left. Each is a swap to sign and a fee to pay, so
 * they stay. This prices every chosen balance into one token, USDC from Noble
 * or LUNA, through the best path on either site, and the swap panel signs all
 * of the swaps as one transaction. Each carries its own minimum; if any would
 * arrive short, the whole transaction reverts and nothing is sold. USDC.inj
 * and USDC from Noble are separate dollars and never meet here, not even
 * inside a route.
 */

import { HOME_VENUE, NOBLE_USDC, USDC_INJ_DENOM, assetId, sameAsset, type KnownToken, type PoolView } from 'lib/dex'
import { planRoute, quoteBest, type Quote, type RoutePlan } from 'lib/route'

/** Swaps per transaction. Each is a router call of up to a few hundred thousand gas; a second sweep takes the rest. */
export const SWEEP_MAX = 6
/** Kept back when LUNA itself is swept: the fee for this transaction and the next few. */
export const SWEEP_KEEP_LUNA_MICRO = BigInt(1_000_000)

export interface SweepPick { token: KnownToken; micro: string }
export interface SweepLine extends SweepPick {
  quote: Quote | null
  /** null when this balance cannot be swept, with `why` */
  plan: RoutePlan | null
  why?: string
}

/** The pools a swap between these two tokens may use. */
export function poolsFor(pools: PoolView[], a: KnownToken, b: KnownToken): PoolView[] {
  const ids = [assetId(a.info), assetId(b.info)]
  if (ids.includes(NOBLE_USDC) && ids.includes(USDC_INJ_DENOM)) return []
  const avoid = ids.includes(USDC_INJ_DENOM) ? NOBLE_USDC : ids.includes(NOBLE_USDC) ? USDC_INJ_DENOM : null
  return avoid ? pools.filter(p => !p.tokens.some(t => assetId(t.info) === avoid)) : pools
}

/** Price each pick into `target`, two at a time: every quote is several simulations against public endpoints. */
export async function planSweep(pools: PoolView[], picks: SweepPick[], target: KnownToken, slip: number): Promise<SweepLine[]> {
  const one = async (p: SweepPick): Promise<SweepLine> => {
    if (sameAsset(p.token.info, target.info)) return { ...p, quote: null, plan: null, why: `already ${target.label}` }
    const usable = poolsFor(pools, p.token, target)
    if (usable.length === 0) return { ...p, quote: null, plan: null, why: `never swapped for ${target.label} here` }
    try {
      const q = await quoteBest(usable, p.token, target, p.micro, HOME_VENUE, { slip })
      if (!q.best) return { ...p, quote: null, plan: null, why: 'no route' }
      const plan = planRoute(q.best, slip)
      if (plan.minOut === '0' || plan.legs.some(l => l.offerAmount === '0')) return { ...p, quote: q.best, plan: null, why: 'too small to swap' }
      return { ...p, quote: q.best, plan }
    } catch {
      return { ...p, quote: null, plan: null, why: 'could not be priced right now' }
    }
  }
  const out: SweepLine[] = []
  for (let i = 0; i < picks.length; i += 2) out.push(...(await Promise.all(picks.slice(i, i + 2).map(one))))
  return out
}
