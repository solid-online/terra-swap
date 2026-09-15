/**
 * A wallet's own history on Terra, read from its transactions: swaps, zaps,
 * liquidity, staking at Astroport's incentives contract and at liquid staking
 * hubs, and IBC transfers both ways, including tokens that arrived already
 * swapped by Terra Swap's router.
 *
 * What moved is read from the chain's own bookkeeping rather than from what a
 * message asked for: bank transfer events for native tokens, and cw20
 * transfer, send, burn and mint events for the rest. So a row says what
 * actually left the wallet and what actually arrived, with the network fee
 * on its own. A swap signed on this site also carries its quote in the memo
 * (lib/route tradeMemo), which the page sets beside what arrived.
 */

import { TERRA_SWAP_ROUTER, VENUE_INCENTIVES } from 'lib/dex'
import { lcdFetch } from 'lib/lcd'
import { readTradeMemo } from 'lib/route'

const UA = { 'User-Agent': 'Mozilla/5.0 terra-swap-history', accept: 'application/json' }
/** Terra's fee collector. What a wallet pays it, or is refunded by it, is the network fee, not a trade. */
const FEE_COLLECTOR = 'terra17xpfvakm2amg962yls6f84z3kell8c5lkaeqfa'
/** Terra's IBC channels to the chains the Transfer tab moves tokens with. */
const CHANNEL_CHAIN: Record<string, string> = { 'channel-253': 'Noble', 'channel-0': 'Cosmos Hub', 'channel-255': 'Injective', 'channel-229': 'Neutron', 'channel-46': 'Stride' }

export type HistoryKind =
  | 'swap' | 'zap' | 'add liquidity' | 'remove liquidity' | 'stake' | 'unstake' | 'claim'
  | 'transfer out' | 'transfer in' | 'arrived swapped' | 'create pool' | 'liquid staking' | 'other'

/** An asset id (denom, or cw20 contract) and smallest units. */
export interface Moved { id: string; amount: string }

export interface HistoryRow {
  hash: string
  height: number
  time: string
  ok: boolean
  kind: HistoryKind
  /** what left the wallet, per asset, network fee excluded */
  out: Moved[]
  /** what arrived in the wallet, per asset */
  in: Moved[]
  /** the network fee this wallet paid, uluna */
  feeUluna: string
  memo: string
  /** a swap signed on this site: what it was quoted, in display units, and what the routing added over two pools */
  quote?: { amount: number; label: string; gainPct: number | null }
  /** the least Terra Swap's router would let arrive */
  minimum?: Moved
  /** the other chain of an IBC transfer, when it is one the Transfer tab knows */
  chain?: string
  /** pools the transaction traded or moved liquidity in */
  pools: string[]
}

interface Ev { type: string; attributes: { key: string; value: string }[] }
interface TxResponse { height: string; txhash: string; code: number; timestamp: string; events: Ev[] }
interface TxBody { messages?: Record<string, unknown>[]; memo?: string }

/** First value wins: one event describes one contract execution. */
function attrsOf(ev: Ev): Record<string, string> {
  const at: Record<string, string> = {}
  for (const a of ev.attributes) if (!(a.key in at)) at[a.key] = a.value
  return at
}

/** "123uluna,45ibc/…" → [[denom, amount]] */
function coins(raw = ''): [string, bigint][] {
  const out: [string, bigint][] = []
  for (const part of raw.split(',')) {
    const m = /^\s*(\d+)(\S+)\s*$/.exec(part)
    if (m) out.push([m[2], BigInt(m[1])])
  }
  return out
}

const CW20_MOVES = new Set(['transfer', 'send', 'transfer_from', 'send_from'])

/** One transaction, as it touched `address`. */
export function parseTx(r: TxResponse, body: TxBody | undefined, address: string): HistoryRow {
  const net = new Map<string, bigint>()
  const add = (id: string, v: bigint) => net.set(id, (net.get(id) ?? BigInt(0)) + v)
  let fee = BigInt(0)
  const actions: { contract: string; action: string; at: Record<string, string> }[] = []
  let recvChannel: string | undefined
  let sendChannel: string | undefined
  for (const ev of r.events ?? []) {
    const at = attrsOf(ev)
    if (ev.type === 'tx') {
      if (at.fee && at.fee_payer === address) for (const [d, a] of coins(at.fee)) { if (d === 'uluna') fee += a }
    } else if (ev.type === 'transfer') {
      if (at.sender === address && at.recipient !== FEE_COLLECTOR) for (const [d, a] of coins(at.amount)) add(d, -a)
      if (at.recipient === address && at.sender !== FEE_COLLECTOR) for (const [d, a] of coins(at.amount)) add(d, a)
    } else if (ev.type === 'wasm') {
      const contract = at._contract_address ?? ''
      const action = at.action ?? ''
      actions.push({ contract, action, at })
      const amt = /^\d+$/.test(at.amount ?? '') ? BigInt(at.amount) : BigInt(0)
      if (amt > BigInt(0)) {
        if (CW20_MOVES.has(action)) {
          if (at.from === address) add(contract, -amt)
          if (at.to === address) add(contract, amt)
        } else if ((action === 'burn' || action === 'burn_from') && at.from === address) add(contract, -amt)
        else if (action === 'mint' && at.to === address) add(contract, amt)
      }
    } else if (ev.type === 'recv_packet') recvChannel = at.packet_dst_channel
    else if (ev.type === 'send_packet') sendChannel = at.packet_src_channel
  }

  const types = (body?.messages ?? []).map(m => String(m['@type'] ?? ''))
  const has = (a: string) => actions.some(x => x.action === a)
  const routed = actions.filter(x => x.action === 'execute_swap_operations' && x.contract === TERRA_SWAP_ROUTER && x.at.receiver === address)
  const incentives = actions.filter(x => x.contract === VENUE_INCENTIVES.astroport)
  let kind: HistoryKind = 'other'
  if (types.some(t => t.endsWith('MsgRecvPacket'))) kind = routed.length > 0 ? 'arrived swapped' : 'transfer in'
  else if (types.some(t => t.endsWith('MsgTransfer'))) kind = 'transfer out'
  else if (has('provide_liquidity') && has('swap')) kind = 'zap'
  else if (has('provide_liquidity')) kind = 'add liquidity'
  else if (has('withdraw_liquidity')) kind = 'remove liquidity'
  else if (has('swap') || routed.length > 0) kind = 'swap'
  else if (has('create_pair')) kind = 'create pool'
  else if (incentives.length > 0) kind = incentives.some(x => /deposit/.test(x.action)) ? 'stake' : incentives.some(x => /withdraw/.test(x.action)) ? 'unstake' : 'claim'
  else if (actions.some(x => /bond/.test(x.action))) kind = 'liquid staking'

  const minimum = routed.length > 0 && routed.every(x => x.at.ask_asset === routed[0].at.ask_asset)
    ? { id: routed[0].at.ask_asset, amount: routed.reduce((s, x) => s + BigInt(x.at.minimum_receive ?? '0'), BigInt(0)).toString() }
    : undefined
  const memo = body?.memo ?? ''
  const q = kind === 'swap' ? readTradeMemo(memo) : null
  const entries = Array.from(net.entries()).filter(([, v]) => v !== BigInt(0))
  const channel = kind === 'transfer out' ? sendChannel : recvChannel
  return {
    hash: r.txhash,
    height: Number(r.height),
    time: r.timestamp,
    ok: r.code === 0,
    kind,
    out: entries.filter(([, v]) => v < BigInt(0)).map(([id, v]) => ({ id, amount: (-v).toString() })),
    in: entries.filter(([, v]) => v > BigInt(0)).map(([id, v]) => ({ id, amount: v.toString() })),
    feeUluna: fee.toString(),
    memo,
    ...(q ? { quote: { amount: q.quote, label: q.label, gainPct: q.gainPct } } : {}),
    ...(minimum && minimum.amount !== '0' ? { minimum } : {}),
    ...(channel && CHANNEL_CHAIN[channel] ? { chain: CHANNEL_CHAIN[channel] } : {}),
    pools: Array.from(new Set(actions.filter(x => ['swap', 'provide_liquidity', 'withdraw_liquidity'].includes(x.action)).map(x => x.contract))),
  }
}

type Found = { r: TxResponse; body?: TxBody }

/**
 * One page of a transaction search, newest first. Null when no endpoint
 * answered, which is not the same as no transactions. A page past the last
 * one is refused with a 400; that is the end of the results.
 */
async function searchPage(query: string, limit: number, page: number): Promise<Found[] | null> {
  try {
    const res = await lcdFetch(`/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&order_by=ORDER_BY_DESC&limit=${limit}&page=${page}`, { headers: UA, kind: 'txs', timeoutMs: 20_000 })
    if (res.status === 400 && page > 1) return []
    if (!res.ok) return null
    const j = await res.json()
    const rs: TxResponse[] = j?.tx_responses ?? []
    const txs: { body?: TxBody }[] = j?.txs ?? []
    return rs.map((r, i) => ({ r, body: txs[i]?.body }))
  } catch { return null }
}

/** What a wallet signed, what was transferred to it, and what Terra Swap's router paid it. */
const walletQueries = (address: string) => [`message.sender='${address}'`, `transfer.recipient='${address}'`, `wasm.receiver='${address}'`]

/** The transactions this wallet signed, and the ones that brought it tokens over IBC, as rows, newest first. */
function rowsFor(found: Map<string, Found>, address: string): HistoryRow[] {
  const rows: HistoryRow[] = []
  found.forEach(({ r, body }) => {
    const row = parseTx(r, body, address)
    const signer = String(body?.messages?.[0]?.sender ?? '')
    const arrived = row.kind === 'transfer in' || row.kind === 'arrived swapped'
    if (signer !== address && !arrived) return
    if (arrived && row.in.length === 0) return
    rows.push(row)
  })
  return rows.sort((a, b) => b.height - a.height)
}

/**
 * The newest transactions this wallet signed, plus the ones that brought it
 * tokens over IBC, relayed by someone else: plain transfers, and deposits
 * Terra Swap's router swapped on arrival and paid to it.
 */
export async function readHistory(address: string, max = 60): Promise<HistoryRow[]> {
  const [signed, transfers, routed] = walletQueries(address)
  const found = await Promise.all([searchPage(signed, 60, 1), searchPage(transfers, 30, 1), searchPage(routed, 30, 1)])
  const byHash = new Map<string, Found>()
  for (const list of found) for (const x of list ?? []) if (!byHash.has(x.r.txhash)) byHash.set(x.r.txhash, x)
  return rowsFor(byHash, address).slice(0, max)
}

/** Pages read per search for an export, 100 transactions each. */
const EXPORT_PAGES = 20

/**
 * Every transaction of a wallet between two times, for the CSV export: the
 * same three searches as readHistory, each read page by page until it passes
 * `fromMs`. `complete` is false when a search stopped at EXPORT_PAGES or an
 * endpoint gave up before reaching `fromMs`, so the file can say it is partial.
 */
export async function readHistoryBetween(address: string, fromMs: number, toMs: number): Promise<{ rows: HistoryRow[]; complete: boolean }> {
  const byHash = new Map<string, Found>()
  let complete = true
  await Promise.all(walletQueries(address).map(async q => {
    for (let page = 1; page <= EXPORT_PAGES; page++) {
      const list = await searchPage(q, 100, page)
      if (list === null) { complete = false; return }
      for (const x of list) {
        const t = Date.parse(x.r.timestamp)
        if (t >= fromMs && t < toMs && !byHash.has(x.r.txhash)) byHash.set(x.r.txhash, x)
      }
      if (list.length < 100 || Date.parse(list[list.length - 1].r.timestamp) < fromMs) return
      if (page === EXPORT_PAGES) complete = false
    }
  }))
  return { rows: rowsFor(byHash, address), complete }
}
