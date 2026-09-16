#!/usr/bin/env node
/**
 * One reading of liquid staking on Terra, appended as a JSON line to
 * <dir>/lsd/YYYY-MM-DD.jsonl.
 *
 * Two protocols mint a token against staked LUNA: Eris (ampLUNA) and Backbone
 * (bLUNA). Between them they hold about a tenth of everything staked on this
 * chain, so how they spread that stake is a fact about the chain's security and
 * not a detail about two apps.
 *
 * Read from the hubs and from the chain's own staking module, never from either
 * protocol's interface.
 *
 * Four traps this file exists to avoid, all met on 2026-09-16:
 *
 *  - The hub is not where people go. ampLUNA's token saw 384 transactions in a
 *    day against the hub's 50, and bLUNA's 27 against 6. Counting the hub alone
 *    understates Eris sevenfold, the same way counting Astroport's router
 *    instead of its pairs returns zero.
 *  - A hub's configured validator list is a ceiling, not a spread. Eris lists 30
 *    and delegates to 11, three of them holding nothing, with six carrying 95%.
 *    So the delegations are read from the staking module rather than from the
 *    hub's own config.
 *  - The exchange rate only ever rises, because rewards accrue while the token
 *    supply stays put. It is not a price and nothing downstream may draw it as
 *    one.
 *  - `previous_batches` returns the oldest first, so asking without a cursor
 *    answers with 2022 and says nothing about what is leaving now.
 *
 * usage: node scripts/lsd-check.mjs <dir>
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'status-data'
const UA = 'openfields-analytics (+https://openfields.app)'
const TIMEOUT_MS = 20_000
const BLOCKS_PER_DAY = 15_000

const ERIS = {
  hub: 'terra10788fkzah89xrdm27zkj5yvhj9x3494lxawzm5qq3vvxcqz2yzaqyd3enk',
  token: 'terra1ecgazyd0waaj3g7l9cmy5gulhxkps2gmxu9ghducvuypjq68mq2s5lvsct',
  vault: 'terra1r9gls56glvuc4jedsvc3uwh6vj95mqm9efc7hnweqxa2nlme5cyqxygy5m',
  vaultLp: 'terra1se7rvuerys4kd2snt6vqswh9wugu49vhyzls8ymc02wl37g2p2ms5yz490',
}
const BACKBONE = {
  hub: 'terra1l2nd99yze5fszmhl5svyh5fky9wm4nz4etlgnztfu4e8809gd52q04n3ea',
  token: 'terra17aj4ty4sz4yhgm08na8drc0v03v2jwr3waxcqrwhajj729zhl7zqnpc0ml',
}

const LCDS = [
  'https://terra-api.polkachu.com',
  'https://rest.cosmos.directory/terra2',
  'https://terra-lcd.publicnode.com',
]
/** publicnode refuses a bounded tx search and answers 400, which is not a retry. */
const TX_LCDS = ['https://terra-api.polkachu.com', 'https://rest.cosmos.directory/terra2']

const sleep = ms => new Promise(r => setTimeout(r, ms))

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

async function smart(contract, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64')
  const j = await lcdJson(`/cosmwasm/wasm/v1/contract/${contract}/smart/${encodeURIComponent(q)}`)
  return j?.data
}

const trySmart = (c, m) => smart(c, m).catch(() => null)
const micro = v => Number(v ?? 0) / 1e6
const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)

async function txsLastDay(addr, height) {
  const query = encodeURIComponent(`wasm._contract_address='${addr}' AND tx.height>=${height - BLOCKS_PER_DAY}`)
  const j = await lcdJson(
    `/cosmos/tx/v1beta1/txs?query=${query}&pagination.limit=1&pagination.count_total=true`,
    { lcds: TX_LCDS },
  ).catch(() => null)
  const total = Number(j?.total ?? j?.pagination?.total)
  return Number.isFinite(total) ? total : null
}

/** What a hub actually delegates, from the staking module rather than its own config. */
async function delegationsOf(addr) {
  const j = await lcdJson(`/cosmos/staking/v1beta1/delegations/${addr}?pagination.limit=100`).catch(() => null)
  return (j?.delegation_responses ?? [])
    .map(d => ({ v: d?.delegation?.validator_address ?? '', l: micro(d?.balance?.amount) }))
    .filter(d => d.v)
    .sort((a, b) => b.l - a.l)
}

function spreadOf(dels) {
  const funded = dels.filter(d => d.l > 0)
  const total = funded.reduce((s, d) => s + d.l, 0)
  return {
    used: dels.length,
    funded: funded.length,
    top: total > 0 && funded.length > 0 ? round(funded[0].l / total, 4) : null,
    topSix: total > 0 ? round(funded.slice(0, 6).reduce((s, d) => s + d.l, 0) / total, 4) : null,
  }
}

const [head, pool, validatorPage] = await Promise.all([
  lcdJson('/cosmos/base/tendermint/v1beta1/blocks/latest'),
  lcdJson('/cosmos/staking/v1beta1/pool').catch(() => null),
  lcdJson('/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=250').catch(() => null),
])
const height = Number(head?.block?.header?.height)

/** Operator address to its own stake and name. Public chain data; no operator is singled out. */
const validators = new Map()
for (const v of validatorPage?.validators ?? []) {
  validators.set(v.operator_address, { luna: micro(v.tokens), moniker: v?.description?.moniker ?? null })
}

const [erisState, erisConfig, erisBatches, erisDels, bbState, bbConfig, bbDels, vaultState] = await Promise.all([
  trySmart(ERIS.hub, { state: {} }),
  trySmart(ERIS.hub, { config: {} }),
  // Oldest first without a cursor, so start near the end to see what is leaving now.
  trySmart(ERIS.hub, { previous_batches: { start_after: 480, limit: 16 } }),
  delegationsOf(ERIS.hub),
  trySmart(BACKBONE.hub, { state: {} }),
  trySmart(BACKBONE.hub, { config: {} }),
  delegationsOf(BACKBONE.hub),
  trySmart(ERIS.vault, { state: {} }),
])

const counts = await Promise.all(
  [ERIS.hub, ERIS.token, ERIS.vaultLp, BACKBONE.hub, BACKBONE.token].map(a => txsLastDay(a, height)),
)

/** A hub's stake next to the whole of each validator it backs. */
const withShare = dels => dels.slice(0, 12).map(d => {
  const v = validators.get(d.v)
  return {
    v: d.v,
    n: v?.moniker ?? null,
    l: round(d.l, 0),
    // How much of that validator's entire stake comes from this one hub.
    s: v && v.luna > 0 ? round(Math.min(1, d.l / v.luna), 4) : null,
  }
})

const erisLuna = micro(erisState?.total_uluna)
const bbLuna = micro(bbState?.total_native)
const bonded = micro(pool?.pool?.bonded_tokens)

const t = `${new Date().toISOString().slice(0, 16)}Z`
const line = JSON.stringify({
  t,
  height,
  chain: {
    bonded: round(bonded, 0),
    validators: validators.size,
  },
  eris: {
    luna: round(erisLuna, 0),
    tokens: round(micro(erisState?.total_ustake), 0),
    // Rises as rewards arrive; never a price.
    rate: round(Number(erisState?.exchange_rate), 6),
    tvl: round(micro(erisState?.tvl_uluna), 0),
    unbonding: round(micro(erisState?.unbonding), 0),
    fee: Number(erisConfig?.fee_config?.protocol_reward_fee ?? NaN) || null,
    feeTo: erisConfig?.fee_config?.protocol_fee_contract ?? null,
    owner: erisConfig?.owner ?? null,
    // The configured list is a ceiling; the delegations below are the spread.
    configured: (erisConfig?.validators ?? []).length,
    ...spreadOf(erisDels),
    share: bonded > 0 ? round(erisLuna / bonded, 4) : null,
    dels: withShare(erisDels),
    queue: (Array.isArray(erisBatches) ? erisBatches : [])
      .filter(b => !b?.reconciled)
      .map(b => ({
        id: b?.id ?? null,
        luna: round(micro(b?.uluna_unclaimed ?? b?.amount_unclaimed), 0),
        end: b?.est_unbond_end_time ?? null,
      })),
  },
  backbone: {
    luna: round(bbLuna, 0),
    tokens: round(micro(bbState?.total_usteak), 0),
    rate: round(Number(bbState?.exchange_rate), 6),
    fee: Number(bbConfig?.fee_rate ?? NaN) || null,
    feeTo: bbConfig?.fee_account ?? null,
    owner: bbConfig?.owner ?? null,
    configured: (bbConfig?.validators ?? []).length,
    ...spreadOf(bbDels),
    share: bonded > 0 ? round(bbLuna / bonded, 4) : null,
    dels: withShare(bbDels),
  },
  // A separate product from the hub: an arbitrage vault, priced in its own LP token.
  vault: {
    rate: round(Number(vaultState?.exchange_rate), 6),
    tvl: round(micro(vaultState?.balances?.tvl_utoken), 0),
    lp: round(micro(vaultState?.total_lp_supply), 0),
  },
  txs24h: {
    erisHub: counts[0],
    erisToken: counts[1],
    vaultLp: counts[2],
    bbHub: counts[3],
    bbToken: counts[4],
  },
})

mkdirSync(join(dir, 'lsd'), { recursive: true })
appendFileSync(join(dir, 'lsd', `${t.slice(0, 10)}.jsonl`), `${line}\n`)
console.log(line)
