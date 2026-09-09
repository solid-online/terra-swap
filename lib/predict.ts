/**
 * Terra Predict — client + server helpers for the admin-less prediction
 * market contract (Astral/contracts/predict).
 *
 * Everything degrades to "not live yet" until NEXT_PUBLIC_PREDICT_CONTRACT is
 * set. The contract has no admin and no migrate entry point, so the address
 * here is the whole deployment.
 */

import { NOBLE_USDC, queryPool, type AssetInfo } from 'lib/dex'

export const PREDICT_CONTRACT = process.env.NEXT_PUBLIC_PREDICT_CONTRACT || ''
export const isPredictLive = () => PREDICT_CONTRACT.length > 0

/** Astroport's LUNA/USDC pair (concentrated liquidity), the deepest LUNA market on Terra. */
export const LUNA_USDC_PAIR = 'terra1v3lqxl0eyte9x3nhdgcj8hwvjq76aupnnzz0yll8mxs5cckc29pqvg2scu'
export const LUNA: AssetInfo = { native_token: { denom: 'uluna' } }
export const USDC: AssetInfo = { native_token: { denom: NOBLE_USDC } }
/** A week: after this much silence past resolve_at anyone may void (mirrors the contract). */
export const VOID_GRACE_SECONDS = 7 * 86_400
export const MIN_LEAD_SECONDS = 600

const LCD = process.env.NEXT_PUBLIC_LCD || 'https://terra-lcd.publicnode.com'

export async function smart<T>(contract: string, msg: object): Promise<T | null> {
  try {
    const q = typeof window !== 'undefined'
      ? btoa(JSON.stringify(msg))
      : Buffer.from(JSON.stringify(msg)).toString('base64')
    const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()).data as T
  } catch {
    return null
  }
}

// ─── contract shapes (JSON as the contract emits it) ──────────────────

export type Outcome = 'yes' | 'no' | 'void'
export type Side = 'yes' | 'no'

export interface Observation { time: string; cumulative: string; observer: string }
export interface Resolution { outcome: Outcome; twap: string | null; resolved_at: string; resolver: string; payout_pool: string }
export interface Market {
  id: number
  creator: string
  question: string
  pair: string
  base: AssetInfo
  quote: AssetInfo
  base_decimals: number
  quote_decimals: number
  threshold: string
  price_precision: string
  denom: string
  min_bet: string
  /** nanoseconds, as a string */
  created_at: string
  close_at: string
  resolve_at: string
  twap_window: number
  yes_total: string
  no_total: string
  observation: Observation | null
  resolution: Resolution | null
}
export interface PredictConfig { fee_bps: number; fee_recipient: string | null; bounty_bps: number; min_window: number }
export interface Position { yes: string; no: string; claimed: boolean }
export interface Claimable { amount: string; claimed: boolean }
export interface TwapNow { twap: string | null; elapsed: number }

/** cosmwasm Timestamp → unix seconds */
export const secs = (ns: string) => Math.floor(Number(ns) / 1e9)

export async function queryConfig(): Promise<PredictConfig | null> {
  return smart<PredictConfig>(PREDICT_CONTRACT, { config: {} })
}

export async function queryMarkets(max = 300): Promise<Market[]> {
  const out: Market[] = []
  let startAfter: number | undefined
  while (out.length < max) {
    const page = await smart<{ markets: Market[]; count: number }>(PREDICT_CONTRACT, {
      markets: { start_after: startAfter, limit: 100 },
    })
    if (!page || page.markets.length === 0) break
    out.push(...page.markets)
    if (page.markets.length < 100) break
    startAfter = page.markets[page.markets.length - 1].id
  }
  return out
}

export const queryMarket = (id: number) => smart<Market>(PREDICT_CONTRACT, { market: { id } })
export const queryPosition = (id: number, address: string) =>
  smart<Position>(PREDICT_CONTRACT, { position: { market_id: id, address } })
export const queryClaimable = (id: number, address: string) =>
  smart<Claimable>(PREDICT_CONTRACT, { claimable: { market_id: id, address } })
export const queryTwapNow = (id: number) => smart<TwapNow>(PREDICT_CONTRACT, { twap: { market_id: id } })

/** Spot price of base in quote, display units, straight from the pair's reserves. */
export async function querySpot(m: Pick<Market, 'pair' | 'base' | 'quote' | 'base_decimals' | 'quote_decimals'>): Promise<number | null> {
  const pool = await queryPool(m.pair)
  if (!pool) return null
  const find = (info: AssetInfo) => pool.assets.find(a => JSON.stringify(a.info) === JSON.stringify(info))
  const b = find(m.base), q = find(m.quote)
  if (!b || !q || Number(b.amount) === 0) return null
  return (Number(q.amount) / 10 ** m.quote_decimals) / (Number(b.amount) / 10 ** m.base_decimals)
}

// ─── reading a market ─────────────────────────────────────────────────

export type Phase =
  | 'open'        // betting
  | 'waiting'     // betting closed, TWAP window not started
  | 'observe'     // window started, first half, nobody has observed yet — anyone can, for a bounty
  | 'missed'      // first half passed with no observation: will resolve void (refunds)
  | 'averaging'   // observed, the chain is averaging until resolve_at
  | 'resolve'     // at or past resolve_at, anyone can settle for a bounty
  | 'resolved'

export function phaseOf(m: Market, now = Date.now() / 1000): Phase {
  if (m.resolution) return 'resolved'
  const close = secs(m.close_at), resolve = secs(m.resolve_at)
  const windowStart = resolve - m.twap_window
  const half = windowStart + Math.floor(m.twap_window / 2)
  if (now < close) return 'open'
  if (now >= resolve) return 'resolve'
  if (now < windowStart) return 'waiting'
  if (m.observation) return 'averaging'
  return now <= half ? 'observe' : 'missed'
}

export const canVoid = (m: Market, now = Date.now() / 1000) =>
  !m.resolution && now >= secs(m.resolve_at) + VOID_GRACE_SECONDS

/** YES share of the pool, 0..1, or null when empty. */
export function impliedYes(m: Market): number | null {
  const y = Number(m.yes_total), n = Number(m.no_total)
  return y + n === 0 ? null : y / (y + n)
}

/** What 1 unit on `side` pays if that side wins, given today's pools (before fee and bounty). */
export function payoutMultiple(m: Market, side: Side): number | null {
  const y = Number(m.yes_total), n = Number(m.no_total)
  const mine = side === 'yes' ? y : n, other = side === 'yes' ? n : y
  if (mine === 0) return other === 0 ? null : Infinity
  return 1 + other / mine
}

export function fmtCountdown(target: number, now = Date.now() / 1000): string {
  const d = Math.max(0, Math.floor(target - now))
  if (d >= 86_400) return `${Math.floor(d / 86_400)}d ${Math.floor((d % 86_400) / 3600)}h`
  if (d >= 3600) return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m`
  if (d >= 60) return `${Math.floor(d / 60)}m ${d % 60}s`
  return `${d}s`
}

export function fmtWindow(s: number): string {
  if (s % 86_400 === 0) return `${s / 86_400}d`
  if (s % 3600 === 0) return `${s / 3600}h`
  return `${Math.round(s / 60)}m`
}

export function fmtPrice(p: number | string | null | undefined): string {
  if (p == null || p === '') return '—'
  const n = typeof p === 'string' ? Number(p) : p
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}
