/**
 * GET /api/geo — the visitor's edge-resolved country and whether wallet
 * actions are allowed there. Same list as middleware.ts (BLOCKED_COUNTRIES,
 * default US, CA, GB). Never cached: per-visitor truth.
 */

import type { NextApiRequest, NextApiResponse } from 'next'

const BLOCKED = new Set(
  (process.env.BLOCKED_COUNTRIES ?? 'US,CA,GB').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
)
const BYPASS_COOKIE = 'geo_bypass'
const BYPASS_SECRET = process.env.GEOBLOCK_BYPASS_SECRET || ''

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const cookies = req.headers.cookie ?? ''
  const bypassed = !!BYPASS_SECRET && cookies.split(';').some(c => {
    const [k, v] = c.trim().split('=')
    return k === BYPASS_COOKIE && v === BYPASS_SECRET
  })
  // Vercel sets x-vercel-ip-country; other hosts may set cf-ipcountry or nothing (XX = unknown, allowed).
  const country = ((req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry']) as string) || 'XX'
  const tx_allowed = bypassed || !BLOCKED.has(country)
  const attrs = 'Path=/; Max-Age=86400; SameSite=Lax; Secure'
  res.setHeader('Set-Cookie', [
    `region_tx_allowed=${tx_allowed ? 'true' : 'false'}; ${attrs}`,
    `region_tx_country=${country}; ${attrs}`,
  ])
  res.status(200).json({
    country,
    tx_allowed,
    reason: tx_allowed ? null : `Wallet actions (swap, add or remove liquidity) are not available in ${country}. Everything else stays open.`,
  })
}
