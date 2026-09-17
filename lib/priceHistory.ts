/**
 * Prices over time, written down by this site itself.
 *
 * Nothing we can read back keeps a price history for these tokens and pools,
 * so the site keeps its own: every ten minutes the market reference for each
 * listed token (lib/sitePools: Astroport's deepest pools, filled in from the
 * pools where they have no price), and once an hour the price of every pool
 * with liquidity on both factories. Something outside calls
 * /api/price-record on that rhythm (the uptime workflow does); a slot that is
 * already written is left alone, so a second call in the same ten minutes
 * writes nothing.
 *
 * One KV value per UTC day keeps it cheap: two commands per recording, and a
 * month of one token is two MGETs. A chart starts on the day recording began.
 * Nothing before that is filled in, and a gap stays a gap.
 */

import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY, KNOWN_TOKENS, assetId, type PoolView } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const PREFIX = `atrium:dex:hist:v1:${DEX_FACTORY}`
/** Seconds per token slot; 144 a day. */
export const STEP_S = 600
const SLOTS_PER_HOUR = 3600 / STEP_S
/** Pools under this much liquidity are not written down: their price says little and moves on a sneeze. */
const MIN_POOL_USD = 50
const KEEP_S = 400 * 86_400
const DAY_MS = 86_400_000

/**
 * One UTC day. Token prices in US dollars per 10-minute slot, pool prices
 * (token 1 per token 0) per hour. Missing slots are null.
 *
 * `ps` and `pvs` were added for candlesticks: the pool's price and the quote-
 * side volume traded, both per 10-minute slot, so a 1-hour candle has six
 * samples to open/high/low/close over. They start on the day recording of them
 * began; older days have only the hourly `p` and no volume, which the candle
 * builder falls back to.
 */
export interface DayRecord {
  day: string
  t: Record<string, (number | null)[]>
  p: Record<string, (number | null)[]>
  /** pool price (token 1 per token 0) per 10-minute slot */
  ps?: Record<string, (number | null)[]>
  /** quote-side volume traded in each 10-minute slot, in the quote token's whole units */
  pvs?: Record<string, (number | null)[]>
}

export type Range = '1d' | '7d' | '30d' | '90d'
export const RANGES: Range[] = ['1d', '7d', '30d', '90d']
const RANGE_DAYS: Record<Range, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }
/** Seconds between the points a range returns: every slot for a day, then coarser, so every range is a few hundred points. */
const RANGE_STEP_S: Record<Range, number> = { '1d': 600, '7d': 1800, '30d': 3600, '90d': 3 * 3600 }

const mem = (() => {
  const g = globalThis as unknown as { __terraSwapHist?: Map<string, unknown> }
  g.__terraSwapHist ??= new Map()
  return g.__terraSwapHist
})()

const dayKey = (day: string) => `${PREFIX}:${day}`
const SINCE_KEY = `${PREFIX}:since`
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`)
const sig = (n: number) => Number(n.toPrecision(6))

async function readDays(days: string[]): Promise<(DayRecord | null)[]> {
  if (!HAS_KV) return days.map(d => (mem.get(dayKey(d)) as DayRecord | undefined) ?? null)
  const out: (DayRecord | null)[] = []
  for (let i = 0; i < days.length; i += 15) {
    const chunk = days.slice(i, i + 15)
    const got = await vercelKv.mget<(DayRecord | null)[]>(...chunk.map(dayKey))
    out.push(...chunk.map((_, k) => got?.[k] ?? null))
  }
  return out
}

async function writeDay(rec: DayRecord): Promise<void> {
  if (HAS_KV) await vercelKv.set(dayKey(rec.day), rec, { ex: KEEP_S })
  else mem.set(dayKey(rec.day), rec)
}

/** The first day anything was written down, or null before the first recording. */
export async function recordingSince(): Promise<string | null> {
  if (!HAS_KV) return (mem.get(SINCE_KEY) as string | undefined) ?? null
  return (await vercelKv.get<string>(SINCE_KEY)) ?? null
}

const slotOf = (now: number) => {
  const day = utcDay(now)
  return { day, slot: Math.floor((now - dayStart(day)) / (STEP_S * 1000)) }
}

/** Whether this ten-minute slot already holds prices, without building anything. */
export async function slotRecorded(now = Date.now()): Promise<boolean> {
  const { day, slot } = slotOf(now)
  const rec = (await readDays([day]))[0]
  return !!rec && Object.values(rec.t).some(a => a?.[slot] != null)
}

export interface RecordResult { recorded: boolean; day: string; slot: number; tokens: number; pools: number }

/**
 * Write one slot: `px` is US dollars per whole token keyed by asset id, `pools` both sites' pools with prices.
 * A slot already written stays as it is.
 */
export async function recordPrices(px: Record<string, number>, pools: PoolView[], vol: Record<string, number> = {}, now = Date.now()): Promise<RecordResult> {
  const { day, slot } = slotOf(now)
  const hour = Math.floor(slot / SLOTS_PER_HOUR)
  const rec: DayRecord = (await readDays([day]))[0] ?? { day, t: {}, p: {} }
  rec.ps ??= {}; rec.pvs ??= {}
  const none = { recorded: false, day, slot, tokens: 0, pools: 0 }
  if (Object.values(rec.t).some(a => a?.[slot] != null)) return none
  let tokens = 0, written = 0
  for (const t of KNOWN_TOKENS) {
    const v = px[assetId(t.info)]
    if (!(v > 0) || !Number.isFinite(v)) continue
    const arr = rec.t[t.key] ?? (rec.t[t.key] = [])
    arr[slot] = sig(v)
    tokens++
  }
  // Nothing priced means the market read failed, not that every token is worth nothing.
  if (tokens === 0) return none
  for (const p of pools) {
    if (p.empty || !(p.price > 0) || !Number.isFinite(p.price) || (p.tvlUsd ?? 0) < MIN_POOL_USD) continue
    const arr = rec.p[p.contract_addr] ?? (rec.p[p.contract_addr] = [])
    if (arr[hour] == null) { arr[hour] = sig(p.price); written++ }
    // Per-slot price and volume for the candlesticks; volume defaults to 0 for a slot with no trades.
    const ps = rec.ps[p.contract_addr] ?? (rec.ps[p.contract_addr] = [])
    ps[slot] = sig(p.price)
    const v = vol[p.contract_addr]
    const pvs = rec.pvs[p.contract_addr] ?? (rec.pvs[p.contract_addr] = [])
    pvs[slot] = Number.isFinite(v) && v > 0 ? sig(v) : 0
  }
  // Arrays with holes serialize as null, which is what a missing slot is.
  const fill = (m: Record<string, (number | null)[]>) => Object.fromEntries(Object.entries(m).map(([k, a]) => [k, Array.from(a, v => v ?? null)]))
  const clean: DayRecord = { day, t: fill(rec.t), p: fill(rec.p), ps: fill(rec.ps), pvs: fill(rec.pvs) }
  await writeDay(clean)
  if (HAS_KV) await vercelKv.set(SINCE_KEY, day, { nx: true })
  else if (!mem.has(SINCE_KEY)) mem.set(SINCE_KEY, day)
  return { recorded: true, day, slot, tokens, pools: written }
}

/** [unix ms, value] */
export type Point = [number, number]

function daysCovering(from: number, to: number): string[] {
  const out: string[] = []
  for (let t = dayStart(utcDay(from)); t <= to; t += DAY_MS) out.push(utcDay(t))
  return out
}

/** Keep the last value in each bucket of `stepS` seconds: a closing price per bucket. */
function bucket(points: Point[], stepS: number): Point[] {
  const out: Point[] = []
  const step = stepS * 1000
  for (const pt of points) {
    const b = Math.floor(pt[0] / step)
    const last = out[out.length - 1]
    if (last && Math.floor(last[0] / step) === b) out[out.length - 1] = pt
    else out.push(pt)
  }
  return out
}

function slots(rec: DayRecord | null, arr: (number | null)[] | undefined, stepMs: number): Point[] {
  if (!rec || !arr) return []
  const start = dayStart(rec.day)
  const out: Point[] = []
  arr.forEach((v, i) => { if (v != null && v > 0) out.push([start + i * stepMs, v]) })
  return out
}

export interface Series {
  range: Range
  points: Point[]
  /** for a pool: the market reference for the same pair, token 1 per token 0 from the two tokens' dollar prices */
  market?: Point[]
  /** the first day anything was written down */
  since: string | null
  at: number
}

/** A token's dollar price over `range`, oldest first. */
export async function tokenSeries(key: string, range: Range, now = Date.now()): Promise<Series> {
  const from = now - RANGE_DAYS[range] * DAY_MS
  const days = daysCovering(from, now)
  const [recs, since] = await Promise.all([readDays(days), recordingSince()])
  const all = recs.flatMap(r => slots(r, r?.t[key], STEP_S * 1000)).filter(p => p[0] >= from && p[0] <= now)
  return { range, points: bucket(all, RANGE_STEP_S[range]), since, at: Date.now() }
}

/**
 * A pool's own price over `range`, hourly, beside the market for the same pair.
 * `base` and `quote` are the pool's token keys, in pool order.
 */
export async function poolSeries(addr: string, base: string, quote: string, range: Range, now = Date.now()): Promise<Series> {
  const from = now - RANGE_DAYS[range] * DAY_MS
  const days = daysCovering(from, now)
  const [recs, since] = await Promise.all([readDays(days), recordingSince()])
  const step = Math.max(3600, RANGE_STEP_S[range])
  const points = bucket(recs.flatMap(r => slots(r, r?.p[addr], 3600_000)).filter(p => p[0] >= from && p[0] <= now), step)
  const market: Point[] = []
  for (const r of recs) {
    const a = r?.t[base], b = r?.t[quote]
    if (!r || !a || !b) continue
    const start = dayStart(r.day)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const pa = a[i], pb = b[i]
      const t = start + i * STEP_S * 1000
      if (pa != null && pb != null && pb > 0 && t >= from && t <= now) market.push([t, sig(pa / pb)])
    }
  }
  return { range, points, market: bucket(market, step), since, at: Date.now() }
}

/** Every recorded pool's price in the hour holding `ms`, or the hour before it when that one is not written yet. */
export async function poolPricesAt(ms: number): Promise<Record<string, number>> {
  const { day, slot } = slotOf(ms)
  const hour = Math.floor(slot / SLOTS_PER_HOUR)
  const rec = (await readDays([day]))[0]
  const out: Record<string, number> = {}
  for (const [addr, arr] of Object.entries(rec?.p ?? {})) {
    const v = arr[hour] ?? (hour > 0 ? arr[hour - 1] : null)
    if (v != null && v > 0) out[addr] = v
  }
  return out
}

/** A token's average dollar price over one UTC day, from what was written down that day. Null when nothing was. */
export async function dayAverages(day: string): Promise<Record<string, number> | null> {
  const rec = (await readDays([day]))[0]
  if (!rec) return null
  const out: Record<string, number> = {}
  for (const [key, arr] of Object.entries(rec.t)) {
    const vals = arr.filter((v): v is number => v != null && v > 0)
    if (vals.length) out[key] = vals.reduce((s, v) => s + v, 0) / vals.length
  }
  return Object.keys(out).length ? out : null
}

export const isRange = (v: unknown): v is Range => typeof v === 'string' && (RANGES as string[]).includes(v)

// ── Candlesticks ──────────────────────────────────────────────────────────

export type CandleInterval = '1h' | '4h' | '1d'
export const CANDLE_INTERVALS: CandleInterval[] = ['1h', '4h', '1d']
const INTERVAL_S: Record<CandleInterval, number> = { '1h': 3600, '4h': 4 * 3600, '1d': 86_400 }
/** How far back each interval looks, so every view is a few dozen to a few hundred candles. */
const INTERVAL_DAYS: Record<CandleInterval, number> = { '1h': 14, '4h': 60, '1d': 200 }
export const isCandleInterval = (v: unknown): v is CandleInterval => typeof v === 'string' && (CANDLE_INTERVALS as string[]).includes(v)

/** One candle: time is the bucket's start in unix seconds; volume is quote-token whole units. */
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Candles {
  interval: CandleInterval
  candles: Candle[]
  since: string | null
  at: number
}

/** A pool's price per 10-minute slot with the volume traded in it, oldest first, from the record. */
function poolTicks(recs: (DayRecord | null)[], addr: string): { t: number; p: number; v: number }[] {
  const out: { t: number; p: number; v: number }[] = []
  for (const r of recs) {
    if (!r) continue
    const start = dayStart(r.day)
    const perSlot = r.ps?.[addr]
    if (perSlot) {
      perSlot.forEach((p, i) => { if (p != null && p > 0) out.push({ t: start + i * STEP_S * 1000, p, v: r.pvs?.[addr]?.[i] ?? 0 }) })
    } else {
      // A day recorded before per-slot pool data: fall back to the hourly price, no volume.
      (r.p?.[addr] ?? []).forEach((p, h) => { if (p != null && p > 0) out.push({ t: start + h * 3600_000, p, v: 0 }) })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/** OHLC + volume candles for one pool over `interval`, oldest first. */
export async function poolCandles(addr: string, interval: CandleInterval, now = Date.now()): Promise<Candles> {
  const from = now - INTERVAL_DAYS[interval] * DAY_MS
  const days = daysCovering(from, now)
  const [recs, since] = await Promise.all([readDays(days), recordingSince()])
  const ticks = poolTicks(recs, addr).filter(t => t.t >= from && t.t <= now)
  const stepMs = INTERVAL_S[interval] * 1000
  const byBucket = new Map<number, Candle>()
  for (const tk of ticks) {
    const bucket = Math.floor(tk.t / stepMs) * INTERVAL_S[interval]
    const c = byBucket.get(bucket)
    if (!c) byBucket.set(bucket, { t: bucket, o: tk.p, h: tk.p, l: tk.p, c: tk.p, v: tk.v })
    else { c.h = Math.max(c.h, tk.p); c.l = Math.min(c.l, tk.p); c.c = tk.p; c.v += tk.v }
  }
  const candles = Array.from(byBucket.values()).sort((a, b) => a.t - b.t)
  return { interval, candles, since, at: Date.now() }
}
