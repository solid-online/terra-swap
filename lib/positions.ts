/**
 * Every liquidity position a wallet holds on either site, including LP staked
 * in Astroport's incentives contract.
 *
 * Checked 2026-09-13: about $325k of Astroport's LP on Terra sat staked in
 * "Astroport Incentives" (93% of LUNA/wBTC, 92% of CAPA/LUNA, 83% of
 * USDC/SOLID). An interface that can only withdraw LP from the wallet cannot
 * get those people out. This finds positions without asking anyone to know
 * which pool they are in: every pool of the tokens we list on both factories,
 * plus any pool the wallet has provided to, withdrawn from or staked through
 * in its own recent history, whatever the tokens.
 */

import {
  ASTRO_CONVERTER, ASTRO_CW20, ASTRO_FACTORY, ASTRO_IBC_DENOM, ASTRO_STAKING, SKELETON_FACTORY, TERRA_SWAP_FACTORY, TERRA_SWAP_FACTORY_V2, VENUE_INCENTIVES, XASTRO_CW20,
  assetId, knownPairs, marketPrices, queryCw20Balance, queryNativeBalance, queryPairsOf, queryPool,
  resolveToken, smart, toPoolView,
  type Asset, type KnownToken, type PairInfo, type PoolView, type Venue,
} from 'lib/dex'
import { lcdFetch } from 'lib/lcd'
import { withPlainLp } from 'lib/skeleton'
import { parseAssets, type LpFlow } from 'lib/dex-ledger'

const UA = { 'User-Agent': 'Mozilla/5.0 terra-pools-positions', accept: 'application/json' }

export interface Reward { token: KnownToken; amount: string }

export interface Position {
  pool: PoolView
  /** LP in the wallet, smallest units */
  walletLp: string
  /** LP staked in the venue's incentives contract, smallest units */
  stakedLp: string
  /** what wallet + staked LP is a claim on, display units, pool order */
  amounts: [number, number]
  usd: number | null
  pending: Reward[]
  /** the incentives contract pays something for this pool right now */
  rewardsActive: boolean
}

interface TxEvents { events: { type: string; attributes: { key: string; value: string }[] }[] }

/** Pairs and staked LP tokens this wallet has touched, read from its own recent transactions. */
async function historyTouches(address: string): Promise<{ pairs: Set<string>; lpTokens: Set<string> }> {
  const pairs = new Set<string>(), lpTokens = new Set<string>()
  const q = encodeURIComponent(`message.sender='${address}'`)
  for (let page = 1; page <= 3; page++) {
    let rs: TxEvents[] = []
    try {
      const r = await lcdFetch(`/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&limit=100&page=${page}`, { headers: UA, kind: 'txs', timeoutMs: 15000 })
      rs = r.ok ? ((await r.json())?.tx_responses ?? []) : []
    } catch { rs = [] }
    for (const tx of rs) {
      for (const ev of tx.events) {
        if (ev.type !== 'wasm') continue
        const at = (k: string) => ev.attributes.find(a => a.key === k)?.value
        const contract = at('_contract_address'), action = at('action') ?? ''
        if (!contract) continue
        if (action === 'provide_liquidity' || action === 'withdraw_liquidity') pairs.add(contract)
        const lp = at('lp_token')
        if (lp && contract === VENUE_INCENTIVES.astroport) lpTokens.add(lp)
      }
    }
    if (rs.length < 100) break
  }
  return { pairs, lpTokens }
}

/**
 * What this wallet put into each of `pairs`, less what it took out, from its
 * own provide and withdraw events, keyed like the board's flows
 * (`${address}|${pair}`). The board's ledger (lib/dex-ledger computeFlows)
 * only records Terra Swap's pools; this reads the wallet's history instead,
 * so Astroport positions get the same "Put in" line. Only liquidity the
 * wallet added itself counts: LP bought or received from someone else has no
 * deposit to show. Reads the wallet's own transactions, newest first, up to
 * five pages; a search that combines the signer with the action matched
 * nothing on public endpoints on 2026-09-14, so the filtering happens here.
 */
export async function readFlows(address: string, pairs: Set<string>): Promise<Record<string, LpFlow>> {
  const out: Record<string, LpFlow> = {}
  if (pairs.size === 0) return out
  const q = encodeURIComponent(`message.sender='${address}'`)
  for (let page = 1; page <= 5; page++) {
    let rs: TxEvents[] = []
    try {
      const r = await lcdFetch(`/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&limit=100&page=${page}`, { headers: UA, kind: 'txs', timeoutMs: 15000 })
      rs = r.ok ? ((await r.json())?.tx_responses ?? []) : []
    } catch { rs = [] }
    for (const tx of rs) {
      for (const ev of tx.events) {
        if (ev.type !== 'wasm') continue
        const at: Record<string, string> = {}
        for (const a of ev.attributes) if (!(a.key in at)) at[a.key] = a.value
        const pair = at._contract_address
        const provide = at.action === 'provide_liquidity', withdraw = at.action === 'withdraw_liquidity'
        if ((!provide && !withdraw) || !pair || !pairs.has(pair)) continue
        if (at.sender !== address && at.receiver !== address) continue
        const moved = parseAssets((provide ? at.assets : at.refund_assets) ?? '')
        const key = `${address}|${pair}`
        const f = out[key] ?? (out[key] = { net: {}, provides: 0, withdraws: 0 })
        if (provide) f.provides++; else f.withdraws++
        for (const id of Object.keys(moved)) {
          const cur = BigInt(f.net[id] ?? '0'), amt = BigInt(moved[id])
          f.net[id] = (provide ? cur + amt : cur - amt).toString()
        }
      }
    }
    if (rs.length < 100) break
  }
  return out
}

async function lpBalance(lpToken: string, user: string): Promise<string> {
  return lpToken.startsWith('terra1') ? queryCw20Balance(lpToken, user) : queryNativeBalance(user, lpToken)
}

async function readPosition(pair: PairInfo, venue: Venue, user: string, px: Record<string, number>): Promise<Position | null> {
  const inc = VENUE_INCENTIVES[venue]
  const [walletLp, stakedLp] = await Promise.all([
    lpBalance(pair.liquidity_token, user),
    inc
      ? smart<string>(inc, { deposit: { lp_token: pair.liquidity_token, user } }).then(v => (typeof v === 'string' ? v : '0'))
      : Promise.resolve('0'),
  ])
  const total = BigInt(walletLp || '0') + BigInt(stakedLp || '0')
  if (total === BigInt(0)) return null

  const [state, t0, t1] = await Promise.all([
    queryPool(pair.contract_addr), resolveToken(pair.asset_infos[0]), resolveToken(pair.asset_infos[1]),
  ])
  const pool = toPoolView(pair, state, venue, [t0, t1])
  const supply = Number(pool.totalShare)
  const share = supply > 0 ? Math.min(1, Number(total) / supply) : 0
  const amounts: [number, number] = [
    (Number(pool.reserves[0]) / 10 ** t0.decimals) * share,
    (Number(pool.reserves[1]) / 10 ** t1.decimals) * share,
  ]
  const p0 = px[assetId(t0.info)], p1 = px[assetId(t1.info)]
  const usd = p0 > 0 && p1 > 0 ? amounts[0] * p0 + amounts[1] * p1 : null

  let pending: Reward[] = []
  let rewardsActive = false
  if (inc) {
    const [pr, info] = await Promise.all([
      BigInt(stakedLp || '0') > BigInt(0)
        ? smart<Asset[]>(inc, { pending_rewards: { lp_token: pair.liquidity_token, user } })
        : Promise.resolve(null),
      smart<{ rewards?: unknown[] }>(inc, { pool_info: { lp_token: pair.liquidity_token } }),
    ])
    rewardsActive = Array.isArray(info?.rewards) && info!.rewards!.length > 0
    if (Array.isArray(pr)) {
      pending = await Promise.all(
        pr.filter(a => a && a.amount !== '0').map(async a => ({ token: await resolveToken(a.info), amount: a.amount })),
      )
    }
  }
  return { pool, walletLp, stakedLp, amounts, usd, pending, rewardsActive }
}

async function mapLimit<T, R>(items: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await f(items[i])
    }
  }))
  return out
}

export interface AstroLegacy {
  /** xASTRO from Astroport's first staking contract, in the wallet */
  xastro: string
  /** ASTRO.cw20 in the wallet */
  astroCw20: string
  /** ASTRO.cw20 that unstaking all of that xASTRO returns, rounded down */
  leaveEstimate: string
  /**
   * Today's ASTRO the converter holds. It pays conversions out of this and
   * nothing else: on 2026-09-13 it held none, and every conversion failed with
   * "insufficient funds".
   */
  converterFunds: string
}

/** Old ASTRO a wallet still holds: xASTRO in the first staking contract and ASTRO.cw20. */
export async function readAstroLegacy(address: string): Promise<AstroLegacy> {
  const [xastro, astroCw20, shares, deposit, converterFunds] = await Promise.all([
    queryCw20Balance(XASTRO_CW20, address),
    queryCw20Balance(ASTRO_CW20, address),
    smart<string>(ASTRO_STAKING, { total_shares: {} }),
    smart<string>(ASTRO_STAKING, { total_deposit: {} }),
    queryNativeBalance(ASTRO_CONVERTER, ASTRO_IBC_DENOM),
  ])
  const leave = typeof shares === 'string' && typeof deposit === 'string' && BigInt(shares) > BigInt(0)
    ? (BigInt(xastro || '0') * BigInt(deposit)) / BigInt(shares)
    : BigInt(0)
  return { xastro: xastro || '0', astroCw20: astroCw20 || '0', leaveEstimate: leave.toString(), converterFunds: converterFunds || '0' }
}

export async function readPositions(address: string): Promise<Position[]> {
  const [tsPairs1, tsPairs2, astroPairs, skeletonPairs, touched, px] = await Promise.all([
    queryPairsOf(TERRA_SWAP_FACTORY), queryPairsOf(TERRA_SWAP_FACTORY_V2).catch(() => [] as PairInfo[]), queryPairsOf(ASTRO_FACTORY),
    queryPairsOf(SKELETON_FACTORY).then(ps => ps.map(withPlainLp)).catch(() => [] as PairInfo[]),
    historyTouches(address), marketPrices(),
  ])
  // Both of Terra Swap's factories: standard pools on the first, concentrated and stable pools on factory v2.
  const tsPairs = [...tsPairs1, ...tsPairs2]
  const byAddr = new Map<string, { pair: PairInfo; venue: Venue }>()
  const byLp = new Map<string, string>()
  for (const p of tsPairs) { byAddr.set(p.contract_addr, { pair: p, venue: 'terraswap' }); byLp.set(p.liquidity_token, p.contract_addr) }
  for (const p of astroPairs) { byAddr.set(p.contract_addr, { pair: p, venue: 'astroport' }); byLp.set(p.liquidity_token, p.contract_addr) }
  for (const p of skeletonPairs) { byAddr.set(p.contract_addr, { pair: p, venue: 'skeleton' }); byLp.set(p.liquidity_token, p.contract_addr) }

  // Every Terra Swap pool, every Astroport and Skeleton Swap pool of a listed token, and whatever the wallet itself touched.
  const want = new Set<string>(tsPairs.map(p => p.contract_addr))
  knownPairs(astroPairs).forEach(p => want.add(p.contract_addr))
  knownPairs(skeletonPairs).forEach(p => want.add(p.contract_addr))
  touched.pairs.forEach(a => { if (byAddr.has(a)) want.add(a) })
  touched.lpTokens.forEach(lp => { const a = byLp.get(lp); if (a) want.add(a) })

  const found = await mapLimit(Array.from(want), 10, async a => {
    const e = byAddr.get(a)
    return e ? readPosition(e.pair, e.venue, address, px).catch(() => null) : null
  })
  return found
    .filter((p): p is Position => p !== null)
    // Astroport leaves a unit or two of LP behind after some withdrawals; a known value under a cent is not a position.
    .filter(p => p.usd == null || p.usd >= 0.01 || p.pending.length > 0)
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))
}
