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
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

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
  const dex = await getJson('https://swap.terraluna.app/api/dex')
  const market = await getJson('https://swap.terraluna.app/api/dex-market')
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

// ─── The pools interface and Atrium ─────────────────────────────

async function poolsSection() {
  const dex = await getJson('https://pools.terraluna.app/api/dex')
  if (!dex) return ['- The pools interface did not answer when this report was generated.']
  return [
    `- Astroport pools listed: ${dex.pools.length}`,
    `- Liquidity reachable through them when this report was generated: ${usd(dex.tvlUsd)}`,
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
  '## Pools interface',
  '',
  ...(await poolsSection()),
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
