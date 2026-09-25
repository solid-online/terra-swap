/**
 * GET /api/price-history — prices this site has written down (lib/priceHistory).
 *
 *   ?token=LUNA&range=7d                       a token's dollar price
 *   ?pool=terra1…&base=LUNA&quote=USDC&range=30d   a pool's own price, token 1 per token 0,
 *                                              beside the market for the same pair
 *
 * Ranges: 1d, 7d, 30d, 90d. Points are [unix ms, value], oldest first. Open to
 * any origin; it is the site's own record of public prices.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { fromBech32 } from '@cosmjs/encoding'
import { KNOWN_TOKENS } from 'lib/dex'
import { isRange, poolSeries, tokenSeries, type Series } from 'lib/priceHistory'

const known = (v: unknown) => (typeof v === 'string' ? KNOWN_TOKENS.find(t => t.key === v)?.key : undefined)
const contract = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 90) return null
  try { const { prefix, data } = fromBech32(v); return prefix === 'terra' && data.length === 32 ? v : null } catch { return null }
}

async function handler(req: NextApiRequest, res: NextApiResponse<Series | { error: string }>) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const range = isRange(req.query.range) ? req.query.range : '7d'
  try {
    if (req.query.pool !== undefined) {
      const addr = contract(req.query.pool), base = known(req.query.base), quote = known(req.query.quote)
      if (!addr || !base || !quote) return res.status(400).json({ error: 'pool must be a pool contract, and base and quote its two listed tokens in pool order' })
      const body = await poolSeries(addr, base, quote, range)
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      return res.status(200).json(body)
    }
    const key = known(req.query.token)
    if (!key) return res.status(400).json({ error: 'token must be a listed ticker, for example LUNA' })
    const body = await tokenSeries(key, range)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
    return res.status(200).json(body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({ error: 'the store did not answer, try again in a moment' })
  }
}

export default withCpu('price-history', handler)
