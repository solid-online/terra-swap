/**
 * The tape, per pool and per wallet, from the ledger's own swap records.
 *
 * Asked for in the community chat, 2026-09-12: "click on that address and see
 * how that wallet behaves. Was really easy to identify bots." The ledger already
 * keeps every swap with its amounts (captured since 2026-09-10 and backfilled
 * from each pool's last 100 txs), so this is arithmetic over what is written
 * down. Nothing is fetched per request.
 *
 * Prices stay in the pool's own quote token. A dollar figure for a trade made
 * last week needs last week's price, which we do not have.
 */

import type { DexEvent } from 'lib/dex-ledger'

export interface Trade {
  h: number
  tx: string
  address: string
  pair: string
  /** From the base asset's side. Base = the pair's first asset. */
  side: 'buy' | 'sell'
  /** display units */
  base: number
  quote: number
  /** quote per base */
  price: number
}

export interface WalletStats {
  address: string
  trades: number
  buys: number
  sells: number
  baseBought: number
  baseSold: number
  /** Volume-weighted average prices, quote per base. Null with no trades that way. */
  avgBuy: number | null
  avgSell: number | null
  /** (avgSell / avgBuy − 1) × 100 when the wallet has done both. */
  spreadPct: number | null
  /** Median blocks between consecutive trades. Null under two trades. */
  medianGapBlocks: number | null
  firstH: number
  lastH: number
}

export interface PairMeta {
  contract: string
  baseId: string
  quoteId: string
  baseDecimals: number
  quoteDecimals: number
}

/**
 * One ledger swap → one trade, oriented to the pair's base. The ledger keeps
 * one swap per tx per pool, so a tx that swaps the same pool twice shows once.
 */
export function toTrade(e: DexEvent, m: PairMeta): Trade | null {
  if (e.action !== 'swap' || !e.swap || e.contract !== m.contract) return null
  const off = Number(e.swap.offerAmount), ret = Number(e.swap.returnAmount)
  if (!(off > 0) || !(ret > 0)) return null
  const bd = 10 ** m.baseDecimals, qd = 10 ** m.quoteDecimals
  let side: Trade['side'], base: number, quote: number
  if (e.swap.offer === m.baseId && e.swap.ask === m.quoteId) { side = 'sell'; base = off / bd; quote = ret / qd }
  else if (e.swap.offer === m.quoteId && e.swap.ask === m.baseId) { side = 'buy'; base = ret / bd; quote = off / qd }
  else return null
  return { h: e.height, tx: e.txhash, address: e.address, pair: m.contract, side, base, quote, price: quote / base }
}

export function walletStats(address: string, trades: Trade[]): WalletStats {
  const mine = trades.filter(t => t.address === address).sort((a, b) => a.h - b.h)
  let buys = 0, sells = 0, bb = 0, bq = 0, sb = 0, sq = 0
  for (const t of mine) {
    if (t.side === 'buy') { buys++; bb += t.base; bq += t.quote }
    else { sells++; sb += t.base; sq += t.quote }
  }
  const avgBuy = bb > 0 ? bq / bb : null
  const avgSell = sb > 0 ? sq / sb : null
  const gaps = mine.slice(1).map((t, i) => t.h - mine[i].h).sort((a, b) => a - b)
  return {
    address, trades: mine.length, buys, sells, baseBought: bb, baseSold: sb, avgBuy, avgSell,
    spreadPct: avgBuy && avgSell ? (avgSell / avgBuy - 1) * 100 : null,
    medianGapBlocks: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    firstH: mine[0]?.h ?? 0,
    lastH: mine[mine.length - 1]?.h ?? 0,
  }
}
