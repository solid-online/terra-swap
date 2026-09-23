/**
 * A result that every function instance shares, server side only: the pool-scan
 * workflow writes it to KV (lib/scanPlan), and when it has stopped, the first
 * instance to need it builds it and writes it there for the others.
 *
 * Why (Vercel usage, 2026-09-23): each instance kept its own copy, so every
 * new instance, and every CDN region revalidating on its own, rebuilt the
 * same pool scans. That is most of this site's Active CPU, and Openfields is
 * moving to Vercel's Hobby plan, which allows 4 CPU-hours a month.
 *
 * Without KV (local development, and the workflow itself) it is a per-process
 * cache that builds again every `everyMs`. A value `keep` turns down (a partial
 * reading) is served once but not stored.
 */

import { kv as vercelKv } from '@vercel/kv'
import { marketPrices } from 'lib/dex'
import { SCAN_PLAN, keepSeconds, type Freshness } from 'lib/scanPlan'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
/** `checked`: when this process last built it or read it from KV */
const local = new Map<string, { checked: number; value: { at: number } }>()
const inflight = new Map<string, Promise<unknown>>()

export async function shared<T extends { at: number }>(key: string, f: Freshness, build: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
  const now = Date.now()
  const mine = local.get(key) as { checked: number; value: T } | undefined
  // Good until the next one is due; after that KV may hold a newer one.
  if (mine && now - mine.checked < f.everyMs && now - mine.value.at < f.freshMs) return mine.value
  if (HAS_KV) {
    try {
      const v = await vercelKv.get<T>(key)
      if (v && now - v.at < f.freshMs) {
        local.set(key, { checked: now, value: v })
        return v
      }
    } catch { /* KV down: build it here */ }
  }
  let p = inflight.get(key) as Promise<T> | undefined
  if (!p) {
    p = build().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  const v = await p
  if (keep(v)) await store(key, f, v)
  return v
}

/** Keep a value as this process's copy and, with KV, as everyone's. */
export async function store(key: string, f: Freshness, value: { at: number }): Promise<void> {
  local.set(key, { checked: Date.now(), value })
  if (HAS_KV) await vercelKv.set(key, value, { ex: keepSeconds(f) }).catch(() => {})
}

/** The last stored value however old, for serving something when a build fails. */
export async function stale<T>(key: string): Promise<T | null> {
  const mine = local.get(key) as { value: T } | undefined
  if (mine) return mine.value
  if (!HAS_KV) return null
  try { return await vercelKv.get<T>(key) } catch { return null }
}

/**
 * Astroport's market reference, as /api/dex-market serves it ({ px, at }).
 * The routes that value pools read it from here, so whichever builds it first
 * builds it for all of them.
 */
export interface MarketScan { px: Record<string, number>; at: number }
export const keepMarket = (v: MarketScan): boolean => Object.keys(v.px).length > 1
export function marketScan(): Promise<MarketScan> {
  return shared(SCAN_PLAN.market.key, SCAN_PLAN.market, async () => ({ px: await marketPrices(), at: Date.now() }), keepMarket)
}
export async function sharedMarketPrices(): Promise<Record<string, number>> {
  return (await marketScan()).px
}
