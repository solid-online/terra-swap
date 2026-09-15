/**
 * Where the server keeps browsers that asked for alerts with the page closed
 * (lib/push): per browser, its push address, the two keys the browser handed
 * out for it, and its alert levels. Nothing else. A record expires after 120
 * days without the browser syncing, and goes the moment the push service says
 * the address is gone.
 */

import { kv as vercelKv } from '@vercel/kv'
import { createHash } from 'crypto'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const PREFIX = 'atrium:push:v1'
const IDS = `${PREFIX}:ids`
const KEEP_S = 120 * 86_400
export const MAX_SUBS = 5000
export const MAX_ALERTS = 30

export interface StoredAlert {
  id: string
  tokenId: string
  key: string
  label: string
  dir: 'above' | 'below'
  usd: number
  firedAt?: number
  firedUsd?: number
}

export interface StoredSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
  alerts: StoredAlert[]
  updated: number
}

const mem = (() => {
  const g = globalThis as unknown as { __terraSwapPush?: Map<string, StoredSub> }
  g.__terraSwapPush ??= new Map()
  return g.__terraSwapPush
})()

/** A record is named by a hash of its push address, so the address itself never appears in a key. */
export const subId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32)
const subKey = (id: string) => `${PREFIX}:sub:${id}`

export async function readSub(id: string): Promise<StoredSub | null> {
  if (!HAS_KV) return mem.get(id) ?? null
  return (await vercelKv.get<StoredSub>(subKey(id))) ?? null
}

export async function writeSub(sub: StoredSub): Promise<void> {
  const id = subId(sub.endpoint)
  if (!HAS_KV) { mem.set(id, sub); return }
  await vercelKv.set(subKey(id), sub, { ex: KEEP_S })
  await vercelKv.sadd(IDS, id)
}

export async function deleteSub(id: string): Promise<void> {
  if (!HAS_KV) { mem.delete(id); return }
  await vercelKv.del(subKey(id))
  await vercelKv.srem(IDS, id)
}

export async function listIds(): Promise<string[]> {
  if (!HAS_KV) return Array.from(mem.keys())
  return (await vercelKv.smembers(IDS)) ?? []
}

export async function countSubs(): Promise<number> {
  if (!HAS_KV) return mem.size
  return (await vercelKv.scard(IDS)) ?? 0
}

/** Records for `ids`, in order; null where one has expired. */
export async function readSubs(ids: string[]): Promise<(StoredSub | null)[]> {
  if (!HAS_KV) return ids.map(id => mem.get(id) ?? null)
  const out: (StoredSub | null)[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const got = await vercelKv.mget<(StoredSub | null)[]>(...chunk.map(subKey))
    out.push(...chunk.map((_, k) => got?.[k] ?? null))
  }
  return out
}
