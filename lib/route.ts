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
 * A route made only of Astroport's pools goes through Astroport's router, which
 * carries each swap's full return into the next and checks one minimum at the
 * end. A route through Terra Swap's pools, which that router cannot reach, is
 * signed as consecutive swaps in one transaction, each with its own price
 * limit. Either way, if anything falls short the whole transaction reverts.
 */

import {
  assetId, priceLimit, sameAsset, simulateSwap, toMicro, VENUE_NAME,
  type KnownToken, type PoolView, type Venue,
} from 'lib/dex'

/** Pools under this much liquidity are never routed through. */
const MIN_TVL_USD = 5
/** Paths simulated exactly per quote, on top of the best home-only one. */
const SIMULATE_TOP = 3

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
  /** price impact compounded across legs, % */
  impactPct: number
}

/** What actually gets signed for one leg. */
export interface ExecLeg {
  pair: string
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
  return out
}

/** Every token reachable from `from` in one or two hops. */
export function reachable(pools: PoolView[], from: KnownToken, tokens: KnownToken[]): KnownToken[] {
  return tokens.filter(t => !sameAsset(t.info, from.info) && paths(pools, from, t).length > 0)
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

const byOutDesc = (a: Quote, b: Quote) => {
  const x = BigInt(a.outMicro), y = BigInt(b.outMicro)
  return x === y ? 0 : x > y ? -1 : 1
}

export interface Quotes {
  best: Quote | null
  /** the best path that stays on this site's own pools, for the comparison */
  home: Quote | null
}

/** Rank every path cheaply, simulate the best few exactly, return the winner. */
export async function quoteBest(pools: PoolView[], from: KnownToken, to: KnownToken, amountMicro: string, home?: Venue): Promise<Quotes> {
  if (!amountMicro || amountMicro === '0') return { best: null, home: null }
  const all = paths(pools, from, to)
  if (all.length === 0) return { best: null, home: null }
  const amount = Number(amountMicro) / 10 ** from.decimals
  const ranked = all
    .map(path => ({ path, est: path.pools.reduce((x, p, i) => estimateHop(p, path.tokens[i], x), amount) }))
    .sort((a, b) => b.est - a.est)
  const pick = ranked.slice(0, SIMULATE_TOP).map(r => r.path)
  const homeOnly = home ? ranked.find(r => r.path.pools.every(p => p.venue === home))?.path : undefined
  if (homeOnly && !pick.includes(homeOnly)) pick.push(homeOnly)
  const quotes = (await Promise.all(pick.map(p => simulatePath(p, amountMicro)))).filter((q): q is Quote => q !== null)
  quotes.sort(byOutDesc)
  return {
    best: quotes[0] ?? null,
    home: home ? quotes.find(q => q.legs.every(l => l.pool.venue === home)) ?? null : null,
  }
}

const shave = (x: bigint, slip: number) => (x * BigInt(Math.round((1 - slip) * 10_000))) / BigInt(10_000)

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
    const { limitReturn, floor } = priceLimit(l.pool.pairType, expected, commission, slip)
    out.push({
      pair: l.pool.contract_addr, offerInfo: l.offer.info, askInfo: l.ask.info, offerAmount: offer.toString(),
      expectedReturn: expected.toString(), limitReturn: limitReturn.toString(), minReturn: floor.toString(),
    })
    prev = floor
  }
  return out
}

/**
 * The least a route returns if it succeeds with every leg at its limit. A
 * leg that would return less than the next leg offers makes the whole
 * transaction revert instead.
 */
export function worstCaseOut(q: Quote, slip: number): string {
  const legs = executionLegs(q, slip)
  return legs[legs.length - 1].minReturn
}

export interface RoutePlan {
  /** 'router': one message through Astroport's router. 'legs': one swap message per leg (executionLegs). */
  kind: 'router' | 'legs'
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
 * than the quote (found in the 2026-09-13 audit). Astroport's router can: two
 * or more Astroport pools go through it, deliver the quote, and check one
 * minimum on what arrives. Routes that touch Terra Swap's pools stay as legs
 * and say what they leave behind.
 */
export function planRoute(q: Quote, slip: number): RoutePlan {
  const legs = executionLegs(q, slip)
  if (q.legs.length > 1 && q.legs.every(l => l.pool.venue === 'astroport')) {
    return { kind: 'router', legs, expectedOut: q.outMicro, minOut: shave(BigInt(q.outMicro), slip).toString(), leftover: [] }
  }
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
  /** the deposited token kept back from the swap and provided, smallest units */
  keepMicro: string
  /** the other side provided: the swap's worst case, smallest units */
  getMicro: string
  impactPct: number
}

/**
 * Zapping into a thin pool by swapping inside it moves that pool against you
 * (10.8% on a $50 pool, reported 2026-09-12). Buying the other side through
 * the best path elsewhere and depositing both avoids that. With k the pool's
 * out-per-in ratio and p the outside out-per-in price, swapping
 *   s = X · k / (k + p)
 * leaves two sides that match the pool. The deposit uses the swap's worst
 * case and the matching share of what was kept, so it never asks for more
 * than the wallet holds; any remainder stays in the wallet.
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
  const q = await quoteBest(others, tIn, tOut, swapMicro)
  if (!q.best) return null
  const get = BigInt(worstCaseOut(q.best, slip))
  const matching = BigInt(Math.max(0, Math.floor(((Number(get) / 10 ** tOut.decimals) / k) * 10 ** tIn.decimals)))
  const kept = BigInt(xMicro) - BigInt(swapMicro)
  const keep = matching < kept ? matching : kept
  if (keep === BigInt(0) || get === BigInt(0)) return null
  return { swap: q.best, keepMicro: keep.toString(), getMicro: get.toString(), impactPct: q.best.impactPct }
}
