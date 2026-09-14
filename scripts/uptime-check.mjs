#!/usr/bin/env node
/**
 * One uptime check of the maintained sites, appended as JSON lines to
 * <dir>/uptime/YYYY-MM.jsonl.
 *
 * .github/workflows/uptime.yml runs it every 10 minutes on GitHub's machines,
 * so the sites are measured from outside the host that serves them, and the
 * log is public on this repository's `status` branch. A site counts as up
 * only if its page loads and its data API answers with live data. A failed
 * check is retried once after five seconds before it is written down.
 *
 * usage: node scripts/uptime-check.mjs <dir>
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'status-data'
const TIMEOUT_MS = 20_000
const UA = 'terra-swap-uptime (+https://github.com/solid-online/terra-swap)'

const TARGETS = [
  {
    site: 'swap.terraluna.app',
    checks: [
      { url: 'https://swap.terraluna.app/', expect: (r) => r.status === 200 },
      { url: 'https://swap.terraluna.app/api/dex', json: true, expect: (r, j) => r.status === 200 && j?.live === true && j?.pools?.length > 0 },
    ],
  },
  {
    site: 'pools.terraluna.app',
    checks: [
      { url: 'https://pools.terraluna.app/', expect: (r) => r.status === 200 },
      { url: 'https://pools.terraluna.app/api/dex', json: true, expect: (r, j) => r.status === 200 && j?.live === true && j?.pools?.length > 0 },
    ],
  },
  {
    site: 'atrium.markets',
    checks: [
      { url: 'https://atrium.markets/', expect: (r) => r.status === 200 },
      { url: 'https://atrium.markets/api/atrium/stats', json: true, expect: (r, j) => r.status === 200 && j?.contractDeployed === true },
    ],
  },
]

async function once(check) {
  const started = Date.now()
  try {
    const r = await fetch(check.url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    let j = null
    if (check.json) { try { j = await r.json() } catch { j = null } } else { await r.arrayBuffer() }
    const ok = Boolean(check.expect(r, j))
    return { ok, ms: Date.now() - started, detail: ok ? null : `${check.url} answered ${r.status}${check.json && !j ? ' without JSON' : check.json ? ' without live data' : ''}` }
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000}s` : String(e?.cause?.code ?? e?.message ?? e).slice(0, 120)
    return { ok: false, ms: Date.now() - started, detail: `${check.url}: ${why}` }
  }
}

async function checkTwice(check) {
  const first = await once(check)
  if (first.ok) return first
  await new Promise((r) => setTimeout(r, 5_000))
  return once(check)
}

const t = new Date().toISOString().slice(0, 16) + 'Z'
const lines = []
for (const target of TARGETS) {
  const results = await Promise.all(target.checks.map(checkTwice))
  const failed = results.find((r) => !r.ok)
  lines.push(JSON.stringify({ t, site: target.site, ok: !failed, ms: Math.max(...results.map((r) => r.ms)), detail: failed?.detail ?? null }))
}

mkdirSync(join(dir, 'uptime'), { recursive: true })
appendFileSync(join(dir, 'uptime', `${t.slice(0, 7)}.jsonl`), lines.join('\n') + '\n')
console.log(lines.join('\n'))
