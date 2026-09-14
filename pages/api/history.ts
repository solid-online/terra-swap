/**
 * GET /api/history?address=terra1… — a wallet's recent history on Terra:
 * swaps, zaps, liquidity, staking, and IBC transfers both ways. See
 * lib/history.
 *
 * Chain data only, the same anyone can read from an explorer. A read is three
 * transaction searches on a public endpoint, so the address has to be a real
 * terra address, results are kept briefly per address, and each instance runs
 * only so many reads a minute.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fromBech32 } from '@cosmjs/encoding'
import { readHistory, type HistoryRow } from 'lib/history'

export interface HistoryResponse {
  address: string
  rows: HistoryRow[]
  at: number
}

const FRESH_MS = 20_000
/** A re-read asked for right after a transaction still waits this long between reads. */
const REREAD_MS = 4_000
const MAX_READS = 6
const READS_PER_MINUTE = 60
const cache = new Map<string, HistoryResponse>()
const inflight = new Map<string, Promise<HistoryResponse>>()
let windowAt = 0
let windowReads = 0

function terraAddress(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 90) return null
  try {
    const { prefix, data } = fromBech32(v)
    return prefix === 'terra' && (data.length === 20 || data.length === 32) ? v : null
  } catch { return null }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<HistoryResponse | { error: string }>) {
  const address = terraAddress(req.query.address)
  if (!address) return res.status(400).json({ error: 'address required' })
  res.setHeader('Cache-Control', 'no-store')

  const hit = cache.get(address)
  const age = hit ? Date.now() - hit.at : Infinity
  const fresh = typeof req.query._ === 'string'
  if (hit && (age < REREAD_MS || (!fresh && age < FRESH_MS))) return res.status(200).json(hit)

  let read = inflight.get(address)
  if (!read) {
    const now = Date.now()
    if (now - windowAt > 60_000) { windowAt = now; windowReads = 0 }
    if (inflight.size >= MAX_READS || windowReads >= READS_PER_MINUTE) {
      return hit ? res.status(200).json(hit) : res.status(503).json({ error: 'busy, try again in a moment' })
    }
    windowReads++
    read = readHistory(address)
      .then(rows => ({ address, rows, at: Date.now() }))
      .finally(() => { inflight.delete(address) })
    inflight.set(address, read)
  }
  try {
    const body = await read
    cache.set(address, body)
    if (cache.size > 500) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    return res.status(200).json(body)
  } catch {
    return hit ? res.status(200).json(hit) : res.status(502).json({ error: 'could not read the history' })
  }
}
