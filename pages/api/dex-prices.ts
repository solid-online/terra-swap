/**
 * GET /api/dex-prices?pair=<addr> — recent execution-price series for
 * one pool, reconstructed from the chain.
 *
 * There is no external price feed for these pools, so the chain is the source:
 * every Astroport swap emits `offer_asset / ask_asset / offer_amount /
 * return_amount` in its wasm event. We read those, normalise each trade to a
 * single orientation (quote per base, base = the pair's first asset), and
 * return the series oldest-first. The frontend flips it for the direction the
 * user is looking at and appends the live reserve spot as the last point.
 *
 * Cached per pair for a minute — the scan is the cost, the merge is cheap.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import { isDexLive, queryPairs, assetId, tokenFor, type AssetInfo } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const LCD = process.env.NEXT_PUBLIC_LCD || 'https://terra-lcd.publicnode.com'
const UA = 'Mozilla/5.0 atrium-dex-prices'
const CACHE_MS = 60_000
/** Chart shows the most recent trades only, so a skewed opening print on a
 *  thin pool ages out instead of pinning the curve. */
const MAX_TICKS = 20

export interface PricePoint { h: number; p: number }
/** One line of the tape: side is from the base asset's point of view. */
export interface TapeRow { h: number; tx: string; side: 'buy' | 'sell'; base: number; quote: number }
export interface PricesResponse {
  pair: string
  /** quote-per-base (base = asset_infos[0]); oldest first */
  points: PricePoint[]
  baseId: string
  quoteId: string
  trades: number
  /** summed quote-side notional across the returned window (display units) */
  volumeQuote: number
  /** most recent trades, newest first */
  tape: TapeRow[]
}

interface TxResp {
  height: string
  txhash: string
  events: { type: string; attributes: { key: string; value: string }[] }[]
}

const memCache = new Map<string, { at: number; body: PricesResponse }>()

/** All wasm swap events on this pair, normalised to quote-per-base, oldest→newest. */
async function scanPrices(pair: string, base: AssetInfo, quote: AssetInfo): Promise<{ points: PricePoint[]; volumeQuote: number; tape: TapeRow[] }> {
  const q = encodeURIComponent(`wasm._contract_address='${pair}'`)
  const url = `${LCD}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=100`
  let rs: TxResp[]
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return { points: [], volumeQuote: 0, tape: [] }
    rs = (await r.json())?.tx_responses ?? []
  } catch { return { points: [], volumeQuote: 0, tape: [] } }

  const baseId = assetId(base), quoteId = assetId(quote)
  const bd = 10 ** tokenFor(base).decimals, qd = 10 ** tokenFor(quote).decimals
  const out: PricePoint[] = []
  const tape: TapeRow[] = []
  let vol = 0
  for (const tx of rs) {
    for (const ev of tx.events) {
      if (ev.type !== 'wasm') continue
      const a = Object.fromEntries(ev.attributes.map(x => [x.key, x.value]))
      if (a.action !== 'swap' || a._contract_address !== pair) continue
      const offer = a.offer_asset, ask = a.ask_asset
      const offAmt = Number(a.offer_amount), retAmt = Number(a.return_amount)
      if (!offer || !ask || !(offAmt > 0) || !(retAmt > 0)) continue
      // Normalise to quote-per-base regardless of which way the trade went.
      // Everything in display units so 8-decimal wBTC prices like the rest.
      let p: number, quoteNotional: number, row: TapeRow
      if (offer === baseId && ask === quoteId) {          // sold base for quote
        const b = offAmt / bd, q = retAmt / qd
        p = q / b; quoteNotional = q
        row = { h: Number(tx.height), tx: tx.txhash, side: 'sell', base: b, quote: q }
      } else if (offer === quoteId && ask === baseId) {   // bought base with quote
        const b = retAmt / bd, q = offAmt / qd
        p = q / b; quoteNotional = q
        row = { h: Number(tx.height), tx: tx.txhash, side: 'buy', base: b, quote: q }
      } else continue
      if (Number.isFinite(p) && p > 0) { out.push({ h: Number(tx.height), p }); vol += quoteNotional; tape.push(row) }
    }
  }
  // Scanned newest-first. Keep only the most recent trades, then flip to
  // oldest-first for the chart — so a single skewed opening print on a thin
  // new pool scrolls off instead of dominating the whole curve forever.
  return { points: out.slice(0, MAX_TICKS).reverse(), volumeQuote: vol, tape: tape.slice(0, 8) }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<PricesResponse | { error: string }>) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')
  const pair = String(req.query.pair || '')
  if (!isDexLive() || !pair) return res.status(200).json({ pair, points: [], baseId: '', quoteId: '', trades: 0, volumeQuote: 0, tape: [] })

  const cached = HAS_KV
    ? await vercelKv.get<{ at: number; body: PricesResponse }>(`atrium:dex:px:${pair}`)
    : memCache.get(pair)
  if (cached && Date.now() - cached.at < CACHE_MS) return res.status(200).json(cached.body)

  // Confirm the pair belongs to our factory and learn its asset order.
  const pairs = await queryPairs()
  const meta = pairs.find(p => p.contract_addr === pair)
  if (!meta) return res.status(200).json({ pair, points: [], baseId: '', quoteId: '', trades: 0, volumeQuote: 0, tape: [] })

  const base = meta.asset_infos[0], quote = meta.asset_infos[1]
  const { points, volumeQuote, tape } = await scanPrices(pair, base, quote)
  const body: PricesResponse = { pair, points, baseId: assetId(base), quoteId: assetId(quote), trades: points.length, volumeQuote, tape }
  const snap = { at: Date.now(), body }
  if (HAS_KV) await vercelKv.set(`atrium:dex:px:${pair}`, snap, { ex: 180 }); else memCache.set(pair, snap)

  return res.status(200).json(body)
}
