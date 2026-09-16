#!/usr/bin/env node
/**
 * One reading of Creda Finance, appended as a JSON line to
 * <dir>/creda/YYYY-MM-DD.jsonl:
 *
 *   {"t":"2026-09-16T09:10Z","supplied":565860.16,"borrowed":97435.39,
 *    "collateral":410355.67,"reserves":371.28,"accounts":182,"borrowers":53,
 *    "atRisk":{"below2":28,"below1_2":7,"debtBelow1_2":7198},
 *    "markets":[{"k":"uluna","s":153043.2,"b":78900.1,"u":0.515,"ltv":0.7,"rate":0.0466}]}
 *
 * Creda is not listed on DefiLlama, so no history of it exists anywhere. This
 * is why the recording starts now and grows forward: a chart of it can only be
 * as old as the day someone began writing it down.
 *
 * Read straight from the contracts, never from Creda's own indexer. An analysis
 * that the measured party can switch off is not an analysis.
 *
 * Two traps this file exists to avoid:
 *
 *  - Amounts are virtual. The real amount is vtotal × index, and every asset
 *    carries its own decimals (6, 8 and 18 all occur here). Getting that wrong
 *    produced 566,988,385,037,302,720 for one market on the first attempt.
 *  - So every per-market sum is checked against the protocol's own `metrics`
 *    total, and the line records the gap. A reading that drifts is a reading
 *    that is wrong, and it should be visible rather than quietly plotted.
 *
 * Rates are stored because the protocol publishes them as parameters. They are
 * a property of the contract, never an offer from us, and nothing downstream
 * may present them as one.
 *
 * usage: node scripts/creda-check.mjs <dir>
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'status-data'
const UA = 'openfields-analytics (+https://openfields.app)'
const TIMEOUT_MS = 25_000

/** From docs.creda.finance, Smart Contract Addresses, phoenix-1. */
const PORTFOLIO = 'terra1y6hfmr3lxxj6srduhlfz96x7sga2984pr757a0nrfuqxa9rqxapqcjv4zz'
const ORACLE = 'terra1wj56ld9e9tuuw6qqr8m5ac8h953te65jcxz7c0dgekrud8lxwjgqryuwg3'

const LCDS = [
  'https://terra-api.polkachu.com',
  'https://terra-lcd.publicnode.com',
  'https://rest.cosmos.directory/terra2',
]

async function smart(contract, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64')
  let failure = null
  for (const lcd of LCDS) {
    try {
      const r = await fetch(`${lcd}/cosmwasm/wasm/v1/contract/${contract}/smart/${encodeURIComponent(q)}`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const j = await r.json()
      if (j?.data !== undefined) return j.data
      failure = new Error(j?.message ?? `${lcd} answered ${r.status}`)
    } catch (e) {
      failure = e
    }
  }
  throw failure ?? new Error('no endpoint answered')
}

/** An asset's key as one short string, so a market keeps the same name across days. */
const keyOf = (info) => info?.native ?? info?.cw20 ?? '?'

const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)

const [metrics, states, prices, portfolios] = await Promise.all([
  smart(PORTFOLIO, { metrics: {} }),
  smart(PORTFOLIO, { asset_states: {} }),
  smart(ORACLE, { prices: {} }),
  smart(PORTFOLIO, { portfolios: { limit: 500 } }),
])

// Price and decimals per asset, from the oracle the protocol itself prices with.
const priceOf = new Map()
for (const p of prices ?? []) {
  priceOf.set(keyOf(p.info), { price: Number(p.price), decimals: Number(p.decimals) })
}

const markets = []
let sumSupplied = 0
let sumBorrowed = 0
let sumReserves = 0
for (const a of states ?? []) {
  const k = keyOf(a.info)
  const meta = priceOf.get(k)
  if (!meta || !Number.isFinite(meta.price) || !Number.isFinite(meta.decimals)) continue
  const unit = 10 ** meta.decimals
  const supplied = (Number(a.supply_vtotal) * Number(a.supply_index)) / unit
  const borrowed = (Number(a.borrow_vtotal) * Number(a.borrow_index)) / unit
  // What the protocol has kept for itself, in the same units as everything else.
  // reserve_total is raw, so it goes through decimals and price like the rest:
  // read as-is it is hundreds of thousands of times too large.
  const reservesUsd = (Number(a.reserve_total) / unit) * meta.price
  const suppliedUsd = supplied * meta.price
  const borrowedUsd = borrowed * meta.price
  sumSupplied += suppliedUsd
  sumBorrowed += borrowedUsd
  sumReserves += reservesUsd
  // A fixed take rate on a market means the protocol charges there even though
  // no reserve factor is set on the ordinary interest.
  const take = a.take_rate && typeof a.take_rate === 'object' ? Number(a.take_rate.fixed) : null
  markets.push({
    k: k.length > 46 ? `${k.slice(0, 43)}…` : k,
    s: round(suppliedUsd),
    b: round(borrowedUsd),
    u: supplied > 0 ? round(borrowed / supplied, 4) : 0,
    ltv: Number(a.ltv),
    rate: round(Number(a.borrow_rate_per_year), 6),
    cap: round(Number(a.supply_cap) / unit, 0),
    res: round(reservesUsd),
    take: Number.isFinite(take) ? take : null,
    liqPenalty: Number(a.liquidation_penalty),
  })
}

// The protocol's own totals are the check on the arithmetic above.
const supplied = Number(metrics?.total_supplied_usd)
const borrowed = Number(metrics?.total_borrowed_usd)
const drift = supplied > 0 ? Math.abs(sumSupplied - supplied) / supplied : null

const withDebt = (portfolios ?? []).filter(p => Number(p.total_borrowed_value) > 0)
const health = p => {
  const h = Number(p.lt_health_factor)
  return Number.isFinite(h) ? h : Infinity
}
const below = n => withDebt.filter(p => health(p) < n)
const debtIn = rows => round(rows.reduce((s, p) => s + Number(p.total_borrowed_value || 0), 0))

const t = `${new Date().toISOString().slice(0, 16)}Z`
const line = JSON.stringify({
  t,
  supplied: round(supplied),
  borrowed: round(borrowed),
  collateral: round(Number(metrics?.total_collateral_usd)),
  reserves: round(Number(metrics?.total_reserves_usd)),
  utilization: supplied > 0 ? round(borrowed / supplied, 4) : null,
  accounts: (portfolios ?? []).length,
  borrowers: withDebt.length,
  atRisk: {
    below2: below(2).length,
    below1_2: below(1.2).length,
    debtBelow1_2: debtIn(below(1.2)),
  },
  // Non-zero means the per-market maths and the protocol's own total disagree.
  drift: drift === null ? null : round(drift, 5),
  markets,
})

mkdirSync(join(dir, 'creda'), { recursive: true })
appendFileSync(join(dir, 'creda', `${t.slice(0, 10)}.jsonl`), `${line}\n`)
console.log(line)
