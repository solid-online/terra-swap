/**
 * GET /api/dex-leaderboard — the public board for Atrium Swap.
 *
 * Scans the factory and every pool for fresh tx events, merges them into the
 * durable ledger (idempotent, so hammering this is harmless), then ranks.
 * The scan is the expensive part, so it is rate-limited to once a minute
 * across all visitors; in between, the board is served from the last result.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import { isDexLive, queryPairs, DEX_FACTORY } from 'lib/dex'
import { readLiquidity, liquidityByAddress } from 'lib/liquidity'
import {
  scanContract, mergeLedger, getLedger, computeLeaderboard, computeFlows,
  BADGES, POINTS, FIRST_HAND_POINTS, CRYSTAL_MULTIPLIER, EARLY_CUTOFF_HEIGHT, LIQUIDITY_POINTS_PER_USD, type LeaderRow, type DexEvent, type LpFlow,
} from 'lib/dex-ledger'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const CACHE_KEY = `atrium:dex:board:v2:${DEX_FACTORY}`
const SCAN_EVERY_MS = 60_000
/** Safety cap so a factory with many pools cannot fan out unboundedly. */
const MAX_POOLS_SCANNED = 40

export interface PoolActivity { last: number; count: number }

export interface BoardResponse {
  live: boolean
  rows: LeaderRow[]
  totalEvents: number
  scannedAt: number
  /** newest moves across every pool, for the wire */
  recent: DexEvent[]
  /** per contract: latest height + total moves, for the pool vibe tags */
  poolActivity: Record<string, PoolActivity>
  rules: { points: typeof POINTS; firstHand: number; crystalMultiplier: number; badges: typeof BADGES; cutoffHeight: number; liquidityPerUsd: number }
  /** who seeded each pool first — the promise, made visible per pool */
  firstHands: Record<string, { address: string; height: number; txhash: string }>
  /** most moves in the last ~24h of blocks */
  lotd: { address: string; moves: number } | null
  /** net liquidity per wallet per pool, keyed `${address}|${contract}` */
  flows: Record<string, LpFlow>
}

type Snap = { at: number; rows: LeaderRow[]; total: number; recent: DexEvent[]; poolActivity: Record<string, PoolActivity>; firstHands: Record<string, { address: string; height: number; txhash: string }>; lotd: { address: string; moves: number } | null; flows: Record<string, LpFlow> }
let memCache: Snap | null = null

export default async function handler(_req: NextApiRequest, res: NextApiResponse<BoardResponse>) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')
  const rules = { points: POINTS, firstHand: FIRST_HAND_POINTS, crystalMultiplier: CRYSTAL_MULTIPLIER, badges: BADGES, cutoffHeight: EARLY_CUTOFF_HEIGHT, liquidityPerUsd: LIQUIDITY_POINTS_PER_USD }
  if (!isDexLive()) return res.status(200).json({ live: false, rows: [], totalEvents: 0, scannedAt: 0, rules, recent: [], poolActivity: {}, firstHands: {}, lotd: null, flows: {} })

  const cached = HAS_KV ? await vercelKv.get<Snap>(CACHE_KEY) : memCache
  if (cached && Date.now() - cached.at < SCAN_EVERY_MS) {
    return res.status(200).json({ live: true, rows: cached.rows, totalEvents: cached.total, scannedAt: cached.at, rules, recent: cached.recent ?? [], poolActivity: cached.poolActivity ?? {}, firstHands: cached.firstHands ?? {}, lotd: cached.lotd ?? null, flows: cached.flows ?? {} })
  }

  const pairs = await queryPairs()
  // No pools means the query failed, not that the factory is empty. Serving a
  // stale board is fine; merging an empty allowlist would delete the ledger.
  if (pairs.length === 0) {
    const last = cached ?? memCache
    if (last) return res.status(200).json({ live: true, rows: last.rows, totalEvents: last.total, scannedAt: last.at, rules, recent: last.recent ?? [], poolActivity: last.poolActivity ?? {}, firstHands: last.firstHands ?? {}, lotd: last.lotd ?? null, flows: last.flows ?? {} })
    return res.status(200).json({ live: true, rows: [], totalEvents: 0, scannedAt: 0, rules, recent: [], poolActivity: {}, firstHands: {}, lotd: null, flows: {} })
  }

  // Scanning is capped because every pool costs a query. The allowlist is not:
  // it decides which events are allowed to keep existing, so a pool that did
  // not fit this round's scan budget still owns its history. Until 2026-09-10
  // these were the same truncated list, which deleted the ledger of every pool
  // past the twelfth — points on the board fell as new pools were opened.
  const toScan = pairs.slice(0, MAX_POOLS_SCANNED)
  const scans = await Promise.all([
    scanContract(DEX_FACTORY),
    ...toScan.map(p => scanContract(p.contract_addr)),
  ])
  const allowed = new Set<string>([DEX_FACTORY, ...pairs.map(p => p.contract_addr)])
  const { ledger } = await mergeLedger(scans.flat(), allowed)
  // Live LP balances, so points follow liquidity that is still there.
  const standing = liquidityByAddress(await readLiquidity())
  const rows = await computeLeaderboard(ledger, standing)
  const events = Object.values(ledger.events)
  const total = events.length
  const recent = [...events].sort((a, b) => b.height - a.height).slice(0, 14)
  const poolActivity: Record<string, PoolActivity> = {}
  for (const e of events) {
    const a = poolActivity[e.contract] ?? { last: 0, count: 0 }
    a.count += 1; if (e.height > a.last) a.last = e.height
    poolActivity[e.contract] = a
  }
  const firstHands: Record<string, { address: string; height: number; txhash: string }> = {}
  for (const e of events) {
    if (e.action !== 'provide_liquidity') continue
    const cur = firstHands[e.contract]
    if (!cur || e.height < cur.height) firstHands[e.contract] = { address: e.address, height: e.height, txhash: e.txhash }
  }
  // Lunatic of the day: most moves in the last ~24h (14,400 blocks at 6s).
  const top = events.reduce((m, e) => Math.max(m, e.height), 0)
  const per = new Map<string, number>()
  for (const e of events) if (e.height >= top - 14_400) per.set(e.address, (per.get(e.address) ?? 0) + 1)
  const lotdEntry = Array.from(per.entries()).sort((a, b) => b[1] - a[1])[0]
  const lotd = lotdEntry ? { address: lotdEntry[0], moves: lotdEntry[1] } : null
  const flows = computeFlows(ledger)
  const snap: Snap = { at: Date.now(), rows, total, recent, poolActivity, firstHands, lotd, flows }
  if (HAS_KV) await vercelKv.set(CACHE_KEY, snap, { ex: 300 }); else memCache = snap

  return res.status(200).json({ live: true, rows, totalEvents: total, scannedAt: snap.at, rules, recent, poolActivity, firstHands, lotd, flows })
}
