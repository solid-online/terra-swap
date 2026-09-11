/**
 * Who currently holds liquidity, and what it is worth.
 *
 * The board used to pay 20 points for the act of depositing and 0 for
 * withdrawing, which meant a deposit and an immediate withdrawal in the same
 * block kept the points forever. That rewards liquidity that is not there.
 * This reads the live LP balances instead, so the score follows what a pool
 * actually holds on your behalf right now and falls the moment you pull it.
 */

import {
  DEX_FACTORY, annotateValues, marketPrices, queryPairs, queryPool, smart, toPoolView,
  type PoolView,
} from 'lib/dex'

/** Holders read per pool. Beyond this the tail is dust. */
const MAX_HOLDERS = 40

export interface Holder { address: string; amount: string }
export interface PoolLiquidity {
  pool: PoolView
  /** LP total supply, smallest units */
  lpTotal: string
  /** descending by size */
  holders: Holder[]
}

async function readPoolHolders(lpToken: string): Promise<{ lpTotal: string; holders: Holder[] } | null> {
  const info = await smart<{ total_supply: string }>(lpToken, { token_info: {} })
  if (!info?.total_supply) return null
  const accs = await smart<{ accounts: string[] }>(lpToken, { all_accounts: { limit: MAX_HOLDERS } })
  const balances = await Promise.all((accs?.accounts ?? []).map(async address => {
    const b = await smart<{ balance: string }>(lpToken, { balance: { address } })
    return { address, amount: b?.balance ?? '0' }
  }))
  return {
    lpTotal: info.total_supply,
    holders: balances.filter(h => Number(h.amount) > 0).sort((a, b) => Number(b.amount) - Number(a.amount)),
  }
}

/** Every pool, priced, with its LP holders. One round trip for the whole board. */
export async function readLiquidity(): Promise<PoolLiquidity[]> {
  if (!DEX_FACTORY) return []
  const pairs = await queryPairs()
  if (pairs.length === 0) return []
  const [views, px] = await Promise.all([
    Promise.all(pairs.map(async p => toPoolView(p, await queryPool(p.contract_addr)))),
    marketPrices(),
  ])
  annotateValues(views, px)
  const out = await Promise.all(views.map(async (pool, i) => {
    const h = await readPoolHolders(pairs[i].liquidity_token)
    return h ? { pool, lpTotal: h.lpTotal, holders: h.holders } : null
  }))
  return out.filter((x): x is PoolLiquidity => x !== null)
}

/**
 * USD of live liquidity per address, summed across pools. A holder's share of
 * the LP supply is their share of everything the pool holds.
 */
export function liquidityByAddress(pools: PoolLiquidity[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { pool, lpTotal, holders } of pools) {
    const total = Number(lpTotal)
    if (!(total > 0) || pool.tvlUsd == null || !(pool.tvlUsd > 0)) continue
    for (const h of holders) {
      const usd = (Number(h.amount) / total) * pool.tvlUsd
      if (usd > 0) out[h.address] = (out[h.address] ?? 0) + usd
    }
  }
  return out
}
