/**
 * One transaction read back from the chain, as a receipt: whose it is, what
 * left and what arrived, what a swap was quoted and the least it allowed, and
 * the path it took pool by pool, from the pools' own swap events. For
 * /tx/[hash] and its share card. Everything comes from the chain; nothing a
 * link carries is shown as fact.
 */

import { TERRA_SWAP_ROUTER } from 'lib/dex'
import { parseTx, type HistoryRow } from 'lib/history'
import { lcdFetch } from 'lib/lcd'

export const TX_HASH = /^[0-9A-Fa-f]{64}$/

export interface ReceiptHop {
  pool: string
  offer: { id: string; amount: string }
  ask: { id: string; amount: string }
}

export interface Receipt extends HistoryRow {
  /** the wallet the receipt is for: the signer, or for tokens relayed in, whoever they arrived to */
  account: string
  /** each swap in order, as the pools reported it */
  hops: ReceiptHop[]
}

interface Ev { type: string; attributes: { key: string; value: string }[] }
interface TxJson {
  tx_response?: { height: string; txhash: string; code: number; timestamp: string; events?: Ev[] }
  tx?: { body?: { messages?: Record<string, unknown>[]; memo?: string } }
}

const attr = (ev: Ev | undefined, key: string) => ev?.attributes.find(a => a.key === key)?.value

export async function readReceipt(hash: string, timeoutMs = 8000): Promise<Receipt | null> {
  if (!TX_HASH.test(hash)) return null
  let j: TxJson | null = null
  try {
    const r = await lcdFetch(`/cosmos/tx/v1beta1/txs/${hash.toUpperCase()}`, { timeoutMs, headers: { accept: 'application/json' } })
    if (!r.ok) return null
    j = (await r.json()) as TxJson
  } catch { return null }
  const res = j?.tx_response
  if (!res) return null
  const body = j?.tx?.body
  const events = res.events ?? []
  const messages = body?.messages ?? []
  let account = String(messages[0]?.sender ?? '')
  // Tokens relayed in: the receipt belongs to whoever they arrived to, not to the relayer that signed.
  if (messages.some(m => String(m['@type'] ?? '').endsWith('MsgRecvPacket'))) {
    const routed = events.find(e => e.type === 'wasm' && attr(e, 'action') === 'execute_swap_operations' && attr(e, '_contract_address') === TERRA_SWAP_ROUTER)
    let receiver = ''
    try { receiver = String(JSON.parse(attr(events.find(e => e.type === 'recv_packet'), 'packet_data') ?? '{}').receiver ?? '') } catch { /* not a token transfer */ }
    account = attr(routed, 'receiver') || receiver || account
  }
  const row = parseTx({ ...res, events }, body, account)
  const hops: ReceiptHop[] = []
  for (const ev of events) {
    if (ev.type !== 'wasm') continue
    const at: Record<string, string> = {}
    for (const a of ev.attributes) if (!(a.key in at)) at[a.key] = a.value
    if (at.action !== 'swap' || !at.offer_asset || !at.ask_asset) continue
    hops.push({ pool: at._contract_address ?? '', offer: { id: at.offer_asset, amount: at.offer_amount ?? '0' }, ask: { id: at.ask_asset, amount: at.return_amount ?? '0' } })
  }
  return { ...row, account, hops }
}
