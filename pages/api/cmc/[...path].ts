/**
 * Terra Swap's own pools in the shape of CoinMarketCap's exchange API
 * standard (lib/markets):
 *
 *   /api/cmc/summary
 *   /api/cmc/assets
 *   /api/cmc/ticker
 *   /api/cmc/orderbook/<market_pair>?depth=100
 *   /api/cmc/trades/<market_pair>
 *
 * A market pair is the base and quote id joined by "_"; ids that hold a slash
 * (ibc/…, factory/…) are read back whole. Pools are constant-product, so the
 * order book is the curve.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { TOKEN_META } from 'lib/tokenMeta'
import { curveBook, dec, findMarket, readMarkets } from 'lib/markets'

export const config = { maxDuration: 60 }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const parts = Array.isArray(req.query.path) ? req.query.path : [String(req.query.path ?? '')]
  const [endpoint, ...rest] = parts
  let markets
  try { markets = await readMarkets() } catch { return res.status(503).json({ error: 'the chain did not answer, try again in a moment' }) }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')

  if (endpoint === 'summary') {
    return res.status(200).json(markets.map(m => ({
      trading_pairs: m.tickerId, base_currency: m.baseId, quote_currency: m.quoteId,
      last_price: dec(m.last), lowest_ask: dec(m.ask), highest_bid: dec(m.bid),
      base_volume: dec(m.baseVolume), quote_volume: dec(m.quoteVolume),
      price_change_percent_24h: m.change24hPct != null ? dec(m.change24hPct) : '0',
      highest_price_24h: dec(m.high), lowest_price_24h: dec(m.low),
    })))
  }
  if (endpoint === 'assets') {
    const out: Record<string, { name: string; symbol: string; can_withdraw: boolean; can_deposit: boolean; min_withdraw: string }> = {}
    for (const m of markets) for (const t of [m.base, m.quote]) {
      const id = t === m.base ? m.baseId : m.quoteId
      out[id] = { name: TOKEN_META[t.key]?.name ?? t.label, symbol: t.label, can_withdraw: true, can_deposit: true, min_withdraw: '0' }
    }
    return res.status(200).json(out)
  }
  if (endpoint === 'ticker') {
    return res.status(200).json(Object.fromEntries(markets.map(m => [m.tickerId, {
      base_id: m.baseId, quote_id: m.quoteId, last_price: dec(m.last), base_volume: dec(m.baseVolume), quote_volume: dec(m.quoteVolume), isFrozen: 0,
    }])))
  }
  const m = findMarket(markets, rest.join('/'))
  if (endpoint === 'orderbook') {
    if (!m) return res.status(404).json({ error: 'unknown market_pair' })
    const depth = Number(req.query.depth ?? 100)
    const perSide = depth > 0 ? Math.min(250, Math.max(1, Math.ceil(depth / 2))) : 250
    return res.status(200).json({ timestamp: Date.now(), ...curveBook(m, perSide) })
  }
  if (endpoint === 'trades') {
    if (!m) return res.status(404).json({ error: 'unknown market_pair' })
    const since = Math.floor(Date.now() / 1000) - 86_400
    return res.status(200).json(m.trades.filter(t => t.time >= since).map(t => ({
      trade_id: t.id, price: dec(t.price), base_volume: dec(t.base), quote_volume: dec(t.quote), timestamp: t.time * 1000, type: t.type,
    })))
  }
  return res.status(404).json({ error: 'endpoints: summary, assets, ticker, orderbook/<market_pair>, trades/<market_pair>' })
}
