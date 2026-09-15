/**
 * /token/[symbol]: a page per listed token. What it is and where it comes
 * from, its price at the market reference, every pool on Terra Swap and
 * Astroport that holds it, and a swap one click away. For people who arrive
 * from a search or a shared link wanting to know where a token trades on
 * Terra. The title and summary are rendered on the server, so search engines
 * and chat previews get them; the numbers are read in the browser, like /stats.
 */

import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { useEffect, useMemo, useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import { C, Figure, Page, Panel, cell, fmtNum, linkBtn, row } from 'components/PageShell'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import { KNOWN_TOKENS, VENUE_NAME, annotateMarket, annotateValues, assetId, sameAsset, type KnownToken } from 'lib/dex'
import { fmtUsd } from 'lib/arb'
import { TOKEN_META } from 'lib/tokenMeta'
import { addAlert, askNotifications, fmtUsdPrice, removeAlert, toggleFavorite, useAlertWatcher, usePrefs } from 'lib/alerts'
import type { DexResponse } from 'pages/api/dex'
import type { VenueResponse } from 'pages/api/dex-venue'

/** Bought with and sold for USDC from Noble; USDC itself, and USDC.inj, which never meets it, trade against LUNA. */
const counterpart = (key: string) => (key === 'USDC' || key === 'USDC.inj' ? 'LUNA' : 'USDC')
/** Tokens the Bridge tab brings in, and from where. */
const BRIDGE: Record<string, { name: string; net: string }> = {
  USDC: { name: 'Noble', net: 'noble' }, ATOM: { name: 'the Cosmos Hub', net: 'cosmoshub' }, 'USDC.inj': { name: 'Injective', net: 'injective' },
  ASTRO: { name: 'Neutron', net: 'neutron-astro' }, dATOM: { name: 'Neutron', net: 'neutron-datom' }, FUEL: { name: 'Neutron', net: 'neutron-fuel' },
  stLUNA: { name: 'Stride', net: 'stride-stluna' }, stATOM: { name: 'Stride', net: 'stride-statom' },
}
/** Liquid staking tokens whose hub rate the stats page sets against the pools. */
const HUB_RATE = new Set(['ampLUNA', 'bLUNA'])

function kindOf(t: KnownToken): string {
  if ('token' in t.info) return 'cw20 token on Terra'
  const d = t.info.native_token.denom
  if (d === 'uluna') return "Terra's native token"
  if (d.startsWith('ibc/')) return 'IBC token'
  if (d.startsWith('factory/')) return 'TokenFactory token on Terra'
  return 'native token'
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const raw = String(ctx.params?.symbol ?? '')
  const t = KNOWN_TOKENS.find(x => x.key.toLowerCase() === raw.toLowerCase())
  if (!t) return { notFound: true }
  if (t.key !== raw) return { redirect: { destination: `/token/${encodeURIComponent(t.key)}`, permanent: false } }
  const base = `https://${ctx.req.headers.host ?? 'swap.terraluna.app'}`
  const meta = TOKEN_META[t.key]
  return {
    props: {
      symbol: t.key,
      og: {
        title: `${t.label} on Terra: price, pools and a swap`,
        description: `${meta ? `${meta.name}, from ${meta.origin}. ` : ''}Its price, every pool on Terra Swap and Astroport that holds ${t.label}, and a swap priced across all of them. No interface fee.`,
        image: `${base}/api/og/swap?from=${encodeURIComponent(counterpart(t.key))}&to=${encodeURIComponent(t.key)}`,
        url: `${base}/token/${encodeURIComponent(t.key)}`,
        type: 'website',
        icon: '/img/terra-globe.svg',
        touchIcon: '/img/terra-globe-180.png',
      },
    },
  }
}

export default function TokenPage({ symbol }: { symbol: string }) {
  const token = KNOWN_TOKENS.find(t => t.key === symbol) ?? KNOWN_TOKENS[0]
  const id = assetId(token.info)
  const meta = TOKEN_META[token.key]
  const other = counterpart(token.key)
  const [dex, setDex] = useState<DexResponse | null>(null)
  const [venue, setVenue] = useState<VenueResponse | null>(null)
  const [px, setPx] = useState<Record<string, number> | null>(null)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let alive = true
    const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
    Promise.all([json<DexResponse>('/api/dex'), json<VenueResponse>('/api/dex-venue'), json<{ px?: Record<string, number> }>('/api/dex-market')])
      .then(([d, v, m]) => { if (!alive) return; setDex(d); setVenue(v); setPx(m?.px ?? null); setDone(true) })
    return () => { alive = false }
  }, [symbol])

  const pools = useMemo(() => {
    const own = (dex?.pools ?? []).filter(p => !p.empty).map(p => ({ ...p }))
    if (px) { annotateMarket(own, px); annotateValues(own, px) }
    return [...own, ...(venue?.pools ?? []).filter(p => !p.empty)]
      .filter(p => p.tokens.some(t => sameAsset(t.info, token.info)) && (p.tvlUsd ?? 0) >= 1)
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
  }, [dex, venue, px, token])
  const price = px?.[id]
  const liquidity = pools.reduce((s, p) => s + (p.tvlUsd ?? 0), 0)
  const cw20 = 'token' in token.info
  const bridge = BRIDGE[token.key]

  // Starring and price alerts, kept in this browser only (lib/alerts). While an alert waits, the price is read again once a minute.
  const { favorites, alerts } = usePrefs()
  const starred = favorites.includes(id)
  const mine = alerts.filter(a => a.tokenId === id)
  const armed = mine.some(a => !a.firedAt)
  const [dir, setDir] = useState<'above' | 'below'>('above')
  const [level, setLevel] = useState('')
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    let alive = true
    const t = setInterval(() => {
      fetch('/api/dex-market').then(r => (r.ok ? r.json() : null)).then((j: { px?: Record<string, number> } | null) => { if (alive && j?.px) setPx(j.px) }).catch(() => {})
    }, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [armed])
  useAlertWatcher(px, fired => setNote(fired.map(f => `${f.label} is ${f.dir} $${fmtUsdPrice(f.usd)}: $${fmtUsdPrice(f.firedUsd ?? 0)} now.`).join(' ')))
  const setAlert = async () => {
    const usd = Number(level)
    if (!(usd > 0)) return
    addAlert({ tokenId: id, key: token.key, label: token.label, dir, usd })
    setLevel('')
    await askNotifications()
  }
  const small: React.CSSProperties = { padding: '0.45rem 0.6rem', background: 'rgba(0,0,0,0.32)', border: `1px solid ${C.divider}`, borderRadius: 10, color: C.textPrimary, fontFamily: 'inherit', fontSize: TEXT.sm.size }

  return (
    <Page>
      <header style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'] }}>
          <TokenIcon label={token.label} size={44} />
          <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.4rem)', margin: 0, letterSpacing: '-0.02em' }}>
            <span style={{ fontWeight: 700, color: C.goldLit }}>{token.label}</span> <span style={{ fontWeight: 300 }}>on Terra</span>
          </h1>
        </div>
        {meta && <p style={{ fontSize: TEXT.sm.size, color: C.textSecondary, margin: 0 }}>{meta.name} · from {meta.origin}</p>}
      </header>

      <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap' }}>
        <Link href={`/?from=${encodeURIComponent(other)}&to=${encodeURIComponent(token.key)}`} style={linkBtn(true)}>Buy {token.label}</Link>
        <Link href={`/?from=${encodeURIComponent(token.key)}&to=${encodeURIComponent(other)}`} style={linkBtn()}>Sell {token.label}</Link>
        {bridge && <Link href={`/?tab=bridge&net=${bridge.net}`} style={linkBtn()}>Bring {token.label} in from {bridge.name}</Link>}
        {HUB_RATE.has(token.key) && <Link href='/stats' style={linkBtn()}>Hub rate against the pools</Link>}
      </div>

      <Panel title='Price and liquidity' note="The price is Astroport's deepest markets on Terra, read when this page opened. Liquidity is the value of every pool below, both sides.">
        <div style={{ display: 'flex', gap: SPACE['4'], flexWrap: 'wrap' }}>
          <Figure label='Price' value={price ? `$${fmtNum(price)}` : done ? '—' : '…'} />
          <Figure label='In pools holding it' value={done ? fmtUsd(liquidity) : '…'} sub={done ? `${pools.length} pool${pools.length === 1 ? '' : 's'}` : undefined} />
        </div>
      </Panel>

      <Panel title={`Watch ${token.label}`} note='Kept in this browser only. An alert goes off once, when an open Terra Swap page sees the market reference cross its level; with notifications allowed, the browser says so too.'>
        <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap', alignItems: 'center' }}>
          <button type='button' onClick={() => toggleFavorite(id)} style={{ ...linkBtn(), cursor: 'pointer', color: starred ? C.goldLit : C.textSecondary }}>{starred ? '★ Starred' : '☆ Star'}</button>
          <span style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Tell me when it is</span>
          <select aria-label='Direction' value={dir} onChange={e => setDir(e.target.value as 'above' | 'below')} style={{ ...small, cursor: 'pointer' }}>
            <option value='above'>above</option>
            <option value='below'>below</option>
          </select>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: C.textMuted }}>$</span>
            <input aria-label='Price in dollars' inputMode='decimal' value={level} onChange={e => setLevel(e.target.value.replace(',', '.'))} placeholder={price ? fmtUsdPrice(price) : '0.00'} style={{ ...small, width: 110 }} />
          </span>
          <button type='button' onClick={setAlert} disabled={!(Number(level) > 0)} style={{ ...linkBtn(true), cursor: 'pointer', opacity: Number(level) > 0 ? 1 : 0.5 }}>Set alert</button>
        </div>
        {note && <div style={{ fontSize: TEXT.xs.size, color: C.success, marginTop: 8 }}>🔔 {note}</div>}
        {mine.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {mine.map(a => (
              <div key={a.id} style={{ ...row, alignItems: 'center' }}>
                <span style={{ color: C.textSecondary }}>{a.dir} ${fmtUsdPrice(a.usd)}</span>
                <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: a.firedAt ? C.success : C.textWhisper }}>{a.firedAt ? `went off at $${fmtUsdPrice(a.firedUsd ?? 0)}` : 'waiting'}</span>
                  <button type='button' aria-label='Remove alert' onClick={() => removeAlert(a.id)} style={{ background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer' }}>✕</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`Pools with ${token.label}`} note='Every pool with liquidity on both factories that holds it, deepest first. A swap here goes through whichever pools deliver the most, on either site.'>
        {!done && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading the pools…</div>}
        {done && pools.length === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>No pool with liquidity holds {token.label} right now.</div>}
        {pools.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: C.textWhisper }}><th style={cell}>Pool</th><th style={cell}>Site</th><th style={cell}>Liquidity</th><th style={cell}>1 {token.label} =</th></tr></thead>
              <tbody>
                {pools.map(p => {
                  const first = sameAsset(p.tokens[0].info, token.info)
                  const o = first ? p.tokens[1] : p.tokens[0]
                  const rate = first ? p.price : p.price > 0 ? 1 / p.price : 0
                  return (
                    <tr key={p.contract_addr}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <Link href={`/pool/${p.contract_addr}`} style={{ color: C.textPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                          <PairIcons a={p.tokens[0].label} b={p.tokens[1].label} size={16} />{p.label}
                        </Link>
                      </td>
                      <td style={{ ...cell, color: C.textMuted }}>{VENUE_NAME[p.venue]}{p.pairType !== 'xyk' ? ` · ${p.pairType}` : ''}</td>
                      <td style={{ ...cell, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{p.tvlUsd != null ? fmtUsd(p.tvlUsd) : '—'}</td>
                      <td style={{ ...cell, color: C.textSecondary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{rate > 0 ? `${fmtNum(rate)} ${o.label}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title='About'>
        <div style={row}><span>What it is</span><span style={{ color: C.textSecondary }}>{kindOf(token)}</span></div>
        {meta && <div style={row}><span>Comes from</span><span style={{ color: C.textSecondary }}>{meta.origin}</span></div>}
        <div style={row}>
          <span>{cw20 ? 'Contract' : 'Denom'}</span>
          <span style={{ color: C.textSecondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', textAlign: 'right' }}>
            {cw20 ? <a href={`https://terrasco.pe/mainnet/address/${id}`} target='_blank' rel='noreferrer' style={{ color: 'inherit' }}>{id} ↗</a> : id}
          </span>
        </div>
        <div style={row}><span>Decimals</span><span style={{ color: C.textSecondary }}>{token.decimals}</span></div>
        {token.key === 'USDC.inj' && (
          <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '8px 0 0' }}>
            USDC.inj is Circle&apos;s USDC as issued on Injective, a token of its own on Terra. This site never swaps it for USDC from Noble, in either direction.
          </p>
        )}
      </Panel>
    </Page>
  )
}
