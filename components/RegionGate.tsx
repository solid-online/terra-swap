'use client'

/**
 * RegionGate — client-side hook + provider for the open-browsing /
 * gated-trading posture (see middleware.ts and /api/geo).
 *
 * Provides `useTxRegionGate()` which returns:
 *   { txAllowed: boolean | null, country: string | null, reason: string | null }
 *
 * `txAllowed: null` = still loading. WalletButton + tx-action surfaces
 * render their loading state instead of either the connect-affordance or
 * the restricted-pill — avoids flashing the wrong UI on cold load.
 *
 * Source priority:
 *   1. The `region_tx_allowed` cookie set by middleware (synchronous,
 *      no extra network call). Read on mount.
 *   2. /api/geo fallback if the cookie is missing (first visit between
 *      middleware deploy and first page load, or cookie cleared).
 *
 * Operator bypass cookie (arcade_bypass=<secret>) takes precedence on
 * the server side — the API will report tx_allowed: true regardless of
 * geo when bypass is present.
 */

import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'

interface TxRegionState {
  /** null = loading; boolean = resolved. */
  txAllowed: boolean | null
  /** Country code ('US' | 'CA' | 'GB' | 'XX' | …) once resolved. */
  country: string | null
  /** Human-readable explanation when txAllowed === false. */
  reason: string | null
  /** Refresh the gate — e.g. after operator pastes a bypass URL. */
  refresh: () => void
}

const TxRegionContext = createContext<TxRegionState>({
  txAllowed: null,
  country: null,
  reason: null,
  refresh: () => {},
})

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const target = `${name}=`
  for (const cookie of document.cookie.split(';')) {
    const c = cookie.trim()
    if (c.startsWith(target)) return decodeURIComponent(c.slice(target.length))
  }
  return null
}

export function TxRegionGateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    txAllowed: boolean | null
    country: string | null
    reason: string | null
  }>({ txAllowed: null, country: null, reason: null })

  const resolve = () => {
    // Synchronous cookie read first — middleware writes this on every
    // response so it's almost always available on first paint.
    const cookieVal = readCookie('region_tx_allowed')
    if (cookieVal === 'true' || cookieVal === 'false') {
      const cookieCountry = readCookie('region_tx_country')
      setState({
        txAllowed: cookieVal === 'true',
        country: cookieCountry,
        reason: cookieVal === 'false' && cookieCountry
          ? `Wallet actions (swap, add or remove liquidity) are not available in ${cookieCountry}. Everything else stays open.`
          : null,
      })
      return
    }
    // Cookie missing — async fallback to /api/geo. Happens on first visit
    // after a fresh deploy before the response cookie has been set.
    fetch('/api/geo')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return
        setState({
          txAllowed: !!j.tx_allowed,
          country: j.country ?? null,
          reason: j.reason ?? null,
        })
      })
      .catch(() => {
        // Fail-open: if we can't determine region, treat as allowed.
        // The on-chain contracts are permissionless anyway.
        setState({ txAllowed: true, country: null, reason: null })
      })
  }

  useEffect(() => { resolve() }, [])

  const value = useMemo<TxRegionState>(() => ({
    ...state,
    refresh: resolve,
  }), [state])

  return (
    <TxRegionContext.Provider value={value}>
      {children}
    </TxRegionContext.Provider>
  )
}

export function useTxRegionGate(): TxRegionState {
  return useContext(TxRegionContext)
}

/** Throws RegionRestricted when called outside a permitted region. Used
 *  inside tx-mutation hooks as the defense-in-depth guard — even if a
 *  blocked-region user bypasses the WalletButton gate, the mutation
 *  short-circuits before the wallet popup. */
export class RegionRestricted extends Error {
  constructor(country: string | null) {
    super(
      country
        ? `Trading actions are not available in ${country}.`
        : 'Trading actions are not available in your region.',
    )
    this.name = 'RegionRestricted'
  }
}
