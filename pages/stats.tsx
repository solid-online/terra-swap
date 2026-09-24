/**
 * /stats: Terra's DEX activity in one place, read from the chain and from this
 * repository's public status log. Liquidity on both sites and what the
 * deepest pools paid their providers, liquid staking tokens against their
 * hubs, pools that drifted off the market, what Terra Swap's routing is used
 * for and adds, and uptime. No accounts, and nothing is stored about visitors.
 */

import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import LstBoard from 'components/LstBoard'
import SiteNav from 'components/SiteNav'
import { VENUE_NAME, annotateMarket, annotateValues, type PoolView } from 'lib/dex'
import { arbPlans, fmtAmount, fmtUsd } from 'lib/arb'
import type { DexResponse } from 'pages/api/dex'
import type { VenueResponse } from 'pages/api/dex-venue'
import type { StatsResponse } from 'pages/api/stats'
import type { PoolFeesResponse } from 'pages/api/pool-fees'
import { TERRA_FONT } from 'lib/font'

const C = {
  surface: '#0b0f1c', surfaceElev: '#111729', divider: 'rgba(255,216,61,0.13)', goldCore: '#caa022', goldLit: '#ffd83d',
  textPrimary: '#f4f1e8', textSecondary: '#d6cfbd', textMuted: '#9a927f', textWhisper: '#6b6555', success: '#3ddc97', alert: '#e04a5a', ember: '#ffb347',
} as const
const REPO = 'https://github.com/solid-online/terra-swap'

function Panel({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: C.surfaceElev, border: `1px solid ${C.divider}`, borderRadius: 16, padding: '1rem 1.1rem' }}>
      <h2 style={{ fontSize: TEXT.md.size, margin: 0 }}>{title}</h2>
      {note && <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '4px 0 10px' }}>{note}</p>}
      {children}
    </section>
  )
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: '9rem' }}>
      <span style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textWhisper }}>{label}</span>
      <span style={{ fontSize: '1.35rem', fontWeight: 700, color: C.goldLit, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{sub}</span>}
    </div>
  )
}

const cell: React.CSSProperties = { padding: '6px 8px', borderTop: `1px solid ${C.divider}`, fontSize: TEXT.xs.size, textAlign: 'left', verticalAlign: 'top' }
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const ago = (iso: string | null) => (iso ? `${Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86_400_000))} days` : '')

/** What a pool paid its providers, read when the row comes near the screen (/api/pool-fees). */
function FeesCell({ pair }: { pair: string }) {
  const ref = useRef<HTMLTableCellElement>(null)
  const [near, setNear] = useState(false)
  const [f, setF] = useState<PoolFeesResponse | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  useEffect(() => {
    if (!near) return
    let alive = true
    fetch(`/api/pool-fees?pair=${pair}`).then(r => (r.ok ? r.json() : null)).then((j: PoolFeesResponse | null) => { if (alive && j) setF(j) }).catch(() => {})
    return () => { alive = false }
  }, [near, pair])
  const days = f && !f.complete && f.since ? Math.max(1, Math.round((f.at - Date.parse(f.since)) / 86_400_000)) : 30
  const money = (v: number | null, n: number) => (v == null ? `${n} swaps` : fmtUsd(v))
  return (
    <td ref={ref} style={{ ...cell, color: C.textSecondary, whiteSpace: 'nowrap' }}>
      {!f ? <span style={{ color: C.textWhisper }}>…</span>
        : !f.day30.swaps ? <span style={{ color: C.textWhisper }}>no swaps</span>
        : days < 7 ? <>{money(f.day30.usd, f.day30.swaps)} <span style={{ color: C.textWhisper }}>in {days}d</span></>
        : <>{money(f.day7.usd, f.day7.swaps)} <span style={{ color: C.textWhisper }}>7d</span> · {money(f.day30.usd, f.day30.swaps)} <span style={{ color: C.textWhisper }}>{days}d</span></>}
    </td>
  )
}

export default function StatsPage() {
  const [dex, setDex] = useState<DexResponse | null>(null)
  const [venue, setVenue] = useState<VenueResponse | null>(null)
  const [px, setPx] = useState<Record<string, number> | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)
  useEffect(() => {
    const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
    json<DexResponse>('/api/dex').then(setDex)
    json<VenueResponse>('/api/dex-venue').then(setVenue)
    json<{ px?: Record<string, number> }>('/api/dex-market').then(j => setPx(j?.px ?? null))
    json<StatsResponse>('/api/stats').then(j => { if (j?.router) setStats(j); else setStatsFailed(true) })
  }, [])

  const own = useMemo(() => {
    const pools = (dex?.pools ?? []).filter(p => !p.empty).map(p => ({ ...p }))
    if (px) { annotateMarket(pools, px); annotateValues(pools, px) }
    return pools
  }, [dex, px])
  const all = useMemo<PoolView[]>(() => [...own, ...(venue?.pools ?? [])], [own, venue])
  const tvl = (v: 'terraswap' | 'astroport') => all.filter(p => p.venue === v).reduce((s, p) => s + (p.tvlUsd ?? 0), 0)
  const deep = useMemo(() => [...all].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)).slice(0, 12), [all])
  const gaps = useMemo(() => (px ? arbPlans(own, px).slice(0, 6) : []), [own, px])
  const r = stats?.router, t = stats?.tagged

  return (
    <>
      <Head>
        <title>Stats · Terra Swap</title>
      </Head>
      <main style={{ minHeight: '100vh', background: 'radial-gradient(120% 80% at 50% -10%, #111729 0%, #0a0d18 42%, #05070f 100%)', color: C.textPrimary, fontFamily: TERRA_FONT, padding: '1.4rem 1.2rem 4rem' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: SPACE['3'] }}>
          <div>
            <SiteNav here='stats' />
            <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.4rem)', margin: '0.6rem 0 0.4rem', letterSpacing: '-0.02em' }}>
              <span style={{ fontWeight: 700, color: C.goldLit }}>Stats</span> <span style={{ fontWeight: 300 }}>for Terra&apos;s pools</span>
            </h1>
            <p style={{ fontSize: TEXT.sm.size, color: C.textSecondary, lineHeight: 1.65, margin: 0 }}>
              Liquidity on Terra Swap and Astroport, what the pools paid their providers, liquid staking against the hubs, pools off the market, what the routing does, and uptime. Read from the chain and from the <a href={`${REPO}/tree/status`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>public status log</a>; every contract can be checked on <Link href='/verify' style={{ color: C.goldLit }}>/verify</Link>, and the <a href={`${REPO}/tree/status/reports`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>monthly reports</a> go deeper.
            </p>
          </div>

          <Panel title='Liquidity' note="Pools with liquidity on both factories, valued at Astroport's deepest markets. Fees are what each pool's swaps paid its providers, less Astroport's maker share, at today's prices.">
            <div style={{ display: 'flex', gap: SPACE['4'], flexWrap: 'wrap', marginBottom: SPACE['3'] }}>
              <Figure label="Terra Swap" value={dex ? fmtUsd(tvl('terraswap')) : '…'} sub={dex ? `${all.filter(p => p.venue === 'terraswap').length} pools` : undefined} />
              <Figure label="Astroport (listed tokens)" value={venue ? fmtUsd(tvl('astroport')) : '…'} sub={venue ? `${all.filter(p => p.venue === 'astroport').length} pools` : undefined} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: C.textWhisper }}><th style={cell}>Pool</th><th style={cell}>Site</th><th style={cell}>Liquidity</th><th style={cell}>Fees to providers</th></tr></thead>
                <tbody>
                  {deep.map(p => (
                    <tr key={p.contract_addr}>
                      <td style={cell}><Link href={`/pool/${p.contract_addr}`} style={{ color: C.textPrimary, textDecoration: 'none' }}>{p.label}</Link></td>
                      <td style={{ ...cell, color: C.textMuted }}>{VENUE_NAME[p.venue]}{p.pairType !== 'xyk' ? ` · ${p.pairType}` : ''}</td>
                      <td style={{ ...cell, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{p.tvlUsd != null ? fmtUsd(p.tvlUsd) : '—'}</td>
                      <FeesCell pair={p.contract_addr} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <LstBoard />

          <Panel title='Pools off the market' note="Terra Swap pools whose price has drifted from Astroport's deepest market, with the trade that closes the gap and what it is worth at reference prices. First come: anyone can take one, and it moves on every trade.">
            {!px && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading the market…</div>}
            {px && gaps.length === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Every Terra Swap pool is within a few percent of the market right now.</div>}
            <div style={{ display: 'grid', gap: 6 }}>
              {gaps.map(g => (
                <div key={g.pool.contract_addr} style={{ display: 'flex', gap: SPACE['2'], alignItems: 'baseline', flexWrap: 'wrap', fontSize: TEXT.xs.size, padding: '6px 10px', background: C.surface, borderRadius: 10, border: `1px solid ${C.divider}` }}>
                  <b style={{ color: C.textPrimary }}>{g.pool.label}</b>
                  <span style={{ color: g.off > 2 ? C.alert : C.ember }}>{g.off.toFixed(g.off >= 10 ? 0 : 2)}× off</span>
                  <span style={{ color: C.textSecondary }}>{fmtAmount(g.inAmount)} {g.inToken.label} in → {fmtAmount(g.outAmount)} {g.outToken.label}, about {fmtUsd(g.profitUsd)} over reference</span>
                  <Link prefetch={false} href={`/?from=${encodeURIComponent(g.inToken.key)}&to=${encodeURIComponent(g.outToken.key)}&amount=${g.inAmount.toFixed(6)}`} style={{ marginLeft: 'auto', color: C.goldLit }}>swap ↗</Link>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Terra Swap's router" note={<>The last 30 days of <Link href='/verify' style={{ color: C.goldLit }}>the router</Link>: swaps signed on the interface, deposits swapped on arrival over IBC, and anyone else calling it. Swaps signed on the interface carry their quote and what paths through three pools and splitting added over the best path through up to two pools; the chain shows what arrived.</>}>
            {!stats && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{statsFailed ? 'The chain did not answer in time. Try again in a moment.' : 'Reading 30 days of transactions…'}</div>}
            {r && r.read === false && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>The chain&apos;s transaction history did not answer in time. Reload in a minute.</div>}
            {r && t && r.read !== false && (
              <>
                <div style={{ display: 'flex', gap: SPACE['4'], flexWrap: 'wrap', marginBottom: SPACE['3'] }}>
                  <Figure label='Swaps' value={String(r.swaps)} sub={`${r.wallets} wallet${r.wallets === 1 ? '' : 's'}${r.complete ? '' : ` · last ${ago(r.since)}`}`} />
                  <Figure label='Volume' value={fmtUsd(r.volumeUsd)} sub={r.unpriced ? `${r.unpriced} unpriced` : 'at today’s prices'} />
                  <Figure label='Arrived swapped' value={String(r.arrivals)} sub='over IBC' />
                  <Figure label='Routing added' value={t.avgGainPct != null ? signed(t.avgGainPct) : '—'} sub={`${t.improved} of ${t.swaps} tagged swaps${t.extraUsd > 0 ? ` · ${fmtUsd(t.extraUsd)} more delivered` : ''}`} />
                </div>
                {t.vsQuotePct != null && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginBottom: SPACE['2'] }}>What arrived against the quote, on average: <span style={{ color: t.vsQuotePct >= -0.05 ? C.success : C.ember }}>{signed(t.vsQuotePct)}</span></div>}
              </>
            )}
            {stats && stats.benchmark.length > 0 && (
              <>
                <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, margin: `${SPACE['2']}px 0 4px` }}>Priced now, three ways</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ color: C.textWhisper }}><th style={cell}>Trade</th><th style={cell}>One pool</th><th style={cell}>Up to two pools</th><th style={cell}>The site</th><th style={cell}>Added</th></tr></thead>
                    <tbody>
                      {stats.benchmark.map(b => (
                        <tr key={b.trade}>
                          <td style={{ ...cell, color: C.textPrimary }}>{b.trade}</td>
                          <td style={{ ...cell, color: C.textMuted }}>{b.onePool ?? '—'}</td>
                          <td style={{ ...cell, color: C.textMuted }}>{b.twoPools ?? '—'}</td>
                          <td style={{ ...cell, color: C.textSecondary }} title={b.route}>{b.site}</td>
                          <td style={{ ...cell, color: b.vsTwoPct != null && b.vsTwoPct >= 0.005 ? C.success : C.textMuted }}>{b.vsTwoPct != null ? (Math.abs(b.vsTwoPct) < 0.005 ? '0' : signed(b.vsTwoPct)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Before gas, pool fees included, at 1% slippage. Hover a result for its route.</div>
              </>
            )}
          </Panel>

          <Panel title='Uptime' note={<>Checked every ten minutes from GitHub&apos;s machines: a site is up when its page loads and its data answers with live data. The log is public on the repository&apos;s <a href={`${REPO}/tree/status/uptime`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>status branch</a>.</>}>
            {!stats && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>…</div>}
            {stats && !stats.uptime && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>This month&apos;s log could not be read.</div>}
            <div style={{ display: 'flex', gap: SPACE['4'], flexWrap: 'wrap' }}>
              {stats?.uptime?.sites.map(s => (
                <Figure key={s.site} label={s.site} value={`${s.pct.toFixed(s.pct === 100 ? 0 : 2)}%`} sub={`${s.up} of ${s.checks} checks in ${stats.uptime!.month}`} />
              ))}
            </div>
          </Panel>
        </div>
      </main>
    </>
  )
}
