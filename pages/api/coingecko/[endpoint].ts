/**
 * Terra Swap's own pools in the shape of CoinGecko's integration spec for a
 * DEX (lib/markets):
 *
 *   /api/coingecko/pairs
 *   /api/coingecko/tickers
 *   /api/coingecko/orderbook?ticker_id=…&depth=100
 *   /api/coingecko/historical_trades?ticker_id=…&type=buy|sell&limit=…&start_time=…&end_time=…
 *
 * Base and target are denoms and contract addresses, and ticker_id joins them
 * with "_". Pools are constant-product, so the order book is the curve.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { curveBook, dec, findMarket, readMarkets } from 'lib/markets'

export const config = { maxDuration: 60 }

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const endpoint = String(req.query.endpoint ?? '')
  let markets
  try { markets = await readMarkets() } catch { return res.status(503).json({ error: 'the chain did not answer, try again in a moment' }) }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')

  if (endpoint === 'pairs') {
    return res.status(200).json(markets.map(m => ({ ticker_id: m.tickerId, base: m.baseId, target: m.quoteId, pool_id: m.pool.contract_addr })))
  }
  if (endpoint === 'tickers') {
    return res.status(200).json(markets.map(m => ({
      ticker_id: m.tickerId, base_currency: m.baseId, target_currency: m.quoteId, pool_id: m.pool.contract_addr,
      last_price: dec(m.last), base_volume: dec(m.baseVolume), target_volume: dec(m.quoteVolume),
      liquidity_in_usd: m.liquidityUsd != null ? dec(m.liquidityUsd) : '0',
      bid: dec(m.bid), ask: dec(m.ask), high: dec(m.high), low: dec(m.low),
    })))
  }
  const m = findMarket(markets, String(req.query.ticker_id ?? ''))
  if (endpoint === 'orderbook') {
    if (!m) return res.status(404).json({ error: 'unknown ticker_id' })
    const depth = Number(req.query.depth ?? 100)
    const perSide = depth > 0 ? Math.min(250, Math.max(1, Math.ceil(depth / 2))) : 250
    return res.status(200).json({ ticker_id: m.tickerId, timestamp: Date.now(), ...curveBook(m, perSide) })
  }
  if (endpoint === 'historical_trades') {
    if (!m) return res.status(404).json({ error: 'unknown ticker_id' })
    const type = req.query.type === 'buy' || req.query.type === 'sell' ? req.query.type : null
    const start = Number(req.query.start_time ?? 0), end = Number(req.query.end_time ?? 0)
    const limit = req.query.limit === undefined ? 200 : Number(req.query.limit)
    let list = m.trades.filter(t => (!start || t.time >= start) && (!end || t.time <= end))
    if (limit > 0) list = list.slice(0, limit)
    const shape = (t: (typeof list)[number]) => ({ trade_id: t.id, price: dec(t.price), base_volume: dec(t.base), target_volume: dec(t.quote), trade_timestamp: t.time, type: t.type })
    const buy = list.filter(t => t.type === 'buy').map(shape), sell = list.filter(t => t.type === 'sell').map(shape)
    return res.status(200).json(type === 'buy' ? { buy } : type === 'sell' ? { sell } : { buy, sell })
  }
  return res.status(404).json({ error: 'endpoints: pairs, tickers, orderbook, historical_trades' })
}

export default withCpu('coingecko/[endpoint]', handler)
