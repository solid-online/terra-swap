/**
 * Terra Predict — served at /predict.
 *
 * Yes or no on a price, settled by the chain itself. Parimutuel: winners
 * split the losing pool. The answer is a time-weighted average price read
 * from an Astroport pair by whoever shows up to read it; no oracle, no
 * operator, no admin. Renders "not live yet" until NEXT_PUBLIC_PREDICT_CONTRACT
 * is set.
 */

import Head from 'next/head'
import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useMyAddress from 'components/hooks/useMyAddress'
import WalletButton from 'components/WalletButton'
import { SPACE, TEXT } from 'components/tokens'
import { fromMicro, toMicro, queryNativeBalance } from 'lib/dex'
import {
  LUNA, USDC, LUNA_USDC_PAIR, MIN_LEAD_SECONDS,
  canVoid, fmtCountdown, fmtPrice, fmtWindow, impliedYes, payoutMultiple, phaseOf, secs,
  queryClaimable, queryPosition,
  type Market, type Phase, type Position, type Claimable, type Side,
} from 'lib/predict'
import type { PredictResponse } from 'pages/api/predict'
import { useBet, useClaim, useCreateMarket, useObserve, useResolve, useVoidMarket } from 'components/transactions/usePredict'
import { humanizeTxError } from 'lib/errors'

const TERRA_FONT = "'Montserrat', 'Space Grotesk', 'Inter', system-ui, sans-serif"

const C = {
  void: '#05070f', surface: '#0b0f1c', surfaceElev: '#111729',
  divider: 'rgba(255,216,61,0.13)', dividerWarm: 'rgba(255,179,71,0.34)',
  emberLit: '#ffb347', goldCore: '#caa022', goldLit: '#ffd83d', goldSoft: 'rgba(255,216,61,0.10)',
  textPrimary: '#f4f1e8', textSecondary: '#d6cfbd', textMuted: '#9a927f', textWhisper: '#6b6555',
  success: '#3ddc97', alert: '#e04a5a', korea: '#e0485a',
} as const

const field: React.CSSProperties = {
  width: '100%', padding: '0.7rem 0.8rem', background: 'rgba(0,0,0,0.32)', border: `1px solid ${C.divider}`,
  borderRadius: 10, color: C.textPrimary, fontSize: TEXT.md.size, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
}
const select: React.CSSProperties = { ...field, cursor: 'pointer', fontSize: TEXT.sm.size }
const label: React.CSSProperties = { display: 'block', fontSize: '0.64rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, fontFamily: TERRA_FONT }
const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '0.8rem', background: 'linear-gradient(135deg, #caa022 0%, #ffd83d 100%)', color: '#1a1405',
  border: '1px solid #ffd83d', borderRadius: 10, fontWeight: 700, fontSize: TEXT.sm.size, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  padding: '0.5rem 0.8rem', background: 'transparent', color: C.textSecondary, border: `1px solid ${C.divider}`,
  borderRadius: 9, fontSize: TEXT.xs.size, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div className='predict-card' style={{ background: C.surfaceElev, border: `1px solid ${accent ?? C.divider}`, borderRadius: 16, padding: '1rem 1.1rem' }}>
      {children}
    </div>
  )
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: '2rem 1.2rem', textAlign: 'center', border: `1px dashed ${C.divider}`, borderRadius: 16, background: C.surface }}>
      <div style={{ color: C.textPrimary, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ color: C.textMuted, fontSize: TEXT.sm.size, lineHeight: 1.6 }}>{body}</div>
    </div>
  )
}

const denomLabel = (d: string) => (d === 'uluna' ? 'LUNA' : d.startsWith('ibc/') ? 'USDC' : d.split('/').pop() ?? d)
const amt = (micro: string, d = 6, frac = 2) => fromMicro(micro, d, frac)

// ─── one market ─────────────────────────────────────────────────────────

interface CardProps {
  m: Market; now: number; spot?: number; twapNow?: string | null
  me: string; pos?: Position; claimable?: Claimable; feeBps: number; bountyBps: number
  balance: string; onDone: () => void; onToast: (s: string) => void
}

function MarketCard({ m, now, spot, twapNow, me, pos, claimable, feeBps, bountyBps, balance, onDone, onToast }: CardProps) {
  const phase: Phase = phaseOf(m, now)
  const voidable = canVoid(m, now)
  const yes = impliedYes(m)
  const close = secs(m.close_at), resolve = secs(m.resolve_at)
  const windowStart = resolve - m.twap_window
  const den = denomLabel(m.denom)
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const bet = useBet(), observe = useObserve(), settle = useResolve(), voidTx = useVoidMarket(), claim = useClaim()
  const busy = bet.isLoading || observe.isLoading || settle.isLoading || voidTx.isLoading || claim.isLoading

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr(null)
    try { await fn(); onToast(done); setAmount(''); setTimeout(onDone, 2500) } catch (e) { setErr(humanizeTxError(e)) }
  }
  const place = (side: Side) => {
    const micro = toMicro(amount, 6)
    if (!micro || micro === '0') return setErr('Enter an amount.')
    if (BigInt(micro) < BigInt(m.min_bet)) return setErr(`Minimum is ${amt(m.min_bet)} ${den}.`)
    if (BigInt(micro) > BigInt(balance || '0')) return setErr('Not enough balance.')
    return run(() => bet.mutateAsync({ sender: me, marketId: m.id, side, denom: m.denom, amountMicro: micro }), `${side.toUpperCase()} placed. Written down.`)
  }

  const outcome = m.resolution?.outcome
  const status = (() => {
    switch (phase) {
      case 'open': return { text: `Open · closes in ${fmtCountdown(close, now)}`, color: C.success }
      case 'waiting': return { text: `Closed · window opens in ${fmtCountdown(windowStart, now)}`, color: C.textMuted }
      case 'observe': return { text: `Window open · needs an observer (${fmtCountdown(windowStart + Math.floor(m.twap_window / 2), now)} left)`, color: C.emberLit }
      case 'missed': return { text: `Nobody observed · settles void at ${new Date(resolve * 1000).toLocaleString()} · refunds`, color: C.alert }
      case 'averaging': return { text: `Averaging · TWAP so far ${fmtPrice(twapNow)} · settles in ${fmtCountdown(resolve, now)}`, color: C.goldLit }
      case 'resolve': return { text: m.observation ? 'Ready to settle' : 'Ready to settle · void (no observation) · refunds', color: C.emberLit }
      case 'resolved': return outcome === 'void'
        ? { text: 'VOID · every stake refundable', color: C.textMuted }
        : { text: `${outcome!.toUpperCase()} · settled at ${fmtPrice(m.resolution!.twap)}`, color: outcome === 'yes' ? C.success : C.korea }
    }
  })()

  const myYes = Number(pos?.yes ?? 0), myNo = Number(pos?.no ?? 0)
  const claimableAmt = Number(claimable?.amount ?? 0)

  return (
    <Card accent={phase === 'open' ? C.dividerWarm : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE['3'], alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: TERRA_FONT, fontWeight: 700, fontSize: '1.05rem', color: C.textPrimary, lineHeight: 1.3 }}>{m.question}</div>
          <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginTop: 4 }}>
            #{m.id} · YES if the {fmtWindow(m.twap_window)} average ≥ {fmtPrice(m.threshold)} · spot now {fmtPrice(spot)}
          </div>
        </div>
        <div style={{ fontSize: TEXT.xs.size, color: status.color, fontWeight: 700, letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap' }}>{status.text}</div>
      </div>

      {/* the pools */}
      <div style={{ marginTop: SPACE['3'] }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.xs.size, marginBottom: 4 }}>
          <span style={{ color: C.success, fontWeight: 700 }}>YES {amt(m.yes_total)} {den}{yes != null && ` · ${Math.round(yes * 100)}%`}</span>
          <span style={{ color: C.korea, fontWeight: 700 }}>{yes != null && `${Math.round((1 - yes) * 100)}% · `}NO {amt(m.no_total)} {den}</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: 'rgba(224,72,90,0.35)', overflow: 'hidden' }}>
          <div style={{ width: `${(yes ?? 0.5) * 100}%`, height: '100%', background: yes == null ? 'transparent' : C.success, transition: 'width 0.6s ease' }} />
        </div>
        {yes == null && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Empty. First stake sets the odds.</div>}
      </div>

      {(myYes > 0 || myNo > 0) && (
        <div style={{ fontSize: TEXT.xs.size, color: C.goldLit, marginTop: SPACE['2'] }}>
          You: {myYes > 0 && `${amt(String(myYes))} ${den} on YES`}{myYes > 0 && myNo > 0 && ' · '}{myNo > 0 && `${amt(String(myNo))} ${den} on NO`}
        </div>
      )}

      {/* actions */}
      <div style={{ marginTop: SPACE['3'] }}>
        {phase === 'open' && (me ? (
          <>
            <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap' }}>
              <input style={{ ...field, flex: '1 1 120px' }} type='number' min='0' step='any' placeholder={`${amt(m.min_bet)}+ ${den}`} value={amount} onChange={e => setAmount(e.target.value)} />
              <button type='button' disabled={busy} style={{ ...ghostBtn, flex: '1 1 110px', color: C.success, borderColor: 'rgba(61,220,151,0.45)', fontSize: TEXT.sm.size }} onClick={() => place('yes')}>
                YES{(() => { const x = payoutMultiple(m, 'yes'); return x && Number.isFinite(x) ? ` · pays ${x.toFixed(2)}×` : '' })()}
              </button>
              <button type='button' disabled={busy} style={{ ...ghostBtn, flex: '1 1 110px', color: C.korea, borderColor: 'rgba(224,72,90,0.45)', fontSize: TEXT.sm.size }} onClick={() => place('no')}>
                NO{(() => { const x = payoutMultiple(m, 'no'); return x && Number.isFinite(x) ? ` · pays ${x.toFixed(2)}×` : '' })()}
              </button>
            </div>
            <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 6 }}>
              Balance {amt(balance)} {den} · payouts shown at today&apos;s pools, before the {feeBps / 100}% fee and {bountyBps / 100}% bounty taken from the losing side.
            </div>
          </>
        ) : <div className='terra-connect-cta'><WalletButton /></div>)}

        {phase === 'observe' && (me
          ? <button type='button' disabled={busy} style={primaryBtn} onClick={() => run(() => observe.mutateAsync({ sender: me, marketId: m.id }), 'Observed. Half the bounty is yours at settlement.')}>Observe the window · earns half the bounty</button>
          : <div className='terra-connect-cta'><WalletButton /></div>)}

        {phase === 'resolve' && (me
          ? <button type='button' disabled={busy} style={primaryBtn} onClick={() => run(() => settle.mutateAsync({ sender: me, marketId: m.id }), 'Settled by the chain.')}>{m.observation ? 'Settle · earns half the bounty' : 'Settle as void · refunds everyone'}</button>
          : <div className='terra-connect-cta'><WalletButton /></div>)}

        {voidable && me && (
          <button type='button' disabled={busy} style={{ ...ghostBtn, marginTop: SPACE['2'] }} onClick={() => run(() => voidTx.mutateAsync({ sender: me, marketId: m.id }), 'Voided. Stakes are refundable.')}>Void (a week unresolved)</button>
        )}

        {phase === 'resolved' && me && (claimableAmt > 0
          ? <button type='button' disabled={busy} style={primaryBtn} onClick={() => run(() => claim.mutateAsync({ sender: me, marketId: m.id }), 'Claimed.')}>Claim {amt(String(claimableAmt))} {den}</button>
          : claimable?.claimed
            ? <div style={{ fontSize: TEXT.xs.size, color: C.success }}>✓ Claimed</div>
            : (myYes > 0 || myNo > 0)
              ? <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Not this time.</div>
              : null)}

        {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: 8 }}>{err}</div>}
      </div>
    </Card>
  )
}

// ─── open a market ──────────────────────────────────────────────────────

const CLOSE_OPTIONS = [['1h', 3600], ['6h', 21_600], ['24h', 86_400], ['3d', 259_200], ['7d', 604_800]] as const
const WINDOW_OPTIONS = [['10 min', 600], ['1 hour', 3600], ['6 hours', 21_600], ['24 hours', 86_400]] as const

function CreatePanel({ me, spot, minWindow, onDone, onToast }: { me: string; spot?: number; minWindow: number; onDone: () => void; onToast: (s: string) => void }) {
  const [threshold, setThreshold] = useState(spot ? spot.toFixed(4) : '')
  const [closeIn, setCloseIn] = useState<number>(86_400)
  const [windowS, setWindowS] = useState<number>(3600)
  const [minBet, setMinBet] = useState('1')
  const [question, setQuestion] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const create = useCreateMarket()
  useEffect(() => { if (!threshold && spot) setThreshold(spot.toFixed(4)) }, [spot, threshold])
  const autoQuestion = threshold ? `1 LUNA ≥ ${threshold} USDC?` : ''
  const q = question.trim() || autoQuestion

  const go = async () => {
    setErr(null)
    const t = Number(threshold)
    if (!(t > 0)) return setErr('Threshold must be a positive price.')
    if (windowS < minWindow) return setErr(`Window must be at least ${fmtWindow(minWindow)}.`)
    const mb = toMicro(minBet || '1', 6)
    if (!mb || mb === '0') return setErr('Minimum stake must be positive.')
    if (!q) return setErr('Write the question.')
    const now = Math.floor(Date.now() / 1000)
    const closeAt = now + Math.max(closeIn, MIN_LEAD_SECONDS + 60)
    try {
      await create.mutateAsync({
        sender: me, question: q, pair: LUNA_USDC_PAIR, base: LUNA, quote: USDC, baseDecimals: 6, quoteDecimals: 6,
        threshold: threshold.trim(), denom: 'uluna', minBetMicro: mb, closeAt, resolveAt: closeAt + windowS, twapWindow: windowS,
      })
      onToast('Market open. It is on the chain now.')
      setQuestion(''); setTimeout(onDone, 2500)
    } catch (e) { setErr(humanizeTxError(e)) }
  }

  return (
    <Card>
      <div style={{ fontFamily: TERRA_FONT, fontWeight: 700, fontSize: TEXT.md.size, color: C.textPrimary, marginBottom: 4 }}>Open a market</div>
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
        Yes or no on the LUNA price in USDC, settled by the average price on Astroport&apos;s LUNA/USDC pool over the window after betting closes. Anyone can open one; it costs gas and nothing else.
      </p>
      <div style={{ display: 'grid', gap: SPACE['3'], gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div><label style={label}>YES if 1 LUNA ≥ (USDC)</label><input style={field} type='number' min='0' step='any' value={threshold} onChange={e => setThreshold(e.target.value)} placeholder={spot ? spot.toFixed(4) : '0.05'} /></div>
        <div><label style={label}>Betting closes in</label>
          <select style={select} value={closeIn} onChange={e => setCloseIn(Number(e.target.value))}>{CLOSE_OPTIONS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select></div>
        <div><label style={label}>Averaging window</label>
          <select style={select} value={windowS} onChange={e => setWindowS(Number(e.target.value))}>{WINDOW_OPTIONS.filter(([, s]) => s >= minWindow).map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select></div>
        <div><label style={label}>Minimum stake (LUNA)</label><input style={field} type='number' min='0' step='any' value={minBet} onChange={e => setMinBet(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: SPACE['3'] }}>
        <label style={label}>Question</label>
        <input style={field} value={question} onChange={e => setQuestion(e.target.value)} placeholder={autoQuestion || 'Write it the way a friend would ask it'} maxLength={200} />
      </div>
      <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 8, lineHeight: 1.6 }}>
        Settles {fmtWindow(windowS)} after betting closes. Spot now {fmtPrice(spot)}.
      </div>
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: SPACE['3'] }}>
        {me
          ? <button type='button' style={{ ...primaryBtn, opacity: create.isLoading ? 0.6 : 1 }} disabled={create.isLoading} onClick={go}>{create.isLoading ? 'Opening…' : 'Open market'}</button>
          : <div className='terra-connect-cta'><WalletButton /></div>}
      </div>
    </Card>
  )
}

// ─── page ───────────────────────────────────────────────────────────────

type Tab = 'live' | 'settled' | 'create'
const PHASE_RANK: Record<Phase, number> = { open: 0, observe: 1, resolve: 2, averaging: 3, waiting: 4, missed: 5, resolved: 6 }

function PredictPageInner() {
  const me = useMyAddress()
  const [data, setData] = useState<PredictResponse | null>(null)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [tab, setTab] = useState<Tab>('live')
  const [mine, setMine] = useState<Record<number, { pos: Position; claimable: Claimable }>>({})
  const [balance, setBalance] = useState('0')
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/predict', { cache: 'no-store' })
      if (r.ok) setData(await r.json())
    } catch { /* keep the last frame */ }
  }, [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 15_000); return () => clearInterval(t) }, [refresh])
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!me || !data?.live) { setMine({}); return }
    let alive = true
    ;(async () => {
      const rows = await Promise.all(data.markets.map(async m => {
        const [pos, claimable] = await Promise.all([queryPosition(m.id, me), queryClaimable(m.id, me)])
        return [m.id, pos, claimable] as const
      }))
      if (!alive) return
      const next: typeof mine = {}
      for (const [id, pos, cl] of rows) if (pos && cl) next[id] = { pos, claimable: cl }
      setMine(next)
      setBalance(await queryNativeBalance(me, 'uluna'))
    })()
    return () => { alive = false }
  }, [me, data])

  const showToast = (s: string) => { setToast(s); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 4000) }

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.markets].sort((a, b) => {
      const pa = PHASE_RANK[phaseOf(a, now)], pb = PHASE_RANK[phaseOf(b, now)]
      if (pa !== pb) return pa - pb
      return a.resolution && b.resolution ? secs(b.resolution.resolved_at) - secs(a.resolution.resolved_at) : secs(a.resolve_at) - secs(b.resolve_at)
    })
  }, [data, now])
  const live = sorted.filter(m => !m.resolution)
  const settled = sorted.filter(m => !!m.resolution)
  const spotLuna = data?.spot[LUNA_USDC_PAIR]
  const feeBps = data?.config?.fee_bps ?? 0, bountyBps = data?.config?.bounty_bps ?? 0

  const tabBtn = (t: Tab, txt: string) => (
    <button type='button' onClick={() => setTab(t)} style={{ ...ghostBtn, padding: '0.45rem 0.9rem', color: tab === t ? C.goldLit : C.textMuted, borderColor: tab === t ? C.goldCore : C.divider, background: tab === t ? C.goldSoft : 'transparent' }}>{txt}</button>
  )

  return (
    <>
      <Head>
        <title>Terra Predict</title>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap' />
      </Head>
      <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 1, background: `radial-gradient(circle at 50% -20%, #1a1d30 0%, #0a0d18 45%, ${C.void} 100%)` }} />
      {toast && <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 50, padding: '10px 16px', background: '#f4f1e8', color: '#1a1405', borderRadius: 999, fontFamily: TERRA_FONT, fontWeight: 600, fontSize: TEXT.sm.size, boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>{toast}</div>}
      <main style={{ minHeight: '100vh', position: 'relative', zIndex: 2, paddingBottom: '4rem', fontFamily: TERRA_FONT, color: C.textPrimary }}>
        <article className='predict-article' style={{ maxWidth: 680, margin: '0 auto', padding: '1.4rem 1.2rem 2rem' }}>
          <div className='predict-hero' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE['3'], flexWrap: 'wrap', marginBottom: SPACE['3'] }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.62rem', letterSpacing: '0.34em', color: C.korea, fontWeight: 800, textTransform: 'uppercase', marginBottom: SPACE['2'] }}>Experimental</div>
              <h1 style={{ fontFamily: TERRA_FONT, fontSize: 'clamp(1.6rem, 6vw, 2.6rem)', lineHeight: 1.02, margin: 0, letterSpacing: '-0.02em', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.28em', whiteSpace: 'nowrap' }}>
                <img src='/img/terra-globe.svg' alt='' aria-hidden width={52} height={49} draggable={false} style={{ width: '0.82em', height: 'auto', flex: 'none', filter: 'drop-shadow(0 2px 10px rgba(52,88,184,0.45))' }} />
                <span className='predict-title'><span style={{ fontWeight: 700 }}>Terra</span> <span style={{ fontWeight: 300 }}>Predict</span></span>
              </h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flex: 'none' }}>
              <Link href='/' style={{ ...ghostBtn, textDecoration: 'none', whiteSpace: 'nowrap' }}>← Swap</Link>
              <WalletButton />
            </div>
          </div>

          {!data && <Empty title='Loading…' body='Reading the chain.' />}
          {data && !data.live && <Empty title='Not live yet' body='The contract is not deployed. Check back shortly.' />}
          {data?.live && (
            <>
              <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['3'], flexWrap: 'wrap' }}>
                {tabBtn('live', `Live · ${live.length}`)}{tabBtn('settled', `Settled · ${settled.length}`)}{tabBtn('create', 'Open a market')}
                <span style={{ marginLeft: 'auto', fontSize: TEXT.xs.size, color: C.textMuted, alignSelf: 'center', whiteSpace: 'nowrap' }}>LUNA {fmtPrice(spotLuna)} USDC</span>
              </div>
              {tab === 'create' && <CreatePanel me={me} spot={spotLuna} minWindow={data.config?.min_window ?? 600} onDone={refresh} onToast={showToast} />}
              {tab !== 'create' && (
                (tab === 'live' ? live : settled).length === 0
                  ? <Empty title={tab === 'live' ? 'No open markets' : 'Nothing settled yet'} body={tab === 'live' ? 'Open the first one. A question, a price, a deadline. The chain does the rest.' : 'Settled markets show up here with the price they settled at.'} />
                  : <div style={{ display: 'grid', gap: SPACE['3'] }}>
                      {(tab === 'live' ? live : settled).map(m => (
                        <MarketCard key={m.id} m={m} now={now} spot={data.spot[m.pair]} twapNow={data.twap[m.id]?.twap ?? null} me={me}
                          pos={mine[m.id]?.pos} claimable={mine[m.id]?.claimable} feeBps={feeBps} bountyBps={bountyBps} balance={balance} onDone={refresh} onToast={showToast} />
                      ))}
                    </div>
              )}
              <div style={{ marginTop: SPACE['4'], fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.7, borderTop: `1px solid ${C.divider}`, paddingTop: SPACE['3'] }}>
                Parimutuel: winners split the losing pool. The {feeBps / 100}% fee and the {bountyBps / 100}% bounty come from the losing side only.
                The price is the time-weighted average from Astroport&apos;s pool over the window, read by whoever shows up: half the bounty for the first to observe the window, half for whoever settles.
                No observer, no fee, no loser: the market is void and every stake is refundable. There is no admin and no way to change any of this.
              </div>
            </>
          )}
        </article>
      </main>
      <style jsx global>{`
        .terra-connect-cta > * { width: 100%; }
        /* Same gold as the swap wordmark. */
        .predict-title {
          background: linear-gradient(180deg, #fff8dc 0%, #ffd83d 55%, #caa022 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
        }
        @media (max-width: 640px) {
          .predict-article { padding-top: 0.7rem !important; }
          .predict-hero h1 { font-size: 1.4rem !important; }
          .predict-card { padding: 0.8rem 0.85rem !important; }
        }
      `}</style>
    </>
  )
}

export default function PredictPage() {
  return <PredictPageInner />
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const base = `https://${ctx.req.headers.host ?? 'localhost:3000'}`
  return ({
  props: {
    og: {
      title: 'Terra Predict',
      image: `${base}/api/og/swap`,
      contract: '', token: '',
      description: 'Yes or no on the LUNA price, settled by the chain itself. Parimutuel, no oracle, no admin. Experimental.',
      url: `${base}/predict`,
      type: 'website',
      icon: '/img/terra-globe.svg',
      touchIcon: '/img/terra-globe-180.png',
    },
  },
})
}
