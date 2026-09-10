/**
 * Terra Swap ledger + leaderboard.
 *
 * Every swap, pool opening and liquidity add on the factory, pulled
 * from chain tx events and kept in a durable KV ledger keyed by txhash so it
 * survives RPC pruning (the June volume-reset incident is why nothing here
 * recomputes from live RPC alone). Same idempotent pattern as the sales
 * ledger.
 *
 * Points are a game, not a payout. Nothing here is redeemable for anything
 * and the copy on the page must never say otherwise. They exist so the
 * promise "the first ones are being written down" has a public face.
 */

import { kv as vercelKv } from '@vercel/kv'
import { isCrystalHolder } from 'lib/holders'
import { DEX_FACTORY } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const LCD = process.env.NEXT_PUBLIC_LCD || 'https://terra-lcd.publicnode.com'
const UA = 'Mozilla/5.0 terra-swap-ledger'

export type DexAction = 'create_pair' | 'provide_liquidity' | 'swap' | 'withdraw_liquidity'

export interface DexEvent {
  /** `${txhash}#${msgIndex}` — the idempotency key */
  id: string
  address: string
  action: DexAction
  /** pair contract, or the factory for create_pair */
  contract: string
  height: number
  txhash: string
  /**
   * Liquidity moved by this event, smallest units, keyed by asset id — the
   * same key `assetId()` produces, so a denom for natives and the contract
   * address for cw20s. Present on provide_liquidity and withdraw_liquidity.
   * Added 2026-09-10; events stored before then have none and are upgraded
   * in place the next time the scan sees them.
   */
  assets?: Record<string, string>
  /** LP minted (provide) or burned (withdraw), smallest units. */
  share?: string
}

/**
 * Astroport writes moved liquidity as `"173501000000terra1lxx…, 1000000ibc/0EF5…"`
 * — amount glued to denom, comma separated. Split it back apart.
 */
export function parseAssets(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split(',')) {
    const m = /^\s*(\d+)(\S+)\s*$/.exec(part)
    if (m) out[m[2]] = m[1]
  }
  return out
}

export interface DexLedger {
  events: Record<string, DexEvent>
  updatedAt: number
}

// ─── Points & badges (the game) ─────────────────────────────────

export const POINTS: Record<DexAction, number> = {
  create_pair: 50,
  provide_liquidity: 20,
  swap: 5,
  withdraw_liquidity: 0,
}
/** Earliest provide_liquidity in a pair. Computed, not an action of its own. */
export const FIRST_HAND_POINTS = 100
/** Crystal holders: every point counts one and a half times. */
export const CRYSTAL_MULTIPLIER = 1.5
/** Factory was instantiated at 22,747,166. Anyone active in the first ~7 days
 *  (≈100,800 blocks at 6s) is an early one. */
export const EARLY_CUTOFF_HEIGHT = 22_747_166 + 100_800

export interface Badge {
  emoji: string
  name: string
  hint: string
}

export const BADGES = {
  gold:     { emoji: '🥇', name: 'First place',  hint: 'Top of the board' },
  silver:   { emoji: '🥈', name: 'Second place', hint: 'Second on the board' },
  bronze:   { emoji: '🥉', name: 'Third place',  hint: 'Third on the board' },
  steady:   { emoji: '🐎', name: 'Steady Lad',   hint: 'Here in the first week' },
  builder:  { emoji: '🏗️', name: 'Builder',      hint: 'Opened a pool' },
  firsthand:{ emoji: '🌊', name: 'First Hand',   hint: 'First liquidity into a pool' },
  provider: { emoji: '💧', name: 'Provider',     hint: 'Added liquidity three times or more' },
  trader:   { emoji: '🔁', name: 'Trader',       hint: 'Ten swaps or more' },
  crystal:  { emoji: '✦',  name: 'Crystal',      hint: 'Holds a Crystal · 1.5× points' },
} satisfies Record<string, Badge>

export interface LeaderRow {
  address: string
  points: number
  rank: number
  swaps: number
  provides: number
  creates: number
  firstHands: number
  crystal: boolean
  early: boolean
  badges: Badge[]
  firstSeenHeight: number
}

// ─── Storage ────────────────────────────────────────────────────

// Namespaced by factory. 2026-09-08: a local run pointed at Astroport's
// factory shared the un-namespaced key and wrote Astroport's history into the
// production board — strangers "written down" for pools they never touched.
const LEDGER_KEY = `atrium:dex:ledger:v2:${DEX_FACTORY}`
const CRYSTAL_KEY = (a: string) => `atrium:dex:crystal:v1:${a}`
const CRYSTAL_TTL_S = 600

const mem = (() => {
  const g = globalThis as unknown as { __terraSwapMem?: Map<string, unknown> }
  g.__terraSwapMem ??= new Map()
  return g.__terraSwapMem
})()

async function kvGet<T>(key: string): Promise<T | null> {
  if (HAS_KV) return (await vercelKv.get<T>(key)) ?? null
  return (mem.get(key) as T) ?? null
}
async function kvSet(key: string, val: unknown, ttlS?: number): Promise<void> {
  if (HAS_KV) { await vercelKv.set(key, val, ttlS ? { ex: ttlS } : undefined); return }
  mem.set(key, val)
}

export async function getLedger(): Promise<DexLedger> {
  return (await kvGet<DexLedger>(LEDGER_KEY)) ?? { events: {}, updatedAt: 0 }
}

/**
 * Merge is idempotent: replaying the same tx never double counts. `allowed`
 * is the factory plus its pairs; anything else is dropped on the way in AND
 * scrubbed from what is already stored, so a stray scan can never seed the
 * board with another DEX's history again.
 */
/** What a wallet has actually put into a pool: provides minus withdraws. */
export interface LpFlow {
  /** asset id → net smallest units, signed, as a string */
  net: Record<string, string>
  provides: number
  withdraws: number
}

/**
 * Net liquidity per wallet per pool, keyed `${address}|${contract}`.
 *
 * Deliberately kept in tokens rather than dollars. Converting a deposit made
 * last Tuesday into USD needs last Tuesday's price, which we do not have, and
 * inventing one would turn an honest number into a flattering one. Tokens in
 * versus tokens now is the comparison that shows impermanent loss for what it
 * is anyway.
 */
export function computeFlows(ledger: DexLedger): Record<string, LpFlow> {
  const out: Record<string, LpFlow> = {}
  for (const e of Object.values(ledger.events)) {
    if (!e.assets) continue
    if (e.action !== 'provide_liquidity' && e.action !== 'withdraw_liquidity') continue
    const key = `${e.address}|${e.contract}`
    const f = out[key] ?? (out[key] = { net: {}, provides: 0, withdraws: 0 })
    const add = e.action === 'provide_liquidity'
    if (add) f.provides++; else f.withdraws++
    for (const id of Object.keys(e.assets)) {
      const cur = BigInt(f.net[id] ?? '0')
      const amt = BigInt(e.assets[id])
      f.net[id] = (add ? cur + amt : cur - amt).toString()
    }
  }
  return out
}

export async function mergeLedger(incoming: DexEvent[], allowed: Set<string>): Promise<{ ledger: DexLedger; added: number; removed: number }> {
  const ledger = await getLedger()
  let added = 0, removed = 0
  // Scrubbing is for events from contracts that are not ours. It is only safe
  // when the caller genuinely knows every pool: an allowlist holding just the
  // factory means the pair query failed, and deleting a ledger on the back of
  // a timeout is not a trade worth making.
  if (allowed.size > 1) {
    for (const id of Object.keys(ledger.events)) {
      if (!allowed.has(ledger.events[id].contract)) { delete ledger.events[id]; removed++ }
    }
  }
  for (const e of incoming) {
    if (!allowed.has(e.contract)) continue
    const cur = ledger.events[e.id]
    if (!cur) { ledger.events[e.id] = e; added++ }
    // Backfill: events recorded before amounts were captured get upgraded the
    // next time the scan reads the same transaction. No key bump, no data lost.
    else if (!cur.assets && e.assets) { ledger.events[e.id] = e; added++ }
  }
  if (added > 0 || removed > 0) { ledger.updatedAt = Date.now(); await kvSet(LEDGER_KEY, ledger) }
  return { ledger, added, removed }
}

// ─── Chain scan ─────────────────────────────────────────────────

interface TxResponse { height: string; txhash: string; events: { type: string; attributes: { key: string; value: string }[] }[] }
interface TxBody { body: { messages: { sender?: string; contract?: string; msg?: unknown }[] } }

/** Latest txs touching a contract. publicnode returns up to 100 regardless of
 *  the limit asked; for a factory with a handful of pools that is the whole
 *  history for a long time, and the merge makes replays free. */
export async function scanContract(contract: string): Promise<DexEvent[]> {
  const q = encodeURIComponent(`wasm._contract_address='${contract}'`)
  const url = `${LCD}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=100`
  let j: { txs?: TxBody[]; tx_responses?: TxResponse[] }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return []
    j = await r.json()
  } catch { return [] }
  const out: DexEvent[] = []
  const txs = j.txs ?? [], rs = j.tx_responses ?? []
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], body = txs[i]?.body
    if (!body) continue
    // A cw20-routed swap's first message is the token's `send`; the human is
    // still the signer of message 0 either way.
    const sender = body.messages[0]?.sender
    if (!sender || !sender.startsWith('terra1')) continue
    // One tx can carry several wasm events (fee transfer + swap, allowance +
    // provide). Take the actions *this* contract emitted, deduped per tx.
    const seen = new Set<DexAction>()
    for (const ev of r.events) {
      if (ev.type !== 'wasm') continue
      const addrs = ev.attributes.filter(a => a.key === '_contract_address').map(a => a.value)
      if (!addrs.includes(contract)) continue
      // First value wins: one wasm event carries one contract's action plus
      // the attributes describing it.
      const at: Record<string, string> = {}
      for (const a of ev.attributes) if (!(a.key in at)) at[a.key] = a.value
      for (const a of ev.attributes) {
        if (a.key !== 'action') continue
        const act = a.value as DexAction
        if (!(act in POINTS) || seen.has(act)) continue
        seen.add(act)
        const e: DexEvent = { id: `${r.txhash}#${act}`, address: sender, action: act, contract, height: Number(r.height), txhash: r.txhash }
        // provide: `assets` + `share`. withdraw: `refund_assets` + `withdrawn_share`.
        const moved = act === 'withdraw_liquidity' ? at.refund_assets : act === 'provide_liquidity' ? at.assets : undefined
        if (moved) {
          e.assets = parseAssets(moved)
          const share = act === 'withdraw_liquidity' ? at.withdrawn_share : at.share
          if (share) e.share = share
        }
        out.push(e)
      }
    }
  }
  return out
}

// ─── Leaderboard ────────────────────────────────────────────────

async function crystalFor(addr: string): Promise<boolean> {
  const cached = await kvGet<boolean>(CRYSTAL_KEY(addr))
  if (cached !== null) return cached
  const v = await isCrystalHolder(addr)
  await kvSet(CRYSTAL_KEY(addr), v, CRYSTAL_TTL_S)
  return v
}

export async function computeLeaderboard(ledger: DexLedger): Promise<LeaderRow[]> {
  const events = Object.values(ledger.events)

  // First hand per pair = earliest provide_liquidity by height.
  const firstByPair = new Map<string, DexEvent>()
  for (const e of events) {
    if (e.action !== 'provide_liquidity') continue
    const cur = firstByPair.get(e.contract)
    if (!cur || e.height < cur.height) firstByPair.set(e.contract, e)
  }
  const firstHandIds = new Set(Array.from(firstByPair.values()).map(e => e.id))

  const rows = new Map<string, LeaderRow>()
  for (const e of events) {
    const r = rows.get(e.address) ?? {
      address: e.address, points: 0, rank: 0, swaps: 0, provides: 0, creates: 0, firstHands: 0,
      crystal: false, early: false, badges: [], firstSeenHeight: e.height,
    }
    r.firstSeenHeight = Math.min(r.firstSeenHeight, e.height)
    r.points += POINTS[e.action]
    if (e.action === 'swap') r.swaps++
    if (e.action === 'provide_liquidity') r.provides++
    if (e.action === 'create_pair') r.creates++
    if (firstHandIds.has(e.id)) { r.firstHands++; r.points += FIRST_HAND_POINTS }
    rows.set(e.address, r)
  }

  // Only withdrawing earns nothing and does not put you on the board.
  const list = Array.from(rows.values()).filter(r => r.points > 0)
  await Promise.all(list.map(async r => { r.crystal = await crystalFor(r.address) }))
  for (const r of list) {
    r.early = r.firstSeenHeight <= EARLY_CUTOFF_HEIGHT
    if (r.crystal) r.points = Math.round(r.points * CRYSTAL_MULTIPLIER)
  }
  list.sort((a, b) => b.points - a.points || a.firstSeenHeight - b.firstSeenHeight)
  list.forEach((r, i) => {
    r.rank = i + 1
    const b: Badge[] = []
    if (i === 0) b.push(BADGES.gold); else if (i === 1) b.push(BADGES.silver); else if (i === 2) b.push(BADGES.bronze)
    if (r.crystal) b.push(BADGES.crystal)
    if (r.early) b.push(BADGES.steady)
    if (r.creates > 0) b.push(BADGES.builder)
    if (r.firstHands > 0) b.push(BADGES.firsthand)
    if (r.provides >= 3) b.push(BADGES.provider)
    if (r.swaps >= 10) b.push(BADGES.trader)
    r.badges = b
  })
  return list
}
