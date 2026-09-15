/**
 * A little LUNA on arrival, for network fees.
 *
 * Every transaction on Terra pays its fee in LUNA. Someone bringing USDC in
 * from Noble for the first time arrives with none, and cannot swap, add
 * liquidity or send anything until they get some elsewhere. So when the Terra
 * wallet holds almost no LUNA, a transfer in sets aside about one LUNA's worth
 * of the amount and sends it as a second transfer in the same signature,
 * swapped into LUNA on arrival by Terra Swap's router. At Terra's gas price one
 * LUNA pays for many ordinary transactions. If that small swap cannot deliver
 * its minimum, its own transfer fails and the source chain returns that part;
 * the main transfer is not affected.
 */

import { HOME_VENUE, sameAsset, toMicro, tokenFor, type KnownToken, type PoolView } from 'lib/dex'
import { quoteBest, routerPlan, type RoutePlan } from 'lib/route'

export const LUNA = tokenFor({ native_token: { denom: 'uluna' } })
/** Whole LUNA to aim for. */
export const GAS_DROP_LUNA = 1
/** Offered while the Terra wallet holds less than this, smallest units. */
export const GAS_DROP_BELOW_MICRO = BigInt(300_000)
/** Only taken from an amount at least this many times its size, so it never eats a small transfer. */
const MIN_MULTIPLE = 4
/** A little over one LUNA's worth, so the pool fee and the slippage still leave about one. */
const HEADROOM = 1.05

/** The part of `amountMicro` to set aside, in smallest units of `from`, or null when a drop does not apply. */
export function gasDropMicro(a: { from: KnownToken; amountMicro: string | null; fromUsd?: number; lunaUsd?: number }): string | null {
  if (!a.amountMicro || a.amountMicro === '0' || sameAsset(a.from.info, LUNA.info)) return null
  if (!(a.fromUsd && a.fromUsd > 0) || !(a.lunaUsd && a.lunaUsd > 0)) return null
  const whole = (GAS_DROP_LUNA * a.lunaUsd * HEADROOM) / a.fromUsd
  const micro = toMicro(whole.toFixed(Math.min(a.from.decimals, 8)), a.from.decimals)
  if (!micro || micro === '0') return null
  if (BigInt(micro) * BigInt(MIN_MULTIPLE) > BigInt(a.amountMicro)) return null
  return micro
}

/** The drop as one call to Terra Swap's router, through up to two pools like any swap on arrival. */
export async function planGasDrop(pools: PoolView[], from: KnownToken, micro: string, slip: number): Promise<RoutePlan | null> {
  const q = await quoteBest(pools, from, LUNA, micro, HOME_VENUE, { slip, threeHop: false })
  return q.best ? routerPlan(q.best, slip) : null
}
