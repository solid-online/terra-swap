/**
 * /developers: how to put a Terra Swap quote on another site, and the open
 * APIs behind the site: quotes either way, how much trades before a price
 * moves, the site's own price record, who controls a token, and market data in
 * the shapes listing sites read. All of it reads public chain data and signs
 * nothing; a swap always happens on Terra Swap itself, in the wallet of whoever
 * signs it.
 */

import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { SPACE, TEXT } from 'components/tokens'
import { C, Page, Panel, row } from 'components/PageShell'
import { KNOWN_TOKENS } from 'lib/dex'
import { withCpuSsr } from 'lib/cpuLog'

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const REPO = 'https://github.com/solid-online/terra-swap'

function Code({ children }: { children: string }) {
  return (
    <pre style={{ margin: '8px 0 0', padding: '10px 12px', background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.divider}`, borderRadius: 10, overflowX: 'auto', fontFamily: mono, fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.55 }}>
      <code>{children}</code>
    </pre>
  )
}

function Param({ k, v }: { k: string; v: React.ReactNode }) {
  return <div style={row}><span style={{ fontFamily: mono }}>{k}</span><span style={{ color: C.textSecondary, textAlign: 'right', maxWidth: '70%' }}>{v}</span></div>
}

export const getServerSideProps: GetServerSideProps = withCpuSsr('page:developers', async ctx => {
  const base = `https://${ctx.req.headers.host ?? 'swap.openfields.app'}`
  return {
    props: {
      base,
      og: {
        title: 'Build with Terra Swap: embed a quote, or call the open APIs',
        description: "A swap quote any site can frame, and open APIs for the best route over Terra Swap's and Astroport's pools, price history, size before the price moves, token control and market data. No key, no fee.",
        image: `${base}/api/og/swap`, url: `${base}/developers`, type: 'website',
      },
    },
  }
})

export default function Developers({ base }: { base: string }) {
  const embedSnippet = `<iframe src="${base}/embed?from=LUNA&to=USDC&amount=100"
  width="420" height="340" style="border:0;border-radius:16px"
  title="Terra Swap quote" loading="lazy"></iframe>`
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
          Put a live swap quote on your own site, or ask for what you need yourself. Quotes use the routing the swap page signs: every pool on Terra Swap&apos;s and Astroport&apos;s factories, paths through up to three pools, and a split over two paths when that delivers more. No key, no sign-up, no fee, open to any origin.
        </p>
      </header>

      <Panel title='Embed a quote' note='A small card that prices a pair as people type. Its button opens the swap on Terra Swap in a new tab, where they sign in their own wallet. The card holds no wallet and signs nothing.'>
        <Code>{embedSnippet}</Code>
        <div style={{ ...row, marginTop: SPACE['2'] }}><span>Parameters</span><span style={{ color: C.textSecondary }}>from, to (tickers below) and amount, all optional</span></div>
        <div style={{ marginTop: SPACE['3'], display: 'flex', justifyContent: 'center' }}>
          <iframe src='/embed?from=LUNA&to=USDC&amount=100' title='Terra Swap quote' loading='lazy' style={{ width: '100%', maxWidth: 420, height: 340, border: 0, borderRadius: 16 }} />
        </div>
      </Panel>

      <Panel title='Quote' note='What a swap would deliver right now, or what to pay for an amount to arrive. Amounts are in whole tokens, the way people write them.'>
        <Code>{`curl "${base}/api/quote?from=LUNA&to=USDC&amount=100"
curl "${base}/api/quote?from=LUNA&to=USDC&receive=5"`}</Code>
        <div style={{ marginTop: SPACE['2'] }}>
          <Param k='from, to' v="a ticker or the token's denom or contract" />
          <Param k='amount' v='what to pay, a positive number of whole tokens' />
          <Param k='receive' v='instead of amount: what should arrive. The answer says what to pay so that at least this arrives at 1% slippage, and carries exactOut: true' />
          <Param k='400 · 404 · 429 · 503' v='bad input · no route right now · busy · the chain did not answer' />
        </div>
        <Code>{sample}</Code>
      </Panel>

      <Panel title='Size before the price moves' note='Price impact at a ladder of sizes from $50 to $250,000, and the sizes where it crosses 0.5%, 1% and 2%. Kept five minutes per pair.'>
        <Code>{`curl "${base}/api/depth?from=LUNA&to=USDC"
curl "${base}/api/depth?pool=terra1…"`}</Code>
        <div style={{ marginTop: SPACE['2'] }}>
          <Param k='from, to' v='through the best route, the way the swap signs it' />
          <Param k='pool' v='one pool, selling each of its tokens into it (sell0, sell1)' />
          <Param k='points[]' v='{ usd, impactPct }, sizes in dollars of the token paid' />
          <Param k='marks[]' v='{ pct, usd }: usd is null when the ladder ended first; below is true when it crossed under $50' />
        </div>
      </Panel>

      <Panel title='Price history' note="The site's own record: every listed token's market reference each ten minutes, and every pool with liquidity each hour, from the day recording began. Nothing before that is filled in.">
        <Code>{`curl "${base}/api/price-history?token=LUNA&range=7d"
curl "${base}/api/price-history?pool=terra1…&base=LUNA&quote=USDC&range=30d"`}</Code>
        <div style={{ marginTop: SPACE['2'] }}>
          <Param k='range' v='1d, 7d, 30d or 90d' />
          <Param k='points' v='[unix ms, value], oldest first: dollars for a token, quote per base for a pool' />
          <Param k='market' v="for a pool: the same pair from the two tokens' reference prices" />
          <Param k='since' v='the first day anything was written down' />
        </div>
      </Panel>

      <Panel title='Who controls a token' note="Whether more can be minted and by whom, whether its contract can be replaced, the supply on Terra, what is locked on the chain an IBC token comes from, and a cw20's largest holders. Kept six hours per token.">
        <Code>{`curl "${base}/api/token-check?token=ampLUNA"`}</Code>
      </Panel>

      <Panel title='Market data for listing sites' note="Terra Swap's own pools only, in the shapes CoinGecko's and CoinMarketCap's integration specs ask for. Pools are constant-product, so the order book is the curve itself. Swaps routed through Astroport's pools are Astroport's markets and are not counted here.">
        <Code>{`${base}/api/coingecko/pairs
${base}/api/coingecko/tickers
${base}/api/coingecko/orderbook?ticker_id=<base>_<target>&depth=100
${base}/api/coingecko/historical_trades?ticker_id=<base>_<target>&type=buy

${base}/api/cmc/summary
${base}/api/cmc/assets
${base}/api/cmc/ticker
${base}/api/cmc/orderbook/<base>_<quote>
${base}/api/cmc/trades/<base>_<quote>

${base}/api/volume?date=2026-09-20`}</Code>
        <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '8px 0 0' }}>
          Base and target are denoms and contract addresses. Volume values each swap at its day&apos;s average recorded price. DefiLlama adapters for the pools&apos; liquidity and volume are in the repository under <a href={`${REPO}/tree/main/integrations/defillama`} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>integrations/defillama</a>.
        </p>
      </Panel>

      <Panel title='Tokens'>
        <p style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.8, margin: 0, fontFamily: mono }}>{KNOWN_TOKENS.map(t => t.key).join(' · ')}</p>
        <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '8px 0 0' }}>
          Each has its own page, for example <Link href='/token/LUNA' style={{ color: C.goldLit }}>/token/LUNA</Link>.
        </p>
      </Panel>

      <Panel title='What it is, and what it is not'>
        <ul style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>A quote is what the pools would deliver at the moment it is read. It is not an offer and not advice, and it moves with every trade. The same goes for sizes, prices and market data: what the chain said when it was read.</li>
          <li>Nothing is signed, held or charged here. A swap opens Terra Swap, where the person signs it in their own wallet, and where the site&apos;s regional restrictions apply as they do anywhere else on it.</li>
          <li>USDC from Noble and USDC.inj are separate tokens and are never quoted against each other.</li>
          <li>Please cache on your side: quotes are kept about 20 seconds here, and each server answers about 120 fresh quotes a minute.</li>
          <li>The code is open source under MIT. <a href={REPO} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>Run your own copy</a>; the pools and the router on chain have no owner and no admin.</li>
        </ul>
      </Panel>
    </Page>
  )
}
