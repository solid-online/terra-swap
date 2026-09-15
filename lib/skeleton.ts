/**
 * Skeleton Swap's pools on Terra, for routing swaps.
 *
 * Skeleton Swap (Backbone Labs) trades on White Whale's pool-network contracts:
 * one factory (SKELETON_FACTORY: 43 pairs on 2026-09-15, 42 with liquidity, the
 * deepest LUNA/USDC at about $69k), each pair a constant-product or stable pool.
 * The pairs answer `pair`, `pool` and `simulation` like Astroport's and take the
 * same `swap` message, so lib/route prices and signs through them; lib/dex reads
 * their fee parts and pool type names.
 *
 * Only pairs of tokens this site lists, with swaps switched on, are used. A
 * pair's owner can pause swaps, and a paused pair still answers simulations
 * (one USDC/USDT pool was paused on 2026-09-15). They are not listed in Pools:
 * their LP is a TokenFactory denom, and providing liquidity there is Skeleton
 * Swap's own interface's job.
 */

import { SKELETON_FACTORY, knownPairs, queryPairsOf, queryPool, refineSpot, smart, toPoolView, type PairInfo, type PoolView } from 'lib/dex'

interface PairConfig { feature_toggle?: { swaps_enabled?: boolean } }

/** White Whale's pairs name their LP as an asset; the rest of the site reads a plain denom or address. */
function withPlainLp(p: PairInfo): PairInfo {
  const lp = p.liquidity_token as unknown
  if (typeof lp === 'string') return p
  const asset = (lp ?? {}) as { native_token?: { denom?: string }; token?: { contract_addr?: string } }
  return { ...p, liquidity_token: asset.native_token?.denom ?? asset.token?.contract_addr ?? '' }
}

/** Skeleton Swap's pools that can be swapped through right now, with live reserves and spot prices. No dollar values: callers add them at their market reference. */
export async function skeletonPools(): Promise<PoolView[]> {
  const pairs = knownPairs(await queryPairsOf(SKELETON_FACTORY)).map(withPlainLp)
  const views = await Promise.all(pairs.map(async p => {
    const [pool, config] = await Promise.all([queryPool(p.contract_addr), smart<PairConfig>(p.contract_addr, { config: {} })])
    return config?.feature_toggle?.swaps_enabled === true ? toPoolView(p, pool, 'skeleton') : null
  }))
  const live = views.filter((v): v is PoolView => v !== null && !v.empty)
  await refineSpot(live)
  return live
}
