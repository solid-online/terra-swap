/**
 * Both sites' pools, built on the server the way /api/dex and /api/dex-venue
 * build them: live reserves, spot prices, and dollar values at the market
 * reference. For server routes that route or price (the LST board, the stats
 * page) without calling this site's own API over HTTP. Kept for a minute per
 * instance, and built once however many requests ask at the same time.
 */

import {
  AWAY_VENUE, VENUE_FACTORY, annotateTvl, annotateValues, knownPairs, listedPairs, marketPrices,
  queryPairs, queryPairsOf, queryPool, refineSpot, toPoolView, usdPrices, type PoolView,
} from 'lib/dex'

export interface SitePools {
  at: number
  /** pools with liquidity on both factories */
  pools: PoolView[]
  /** USD per whole token, keyed by asset id: the market reference, filled in from the pools where it has no price */
  px: Record<string, number>
}

const FRESH_MS = 60_000
let mem: SitePools | null = null
let inflight: Promise<SitePools> | null = null

async function build(): Promise<SitePools> {
  const [own, away, market] = await Promise.all([
    (async () => {
      const pairs = listedPairs(await queryPairs())
      const views = await Promise.all(pairs.map(async p => toPoolView(p, await queryPool(p.contract_addr))))
      const live = views.filter(p => !p.empty)
      await refineSpot(live)
      annotateTvl(live)
      return live
    })(),
    (async () => {
      const pairs = knownPairs(await queryPairsOf(VENUE_FACTORY[AWAY_VENUE]))
      const views = await Promise.all(pairs.map(async p => toPoolView(p, await queryPool(p.contract_addr), AWAY_VENUE)))
      const live = views.filter(p => !p.empty)
      await refineSpot(live)
      return live
    })(),
    marketPrices(),
  ])
  const pools = [...own, ...away]
  const px = { ...usdPrices(pools), ...market }
  annotateValues(pools, px)
  return { at: Date.now(), pools, px }
}

export async function sitePools(): Promise<SitePools> {
  if (mem && Date.now() - mem.at < FRESH_MS) return mem
  if (!inflight) inflight = build().finally(() => { inflight = null })
  const built = await inflight
  if (built.pools.length > 0) mem = built
  return mem ?? built
}
