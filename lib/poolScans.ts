/**
 * Every pool scan the site serves, each read through lib/sharedCache on the
 * rhythm lib/scanPlan sets. The routes call these to serve them, the pool-scan
 * workflow (scripts/pool-scans.ts) calls the same ones to build them, and
 * /api/pool-scans stores what the workflow hands over only when `keep` accepts
 * it here.
 */

import {
  AWAY_VENUE, VENUE_FACTORY, knownPairs, queryPairsOf, queryPool, toPoolView, refineSpot,
  annotateValues, usdPrices, type PoolView, type Venue,
} from 'lib/dex'
import { buildHome, keepHome, type HomeScan } from 'lib/dexHome'
import { LST_HUBS } from 'lib/lst'
import { lstBoard, type LstRow } from 'lib/lstBoard'
import { SCAN_PLAN, type ScanName } from 'lib/scanPlan'
import { keepMarket, marketScan, shared, sharedMarketPrices } from 'lib/sharedCache'
import { skeletonPools } from 'lib/skeleton'
import { keepSitePools, sitePools } from 'lib/sitePools'
import { computeStats, type StatsResponse } from 'lib/stats'

export function homeScan(): Promise<HomeScan> {
  return shared(SCAN_PLAN.home.key, SCAN_PLAN.home, async () => ({ at: Date.now(), body: await buildHome() }), keepHome)
}

// ─── The other site's pools, for routing (/api/dex-venue) ──────────

export interface VenueResponse { venue: Venue; pools: PoolView[]; at: number }
const keepVenue = (v: VenueResponse): boolean => v.pools.length > 0

async function buildVenue(): Promise<VenueResponse> {
  const pairs = knownPairs(await queryPairsOf(VENUE_FACTORY[AWAY_VENUE]))
  const views = await Promise.all(pairs.map(async p => toPoolView(p, await queryPool(p.contract_addr), AWAY_VENUE)))
  const pools = views.filter(p => !p.empty)
  await refineSpot(pools)
  // Astroport's markets set the price wherever they have one. A token they have no deep market for
  // (USDC.inj on 2026-09-14) is priced from these pools instead; without a dollar depth its pools
  // were never routed, so on the pools site USDC.inj could not be swapped at all.
  annotateValues(pools, { ...usdPrices(pools), ...(await sharedMarketPrices()) })
  return { venue: AWAY_VENUE, pools, at: Date.now() }
}

export function venueScan(): Promise<VenueResponse> {
  return shared(SCAN_PLAN.venue.key, SCAN_PLAN.venue, buildVenue, keepVenue)
}

// ─── Skeleton Swap's pools (/api/dex-skeleton) ─────────────────────

export interface SkeletonResponse { pools: PoolView[]; at: number }
const keepSkeleton = (v: SkeletonResponse): boolean => v.pools.length > 0

async function buildSkeleton(): Promise<SkeletonResponse> {
  const [pools, market] = await Promise.all([skeletonPools(), sharedMarketPrices()])
  annotateValues(pools, { ...usdPrices(pools), ...market })
  return { pools, at: Date.now() }
}

export function skeletonScan(): Promise<SkeletonResponse> {
  return shared(SCAN_PLAN.skeleton.key, SCAN_PLAN.skeleton, buildSkeleton, keepSkeleton)
}

// ─── The liquid staking board (/api/lst) ───────────────────────────

export interface LstResponse { rows: LstRow[]; at: number }
/** Every hub priced both ways at every size; a busy endpoint leaves gaps, and a reading with gaps is not kept. */
export const wholeLst = (v: LstResponse): boolean => v.rows.length === LST_HUBS.length && v.rows.every(r => r.sizes.every(s => s.sell && s.buy))

async function buildLst(): Promise<LstResponse> {
  const { pools, px } = await sitePools()
  return { rows: await lstBoard(pools, px), at: Date.now() }
}

export function lstScan(): Promise<LstResponse> {
  return shared(SCAN_PLAN.lst.key, SCAN_PLAN.lst, buildLst, wholeLst)
}

// ─── Router use and routing gains (/api/stats) ─────────────────────

export const wholeStats = (v: StatsResponse): boolean => v.router.read !== false && v.tagged.read !== false && v.benchmark.length >= 3

async function buildStats(): Promise<StatsResponse> {
  const { pools, px } = await sitePools()
  return computeStats(pools, px)
}

export function statsScan(): Promise<StatsResponse> {
  return shared(SCAN_PLAN.stats.key, SCAN_PLAN.stats, buildStats, wholeStats)
}

// ─── All of them, by name ──────────────────────────────────────────

export interface Scan {
  run: () => Promise<{ at: number }>
  /** whether a value of this scan is whole enough to store; it takes the scan's own type, which is why the argument reads `never` here */
  keep: (v: never) => boolean
}

export const SCANS: Record<ScanName, Scan> = {
  home: { run: homeScan, keep: keepHome },
  site: { run: sitePools, keep: keepSitePools },
  venue: { run: venueScan, keep: keepVenue },
  skeleton: { run: skeletonScan, keep: keepSkeleton },
  market: { run: marketScan, keep: keepMarket },
  lst: { run: lstScan, keep: wholeLst },
  stats: { run: statsScan, keep: wholeStats },
}
