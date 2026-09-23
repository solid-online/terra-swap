/**
 * GET /api/predict — every market, the contract's config, the spot
 * price of each pair, and the running TWAP of markets that are averaging.
 * One round trip for the page; the chain is read directly, nothing is stored.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  isPredictLive, PREDICT_CONTRACT, queryConfig, queryMarkets, querySpot, queryTwapNow,
  type Market, type PredictConfig, type TwapNow,
} from 'lib/predict'

export interface PredictResponse {
  live: boolean
  contract: string
  now: number
  config: PredictConfig | null
  markets: Market[]
  /** display-unit spot per pair address */
  spot: Record<string, number>
  /** running TWAP per market id, for markets with an observation and no resolution */
  twap: Record<number, TwapNow>
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<PredictResponse>) {
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
  const now = Math.floor(Date.now() / 1000)
  if (!isPredictLive()) {
    return res.status(200).json({ live: false, contract: '', now, config: null, markets: [], spot: {}, twap: {} })
  }
  const [config, markets] = await Promise.all([queryConfig(), queryMarkets()])

  const pairs = Array.from(new Set(markets.map(m => m.pair)))
  const spotEntries = await Promise.all(pairs.map(async p => {
    const m = markets.find(x => x.pair === p)!
    return [p, await querySpot(m)] as const
  }))
  const spot: Record<string, number> = {}
  for (const [p, s] of spotEntries) if (s != null) spot[p] = s

  const averaging = markets.filter(m => m.observation && !m.resolution)
  const twapEntries = await Promise.all(averaging.map(async m => [m.id, await queryTwapNow(m.id)] as const))
  const twap: Record<number, TwapNow> = {}
  for (const [id, t] of twapEntries) if (t) twap[id] = t

  return res.status(200).json({ live: true, contract: PREDICT_CONTRACT, now, config, markets, spot, twap })
}
