/**
 * Region posture: pages and read APIs are open to everyone; wallet actions
 * are gated in the countries listed in BLOCKED_COUNTRIES (default US, CA, GB).
 *
 * The gate is a cookie the client reads (`region_tx_allowed`), backed by
 * /api/geo for a fresh check. The contracts on chain are permissionless
 * regardless; this is interface posture, and each host decides their own.
 *
 * Operator bypass for testing: `?bypass=<GEOBLOCK_BYPASS_SECRET>` sets a
 * cookie that reports the region as allowed.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const BLOCKED = new Set(
  (process.env.BLOCKED_COUNTRIES ?? 'US,CA,GB').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
)
const BYPASS_COOKIE = 'geo_bypass'
const BYPASS_SECRET = process.env.GEOBLOCK_BYPASS_SECRET || ''

function withRegion(res: NextResponse, allowed: boolean, country: string): NextResponse {
  const opts = { maxAge: 86_400, path: '/', sameSite: 'lax' as const, httpOnly: false, secure: true }
  res.cookies.set('region_tx_allowed', allowed ? 'true' : 'false', opts)
  if (!allowed) res.cookies.set('region_tx_country', country, opts)
  return res
}

export function middleware(request: NextRequest) {
  if (BYPASS_SECRET) {
    const bypass = request.nextUrl.searchParams.get('bypass')
    if (bypass && bypass === BYPASS_SECRET) {
      const clean = request.nextUrl.clone()
      clean.searchParams.delete('bypass')
      const res = NextResponse.redirect(clean)
      res.cookies.set(BYPASS_COOKIE, BYPASS_SECRET, { maxAge: 30 * 86_400, path: '/', sameSite: 'lax' })
      return res
    }
    if (request.cookies.get(BYPASS_COOKIE)?.value === BYPASS_SECRET) return withRegion(NextResponse.next(), true, 'XX')
  }
  const country = request.geo?.country || 'XX'
  return withRegion(NextResponse.next(), !BLOCKED.has(country), country)
}

export const config = {
  matcher: ['/', '/predict', '/api/:path*'],
}
