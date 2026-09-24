/**
 * /token/[symbol]: a page per listed token. What it is and where it comes
 * from, its price over time as this site has written it down, how much of it
 * trades before the price moves, who controls it, every pool on Terra Swap and
 * Astroport that holds it, and a swap one click away. For people who arrive
 * from a search or a shared link wanting to know where a token trades on
 * Terra, and what stands behind it. The title and summary are rendered on the
 * server, so search engines and chat previews get them; the numbers are read
 * in the browser, like /stats.
 */

import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { useEffect, useMemo, useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import { C, Figure, Page, Panel, cell, fmtNum, linkBtn, row } from 'components/PageShell'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import PriceHistoryChart from 'components/PriceHistoryChart'
import DepthCurve, { markLine } from 'components/DepthCurve'
import { KNOWN_TOKENS, VENUE_NAME, annotateMarket, annotateValues, assetId, sameAsset, type KnownToken } from 'lib/dex'
import { fmtUsd } from 'lib/arb'
import { TOKEN_META } from 'lib/tokenMeta'
import { addAlert, askNotifications, fmtUsdPrice, removeAlert, toggleFavorite, useAlertWatcher, usePrefs } from 'lib/alerts'
import { disablePush, enablePush, usePush } from 'lib/push'
import type { TokenCheck } from 'lib/tokenCheck'
import type { DexResponse } from 'pages/api/dex'
import type { VenueResponse } from 'pages/api/dex-venue'
import type { DepthResponse } from 'pages/api/depth'
import { pageActive } from 'lib/pageActive'

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
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`
const json = <T,>(u: string) => fetch(u).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)

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
  const base = `https://${ctx.req.headers.host ?? 'swap.openfields.app'}`
  const meta = TOKEN_META[t.key]
  return {
    props: {
      symbol: t.key,
      og: {
        title: `${t.label} on Terra: price, pools and a swap`,
        description: `${meta ? `${meta.name}, from ${meta.origin}. ` : ''}Its price over time, who controls it, every pool on Terra Swap and Astroport that holds ${t.label}, and a swap priced across all of them. No interface fee.`,
        image: `${base}/api/og/swap?from=${encodeURIComponent(counterpart(t.key))}&to=${encodeURIComponent(t.key)}`,
        url: `${base}/token/${encodeURIComponent(t.key)}`,
        type: 'website',
      },
    },
  }
}

/** How much trades before the price moves, selling the token and buying it, through the best route. */
function Sizes({ token, other }: { token: KnownToken; other: string }) {
  const [sell, setSell] = useState<DepthResponse | null | 'failed'>(null)
  const [buy, setBuy] = useState<DepthResponse | null | 'failed'>(null)
  useEffect(() => {
    let alive = true
    setSell(null); setBuy(null)
    json<DepthResponse>(`/api/depth?from=${encodeURIComponent(token.key)}&to=${encodeURIComponent(other)}`).then(d => { if (alive) setSell(d ?? 'failed') })
    json<DepthResponse>(`/api/depth?from=${encodeURIComponent(other)}&to=${encodeURIComponent(token.key)}`).then(d => { if (alive) setBuy(d ?? 'failed') })
    return () => { alive = false }
  }, [token.key, other])
  const side = (title: string, d: DepthResponse | null | 'failed') => (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: TEXT.sm.size, color: C.textPrimary, fontWeight: 600 }}>{title}</div>
      {d === null && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Pricing a dozen sizes…</div>}
      {d === 'failed' && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>No route or no market price for this right now.</div>}
      {d && d !== 'failed' && d.kind === 'route' && (
        <>
          <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary }}>Price impact {markLine(d)}</div>
          <DepthCurve depth={d} />
        </>
      )}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: SPACE['3'] }}>
      {side(`Selling ${token.label} for ${other}`, sell)}
      {side(`Buying ${token.label} with ${other}`, buy)}
    </div>
  )
}

/** Who can make more of it, change it, and what stands behind it (lib/tokenCheck). */
function Controls({ token }: { token: KnownToken }) {
  const [c, setC] = useState<TokenCheck | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setC(null); setFailed(false)
    json<TokenCheck>(`/api/token-check?token=${encodeURIComponent(token.key)}`).then(j => { if (!alive) return; if (j) setC(j); else setFailed(true) })
    return () => { alive = false }
  }, [token.key])
  const muted: React.CSSProperties = { fontSize: TEXT.xs.size, color: C.textMuted }
  if (failed) return <div style={muted}>The chain did not answer. Try again in a moment.</div>
  if (!c) return <div style={muted}>Reading the contracts, and the chain it comes from…</div>

  const terra = (a: string) => <a href={`https://scan.openfields.app/address/${a}`} target='_blank' rel='noreferrer' style={{ color: 'inherit', fontFamily: mono }}>{short(a)} ↗</a>
  const line = (k: string, v: React.ReactNode, color: string = C.textSecondary) => (
    <div style={row}><span>{k}</span><span style={{ color, textAlign: 'right', maxWidth: '72%', lineHeight: 1.5 }}>{v}</span></div>
  )
  const good = C.success, care = C.ember
  const cap = (n: number | null) => (n != null ? `, up to ${fmtNum(n)} in all` : ', with no cap')

  let mint: React.ReactNode = null
  const m = c.mint
  if (m.by === 'chain') mint = line('Can more be made?', `Only by the chain's own rules. No address can mint ${token.label}.`, good)
  else if (m.by === 'nobody') mint = line('Can more be made?', c.kind === 'cw20' ? 'No. The contract has no minter, so the supply can only fall, by burning.' : 'No. The denom has no admin.', good)
  else if (m.by === 'address' && m.contract) mint = (
    <>
      {line('Can more be made?', <>Yes, by a contract{cap(m.cap)}: {terra(m.address)}</>)}
      {'minterAdmin' in m && line('Can the minting contract change?', m.minterAdmin ? <>Yes. {terra(m.minterAdmin)} can replace its code.</> : 'No. It has no admin.', m.minterAdmin ? care : good)}
    </>
  )
  else if (m.by === 'address') mint = line('Can more be made?', <>Yes, by one wallet{cap(m.cap)}: {terra(m.address)}</>, care)
  else if (m.by === 'origin') mint = line('Can more be made?', <>On {m.chain}, where it comes from, not on Terra.{c.origin?.issuer ? ` ${c.origin.issuer}` : ''}</>)
  else mint = line('Can more be made?', 'Could not be read just now.')

  const b = c.backing
  const ratio = b && b.onTerra > 0 ? b.locked / b.onTerra : null
  const h = c.holders
  return (
    <div>
      {mint}
      {c.admin && line('Can the token contract change?', c.admin.admin ? <>Yes. {terra(c.admin.admin)} can replace its code.</> : 'No. It has no admin.', c.admin.admin ? care : good)}
      {c.factoryAdmin && c.kind === 'ibc' && line(`Admin on ${c.factoryAdmin.chain}`, c.factoryAdmin.admin ? <span style={{ fontFamily: mono }}>{short(c.factoryAdmin.admin)}</span> : 'none')}
      {line('On Terra', c.supply != null ? `${fmtNum(c.supply)} ${token.label}` : '—')}
      {b && ratio != null && line(`Locked on ${b.chain}`, <>{fmtNum(b.locked)} against {fmtNum(b.onTerra)} here · {ratio >= 0.999 ? 'fully backed' : `${(ratio * 100).toFixed(1)}% of what exists here`}</>, ratio >= 0.999 ? good : care)}
      {h && (
        <>
          {line('Holders', `${h.accounts.toLocaleString('en-US')}${h.complete ? '' : ' read so far'}`)}
          {line('The largest ten hold', `${h.top10Pct.toFixed(1)}% of the supply; the pools and other contracts among them hold ${h.top10InContractsPct.toFixed(1)}%`)}
          <div style={{ marginTop: 4 }}>
            {h.top.slice(0, 5).map(x => (
              <div key={x.address} style={{ ...row, fontSize: TEXT.xs.size }}>
                <span style={{ color: C.textMuted }}>{x.label ?? (x.contract ? 'a contract' : 'a wallet')} · {terra(x.address)}</span>
                <span style={{ color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{x.pct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.6, margin: '8px 0 0' }}>
        Read from the chain {new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{b ? ' Locked is the IBC escrow for this channel on the chain it comes from; a transfer in flight can make the two differ for a moment.' : ''} Not an audit: it shows who can do what, not what they will do.
      </p>
    </div>
  )
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

  // Starring and price alerts, kept in this browser (lib/alerts), and on the server only if someone turns on alerts with the page closed (lib/push).
  const { favorites, alerts } = usePrefs()
  const push = usePush(alerts)
  const starred = favorites.includes(id)
  const mine = alerts.filter(a => a.tokenId === id)
  const armed = mine.some(a => !a.firedAt)
  const [dir, setDir] = useState<'above' | 'below'>('above')
  const [level, setLevel] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [pushNote, setPushNote] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    let alive = true
    // The market reference changes every five minutes (lib/scanPlan); read it that often while someone is looking.
    const t = setInterval(() => {
      if (!pageActive()) return
      fetch('/api/dex-market').then(r => (r.ok ? r.json() : null)).then((j: { px?: Record<string, number> } | null) => { if (alive && j?.px) setPx(j.px) }).catch(() => {})
    }, 300_000)
    return () => { alive = false; clearInterval(t) }
  }, [armed])
  useAlertWatcher(px, fired => setNote(fired.map(f => `${f.label} is ${f.dir} $${fmtUsdPrice(f.usd)}: $${fmtUsdPrice(f.firedUsd ?? 0)} now.`).join(' ')))
  const setAlert = async () => {
    const usd = Number(level)
    if (!(usd > 0)) return
    addAlert({ tokenId: id, key: token.key, label: token.label, dir, usd })
    setLevel('')
    if (!push.on) await askNotifications()
  }
  const togglePush = async (on: boolean) => {
    setPushNote(null)
    if (!on) { await disablePush(); return }
    const r = await enablePush()
    if (!r.ok) setPushNote(r.why)
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

      <Panel title='Price' note="The market reference: Astroport's deepest markets on Terra, written down by this site every ten minutes. Past prices, not a forecast.">
        <PriceHistoryChart query={`token=${encodeURIComponent(token.key)}`} unit='$' />
        <div style={{ display: 'flex', gap: SPACE['4'], flexWrap: 'wrap', marginTop: SPACE['3'] }}>
          <Figure label='Now' value={price ? `$${fmtNum(price)}` : done ? '—' : '…'} />
          <Figure label='In pools holding it' value={done ? fmtUsd(liquidity) : '…'} sub={done ? `${pools.length} pool${pools.length === 1 ? '' : 's'}` : undefined} />
        </div>
      </Panel>

      <Panel title='How much trades before the price moves' note="Price impact by size, through the best route over both sites' pools, the way the swap signs it. It is what the pools would do right now; the next trade changes it.">
        <Sizes token={token} other={other} />
      </Panel>

      <Panel title={`Who controls ${token.label}`} note='Whether more can be made and by whom, whether its contract can be changed, and what stands behind it, read from the chain.'>
        <Controls token={token} />
      </Panel>

      <Panel title={`Watch ${token.label}`} note='An alert goes off once, when the market reference crosses its level: on an open Terra Swap page, and with the option below, as a notification with the page closed.'>
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
        {push.supported && (
          <div style={{ marginTop: SPACE['3'], borderTop: `1px solid ${C.divider}`, paddingTop: SPACE['2'] }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: TEXT.sm.size, color: C.textPrimary, cursor: 'pointer' }}>
              <input type='checkbox' checked={push.on} onChange={e => void togglePush(e.target.checked)} />
              Also when no Terra Swap page is open
            </label>
            <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '4px 0 0' }}>
              This keeps this browser&apos;s notification address and its alert levels on Terra Swap&apos;s server, and nothing else: no wallet, no name. Checked every ten minutes. Turn it off to delete them.
            </p>
            {pushNote && <div style={{ fontSize: TEXT.xs.size, color: C.ember, marginTop: 4 }}>{pushNote}</div>}
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
          <span style={{ color: C.textSecondary, fontFamily: mono, wordBreak: 'break-all', textAlign: 'right' }}>
            {cw20 ? <a href={`https://scan.openfields.app/address/${id}`} target='_blank' rel='noreferrer' style={{ color: 'inherit' }}>{id} ↗</a> : id}
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
