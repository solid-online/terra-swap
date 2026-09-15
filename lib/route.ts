/**
 * Best execution across both sites.
 *
 * Terra Swap's pools are small and Astroport's are deep, and until now neither
 * site knew the other existed. Measured 2026-09-13: 50 SOLID → USDC returned
 * 4.11 USDC through Terra Swap's pools and 50.46 through Astroport's. So a swap
 * now considers every pool on both factories, direct or through one
 * intermediate token, prices each path with the pools' own simulations, and
 * takes the best. When a Terra Swap pool is the better price, because it has
 * drifted, flow from the Astroport interface goes through it, which is also
 * what pulls it back to market.
 *
 * Audited 2026-09-14 against an exhaustive simulation of every path, Skip Go,
 * and real holders' simulated transactions: the one- and two-pool choice was
 * already the best in every case, but two things were missing. Paths through
 * three pools (CAPA, ROAR and SOLID to USDC gained 0.15 to 1.5%, usually via
 * LUNA → ampLUNA → USDC), and splitting a large amount over two paths that
 * share no pool ($5,000 gained 0.6 to 2.2% on LUNA, SOLID, PAXG and EURe).
 * Both are considered now, and quotes are ranked by what reaches the wallet.
 *
 * A route made only of Astroport's pools goes through Astroport's router, which
 * carries each swap's full return into the next and checks one minimum at the
 * end. A route through Terra Swap's pools, which that router cannot reach,
 * goes through Terra Swap's own router (contracts/router) the same way, once
 * TERRA_SWAP_ROUTER is set; until then it is signed as consecutive swaps in one
 * transaction, each with its own price limit. Either way, if anything falls
 * short the whole transaction reverts.
 *
 * Skeleton Swap's pools (White Whale's pool contracts, lib/skeleton) are priced
 * and ranked the same way when the swap page or the quote API passes them in.
 * Neither router can reach them, so a route through one is always signed as
 * consecutive swaps, and a swap that has to be one router call (on arrival over
 * IBC) never uses them.
 */

import {
  NOBLE_USDC, ROUTER_VENUES, USDC_INJ_DENOM, assetId, priceLimit, sameAsset, simulateSwap, toMicro, TERRA_SWAP_ROUTER, VENUE_NAME,
  type KnownToken, type PoolView, type Venue,
} from 'lib/dex'

/**
 * USDC from Noble and USDC.inj are two different dollars, and this site never
 * exchanges one for the other: not directly, not through a pool that holds
 * both, and not along a longer path that starts or passes through one and
 * ends in or passes through the other. A path is dropped here if its tokens
 * include both, so every swap, split, zap, loop, sweep and swap on arrival
 * keeps to it without having to remember.
 */
const mixesDollars = (tokens: KnownToken[]) => {
  const ids = tokens.map(t => assetId(t.info))
  return ids.includes(NOBLE_USDC) && ids.includes(USDC_INJ_DENOM)
}

/** Pools under this much liquidity are never routed through. */
const MIN_TVL_USD = 5
/** A three-pool path only uses pools at least this deep. There are few of them, and they are the ones that can win. */
const MIN_TVL_3HOP_USD = 1000
/** Paths simulated exactly per quote: the best few through one or two pools, the best through three, and the best home-only one. */
const SIMULATE_TOP = 3
const SIMULATE_TOP_3HOP = 2
/** Below this price impact on the best path, splitting cannot pay for itself. */
const SPLIT_MIN_IMPACT_PCT = 0.15
/** A split is only offered when it delivers at least this much more than the best single path, in basis points. */
const SPLIT_MIN_GAIN_BP = 5

export interface Leg {
  pool: PoolView
  offer: KnownToken
  ask: KnownToken
  /** what the simulation was asked, smallest units */
  offerMicro: string
  returnMicro: string
  spreadMicro: string
  commissionMicro: string
}

export interface Quote {
  legs: Leg[]
  outMicro: string
  /** price impact, %: estimated from the pools' spreads when simulated, measured by probeImpact for the quotes that get shown and signed */
  impactPct: number
}

/** What actually gets signed for one leg. */
export interface ExecLeg {
  pair: string
  /** which site's factory owns the pair; Terra Swap's router looks the pair up there */
  venue: Venue
  offerInfo: KnownToken['info']
  askInfo: KnownToken['info']
  offerAmount: string
  /** simulated return after the pool's fee, scaled to this offer */
  expectedReturn: string
  /** what the price limit is written against, which depends on the pool type (priceLimit) */
  limitReturn: string
  /** the least this leg can return if the transaction succeeds */
  minReturn: string
}

interface Path { pools: PoolView[]; tokens: KnownToken[] }

const has = (p: PoolView, t: KnownToken) => p.tokens.some(x => sameAsset(x.info, t.info))
const otherSide = (p: PoolView, t: KnownToken) => p.tokens.find(x => !sameAsset(x.info, t.info)) ?? null
const usable = (pools: PoolView[]) => pools.filter(p => !p.empty && (p.tvlUsd ?? 0) >= MIN_TVL_USD)

/** The deepest pool per site for one pair. */
function perVenue(pools: PoolView[]): PoolView[] {
  const best = new Map<Venue, PoolView>()
  for (const p of pools) {
    const cur = best.get(p.venue)
    if (!cur || (p.tvlUsd ?? 0) > (cur.tvlUsd ?? 0)) best.set(p.venue, p)
  }
  return Array.from(best.values())
}

function paths(pools: PoolView[], from: KnownToken, to: KnownToken): Path[] {
  const live = usable(pools)
  const out: Path[] = []
  for (const p of perVenue(live.filter(q => has(q, from) && has(q, to)))) out.push({ pools: [p], tokens: [from, to] })
  const mids = new Map<string, KnownToken>()
  for (const p of live) {
    if (!has(p, from)) continue
    const m = otherSide(p, from)
    if (m && !sameAsset(m.info, to.info)) mids.set(assetId(m.info), m)
  }
  mids.forEach(m => {
    const first = perVenue(live.filter(q => has(q, from) && has(q, m)))
    const second = perVenue(live.filter(q => has(q, m) && has(q, to)))
    for (const a of first) for (const b of second) out.push({ pools: [a, b], tokens: [from, m, to] })
  })
  return out.filter(p => !mixesDollars(p.tokens))
}

/** Three pools through two intermediate tokens, each hop through the deepest pool for its pair. */
function paths3(pools: PoolView[], from: KnownToken, to: KnownToken): Path[] {
  const deep = usable(pools).filter(p => (p.tvlUsd ?? 0) >= MIN_TVL_3HOP_USD)
  const deepest = (a: KnownToken, b: KnownToken) => deep.filter(q => has(q, a) && has(q, b)).sort((x, y) => (y.tvlUsd ?? 0) - (x.tvlUsd ?? 0))[0]
  const neighbours = (t: KnownToken) => {
    const m = new Map<string, KnownToken>()
    for (const p of deep) { if (!has(p, t)) continue; const o = otherSide(p, t); if (o) m.set(assetId(o.info), o) }
    return Array.from(m.values())
  }
  const out: Path[] = []
  for (const m1 of neighbours(from)) {
    for (const m2 of neighbours(to)) {
      if (sameAsset(m1.info, m2.info) || sameAsset(m1.info, to.info) || sameAsset(m2.info, from.info)) continue
      const a = deepest(from, m1), b = deepest(m1, m2), c = deepest(m2, to)
      if (a && b && c) out.push({ pools: [a, b, c], tokens: [from, m1, m2, to] })
    }
  }
  return out.filter(p => !mixesDollars(p.tokens))
}

/** Every token reachable from `from` through one, two or three pools. */
export function reachable(pools: PoolView[], from: KnownToken, tokens: KnownToken[]): KnownToken[] {
  return tokens.filter(t => !sameAsset(t.info, from.info) && (paths(pools, from, t).length > 0 || paths3(pools, from, t).length > 0))
}

/** Rough output of one hop in display units, for ranking only. The numbers shown come from simulations. */
function estimateHop(p: PoolView, offer: KnownToken, amount: number): number {
  const i = sameAsset(p.tokens[0].info, offer.info) ? 0 : 1
  const reserveIn = Number(p.reserves[i]) / 10 ** offer.decimals
  const price = i === 0 ? p.price : p.price > 0 ? 1 / p.price : 0
  const fee = p.pairType === 'xyk' ? 0.003 : p.pairType === 'stable' ? 0.0005 : 0.002
  return reserveIn > 0 ? (amount * price * (1 - fee) * reserveIn) / (reserveIn + amount) : 0
}

async function simulatePath(path: Path, amountMicro: string): Promise<Quote | null> {
  const legs: Leg[] = []
  let offer = amountMicro
  let keep = 1
  for (let i = 0; i < path.pools.length; i++) {
    const pool = path.pools[i]
    const s = await simulateSwap(pool.contract_addr, { info: path.tokens[i].info, amount: offer })
    if (!s || !(Number(s.return_amount) > 0)) return null
    legs.push({
      pool, offer: path.tokens[i], ask: path.tokens[i + 1], offerMicro: offer,
      returnMicro: s.return_amount, spreadMicro: s.spread_amount, commissionMicro: s.commission_amount,
    })
    keep *= 1 - Number(s.spread_amount) / Math.max(1, Number(s.return_amount) + Number(s.spread_amount))
    offer = s.return_amount
  }
  return { legs, outMicro: offer, impactPct: (1 - keep) * 100 }
}

export interface SplitPart {
  quote: Quote
  /** share of the input amount, 0..1 */
  share: number
}

export interface Quotes {
  /** the best single path, by what reaches the wallet */
  best: Quote | null
  /** the best path that stays on this site's own pools, for the comparison */
  home: Quote | null
  /** two paths that share no pool, when splitting the amount between them delivers more than `best` (asked for with split) */
  split: SplitPart[] | null
  /** the best path through one or two pools, which is what paths through three pools and splitting are measured against (tradeMemo) */
  short: Quote | null
  /** the input amount these quotes are for, smallest units */
  amountMicro: string
}

/**
 * Rank every path cheaply, simulate the best few exactly, return the winner.
 * `slip` is the slippage the trade will be signed with: a route signed as
 * separate swaps delivers a little less than it quotes (planRoute), and that is
 * what the ranking compares.
 */
export async function quoteBest(pools: PoolView[], from: KnownToken, to: KnownToken, amountMicro: string, home?: Venue, opts: { slip?: number; split?: boolean; threeHop?: boolean } = {}): Promise<Quotes> {
  const none: Quotes = { best: null, home: null, split: null, short: null, amountMicro }
  if (!amountMicro || amountMicro === '0') return none
  const slip = opts.slip ?? 0.01
  const amount = Number(amountMicro) / 10 ** from.decimals
  const rank = (ps: Path[]) => ps
    .map(path => ({ path, est: path.pools.reduce((x, p, i) => estimateHop(p, path.tokens[i], x), amount) }))
    .sort((a, b) => b.est - a.est)
  const short = rank(paths(pools, from, to))
  // threeHop: false keeps to one or two pools: a swap on arrival over IBC stays inside a relayer's gas, and the monthly report measures three-pool paths against it.
  const long = opts.threeHop === false ? [] : rank(paths3(pools, from, to))
  if (short.length === 0 && long.length === 0) return none
  // Three-pool paths are ranked on their own, so they add candidates instead of pushing out the best short ones.
  const pick = [...short.slice(0, SIMULATE_TOP), ...long.slice(0, SIMULATE_TOP_3HOP)].map(r => r.path)
  const homeOnly = home ? short.find(r => r.path.pools.every(p => p.venue === home))?.path : undefined
  if (homeOnly && !pick.includes(homeOnly)) pick.push(homeOnly)
  const quotes = (await Promise.all(pick.map(p => simulatePath(p, amountMicro)))).filter((q): q is Quote => q !== null)
  const delivered = (q: Quote) => BigInt(planRoute(q, slip).expectedOut)
  quotes.sort((a, b) => { const x = delivered(a), y = delivered(b); return x === y ? 0 : x > y ? -1 : 1 })
  const best = quotes[0] ?? null
  if (best) best.impactPct = await probeImpact(best)
  return {
    best,
    home: home ? quotes.find(q => q.legs.every(l => l.pool.venue === home)) ?? null : null,
    split: best && opts.split ? await bestSplit(quotes, amountMicro, slip) : null,
    short: quotes.find(q => q.legs.length <= 2) ?? null,
    amountMicro,
  }
}

const pathOf = (q: Quote): Path => ({ pools: q.legs.map(l => l.pool), tokens: [q.legs[0].offer, ...q.legs.map(l => l.ask)] })

/**
 * Price impact as the trade feels it: the rate for the whole amount against
 * the rate for a thousandth of it through the same pools, so the fees cancel.
 * A concentrated pool's simulation reports almost no spread even when the
 * trade moves it: on 2026-09-14 $5,000 of wBTC to USDC read 0.00% from the
 * spread and delivered 3.2% less per wBTC than a small trade, $50,000 22%.
 * Falls back to the spread estimate when the thousandth rounds to nothing.
 */
async function probeImpact(q: Quote): Promise<number> {
  const inMicro = BigInt(q.legs[0].offerMicro)
  const sliver = inMicro / BigInt(1000)
  if (sliver < BigInt(1000)) return q.impactPct
  const probe = await simulatePath(pathOf(q), sliver.toString())
  if (!probe) return q.impactPct
  const full = Number(q.outMicro) / Number(inMicro)
  const small = Number(probe.outMicro) / Number(sliver)
  return small > 0 ? Math.max(0, (1 - full / small) * 100) : q.impactPct
}

/**
 * The amount split over the best path and the best other path that shares no
 * pool with it. Even a deep pool moves against a large trade, and two paths
 * that each move less can deliver more than one that moves a lot. The share is
 * searched on the pools' own simulations, coarse then fine. Null unless the
 * split beats the best single path by SPLIT_MIN_GAIN_BP.
 */
async function bestSplit(quotes: Quote[], amountMicro: string, slip: number): Promise<SplitPart[] | null> {
  const a = quotes[0]
  if (!a || a.impactPct < SPLIT_MIN_IMPACT_PCT) return null
  const used = new Set(a.legs.map(l => l.pool.contract_addr))
  const b = quotes.slice(1).find(q => q.legs.every(l => !used.has(l.pool.contract_addr)))
  if (!b) return null
  const total = BigInt(amountMicro)
  const single = BigInt(planRoute(a, slip).expectedOut)
  const found: { best: { parts: SplitPart[]; out: bigint; per: number } | null } = { best: null }
  const tried = new Set<number>()
  const consider = async (share: number) => {
    const per = Math.round(share * 1000)
    if (per <= 0 || per >= 1000 || tried.has(per)) return
    tried.add(per)
    const aMicro = (total * BigInt(per)) / BigInt(1000)
    const bMicro = total - aMicro
    if (aMicro === BigInt(0) || bMicro === BigInt(0)) return
    const [qa, qb] = await Promise.all([simulatePath(pathOf(a), aMicro.toString()), simulatePath(pathOf(b), bMicro.toString())])
    if (!qa || !qb) return
    const out = BigInt(planRoute(qa, slip).expectedOut) + BigInt(planRoute(qb, slip).expectedOut)
    if (!found.best || out > found.best.out) found.best = { parts: [{ quote: qa, share: per / 1000 }, { quote: qb, share: 1 - per / 1000 }], out, per }
  }
  await Promise.all([0.9, 0.75, 0.6, 0.45, 0.3].map(consider))
  if (found.best) { const s = found.best.per / 1000; await Promise.all([s - 0.075, s + 0.075].map(consider)) }
  const win = found.best
  if (!win || win.out * BigInt(10_000) < single * BigInt(10_000 + SPLIT_MIN_GAIN_BP)) return null
  await Promise.all(win.parts.map(async p => { p.quote.impactPct = await probeImpact(p.quote) }))
  return [...win.parts].sort((x, y) => y.share - x.share)
}

const shave = (x: bigint, slip: number) => (x * BigInt(Math.round((1 - slip) * 10_000))) / BigInt(10_000)

/** Every pool on the route sits on a factory Terra Swap's router trusts. */
const routerReaches = (q: Quote) => q.legs.every(l => ROUTER_VENUES.includes(l.pool.venue))

/**
 * A route as separate swap messages. The first leg offers the full amount;
 * each later leg offers the least the leg before it can return, so it is
 * always paid out of that return and never out of tokens already in the
 * wallet. If a leg lands past its limit, the whole transaction reverts. When
 * every leg lands on its quote, what a leg returns above the next leg's offer
 * (about the slippage setting, per intermediate token) stays in the wallet;
 * planRoute reports it, and avoids it wherever the router can be used.
 */
export function executionLegs(q: Quote, slip: number): ExecLeg[] {
  const out: ExecLeg[] = []
  let prev: bigint | null = null
  for (const l of q.legs) {
    const offer: bigint = prev === null ? BigInt(l.offerMicro) : prev
    const expected: bigint = (BigInt(l.returnMicro) * offer) / BigInt(l.offerMicro)
    const commission: bigint = (BigInt(l.commissionMicro) * offer) / BigInt(l.offerMicro)
    const { limitReturn, floor } = priceLimit(l.pool.pairType, expected, commission, slip, l.pool.venue)
    out.push({
      pair: l.pool.contract_addr, venue: l.pool.venue, offerInfo: l.offer.info, askInfo: l.ask.info, offerAmount: offer.toString(),
      expectedReturn: expected.toString(), limitReturn: limitReturn.toString(), minReturn: floor.toString(),
    })
    prev = floor
  }
  return out
}

export interface RoutePlan {
  /**
   * 'router': one message through Astroport's router. 'multi': one message through Terra Swap's router,
   * which reaches both factories. 'legs': one swap message per leg (executionLegs).
   */
  kind: 'router' | 'multi' | 'legs'
  legs: ExecLeg[]
  /** what reaches the wallet when every pool trades at its quote, smallest units of the output token */
  expectedOut: string
  /** the least the transaction lets through */
  minOut: string
  /** intermediate tokens a 'legs' route leaves in the wallet at its quote */
  leftover: { token: KnownToken; micro: string }[]
}

/**
 * How a quote gets signed.
 *
 * Separate swap messages cannot hand one swap's actual return to the next, so
 * a multi-leg route signed that way leaves a slippage-sized slice of each
 * intermediate token in the wallet and delivers that much less of the output
 * than the quote (found in the 2026-09-13 audit). A router can: two or more
 * Astroport pools go through Astroport's, and a route that touches Terra
 * Swap's pools goes through Terra Swap's own (contracts/router) when it is on
 * chain. Both deliver the quote and check one minimum on what arrives. Without
 * Terra Swap's router, or with a Skeleton Swap pool on the route (a factory the
 * router does not trust), the route stays as legs and says what it leaves behind.
 */
export function planRoute(q: Quote, slip: number): RoutePlan {
  const legs = executionLegs(q, slip)
  const all = { expectedOut: q.outMicro, minOut: shave(BigInt(q.outMicro), slip).toString(), leftover: [] }
  if (q.legs.length > 1 && q.legs.every(l => l.pool.venue === 'astroport')) return { kind: 'router', legs, ...all }
  if (q.legs.length > 1 && TERRA_SWAP_ROUTER && routerReaches(q)) return { kind: 'multi', legs, ...all }
  const leftover = legs.slice(0, -1)
    .map((l, i) => ({ token: q.legs[i].ask, micro: (BigInt(l.expectedReturn) - BigInt(legs[i + 1].offerAmount)).toString() }))
    .filter(x => BigInt(x.micro) > BigInt(0))
  const last = legs[legs.length - 1]
  return { kind: 'legs', legs, expectedOut: last.expectedReturn, minOut: last.minReturn, leftover }
}

/** "SOLID → LUNA (Terra Swap) → USDC (Astroport)" */
export function routeText(q: Quote): string {
  return [q.legs[0].offer.label, ...q.legs.map(l => `${l.ask.label} (${VENUE_NAME[l.pool.venue]})`)].join(' → ')
}

export interface TradePlan {
  /** one part for a single path, two for a split, each signed the way planRoute decides */
  parts: (SplitPart & { plan: RoutePlan })[]
  expectedOut: string
  /** the sum of the parts' minimums; each part enforces its own */
  minOut: string
  leftover: { token: KnownToken; micro: string }[]
  /** price impact weighted by what each part delivers, % */
  impactPct: number
}

/**
 * A single path or a split, as it gets signed. In a split, a part through one
 * pool also goes through Terra Swap's router: each part still carries its own
 * minimum, and every trade the routing improved then passes through a router,
 * where the monthly report can find it on chain.
 */
export function planTrade(parts: SplitPart[], slip: number): TradePlan {
  const planned = parts.map(p => ({
    ...p,
    plan: (parts.length > 1 && p.quote.legs.length === 1 ? routerPlan(p.quote, slip) : null) ?? planRoute(p.quote, slip),
  }))
  const sum = (pick: (x: (typeof planned)[number]) => string) => planned.reduce((s, x) => s + BigInt(pick(x)), BigInt(0)).toString()
  const out = planned.reduce((s, x) => s + Number(x.plan.expectedOut), 0)
  return {
    parts: planned,
    expectedOut: sum(x => x.plan.expectedOut),
    minOut: sum(x => x.plan.minOut),
    leftover: planned.flatMap(x => x.plan.leftover),
    impactPct: out > 0 ? planned.reduce((s, x) => s + x.quote.impactPct * Number(x.plan.expectedOut), 0) / out : 0,
  }
}

/**
 * The memo a trade is signed with: the kind of trade, what it was quoted, and
 * what the routing added over the best path through one or two pools, as in
 * "split swap (quote 4923.246400 USDC, +1.03% vs 2 pools)". It is public on
 * chain, so a wallet's history and the monthly report can set what was quoted
 * beside what arrived. The report reads it back with the same pattern.
 */
export function tradeMemo(trade: TradePlan, short: Quote | null, slip: number, to: KnownToken): string {
  const kind = trade.parts.length > 1 ? 'split swap' : trade.parts[0].quote.legs.length > 1 ? 'routed swap' : 'swap'
  const quote = `quote ${(Number(trade.expectedOut) / 10 ** to.decimals).toFixed(Math.min(6, to.decimals))} ${to.label}`
  const base = short ? Number(planRoute(short, slip).expectedOut) : 0
  const gain = base > 0 ? (Number(trade.expectedOut) / base - 1) * 100 : null
  return `${kind} (${quote}${gain != null ? `, ${gain >= 0 ? '+' : ''}${gain.toFixed(2)}% vs 2 pools` : ''})`
}

/** A memo written by tradeMemo, read back. Null for any other memo. */
export function readTradeMemo(memo: string): { kind: string; quote: number; label: string; gainPct: number | null } | null {
  const m = /(split swap|routed swap|swap) \(quote ([\d.]+) ([^,)\s]+)(?:, ([+-][\d.]+)% vs 2 pools)?\)/.exec(memo)
  return m ? { kind: m[1], quote: Number(m[2]), label: m[3], gainPct: m[4] != null ? Number(m[4]) : null } : null
}

/** "70% LUNA → ampLUNA (Astroport) → USDC (Astroport) · 30% LUNA → USDC (Astroport)" */
export function tradeText(parts: SplitPart[]): string {
  if (parts.length === 1) return routeText(parts[0].quote)
  // Round the first share and give the rest to the second, so the two always add up to 100.
  const first = Math.round(parts[0].share * 100)
  return parts.map((p, i) => `${i === 0 ? first : 100 - first}% ${routeText(p.quote)}`).join(' · ')
}

// ─── Receiving an exact amount ──────────────────────────────────

export interface ExactOut {
  /** what to pay, smallest units of the input token */
  amountMicro: string
  quotes: Quotes
  trade: TradePlan
}

/**
 * The least input found that makes a swap deliver at least `wantMicro`, for
 * "receive exactly". What is matched is the trade's minimum, the least the
 * signed transaction lets arrive at `slip`, so the wanted amount arrives even
 * when the price moves as far as the slippage allows; when the price holds, a
 * little more arrives. A first amount comes from the pools' prices; each quote
 * over the full routing (split included) then scales it by how far its
 * minimum fell short or overshot, until the minimum sits within 0.3% above the
 * wanted amount. Price impact only ever slows the output, so the steps close in
 * from one side and settle in two to four quotes.
 */
export async function quoteExactOut(pools: PoolView[], from: KnownToken, to: KnownToken, wantMicro: string, home?: Venue, opts: { slip?: number } = {}): Promise<ExactOut | null> {
  const slip = opts.slip ?? 0.01
  const want = BigInt(/^\d+$/.test(wantMicro) ? wantMicro : '0')
  if (want <= BigInt(0) || sameAsset(from.info, to.info)) return null
  // The pools' own prices for a sliver, along the best path the ranking knows: a starting point, not a quote.
  const sliver = 1e-6
  const rate = [...paths(pools, from, to), ...paths3(pools, from, to)]
    .reduce((best, path) => Math.max(best, path.pools.reduce((x, p, i) => estimateHop(p, path.tokens[i], x), sliver) / sliver), 0)
  if (!(rate > 0)) return null
  const first = ((Number(want) / 10 ** to.decimals) / rate / (1 - slip)) * 1.003
  let guess = BigInt(toMicro(first.toFixed(Math.min(from.decimals, 18)), from.decimals) ?? '0')
  if (guess <= BigInt(0)) guess = BigInt(1)
  let best: ExactOut | null = null
  for (let i = 0; i < 6; i++) {
    const quotes = await quoteBest(pools, from, to, guess.toString(), home, { slip, split: true })
    if (!quotes.best) break
    const trade = planTrade(quotes.split ?? [{ quote: quotes.best, share: 1 }], slip)
    const min = BigInt(trade.minOut)
    if (min >= want && (!best || guess < BigInt(best.amountMicro))) best = { amountMicro: guess.toString(), quotes, trade }
    if (min >= want && min * BigInt(1000) <= want * BigInt(1003)) break
    const next = min > BigInt(0) ? (guess * want * BigInt(1001)) / (min * BigInt(1000)) : guess * BigInt(2)
    guess = next === guess ? guess + BigInt(1) : next
  }
  return best
}

// ─── Closing a gap in one transaction ───────────────────────────

export interface Loop {
  quote: Quote
  inMicro: string
  /** what the loop returns when every pool trades at its quote, signed the way planRoute signs it */
  expectedOutMicro: string
  /** the least it returns if every leg slips to its limit */
  worstOutMicro: string
  worstGainMicro: string
}

/**
 * Buy the cheap side in the drifted pool, sell it straight back through the
 * best path that does not touch that pool, and end in the token you started
 * with. Tries a few sizes around the size that closes the gap and keeps the
 * one with the best worst case. Returns null unless even the worst case ends
 * ahead of where it started.
 */
export async function quoteLoop(pools: PoolView[], drifted: PoolView, start: KnownToken, optimalMicro: string, slip: number): Promise<Loop | null> {
  const mid = otherSide(drifted, start)
  if (!mid) return null
  const others = pools.filter(p => p.contract_addr !== drifted.contract_addr)
  let best: Loop | null = null
  for (const f of [1, 0.6, 0.3]) {
    const inMicro = ((BigInt(optimalMicro) * BigInt(Math.round(f * 1000))) / BigInt(1000)).toString()
    if (inMicro === '0') continue
    const s = await simulateSwap(drifted.contract_addr, { info: start.info, amount: inMicro })
    if (!s || !(Number(s.return_amount) > 0)) continue
    const back = await quoteBest(others, mid, start, s.return_amount)
    if (!back.best) continue
    const first: Leg = {
      pool: drifted, offer: start, ask: mid, offerMicro: inMicro,
      returnMicro: s.return_amount, spreadMicro: s.spread_amount, commissionMicro: s.commission_amount,
    }
    const quote: Quote = { legs: [first, ...back.best.legs], outMicro: back.best.outMicro, impactPct: 0 }
    const plan = planRoute(quote, slip)
    const worst = BigInt(plan.minOut)
    const gain = worst - BigInt(inMicro)
    if (!best || gain > BigInt(best.worstGainMicro)) {
      best = { quote, inMicro, expectedOutMicro: plan.expectedOut, worstOutMicro: worst.toString(), worstGainMicro: gain.toString() }
    }
  }
  return best && BigInt(best.worstGainMicro) > BigInt(0) ? best : null
}

// ─── Zapping through the deeper market ──────────────────────────

export interface RoutedZap {
  swap: Quote
  /** how the swap is signed (planRoute): through a router whenever it crosses more than one pool */
  plan: RoutePlan
  /** the deposited token kept back from the swap and provided, smallest units */
  keepMicro: string
  /** the other side provided: the least the swap lets through, smallest units */
  getMicro: string
  impactPct: number
}

/**
 * Zapping into a thin pool by swapping inside it moves that pool against you
 * (10.8% on a $50 pool, reported 2026-09-12). Buying the other side through
 * the best path elsewhere and depositing both avoids that. With k the pool's
 * out-per-in ratio and p the outside out-per-in price, swapping
 *   s = X · k / (k + p)
 * leaves two sides that match the pool. The swap is signed the way planRoute
 * signs any route, so a path through several pools goes through a router and
 * leaves no intermediate token behind. The deposit uses the swap's minimum and
 * the matching share of what was kept, so it never asks for more than the
 * wallet holds; what the swap returns above its minimum stays in the wallet.
 */
export async function planRoutedZap(pools: PoolView[], target: PoolView, inIdx: 0 | 1, xMicro: string, slip: number): Promise<RoutedZap | null> {
  const tIn = target.tokens[inIdx], tOut = target.tokens[inIdx === 0 ? 1 : 0]
  const others = pools.filter(p => p.contract_addr !== target.contract_addr)
  const rIn = Number(target.reserves[inIdx]) / 10 ** tIn.decimals
  const rOut = Number(target.reserves[inIdx === 0 ? 1 : 0]) / 10 ** tOut.decimals
  if (!(rIn > 0) || !(rOut > 0) || !xMicro || xMicro === '0') return null
  const k = rOut / rIn
  const probeMicro = (BigInt(xMicro) / BigInt(2)).toString()
  const probe = await quoteBest(others, tIn, tOut, probeMicro)
  if (!probe.best) return null
  const p = (Number(probe.best.outMicro) / 10 ** tOut.decimals) / (Number(probeMicro) / 10 ** tIn.decimals)
  if (!(p > 0)) return null
  const x = Number(xMicro) / 10 ** tIn.decimals
  const swapMicro = toMicro(((x * k) / (k + p)).toFixed(Math.min(tIn.decimals, 8)), tIn.decimals)
  if (!swapMicro || swapMicro === '0' || BigInt(swapMicro) >= BigInt(xMicro)) return null
  const q = await quoteBest(others, tIn, tOut, swapMicro, undefined, { slip })
  if (!q.best) return null
  const plan = planRoute(q.best, slip)
  const get = BigInt(plan.minOut)
  const matching = BigInt(Math.max(0, Math.floor(((Number(get) / 10 ** tOut.decimals) / k) * 10 ** tIn.decimals)))
  const kept = BigInt(xMicro) - BigInt(swapMicro)
  const keep = matching < kept ? matching : kept
  if (keep === BigInt(0) || get === BigInt(0)) return null
  return { swap: q.best, plan, keepMicro: keep.toString(), getMicro: get.toString(), impactPct: q.best.impactPct }
}

// ─── One contract call ──────────────────────────────────────────

/**
 * A quote as a single call to Terra Swap's router, whatever its length, for a
 * swap that has to be one contract call: a deposit swapped on arrival over IBC
 * runs as the router's own execute (lib/msgs arrivalSwapMsg). The router
 * checks the minimum on what reaches the receiver. Null when there is no router,
 * or when a pool on the route sits on a factory the router does not trust.
 */
export function routerPlan(q: Quote, slip: number): RoutePlan | null {
  if (!TERRA_SWAP_ROUTER || !routerReaches(q)) return null
  return { kind: 'multi', legs: executionLegs(q, slip), expectedOut: q.outMicro, minOut: shave(BigInt(q.outMicro), slip).toString(), leftover: [] }
}
