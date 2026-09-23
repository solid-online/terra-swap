/**
 * Every pool a swap can go through, built on the server: both sites' pools
 * (lib/sitePools) and Skeleton Swap's (lib/skeleton), valued at the same market
 * reference. For the quote API, so a quote routes the way the swap page does.
 * The other server routes keep to lib/sitePools. Both scans come from the
 * pool-scan workflow (lib/scanPlan); the list is kept a minute per instance.
 */

import { annotateValues, type PoolView } from 'lib/dex'
import { skeletonScan } from 'lib/poolScans'
import { sitePools } from 'lib/sitePools'
import { swappable } from 'lib/skeleton'

const FRESH_MS = 60_000
let mem: { at: number; pools: PoolView[] } | null = null
let inflight: Promise<PoolView[]> | null = null

async function build(): Promise<PoolView[]> {
  // A copy: the scan is shared with /api/dex-skeleton, which values it at the market reference alone.
  const [site, skeleton] = await Promise.all([sitePools(), skeletonScan().then(s => structuredClone(swappable(s.pools))).catch(() => [] as PoolView[])])
  annotateValues(skeleton, site.px)
  return [...site.pools, ...skeleton]
}

export async function routingPools(): Promise<PoolView[]> {
  if (mem && Date.now() - mem.at < FRESH_MS) return mem.pools
  if (!inflight) inflight = build().finally(() => { inflight = null })
  const pools = await inflight
  if (pools.length > 0) mem = { at: Date.now(), pools }
  return pools
}
