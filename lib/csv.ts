/**
 * A wallet's history as a CSV file, in the column layout Koinly imports (its
 * "universal" format), which most tax software reads as well. One row per
 * token that moved: a swap is one row, adding two tokens to a pool is two rows
 * that share the transaction hash, and a failed transaction is its fee.
 *
 * Net worth is filled in only for a swap between two tokens where one side is
 * USDC from Noble, so the dollar value is the chain's own number. Everywhere
 * else it is left empty for the tax software to price, rather than filled with
 * a price this site guessed.
 */

import { NOBLE_USDC } from 'lib/dex'
import type { HistoryRow, Moved } from 'lib/history'

export interface CsvToken { symbol: string; decimals: number }

const HEADER = ['Date', 'Sent Amount', 'Sent Currency', 'Received Amount', 'Received Currency', 'Fee Amount', 'Fee Currency', 'Net Worth Amount', 'Net Worth Currency', 'Label', 'Description', 'TxHash']

const DESCRIBE: Record<HistoryRow['kind'], string> = {
  swap: 'Swap', zap: 'Zap into a pool', 'add liquidity': 'Added liquidity', 'remove liquidity': 'Removed liquidity',
  stake: 'Staked LP tokens', unstake: 'Unstaked LP tokens', claim: 'Claimed rewards', 'transfer out': 'Sent over IBC',
  'transfer in': 'Arrived over IBC', 'arrived swapped': 'Arrived over IBC, swapped on arrival', 'create pool': 'Opened a pool',
  'liquid staking': 'Liquid staking', other: 'Other transaction',
}
/** Koinly's own labels, only where the kind matches one exactly. */
const LABEL: Partial<Record<HistoryRow['kind'], string>> = { claim: 'reward' }

/** Smallest units as an exact decimal string: ("1234500", 6) is "1.2345". No floating point, so 18-decimal tokens stay exact. */
export function plainAmount(micro: string, decimals: number): string {
  const digits = micro.replace(/^0+/, '') || '0'
  if (decimals === 0) return digits
  const padded = digits.padStart(decimals + 1, '0')
  const frac = padded.slice(-decimals).replace(/0+$/, '')
  return `${padded.slice(0, -decimals)}${frac ? `.${frac}` : ''}`
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const when = (iso: string) => { const s = new Date(iso).toISOString(); return `${s.slice(0, 10)} ${s.slice(11, 19)} UTC` }

export function historyCsv(rows: HistoryRow[], tokenOf: (id: string) => CsvToken): string {
  const lines = [HEADER.join(',')]
  const leg = (m?: Moved) => (m ? { amount: plainAmount(m.amount, tokenOf(m.id).decimals), symbol: tokenOf(m.id).symbol } : { amount: '', symbol: '' })
  for (const r of [...rows].sort((a, b) => a.height - b.height)) {
    const fee = r.feeUluna !== '0' ? plainAmount(r.feeUluna, 6) : ''
    const where = r.chain ? (r.kind === 'transfer out' ? ` to ${r.chain}` : ` from ${r.chain}`) : ''
    const desc = `${DESCRIBE[r.kind]}${where}${r.ok ? '' : ' (failed on chain: only the network fee was paid)'}`
    const outs = r.ok ? r.out : [], ins = r.ok ? r.in : []
    const n = Math.max(1, outs.length, ins.length)
    for (let i = 0; i < n; i++) {
      const o = outs[i], got = ins[i]
      if (!o && !got && (i > 0 || !fee)) continue
      const sent = leg(o), received = leg(got)
      let worth = ''
      if (outs.length === 1 && ins.length === 1) worth = o.id === NOBLE_USDC ? sent.amount : got.id === NOBLE_USDC ? received.amount : ''
      lines.push([
        when(r.time), sent.amount, sent.symbol, received.amount, received.symbol,
        i === 0 ? fee : '', i === 0 && fee ? 'LUNA' : '', worth, worth ? 'USD' : '', LABEL[r.kind] ?? '', desc, r.hash,
      ].map(cell).join(','))
    }
  }
  return lines.join('\n') + '\n'
}
