/**
 * The frame for the site's own reference pages (a token, a pool): the same
 * ground, face and way back into every section as /stats and /verify, and the
 * panel and figure pieces they are built from.
 */

import Head from 'next/head'
import { SPACE, TEXT } from 'components/tokens'
import SiteNav from 'components/SiteNav'

export const TERRA_FONT = "'Montserrat', 'Space Grotesk', 'Inter', system-ui, sans-serif"
export const C = {
  surface: '#0b0f1c', surfaceElev: '#111729', divider: 'rgba(255,216,61,0.13)', goldCore: '#caa022', goldLit: '#ffd83d',
  textPrimary: '#f4f1e8', textSecondary: '#d6cfbd', textMuted: '#9a927f', textWhisper: '#6b6555', success: '#3ddc97', alert: '#e04a5a', ember: '#ffb347',
} as const

export function Page({ children, width = 860 }: { children: React.ReactNode; width?: number }) {
  return (
    <>
      <Head>
        <link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700&display=swap' />
      </Head>
      <main style={{ minHeight: '100vh', background: 'radial-gradient(120% 80% at 50% -10%, #111729 0%, #0a0d18 42%, #05070f 100%)', color: C.textPrimary, fontFamily: TERRA_FONT, padding: '1.4rem 1.2rem 4rem' }}>
        <div style={{ maxWidth: width, margin: '0 auto', display: 'grid', gap: SPACE['3'] }}>
          <SiteNav />
          {children}
        </div>
      </main>
    </>
  )
}

export function Panel({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: C.surfaceElev, border: `1px solid ${C.divider}`, borderRadius: 16, padding: '1rem 1.1rem' }}>
      <h2 style={{ fontSize: TEXT.md.size, margin: 0 }}>{title}</h2>
      {note && <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '4px 0 10px' }}>{note}</p>}
      {children}
    </section>
  )
}

export function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: '9rem' }}>
      <span style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textWhisper }}>{label}</span>
      <span style={{ fontSize: '1.35rem', fontWeight: 700, color: C.goldLit, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{sub}</span>}
    </div>
  )
}

export const cell: React.CSSProperties = { padding: '6px 8px', borderTop: `1px solid ${C.divider}`, fontSize: TEXT.xs.size, textAlign: 'left', verticalAlign: 'top' }

/** A button-shaped link: `primary` for the thing the page is for, the rest quiet. */
export const linkBtn = (primary = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.95rem', borderRadius: 999, textDecoration: 'none', whiteSpace: 'nowrap',
  fontSize: TEXT.sm.size, fontWeight: 700, fontFamily: 'inherit',
  color: primary ? '#05070f' : C.textSecondary, background: primary ? C.goldLit : 'transparent', border: `1px solid ${primary ? C.goldLit : C.divider}`,
})

export const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: SPACE['2'], fontSize: TEXT.xs.size, color: C.textMuted, padding: '3px 0', flexWrap: 'wrap' }

/** A price or amount at a sensible precision: whole numbers for large ones, four significant figures for small ones. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  if (!(n > 0)) return '0'
  // Four significant figures written out in full: a wBTC price per LUNA is 0.0000005833, never 5.833e-7.
  return n.toFixed(Math.min(14, 3 - Math.floor(Math.log10(n)))).replace(/0+$/, '')
}
