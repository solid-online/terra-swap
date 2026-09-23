/**
 * A result that every function instance shares, server side only: the first
 * instance to need it builds it and writes it to KV, the others read it.
 *
 * Why (Vercel usage, 2026-09-23): each instance kept its own copy, so every
 * new instance, and every CDN region revalidating on its own, rebuilt the
 * same pool scans. That is most of this site's Active CPU, and Openfields is
 * moving to Vercel's Hobby plan, which allows 4 CPU-hours a month.
 *
 * Without KV (local development) it is a per-instance cache. A value `keep`
 * turns down (a partial reading) is served once but not stored.
 */

import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY, marketPrices } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const local = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

export async function shared<T extends { at: number }>(key: string, ttlMs: number, build: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
  const now = Date.now()
  const mine = local.get(key) as { at: number; value: T } | undefined
  if (mine && now - mine.at < ttlMs) return mine.value
  if (HAS_KV) {
    try {
      const v = await vercelKv.get<T>(key)
      if (v && now - v.at < ttlMs) {
        local.set(key, { at: v.at, value: v })
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
  if (keep(v)) {
    local.set(key, { at: v.at, value: v })
    if (HAS_KV) await vercelKv.set(key, v, { ex: Math.max(60, Math.ceil((ttlMs * 4) / 1000)) }).catch(() => {})
  }
  return v
}

/** The last stored value however old, for serving something when a build fails. */
export async function stale<T>(key: string): Promise<T | null> {
  const mine = local.get(key) as { value: T } | undefined
  if (mine) return mine.value
  if (!HAS_KV) return null
  try { return await vercelKv.get<T>(key) } catch { return null }
}

/**
 * Astroport's market reference, shared with /api/dex-market under the same
 * key and shape ({ px, at }), so whichever route builds it first builds it
 * for all of them.
 */
export const MARKET_KEY = `atrium:dex:market:v2:${DEX_FACTORY}`
export async function sharedMarketPrices(): Promise<Record<string, number>> {
  const r = await shared(MARKET_KEY, 300_000, async () => ({ px: await marketPrices(), at: Date.now() }), v => Object.keys(v.px).length > 1)
  return r.px
}
