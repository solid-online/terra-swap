/**
 * Terra Swap's own pools as a market listing, in the shapes CoinGecko's and
 * CoinMarketCap's integration specs ask for, built from the chain.
 *
 * Only pools on Terra Swap's own factory, and only those whose two tokens this
 * site lists. A route through Astroport's pools is trading on Astroport, which
 * lists its own markets; counting it here would count it twice.
 *
 * Trades come from the ledger (lib/dex-ledger), which keeps every swap on the
 * factory's pools with its block height. A trade's time is placed between
 * block headers read for the purpose (now, a day back, a week back), which
 * puts it within about a minute of its block.
 *
 * Every pool on the factory is a constant-product (xyk) pool with a 0.3% fee.
 * It has no orders; the "order book" below is the curve itself, the amount of
 * the base token it fills between one price and the next.
 */

import { KNOWN_TOKENS, NOBLE_USDC, assetId, type KnownToken, type PoolView } from 'lib/dex'
import { getLedger, type DexEvent } from 'lib/dex-ledger'
import { lcdFetch } from 'lib/lcd'
import { dayAverages, poolPricesAt, recordingSince, utcDay } from 'lib/priceHistory'
import { sitePools } from 'lib/sitePools'

export const POOL_FEE = 0.003
const DAY_S = 86_400
const TOKEN_BY_ID = new Map(KNOWN_TOKENS.map(t => [assetId(t.info), t]))

// ─── When a block happened ──────────────────────────────────────

/** [height, unix ms], newest first */
type Sample = [number, number]
let clock: { at: number; samples: Sample[] } | null = null

async function header(which: string): Promise<Sample | null> {
  try {
    const r = await lcdFetch(`/cosmos/base/tendermint/v1beta1/blocks/${which}`, { timeoutMs: 8000 })
    if (!r.ok) return null
    const h = (await r.json())?.block?.header
    return h?.height && h?.time ? [Number(h.height), Date.parse(h.time)] : null
  } catch { return null }
}

/** Block headers now, a day back and a week back, read at most every ten minutes. Public endpoints keep about a week of headers. */
export async function readClock(): Promise<Sample[]> {
  if (clock && Date.now() - clock.at < 600_000) return clock.samples
  const latest = await header('latest')
  if (!latest) return clock?.samples ?? []
  const back = await Promise.all([14_400, 100_800].map(d => header(String(latest[0] - d))))
  clock = { at: Date.now(), samples: [latest, ...back.filter((s): s is Sample => s !== null)] }
  return clock.samples
}

/** Unix ms of a height, on the line through the two samples around it, or through the oldest two beyond them. About six seconds a block with one sample. */
export function timeOfHeight(samples: Sample[], h: number): number {
  if (samples.length === 0) return 0
  if (samples.length === 1) return samples[0][1] - (samples[0][0] - h) * 6000
  for (let i = 0; i < samples.length - 1; i++) {
    const [h1, t1] = samples[i], [h2, t2] = samples[i + 1]
    if (h >= h2 || i === samples.length - 2) return t2 + ((h - h2) * (t1 - t2)) / (h1 - h2)
  }
  return 0
}

// ─── Markets ────────────────────────────────────────────────────

export interface Trade {
  /** unique per pool: height × 1000 + its order within the block */
  id: number
  height: number
  /** unix seconds */
  time: number
  tx: string
  /** from the base token's side: 'buy' when base left the pool */
  type: 'buy' | 'sell'
  /** quote per base */
  price: number
  base: number
  quote: number
}

export interface Market {
  pool: PoolView
  /** base id and quote id joined by "_": denoms and contract addresses, as a DEX listing wants */
  tickerId: string
  base: KnownToken
  quote: KnownToken
  baseId: string
  quoteId: string
  /** the pool's spot price, quote per base */
  last: number
  /** what a sliver fetches selling into the pool, and costs buying from it, after the fee */
  bid: number
  ask: number
  high: number
  low: number
  baseVolume: number
  quoteVolume: number
  liquidityUsd: number | null
  /** every trade the ledger holds, newest first */
  trades: Trade[]
  change24hPct: number | null
}

function tradesOf(pool: PoolView, events: DexEvent[], samples: Sample[]): Trade[] {
  const [b, q] = pool.tokens
  const bid = assetId(b.info), qid = assetId(q.info)
  const swaps = events
    .filter(e => e.action === 'swap' && e.contract === pool.contract_addr && e.swap)
    .sort((x, y) => x.height - y.height || (x.txhash < y.txhash ? -1 : x.txhash > y.txhash ? 1 : 0))
  const out: Trade[] = []
  let lastH = -1, n = 0
  for (const e of swaps) {
    const s = e.swap!
    const off = Number(s.offerAmount), ret = Number(s.returnAmount)
    if (!(off > 0) || !(ret > 0)) continue
    let type: Trade['type'], base: number, quote: number
    if (s.offer === bid && s.ask === qid) { type = 'sell'; base = off / 10 ** b.decimals; quote = ret / 10 ** q.decimals }
    else if (s.offer === qid && s.ask === bid) { type = 'buy'; base = ret / 10 ** b.decimals; quote = off / 10 ** q.decimals }
    else continue
    n = e.height === lastH ? n + 1 : 0
    lastH = e.height
    out.push({ id: e.height * 1000 + n, height: e.height, time: Math.floor(timeOfHeight(samples, e.height) / 1000), tx: e.txhash, type, price: quote / base, base, quote })
  }
  return out.reverse()
}

async function build(): Promise<Market[]> {
  const [{ pools }, ledger, samples, dayAgo] = await Promise.all([
    sitePools(), getLedger(), readClock(), poolPricesAt(Date.now() - DAY_S * 1000).catch(() => ({} as Record<string, number>)),
  ])
  const events = Object.values(ledger.events)
  const nowS = Math.floor(Date.now() / 1000)
  return pools
    .filter(p => p.venue === 'terraswap' && !p.empty && p.pairType === 'xyk' && p.price > 0 && p.tokens.every(t => TOKEN_BY_ID.has(assetId(t.info))))
    .map(p => {
      const trades = tradesOf(p, events, samples)
      const day = trades.filter(t => t.time >= nowS - DAY_S)
      const prices = day.map(t => t.price)
      const was = dayAgo[p.contract_addr]
      const baseId = assetId(p.tokens[0].info), quoteId = assetId(p.tokens[1].info)
      return {
        pool: p, tickerId: `${baseId}_${quoteId}`, base: TOKEN_BY_ID.get(baseId)!, quote: TOKEN_BY_ID.get(quoteId)!, baseId, quoteId,
        last: p.price, bid: p.price * (1 - POOL_FEE), ask: p.price / (1 - POOL_FEE),
        high: Math.max(p.price, ...prices), low: Math.min(p.price, ...prices),
        baseVolume: day.reduce((s, t) => s + t.base, 0), quoteVolume: day.reduce((s, t) => s + t.quote, 0),
        liquidityUsd: p.tvlUsd ?? null, trades, change24hPct: was > 0 ? (p.price / was - 1) * 100 : null,
      }
    })
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
}

let cache: { at: number; markets: Market[] } | null = null
let inflight: Promise<Market[]> | null = null

/** Every market, kept for a minute per server. */
export async function readMarkets(): Promise<Market[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.markets
  if (!inflight) inflight = build().finally(() => { inflight = null })
  const markets = await inflight
  if (markets.length > 0) cache = { at: Date.now(), markets }
  return cache?.markets ?? markets
}

/** A market by its ticker id, its pool contract, or its two tickers ("LUNA_USDC"). */
export function findMarket(markets: Market[], id: string): Market | undefined {
  return markets.find(m => m.tickerId === id || m.pool.contract_addr === id || `${m.base.key}_${m.quote.key}`.toLowerCase() === id.toLowerCase())
}

/** A decimal as a plain string, about twelve significant figures, never in exponent notation. */
export function dec(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const places = Math.max(0, Math.min(18, 11 - Math.floor(Math.log10(Math.abs(n)))))
  const s = n.toFixed(places)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * The curve as order-book levels, `levels` a side, `stepPct` apart: at each
 * price, the base token the pool gives up (asks) or takes in (bids) between the
 * level before and this one, with the fee on the price.
 */
export function curveBook(m: Market, levels = 50, stepPct = 0.2): { bids: [string, string][]; asks: [string, string][] } {
  const [b, q] = m.pool.tokens
  const x = Number(m.pool.reserves[0]) / 10 ** b.decimals
  const y = Number(m.pool.reserves[1]) / 10 ** q.decimals
  if (!(x > 0) || !(y > 0)) return { bids: [], asks: [] }
  const k = x * y, p0 = y / x, step = stepPct / 100
  const baseAt = (p: number) => Math.sqrt(k / p)
  const asks: [string, string][] = [], bids: [string, string][] = []
  for (let i = 1; i <= levels; i++) {
    const a0 = p0 * (1 + step * (i - 1)), a1 = p0 * (1 + step * i)
    asks.push([dec(a1 / (1 - POOL_FEE)), dec(baseAt(a0) - baseAt(a1))])
    const b0 = p0 * (1 - step * (i - 1)), b1 = p0 * (1 - step * i)
    if (b1 > 0) bids.push([dec(b1 * (1 - POOL_FEE)), dec(baseAt(b1) - baseAt(b0))])
  }
  return { bids, asks }
}

// ─── Volume, for DefiLlama ──────────────────────────────────────

export interface VolumeResponse {
  /** unix seconds, start inclusive, end exclusive */
  start: number
  end: number
  volumeUsd: number
  /** 0.3% of volume, all of it paid to liquidity providers */
  feesUsd: number
  swaps: number
  /** swaps in the window with neither token priced that day; not counted in volume */
  unpriced: number
  /** the first day prices were written down; swaps before it have no price to be valued at */
  since: string | null
}

/**
 * Dollar volume through Terra Swap's own pools between two times. Each swap is
 * valued at its UTC day's average recorded price (lib/priceHistory) on one
 * side: USDC from Noble when it is a side, otherwise the side paid in, then
 * the side received. A swap on a day with no recorded price is counted as
 * unpriced, not guessed.
 */
export async function volumeBetween(startS: number, endS: number): Promise<VolumeResponse> {
  const [ledger, samples, since] = await Promise.all([getLedger(), readClock(), recordingSince()])
  const inWindow: { e: DexEvent; day: string }[] = []
  for (const e of Object.values(ledger.events)) {
    if (e.action !== 'swap' || !e.swap) continue
    const t = timeOfHeight(samples, e.height)
    if (t >= startS * 1000 && t < endS * 1000) inWindow.push({ e, day: utcDay(t) })
  }
  const days = Array.from(new Set(inWindow.map(x => x.day)))
  const averages = new Map(await Promise.all(days.map(async d => [d, await dayAverages(d)] as const)))
  let volumeUsd = 0, unpriced = 0
  for (const { e, day } of inWindow) {
    const s = e.swap!
    const legs = [{ id: s.offer, amount: s.offerAmount }, { id: s.ask, amount: s.returnAmount }]
    const avg = averages.get(day)
    const valued = [legs.find(l => l.id === NOBLE_USDC), ...legs].map(l => {
      if (!l) return null
      const t = TOKEN_BY_ID.get(l.id)
      const price = l.id === NOBLE_USDC ? 1 : t && avg ? avg[t.key] : undefined
      return t && price && price > 0 ? (Number(l.amount) / 10 ** t.decimals) * price : null
    }).find(v => v != null)
    if (valued == null) unpriced++
    else volumeUsd += valued
  }
  return { start: startS, end: endS, volumeUsd, feesUsd: volumeUsd * POOL_FEE, swaps: inWindow.length, unpriced, since }
}
