/**
 * Both sites' pools, built on the server the way /api/dex and /api/dex-venue
 * build them: live reserves, spot prices, and dollar values at the market
 * reference. For server routes that route or price (the LST board, the stats
 * page) without calling this site's own API over HTTP. Built by the pool-scan
 * workflow once a minute (lib/scanPlan), or here when that has stopped.
 */

import {
  AWAY_VENUE, VENUE_FACTORY, annotateTvl, annotateValues, knownPairs, listedPairs,
  queryPairs, queryPairsOf, queryPool, refineSpot, toPoolView, usdPrices, type PoolView,
} from 'lib/dex'
import { SCAN_PLAN } from 'lib/scanPlan'
import { shared, sharedMarketPrices, stale } from 'lib/sharedCache'

export interface SitePools {
  at: number
  /** pools with liquidity on both factories */
  pools: PoolView[]
  /** USD per whole token, keyed by asset id: the market reference, filled in from the pools where it has no price */
  px: Record<string, number>
}

export const keepSitePools = (v: SitePools): boolean => v.pools.length > 0

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

export async function sitePools(): Promise<SitePools> {
  const { key } = SCAN_PLAN.site
  const built = await shared(key, SCAN_PLAN.site, build, keepSitePools)
  if (keepSitePools(built)) return built
  return (await stale<SitePools>(key)) ?? built
}
