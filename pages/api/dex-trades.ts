/**
 * GET /api/dex-trades?pair=<addr>              the pool's tape and who trades it
 * GET /api/dex-trades?pair=<addr>&address=<a>  one wallet inside that pool
 * GET /api/dex-trades?address=<a>              one wallet across every pool
 *
 * Reads the ledger only. /api/dex-leaderboard scans the chain into it once a
 * minute, so this is cheap and never fans out to the LCD beyond the pair list.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { isDexLive, queryPairs, assetId, tokenFor } from 'lib/dex'
import { getLedger } from 'lib/dex-ledger'
import { toTrade, walletStats, type PairMeta, type Trade, type WalletStats } from 'lib/trades'

const MAX_TAPE = 60
const MAX_WALLETS = 12
const ADDR = /^terra1[0-9a-z]{38,58}$/

export interface TradesResponse {
  pair: string | null
  address: string | null
  /** newest first, capped */
  tape: Trade[]
  total: number
  buys: number
  sells: number
  /** Swaps recorded before amounts were captured. Counted, not priced. */
  unpriced: number
  /** Most active wallets in the pool, or just the one asked for. */
  wallets: WalletStats[]
  /** With `address` and no `pair`: that wallet, pool by pool. */
  byPool: Array<{ pair: string; label: string; base: string; quote: string; stats: WalletStats }>
}

const empty = (pair: string | null, address: string | null): TradesResponse =>
  ({ pair, address, tape: [], total: 0, buys: 0, sells: 0, unpriced: 0, wallets: [], byPool: [] })

export default async function handler(req: NextApiRequest, res: NextApiResponse<TradesResponse | { error: string }>) {
  const pair = typeof req.query.pair === 'string' && ADDR.test(req.query.pair) ? req.query.pair : null
  const address = typeof req.query.address === 'string' && ADDR.test(req.query.address) ? req.query.address : null
  if (!pair && !address) return res.status(400).json({ error: 'pair or address required' })
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  if (!isDexLive()) return res.status(200).json(empty(pair, address))

  const [pairs, ledger] = await Promise.all([queryPairs(), getLedger()])
  const metas = new Map<string, PairMeta & { label: string; base: string; quote: string }>()
  for (const p of pairs) {
    const b = tokenFor(p.asset_infos[0]), q = tokenFor(p.asset_infos[1])
    metas.set(p.contract_addr, {
      contract: p.contract_addr, baseId: assetId(p.asset_infos[0]), quoteId: assetId(p.asset_infos[1]),
      baseDecimals: b.decimals, quoteDecimals: q.decimals, label: `${b.label} / ${q.label}`, base: b.label, quote: q.label,
    })
  }
  if (pair && !metas.has(pair)) return res.status(200).json(empty(pair, address))

  const trades: Trade[] = []
  let unpriced = 0
  for (const e of Object.values(ledger.events)) {
    if (e.action !== 'swap') continue
    if (pair && e.contract !== pair) continue
    if (address && e.address !== address) continue
    const m = metas.get(e.contract)
    if (!m) continue
    const t = toTrade(e, m)
    if (t) trades.push(t); else unpriced++
  }
  trades.sort((a, b) => b.h - a.h)

  let wallets: WalletStats[]
  if (address) {
    wallets = [walletStats(address, trades)]
  } else {
    const counts = new Map<string, number>()
    for (const t of trades) counts.set(t.address, (counts.get(t.address) ?? 0) + 1)
    wallets = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_WALLETS)
      .map(([a]) => walletStats(a, trades))
  }

  const byPool: TradesResponse['byPool'] = []
  if (address && !pair) {
    for (const [contract, m] of Array.from(metas.entries())) {
      const inPool = trades.filter(t => t.pair === contract)
      if (inPool.length === 0) continue
      byPool.push({ pair: contract, label: m.label, base: m.base, quote: m.quote, stats: walletStats(address, inPool) })
    }
    byPool.sort((a, b) => b.stats.trades - a.stats.trades)
  }

  return res.status(200).json({
    pair, address,
    tape: trades.slice(0, MAX_TAPE),
    total: trades.length,
    buys: trades.filter(t => t.side === 'buy').length,
    sells: trades.filter(t => t.side === 'sell').length,
    unpriced, wallets, byPool,
  })
}
