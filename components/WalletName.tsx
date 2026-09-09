'use client'

/**
 * WalletName — renders a wallet address truncated via `shortAddr`.
 *
 * History: this component used to resolve Sundial `.luna` names and render
 * them in place of the bech32. Sundial was decommissioned 2026-06-11
 * (operator instruction), so the component is now a plain formatter. The
 * component shell is kept so the many call-sites (activity feeds, DMs,
 * profiles) didn't need touching — and so a future name service can slot
 * back in behind the same API.
 */

import { shortAddr } from 'lib/format'

interface Props {
  address: string | null | undefined
  /** Truncation length for the short-addr (head chars). */
  head?: number
  /** Truncation length for the short-addr (tail chars). */
  tail?: number
  /** Kept for call-site compatibility — no longer has any effect. */
  showSuffix?: boolean
  /** Optional inline style override (e.g. tabular-nums in tables). */
  style?: React.CSSProperties
}

export function WalletName({ address, head = 8, tail = 6, style }: Props) {
  if (!address) return <span style={style}>—</span>
  return <span style={style}>{shortAddr(address, head, tail)}</span>
}
