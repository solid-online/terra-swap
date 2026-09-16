#!/usr/bin/env node
/**
 * One outside check of Terra itself, appended as a JSON line to
 * <dir>/chain/YYYY-MM-DD.jsonl:
 *
 *   {"t":"2026-09-16T08:10Z","h":22862000,"age":4.1,
 *    "ep":{"rest:terra-lcd.publicnode.com":[1,110],…},
 *    "ibc":{"channel-253":1,…}}
 *
 * h and age: the best block height any endpoint gave, and how old that block
 * was. ep: every public endpoint (the Cosmos chain registry's list for terra2,
 * plus a few apps use that it does not list), 1 when it answered within 20
 * blocks of the best, with its response time from here. ibc: whether each of
 * Terra's main bridges was fine, from status.openfields.app's own reading,
 * which costs a few dozen transaction searches and is not repeated here.
 *
 * .github/workflows/uptime.yml runs it every ten minutes on GitHub's machines,
 * beside the uptime check, so the log is measured from outside the servers it
 * describes. Terra Status reads it back for its History section.
 *
 * usage: node scripts/chain-check.mjs <dir>
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'status-data'
const UA = 'terraluna-status-check (+https://status.openfields.app)'
const REGISTRY = 'https://raw.githubusercontent.com/cosmos/chain-registry/master/terra2/chain.json'
const IBC = 'https://status.openfields.app/api/ibc?compact=1'
const TIMEOUT_MS = 10_000
const LAG_BLOCKS = 20

/** Used by apps, but not in the registry. Keep in step with terraluna-status lib/status/endpoints.ts. */
const EXTRA = [
  ['rest', 'https://terra-lcd.publicnode.com'],
  ['rest', 'https://terra-api.polkachu.com'],
  ['rest', 'https://terra-lcd.stakely.io'],
  ['rest', 'https://rest.cosmos.directory/terra2'],
  ['rpc', 'https://rpc.cosmos.directory/terra2'],
]

const norm = (u) => u.trim().replace(/\/+$/, '').replace(/:443$/, '')
const keyOf = (kind, url) => `${kind}:${norm(url).replace(/^https?:\/\//, '')}`

async function endpointList() {
  const out = new Map()
  try {
    const r = await fetch(REGISTRY, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const j = r.ok ? await r.json() : null
    for (const kind of ['rpc', 'rest']) {
      for (const a of j?.apis?.[kind] ?? []) {
        if (typeof a?.address === 'string' && a.address.startsWith('https://')) out.set(keyOf(kind, a.address), [kind, norm(a.address)])
      }
    }
  } catch { /* the extras still get checked */ }
  for (const [kind, url] of EXTRA) if (!out.has(keyOf(kind, url))) out.set(keyOf(kind, url), [kind, norm(url)])
  return Array.from(out.entries())
}

async function probe(kind, url) {
  const started = Date.now()
  try {
    const path = kind === 'rpc' ? '/status' : '/cosmos/base/tendermint/v1beta1/blocks/latest'
    const r = await fetch(url + path, { headers: { 'user-agent': UA, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const ms = Date.now() - started
    if (r.status !== 200) return { ms, height: null, time: null, catchingUp: false }
    const j = await r.json().catch(() => null)
    if (kind === 'rpc') {
      const s = j?.result?.sync_info
      return { ms, height: Number(s?.latest_block_height) || null, time: s?.latest_block_time ?? null, catchingUp: s?.catching_up === true }
    }
    return { ms, height: Number(j?.block?.header?.height) || null, time: j?.block?.header?.time ?? null, catchingUp: false }
  } catch {
    return { ms: null, height: null, time: null, catchingUp: false }
  }
}

const list = await endpointList()
const [results, ibc] = await Promise.all([
  Promise.all(list.map(async ([key, [kind, url]]) => [key, await probe(kind, url)])),
  fetch(IBC, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90_000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.ibc ?? null)
    .catch(() => null),
])

const best = results.reduce((m, [, p]) => Math.max(m, p.height ?? 0), 0)
const times = results.filter(([, p]) => p.height === best && p.time).map(([, p]) => Date.parse(p.time)).filter(Number.isFinite)
const blockAt = times.length ? Math.max(...times) : null
const ep = {}
for (const [key, p] of results) ep[key] = [p.height !== null && !p.catchingUp && best - p.height <= LAG_BLOCKS ? 1 : 0, p.ms]

const t = new Date().toISOString().slice(0, 16) + 'Z'
const line = JSON.stringify({ t, h: best || null, age: blockAt ? Math.round((Date.now() - blockAt) / 100) / 10 : null, ep, ibc })
mkdirSync(join(dir, 'chain'), { recursive: true })
appendFileSync(join(dir, 'chain', `${t.slice(0, 10)}.jsonl`), line + '\n')
console.log(line)
