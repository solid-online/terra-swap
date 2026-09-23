/**
 * GET /api/price-record — writes the current ten-minute slot of the price
 * history (lib/priceHistory), if it is not written yet.
 *
 * Called every ten minutes from outside by the uptime workflow. Anyone may
 * call it: a slot that holds prices already is left alone and answered
 * straight away, so extra calls cost one read.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import { recordPrices, slotRecorded, type RecordResult } from 'lib/priceHistory'
import { sitePools } from 'lib/sitePools'
import { scanVolumes } from 'lib/volumeScan'

export const config = { maxDuration: 60 }

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
/**
 * Callers that arrive while a slot is being written wait for nobody: before
 * this lock, every call in the first ~20 s of a slot wrote it again, about a
 * dozen full pool scans a minute from outside callers (Vercel logs, 2026-09-23).
 */
const LOCK = 'atrium:price-record:lock'
let localLock = 0

export default async function handler(_req: NextApiRequest, res: NextApiResponse<RecordResult | { recorded: false; reason: string }>) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (await slotRecorded()) return res.status(200).json({ recorded: false, reason: 'this slot is already written' })
    const now = Date.now()
    if (HAS_KV) {
      if ((await vercelKv.set(LOCK, now, { nx: true, ex: 90 })) !== 'OK') return res.status(200).json({ recorded: false, reason: 'this slot is being written' })
    } else {
      if (now - localLock < 90_000) return res.status(200).json({ recorded: false, reason: 'this slot is being written' })
      localLock = now
    }
    const { pools, px } = await sitePools()
    if (pools.length === 0) return res.status(503).json({ recorded: false, reason: 'the pools did not answer' })
    // Volume for the candlestick bars; it never blocks the price write, so a slow scan just means no bars this slot.
    const vol = await scanVolumes(pools).catch(() => ({}))
    return res.status(200).json(await recordPrices(px, pools, vol))
  } catch {
    return res.status(503).json({ recorded: false, reason: 'the chain or the store did not answer' })
  }
}
