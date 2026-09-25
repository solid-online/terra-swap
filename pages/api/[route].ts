/**
 * Every one-segment API route of this site, in one function.
 *
 * Why (2026-09-25): Vercel runs each file under pages/api as its own function.
 * With this site's traffic most of them went cold between requests, and a cold
 * start cost 300 to 600 ms of CPU before any work, several times the work
 * itself. Openfields is on Vercel's Hobby plan, which allows 4 CPU-hours a
 * month for every site together. In one function, the pool-scan handover
 * (about once a minute) keeps it warm for everyone.
 *
 * The handlers live in lib/api, one file each, and are written as ordinary
 * Next API routes. Their own `config` exports no longer apply: this function
 * reads bodies itself (the handover is gzipped) and allows 60 seconds.
 * Routes under a folder (cmc, coingecko, og) are still their own files.
 */

import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { BadBody, readJsonBody } from 'lib/jsonBody'
import depth from 'lib/api/depth'
import dexArcade from 'lib/api/dex-arcade'
import dexCandles from 'lib/api/dex-candles'
import dexHolders from 'lib/api/dex-holders'
import dexLeaderboard from 'lib/api/dex-leaderboard'
import dexMarket from 'lib/api/dex-market'
import dexPrices from 'lib/api/dex-prices'
import dexSkeleton from 'lib/api/dex-skeleton'
import dexTrades from 'lib/api/dex-trades'
import dexVenue from 'lib/api/dex-venue'
import dex from 'lib/api/dex'
import geo from 'lib/api/geo'
import history from 'lib/api/history'
import lst from 'lib/api/lst'
import poolFees from 'lib/api/pool-fees'
import poolScans from 'lib/api/pool-scans'
import positions from 'lib/api/positions'
import predict from 'lib/api/predict'
import priceHistory from 'lib/api/price-history'
import priceRecord from 'lib/api/price-record'
import pushCheck from 'lib/api/push-check'
import push from 'lib/api/push'
import quote from 'lib/api/quote'
import stats from 'lib/api/stats'
import tokenCheck from 'lib/api/token-check'
import volume from 'lib/api/volume'

export const config = { api: { bodyParser: false }, maxDuration: 60 }

/** `json`: the route reads req.body, which Next's body parser used to fill (it is off here). */
const ROUTES: Record<string, { handler: NextApiHandler; json?: boolean }> = {
  depth: { handler: depth },
  'dex-arcade': { handler: dexArcade, json: true },
  'dex-candles': { handler: dexCandles },
  'dex-holders': { handler: dexHolders },
  'dex-leaderboard': { handler: dexLeaderboard },
  'dex-market': { handler: dexMarket },
  'dex-prices': { handler: dexPrices },
  'dex-skeleton': { handler: dexSkeleton },
  'dex-trades': { handler: dexTrades },
  'dex-venue': { handler: dexVenue },
  dex: { handler: dex },
  geo: { handler: geo },
  history: { handler: history },
  lst: { handler: lst },
  'pool-fees': { handler: poolFees },
  // Reads its own body after checking the token, gzipped or not.
  'pool-scans': { handler: poolScans },
  positions: { handler: positions },
  predict: { handler: predict },
  'price-history': { handler: priceHistory },
  'price-record': { handler: priceRecord },
  'push-check': { handler: pushCheck },
  push: { handler: push, json: true },
  quote: { handler: quote },
  stats: { handler: stats },
  'token-check': { handler: tokenCheck },
  volume: { handler: volume },
}

const timed: Record<string, NextApiHandler> = Object.fromEntries(Object.entries(ROUTES).map(([name, r]) => [name, withCpu(name, r.handler)]))

/** What Next's body parser allowed by default. */
const JSON_LIMIT = 1_000_000

export default async function api(req: NextApiRequest, res: NextApiResponse) {
  const name = String(req.query.route ?? '')
  const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : undefined
  if (!route) return res.status(404).json({ error: 'no such endpoint' })
  // The handlers see their own query, as they did as separate files.
  delete req.query.route
  if (route.json && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    try {
      req.body = await readJsonBody(req, JSON_LIMIT)
    } catch (e) {
      return res.status(400).json({ error: e instanceof BadBody ? `the body is ${e.message}` : 'the body could not be read' })
    }
  }
  return timed[name](req, res)
}
