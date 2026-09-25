/**
 * /tx/[hash]: a receipt for one transaction on Terra, read from the chain.
 * What left and what arrived, and for a swap signed on Terra Swap what it was
 * quoted, how that compares with what arrived and with the best path through
 * up to two pools, the least it allowed, and the pools it went through. The
 * link can be shared: its card (/api/og/tx) reads the same transaction, so
 * nothing a link carries is shown as fact.
 */

import Link from 'next/link'
import { withCpuSsr } from 'lib/cpuLog'
import type { GetServerSideProps } from 'next'
import { useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import { C, Page, Panel, linkBtn, row } from 'components/PageShell'
import { TokenIcon } from 'components/TokenIcon'
import { KNOWN_TOKENS, fromMicro, tokenFor, type KnownToken } from 'lib/dex'
import { fmtAmount } from 'lib/arb'
import { TX_HASH, readReceipt, type Receipt } from 'lib/txReceipt'

const KIND: Record<string, string> = {
  swap: 'Swap', zap: 'Zap', 'add liquidity': 'Added liquidity', 'remove liquidity': 'Removed liquidity', stake: 'Staked LP', unstake: 'Unstaked LP',
  claim: 'Claimed rewards', 'transfer out': 'Sent over IBC', 'transfer in': 'Arrived over IBC', 'arrived swapped': 'Arrived swapped',
  'create pool': 'Opened a pool', 'liquid staking': 'Liquid staking', other: 'Transaction',
}

const tokenOf = (id: string): KnownToken => tokenFor(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } })
const amountOf = (m: { id: string; amount: string }) => { const t = tokenOf(m.id); return { t, n: Number(m.amount) / 10 ** t.decimals } }
const show = (m: { id: string; amount: string }) => { const { t, n } = amountOf(m); return `${fmtAmount(n)} ${t.label}` }

function titleFor(r: Receipt): string {
  if (!r.ok) return 'A failed transaction on Terra'
  if (r.kind === 'swap' && r.out.length === 1 && r.in.length >= 1) return `Swapped ${show(r.out[0])} for ${show(r.in[0])} on Terra`
  if (r.kind === 'arrived swapped' && r.in.length) return `${show(r.in[0])} arrived on Terra, swapped on arrival`
  if (r.kind === 'transfer in' && r.in.length) return `${show(r.in[0])} arrived on Terra${r.chain ? ` from ${r.chain}` : ''}`
  if (r.kind === 'transfer out' && r.out.length) return `${show(r.out[0])} sent from Terra${r.chain ? ` to ${r.chain}` : ''}`
  return `${KIND[r.kind] ?? 'Transaction'} on Terra`
}

/** What arrived against what a swap signed here was quoted, in %. */
function vsQuote(r: Receipt): number | null {
  const q = r.quote
  if (!q || !(q.amount > 0)) return null
  const got = r.in.find(m => tokenOf(m.id).label === q.label)
  return got ? (amountOf(got).n / q.amount - 1) * 100 : null
}

const serverSideProps: GetServerSideProps = async ctx => {
  const raw = String(ctx.params?.hash ?? '')
  if (!TX_HASH.test(raw)) return { notFound: true }
  const hash = raw.toUpperCase()
  if (raw !== hash) return { redirect: { destination: `/tx/${hash}`, permanent: true } }
  const receipt = await readReceipt(hash)
  const base = `https://${ctx.req.headers.host ?? 'swap.openfields.app'}`
  // A transaction never changes once it is in a block, so a found receipt can be kept at the edge.
  if (receipt) ctx.res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  const vs = receipt ? vsQuote(receipt) : null
  const facts = receipt?.quote
    ? [
        `Quoted ${fmtAmount(receipt.quote.amount)} ${receipt.quote.label}`,
        vs != null ? `arrived ${vs >= 0 ? '+' : ''}${vs.toFixed(2)}% against the quote` : '',
        receipt.quote.gainPct != null && receipt.quote.gainPct >= 0.005 ? `routing added ${receipt.quote.gainPct.toFixed(2)}% over two pools` : '',
      ].filter(Boolean).join(', ') + '. '
    : ''
  return {
    props: {
      hash,
      receipt,
      og: {
        title: receipt ? titleFor(receipt) : 'A transaction on Terra',
        description: receipt ? `${facts}Block ${receipt.height.toLocaleString('en-US')}, read from the chain.` : 'A transaction on Terra, read from the chain.',
        image: `${base}/api/og/tx?hash=${hash}`,
        url: `${base}/tx/${hash}`,
        type: 'article',
      },
    },
  }
}

export default function TxPage({ hash, receipt }: { hash: string; receipt: Receipt | null }) {
  const [copied, setCopied] = useState(false)
  const terrascope = `https://scan.openfields.app/tx/${hash}`
  const share = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  if (!receipt) {
    return (
      <Page width={760}>
        <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)', margin: 0 }}><span style={{ fontWeight: 700, color: C.goldLit }}>A transaction</span> <span style={{ fontWeight: 300 }}>on Terra</span></h1>
        <Panel title='Not found yet'>
          <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: 0 }}>
            The chain&apos;s public endpoints did not return this transaction. One that just landed can take a few seconds to be indexed; refresh in a moment.{' '}
            <a href={terrascope} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>Look it up on Terra Scan ↗</a>
          </p>
        </Panel>
      </Page>
    )
  }

  const r = receipt
  const vs = vsQuote(r)
  const pairLink = (() => {
    if (r.kind !== 'swap' || r.out.length !== 1 || r.in.length < 1) return null
    const a = tokenOf(r.out[0].id), b = tokenOf(r.in[0].id)
    return KNOWN_TOKENS.some(k => k.key === a.key) && KNOWN_TOKENS.some(k => k.key === b.key) ? `/?from=${encodeURIComponent(a.key)}&to=${encodeURIComponent(b.key)}` : null
  })()
  const moved = (list: { id: string; amount: string }[]) => (
    <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', color: C.textSecondary }}>
      {list.map((m, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><TokenIcon label={tokenOf(m.id).label} size={16} />{show(m)}</span>)}
    </span>
  )
  const when = new Date(r.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  const ourMemo = /^Terra (Swap|Pools):/.test(r.memo)

  return (
    <Page width={760}>
      <header style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: TEXT.xs.size, letterSpacing: '0.08em', textTransform: 'uppercase', color: r.ok ? C.success : C.alert }}>
          {r.ok ? '✓ Landed' : '✗ Failed on chain'} <span style={{ color: C.textWhisper }}>· block #{r.height.toLocaleString('en-US')} · {when} UTC</span>
        </div>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4.6vw, 2.1rem)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{titleFor(r)}</h1>
      </header>

      <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap' }}>
        {pairLink && <Link href={pairLink} style={linkBtn(true)}>Swap the same pair</Link>}
        <button type='button' onClick={share} style={{ ...linkBtn(), cursor: 'pointer' }}>{copied ? 'Link copied ✓' : 'Copy link'}</button>
        <a href={terrascope} target='_blank' rel='noreferrer' style={linkBtn()}>Terra Scan ↗</a>
      </div>

      <Panel title='What moved' note={r.ok ? "Read from the chain's own transfer events: what left the wallet and what arrived, with the network fee on its own." : 'It failed, so nothing moved but the network fee.'}>
        {r.out.length > 0 && <div style={row}><span>Left</span>{moved(r.out)}</div>}
        {r.in.length > 0 && <div style={row}><span>Arrived</span>{moved(r.in)}</div>}
        <div style={row}><span>Network fee</span><span style={{ color: C.textSecondary }}>{r.feeUluna !== '0' ? `${fromMicro(r.feeUluna, 6, 4)} LUNA` : 'paid by the relayer'}</span></div>
        {r.account && <div style={row}><span>Wallet</span><a href={`https://scan.openfields.app/address/${r.account}`} target='_blank' rel='noreferrer' style={{ color: C.textSecondary }}>{r.account.slice(0, 10)}…{r.account.slice(-6)} ↗</a></div>}
      </Panel>

      {r.quote && (
        <Panel title='Against the quote' note="A swap signed on Terra Swap writes its quote into the transaction's memo, so what it was quoted can be set beside what the chain delivered.">
          <div style={row}><span>Quoted</span><span style={{ color: C.textSecondary }}>{fmtAmount(r.quote.amount)} {r.quote.label}</span></div>
          {vs != null && <div style={row}><span>Arrived against the quote</span><span style={{ color: vs >= -0.05 ? C.success : C.ember }}>{vs >= 0 ? '+' : ''}{vs.toFixed(2)}%</span></div>}
          {r.quote.gainPct != null && <div style={row}><span>Routing added</span><span style={{ color: r.quote.gainPct >= 0.005 ? C.success : C.textSecondary }}>{r.quote.gainPct >= 0 ? '+' : ''}{r.quote.gainPct.toFixed(2)}% over the best path through up to two pools</span></div>}
          {r.minimum && <div style={row}><span>Least it allowed</span><span style={{ color: C.textSecondary }}>{show(r.minimum)}</span></div>}
        </Panel>
      )}

      {r.hops.length > 0 && (
        <Panel title='Route' note='Each swap in the order the pools executed it, with what the pool took in and paid out.'>
          {r.hops.map((h, i) => (
            <div key={i} style={row}>
              <span style={{ color: C.textSecondary }}>{show(h.offer)} → {show(h.ask)}</span>
              {h.pool && <Link href={`/pool/${h.pool}`} style={{ color: C.goldLit }}>{tokenOf(h.offer.id).label} / {tokenOf(h.ask.id).label} pool ↗</Link>}
            </div>
          ))}
        </Panel>
      )}

      {ourMemo && (
        <Panel title='Memo'>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: TEXT.xs.size, color: C.textSecondary, wordBreak: 'break-word' }}>{r.memo}</div>
        </Panel>
      )}
    </Page>
  )
}

export const getServerSideProps = withCpuSsr('page:/tx', serverSideProps)
