/**
 * GET /api/dex — every pool on the Atrium factory with live reserves.
 *
 * One server-side fan-out so the swap page makes one request instead of
 * N+1 LCD calls from every visitor's browser. Short edge cache: reserves
 * move with every swap, but a few seconds of staleness is invisible next
 * to the ~6s block time.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { createHash } from 'crypto'
import {
  isDexLive, queryPairs, queryPool, toPoolView, annotateTvl,
  POOL_FEE_BPS, type PoolView,
} from 'lib/dex'

export interface DexResponse {
  live: boolean
  pools: PoolView[]
  feeBps: number
  poolFeeBps: number
  tvlUsd: number
  /** latest block, for the live chain pill */
  height: number
  chainId: string
  /** moniker of the validator that proposed the latest block */
  proposer: string
  /** live Seoul weather, because the chain was born there */
  seoul: { temp: number; code: number } | null
}

/** One cheap call so the page can show a live block height, Terra Station style. */
const LCD = process.env.NEXT_PUBLIC_LCD || 'https://terra-lcd.publicnode.com'
const UA = { 'User-Agent': 'Mozilla/5.0 atrium-dex', accept: 'application/json' }

async function latestBlock(): Promise<{ height: number; chainId: string; proposer: string }> {
  try {
    const r = await fetch(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`, { headers: UA, signal: AbortSignal.timeout(6000) })
    if (!r.ok) return { height: 0, chainId: '', proposer: '' }
    const h = (await r.json())?.block?.header
    const proposer = await Promise.race([monikerFor(String(h?.proposer_address ?? '')), new Promise<string>(r => setTimeout(() => r(''), 1500))])
    return { height: Number(h?.height ?? 0), chainId: String(h?.chain_id ?? ''), proposer }
  } catch { return { height: 0, chainId: '', proposer: '' } }
}

/**
 * Terra Station used to tell you who proposed the block. So do we. The block
 * header carries the proposer's consensus address (base64 of 20 bytes); for an
 * ed25519 validator that is sha256(pubkey)[:20], so the bonded set maps
 * straight onto monikers with no bech32 involved. Cached ten minutes.
 */
let valMap: { at: number; map: Record<string, string> } | null = null
async function monikerFor(proposerB64: string): Promise<string> {
  if (!proposerB64) return ''
  try {
    if (!valMap || Date.now() - valMap.at > 600_000) {
      const r = await fetch(`${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300`, { headers: UA, signal: AbortSignal.timeout(8000) })
      if (!r.ok) return ''
      const vs = ((await r.json())?.validators ?? []) as { consensus_pubkey?: { key?: string }; description?: { moniker?: string } }[]
      const map: Record<string, string> = {}
      for (const v of vs) {
        const key = v.consensus_pubkey?.key
        if (!key) continue
        const cons = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 20).toString('base64')
        // Monikers are free text on-chain; some carry stray whitespace.
        map[cons] = (v.description?.moniker ?? '').trim()
      }
      valMap = { at: Date.now(), map }
    }
    return valMap.map[proposerB64] ?? ''
  } catch { return '' }
}

/** Open-Meteo, no key, cached ten minutes. Seoul City Hall. */
let wx: { at: number; v: { temp: number; code: number } | null } | null = null
async function seoulWeather(): Promise<{ temp: number; code: number } | null> {
  if (wx && Date.now() - wx.at < 600_000) return wx.v
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,weather_code', { headers: UA, signal: AbortSignal.timeout(5000) })
    const j = r.ok ? await r.json() : null
    const v = j?.current ? { temp: Math.round(Number(j.current.temperature_2m)), code: Number(j.current.weather_code) } : null
    wx = { at: Date.now(), v }
    return v
  } catch { return wx?.v ?? null }
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<DexResponse>) {
  res.setHeader('Cache-Control', 's-maxage=8, stale-while-revalidate=30')
  if (!isDexLive()) {
    return res.status(200).json({ live: false, pools: [], feeBps: 0, poolFeeBps: POOL_FEE_BPS, tvlUsd: 0, height: 0, chainId: '', proposer: '', seoul: null })
  }
  // No market scan here: it lives in /api/dex-market so a cold start never blocks the page.
  const [pairs, head, seoul] = await Promise.all([queryPairs(), latestBlock(), seoulWeather()])
  const pools = await Promise.all(
    pairs.map(async (p) => toPoolView(p, await queryPool(p.contract_addr))),
  )
  // Order: pools with liquidity before empty ones, then pools made of tokens
  // we can name before unknown ones, then by the named side's reserve. Raw
  // reserve maths across unrelated tokens says nothing, so it is only used
  // as the final tiebreak within the same tier.
  const known = (p: PoolView) => p.tokens.filter(t => t.key === t.label && t.key.length <= 8).length
  pools.sort((a, b) =>
    Number(a.empty) - Number(b.empty)
    || known(b) - known(a)
    || Number(b.reserves[0]) - Number(a.reserves[0]))
  annotateTvl(pools)
  const tvlUsd = pools.reduce((s, p) => s + (p.tvlUsd ?? 0), 0)
  return res.status(200).json({ live: true, pools, feeBps: 0, poolFeeBps: POOL_FEE_BPS, tvlUsd, height: head.height, chainId: head.chainId, proposer: head.proposer, seoul })
}
