#!/usr/bin/env node
/**
 * The monthly maintenance report, built only from public data: the uptime log
 * on this repository's `status` branch, the chain, the sites' public APIs,
 * and this repository's git history. Anyone can run it and get the same
 * numbers.
 *
 * usage: node scripts/monthly-report.mjs <statusDir> [YYYY-MM] [maintenanceAddress]
 *
 * Without a month it reports on the previous calendar month (UTC). Writes
 * <statusDir>/reports/YYYY-MM.md and prints the same Markdown.
 *
 * The routing section re-prices trades with the site's own lib/route, compiled
 * to CommonJS and found through NODE_PATH, the way the workflow runs it:
 *   npx tsc lib/route.ts --module commonjs --target es2020 --lib es2020,dom \
 *     --moduleResolution node --baseUrl . --rootDir . --outDir .report-lib --skipLibCheck
 *   NODE_PATH=.report-lib node scripts/monthly-report.mjs …
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const [dir = 'status-data', monthArg = '', maintArg = ''] = process.argv.slice(2)
const now = new Date()
const month = /^\d{4}-\d{2}$/.test(monthArg)
  ? monthArg
  : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
const start = new Date(`${month}-01T00:00:00Z`)
const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
const maintenance = /^terra1[0-9a-z]{38,58}$/.test(maintArg) ? maintArg : ''
const CHECK_MINUTES = 10
const FACTORY = 'terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd'
const LCDS = ['https://terra-api.polkachu.com', 'https://terra-lcd.publicnode.com']
const UA = { 'user-agent': 'terra-swap-report (+https://github.com/solid-online/terra-swap)', accept: 'application/json' }

const usd = (n) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)
const pct = (n) => `${n.toFixed(2)}%`
const minutes = (m) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m} min`)

async function getJson(url, timeout = 30_000) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) })
      if (r.ok) return await r.json()
      if (![429, 500, 502, 503, 504].includes(r.status)) return null
    } catch { /* try again */ }
    await new Promise((res) => setTimeout(res, 2_000))
  }
  return null
}
async function lcd(path, timeout) {
  for (const base of LCDS) {
    const j = await getJson(base + path, timeout)
    if (j) return j
  }
  return null
}
const smart = (contract, msg) => lcd(`/cosmwasm/wasm/v1/contract/${contract}/smart/${encodeURIComponent(Buffer.from(JSON.stringify(msg)).toString('base64'))}`).then((j) => j?.data ?? null)

/** Every tx touching `query`, newest first, stopping once past the start of the month. */
async function txsInMonth(query) {
  const out = []
  for (let page = 1; page <= 30; page++) {
    const j = await lcd(`/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&order_by=ORDER_BY_DESC&limit=100&page=${page}`, 45_000)
    const rs = j?.tx_responses ?? []
    const txs = j?.txs ?? []
    rs.forEach((r, i) => { r._body = txs[i]?.body })
    let older = false
    for (const r of rs) {
      const t = new Date(r.timestamp)
      if (t >= end) continue
      if (t < start) { older = true; continue }
      out.push(r)
    }
    if (older || rs.length < 100) break
  }
  return out
}

// ─── Uptime ─────────────────────────────────────────────────────

function uptimeSection() {
  const file = join(dir, 'uptime', `${month}.jsonl`)
  if (!existsSync(file)) return ['No uptime log exists for this month.']
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const bySite = new Map()
  for (const r of rows) {
    if (!bySite.has(r.site)) bySite.set(r.site, [])
    bySite.get(r.site).push(r)
  }
  const lines = [
    `Checked every ${CHECK_MINUTES} minutes from GitHub's machines. A site is up when its page loads and its data API answers with live data.`,
    '',
    '| Site | Checks | Up | Down checks |',
    '|---|---:|---:|---:|',
  ]
  const episodes = []
  for (const [site, list] of bySite) {
    list.sort((a, b) => a.t.localeCompare(b.t))
    const down = list.filter((r) => !r.ok)
    lines.push(`| ${site} | ${list.length} | ${pct((100 * (list.length - down.length)) / list.length)} | ${down.length} |`)
    let run = null
    for (const r of list) {
      if (!r.ok) {
        if (!run) run = { site, from: r.t, to: r.t, checks: 0, detail: r.detail }
        run.to = r.t; run.checks++
      } else if (run) { episodes.push(run); run = null }
    }
    if (run) episodes.push(run)
  }
  lines.push('')
  if (episodes.length === 0) lines.push('No downtime was recorded.')
  else {
    lines.push('Downtime, as recorded (each failed check stands for about ten minutes):', '')
    for (const e of episodes) lines.push(`- ${e.site}: ${e.from} to ${e.to}, about ${minutes(e.checks * CHECK_MINUTES)}. ${e.detail ?? ''}`)
  }
  return lines
}

// ─── Terra Swap on chain ────────────────────────────────────────

async function terraSwapSection() {
  const pairs = []
  let startAfter
  for (let i = 0; i < 20; i++) {
    const r = await smart(FACTORY, { pairs: { limit: 30, ...(startAfter ? { start_after: startAfter } : {}) } })
    const got = r?.pairs ?? []
    pairs.push(...got)
    if (got.length < 30) break
    startAfter = got[got.length - 1].asset_infos
  }
  const dex = await getJson('https://swap.openfields.app/api/dex')
  const market = await getJson('https://swap.openfields.app/api/dex-market')
  const px = market?.px ?? {}
  const decimals = {}
  for (const p of dex?.pools ?? []) for (const t of p.tokens) decimals['native_token' in t.info ? t.info.native_token.denom : t.info.token.contract_addr] = t.decimals

  let swaps = 0, volume = 0, unpriced = 0
  const wallets = new Set()
  const perPool = []
  for (const p of pairs) {
    const txs = await txsInMonth(`wasm._contract_address='${p.contract_addr}'`)
    let n = 0
    for (const tx of txs) {
      for (const ev of tx.events ?? []) {
        if (ev.type !== 'wasm') continue
        const at = Object.fromEntries(ev.attributes.map((a) => [a.key, a.value]))
        if (at._contract_address !== p.contract_addr || at.action !== 'swap') continue
        n++; swaps++
        const sender = tx._body?.messages?.[0]?.sender
        if (sender) wallets.add(sender)
        const price = px[at.offer_asset], dec = decimals[at.offer_asset]
        if (price > 0 && dec != null) volume += (Number(at.offer_amount) / 10 ** dec) * price
        else unpriced++
      }
    }
    if (n > 0) {
      const label = (dex?.pools ?? []).find((x) => x.contract_addr === p.contract_addr)?.label ?? p.contract_addr
      perPool.push([n, label])
    }
  }
  perPool.sort((a, b) => b[0] - a[0])
  const lines = [
    `- Pools on the factory: ${pairs.length}`,
    `- Liquidity when this report was generated: ${dex ? usd(dex.tvlUsd) : 'unavailable'}`,
    `- Swaps in ${month}: ${swaps}, by ${wallets.size} wallet${wallets.size === 1 ? '' : 's'}`,
    `- Volume in ${month}: about ${usd(volume)} at the prices on the day this report was generated${unpriced ? ` (${unpriced} swap${unpriced === 1 ? '' : 's'} in tokens without a price are not counted)` : ''}`,
  ]
  if (perPool.length) lines.push(`- Most traded: ${perPool.slice(0, 5).map(([n, l]) => `${l} (${n})`).join(', ')}`)
  return lines
}

// ─── Routing ────────────────────────────────────────────────────

/** Terra Swap's router (contracts/router), on chain since 2026-09-14. */
const ROUTER = 'terra1u2uh0jsl2u76j52e6egf09zslsns27qsmzxxzcsxdxymeax8883s9prc4l'
/** Re-priced every month: the pairs people come for, at two sizes. */
const BENCH_PAIRS = [['LUNA', 'USDC'], ['SOLID', 'USDC'], ['CAPA', 'USDC'], ['ROAR', 'USDC'], ['PAXG', 'USDC'], ['EURe', 'USDC'], ['USDC', 'LUNA'], ['USDC', 'SOLID']]
const BENCH_USD = [100, 5000]
const BENCH_SLIP = 0.01
const assetKey = (info) => ('native_token' in info ? info.native_token.denom : info.token.contract_addr)

async function routerUsage(txs, decimals, px) {
  let swaps = 0, arrivals = 0, fromSite = 0, volume = 0, unpriced = 0
  const wallets = new Set()
  const byPools = new Map()
  const seen = new Set()
  for (const tx of txs) {
    if (seen.has(tx.txhash)) continue
    seen.add(tx.txhash)
    // A swap on arrival is run by Terra's IBC hooks inside the relayer's transaction that delivers the USDC.
    const arrival = (tx._body?.messages ?? []).some((m) => String(m['@type']).endsWith('MsgRecvPacket'))
    const site = String(tx._body?.memo ?? '').startsWith('Terra Swap')
    for (const ev of tx.events ?? []) {
      if (ev.type !== 'wasm') continue
      const at = Object.fromEntries(ev.attributes.map((a) => [a.key, a.value]))
      if (at._contract_address !== ROUTER || at.action !== 'execute_swap_operations') continue
      swaps++
      if (arrival) arrivals++
      else if (site) fromSite++
      wallets.add(at.receiver)
      byPools.set(at.operations, (byPools.get(at.operations) ?? 0) + 1)
      const price = px[at.offer_asset], dec = decimals[at.offer_asset]
      if (price > 0 && dec != null) volume += (Number(at.offer_amount) / 10 ** dec) * price
      else unpriced++
    }
  }
  const lines = [`- Swaps through Terra Swap's router (${ROUTER}) in ${month}: ${swaps}, to ${wallets.size} wallet${wallets.size === 1 ? '' : 's'}`]
  if (swaps > 0) {
    lines.push(
      `- Signed from the Terra Swap interface: ${fromSite}; USDC from Noble swapped on arrival: ${arrivals}; other callers: ${swaps - fromSite - arrivals}`,
      `- By pools crossed: ${[...byPools].sort((a, b) => Number(a[0]) - Number(b[0])).map(([n, c]) => `${n}: ${c}`).join(', ')}`,
      `- Volume: about ${usd(volume)} at the prices on the day this report was generated${unpriced ? ` (${unpriced} swap${unpriced === 1 ? '' : 's'} in tokens without a price are not counted)` : ''}`,
    )
  }
  lines.push("- Routes made only of Astroport's pools go through Astroport's own router and are not counted here.")
  return lines
}

/** Astroport's router on Terra. It writes no attributes of its own, so its calls are found by the execute event. */
const ASTRO_ROUTER = 'terra1j8hayvehh3yy02c2vtw5fdhz9f4drhtee8p5n5rguvg3nyd6m83qd2y90a'
/** lib/route tradeMemo, read back: "split swap (quote 4923.246400 USDC, +1.03% vs 2 pools)". */
const MEMO_TAG = /(split swap|routed swap|swap) \(quote ([\d.]+) ([^,)\s]+)(?:, ([+-][\d.]+)% vs 2 pools)?\)/

/**
 * Swaps signed on the interface carry their quote and what paths through three
 * pools and splitting added over the best path through up to two pools
 * (lib/route tradeMemo). Every such trade passes through a router: a split
 * signs each part through one. So the month's router transactions hold all of
 * them, and what arrived is on chain beside what was quoted.
 */
async function interfaceSwaps(routerTxs, pools, px) {
  const astro = await txsInMonth(`execute._contract_address='${ASTRO_ROUTER}'`)
  const byLabel = new Map()
  for (const p of pools) for (const t of p.tokens) byLabel.set(t.label, t)
  const seen = new Set()
  let tagged = 0, improved = 0, gainSum = 0, extraUsd = 0, unpricedGain = 0, realizedSum = 0, realizedN = 0
  for (const tx of [...routerTxs, ...astro]) {
    if (seen.has(tx.txhash) || tx.code) continue
    seen.add(tx.txhash)
    const memo = String(tx._body?.memo ?? '')
    const m = memo.startsWith('Terra Swap') ? MEMO_TAG.exec(memo) : null
    if (!m) continue
    tagged++
    const quote = Number(m[2]), token = byLabel.get(m[3]), gain = m[4] != null ? Number(m[4]) : null
    const signer = tx._body?.messages?.[0]?.sender
    if (token && signer) {
      let received = 0n
      for (const ev of tx.events ?? []) {
        if (ev.type !== 'wasm') continue
        const at = Object.fromEntries(ev.attributes.map((a) => [a.key, a.value]))
        if (at.action === 'swap' && at.receiver === signer && at.ask_asset === assetKey(token.info)) received += BigInt(at.return_amount ?? '0')
      }
      if (received > 0n && quote > 0) { realizedSum += (Number(received) / 10 ** token.decimals / quote - 1) * 100; realizedN++ }
    }
    if (gain != null && gain >= 0.005) {
      improved++
      gainSum += gain
      const price = token ? px[assetKey(token.info)] : 0
      if (price > 0) extraUsd += quote * price * (gain / (100 + gain)); else unpricedGain++
    }
  }
  if (tagged === 0) return ['- No swap signed on the interface this month carried the quote tag (it was added on 2026-09-14).']
  const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  return [
    `- Swaps signed on the interface with the quote tag: ${tagged}`,
    `- Where paths through three pools or splitting added something: ${improved}${improved ? `, ${signed(gainSum / improved)} on average` : ''}`,
    ...(improved ? [`- What that added: about ${usd(extraUsd)} more delivered, at the prices on the day this report was generated${unpricedGain ? ` (${unpricedGain} swap${unpricedGain === 1 ? '' : 's'} into tokens without a price not counted)` : ''}`] : []),
    ...(realizedN ? [`- What arrived against the quote: ${signed(realizedSum / realizedN)} on average over ${realizedN} swap${realizedN === 1 ? '' : 's'}`] : []),
  ]
}

/** The same trades priced three ways with the site's own routing code, compiled by the workflow. */
async function routeBenchmark(pools, px) {
  let route
  try {
    route = createRequire(import.meta.url)('lib/route')
  } catch {
    return ["The site's routing code was not compiled where this report was generated (see .github/workflows/monthly-report.yml), so no trades were re-priced."]
  }
  const tokens = new Map()
  for (const p of pools) for (const t of p.tokens) tokens.set(t.key, t)
  const out = (q) => (q.best ? BigInt(route.planRoute(q.best, BENCH_SLIP).expectedOut) : null)
  const rows = []
  for (const [a, b] of BENCH_PAIRS) {
    const from = tokens.get(a), to = tokens.get(b)
    const price = from ? px[assetKey(from.info)] : 0
    if (!from || !to || !(price > 0)) continue
    const direct = pools.filter((p) => p.tokens.some((t) => t.key === a) && p.tokens.some((t) => t.key === b))
    for (const size of BENCH_USD) {
      const amount = ((BigInt(Math.round((size / price) * 1e6)) * 10n ** BigInt(from.decimals)) / 1_000_000n).toString()
      const one = await route.quoteBest(direct, from, to, amount, undefined, { slip: BENCH_SLIP })
      const two = await route.quoteBest(pools, from, to, amount, undefined, { slip: BENCH_SLIP, threeHop: false })
      const all = await route.quoteBest(pools, from, to, amount, undefined, { slip: BENCH_SLIP, split: true })
      if (!all.best) continue
      const trade = route.planTrade(all.split ?? [{ quote: all.best, share: 1 }], BENCH_SLIP)
      rows.push({ label: `${usd(size)} of ${a} → ${b}`, one: out(one), two: out(two), site: BigInt(trade.expectedOut), how: route.tradeText(trade.parts), to })
    }
  }
  if (rows.length === 0) return ['No trade could be re-priced when this report was generated.']
  const amt = (x, t) => (x == null ? '—' : (Number(x) / 10 ** t.decimals).toLocaleString('en-US', { maximumFractionDigits: 4 }))
  const gain = (x, base) => (base == null || base === 0n ? null : (Number(x) / Number(base) - 1) * 100)
  const signed = (g) => (g == null ? '—' : Math.abs(g) < 0.005 ? '0' : `${g > 0 ? '+' : ''}${g.toFixed(2)}%`)
  const lines = [
    "Re-priced when this report was generated, with the routing code the site runs (lib/route) against each pool's own simulation, before network fees, at 1% slippage. *One pool* is the best single pool for the pair on either site. *Up to two pools* is the best path through one or two pools. *The site* is what the swap page signs, which also considers paths through three pools and splitting the amount over two paths that share no pool.",
    '',
    '| Trade | One pool | Up to two pools | The site | vs one pool | vs up to two pools | Route |',
    '|---|---:|---:|---:|---:|---:|---|',
  ]
  const vsTwo = []
  for (const r of rows) {
    const g2 = gain(r.site, r.two)
    if (g2 != null) vsTwo.push(g2)
    lines.push(`| ${r.label} | ${amt(r.one, r.to)} | ${amt(r.two, r.to)} | ${amt(r.site, r.to)} ${r.to.label} | ${signed(gain(r.site, r.one))} | ${signed(g2)} | ${r.how} |`)
  }
  const better = vsTwo.filter((g) => g >= 0.005)
  lines.push('', `Paths through three pools and splits delivered more than the best path through at most two pools in ${better.length} of ${vsTwo.length} trades${better.length ? `, by ${(better.reduce((s, g) => s + g, 0) / better.length).toFixed(2)}% on average where they did` : ''}.`)
  return lines
}

async function routingSection() {
  const [{ dex, venue }, market] = await Promise.all([sitePools(), getJson('https://swap.openfields.app/api/dex-market')])
  const px = market?.px ?? {}
  const pools = [...(dex?.pools ?? []), ...(venue?.pools ?? [])].filter((p) => !p.empty)
  const decimals = {}
  for (const p of pools) for (const t of p.tokens) decimals[assetKey(t.info)] = t.decimals
  const routerTxs = await txsInMonth(`wasm._contract_address='${ROUTER}'`)
  return [
    ...(await routerUsage(routerTxs, decimals, px)),
    '',
    '### Swaps signed on the interface',
    '',
    ...(await interfaceSwaps(routerTxs, pools, px)),
    '',
    '### What the routing is worth',
    '',
    ...(await routeBenchmark(pools, px)),
  ]
}

// ─── The pools interface and Atrium ─────────────────────────────

/** Both sites' pools as swap.openfields.app serves them, fetched once for the sections that need them. */
let poolsOnce = null
function sitePools() {
  poolsOnce ??= Promise.all([
    getJson('https://swap.openfields.app/api/dex'),
    getJson('https://swap.openfields.app/api/dex-venue', 120_000),
  ]).then(([dex, venue]) => ({ dex, venue }))
  return poolsOnce
}

async function poolsSection() {
  // Astroport's pools are listed on swap.openfields.app since pools.openfields.app was folded into it (2026-09-14).
  const { venue } = await sitePools()
  if (!venue) return ['- The Astroport pool list did not answer when this report was generated.']
  const tvl = (venue.pools ?? []).reduce((s, p) => s + (p.tvlUsd ?? 0), 0)
  return [
    `- Astroport pools listed: ${venue.pools.length}`,
    `- Liquidity reachable through them when this report was generated: ${usd(tvl)}`,
  ]
}

async function atriumSection() {
  const s = await getJson('https://atrium.markets/api/atrium/stats')
  if (!s) return ['- Atrium did not answer when this report was generated.']
  return [
    `- Marketplace contract deployed: ${s.contractDeployed ? 'yes' : 'no'}, paused: ${s.paused ? 'yes' : 'no'}`,
    `- Listings live when this report was generated: ${s.totalListings}, across ${s.allowedCollections} allowed collections`,
  ]
}

// ─── Changes and payments ───────────────────────────────────────

function changesSection() {
  try {
    const log = execFileSync('git', ['log', `--since=${start.toISOString()}`, `--until=${end.toISOString()}`, '--no-merges', '--pretty=format:%h %ad %s', '--date=short'], { encoding: 'utf8' }).trim()
    if (!log) return ['No changes were shipped to this repository this month.']
    return ['From this repository\'s history (github.com/solid-online/terra-swap):', '', ...log.split('\n').map((l) => `- ${l}`)]
  } catch {
    return ['The git history was not available where this report was generated.']
  }
}

async function paymentsSection() {
  if (!maintenance) return ['No maintenance address is set yet, so there are no payments to report.']
  const txs = await txsInMonth(`transfer.recipient='${maintenance}'`)
  let uluna = BigInt(0)
  const hashes = new Set()
  for (const tx of txs) {
    for (const ev of tx.events ?? []) {
      if (ev.type !== 'transfer') continue
      const at = Object.fromEntries(ev.attributes.map((a) => [a.key, a.value]))
      if (at.recipient !== maintenance || !at.amount) continue
      for (const part of at.amount.split(',')) {
        const m = /^(\d+)uluna$/.exec(part.trim())
        if (m) { uluna += BigInt(m[1]); hashes.add(tx.txhash) }
      }
    }
  }
  return [
    `Maintenance address: ${maintenance}`,
    '',
    `- LUNA received in ${month}: ${(Number(uluna) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })} LUNA, in ${hashes.size} transaction${hashes.size === 1 ? '' : 's'}`,
    ...[...hashes].map((h) => `  - ${h}`),
  ]
}

// ─── Assemble ───────────────────────────────────────────────────

const md = [
  `# Maintenance report, ${month}`,
  '',
  `Generated ${new Date().toISOString().slice(0, 16)}Z from public data by scripts/monthly-report.mjs. Anyone can run the same script and check every number.`,
  '',
  '## Uptime',
  '',
  ...uptimeSection(),
  '',
  '## Terra Swap',
  '',
  ...(await terraSwapSection()),
  '',
  '## Astroport pools',
  '',
  ...(await poolsSection()),
  '',
  '## Routing',
  '',
  ...(await routingSection()),
  '',
  '## Atrium',
  '',
  ...(await atriumSection()),
  '',
  '## What changed',
  '',
  ...changesSection(),
  '',
  '## Payments received',
  '',
  ...(await paymentsSection()),
  '',
].join('\n')

mkdirSync(join(dir, 'reports'), { recursive: true })
writeFileSync(join(dir, 'reports', `${month}.md`), md)
console.log(md)
