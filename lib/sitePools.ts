/**
 * Both sites' pools, built on the server the way /api/dex and /api/dex-venue
 * build them: live reserves, spot prices, and dollar values at the market
 * reference. For server routes that route or price (the LST board, the stats
 * page) without calling this site's own API over HTTP. Kept for a minute per
 * instance, and built once however many requests ask at the same time.
 */

import {
  AWAY_VENUE, VENUE_FACTORY, annotateTvl, annotateValues, knownPairs, listedPairs,
  queryPairs, queryPairsOf, queryPool, refineSpot, toPoolView, usdPrices, type PoolView,
} from 'lib/dex'
import { shared, sharedMarketPrices, stale } from 'lib/sharedCache'

export interface SitePools {
  at: number
  /** pools with liquidity on both factories */
  pools: PoolView[]
  /** USD per whole token, keyed by asset id: the market reference, filled in from the pools where it has no price */
  px: Record<string, number>
}

const FRESH_MS = 60_000

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
    sharedMarketPrices(),
  ])
  const pools = [...own, ...away]
  const px = { ...usdPrices(pools), ...market }
  annotateValues(pools, px)
  return { at: Date.now(), pools, px }
}

/** One build a minute for every instance together (lib/sharedCache). */
export async function sitePools(): Promise<SitePools> {
  const built = await shared('atrium:site-pools:v1', FRESH_MS, build, v => v.pools.length > 0)
  if (built.pools.length > 0) return built
  return (await stale<SitePools>('atrium:site-pools:v1')) ?? built
}
