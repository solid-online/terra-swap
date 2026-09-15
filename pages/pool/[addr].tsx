/**
 * /pool/[addr]: a page per pool. Its liquidity and both sides, its price and
 * how far that sits from the market, how much $100 and $1,000 move it, what
 * its swaps paid its providers, its recent trades, and the ways in: a swap
 * either way, or adding liquidity. Read in the browser from the same endpoints
 * as /stats, and the price impact from the pool's own simulation; the title is
 * rendered on the server from the pool's pair query.
 */

import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { useEffect, useMemo, useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import { C, Figure, Page, Panel, fmtNum, linkBtn, row } from 'components/PageShell'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import {
  KNOWN_TOKENS, NOBLE_USDC, USDC_INJ_DENOM, VENUE_NAME, annotateMarket, annotateValues, assetId, fromMicro, simulateSwap, smart, toMicro, tokenFor,
  type AssetInfo, type PoolView,
} from 'lib/dex'
import { fmtAmount, fmtUsd } from 'lib/arb'
import type { DexResponse } from 'pages/api/dex'
import type { VenueResponse } from 'pages/api/dex-venue'
import type { PoolFeesResponse } from 'pages/api/pool-fees'
import type { PricesResponse } from 'pages/api/dex-prices'

const ADDR = /^terra1[02-9ac-hj-np-z]{38,58}$/
const enc = encodeURIComponent
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const getServerSideProps: GetServerSideProps = async ctx => {
  const addr = String(ctx.params?.addr ?? '')
  if (!ADDR.test(addr)) return { notFound: true }
  const base = `https://${ctx.req.headers.host ?? 'swap.terraluna.app'}`
  let label = ''
  let share = ''
  try {
    const info = await Promise.race([
      smart<{ asset_infos?: AssetInfo[] }>(addr, { pair: {} }),
      new Promise<null>(r => setTimeout(() => r(null), 3500)),
    ])
    if (info?.asset_infos?.length === 2) {
      const [t0, t1] = info.asset_infos.map(tokenFor)
      label = `${t0.label} / ${t1.label}`
      const listed = [t0, t1].every(t => KNOWN_TOKENS.some(k => k.key === t.key))
      const dollars = [t0, t1].map(t => assetId(t.info))
      if (listed && !(dollars.includes(NOBLE_USDC) && dollars.includes(USDC_INJ_DENOM))) share = `?from=${enc(t0.key)}&to=${enc(t1.key)}`
    }
  } catch { /* the page reads the pool again in the browser */ }
  return {
    props: {
      addr,
      label,
      og: {
        title: label ? `${label} pool on Terra` : 'A pool on Terra',
        description: `${label ? `The ${label} pool: its` : 'Its'} liquidity, price against the market, what it paid its providers and its recent trades, read from the chain, with a swap and a way to add liquidity.`,
        image: `${base}/api/og/swap${share}`,
        url: `${base}/pool/${addr}`,
        type: 'website',
        icon: '/img/terra-globe.svg',
        touchIcon: '/img/terra-globe-180.png',
      },
    },
  }
}

function Spark({ points }: { points: number[] }) {
  const W = 300, H = 56, PAD = 3
  if (points.length < 2) return null
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(PAD + (i / (points.length - 1)) * (W - PAD * 2)).toFixed(1)},${(H - PAD - ((v - min) / span) * (H - PAD * 2)).toFixed(1)}`).join(' ')
  const up = points[points.length - 1] >= points[0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' style={{ width: '100%', height: 56, display: 'block', margin: '6px 0' }}>
      <path d={d} fill='none' stroke={up ? C.success : C.alert} strokeWidth='2' vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />
    </svg>
  )
}

export default function PoolPage({ addr, label }: { addr: string; label: string }) {
  const [dex, setDex] = useState<DexResponse | null>(null)
  const [venue, setVenue] = useState<VenueResponse | null>(null)
  const [px, setPx] = useState<Record<string, number> | null>(null)
  const [done, setDone] = useState(false)
  const [fees, setFees] = useState<PoolFeesResponse | null>(null)
  const [feesFailed, setFeesFailed] = useState(false)
  const [prices, setPrices] = useState<PricesResponse | null>(null)
  const [impact, setImpact] = useState<{ usd: number; pct: number }[] | null>(null)

  useEffect(() => {
    let alive = true
    const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
    Promise.all([json<DexResponse>('/api/dex'), json<VenueResponse>('/api/dex-venue'), json<{ px?: Record<string, number> }>('/api/dex-market')])
      .then(([d, v, m]) => { if (!alive) return; setDex(d); setVenue(v); setPx(m?.px ?? null); setDone(true) })
    json<PoolFeesResponse>(`/api/pool-fees?pair=${addr}`).then(f => { if (!alive) return; if (f) setFees(f); else setFeesFailed(true) })
    json<PricesResponse>(`/api/dex-prices?pair=${addr}`).then(p => { if (alive && p) setPrices(p) })
    return () => { alive = false }
  }, [addr])

  const pool = useMemo<PoolView | null>(() => {
    const own = (dex?.pools ?? []).map(p => ({ ...p }))
    if (px) { const live = own.filter(p => !p.empty); annotateMarket(live, px); annotateValues(live, px) }
    return [...own, ...(venue?.pools ?? [])].find(p => p.contract_addr === addr) ?? null
  }, [dex, venue, px, addr])

  // What $100 and $1,000 of the first token do to the price, from the pool's own simulation.
  const impactKey = pool && px && !pool.empty ? `${pool.contract_addr}|${pool.price}|${px[assetId(pool.tokens[0].info)] ?? 0}` : ''
  useEffect(() => {
    if (!impactKey || !pool || !px) return
    const [t0, t1] = pool.tokens
    const p0 = px[assetId(t0.info)]
    if (!(p0 > 0) || !(pool.price > 0)) return
    let alive = true
    Promise.all([100, 1000].map(async usd => {
      const micro = toMicro((usd / p0).toFixed(Math.min(t0.decimals, 8)), t0.decimals)
      if (!micro || micro === '0') return null
      const s = await simulateSwap(pool.contract_addr, { info: t0.info, amount: micro }).catch(() => null)
      if (!s) return null
      const got = (Number(s.return_amount) + Number(s.commission_amount)) / 10 ** t1.decimals
      const fair = (Number(micro) / 10 ** t0.decimals) * pool.price
      return fair > 0 ? { usd, pct: Math.max(0, (1 - got / fair) * 100) } : null
    })).then(r => { if (alive) setImpact(r.filter((x): x is { usd: number; pct: number } => x !== null)) })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impactKey])

  const title = pool?.label ?? (label || 'A pool')
  if (!pool) {
    return (
      <Page>
        <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)', margin: 0 }}><span style={{ fontWeight: 700, color: C.goldLit }}>{title}</span> <span style={{ fontWeight: 300 }}>pool</span></h1>
        <Panel title={done ? 'Not listed here' : 'Reading the pool…'}>
          {done && (
            <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: 0 }}>
              This site lists pools on Terra Swap&apos;s factory and Astroport&apos;s pools of the tokens it trades. This one is not among them, or the chain did not answer just now.{' '}
              <a href={`https://terrasco.pe/mainnet/address/${addr}`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>See it on Terrascope ↗</a>
            </p>
          )}
        </Panel>
      </Page>
    )
  }

  const [t0, t1] = pool.tokens
  const ids = pool.tokens.map(t => assetId(t.info))
  const bothDollars = ids.includes(NOBLE_USDC) && ids.includes(USDC_INJ_DENOM)
  const off = pool.deviation != null && pool.deviation > 0 ? (pool.deviation > 1 ? pool.deviation : 1 / pool.deviation) : null
  const feeText = pool.venue === 'terraswap'
    ? '0.3% per swap, all of it to liquidity providers'
    : `${pool.pairType === 'xyk' ? '0.3%' : pool.pairType === 'stable' ? '0.05%' : 'a dynamic fee'} per swap, set by Astroport's pool, part of it to Astroport`
  const days = fees && !fees.complete && fees.since ? Math.max(1, Math.round((fees.at - Date.parse(fees.since)) / 86_400_000)) : 30
  const money = (v: { usd: number | null; swaps: number }) => {
    const swaps = `${v.swaps} swap${v.swaps === 1 ? '' : 's'}`
    return v.usd != null ? `${fmtUsd(v.usd)} from ${swaps}` : `${swaps}, in a token without a market price`
  }
  const series = (prices?.points ?? []).map(p => p.p).filter(v => Number.isFinite(v) && v > 0)
  const known = (key: string) => KNOWN_TOKENS.some(k => k.key === key)

  return (
    <Page>
      <header style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flexWrap: 'wrap' }}>
          <PairIcons a={t0.label} b={t1.label} size={36} />
          <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)', margin: 0, letterSpacing: '-0.02em' }}>
            <span style={{ fontWeight: 700, color: C.goldLit }}>{pool.label}</span> <span style={{ fontWeight: 300 }}>pool</span>
          </h1>
          <span style={{ fontSize: TEXT.caption.size, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted }}>{VENUE_NAME[pool.venue]}{pool.pairType !== 'xyk' ? ` · ${pool.pairType}` : ''}</span>
        </div>
        <p style={{ margin: 0, fontSize: TEXT.xs.size, color: C.textMuted }}>{feeText}</p>
      </header>

      <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap' }}>
        {!pool.empty && !bothDollars && (
          <>
            <Link href={`/?from=${enc(t0.key)}&to=${enc(t1.key)}`} style={linkBtn(true)}>Swap {t0.label} for {t1.label}</Link>
            <Link href={`/?from=${enc(t1.key)}&to=${enc(t0.key)}`} style={linkBtn()}>Swap {t1.label} for {t0.label}</Link>
          </>
        )}
        <Link href={`/?tab=pools&pool=${pool.contract_addr}`} style={linkBtn(pool.empty)}>{pool.empty ? 'Add the first liquidity' : 'Add liquidity'}</Link>
      </div>

      <Panel title='Liquidity and price' note={pool.venue === 'terraswap' ? "The market is Astroport's deepest pools on Terra." : undefined}>
        <div style={{ display: 'flex', gap: SPACE['4'], flexWrap: 'wrap', marginBottom: SPACE['2'] }}>
          <Figure label='Liquidity' value={pool.empty ? 'empty' : pool.tvlUsd != null ? fmtUsd(pool.tvlUsd) : '—'} />
          {pool.price > 0 && <Figure label={`1 ${t0.label} =`} value={`${fmtNum(pool.price)} ${t1.label}`} sub={`1 ${t1.label} = ${fmtNum(1 / pool.price)} ${t0.label}`} />}
          {off != null && <Figure label='Against the market' value={off < 1.03 ? 'in line' : `${off.toFixed(off >= 10 ? 0 : 2)}× off`} sub={off < 1.03 ? 'within 3%' : 'the swap page shows the trade that closes it'} />}
        </div>
        {pool.tokens.map((t, i) => (
          <div key={i} style={row}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><TokenIcon label={t.label} size={16} />{t.label} in the pool</span>
            <span style={{ color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{fromMicro(pool.reserves[i], t.decimals)}{pool.sideUsd ? ` · ${fmtUsd(pool.sideUsd[i])}` : ''}</span>
          </div>
        ))}
        {impact && impact.length > 0 && (
          <div style={row}>
            <span>Price impact, selling {t0.label}</span>
            <span style={{ color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{impact.map(x => `$${x.usd.toLocaleString('en-US')}: ${x.pct < 0.01 ? 'under 0.01' : x.pct.toFixed(2)}%`).join(' · ')}</span>
          </div>
        )}
      </Panel>

      <Panel title='Paid to its providers' note="What this pool's swaps paid its liquidity providers, less Astroport's share on Astroport's pools, at today's prices. Past fees, not a forecast.">
        {!fees && !feesFailed && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading its swaps…</div>}
        {feesFailed && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>The chain&apos;s history did not answer. Try again in a moment.</div>}
        {fees && fees.day30.swaps === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>No swaps in the last 30 days.</div>}
        {fees && fees.day30.swaps > 0 && (
          <>
            {days >= 7 && <div style={row}><span>Last 7 days</span><span style={{ color: C.textSecondary }}>{money(fees.day7)}</span></div>}
            <div style={row}><span>Last {days} days</span><span style={{ color: C.textSecondary }}>{money(fees.day30)}</span></div>
          </>
        )}
      </Panel>

      <Panel title='Recent trades' note={`Execution prices of its last trades, ${t1.label} per ${t0.label}, read from the chain.`}>
        {!prices && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading trades…</div>}
        {prices && prices.tape.length === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>No trades found in its recent history.</div>}
        <Spark points={series} />
        {(prices?.tape ?? []).slice(0, 6).map(r => (
          <a key={r.tx} href={`https://terrasco.pe/mainnet/tx/${r.tx}`} target='_blank' rel='noreferrer' style={{ ...row, textDecoration: 'none' }}>
            <span style={{ color: r.side === 'buy' ? C.success : C.alert }}>{r.side === 'buy' ? '▲ bought' : '▼ sold'} {fmtAmount(r.base)} {t0.label}</span>
            <span style={{ color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>for {fmtAmount(r.quote)} {t1.label} · #{r.h.toLocaleString('en-US')} ↗</span>
          </a>
        ))}
      </Panel>

      <Panel title='About'>
        <div style={row}>
          <span>Pool contract</span>
          <a href={`https://terrasco.pe/mainnet/address/${pool.contract_addr}`} target='_blank' rel='noreferrer' style={{ color: C.textSecondary, fontFamily: mono, wordBreak: 'break-all', textAlign: 'right' }}>{pool.contract_addr} ↗</a>
        </div>
        <div style={row}><span>LP token</span><span style={{ color: C.textSecondary, fontFamily: mono, wordBreak: 'break-all', textAlign: 'right' }}>{pool.liquidity_token}</span></div>
        <div style={row}><span>LP tokens issued</span><span style={{ color: C.textSecondary }}>{fromMicro(pool.totalShare, 6)}</span></div>
        <div style={row}>
          <span>Tokens</span>
          <span style={{ display: 'inline-flex', gap: 10 }}>
            {pool.tokens.map(t => known(t.key)
              ? <Link key={t.key} href={`/token/${enc(t.key)}`} style={{ color: C.goldLit }}>{t.label} ↗</Link>
              : <span key={t.key} style={{ color: C.textSecondary }}>{t.label}</span>)}
          </span>
        </div>
        {pool.venue === 'terraswap' && (
          <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '8px 0 0' }}>
            Terra Swap&apos;s pools have no admin that can change them and no fee for anyone but their providers. <Link href='/verify' style={{ color: C.goldLit }}>Check it from your browser</Link>.
          </p>
        )}
      </Panel>
    </Page>
  )
}
