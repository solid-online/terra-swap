/**
 * /embed: a swap quote any site can frame (see /developers). It prices a pair
 * through the best route over Terra Swap's and Astroport's pools with
 * /api/quote, and its button opens the swap on Terra Swap in a new tab, where
 * the person signs in their own wallet. The frame itself holds no wallet,
 * signs nothing, stores nothing and takes no fee. Rendered without the wallet
 * stack (App.bare), so it loads fast inside someone else's page.
 */

import Head from 'next/head'
import { useEffect, useState } from 'react'
import { KNOWN_TOKENS } from 'lib/dex'
import { TokenIcon } from 'components/TokenIcon'
import type { QuoteResponse } from 'lib/api/quote'
import { MONTSERRAT } from 'lib/font'

const FONT = `${MONTSERRAT}, 'Inter', system-ui, sans-serif`
const C = {
  void: '#05070f', surface: '#0b0f1c', elev: '#111729', divider: 'rgba(255,216,61,0.16)', gold: '#ffd83d', goldCore: '#caa022',
  text: '#f4f1e8', muted: '#9a927f', whisper: '#6b6555', alert: '#e04a5a',
} as const
/** The tokens with markets worth quoting; the old cw20 ASTRO and the thinnest listings stay out of a stranger's widget. */
const TOKENS = KNOWN_TOKENS.filter(t => !['ASTRO.cw20', 'VKR', 'USDT.axl'].includes(t.key))
const enc = encodeURIComponent

const field: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '10px 12px', background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.divider}`, borderRadius: 10,
  color: C.text, fontSize: 18, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box',
}
const select: React.CSSProperties = { ...field, flex: 'none', width: 140, fontSize: 15, cursor: 'pointer' }

function Embed() {
  const [from, setFrom] = useState('LUNA')
  const [to, setTo] = useState('USDC')
  const [amount, setAmount] = useState('100')
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [origin, setOrigin] = useState('https://swap.openfields.app')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const known = (v: string | null) => (v ? TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase())?.key : undefined)
    const f = known(p.get('from')), t = known(p.get('to')), a = p.get('amount')
    if (f) setFrom(f)
    if (t && t !== f) setTo(t)
    if (a && /^\d{1,12}(\.\d{1,8})?$/.test(a)) setAmount(a)
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    setErr(null)
    if (!/^\d{1,12}(\.\d{1,8})?$/.test(amount.trim()) || !(Number(amount) > 0) || from === to) { setQuote(null); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/quote?from=${enc(from)}&to=${enc(to)}&amount=${enc(amount.trim())}`)
        .then(async r => {
          const j = await r.json().catch(() => null)
          if (!alive) return
          if (r.ok && j) { setQuote(j as QuoteResponse); setErr(null) } else { setQuote(null); setErr((j as { error?: string } | null)?.error ?? 'Could not price that right now.') }
        })
        .catch(() => { if (alive) { setQuote(null); setErr('Could not price that right now.') } })
        .finally(() => { if (alive) setLoading(false) })
    }, 450)
    return () => { alive = false; clearTimeout(t) }
  }, [from, to, amount])

  const swapUrl = `${origin}/?from=${enc(from)}&to=${enc(to)}${amount.trim() ? `&amount=${enc(amount.trim())}` : ''}`
  const pools = quote ? quote.parts.reduce((n, p) => n + p.hops.length, 0) : 0
  const tokenSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} style={select}>
      {TOKENS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select>
  )

  return (
    <>
      <Head>
        <title>Terra Swap quote</title>
        <meta name='robots' content='noindex' />
      </Head>
      <div style={{ minHeight: '100vh', background: C.void, color: C.text, fontFamily: FONT, padding: 8, boxSizing: 'border-box', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div style={{ width: '100%', maxWidth: 440, background: C.elev, border: `1px solid ${C.divider}`, borderRadius: 16, padding: 14, boxSizing: 'border-box', display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src='/img/terra-globe.svg' alt='' width={22} height={21} />
            <span style={{ fontSize: 16 }}><b style={{ color: C.gold }}>Terra</b> <span style={{ fontWeight: 300 }}>Swap</span></span>
            <span style={{ marginLeft: 'auto', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.whisper }}>quote</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input aria-label='Amount' inputMode='decimal' value={amount} onChange={e => setAmount(e.target.value.replace(',', '.'))} style={field} />
            {tokenSelect(from, v => { if (v === to) setTo(from); setFrom(v) }, 'Pay with')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-4px 0' }}>
            <button type='button' aria-label='Flip' onClick={() => { setFrom(to); setTo(from) }}
              style={{ width: 30, height: 30, borderRadius: 999, background: C.surface, border: `1px solid ${C.divider}`, color: C.gold, cursor: 'pointer', fontSize: 15 }}>⇅</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ ...field, display: 'flex', alignItems: 'center', gap: 8, color: quote ? C.text : C.muted }}>
              <TokenIcon label={to} size={18} />
              {loading && !quote ? '…' : quote ? Number(quote.expectedOut).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}
            </div>
            {tokenSelect(to, v => { if (v === from) setFrom(to); setTo(v) }, 'Receive')}
          </div>

          <div style={{ fontSize: 12, lineHeight: 1.5, color: err ? C.alert : C.muted, minHeight: 36 }}>
            {err ?? (quote
              ? <>Through {pools} pool{pools === 1 ? '' : 's'}{quote.parts.length > 1 ? ', split over two paths' : ''} · price impact {quote.impactPct.toFixed(2)}% · at least {Number(quote.minimumOut).toLocaleString('en-US', { maximumFractionDigits: 6 })} {to} at {quote.slippagePct}% slippage</>
              : 'Enter an amount to see the best route right now.')}
          </div>

          <a href={swapUrl} target='_blank' rel='noopener noreferrer'
            style={{ display: 'block', textAlign: 'center', padding: '12px 14px', borderRadius: 12, background: C.gold, color: C.void, fontWeight: 700, textDecoration: 'none', fontSize: 15 }}>
            Swap on Terra Swap ↗
          </a>
          <div style={{ fontSize: 10.5, lineHeight: 1.5, color: C.whisper, textAlign: 'center' }}>
            No interface fee · routes over Terra Swap&apos;s and Astroport&apos;s pools · a quote, not an offer: prices move with every trade
          </div>
        </div>
      </div>
    </>
  )
}

/** Rendered without the wallet stack: see pages/_app. */
Embed.bare = true

export default Embed
