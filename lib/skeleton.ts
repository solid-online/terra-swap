/**
 * Skeleton Swap's pools on Terra: routed through by swaps, and listed in Pools.
 *
 * Skeleton Swap (Backbone Labs) trades on White Whale's pool-network contracts:
 * one factory (SKELETON_FACTORY: 43 pairs on 2026-09-15, 42 with liquidity, the
 * deepest bLUNA/LUNA at about $186k), each pair a constant-product or stable
 * pool. The pairs answer `pair`, `pool` and `simulation` like Astroport's and take
 * the same `swap` and `withdraw_liquidity` messages. lib/dex reads their fee parts
 * and pool type names; lib/msgs leaves out the auto_stake field their
 * `provide_liquidity` refuses.
 *
 * Only pairs of tokens this site lists. Each pool carries its owner's switches:
 * swaps, deposits and withdrawals can each be paused, and a paused pool still
 * answers simulations, so routing keeps to pools with swaps on (swappable) and
 * Pools offers only what a pool allows. Checked on chain 2026-09-15: a provide
 * without auto_stake and a withdraw with the LP denom as funds both pass, and
 * one USDC/USDT pool had its swaps and deposits off.
 */

import { SKELETON_FACTORY, knownPairs, queryPairsOf, queryPool, refineSpot, smart, toPoolView, type PairInfo, type PoolView } from 'lib/dex'

interface PairConfig {
  pool_fees?: { swap_fee?: { share?: string }; protocol_fee?: { share?: string }; burn_fee?: { share?: string } }
  feature_toggle?: { swaps_enabled?: boolean; deposits_enabled?: boolean; withdrawals_enabled?: boolean }
}

/** White Whale's pairs name their LP as an asset; the rest of the site reads a plain denom or address. */
export function withPlainLp(p: PairInfo): PairInfo {
  const lp = p.liquidity_token as unknown
  if (typeof lp === 'string') return p
  const asset = (lp ?? {}) as { native_token?: { denom?: string }; token?: { contract_addr?: string } }
  return { ...p, liquidity_token: asset.native_token?.denom ?? asset.token?.contract_addr ?? '' }
}

/** A share of each swap ("0.002") in basis points (20). */
const bps = (share: string | undefined) => {
  const n = Number(share)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) / 100 : 0
}

/**
 * Skeleton Swap's pools of listed tokens with liquidity: live reserves, spot
 * prices, each pool's fee parts and its owner's switches. No dollar values:
 * callers add them at their market reference.
 */
export async function skeletonPools(): Promise<PoolView[]> {
  const pairs = knownPairs(await queryPairsOf(SKELETON_FACTORY)).map(withPlainLp)
  const views = await Promise.all(pairs.map(async p => {
    const [pool, config] = await Promise.all([queryPool(p.contract_addr), smart<PairConfig>(p.contract_addr, { config: {} })])
    if (!config?.feature_toggle) return null
    const v = toPoolView(p, pool, 'skeleton')
    v.fees = { lpBps: bps(config.pool_fees?.swap_fee?.share), protocolBps: bps(config.pool_fees?.protocol_fee?.share), burnBps: bps(config.pool_fees?.burn_fee?.share) }
    v.swapsEnabled = config.feature_toggle.swaps_enabled === true
    v.depositsEnabled = config.feature_toggle.deposits_enabled === true
    v.withdrawalsEnabled = config.feature_toggle.withdrawals_enabled === true
    return v
  }))
  const live = views.filter((v): v is PoolView => v !== null && !v.empty)
  await refineSpot(live)
  return live
}

/** The pools a swap may go through: every pool elsewhere, and Skeleton Swap's with their swaps on. */
export const swappable = (pools: PoolView[]): PoolView[] => pools.filter(p => p.venue !== 'skeleton' || p.swapsEnabled === true)
