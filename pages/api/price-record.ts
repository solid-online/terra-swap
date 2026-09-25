/**
 * GET /api/price-record — writes the current ten-minute slot of the price
 * history (lib/priceHistory), if it is not written yet.
 *
 * The pool-scan workflow writes each slot as it begins (/api/pool-scans), and
 * the uptime workflow calls this every ten minutes after it, so a slot the
 * first one missed is still written. Anyone may call it: a slot that holds
 * prices already is left alone and answered straight away, so extra calls
 * cost one read.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { claimSlot, recordPrices, type RecordResult } from 'lib/priceHistory'
import { sitePools } from 'lib/sitePools'
import { scanVolumes } from 'lib/volumeScan'

export const config = { maxDuration: 60 }

async function handler(_req: NextApiRequest, res: NextApiResponse<RecordResult | { recorded: false; reason: string }>) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const busy = await claimSlot()
    if (busy) return res.status(200).json({ recorded: false, reason: busy })
    const { pools, px } = await sitePools()
    if (pools.length === 0) return res.status(503).json({ recorded: false, reason: 'the pools did not answer' })
    // Volume for the candlestick bars; it never blocks the price write, so a slow scan just means no bars this slot.
    const vol = await scanVolumes(pools).catch(() => ({}))
    return res.status(200).json(await recordPrices(px, pools, vol))
  } catch {
    return res.status(503).json({ recorded: false, reason: 'the chain or the store did not answer' })
  }
}

export default withCpu('price-record', handler)
