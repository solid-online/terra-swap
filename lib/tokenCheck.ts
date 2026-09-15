/**
 * Who controls a listed token, read from the chain.
 *
 * Whether more of it can be made and by whom, whether the contract behind it
 * can be replaced, how much exists on Terra, and for a token that arrived over
 * IBC, how much is locked on the chain it came from to stand behind it. For a
 * cw20, also who holds it, with pools and other contracts named as such.
 *
 * It reports what the chain says at the moment it was read. It is not an
 * audit, and it cannot say what whoever controls a token will do with that.
 */

import { createHash } from 'crypto'
import { fromBech32, toBech32 } from '@cosmjs/encoding'
import { KNOWN_TOKENS, TERRA_SWAP_ROUTER, VENUE_INCENTIVES, VENUE_NAME, assetId, type KnownToken, type PoolView } from 'lib/dex'
import { RPC_ENDPOINTS, lcdFetch } from 'lib/lcd'
import { NOBLE_REST_ENDPOINTS } from 'lib/noble'
import { HUB_REST_ENDPOINTS } from 'lib/cosmoshub'
import { INJECTIVE_REST_ENDPOINTS } from 'lib/injective'
import { NEUTRON_REST_ENDPOINTS } from 'lib/neutron'
import { STRIDE_REST_ENDPOINTS } from 'lib/stride'

/** Terra's side of each IBC channel a listed token arrives on, and the chain at the other end. Counterparties read from Terra on 2026-09-15. */
const CHANNELS: Record<string, { chain: string; counterparty: string; prefix: string; rest: string[] }> = {
  'channel-253': { chain: 'Noble', counterparty: 'channel-30', prefix: 'noble', rest: NOBLE_REST_ENDPOINTS },
  'channel-0': { chain: 'the Cosmos Hub', counterparty: 'channel-339', prefix: 'cosmos', rest: HUB_REST_ENDPOINTS },
  'channel-255': { chain: 'Injective', counterparty: 'channel-151', prefix: 'inj', rest: INJECTIVE_REST_ENDPOINTS },
  'channel-229': { chain: 'Neutron', counterparty: 'channel-25', prefix: 'neutron', rest: NEUTRON_REST_ENDPOINTS },
  'channel-46': { chain: 'Stride', counterparty: 'channel-52', prefix: 'stride', rest: STRIDE_REST_ENDPOINTS },
  'channel-6': { chain: 'Axelar', counterparty: 'channel-11', prefix: 'axelar', rest: ['https://axelar-api.polkachu.com', 'https://rest.cosmos.directory/axelar'] },
  'channel-272': { chain: 'Kava', counterparty: 'channel-138', prefix: 'kava', rest: ['https://kava-api.polkachu.com', 'https://rest.cosmos.directory/kava'] },
}

/** Who issues each IBC token where it comes from. Written down, not read: the chain there says what, not who. */
const ISSUER: Record<string, string> = {
  USDC: 'Issued by Circle on Noble.',
  'USDC.inj': 'Issued by Circle on Injective.',
  EURe: 'Issued by Monerium on Noble.',
  USDT: 'Issued by Tether on Kava.',
  'USDT.axl': 'Tether from Ethereum, carried over by Axelar.',
  ATOM: "The Cosmos Hub's own staking token.",
  INJ: "Injective's own staking token.",
  stLUNA: "Minted by Stride's liquid staking against staked LUNA.",
  stATOM: "Minted by Stride's liquid staking against staked ATOM.",
  dATOM: "Minted by Drop's liquid staking contracts on Neutron.",
  ASTRO: "Astroport's token, a tokenfactory token on Neutron.",
  FUEL: 'A tokenfactory token on Neutron.',
  'wBTC.atom': 'Wrapped Bitcoin (WBTC) from Ethereum, over IBC Eureka through the Cosmos Hub.',
  PAXG: 'Pax Gold, issued by Paxos on Ethereum, over IBC Eureka through the Cosmos Hub.',
}

export interface TopHolder { address: string; pct: number; contract: boolean; label: string | null }

export interface TokenCheck {
  key: string
  kind: 'native' | 'cw20' | 'ibc' | 'factory'
  /** whole tokens that exist on Terra */
  supply: number | null
  mint:
    | { by: 'chain' }
    | { by: 'nobody' }
    | { by: 'address'; address: string; contract: boolean; cap: number | null; minterAdmin?: string | null }
    | { by: 'origin'; chain: string }
    | { by: 'unknown' }
  /** a contract's admin can replace its code; empty means nobody can */
  admin?: { admin: string | null; codeId: number }
  /** a tokenfactory denom's admin can mint, burn and hand the denom over */
  factoryAdmin?: { chain: string; admin: string | null }
  origin?: { chain: string; channel: string; counterparty: string; baseDenom: string; issuer: string | null }
  /** what is locked on the chain it came from, against what exists here, whole tokens */
  backing?: { chain: string; escrow: string; locked: number; onTerra: number }
  holders?: { top: TopHolder[]; accounts: number; complete: boolean; top10Pct: number; top10InContractsPct: number }
  at: number
}

const isContract = (addr: string) => { try { return fromBech32(addr).data.length === 32 } catch { return false } }
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64')

/** A contract query that tells "answered with nothing" apart from "did not answer". */
async function query<T>(contract: string, msg: object): Promise<{ ok: boolean; data: T | null }> {
  try {
    const r = await lcdFetch(`/cosmwasm/wasm/v1/contract/${contract}/smart/${b64(msg)}`, { timeoutMs: 10_000 })
    if (!r.ok) return { ok: false, data: null }
    return { ok: true, data: ((await r.json())?.data ?? null) as T | null }
  } catch { return { ok: false, data: null } }
}

async function terraJson<T>(path: string): Promise<T | null> {
  try { const r = await lcdFetch(path, { timeoutMs: 10_000 }); return r.ok ? ((await r.json()) as T) : null } catch { return null }
}

async function restJson<T>(bases: string[], path: string): Promise<T | null> {
  for (const base of bases) {
    try {
      const r = await fetch(base + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (r.ok) return (await r.json()) as T
    } catch { /* next endpoint */ }
  }
  return null
}

async function supplyOf(denom: string): Promise<string | null> {
  const j = await terraJson<{ amount?: { amount?: string } }>(`/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(denom)}`)
  return j?.amount?.amount ?? null
}

async function contractInfo(addr: string): Promise<{ admin: string | null; codeId: number } | null> {
  const j = await terraJson<{ contract_info?: { admin?: string; code_id?: string } }>(`/cosmwasm/wasm/v1/contract/${addr}`)
  return j?.contract_info ? { admin: j.contract_info.admin || null, codeId: Number(j.contract_info.code_id) } : null
}

/** ICS-20 escrow address for a channel: the first 20 bytes of sha256("ics20-1" ‖ 0 ‖ "transfer/<channel>"). */
function escrowAddress(prefix: string, channel: string): string {
  const hash = createHash('sha256').update(Buffer.concat([Buffer.from('ics20-1'), Buffer.from([0]), Buffer.from(`transfer/${channel}`)])).digest()
  return toBech32(prefix, hash.subarray(0, 20))
}

/** The denom the escrow on the first chain back holds: its own base denom, or the IBC denom of whatever path remains from there. */
function sourceDenom(path: string, base: string): string {
  const rest = path.split('/').slice(2).join('/')
  const full = [rest, base].filter(Boolean).join('/')
  return full.startsWith('transfer/') ? `ibc/${createHash('sha256').update(full).digest('hex').toUpperCase()}` : full
}

function varint(buf: Buffer, at: number): [number, number] {
  let n = 0, shift = 0, i = at
  while (i < buf.length) { const b = buf[i++]; n |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7 }
  return [n, i]
}

/** A Terra tokenfactory denom's admin, through RPC: the public REST endpoints do not serve this query. */
async function terraFactoryAdmin(denom: string): Promise<string | null | undefined> {
  const d = Buffer.from(denom)
  const data = Buffer.concat([Buffer.from([0x0a]), Buffer.from(encodeVarint(d.length)), d]).toString('hex')
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const url = `${rpc.replace(/:443$/, '')}/abci_query?path=${encodeURIComponent('"/osmosis.tokenfactory.v1beta1.Query/DenomAuthorityMetadata"')}&data=0x${data}`
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const v = (await r.json())?.result?.response
      if (v?.code) return undefined
      const buf = Buffer.from(v?.value ?? '', 'base64')
      // DenomAuthorityMetadataResponse { authority_metadata (1) { admin (1) string } }
      if (buf[0] !== 0x0a) return null
      const [, inner] = varint(buf, 1)
      if (buf[inner] !== 0x0a) return null
      const [len, at] = varint(buf, inner + 1)
      return buf.subarray(at, at + len).toString('utf8') || null
    } catch { /* next endpoint */ }
  }
  return undefined
}

function encodeVarint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7 }
  out.push(n)
  return out
}

/**
 * A cw20's holders from its raw contract state: cw20-base keeps each balance
 * under "balance" + address, so one paged read of that prefix lists them all,
 * where asking balance by balance would take a query per account.
 */
async function cw20Holders(contract: string, deadline: number): Promise<{ list: { address: string; amount: bigint }[]; complete: boolean }> {
  const prefix = Buffer.concat([Buffer.from([0, 7]), Buffer.from('balance')])
  const prefixHex = prefix.toString('hex').toUpperCase()
  const list: { address: string; amount: bigint }[] = []
  let key: string | null = prefix.toString('base64')
  for (let page = 0; page < 60 && key; page++) {
    if (Date.now() > deadline) return { list, complete: false }
    const j: { models?: { key: string; value: string }[]; pagination?: { next_key?: string | null } } | null =
      await terraJson(`/cosmwasm/wasm/v1/contract/${contract}/state?pagination.limit=1000&pagination.key=${encodeURIComponent(key)}`)
    if (!j) return { list, complete: false }
    for (const m of j.models ?? []) {
      if (!m.key.toUpperCase().startsWith(prefixHex)) return { list, complete: true }
      const address = Buffer.from(m.key.slice(prefixHex.length), 'hex').toString('utf8')
      try {
        const amount = BigInt(JSON.parse(Buffer.from(m.value, 'base64').toString('utf8')))
        if (amount > BigInt(0)) list.push({ address, amount })
      } catch { /* not a balance */ }
    }
    key = j.pagination?.next_key ?? null
  }
  return { list, complete: !key }
}

function namedAddresses(pools: PoolView[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of pools) m.set(p.contract_addr, `${p.label} pool on ${VENUE_NAME[p.venue]}`)
  if (VENUE_INCENTIVES.astroport) m.set(VENUE_INCENTIVES.astroport, "Astroport's incentives contract")
  if (TERRA_SWAP_ROUTER) m.set(TERRA_SWAP_ROUTER, "Terra Swap's router")
  return m
}

export async function checkToken(token: KnownToken, pools: PoolView[]): Promise<TokenCheck> {
  const id = assetId(token.info)
  const whole = (micro: string | bigint | null) => (micro == null ? null : Number(micro) / 10 ** token.decimals)
  const at = Date.now()

  if ('token' in token.info) {
    const [info, minter, admin, holders] = await Promise.all([
      query<{ total_supply?: string }>(id, { token_info: {} }),
      query<{ minter?: string; cap?: string | null }>(id, { minter: {} }),
      contractInfo(id),
      cw20Holders(id, Date.now() + 30_000),
    ])
    let mint: TokenCheck['mint'] = { by: 'unknown' }
    if (minter.ok && !minter.data?.minter) mint = { by: 'nobody' }
    else if (minter.ok && minter.data?.minter) {
      const who = minter.data.minter
      const contract = isContract(who)
      mint = { by: 'address', address: who, contract, cap: minter.data.cap ? whole(minter.data.cap) : null, ...(contract ? { minterAdmin: (await contractInfo(who))?.admin ?? null } : {}) }
    }
    const total = holders.list.reduce((s, h) => s + h.amount, BigInt(0))
    const supplyMicro = info.data?.total_supply ? BigInt(info.data.total_supply) : total
    const names = namedAddresses(pools)
    const sorted = [...holders.list].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    const pct = (x: bigint) => (supplyMicro > BigInt(0) ? Number((x * BigInt(1_000_000)) / supplyMicro) / 10_000 : 0)
    const top10 = sorted.slice(0, 10)
    return {
      key: token.key, kind: 'cw20', supply: whole(supplyMicro), mint,
      ...(admin ? { admin } : {}),
      holders: {
        top: top10.map(h => ({ address: h.address, pct: pct(h.amount), contract: isContract(h.address), label: names.get(h.address) ?? null })),
        accounts: holders.list.length,
        complete: holders.complete,
        top10Pct: pct(top10.reduce((s, h) => s + h.amount, BigInt(0))),
        top10InContractsPct: pct(top10.filter(h => isContract(h.address)).reduce((s, h) => s + h.amount, BigInt(0))),
      },
      at,
    }
  }

  const supply = whole(await supplyOf(id))
  if (id === 'uluna') return { key: token.key, kind: 'native', supply, mint: { by: 'chain' }, at }

  if (id.startsWith('factory/')) {
    const admin = await terraFactoryAdmin(id)
    return {
      key: token.key, kind: 'factory', supply,
      mint: admin === undefined ? { by: 'unknown' } : admin ? { by: 'address', address: admin, contract: isContract(admin), cap: null } : { by: 'nobody' },
      factoryAdmin: { chain: 'Terra', admin: admin ?? null },
      at,
    }
  }

  // An IBC token: where it comes from, and what stands behind it there.
  const trace = await terraJson<{ denom_trace?: { path?: string; base_denom?: string } }>(`/ibc/apps/transfer/v1/denom_traces/${id.slice(4)}`)
  const path = trace?.denom_trace?.path ?? '', base = trace?.denom_trace?.base_denom ?? ''
  const channel = path.split('/')[1] ?? ''
  const link = CHANNELS[channel]
  const out: TokenCheck = {
    key: token.key, kind: 'ibc', supply, mint: link ? { by: 'origin', chain: link.chain } : { by: 'unknown' },
    ...(link ? { origin: { chain: link.chain, channel, counterparty: link.counterparty, baseDenom: base, issuer: ISSUER[token.key] ?? null } } : {}),
    at,
  }
  if (!link || !base) return out
  const escrow = escrowAddress(link.prefix, link.counterparty)
  const held = await restJson<{ balance?: { amount?: string } }>(link.rest, `/cosmos/bank/v1beta1/balances/${escrow}/by_denom?denom=${encodeURIComponent(sourceDenom(path, base))}`)
  if (held?.balance?.amount != null && supply != null) out.backing = { chain: link.chain, escrow, locked: Number(held.balance.amount) / 10 ** token.decimals, onTerra: supply }
  if (base.startsWith('factory/neutron1') && link.prefix === 'neutron') {
    const meta = await restJson<{ authority_metadata?: { Admin?: string; admin?: string } }>(link.rest, `/osmosis/tokenfactory/v1beta1/denoms/${encodeURIComponent(base)}/authority_metadata`)
    if (meta) out.factoryAdmin = { chain: link.chain, admin: meta.authority_metadata?.Admin || meta.authority_metadata?.admin || null }
  }
  return out
}

export const findToken = (v: unknown) => (typeof v === 'string' ? KNOWN_TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase()) : undefined)
