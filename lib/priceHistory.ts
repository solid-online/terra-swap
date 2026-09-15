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

/** One UTC day. Token prices in US dollars per 10-minute slot, pool prices (token 1 per token 0) per hour. Missing slots are null. */
export interface DayRecord {
  day: string
  t: Record<string, (number | null)[]>
  p: Record<string, (number | null)[]>
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
export async function recordPrices(px: Record<string, number>, pools: PoolView[], now = Date.now()): Promise<RecordResult> {
  const { day, slot } = slotOf(now)
  const hour = Math.floor(slot / SLOTS_PER_HOUR)
  const rec: DayRecord = (await readDays([day]))[0] ?? { day, t: {}, p: {} }
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
  }
  // Arrays with holes serialize as null, which is what a missing slot is.
  const clean: DayRecord = {
    day,
    t: Object.fromEntries(Object.entries(rec.t).map(([k, a]) => [k, Array.from(a, v => v ?? null)])),
    p: Object.fromEntries(Object.entries(rec.p).map(([k, a]) => [k, Array.from(a, v => v ?? null)])),
  }
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
