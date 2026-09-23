/**
 * Quote-side volume traded on a pool since the last time we looked, for the
 * candlestick bars. There is no lifetime-volume counter on these pools, so the
 * chain is the source: each Astroport swap emits offer/return amounts, and we
 * sum the quote side of every swap newer than the height we last counted.
 *
 * The uptime loop calls /api/price-record every ten minutes; this runs inside
 * it. To keep it off the chain's back it looks at only the deepest pools, a few
 * at a time, one page of swaps each, and remembers a per-pool height cursor so
 * a slot counts only that slot's trades. It never throws: a pool that does not
 * answer simply records no volume for the slot.
 */

import { kv as vercelKv } from '@vercel/kv'
import { assetId, tokenFor, type PoolView } from 'lib/dex'
import { lcdFetch } from 'lib/lcd'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const UA = 'Mozilla/5.0 atrium-volume-scan'
/** The deepest N pools get volume bars; thinner ones barely trade and are not worth a query each tick. */
const MAX_POOLS = 18
const CONCURRENCY = 3
const CURSOR_PREFIX = 'atrium:dex:vh:'

const cursorMem = (() => {
  const g = globalThis as unknown as { __terraSwapVolCursor?: Map<string, number> }
  g.__terraSwapVolCursor ??= new Map()
  return g.__terraSwapVolCursor
})()

async function getCursor(addr: string): Promise<number> {
  if (!HAS_KV) return cursorMem.get(addr) ?? 0
  return (await vercelKv.get<number>(CURSOR_PREFIX + addr).catch(() => 0)) ?? 0
}
async function setCursor(addr: string, height: number): Promise<void> {
  if (HAS_KV) await vercelKv.set(CURSOR_PREFIX + addr, height, { ex: 30 * 86_400 }).catch(() => {})
  else cursorMem.set(addr, height)
}

interface TxResp { height: string; events: { type: string; attributes: { key: string; value: string }[] }[] }

/** Quote-token volume traded on this pool above `sinceHeight`, and the newest height seen. */
async function scanPoolVolume(p: PoolView, sinceHeight: number): Promise<{ vol: number; head: number }> {
  const q = encodeURIComponent(`wasm._contract_address='${p.contract_addr}'`)
  const path = `/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=100`
  let rs: TxResp[]
  try {
    const r = await lcdFetch(path, { headers: { 'User-Agent': UA, accept: 'application/json' }, kind: 'txs', timeoutMs: 12_000 })
    if (!r.ok) return { vol: 0, head: sinceHeight }
    rs = (await r.json())?.tx_responses ?? []
  } catch { return { vol: 0, head: sinceHeight } }

  const baseId = assetId(p.tokens[0].info), quoteId = assetId(p.tokens[1].info)
  const qd = 10 ** p.tokens[1].decimals
  let vol = 0, head = sinceHeight
  for (const tx of rs) {
    const h = Number(tx.height)
    if (h > head) head = h
    if (!(h > sinceHeight)) continue // already counted in an earlier slot
    for (const ev of tx.events) {
      if (ev.type !== 'wasm') continue
      const a = Object.fromEntries(ev.attributes.map(x => [x.key, x.value]))
      if (a.action !== 'swap' || a._contract_address !== p.contract_addr) continue
      const offer = a.offer_asset, ask = a.ask_asset
      const offAmt = Number(a.offer_amount), retAmt = Number(a.return_amount)
      if (!offer || !ask || !(offAmt > 0) || !(retAmt > 0)) continue
      if (offer === baseId && ask === quoteId) vol += retAmt / qd       // sold base for quote
      else if (offer === quoteId && ask === baseId) vol += offAmt / qd  // bought base with quote
    }
  }
  return { vol, head }
}

/**
 * Quote volume per pool for this slot, keyed by contract address. Only the
 * deepest MAX_POOLS pools are scanned. The first time a pool is seen its cursor
 * is set to the current head and no volume is recorded, so a slot never carries
 * an unbounded backfill.
 */
export async function scanVolumes(pools: PoolView[]): Promise<Record<string, number>> {
  const top = volumePools(pools)
  const out: Record<string, number> = {}
  for (let i = 0; i < top.length; i += CONCURRENCY) {
    const batch = top.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async p => {
      const cursor = await getCursor(p.contract_addr)
      const { vol, head } = await scanPoolVolume(p, cursor)
      if (head > cursor) await setCursor(p.contract_addr, head)
      // First sighting (cursor 0): only anchor the cursor, do not book a giant first bar.
      if (cursor > 0 && vol > 0) out[p.contract_addr] = vol
    }))
  }
  return out
}

/** The pools that get volume bars: the deepest MAX_POOLS with liquidity. */
export function volumePools(pools: PoolView[]): PoolView[] {
  return pools
    .filter(p => !p.empty && (p.tvlUsd ?? 0) > 0)
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
    .slice(0, MAX_POOLS)
}

// ─── Cursors across machines ───────────────────────────────────────
//
// The pool-scan workflow scans volume on GitHub's machines, which have no KV.
// Before each slot it takes the site's cursors (/api/pool-scans), and it hands
// its new ones back with the slot; the site keeps them only if it wrote that
// slot. So a trade is counted once wherever the slot is scanned.

/** Start these pools from the given cursors (0 where there is none: the next scan only anchors it). */
export function setCursors(addrs: string[], c: Record<string, number>): void {
  for (const a of addrs) {
    const h = c[a]
    if (Number.isFinite(h) && h > 0) cursorMem.set(a, h)
    else cursorMem.delete(a)
  }
}

/** This process's cursors for these pools. */
export function memCursors(addrs: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of addrs) { const h = cursorMem.get(a); if (h) out[a] = h }
  return out
}

/** The stored cursors for these pools, first moved on to the given ones where those are ahead (server side, with KV). */
export async function advanceCursors(addrs: string[], given: Record<string, number> = {}): Promise<Record<string, number>> {
  if (!HAS_KV || addrs.length === 0) return {}
  const got = await vercelKv.mget<(number | null)[]>(...addrs.map(a => CURSOR_PREFIX + a)).catch(() => [] as (number | null)[])
  const out: Record<string, number> = {}
  await Promise.all(addrs.map(async (a, i) => {
    const kept = Number(got?.[i] ?? 0) || 0
    const next = Number(given[a] ?? 0) || 0
    if (next > kept) await setCursor(a, next)
    const h = Math.max(kept, next)
    if (h > 0) out[a] = h
  }))
  return out
}
