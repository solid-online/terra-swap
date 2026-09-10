/**
 * GET /api/dex-holders — who actually holds each pool's LP tokens.
 *
 * A pool's depth tells you what a trade costs today. It says nothing about
 * how long that depth will be there. If one wallet holds all of it, the pool
 * can go to zero in a single transaction, and anyone about to trade or deposit
 * deserves to know that before they do.
 *
 * LP tokens are cw20s, so the holder list is public: `all_accounts` on the
 * token, then a balance each. Pools here have a handful of holders, which
 * keeps this cheap; the cap and the cache keep it cheap if that changes.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY, isDexLive, queryPairs, smart } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const KEY = `atrium:dex:holders:v1:${DEX_FACTORY}`
const FRESH_MS = 120_000
/** Holders read per pool. Beyond this the tail is dust and does not change the picture. */
const MAX_HOLDERS = 40

export interface Holder { address: string; amount: string }
export interface PoolHolders {
  /** LP total supply, smallest units */
  total: string
  /** Descending by size, capped at MAX_HOLDERS */
  holders: Holder[]
}
export interface HoldersResponse {
  live: boolean
  at: number
  /** keyed by pair contract address */
  pools: Record<string, PoolHolders>
}

let mem: HoldersResponse | null = null

async function readPool(lpToken: string): Promise<PoolHolders | null> {
  const info = await smart<{ total_supply: string }>(lpToken, { token_info: {} })
  if (!info?.total_supply) return null
  const accs = await smart<{ accounts: string[] }>(lpToken, { all_accounts: { limit: MAX_HOLDERS } })
  const addrs = accs?.accounts ?? []
  const balances = await Promise.all(addrs.map(async address => {
    const b = await smart<{ balance: string }>(lpToken, { balance: { address } })
    return { address, amount: b?.balance ?? '0' }
  }))
  const holders = balances
    .filter(h => Number(h.amount) > 0)
    .sort((a, b) => (Number(b.amount) - Number(a.amount)))
  return { total: info.total_supply, holders }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<HoldersResponse>) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
  const now = Date.now()
  if (!isDexLive()) return res.status(200).json({ live: false, at: now, pools: {} })

  const cached = HAS_KV ? await vercelKv.get<HoldersResponse>(KEY) : mem
  if (cached && now - cached.at < FRESH_MS) return res.status(200).json(cached)

  const pairs = await queryPairs()
  if (pairs.length === 0) return res.status(200).json(cached ?? { live: true, at: now, pools: {} })

  const entries = await Promise.all(pairs.map(async p => [p.contract_addr, await readPool(p.liquidity_token)] as const))
  const pools: Record<string, PoolHolders> = {}
  for (const [addr, ph] of entries) if (ph) pools[addr] = ph

  const body: HoldersResponse = { live: true, at: now, pools }
  if (Object.keys(pools).length > 0) {
    if (HAS_KV) await vercelKv.set(KEY, body, { ex: 900 }); else mem = body
    return res.status(200).json(body)
  }
  return res.status(200).json(cached ?? body)
}
