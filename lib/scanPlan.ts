/**
 * The pool scans, and how fresh each one has to be.
 *
 * The pool-scan workflow (.github/workflows/pool-scans.yml, which runs
 * scripts/pool-scans.ts on GitHub's machines) builds each scan every `everyMs`
 * and hands it to /api/pool-scans, which stores it in KV. The site's routes
 * only read it. A route builds a scan itself only when the stored one is older
 * than `freshMs`: the workflow has stopped, or this host runs without it (a
 * fork, local development).
 *
 * Why (2026-09-24): the scans were most of this site's Active CPU on Vercel,
 * and Openfields is moving to Vercel's Hobby plan, which allows 4 CPU-hours a
 * month for every site together. Actions minutes are free for a public
 * repository.
 */

import { DEX_FACTORY } from 'lib/dex'

export interface Freshness {
  /** how often the workflow builds it; an instance reads KV again after this */
  everyMs: number
  /** older than this, nobody is building it any more and an instance builds it itself */
  freshMs: number
}

export interface ScanPlan extends Freshness { key: string }

export type ScanName = 'home' | 'site' | 'venue' | 'skeleton' | 'market' | 'lst' | 'stats'

export const SCAN_PLAN: Record<ScanName, ScanPlan> = {
  /** /api/dex: this site's pools, the latest block, Seoul's weather */
  home: { key: 'atrium:dex:home:v1', everyMs: 30_000, freshMs: 120_000 },
  /** lib/sitePools: both sites' pools with dollar values, for the server's own routing */
  site: { key: 'atrium:site-pools:v1', everyMs: 60_000, freshMs: 180_000 },
  /** /api/dex-venue: the other site's pools */
  venue: { key: 'atrium:dex:venue:v1', everyMs: 150_000, freshMs: 450_000 },
  /** /api/dex-skeleton: Skeleton Swap's pools */
  skeleton: { key: 'atrium:dex:skeleton:v1', everyMs: 150_000, freshMs: 450_000 },
  /** /api/dex-market: the market reference from Astroport's deepest pools */
  market: { key: `atrium:dex:market:v2:${DEX_FACTORY}`, everyMs: 300_000, freshMs: 900_000 },
  /** /api/lst: the liquid staking board */
  lst: { key: 'atrium:lst:v1', everyMs: 300_000, freshMs: 900_000 },
  /** /api/stats */
  stats: { key: 'atrium:stats:v1', everyMs: 900_000, freshMs: 2_700_000 },
}

export const SCAN_NAMES = Object.keys(SCAN_PLAN) as ScanName[]

/** The audience the workflow asks GitHub to put in its OIDC token, and /api/pool-scans checks for. */
export const POOL_SCANS_AUDIENCE = 'terra-swap-pool-scans'

/** Seconds KV keeps a stored scan: long after it stops being fresh, so a route can still serve it when a build fails. */
export const keepSeconds = (f: Freshness): number => Math.max(3600, Math.ceil((f.freshMs * 4) / 1000))
