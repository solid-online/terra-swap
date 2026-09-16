#!/usr/bin/env node
/**
 * One reading of Astroport on Terra, appended as a JSON line to
 * <dir>/astro/YYYY-MM-DD.jsonl.
 *
 * Astroport is the most used app on this chain by a wide margin: 2,589
 * transactions against its pools in a day, against 67 for the money market and
 * 50 for the largest liquid staking hub. Almost all of it lands in a handful of
 * pools, which is the thing worth recording.
 *
 * Read from the factory and the pools themselves, never from Astroport's own
 * API. Their token list is used for nothing at all, not even names: a measured
 * party does not supply the measurements.
 *
 * Five traps this file exists to avoid, all of them met on 2026-09-16:
 *
 *  - A pool's reserve ratio is its price only on xyk pools. Concentrated pools
 *    hold 92% of the value here, and their ratio sits away from the price. Each
 *    one is bracketed by selling a ten-thousandth each way; the geometric mean
 *    cancels the fee.
 *  - Decimals cannot be read from the chain for IBC assets: denoms_metadata has
 *    no entry for Noble USDC or for wBTC. They are resolved through the denom
 *    trace and an explicit table. An asset whose decimals are unknown is left
 *    unpriced rather than guessed at, because a wrong exponent does not look
 *    wrong, it looks like a number.
 *  - A dust pool must not set a price. One abandoned pool once quoted a token
 *    91% away from its real price. Depth decides the route, with a $250 floor.
 *  - The router never appears in a pool's event log; the pair does. Counting
 *    transactions against the router returns zero while the venue is busy.
 *  - Totals are a method, not a fact. DefiLlama leaves liquid staking tokens
 *    out of a DEX's total so the same LUNA is not counted twice, so both
 *    figures are recorded and the page says which convention it is showing.
 *
 * usage: node scripts/astro-check.mjs <dir>
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'status-data'
const UA = 'openfields-analytics (+https://openfields.app)'
const TIMEOUT_MS = 20_000

const FACTORY = 'terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r'
const NOBLE_USDC = 'ibc/2C962DAB9F57FE0921435426AE75196009FAA1981BF86991203C8411F8980FDB'

/** Terra 2 blocks measured at 5.77s, so a day is about this many. */
const BLOCKS_PER_DAY = 15_000
/** Dollars that must stand behind a hop before it may quote a price. */
const MIN_HOP_USD = 250
/** The largest pools carry 2,587 of 2,589 transactions, so this is where activity is counted. */
const ACTIVITY_POOLS = 40

const LCDS = [
  'https://terra-api.polkachu.com',
  'https://rest.cosmos.directory/terra2',
  'https://terra-lcd.publicnode.com',
]
/** publicnode refuses a bounded tx search ("strict equality") and answers 400, which is not a retry. */
const TX_LCDS = ['https://terra-api.polkachu.com', 'https://rest.cosmos.directory/terra2']

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Run `fn` over `items`, at most `limit` at a time. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

async function lcdJson(path, { lcds = LCDS, tries = 2 } = {}) {
  let failure = null
  for (let attempt = 0; attempt < tries; attempt++) {
    for (const lcd of lcds) {
      try {
        const r = await fetch(lcd + path, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const j = await r.json()
        if (j && !j.code) return j
        failure = new Error(j?.message ?? `${lcd} answered ${r.status}`)
      } catch (e) {
        failure = e
      }
    }
    await sleep(300 * (attempt + 1))
  }
  throw failure ?? new Error('no endpoint answered')
}

async function smart(contract, msg, opts) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64')
  const j = await lcdJson(`/cosmwasm/wasm/v1/contract/${contract}/smart/${encodeURIComponent(q)}`, opts)
  return j?.data
}

const trySmart = (contract, msg) => smart(contract, msg).catch(() => null)

// ── Decimals ────────────────────────────────────────────────────────────
//
// Wrong decimals are the most dangerous error here, because the result is a
// plausible-looking number rather than an obvious break. Everything below is
// either read from the chain or listed explicitly.

/**
 * Base denominations as the IBC trace reports them.
 *
 * Listed rather than derived. The u-prefix looks like a rule right up until it
 * is not: `stuatom` and `stuluna` follow it, while `erc20/tether/usdt`,
 * `factory/neutron1…/astro` and `factory/neutron1…/udatom` do not, and wBTC
 * carries 8 decimals where nearly every other bridged EVM asset carries 18.
 * Every entry below was resolved through the chain's own denom trace and then
 * checked against the price it produces: USDT has to land near a dollar and
 * ATOM near a few dollars, or the exponent is wrong.
 */
const BASE_DECIMALS = {
  uluna: 6, uusdc: 6, uusdt: 6, uusd: 6, uatom: 6, uosmo: 6, ueure: 6,
  untrn: 6, ustrd: 6, ukava: 6, uwhale: 6, inj: 18,
  'wbtc-satoshi': 8,
  // Liquid staking derivatives from Stride, which keep the u-prefix.
  stuatom: 6, stuluna: 6, stuosmo: 6,
  // Tether arrives over a bridge that names it by its Ethereum path.
  'erc20/tether/usdt': 6,
  // Token-factory denominations from Neutron: the subdenom is the last segment.
  astro: 6, fuel: 6, udatom: 6, uastro: 6,
}

/**
 * Bridged EVM assets keep their contract address as the denomination, and their
 * decimals are the token's own. wBTC is the reason this is a table and not a
 * rule: it carries 8 decimals while almost every other EVM token carries 18.
 */
const EVM_DECIMALS = {
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,   // wBTC
  '0x45804880de22913dafe09f4980848ece6ecbaf78': 18,  // PAXG
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,  // wETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,   // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,   // USDT
}

const traceCache = new Map()
const cw20Cache = new Map()

/**
 * A cw20's own answer about itself: decimals and symbol in one read, cached, so
 * asking for the symbol later costs nothing. This is the chain's copy, not a
 * token list maintained by the venue being measured.
 */
async function cw20Info(addr) {
  if (cw20Cache.has(addr)) return cw20Cache.get(addr)
  const info = await trySmart(addr, { token_info: {} })
  const d = Number(info?.decimals)
  const v = info && Number.isFinite(d) ? { decimals: d, symbol: String(info.symbol ?? '') } : null
  cw20Cache.set(addr, v)
  return v
}

async function baseDenomOf(hash) {
  if (traceCache.has(hash)) return traceCache.get(hash)
  const j = await lcdJson(`/ibc/apps/transfer/v1/denom_traces/${hash}`).catch(() => null)
  const base = j?.denom_trace?.base_denom ?? null
  traceCache.set(hash, base)
  return base
}

function decimalsForBase(base) {
  if (!base) return null
  if (BASE_DECIMALS[base] !== undefined) return BASE_DECIMALS[base]
  const last = base.includes('/') ? base.split('/').pop() : base
  const lower = (last ?? '').toLowerCase()
  if (EVM_DECIMALS[lower] !== undefined) return EVM_DECIMALS[lower]
  if (BASE_DECIMALS[last] !== undefined) return BASE_DECIMALS[last]
  return null
}

/** Decimals for one denomination, or null when they cannot be established. */
async function decimalsFor(denom) {
  if (BASE_DECIMALS[denom] !== undefined) return BASE_DECIMALS[denom]
  if (denom.startsWith('ibc/')) return decimalsForBase(await baseDenomOf(denom.slice(4)))
  if (denom.startsWith('terra1')) return (await cw20Info(denom))?.decimals ?? null
  // factory/<creator>/<subdenom>: the chain publishes no exponent for these.
  if (denom.startsWith('factory/')) return decimalsForBase(denom.split('/').pop())
  return null
}

// ── Reading the venue ───────────────────────────────────────────────────

async function allPairs() {
  const out = []
  let startAfter = null
  for (let page = 0; page < 60; page++) {
    const msg = { pairs: { limit: 30, ...(startAfter ? { start_after: startAfter } : {}) } }
    const got = (await smart(FACTORY, msg))?.pairs ?? []
    for (const p of got) {
      const type = p.pair_type ?? {}
      const entry = Object.entries(type)[0] ?? ['?', '?']
      out.push({
        addr: p.contract_addr,
        type: typeof entry[1] === 'string' ? entry[1] : entry[0],
        infos: p.asset_infos,
      })
    }
    if (got.length < 30) break
    startAfter = got[got.length - 1].asset_infos
  }
  return out
}

const denomOf = info => info?.native_token?.denom ?? info?.token?.contract_addr ?? null
const infoFor = denom => (denom.startsWith('terra1') ? { token: { contract_addr: denom } } : { native_token: { denom } })

/**
 * Spot price of asset 0 in asset 1. Exact from reserves on xyk; on every other
 * pool type the reserve ratio is not the price, so the pool is asked what it
 * would actually pay in both directions.
 */
async function spotOf(pool, dec) {
  const [a, b] = pool.assets
  const da = dec[a.denom], db = dec[b.denom]
  if (da == null || db == null) return null
  const ra = Number(a.amount) / 10 ** da
  const rb = Number(b.amount) / 10 ** db
  if (!(ra > 0 && rb > 0)) return null
  const ratio = rb / ra
  if (pool.type === 'xyk') return ratio

  const x0 = (BigInt(a.amount) / 10_000n).toString()
  const x1 = (BigInt(b.amount) / 10_000n).toString()
  if (x0 === '0' || x1 === '0') return ratio
  const [s0, s1] = await Promise.all([
    trySmart(pool.addr, { simulation: { offer_asset: { info: infoFor(a.denom), amount: x0 } } }),
    trySmart(pool.addr, { simulation: { offer_asset: { info: infoFor(b.denom), amount: x1 } } }),
  ])
  const r0 = Number(s0?.return_amount), r1 = Number(s1?.return_amount)
  if (!(r0 > 0 && r1 > 0)) return ratio
  const sell = (r0 / 10 ** db) / (Number(x0) / 10 ** da)
  const buy = (Number(x1) / 10 ** db) / (r1 / 10 ** da)
  const mid = Math.sqrt(sell * buy)
  return Number.isFinite(mid) && mid > 0 ? mid : ratio
}

/** USD per asset, derived from the pools alone. USDC anchors; the deepest route wins; dust cannot quote. */
function derivePrices(pools, dec) {
  const px = { [NOBLE_USDC]: 1 }
  for (let pass = 0; pass < 5; pass++) {
    const best = new Map()
    for (const p of pools) {
      if (!(p.spot > 0)) continue
      const [a, b] = p.assets
      const ra = Number(a.amount) / 10 ** dec[a.denom]
      const rb = Number(b.amount) / 10 ** dec[b.denom]
      if (!(ra > 0 && rb > 0)) continue
      const hop = (known, unknown, rKnown, unknownInKnown) => {
        if (px[known] == null || px[unknown] != null) return
        const depth = rKnown * px[known]
        if (depth < MIN_HOP_USD) return
        const cur = best.get(unknown)
        if (!cur || depth > cur.depth) best.set(unknown, { depth, price: unknownInKnown * px[known] })
      }
      hop(a.denom, b.denom, ra, 1 / p.spot)
      hop(b.denom, a.denom, rb, p.spot)
    }
    if (best.size === 0) break
    best.forEach((v, k) => { px[k] = v.price })
  }
  return px
}

async function txsLastDay(addr, height) {
  const query = encodeURIComponent(`wasm._contract_address='${addr}' AND tx.height>=${height - BLOCKS_PER_DAY}`)
  const path = `/cosmos/tx/v1beta1/txs?query=${query}&pagination.limit=1&pagination.count_total=true`
  const j = await lcdJson(path, { lcds: TX_LCDS, tries: 2 }).catch(() => null)
  const total = Number(j?.total ?? j?.pagination?.total)
  return Number.isFinite(total) ? total : null
}

const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)

// ── The reading ─────────────────────────────────────────────────────────

const [head, config, pairs] = await Promise.all([
  lcdJson('/cosmos/base/tendermint/v1beta1/blocks/latest'),
  smart(FACTORY, { config: {} }),
  allPairs(),
])
const height = Number(head?.block?.header?.height)

const states = await mapLimit(pairs, 8, async p => {
  const d = await trySmart(p.addr, { pool: {} })
  if (!d) return null
  const assets = (d.assets ?? []).map(a => ({ denom: denomOf(a.info), amount: a.amount }))
  if (assets.length !== 2 || assets.some(a => !a.denom)) return null
  return { ...p, assets, totalShare: d.total_share }
})

const read = states.filter(Boolean)
const held = read.filter(p => p.assets.every(a => Number(a.amount) > 0))

// Decimals once per asset, not once per pool.
const denoms = Array.from(new Set(held.flatMap(p => p.assets.map(a => a.denom))))
const decList = await mapLimit(denoms, 8, decimalsFor)
const dec = {}
denoms.forEach((d, i) => { if (decList[i] != null) dec[d] = decList[i] })

// Two different reasons a pool has no value here, and they must not be reported
// as one: an asset whose decimals the chain does not publish, and an asset with
// no route to the dollar. The first is a gap in what can be read. The second is
// a statement about the asset itself, which nothing could trade to USDC through
// pools with real depth behind them.
const priceable = held.filter(p => p.assets.every(a => dec[a.denom] != null))
const noDecimals = held.length - priceable.length
const spots = await mapLimit(priceable, 8, p => spotOf(p, dec).catch(() => null))
priceable.forEach((p, i) => { p.spot = spots[i] })

const px = derivePrices(priceable, dec)

const valued = []
for (const p of priceable) {
  if (!p.assets.every(a => px[a.denom] > 0)) continue
  const sides = p.assets.map(a => (Number(a.amount) / 10 ** dec[a.denom]) * px[a.denom])
  valued.push({ ...p, usd: sides[0] + sides[1], sides })
}
valued.sort((a, b) => b.usd - a.usd)

const tvl = valued.reduce((s, p) => s + p.usd, 0)

/**
 * Liquid staking tokens hold the same LUNA that the staking protocol already
 * reports, so a total counting both counts it twice. DefiLlama leaves these out
 * of a venue's total for that reason, and both figures are recorded here so the
 * page can say which convention it is showing rather than quietly picking one.
 *
 * The symbols come from each token's own contract, already cached from the
 * decimals read above.
 */
const LST_SYMBOLS = new Set(['ampLUNA', 'arbLUNA'])
const lstDenoms = new Set()
for (const d of denoms) {
  if (!d.startsWith('terra1')) continue
  const info = await cw20Info(d)
  if (info && LST_SYMBOLS.has(info.symbol)) lstDenoms.add(d)
}
const lstUsd = valued.reduce((s, p) => {
  let v = 0
  p.assets.forEach((a, i) => { if (lstDenoms.has(a.denom)) v += p.sides[i] })
  return s + v
}, 0)

const top = valued.slice(0, ACTIVITY_POOLS)
const counts = await mapLimit(top, 6, p => txsLastDay(p.addr, height))
top.forEach((p, i) => { p.txs = counts[i] })

const txs24h = top.reduce((s, p) => s + (p.txs ?? 0), 0)
const activePools = top.filter(p => (p.txs ?? 0) > 0).length

const share = n => {
  if (!(tvl > 0)) return null
  return round(valued.slice(0, n).reduce((s, p) => s + p.usd, 0) / tvl, 4)
}

const fees = (config?.pair_configs ?? []).map(c => {
  const entry = Object.entries(c.pair_type ?? {})[0] ?? ['?', '?']
  return {
    type: typeof entry[1] === 'string' ? entry[1] : entry[0],
    bps: Number(c.total_fee_bps),
    maker: Number(c.maker_fee_bps),
    off: c.is_disabled === true,
  }
})

const t = `${new Date().toISOString().slice(0, 16)}Z`
const line = JSON.stringify({
  t,
  height,
  tvl: round(tvl),
  // The same reading without liquid staking tokens, which is how a total is
  // reached that can be set beside other chains measured the same way.
  tvlExLst: round(tvl - lstUsd),
  pools: pairs.length,
  read: read.length,
  held: held.length,
  priced: valued.length,
  // Left out because the chain publishes no decimals for an asset. Guessing an
  // exponent does not produce an obviously wrong number, it produces a number.
  noDecimals,
  // Left out because no asset in the pool could be reached from USDC through a
  // hop with real depth behind it.
  noRoute: priceable.length - valued.length,
  txs24h,
  activePools,
  top3: share(3),
  top10: share(10),
  fees,
  maker: config?.fee_address ?? null,
  owner: config?.owner ?? null,
  px: Object.fromEntries(
    Object.entries(px)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => [k.length > 46 ? `${k.slice(0, 43)}…` : k, round(v, 8)]),
  ),
  markets: top.map(p => ({
    a: p.addr.slice(0, 12),
    k: p.assets.map(a => (a.denom.length > 24 ? `${a.denom.slice(0, 21)}…` : a.denom)),
    t: p.type,
    v: round(p.usd),
    x: p.txs ?? null,
  })),
})

mkdirSync(join(dir, 'astro'), { recursive: true })
appendFileSync(join(dir, 'astro', `${t.slice(0, 10)}.jsonl`), `${line}\n`)
console.log(line)
