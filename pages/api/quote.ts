/**
 * GET /api/quote?from=LUNA&to=USDC&amount=100 — what a swap would deliver
 * right now through the best route over Terra Swap's, Astroport's and Skeleton Swap's pools,
 * the same routing the swap page signs (lib/route): paths through up to three
 * pools, and a split over two paths when that delivers more.
 *
 * GET /api/quote?from=LUNA&to=USDC&receive=5 — the other way round: what to pay
 * so that at least 5 USDC arrives even when the price moves as far as the
 * slippage allows (lib/route quoteExactOut).
 *
 * Open to any site (CORS), for the embed (/embed) and for anyone building on
 * Terra. It reads public chain data and signs nothing. A quote is not an
 * offer: prices move with every trade, and the swap itself happens in the
 * wallet of whoever signs it. USDC from Noble and USDC.inj are never quoted
 * against each other. Tokens are the ones this site lists, by ticker or id.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { KNOWN_TOKENS, assetId, fromMicro, toMicro, type KnownToken } from 'lib/dex'
import { planTrade, quoteBest, quoteExactOut, tradeText, type TradePlan } from 'lib/route'
import { routingPools } from 'lib/routingPools'

/** A cold instance reads both factories' pools first. */
export const config = { maxDuration: 60 }

export interface QuoteHop { pool: string; venue: string; offer: string; ask: string; returns: string }
export interface QuoteResponse {
  from: string
  to: string
  /** whole tokens paid: as asked, or with ?receive= what it takes */
  amount: string
  /** with ?receive=: the amount asked to arrive */
  receive?: string
  exactOut?: boolean
  /** what arrives when every pool trades at its quote, display units */
  expectedOut: string
  /** the least a swap signed with SLIPPAGE lets arrive */
  minimumOut: string
  slippagePct: number
  impactPct: number
  path: string
  parts: { sharePct: number; hops: QuoteHop[] }[]
  /** the swap page with this pair and amount filled in */
  swapUrl: string
  at: number
}

const SLIPPAGE = 0.01
const FRESH_MS = 20_000
const PER_MINUTE = 120
const AMOUNT = /^\d{1,15}(\.\d{1,18})?$/
const cache = new Map<string, QuoteResponse>()
let windowAt = 0
let windowReads = 0

const find = (v: unknown): KnownToken | undefined =>
  typeof v === 'string' ? KNOWN_TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase() || assetId(t.info) === v) : undefined
const plain = (micro: string, decimals: number) => fromMicro(micro, decimals, Math.min(decimals, 8)).replace(/,/g, '')
const enc = encodeURIComponent

export default async function handler(req: NextApiRequest, res: NextApiResponse<QuoteResponse | { error: string }>) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const from = find(req.query.from), to = find(req.query.to)
  const amount = typeof req.query.amount === 'string' ? req.query.amount.trim() : ''
  const receive = typeof req.query.receive === 'string' ? req.query.receive.trim() : ''
  if (!from || !to) return res.status(400).json({ error: 'from and to must be tokens this site lists, by ticker (LUNA) or id' })
  if (from.key === to.key) return res.status(400).json({ error: 'from and to are the same token' })
  if (amount && receive) return res.status(400).json({ error: 'give amount (what to pay) or receive (what should arrive), not both' })
  const exactOut = !!receive
  const given = exactOut ? receive : amount
  if (!AMOUNT.test(given) || !(Number(given) > 0)) return res.status(400).json({ error: `${exactOut ? 'receive' : 'amount'} must be a positive number in whole tokens` })
  const micro = toMicro(given, exactOut ? to.decimals : from.decimals)
  if (!micro || micro === '0') return res.status(400).json({ error: `${exactOut ? 'receive' : 'amount'} is below the smallest unit` })

  const key = `${from.key}|${to.key}|${exactOut ? 'out' : 'in'}|${micro}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(hit)
  }
  const now = Date.now()
  if (now - windowAt > 60_000) { windowAt = now; windowReads = 0 }
  if (windowReads >= PER_MINUTE) return res.status(429).json({ error: 'busy, try again in a moment' })
  windowReads += exactOut ? 4 : 1

  try {
    const pools = await routingPools()
    let trade: TradePlan
    let pay: string
    if (exactOut) {
      const x = await quoteExactOut(pools, from, to, micro, undefined, { slip: SLIPPAGE })
      if (!x) return res.status(404).json({ error: `no amount found that delivers ${receive} ${to.key} right now` })
      trade = x.trade
      pay = plain(x.amountMicro, from.decimals)
    } else {
      const q = await quoteBest(pools, from, to, micro, undefined, { slip: SLIPPAGE, split: true })
      if (!q.best) return res.status(404).json({ error: `no route from ${from.key} to ${to.key} right now` })
      trade = planTrade(q.split ?? [{ quote: q.best, share: 1 }], SLIPPAGE)
      pay = amount
    }
    const host = req.headers.host ?? 'swap.openfields.app'
    const body: QuoteResponse = {
      from: from.key,
      to: to.key,
      amount: pay,
      ...(exactOut ? { receive, exactOut: true } : {}),
      expectedOut: plain(trade.expectedOut, to.decimals),
      minimumOut: plain(trade.minOut, to.decimals),
      slippagePct: SLIPPAGE * 100,
      impactPct: Math.round(trade.impactPct * 1000) / 1000,
      path: tradeText(trade.parts),
      parts: trade.parts.map(p => ({
        sharePct: Math.round(p.share * 1000) / 10,
        hops: p.quote.legs.map(l => ({ pool: l.pool.contract_addr, venue: l.pool.venue, offer: l.offer.key, ask: l.ask.key, returns: plain(l.returnMicro, l.ask.decimals) })),
      })),
      swapUrl: `https://${host}/?from=${enc(from.key)}&to=${enc(to.key)}&${exactOut ? `receive=${enc(receive)}` : `amount=${enc(amount)}`}`,
      at: Date.now(),
    }
    cache.set(key, body)
    if (cache.size > 500) cache.delete(cache.keys().next().value as string)
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(body)
  } catch {
    return res.status(503).json({ error: 'the chain did not answer, try again in a moment' })
  }
}
