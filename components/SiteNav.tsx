/**
 * The way back into the app from its pages (/stats, /verify): every section by
 * name, each opening that tab, so a page that answers a question is never a
 * dead end. Same names as the tabs on the front page.
 */

import Link from 'next/link'
import { TEXT } from 'components/tokens'

const C = { divider: 'rgba(255,216,61,0.13)', goldCore: '#caa022', goldLit: '#ffd83d', textMuted: '#9a927f', textSecondary: '#d6cfbd' } as const

const LINKS = [
  { key: 'swap', href: '/', label: 'Swap' },
  { key: 'pools', href: '/?tab=pools', label: 'Pools' },
  { key: 'bridge', href: '/?tab=bridge', label: 'Bridge' },
  { key: 'portfolio', href: '/?tab=portfolio', label: 'Portfolio' },
  { key: 'stats', href: '/stats', label: 'Stats' },
  { key: 'verify', href: '/verify', label: 'Verify' },
] as const

export default function SiteNav({ here }: { here?: 'stats' | 'verify' }) {
  return (
    <nav aria-label='Terra Swap' style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
      <Link href='/' prefetch={false} style={{ color: C.textSecondary, fontSize: TEXT.xs.size, fontWeight: 700, textDecoration: 'none', marginRight: 6, whiteSpace: 'nowrap' }}>Terra Swap</Link>
      {LINKS.map(l => {
        const on = l.key === here
        return (
          <Link key={l.key} href={l.href} prefetch={false} aria-current={on ? 'page' : undefined} style={{
            fontSize: TEXT.xs.size, textDecoration: 'none', whiteSpace: 'nowrap', padding: '3px 10px', borderRadius: 999,
            border: `1px solid ${on ? C.goldCore : C.divider}`, color: on ? C.goldLit : C.textMuted, background: on ? 'rgba(255,216,61,0.06)' : 'transparent',
          }}>{l.label}</Link>
        )
      })}
    </nav>
  )
}
