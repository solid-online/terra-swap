/**
 * Contract interface for Astroport-code pools on Terra: which factory this
 * build fronts, the tokens it names, pool reads, prices, and the zap planner.
 *
 * Nothing here holds keys or takes a fee. Every transaction the page builds
 * goes straight to Astroport's own contracts (lib/msgs), and the AMM maths is
 * Astroport's audited pair code; none of it is reimplemented here.
 *
 * NEXT_PUBLIC_DEX_FACTORY picks the factory and NEXT_PUBLIC_DEX_MODE the site.
 * Without a factory the page renders "not live yet".
 */

import { lcdFetch } from 'lib/lcd'

export const DEX_FACTORY = process.env.NEXT_PUBLIC_DEX_FACTORY || ''
export const isDexLive = () => DEX_FACTORY.length > 0

/**
 * Which factory this build fronts. The same code runs two sites: Terra Swap on
 * its own renounced factory, and a plain interface to Astroport's factory so
 * the chain's main liquidity stays reachable from an open, self-hostable page.
 * Astroport mode drops everything that only makes sense on our own pools (the
 * board, pool creation, the jokes) and lists only pairs of tokens we can name.
 */
export const DEX_MODE: 'terraswap' | 'astroport' = process.env.NEXT_PUBLIC_DEX_MODE === 'astroport' ? 'astroport' : 'terraswap'
export const IS_ASTRO = DEX_MODE === 'astroport'

/** Terra Swap's renounced factory, and Astroport's. Each site routes through both. */
export const TERRA_SWAP_FACTORY = 'terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd'
export const ASTRO_FACTORY = 'terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r'
export type Venue = 'terraswap' | 'astroport'
/** This build's own pools, and the other site's, which it routes into as well. */
export const HOME_VENUE: Venue = IS_ASTRO ? 'astroport' : 'terraswap'
export const AWAY_VENUE: Venue = IS_ASTRO ? 'terraswap' : 'astroport'
export const VENUE_FACTORY: Record<Venue, string> = { terraswap: TERRA_SWAP_FACTORY, astroport: ASTRO_FACTORY }
export const VENUE_NAME: Record<Venue, string> = { terraswap: 'Terra Swap', astroport: 'Astroport' }
/** Where a venue's LP gets staked for rewards ("Astroport Incentives"). Terra Swap's factory has none. */
export const VENUE_INCENTIVES: Record<Venue, string | null> = {
  terraswap: null,
  astroport: 'terra1eywh4av8sln6r45pxq45ltj798htfy0cfcf7fy3pxc2gcv6uc07se4ch9x',
}
/** The native coin registry both factories read decimals from. */
export const COIN_REGISTRY = 'terra1zuf8fla02926nhpfvk09k2pg6qv9aayflp0qt4a0msppu2h4exqs6af275'
/**
 * Astroport's first ASTRO staking on Terra (cw20 ASTRO in, cw20 xASTRO out),
 * still holding 31.6M ASTRO for 27.8M xASTRO on 2026-09-13, and Astroport's
 * converter from ASTRO.cw20 to the IBC ASTRO it uses today. Addresses from
 * Astroport's own phoenix-1 deployment file.
 */
export const ASTRO_STAKING = 'terra1nyu6sk9rvtvsltm7tjjrp6rlavnm3e4sq03kltde6kesam260f8szar8ze'
export const XASTRO_CW20 = 'terra1x62mjnme4y0rdnag3r8rfgjuutsqlkkyuh4ndgex0wl3wue25uksau39q8'
export const ASTRO_CONVERTER = 'terra1jyu4nct8ake3k8y8g42n8dvc9umtl5cktmtcy6rfdygse62fp7qse5rwjm'
/**
 * Astroport's router on Terra, pointed at Astroport's factory. It carries each
 * swap's full return into the next and checks one minimum at the end, which
 * separate swap messages cannot do. It finds each pool by its two tokens, and
 * Astroport's factory allows one pool per token pair ("Pair was already
 * created" for a second pool type; no duplicates among its 846 pairs on
 * 2026-09-13), so it trades exactly the pool a quote used.
 */
export const ASTRO_ROUTER = 'terra1j8hayvehh3yy02c2vtw5fdhz9f4drhtee8p5n5rguvg3nyd6m83qd2y90a'
/**
 * Terra Swap's router (contracts/router): one transaction through pools on
 * both factories, each swap's whole return into the next, one minimum on what
 * arrives. No owner, no admin, no fee. On chain since 2026-09-14 as code 4028;
 * contracts/router/verify.sh checks it against the build. Set the variable to
 * an empty string to sign such routes as separate swaps instead.
 */
export const TERRA_SWAP_ROUTER = process.env.NEXT_PUBLIC_TERRA_SWAP_ROUTER ?? 'terra1u2uh0jsl2u76j52e6egf09zslsns27qsmzxxzcsxdxymeax8883s9prc4l'


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
/**
 * USDC.inj: Circle's USDC as issued on Injective (erc20:0xa00C59fF…235a),
 * arriving over Injective's channel-255. 6 decimals, and registered in the
 * factory's coin registry, so a pool with it can actually be opened.
 *
 * Listed 2026-09-13 after a liquidity provider bridged funds in to seed a pool
 * with it. On 2026-09-10 its supply here was zero; three days later 609.89.
 * Always labelled USDC.inj, never plain "USDC": Noble USDC stays the only
 * dollar the price maths anchors to, and this one is priced through its pools
 * like any other token. Two things called USDC in one picker is how people
 * send the wrong one.
 */
export const USDC_INJ_DENOM = 'ibc/E8481AD838C31D4FC12A504B10F9B4E2F830F8818D2735C2FFC707579B5FA60B'
/**
 * Added 2026-09-13 so the pools interface covers where Terra's liquidity
 * actually sits, not only the tokens this project started with. Astroport TVL
 * per token that day: ampLUNA $2.1M, EURe $514k, USDT $159k, arbLUNA $121k,
 * ATOM $38k, ASTRO $23k. Origins read from each denom's IBC trace.
 */
export const AMPLUNA_CW20 = 'terra1ecgazyd0waaj3g7l9cmy5gulhxkps2gmxu9ghducvuypjq68mq2s5lvsct'
export const ARBLUNA_CW20 = 'terra1se7rvuerys4kd2snt6vqswh9wugu49vhyzls8ymc02wl37g2p2ms5yz490'
/** EURe over Noble, channel-253. */
export const EURE_DENOM = 'ibc/8D52B251B447B7160421ACFBD50F6B0ABE5F98D2C404B03701130F12044439A1'
/** Tether USDT, erc20/tether/usdt over channel-272. */
export const USDT_DENOM = 'ibc/9B19062D46CAB50361CE9B0A3E6D0A7A53AC9E7CB361F32A73CC733144A9A9E5'
/** ATOM from the Cosmos Hub, channel-0. */
export const ATOM_DENOM = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
/** ASTRO as Terra's original cw20. Incentives are denominated in the IBC ASTRO, which positions name from its trace. */
export const ASTRO_CW20 = 'terra1nsuqsk6kh58ulczatwev87ttq2z6r3pusulg9r24mfj2fvtzd4uq3exn26'
/**
 * Every other token in an Astroport pool with at least $100 of liquidity on
 * 2026-09-13, so no swap needs Astroport's own app. Decimals from each token's
 * token_info or the coin registry; INJ is not in the registry and is 18.
 */
export const ASTRO_IBC_DENOM = 'ibc/8D8A7F7253615E5F76CB6252A1E1BD921D5EDB7BBAAF8913FB1C77FF125D9995'
export const BLUNA_CW20 = 'terra17aj4ty4sz4yhgm08na8drc0v03v2jwr3waxcqrwhajj729zhl7zqnpc0ml'
export const LUNAX_CW20 = 'terra14xsm2wzvu7xaf567r693vgfkhmvfs08l68h4tjj5wjgyn5ky8e2qvzyanh'
export const VKR_CW20 = 'terra1gy73st560m2j0esw5c5rjmr899hvtv4rhh4seeajt3clfhr4aupszjss4j'
/** Stride, channel-46. */
export const STLUNA_DENOM = 'ibc/08095CEDEA29977C9DD0CE9A48329FDA622C183359D5F90CF04CC4FF80CBE431'
export const STATOM_DENOM = 'ibc/FD9DBF0DB4D301313195159303811FD2FD72185C4B11A51659EFCD49D7FF1228'
/** Neutron, channel-229. */
export const DATOM_DENOM = 'ibc/223FF539430381ADAB3A66AC4822E253C3F845E9841F17FEEC207B3AA9F8D915'
export const FUEL_DENOM = 'ibc/4B44179AC2F0BEE50C16A673B3B886398988692885B2848A1C8AEF27148B3961'
/** Injective, channel-255. */
export const INJ_DENOM = 'ibc/25BC59386BB65725F735EFC0C369BB717AA8B5DAD846EAF9CBF5D0F18F207211'
export const AMPROAR_DENOM = 'factory/terra1vklefn7n6cchn0u962w3gaszr4vf52wjvd4y95t2sydwpmpdtszsqvk9wy/ampROAR'
/** Tether over Axelar, channel-6. A USDT, not a USDC, so the Noble-only rule does not apply. */
export const AXL_USDT_DENOM = 'ibc/CBF67A2BCF6CAE343FDF251E510C8E18C361FC02B23430C121116E0811835DEF'

/** SOLID first, deliberately — it is the pair the experiment is about. */
export const KNOWN_TOKENS: KnownToken[] = [
  { key: 'SOLID', label: 'SOLID', info: { token: { contract_addr: SOLID_CW20 } }, decimals: 6, cw20: true },
  { key: 'LUNA', label: 'LUNA', info: { native_token: { denom: 'uluna' } }, decimals: 6, cw20: false },
  { key: 'USDC', label: 'USDC', info: { native_token: { denom: NOBLE_USDC } }, decimals: 6, cw20: false },
  { key: 'CAPA', label: 'CAPA', info: { token: { contract_addr: CAPA_CW20 } }, decimals: 6, cw20: true },
  { key: 'ROAR', label: 'ROAR', info: { token: { contract_addr: ROAR_CW20 } }, decimals: 6, cw20: true },
  { key: 'wBTC.atom', label: 'wBTC.atom', info: { native_token: { denom: WBTC_ATOM_DENOM } }, decimals: 8, cw20: false },
  { key: 'PAXG', label: 'PAXG', info: { native_token: { denom: PAXG_ATOM_DENOM } }, decimals: 18, cw20: false },
  { key: 'USDC.inj', label: 'USDC.inj', info: { native_token: { denom: USDC_INJ_DENOM } }, decimals: 6, cw20: false },
  { key: 'ampLUNA', label: 'ampLUNA', info: { token: { contract_addr: AMPLUNA_CW20 } }, decimals: 6, cw20: true },
  { key: 'arbLUNA', label: 'arbLUNA', info: { token: { contract_addr: ARBLUNA_CW20 } }, decimals: 6, cw20: true },
  { key: 'EURe', label: 'EURe', info: { native_token: { denom: EURE_DENOM } }, decimals: 6, cw20: false },
  { key: 'USDT', label: 'USDT', info: { native_token: { denom: USDT_DENOM } }, decimals: 6, cw20: false },
  { key: 'ATOM', label: 'ATOM', info: { native_token: { denom: ATOM_DENOM } }, decimals: 6, cw20: false },
  // Named as the chain registry names it, so it never reads the same as the IBC ASTRO Astroport pays in now.
  { key: 'ASTRO.cw20', label: 'ASTRO.cw20', info: { token: { contract_addr: ASTRO_CW20 } }, decimals: 6, cw20: true },
  { key: 'ASTRO', label: 'ASTRO', info: { native_token: { denom: ASTRO_IBC_DENOM } }, decimals: 6, cw20: false },
  { key: 'bLUNA', label: 'bLUNA', info: { token: { contract_addr: BLUNA_CW20 } }, decimals: 6, cw20: true },
  { key: 'LunaX', label: 'LunaX', info: { token: { contract_addr: LUNAX_CW20 } }, decimals: 6, cw20: true },
  { key: 'stLUNA', label: 'stLUNA', info: { native_token: { denom: STLUNA_DENOM } }, decimals: 6, cw20: false },
  { key: 'stATOM', label: 'stATOM', info: { native_token: { denom: STATOM_DENOM } }, decimals: 6, cw20: false },
  { key: 'dATOM', label: 'dATOM', info: { native_token: { denom: DATOM_DENOM } }, decimals: 6, cw20: false },
  { key: 'INJ', label: 'INJ', info: { native_token: { denom: INJ_DENOM } }, decimals: 18, cw20: false },
  { key: 'ampROAR', label: 'ampROAR', info: { native_token: { denom: AMPROAR_DENOM } }, decimals: 6, cw20: false },
  { key: 'FUEL', label: 'FUEL', info: { native_token: { denom: FUEL_DENOM } }, decimals: 6, cw20: false },
  { key: 'VKR', label: 'VKR', info: { token: { contract_addr: VKR_CW20 } }, decimals: 6, cw20: true },
  { key: 'USDT.axl', label: 'USDT.axl', info: { native_token: { denom: AXL_USDT_DENOM } }, decimals: 6, cw20: false },
  // USDC over Axelar (channel-6, $81k on Astroport) is deliberately not listed or routed: Noble USDC
  // is the one dollar this stack uses. Positions in its pools still show up and can be exited.
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

const resolvedTokens = new Map<string, KnownToken>()
/**
 * A token we do not list, named and sized from the chain: a cw20's own
 * token_info, or a native denom's decimals from the coin registry and a name
 * from its IBC trace. For places where someone's position can be in any pool.
 */
export async function resolveToken(info: AssetInfo): Promise<KnownToken> {
  const id = assetId(info)
  const known = KNOWN_TOKENS.find(t => assetId(t.info) === id)
  if (known) return known
  const hit = resolvedTokens.get(id)
  if (hit) return hit
  let label = tokenFor(info).label
  let decimals = 6
  if ('token' in info) {
    const t = await smart<{ symbol?: string; decimals?: number }>(id, { token_info: {} })
    if (t?.symbol) label = t.symbol
    if (typeof t?.decimals === 'number') decimals = t.decimals
  } else {
    const d = await smart<number>(COIN_REGISTRY, { native_token: { denom: id } })
    if (typeof d === 'number') decimals = d
    if (id.startsWith('factory/')) label = id.split('/').pop() ?? label
    else if (id.startsWith('ibc/')) {
      try {
        const r = await lcdFetch(`/ibc/apps/transfer/v1/denom_traces/${id.slice(4)}`, { timeoutMs: 8000 })
        const trace = r.ok ? (await r.json())?.denom_trace : null
        const base: string = trace?.base_denom ?? ''
        const name = base.includes('/') ? base.split('/').pop() ?? '' : base.replace(/^u/, '')
        // channel-6 is Axelar: say so, so two USDCs never look alike.
        if (name) label = `${name.toUpperCase()}${trace?.path === 'transfer/channel-6' ? '.axl' : ''}`
      } catch { /* keep the short id */ }
    }
  }
  const token: KnownToken = { key: id, label, info, decimals, cw20: 'token' in info }
  resolvedTokens.set(id, token)
  return token
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
    const r = await lcdFetch(`/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`, {
      headers: { accept: 'application/json' },
      timeoutMs: 8000,
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

/**
 * Every pair a factory knows, paged, cached per factory.
 *
 * This used to ask for 30 and stop. Past 30 pools the tail simply vanished,
 * and because the leaderboard treats "pools I can see" as the list of pools
 * whose history is allowed to exist, an unseen pool had its events deleted.
 * Nothing downstream may assume this list is complete unless it is, so only a
 * list read to the end is cached. Astroport's ~850 pairs barely change and
 * keep ten minutes; the other site's factory, read for routing, keeps one;
 * Terra Swap's own factory is never cached, so a pool someone just opened
 * shows up at once.
 */
const pairsCache = new Map<string, { at: number; pairs: PairInfo[] }>()
export async function queryPairsOf(factory: string): Promise<PairInfo[]> {
  if (!factory) return []
  const ttl = factory === ASTRO_FACTORY ? 600_000 : factory === DEX_FACTORY ? 0 : 60_000
  const hit = pairsCache.get(factory)
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.pairs
  const out: PairInfo[] = []
  let startAfter: AssetInfo[] | undefined
  let complete = false
  for (let page = 0; page < 40; page++) {
    const r = await smart<{ pairs: PairInfo[] }>(factory, {
      pairs: { limit: 30, ...(startAfter ? { start_after: startAfter } : {}) },
    })
    if (!r) break
    const got = r.pairs ?? []
    out.push(...got)
    if (got.length < 30) { complete = true; break }
    startAfter = got[got.length - 1].asset_infos
  }
  if (ttl > 0 && complete) pairsCache.set(factory, { at: Date.now(), pairs: out })
  return out
}

/** Every pair this build's factory knows. */
export async function queryPairs(): Promise<PairInfo[]> {
  if (!isDexLive()) return []
  return queryPairsOf(DEX_FACTORY)
}

/** Only pairs whose two tokens we can name. */
export function knownPairs(pairs: PairInfo[]): PairInfo[] {
  const known = new Set(KNOWN_TOKENS.map(t => assetId(t.info)))
  return pairs.filter(p => p.asset_infos.every(a => known.has(assetId(a))))
}

/** The pairs this build shows. Astroport mode: only pairs of tokens we can name. */
export function listedPairs(pairs: PairInfo[]): PairInfo[] {
  return IS_ASTRO ? knownPairs(pairs) : pairs
}

/** xyk, stable, concentrated, or whatever custom name the pair carries. */
export function pairTypeOf(p: Pick<PairInfo, 'pair_type'>): string {
  const [k, v] = Object.entries(p.pair_type ?? {})[0] ?? ['xyk', {}]
  return k === 'custom' && typeof v === 'string' ? v : k
}

export async function queryPool(pair: string): Promise<PoolState | null> {
  return smart<PoolState>(pair, { pool: {} })
}

export async function simulateSwap(pair: string, offer: Asset): Promise<Simulation | null> {
  return smart<Simulation>(pair, { simulation: { offer_asset: offer } })
}

/**
 * What a swap's price limit is written against, and the least that limit lets
 * through.
 *
 * Astroport's pairs do not test the limit the same way. Simulated 2026-09-13
 * with a limit placed between the return and the return plus fee: xyk and
 * stable pairs let it through (they add the fee back before comparing),
 * concentrated pairs refused it (they compare the return alone). Writing xyk
 * and stable limits against return plus fee makes a slippage setting mean the
 * same on every pool type. An unknown pool type keeps the looser floor.
 */
export function priceLimit(pairType: string, expected: bigint, commission: bigint, slip: number): { limitReturn: bigint; floor: bigint } {
  const shave = (x: bigint) => (x * BigInt(Math.round((1 - slip) * 10_000))) / BigInt(10_000)
  let limitReturn = expected
  let floor: bigint
  if (pairType === 'concentrated') floor = shave(expected)
  else if (pairType === 'xyk' || pairType === 'stable') { limitReturn = expected + commission; floor = shave(limitReturn) - commission }
  else floor = shave(expected) - commission
  return { limitReturn, floor: floor > BigInt(0) ? floor : BigInt(0) }
}

export async function queryNativeBalance(addr: string, denom: string): Promise<string> {
  try {
    const r = await lcdFetch(`/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=${encodeURIComponent(denom)}`, {
      timeoutMs: 8000,
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
  /** Spot price of token[0] in token[1]: reserves on xyk, a simulated mid on other pool types (refineSpot). 0 when empty. */
  price: number
  empty: boolean
  label: string
  /** 'xyk' | 'stable' | 'concentrated' | … */
  pairType: string
  /** which site's factory the pool belongs to */
  venue: Venue
  /**
   * token1 per token0 by reserves: the ratio a balanced deposit follows. On
   * xyk this is also the price; on concentrated and stable pools it is not.
   */
  reserveRatio: number
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
let marketCache: { at: number; px: Record<string, number> } | null = null
export async function marketPrices(): Promise<Record<string, number>> {
  if (marketCache && Date.now() - marketCache.at < 300_000) return marketCache.px
  try {
    // Every Astroport pair (cached, and shared with routing), then only the ones made of tokens we know.
    const relevant = knownPairs(await queryPairsOf(ASTRO_FACTORY))
    const views = await Promise.all(relevant.map(async p => toPoolView(p, await queryPool(p.contract_addr), 'astroport')))
    // Most of Astroport's deep pools are concentrated; their reserves are not their price.
    await refineSpot(views)
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

export function toPoolView(pair: PairInfo, pool: PoolState | null, venue: Venue = HOME_VENUE, tokens?: [KnownToken, KnownToken]): PoolView {
  // Tokens resolved from the chain win over the static list, so an unlisted
  // token with 18 decimals is not priced as if it had 6.
  const t0 = tokens?.[0] ?? tokenFor(pair.asset_infos[0])
  const t1 = tokens?.[1] ?? tokenFor(pair.asset_infos[1])
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
    pairType: pairTypeOf(pair),
    venue,
    reserveRatio: d0 > 0 ? d1 / d0 : 0,
  }
}

/**
 * Real spot prices for pools whose reserves are not their price.
 *
 * On a concentrated pool the reserve ratio can sit well away from the price:
 * Astroport's LUNA/USDC read $0.04571 from reserves on 2026-09-13 while its own
 * simulations put LUNA at $0.04656. Selling a sliver each way brackets the
 * price with the fee on both sides, and the geometric mean cancels the fee.
 * xyk pools keep the reserve ratio, which is exact for them.
 */
export async function refineSpot(pools: PoolView[]): Promise<PoolView[]> {
  await Promise.all(pools.map(async p => {
    if (p.pairType === 'xyk' || p.empty) return
    const [t0, t1] = p.tokens
    const x0 = (BigInt(p.reserves[0]) / BigInt(10_000)).toString()
    const x1 = (BigInt(p.reserves[1]) / BigInt(10_000)).toString()
    if (x0 === '0' || x1 === '0') return
    const [s0, s1] = await Promise.all([
      simulateSwap(p.contract_addr, { info: t0.info, amount: x0 }),
      simulateSwap(p.contract_addr, { info: t1.info, amount: x1 }),
    ])
    if (!s0 || !s1 || !(Number(s0.return_amount) > 0) || !(Number(s1.return_amount) > 0)) return
    const d0 = 10 ** t0.decimals, d1 = 10 ** t1.decimals
    const sell = (Number(s0.return_amount) / d1) / (Number(x0) / d0)   // token1 received per token0 sold
    const buy = (Number(x1) / d1) / (Number(s1.return_amount) / d0)    // token1 paid per token0 bought
    const mid = Math.sqrt(sell * buy)
    if (Number.isFinite(mid) && mid > 0) p.price = mid
  }))
  return pools
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
      // p.price is token a in token b. On xyk that is rb / ra, so this is the
      // old reserve formula exactly; on concentrated pools it is the simulated
      // mid, which the reserve ratio is not (see refineSpot).
      if (!(p.price > 0)) continue
      const hop = (known: string, unknown: string, rKnown: number, rUnknown: number, unknownInKnown: number) => {
        if (px[known] == null || px[unknown] != null) return
        if (!(rKnown > 0) || !(rUnknown > 0)) return
        const depth = rKnown * px[known]   // dollars standing behind this quote
        if (depth < minHopUsd) return
        const cur = best.get(unknown)
        if (!cur || depth > cur.depth) best.set(unknown, { depth, price: unknownInKnown * px[known] })
      }
      hop(ida, idb, ra, rb, 1 / p.price)   // 1 b = 1/price a
      hop(idb, ida, rb, ra, p.price)       // 1 a = price b
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
  /** what the swap's price limit is written against (priceLimit) */
  limitReturn: string
}

/**
 * Plan a zap: split X, simulate the swap leg against the pool, and ask the
 * provide leg for no more than the least the swap can return at `maxSpread`
 * (priceLimit), so it is always paid from the swap itself.
 */
export async function planZap(pool: PoolView, inIdx: 0 | 1, xMicro: string, maxSpread: number): Promise<ZapPlan | null> {
  const tIn = pool.tokens[inIdx], tOut = pool.tokens[inIdx === 0 ? 1 : 0]
  const swapAmount = zapSwapAmount(xMicro, pool.reserves[inIdx])
  if (swapAmount === '0') return null
  const sim = await simulateSwap(pool.contract_addr, { info: tIn.info, amount: swapAmount })
  if (!sim || !(Number(sim.return_amount) > 0)) return null
  const remaining = (BigInt(xMicro) - BigInt(swapAmount)).toString()
  const { limitReturn, floor } = priceLimit(pool.pairType, BigInt(sim.return_amount), BigInt(sim.commission_amount), maxSpread)
  if (floor === BigInt(0)) return null
  const inAsset: Asset = { info: tIn.info, amount: remaining }
  const outAsset: Asset = { info: tOut.info, amount: floor.toString() }
  const provide: [Asset, Asset] = inIdx === 0 ? [inAsset, outAsset] : [outAsset, inAsset]
  const impact = Number(sim.spread_amount) / Math.max(1, Number(sim.return_amount) + Number(sim.spread_amount)) * 100
  return { inIdx, swapAmount, expectedReturn: sim.return_amount, limitReturn: limitReturn.toString(), spread: sim.spread_amount, provide, impact }
}

