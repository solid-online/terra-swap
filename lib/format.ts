/**
 * Shared display-format helpers used across Atrium surfaces.
 *
 * V1.6.2 audit-fix (2026-04-26): `timeAgo()` was reimplemented in 5
 * files (LiveTradeFeed, messages, tla-otc, arcade leaderboard, profile)
 * with subtle drifts ("s" vs "s ago", "1 m" vs "1m"). Centralizing
 * eliminates the drift and lets us tune relative-time wording in one
 * place.
 */

/** Short human relative-time. Returns e.g. "12s", "3m", "4h", "2d". */
export function timeAgo(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3_600) return `${Math.floor(sec / 60)}m`
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86_400)}d`
}

/** Long form: "12 seconds ago", etc. Used in modal copy where space is
 *  not constrained. */
export function timeAgoLong(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`
  const mn = Math.floor(sec / 60)
  if (mn < 60) return `${mn} minute${mn === 1 ? '' : 's'} ago`
  const hr = Math.floor(sec / 3600)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const dy = Math.floor(sec / 86_400)
  return `${dy} day${dy === 1 ? '' : 's'} ago`
}

/** Truncate a bech32 wallet to "terra1abcd…wxyz". */
export function shortAddr(a: string | null | undefined, head = 8, tail = 6): string {
  if (!a) return ''
  if (a.length < head + tail + 1) return a
  return `${a.slice(0, head)}…${a.slice(-tail)}`
}

/** Comma-separated number with safe NaN fallback. */
export function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000) {
    return n.toLocaleString('en-US', { maximumFractionDigits: decimals })
  }
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Compact volume formatting: 1.2M, 4.5K, etc. */
export function fmtVolume(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return Math.round(n).toLocaleString('en-US')
  return n.toFixed(2)
}
