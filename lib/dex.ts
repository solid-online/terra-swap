/**
 * Atrium Swap — contract interface for the Atrium-run Astroport factory.
 *
 * Why this exists: Astroport's team has gone quiet and their frontend can
 * disappear without the contracts going anywhere. Meanwhile a $150k grant is
 * on the table to "build a DEX for Terra". This is the experiment that tests
 * the premise: the AMM code is Astroport's own audited xyk pair (code_id 392,
 * instantiable by anyone), run from a factory Atrium controls, with a frontend
 * that lives under atrium.markets. Not a line of AMM maths is ours, which is
 * the whole point — the SCV audit showed how fee arithmetic goes wrong in a
 * contract far simpler than an AMM.
 *
 * Everything degrades to "not live yet" until NEXT_PUBLIC_DEX_FACTORY
 * points at the instantiated factory. Same pattern as the launchpad.
 *
 * Fee model, decided for the beta:
 *   • Pool fee 30 bps, ALL of it to LPs (factory maker_fee_bps = 0). The
 *     experiment does not skim the pools; liquidity providers get everything.
 *   • Atrium frontend fee 25 bps on the offered asset, sent to treasury in the
 *     same tx. Crystal holders pay 0. That is the perk, and it lives in the
 *     frontend, never in the AMM.
 */

export const DEX_FACTORY = process.env.NEXT_PUBLIC_DEX_FACTORY || ''
export const isDexLive = () => DEX_FACTORY.length > 0

const LCD = process.env.NEXT_PUBLIC_LCD || 'https://terra-lcd.publicnode.com'

/** Pool commission, set on the factory. Shown to users; not enforced here. */
export const POOL_FEE_BPS = 30

// ─── Assets ─────────────────────────────────────────────────────

export type AssetInfo =
  | { native_token: { denom: string } }
  | { token: { contract_addr: string } }

export interface Asset {
  info: AssetInfo
  amount: string
}

export interface KnownToken {
  key: string
  label: string
  info: AssetInfo
  decimals: number
  /** true for cw20 — matters for how funds are attached to a tx */
  cw20: boolean
}

export const NOBLE_USDC = 'ibc/2C962DAB9F57FE0921435426AE75196009FAA1981BF86991203C8411F8980FDB'
export const SOLID_CW20 = 'terra10aa3zdkrc7jwuf8ekl3zq7e7m42vmzqehcmu74e4egc7xkm5kr2s0muyst'
export const CAPA_CW20 = 'terra1t4p3u8khpd7f8qzurwyafxt648dya6mp6vur3vaapswt6m24gkuqrfdhar'
export const AMPCAPA_DENOM = 'factory/terra186rpfczl7l2kugdsqqedegl4es4hp624phfc7ddy8my02a4e8lgq5rlx7y/ampCAPA'
/** Lion DAO's ROAR, cw20. */
export const ROAR_CW20 = 'terra1lxx40s29qvkrcj8fsa3yzyehy7w50umdvvnls2r830rys6lu2zns63eelv'
/**
 * Axelar's WBTC, straight over the Terra2↔Axelar channel (channel-6). 8 decimals.
 * Chosen over the other five "wbtc-satoshi" traces on this chain. One of them,
 * a Terra→Osmosis→Hub→Terra round-trip voucher, shows 500,000 "BTC" of supply
 * against Axelar's entire WBTC issuance of ~36 BTC (checked 2026-09-08). No
 * genuine escrow can produce that; whatever it is, it is not Bitcoin. The
 * direct Axelar channel is unambiguous and is what Station labels wBTC.axl.
 */
/**
 * IBC Eureka assets: Ethereum tokens bridged over the Cosmos Hub's 08-wasm
 * light client, arriving here via channel-0. Their base denom is the ERC-20
 * address, not a symbol — so a scan for "paxg" finds nothing (2026-09-08).
 * Station labels them ".atom". PAXG is 18 decimals, WBTC 8.
 */
export const PAXG_ATOM_DENOM = 'ibc/0EF5630576C66968EF0787868CF09FD866FAD131BC148D24A148358A85F0EB62'
export const WBTC_ATOM_DENOM = 'ibc/88386AC48152D48B34B082648DF836F975506F0B57DBBFC10A54213B1BF484CB'
export const AXL_WBTC_DENOM = 'ibc/05D299885B07905B6886F554B39346EA6761246076A1120B1950049B92B922DD'

/** SOLID first, deliberately — it is the pair the experiment is about. */
export const KNOWN_TOKENS: KnownToken[] = [
  { key: 'SOLID', label: 'SOLID', info: { token: { contract_addr: SOLID_CW20 } }, decimals: 6, cw20: true },
  { key: 'LUNA', label: 'LUNA', info: { native_token: { denom: 'uluna' } }, decimals: 6, cw20: false },
  { key: 'USDC', label: 'USDC', info: { native_token: { denom: NOBLE_USDC } }, decimals: 6, cw20: false },
  { key: 'CAPA', label: 'CAPA', info: { token: { contract_addr: CAPA_CW20 } }, decimals: 6, cw20: true },
  { key: 'ROAR', label: 'ROAR', info: { token: { contract_addr: ROAR_CW20 } }, decimals: 6, cw20: true },
  { key: 'wBTC.atom', label: 'wBTC.atom', info: { native_token: { denom: WBTC_ATOM_DENOM } }, decimals: 8, cw20: false },
  { key: 'PAXG', label: 'PAXG', info: { native_token: { denom: PAXG_ATOM_DENOM } }, decimals: 18, cw20: false },
  // wBTC.axl (AXL_WBTC_DENOM) deliberately not listed: 0.23 BTC on-chain vs
  // 6.55 for the Eureka one. Two wBTCs in a picker is a footgun, not a feature.
  // ampCAPA is deliberately absent: Astroport rejects its TokenFactory denom
  // (factory/…/ampCAPA) because the "CAPA" is uppercase — "Non-IBC token denom
  // should be lowercase". It cannot be a pair asset on this AMM, so offering it
  // in the create flow would only sell users a guaranteed-failing transaction.
]

export function assetId(info: AssetInfo): string {
  return 'native_token' in info ? info.native_token.denom : info.token.contract_addr
}

export function tokenFor(info: AssetInfo): KnownToken {
  const id = assetId(info)
  const known = KNOWN_TOKENS.find((t) => assetId(t.info) === id)
  if (known) return known
  // Unknown asset: still tradable, just labelled by its id.
  const cw20 = 'token' in info
  return { key: id, label: id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id, info, decimals: 6, cw20 }
}

export function sameAsset(a: AssetInfo, b: AssetInfo): boolean {
  return assetId(a) === assetId(b)
}

/**
 * Display string → smallest-unit integer string, exactly. Done with string
 * maths on purpose: `Math.round(n * 1e18)` is already imprecise for PAXG-sized
 * inputs (a double only carries ~15.9 significant digits).
 */
export function toMicro(display: string, decimals = 6): string | null {
  const t = display.trim().replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null
  const [int = '0', frac = ''] = t.split('.')
  const digits = (int + frac.slice(0, decimals).padEnd(decimals, '0')).replace(/^0+(?=\d)/, '')
  return digits === '' ? '0' : digits
}

export function fromMicro(micro: string | number, decimals = 6, maxFrac = 4): string {
  const n = Number(micro) / 10 ** decimals
  if (!Number.isFinite(n)) return String(micro)
  // High-decimal, high-value units (wBTC, PAXG) are usually held in tiny
  // fractions; four places would round 0.00012 BTC to nothing.
  const frac = decimals >= 8 ? Math.max(maxFrac, 6) : maxFrac
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : frac })
}

// ─── Queries (LCD, no signer) ───────────────────────────────────

export async function smart<T>(contract: string, msg: object): Promise<T | null> {
  try {
    const q = typeof window !== 'undefined'
      ? btoa(JSON.stringify(msg))
      : Buffer.from(JSON.stringify(msg)).toString('base64')
    const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return null
    return ((await r.json())?.data ?? null) as T | null
  } catch {
    return null
  }
}

export interface PairInfo {
  asset_infos: AssetInfo[]
  contract_addr: string
  liquidity_token: string
  pair_type: Record<string, unknown>
}

export interface PoolState {
  assets: Asset[]
  total_share: string
}

export interface Simulation {
  return_amount: string
  spread_amount: string
  commission_amount: string
}

/** Every pair our factory has created. */
/**
 * Every pair the factory knows, paged.
 *
 * This used to ask for 30 and stop. Past 30 pools the tail simply vanished,
 * and because the leaderboard treats "pools I can see" as the list of pools
 * whose history is allowed to exist, an unseen pool had its events deleted.
 * Nothing downstream may assume this list is complete unless it is.
 */
export async function queryPairs(): Promise<PairInfo[]> {
  if (!isDexLive()) return []
  const out: PairInfo[] = []
  let startAfter: AssetInfo[] | undefined
  for (let page = 0; page < 20; page++) {
    const r = await smart<{ pairs: PairInfo[] }>(DEX_FACTORY, {
      pairs: { limit: 30, ...(startAfter ? { start_after: startAfter } : {}) },
    })
    const got = r?.pairs ?? []
    out.push(...got)
    if (got.length < 30) break
    startAfter = got[got.length - 1].asset_infos
  }
  return out
}

export async function queryPool(pair: string): Promise<PoolState | null> {
  return smart<PoolState>(pair, { pool: {} })
}

export async function simulateSwap(pair: string, offer: Asset): Promise<Simulation | null> {
  return smart<Simulation>(pair, { simulation: { offer_asset: offer } })
}

export async function queryNativeBalance(addr: string, denom: string): Promise<string> {
  try {
    const r = await fetch(`${LCD}/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=${encodeURIComponent(denom)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return '0'
    return (await r.json())?.balance?.amount ?? '0'
  } catch {
    return '0'
  }
}

export async function queryCw20Balance(contract: string, addr: string): Promise<string> {
  const r = await smart<{ balance: string }>(contract, { balance: { address: addr } })
  return r?.balance ?? '0'
}

export async function queryBalance(addr: string, info: AssetInfo): Promise<string> {
  if (!addr) return '0'
  return 'native_token' in info
    ? queryNativeBalance(addr, info.native_token.denom)
    : queryCw20Balance(info.token.contract_addr, addr)
}

// ─── Derived views ──────────────────────────────────────────────

export interface PoolView extends PairInfo {
  tokens: [KnownToken, KnownToken]
  reserves: [string, string]
  totalShare: string
  /** Spot price of token[0] in token[1], from reserves. 0 when empty. */
  price: number
  empty: boolean
  label: string
  /** Total value locked in USD, when both sides can be priced. */
  tvlUsd?: number
  /** Market price of token[0] in token[1] from Astroport's deepest pools, when known. */
  marketPrice?: number
  /** pool price / market price. 4 = token[1] is 4× too cheap here. */
  deviation?: number
  /** USD standing on each side, at the market reference. */
  sideUsd?: [number, number]
}

/**
 * Market reference from Astroport: USD per token derived from their deepest
 * USDC-anchored pools. Our own pools are too thin to be a price; theirs are
 * the market this experiment is measured against. Cached five minutes.
 */
const ASTRO_FACTORY = 'terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r'
let marketCache: { at: number; px: Record<string, number> } | null = null
export async function marketPrices(): Promise<Record<string, number>> {
  if (marketCache && Date.now() - marketCache.at < 300_000) return marketCache.px
  try {
    // Every Astroport pair, then only the ones made of tokens we know.
    const pairs: PairInfo[] = []
    let start: AssetInfo[] | undefined
    for (let page = 0; page < 40; page++) {
      const r = await smart<{ pairs: PairInfo[] }>(ASTRO_FACTORY, { pairs: { limit: 30, ...(start ? { start_after: start } : {}) } })
      const got = r?.pairs ?? []
      pairs.push(...got)
      if (got.length < 30) break
      start = got[got.length - 1].asset_infos
    }
    const knownIds = new Set(KNOWN_TOKENS.map(t => assetId(t.info)))
    const relevant = pairs.filter(p => p.asset_infos.every(a => knownIds.has(assetId(a))))
    const views = await Promise.all(relevant.map(async p => toPoolView(p, await queryPool(p.contract_addr))))
    // Deepest pool per unordered pair wins; then the same USDC-anchored hop we use for our own TVL.
    const deepest = new Map<string, PoolView>()
    for (const v of views) {
      if (v.empty) continue
      const key = [assetId(v.tokens[0].info), assetId(v.tokens[1].info)].sort().join('|')
      const cur = deepest.get(key)
      if (!cur || Number(v.reserves[0]) > Number(cur.reserves[0])) deepest.set(key, v)
    }
    // A $250 floor on any single hop. Astroport keeps abandoned pools alive
    // forever, and one of them held $0.0008 of SOLID against 5,594 ROAR. Until
    // 2026-09-09 that pool set the reference price for ROAR, 91% below the real
    // ROAR/LUNA market, which in turn made a perfectly healthy pool of ours read
    // "1.9× off market". Depth decides the route now, and dust cannot quote.
    const px = usdPrices(Array.from(deepest.values()), 250)
    marketCache = { at: Date.now(), px }
    return px
  } catch { return marketCache?.px ?? {} }
}

/**
 * Value both sides of every pool at the market reference, and let that
 * reference set TVL as well.
 *
 * The number the API ships is derived from our own pools alone, which means it
 * hangs off our SOLID/USDC pool — roughly $2 deep — and reads about 15% high.
 * Astroport's pools are thousands of times deeper, so once they arrive they
 * win. Pools with a side we cannot price keep whatever the API said.
 */
export function annotateValues(pools: PoolView[], px: Record<string, number>): PoolView[] {
  for (const p of pools) {
    const [a, b] = p.tokens
    const pa = px[assetId(a.info)], pb = px[assetId(b.info)]
    if (!(pa > 0) || !(pb > 0)) continue
    const va = (Number(p.reserves[0]) / 10 ** a.decimals) * pa
    const vb = (Number(p.reserves[1]) / 10 ** b.decimals) * pb
    p.sideUsd = [va, vb]
    if (!p.empty) p.tvlUsd = va + vb
  }
  return pools
}

/** Fill marketPrice + deviation on our pools from the market map. */
export function annotateMarket(pools: PoolView[], px: Record<string, number>): PoolView[] {
  for (const p of pools) {
    const [a, b] = p.tokens
    const pa = px[assetId(a.info)], pb = px[assetId(b.info)]
    if (pa == null || pb == null || !(pb > 0)) continue
    p.marketPrice = pa / pb                      // 1 a = (pa/pb) b
    if (!p.empty && p.price > 0) p.deviation = p.price / p.marketPrice
  }
  return pools
}

export function toPoolView(pair: PairInfo, pool: PoolState | null): PoolView {
  const t0 = tokenFor(pair.asset_infos[0])
  const t1 = tokenFor(pair.asset_infos[1])
  // Reserves come back in the pair's own asset order, which matches asset_infos.
  const r0 = pool?.assets.find((a) => sameAsset(a.info, t0.info))?.amount ?? '0'
  const r1 = pool?.assets.find((a) => sameAsset(a.info, t1.info))?.amount ?? '0'
  const n0 = Number(r0), n1 = Number(r1)
  // Price in display units: 1 token0 = price token1. Raw ratios lie once the
  // two sides have different decimals (wBTC is 8, everything else here is 6).
  const d0 = Number(r0) / 10 ** t0.decimals, d1 = Number(r1) / 10 ** t1.decimals
  return {
    ...pair,
    tokens: [t0, t1],
    reserves: [r0, r1],
    totalShare: pool?.total_share ?? '0',
    price: d0 > 0 ? d1 / d0 : 0,
    empty: n0 === 0 || n1 === 0,
    label: `${t0.label} / ${t1.label}`,
  }
}

/**
 * USD price per token, derived from the pools themselves — no external feed.
 * USDC is the $1 anchor; anything paired with USDC gets priced directly, then
 * a second pass prices tokens paired with an already-priced token (so CAPA
 * gets a price via CAPA/LUNA once LUNA is known). Tokens that can't be reached
 * from USDC stay unpriced, and their pools simply show no TVL.
 */
export function usdPrices(pools: PoolView[], minHopUsd = 0): Record<string, number> {
  const px: Record<string, number> = { [NOBLE_USDC]: 1 }
  // Four passes reaches anything hanging off USDC → LUNA → …
  for (let pass = 0; pass < 4; pass++) {
    // Gather every route to a still-unpriced token, then take the deepest one.
    // Iteration order used to decide this, which let an abandoned pool set a
    // price: see the note on the $250 floor in marketPrices.
    const best = new Map<string, { depth: number; price: number }>()
    for (const p of pools) {
      if (p.empty) continue
      const [a, b] = p.tokens
      // display units, so decimals never skew the hop
      const ra = Number(p.reserves[0]) / 10 ** a.decimals, rb = Number(p.reserves[1]) / 10 ** b.decimals
      const ida = assetId(a.info), idb = assetId(b.info)
      const hop = (known: string, unknown: string, rKnown: number, rUnknown: number) => {
        if (px[known] == null || px[unknown] != null) return
        if (!(rKnown > 0) || !(rUnknown > 0)) return
        const depth = rKnown * px[known]   // dollars standing behind this quote
        if (depth < minHopUsd) return
        const cur = best.get(unknown)
        // price of X = (reserveKnown / reserveX) * priceKnown
        if (!cur || depth > cur.depth) best.set(unknown, { depth, price: (rKnown / rUnknown) * px[known] })
      }
      hop(ida, idb, ra, rb)
      hop(idb, ida, rb, ra)
    }
    if (best.size === 0) break
    best.forEach((v, id) => { px[id] = v.price })
  }
  return px
}

/** What an LP balance actually is: a share of the pool, in tokens and dollars. */
export interface LpPosition {
  /** 0..100 */
  sharePct: number
  /** display units, in pool order */
  amounts: [number, number]
  usd: number | null
}

/**
 * An LP token balance on its own tells you nothing — "374,165.738" is not an
 * amount of anything a person holds. It is a claim on a fraction of the pool,
 * so say which fraction, of what, and what that is worth.
 */
export function lpPosition(pool: PoolView, lpMicro: string): LpPosition | null {
  const total = Number(pool.totalShare), mine = Number(lpMicro)
  if (!(total > 0) || !(mine > 0)) return null
  const share = Math.min(1, mine / total)
  return {
    sharePct: share * 100,
    amounts: [
      (Number(pool.reserves[0]) / 10 ** pool.tokens[0].decimals) * share,
      (Number(pool.reserves[1]) / 10 ** pool.tokens[1].decimals) * share,
    ],
    usd: pool.tvlUsd != null ? pool.tvlUsd * share : null,
  }
}

/**
 * How easily this pool can walk away. `toHalf` is the number of wallets that
 * together hold more than half the LP: 1 means one signature empties most of
 * it. Astroport locks a tiny minimum on first deposit, which shows up as a
 * dust holder and is ignored here.
 */
export function lpConcentration(total: string, holders: { address: string; amount: string }[]): {
  count: number; topPct: number; toHalf: number
} | null {
  const t = Number(total)
  if (!(t > 0) || holders.length === 0) return null
  const real = holders.filter(h => Number(h.amount) / t > 0.0001)
  if (real.length === 0) return null
  const sorted = [...real].sort((a, b) => Number(b.amount) - Number(a.amount))
  let acc = 0, toHalf = 0
  for (const h of sorted) { acc += Number(h.amount); toHalf++; if (acc / t > 0.5) break }
  return { count: real.length, topPct: (Number(sorted[0].amount) / t) * 100, toHalf }
}

/** Fill tvlUsd on each pool from a price map (both sides must be priceable). */
export function annotateTvl(pools: PoolView[]): PoolView[] {
  const px = usdPrices(pools)
  for (const p of pools) {
    if (p.empty) continue
    const [a, b] = p.tokens
    const pa = px[assetId(a.info)], pb = px[assetId(b.info)]
    if (pa == null || pb == null) continue
    const va = (Number(p.reserves[0]) / 10 ** a.decimals) * pa
    const vb = (Number(p.reserves[1]) / 10 ** b.decimals) * pb
    p.tvlUsd = va + vb
  }
  return pools
}

// ─── Zap (single-sided add) ─────────────────────────────────────

/**
 * How much of a single-token deposit X to swap so that what is left plus what
 * comes back matches the pool ratio *after* the swap — the classic zap
 * formula for a constant-product pool with fee f on the input side:
 *   s = (√(R·(R·(2−f)² + 4·(1−f)·X)) − R·(2−f)) / (2·(1−f))
 * Astroport charges its fee on the output instead, so this is a hair off; the
 * provide leg carries a slippage tolerance that more than covers it.
 */
export function zapSwapAmount(xMicro: string, reserveInMicro: string, feeBps = POOL_FEE_BPS): string {
  const X = Number(xMicro), R = Number(reserveInMicro), f = feeBps / 10_000
  if (!(X > 0) || !(R > 0)) return '0'
  const s = (Math.sqrt(R * (R * (2 - f) ** 2 + 4 * (1 - f) * X)) - R * (2 - f)) / (2 * (1 - f))
  return String(Math.max(0, Math.floor(Math.min(s, X))))
}

export interface ZapPlan {
  /** index of the deposited token in pool.tokens */
  inIdx: 0 | 1
  swapAmount: string
  /** simulated return of the swap leg, smallest units of the other token */
  expectedReturn: string
  spread: string
  /** what gets provided, in PAIR order */
  provide: [Asset, Asset]
  /** price impact of the swap leg, % */
  impact: number
}

/**
 * Plan a zap: split X, simulate the swap leg against the pool, and shave the
 * received side by `maxSpread` so the provide leg cannot ask for more than the
 * wallet will actually hold once the swap has settled.
 */
export async function planZap(pool: PoolView, inIdx: 0 | 1, xMicro: string, maxSpread: number): Promise<ZapPlan | null> {
  const tIn = pool.tokens[inIdx], tOut = pool.tokens[inIdx === 0 ? 1 : 0]
  const swapAmount = zapSwapAmount(xMicro, pool.reserves[inIdx])
  if (swapAmount === '0') return null
  const sim = await simulateSwap(pool.contract_addr, { info: tIn.info, amount: swapAmount })
  if (!sim || !(Number(sim.return_amount) > 0)) return null
  const remaining = (BigInt(xMicro) - BigInt(swapAmount)).toString()
  const shaved = (BigInt(sim.return_amount) * BigInt(Math.round((1 - maxSpread) * 10_000)) / BigInt(10_000)).toString()
  const inAsset: Asset = { info: tIn.info, amount: remaining }
  const outAsset: Asset = { info: tOut.info, amount: shaved }
  const provide: [Asset, Asset] = inIdx === 0 ? [inAsset, outAsset] : [outAsset, inAsset]
  const impact = Number(sim.spread_amount) / Math.max(1, Number(sim.return_amount) + Number(sim.spread_amount)) * 100
  return { inIdx, swapAmount, expectedReturn: sim.return_amount, spread: sim.spread_amount, provide, impact }
}

