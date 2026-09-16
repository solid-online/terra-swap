/**
 * The numbers behind /stats that take the chain some reading: what Terra
 * Swap's router has been used for in the last 30 days, what the quote tags in
 * swaps signed on the interface say the routing added (lib/route tradeMemo),
 * a few trades re-priced three ways right now, and this month's uptime from
 * the public log on the repository's `status` branch.
 *
 * The same arithmetic as scripts/monthly-report.mjs, over a rolling window
 * instead of a calendar month, so the page and the report can be checked
 * against each other.
 */

import { ASTRO_ROUTER, TERRA_SWAP_ROUTERS, assetId, toMicro, type KnownToken, type PoolView } from 'lib/dex'
import { lcdFetch } from 'lib/lcd'
import { planRoute, planTrade, quoteBest, readTradeMemo, tradeText } from 'lib/route'

const UA = { 'User-Agent': 'Mozilla/5.0 terra-swap-stats', accept: 'application/json' }
const DAY = 86_400_000
const WINDOW_DAYS = 30
const UPTIME_LOG = 'https://raw.githubusercontent.com/solid-online/terra-swap/status/uptime'
const UPTIME_API = 'https://api.github.com/repos/solid-online/terra-swap/contents/uptime'

interface Ev { type: string; attributes: { key: string; value: string }[] }
interface Tx { txhash: string; code: number; timestamp: string; events: Ev[]; body?: { memo?: string; messages?: Record<string, unknown>[] } }

export interface Window {
  since: string | null
  complete: boolean
  /** false when the first page did not come back, so the numbers are not a reading of the chain */
  read?: boolean
}

export interface StatsResponse {
  router: Window & {
    swaps: number
    wallets: number
    fromInterface: number
    arrivals: number
    /** swaps by the number of pools they crossed */
    byPools: Record<string, number>
    volumeUsd: number
    unpriced: number
  }
  tagged: Window & {
    swaps: number
    improved: number
    avgGainPct: number | null
    extraUsd: number
    vsQuotePct: number | null
  }
  benchmark: { trade: string; onePool: string | null; twoPools: string | null; site: string; vsTwoPct: number | null; route: string }[]
  uptime: { month: string; sites: { site: string; checks: number; up: number; pct: number; last: string | null }[] } | null
  at: number
}

function attrsOf(ev: Ev): Record<string, string> {
  const at: Record<string, string> = {}
  for (const a of ev.attributes) if (!(a.key in at)) at[a.key] = a.value
  return at
}

/** Transactions matching `query` in the last `days`, newest first, at most `maxPages` pages of 100. */
async function recentTxs(query: string, days: number, maxPages: number): Promise<Window & { txs: Tx[] }> {
  const txs: Tx[] = []
  const cutoff = Date.now() - days * DAY
  let since: string | null = null
  let complete = false
  let read = false
  for (let page = 1; page <= maxPages; page++) {
    let j: { tx_responses?: Tx[]; txs?: { body?: Tx['body'] }[] } | null = null
    for (let attempt = 0; attempt < 2 && !j; attempt++) {
      try {
        const r = await lcdFetch(`/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&order_by=ORDER_BY_DESC&limit=100&page=${page}`, { headers: UA, kind: 'txs', timeoutMs: 25_000 })
        if (r.ok) j = await r.json()
      } catch { /* one more try */ }
    }
    if (!j) break
    read = true
    const rs = j?.tx_responses ?? [], bodies = j?.txs ?? []
    let past = false
    rs.forEach((r, i) => {
      if (Date.parse(r.timestamp) < cutoff) { past = true; return }
      since = r.timestamp
      txs.push({ ...r, body: bodies[i]?.body })
    })
    if (past || rs.length < 100) { complete = true; break }
  }
  return { txs, since, complete, read }
}

function routerActivity(w: Window & { txs: Tx[] }, tokens: Map<string, KnownToken>, px: Record<string, number>): StatsResponse['router'] {
  let swaps = 0, fromInterface = 0, arrivals = 0, volumeUsd = 0, unpriced = 0
  const wallets = new Set<string>()
  const byPools: Record<string, number> = {}
  for (const tx of w.txs) {
    if (tx.code) continue
    const arrival = (tx.body?.messages ?? []).some(m => String(m['@type'] ?? '').endsWith('MsgRecvPacket'))
    const site = String(tx.body?.memo ?? '').startsWith('Terra Swap')
    for (const ev of tx.events) {
      if (ev.type !== 'wasm') continue
      const at = attrsOf(ev)
      if (!TERRA_SWAP_ROUTERS.includes(at._contract_address ?? '') || at.action !== 'execute_swap_operations') continue
      swaps++
      if (arrival) arrivals++
      else if (site) fromInterface++
      if (at.receiver) wallets.add(at.receiver)
      byPools[at.operations ?? '?'] = (byPools[at.operations ?? '?'] ?? 0) + 1
      const t = tokens.get(at.offer_asset ?? ''), price = px[at.offer_asset ?? '']
      if (t && price > 0) volumeUsd += (Number(at.offer_amount) / 10 ** t.decimals) * price
      else unpriced++
    }
  }
  return { swaps, wallets: wallets.size, fromInterface, arrivals, byPools, volumeUsd, unpriced, since: w.since, complete: w.complete, read: w.read }
}

function taggedSwaps(txs: Tx[], window: Window, pools: PoolView[], px: Record<string, number>): StatsResponse['tagged'] {
  const byLabel = new Map<string, KnownToken>()
  for (const p of pools) for (const t of p.tokens) byLabel.set(t.label, t)
  const seen = new Set<string>()
  let swaps = 0, improved = 0, gainSum = 0, extraUsd = 0, vsSum = 0, vsN = 0
  for (const tx of txs) {
    if (tx.code || seen.has(tx.txhash)) continue
    seen.add(tx.txhash)
    const memo = String(tx.body?.memo ?? '')
    const tag = memo.startsWith('Terra Swap') ? readTradeMemo(memo) : null
    if (!tag) continue
    swaps++
    const token = byLabel.get(tag.label)
    const signer = String(tx.body?.messages?.[0]?.sender ?? '')
    if (token && signer && tag.quote > 0) {
      let received = 0
      for (const ev of tx.events) {
        if (ev.type !== 'wasm') continue
        const at = attrsOf(ev)
        if (at.action === 'swap' && at.receiver === signer && at.ask_asset === assetId(token.info)) received += Number(at.return_amount ?? '0')
      }
      if (received > 0) { vsSum += (received / 10 ** token.decimals / tag.quote - 1) * 100; vsN++ }
    }
    if (tag.gainPct != null && tag.gainPct >= 0.005) {
      improved++
      gainSum += tag.gainPct
      const price = token ? px[assetId(token.info)] : 0
      if (price > 0) extraUsd += tag.quote * price * (tag.gainPct / (100 + tag.gainPct))
    }
  }
  return { swaps, improved, avgGainPct: improved ? gainSum / improved : null, extraUsd, vsQuotePct: vsN ? vsSum / vsN : null, ...window }
}

/** A few trades priced three ways: the best single pool, the best path through up to two pools, and what the site signs. */
async function benchmark(pools: PoolView[], px: Record<string, number>): Promise<StatsResponse['benchmark']> {
  const byKey = new Map<string, KnownToken>()
  for (const p of pools) for (const t of p.tokens) byKey.set(t.key, t)
  const trades: [string, string, number][] = [['LUNA', 'USDC', 5000], ['SOLID', 'USDC', 5000], ['PAXG', 'USDC', 5000], ['USDC', 'LUNA', 5000]]
  const fmt = (micro: bigint | null, t: KnownToken) => (micro == null ? null : `${(Number(micro) / 10 ** t.decimals).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t.label}`)
  // One trade at a time: a dozen quotes at once is several hundred simulations, which public endpoints start refusing.
  const rows: (StatsResponse['benchmark'][number] | null)[] = []
  for (const trade of trades) rows.push(await priceTrade(trade).catch(() => null))
  return rows.filter((r): r is NonNullable<typeof r> => r !== null)

  async function priceTrade([a, b, usd]: [string, string, number]): Promise<StatsResponse['benchmark'][number] | null> {
    const from = byKey.get(a), to = byKey.get(b)
    const price = from ? px[assetId(from.info)] : 0
    if (!from || !to || !(price > 0)) return null
    const micro = toMicro((usd / price).toFixed(Math.min(from.decimals, 6)), from.decimals)
    if (!micro || micro === '0') return null
    const direct = pools.filter(p => p.tokens.some(t => t.key === a) && p.tokens.some(t => t.key === b))
    const [one, two, all] = await Promise.all([
      quoteBest(direct, from, to, micro, undefined, { slip: 0.01 }),
      quoteBest(pools, from, to, micro, undefined, { slip: 0.01, threeHop: false }),
      quoteBest(pools, from, to, micro, undefined, { slip: 0.01, split: true }),
    ])
    if (!all.best) return null
    const out = (q: typeof one) => (q.best ? BigInt(planRoute(q.best, 0.01).expectedOut) : null)
    const trade = planTrade(all.split ?? [{ quote: all.best, share: 1 }], 0.01)
    const site = BigInt(trade.expectedOut), twoOut = out(two), oneOut = out(one)
    // The site considers every path the other two do, so it can only come out below them when some simulations
    // failed along the way. Such a reading says nothing about routing; leave the trade out rather than show it.
    const floor = (x: bigint | null) => (x != null && site * BigInt(10_000) < x * BigInt(9_995))
    if (floor(twoOut) || floor(oneOut)) return null
    return {
      trade: `$${usd.toLocaleString('en-US')} of ${a} → ${b}`,
      onePool: fmt(oneOut, to), twoPools: fmt(twoOut, to), site: fmt(site, to) ?? '',
      vsTwoPct: twoOut && twoOut > BigInt(0) ? (Number(site) / Number(twoOut) - 1) * 100 : null,
      route: tradeText(trade.parts),
    }
  }
}

/** This month's uptime log, as the uptime workflow writes it on the status branch. */
async function uptime(): Promise<StatsResponse['uptime']> {
  const month = new Date().toISOString().slice(0, 7)
  // raw.githubusercontent.com first; GitHub's contents API serves the same file when that host does not answer.
  const readLog = async (): Promise<string | null> => {
    try {
      const r = await fetch(`${UPTIME_LOG}/${month}.jsonl`, { headers: UA, signal: AbortSignal.timeout(10_000) })
      if (r.ok) return await r.text()
    } catch { /* try the API */ }
    try {
      const r = await fetch(`${UPTIME_API}/${month}.jsonl?ref=status`, { headers: { ...UA, accept: 'application/vnd.github.raw' }, signal: AbortSignal.timeout(10_000) })
      if (r.ok) return await r.text()
    } catch { /* no log */ }
    return null
  }
  try {
    const text = await readLog()
    if (text == null) return null
    const lines = text.split('\n').filter(Boolean)
    const sites = new Map<string, { site: string; checks: number; up: number; pct: number; last: string | null }>()
    for (const line of lines) {
      let row: { t?: string; site?: string; ok?: boolean }
      try { row = JSON.parse(line) } catch { continue }
      if (!row.site) continue
      const s = sites.get(row.site) ?? { site: row.site, checks: 0, up: 0, pct: 0, last: null }
      s.checks++
      if (row.ok) s.up++
      if (row.t && (!s.last || row.t > s.last)) s.last = row.t
      sites.set(row.site, s)
    }
    return { month, sites: Array.from(sites.values()).map(s => ({ ...s, pct: s.checks ? (100 * s.up) / s.checks : 0 })) }
  } catch { return null }
}

/** Several scans as one window: every transaction once, complete only when each scan is, back to the latest point an incomplete scan reached. */
function mergeWindows(parts: (Window & { txs: Tx[] })[]): Window & { txs: Tx[] } {
  const seen = new Set<string>()
  const txs: Tx[] = []
  for (const p of parts) for (const tx of p.txs) { if (!seen.has(tx.txhash)) { seen.add(tx.txhash); txs.push(tx) } }
  txs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const cut = parts.filter(p => !p.complete).map(p => p.since).filter((s): s is string => !!s).sort().pop() ?? null
  return { txs, since: cut, complete: parts.every(p => p.complete), read: parts.length === 0 || parts.some(p => p.read !== false) }
}

export async function computeStats(pools: PoolView[], px: Record<string, number>): Promise<StatsResponse> {
  const tokens = new Map<string, KnownToken>()
  for (const p of pools) for (const t of p.tokens) tokens.set(assetId(t.info), t)
  const [routerParts, astro, bench, up] = await Promise.all([
    // Both of Terra Swap's routers: v1 until the switch to router v2 on 2026-09-16, v2 since.
    Promise.all(TERRA_SWAP_ROUTERS.map(r => recentTxs(`wasm._contract_address='${r}'`, WINDOW_DAYS, 10))),
    // Astroport's router writes no attributes of its own, so its calls are found by the execute event.
    recentTxs(`execute._contract_address='${ASTRO_ROUTER}'`, WINDOW_DAYS, 5),
    benchmark(pools, px).catch(() => []),
    uptime(),
  ])
  const router = mergeWindows(routerParts)
  // A scan that reached 30 days covers the whole window; one that stopped early covers back to its oldest transaction.
  // The tag counts cover the shorter of the two: Astroport's router is busy, and its scan may stop early.
  const bound = (w: Window) => (w.complete ? null : w.since)
  const since = [bound(router), bound(astro)].filter((s): s is string => !!s).sort().pop() ?? null
  return {
    router: routerActivity(router, tokens, px),
    tagged: taggedSwaps([...router.txs, ...astro.txs], { since, complete: router.complete && astro.complete, read: router.read !== false && astro.read !== false }, pools, px),
    benchmark: bench,
    uptime: up,
    at: Date.now(),
  }
}
