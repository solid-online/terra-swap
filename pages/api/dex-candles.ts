/**
 * GET /api/dex-candles?pair=<addr>&interval=1h|4h|1d — OHLC + volume candles
 * for one pool from the site's own record (lib/priceHistory). Price is quote
 * per base (base = the pair's first asset); volume is quote-token whole units.
 *
 * The record is written every ten minutes by /api/price-record, so candles go
 * back to the day recording began and deepen over time; there is no external
 * feed and no deep backfill.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { assetId, isDexLive, knownPairs, queryPairs, queryPairsOf, tokenFor, AWAY_VENUE, VENUE_FACTORY } from 'lib/dex'
import { poolCandles, isCandleInterval, type Candle, type CandleInterval } from 'lib/priceHistory'
import { withCpu } from 'lib/cpuLog'

export interface CandlesResponse {
  pair: string
  interval: CandleInterval
  base: string
  quote: string
  candles: Candle[]
  since: string | null
  at: number
}

async function handler(req: NextApiRequest, res: NextApiResponse<CandlesResponse | { error: string }>) {
  const pair = String(req.query.pair || '')
  const interval: CandleInterval = isCandleInterval(req.query.interval) ? req.query.interval : '1h'
  const empty: CandlesResponse = { pair, interval, base: '', quote: '', candles: [], since: null, at: Date.now() }
  if (!isDexLive() || !pair) return res.status(200).json(empty)

  // Confirm the pair and learn its token labels; either site's pool, like the price tape.
  const meta = (await queryPairs()).find(p => p.contract_addr === pair)
    ?? knownPairs(await queryPairsOf(VENUE_FACTORY[AWAY_VENUE])).find(p => p.contract_addr === pair)
  if (!meta) return res.status(200).json(empty)

  try {
    const { candles, since } = await poolCandles(pair, interval)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({
      pair, interval,
      base: tokenFor(meta.asset_infos[0]).label,
      quote: tokenFor(meta.asset_infos[1]).label,
      candles, since, at: Date.now(),
    })
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(empty)
  }
}

export default withCpu('api/dex-candles', handler)
