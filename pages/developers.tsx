/**
 * /developers: how to put a Terra Swap quote on another site, and the quote
 * API behind it. Both read public chain data and sign nothing; a swap always
 * happens on Terra Swap itself, in the wallet of whoever signs it.
 */

import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { SPACE, TEXT } from 'components/tokens'
import { C, Page, Panel, row } from 'components/PageShell'
import { KNOWN_TOKENS } from 'lib/dex'

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const REPO = 'https://github.com/solid-online/terra-swap'

function Code({ children }: { children: string }) {
  return (
    <pre style={{ margin: '8px 0 0', padding: '10px 12px', background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.divider}`, borderRadius: 10, overflowX: 'auto', fontFamily: mono, fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.55 }}>
      <code>{children}</code>
    </pre>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const base = `https://${ctx.req.headers.host ?? 'swap.terraluna.app'}`
  return {
    props: {
      base,
      og: {
        title: 'Build with Terra Swap: embed a quote, or call the quote API',
        description: 'A swap quote any site can frame, and an open API for the best route over Terra Swap\'s and Astroport\'s pools. No key, no fee.',
        image: `${base}/api/og/swap`, url: `${base}/developers`, type: 'website', icon: '/img/terra-globe.svg', touchIcon: '/img/terra-globe-180.png',
      },
    },
  }
}

export default function Developers({ base }: { base: string }) {
  const embedSnippet = `<iframe src="${base}/embed?from=LUNA&to=USDC&amount=100"
  width="420" height="340" style="border:0;border-radius:16px"
  title="Terra Swap quote" loading="lazy"></iframe>`
  const curl = `curl "${base}/api/quote?from=LUNA&to=USDC&amount=100"`
  const sample = `{
  "from": "LUNA",
  "to": "USDC",
  "amount": "100",
  "expectedOut": "4.553",          // what arrives if every pool trades at its quote
  "minimumOut": "4.507",           // the least a swap signed at slippagePct allows
  "slippagePct": 1,
  "impactPct": 0.02,
  "path": "LUNA → USDC (Astroport)",
  "parts": [{ "sharePct": 100, "hops": [{ "pool": "terra1…", "venue": "astroport", "offer": "LUNA", "ask": "USDC", "returns": "4.553" }] }],
  "swapUrl": "${base}/?from=LUNA&to=USDC&amount=100",
  "at": 1789999999999
}`

  return (
    <Page width={820}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.4rem)', margin: 0, letterSpacing: '-0.02em' }}>
          <span style={{ fontWeight: 700, color: C.goldLit }}>Build</span> <span style={{ fontWeight: 300 }}>with Terra Swap</span>
        </h1>
        <p style={{ fontSize: TEXT.sm.size, color: C.textSecondary, lineHeight: 1.65, margin: 0 }}>
          Put a live swap quote on your own site, or ask for the best route yourself. Both use the routing the swap page signs: every pool on Terra Swap&apos;s and Astroport&apos;s factories, paths through up to three pools, and a split over two paths when that delivers more. No key, no sign-up, no fee.
        </p>
      </header>

      <Panel title='Embed a quote' note='A small card that prices a pair as people type. Its button opens the swap on Terra Swap in a new tab, where they sign in their own wallet. The card holds no wallet and signs nothing.'>
        <Code>{embedSnippet}</Code>
        <div style={{ ...row, marginTop: SPACE['2'] }}><span>Parameters</span><span style={{ color: C.textSecondary }}>from, to (tickers below) and amount, all optional</span></div>
        <div style={{ marginTop: SPACE['3'], display: 'flex', justifyContent: 'center' }}>
          <iframe src='/embed?from=LUNA&to=USDC&amount=100' title='Terra Swap quote' loading='lazy' style={{ width: '100%', maxWidth: 420, height: 340, border: 0, borderRadius: 16 }} />
        </div>
      </Panel>

      <Panel title='Quote API' note='GET, open to any origin. Amounts are in whole tokens, the way people write them.'>
        <Code>{curl}</Code>
        <div style={{ marginTop: SPACE['2'] }}>
          <div style={row}><span>from, to</span><span style={{ color: C.textSecondary }}>a ticker or the token&apos;s denom or contract</span></div>
          <div style={row}><span>amount</span><span style={{ color: C.textSecondary }}>a positive number of whole tokens</span></div>
          <div style={row}><span>400 · 404 · 429 · 503</span><span style={{ color: C.textSecondary }}>bad input · no route right now · busy · the chain did not answer</span></div>
        </div>
        <Code>{sample}</Code>
      </Panel>

      <Panel title='Tokens'>
        <p style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.8, margin: 0, fontFamily: mono }}>{KNOWN_TOKENS.map(t => t.key).join(' · ')}</p>
        <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '8px 0 0' }}>
          Each has its own page, for example <Link href='/token/LUNA' style={{ color: C.goldLit }}>/token/LUNA</Link>.
        </p>
      </Panel>

      <Panel title='What it is, and what it is not'>
        <ul style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>A quote is what the pools would deliver at the moment it is read. It is not an offer and not advice, and it moves with every trade.</li>
          <li>Nothing is signed, held or charged here. A swap opens Terra Swap, where the person signs it in their own wallet, and where the site&apos;s regional restrictions apply as they do anywhere else on it.</li>
          <li>USDC from Noble and USDC.inj are separate tokens and are never quoted against each other.</li>
          <li>Please cache on your side: quotes are kept about 20 seconds here, and each server answers about 120 fresh quotes a minute.</li>
          <li>The code is open source under MIT. <a href={REPO} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>Run your own copy</a>; the pools and the router on chain have no owner and no admin.</li>
        </ul>
      </Panel>
    </Page>
  )
}
