/**
 * /verify: Terra Swap's contracts, checked from this browser against a public
 * endpoint every time the page opens.
 *
 * For each contract: the code it runs and that code's checksum, whether anyone
 * can migrate it, and the settings that matter (who owns the factory, what the
 * pools charge, which factories the router trusts). The contracts written for
 * Terra Swap are expected to match the reproducible builds in this repository
 * (contracts/owner-sink, contracts/router). The factory and the pools run
 * Astroport's own code, so they are checked against the code Astroport's
 * factory on Terra runs and uses for its xyk pools. The same checks run from a
 * terminal with contracts/owner-sink/verify.sh and contracts/router/verify.sh.
 */

import Head from 'next/head'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import SiteNav from 'components/SiteNav'
import { ASTRO_FACTORY, ASTRO_ROUTER, TERRA_SWAP_FACTORY, TERRA_SWAP_ROUTER, VENUE_INCENTIVES, smart } from 'lib/dex'
import { lcdFetch } from 'lib/lcd'

const TERRA_FONT = "'Montserrat', 'Space Grotesk', 'Inter', system-ui, sans-serif"
const C = {
  surface: '#0b0f1c', surfaceElev: '#111729', divider: 'rgba(255,216,61,0.13)',
  goldCore: '#caa022', goldLit: '#ffd83d', textPrimary: '#f4f1e8', textSecondary: '#d6cfbd', textMuted: '#9a927f', textWhisper: '#6b6555',
  success: '#3ddc97', alert: '#e04a5a', korea: '#e0485a',
} as const

const REPO = 'https://github.com/solid-online/terra-swap'
const OWNER_SINK = 'terra1ylr5lqj9e4ehjpxc4944rhjcmq7zdaju50r3tn60vn7rsqym50gq5w27l3'
/** Codes and checksums as expected. Terra Swap's own builds: contracts/*\/artifacts/checksums.txt. */
const EXPECT = {
  factory: { code: '3108', checksum: '363b4859ac08d9acbf2387b864cf74d3f7954ac34b52acae9d9d71c6fdde1dd1' },
  pair: { code: '392', checksum: 'a5155c856cebff4519a63a3acb4985971f3ed98289519cf588a92425464476e1' },
  sink: { code: '4025', checksum: 'b62e749bd03846cf6abf48ebc7bd33413a0647e5ee557a65de9abef2661a6ab1' },
  router: { code: '4028', checksum: 'd4f36193c98a92dd455fda0e3b2a899071edda1c638d3dbc8149e0e9caf31ff3' },
}

type State = 'checking' | 'ok' | 'bad' | 'note'
interface Check { group: string; what: string; expected: string; found: string; state: State; href?: string }
interface PairConfig { code_id: number; pair_type: Record<string, unknown>; total_fee_bps: number; maker_fee_bps: number; is_disabled: boolean }

const addressUrl = (a: string) => `https://terrasco.pe/mainnet/address/${a}`
const shortHash = (h: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : 'no answer')

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const r = await lcdFetch(path, { timeoutMs: 12_000 })
    return r.ok ? ((await r.json()) as T) : null
  } catch { return null }
}
const contractInfo = (a: string) => readJson<{ contract_info?: { code_id: string; admin: string } }>(`/cosmwasm/wasm/v1/contract/${a}`).then(j => j?.contract_info ?? null)
const codeChecksum = (id: string) => readJson<{ checksum?: string }>(`/cosmwasm/wasm/v1/code-info/${id}`).then(j => (j?.checksum ?? '').toLowerCase())

const GROUPS: { key: string; title: string; address?: string; blurb: string }[] = [
  { key: 'factory', title: "Terra Swap's factory", address: TERRA_SWAP_FACTORY, blurb: "Creates the pools. It runs Astroport's factory code, its ownership was handed to a contract that can never use it, and nobody can migrate it." },
  { key: 'sink', title: 'The owner sink', address: OWNER_SINK, blurb: "The 60-line contract that holds the factory's ownership (contracts/owner-sink). All it can do is accept it." },
  { key: 'pools', title: 'Every pool', blurb: "Astroport's xyk pair code. 0.3% per swap, all of it to liquidity providers. No pool can be migrated: the pools that existed at the renounce had their admin cleared, and pools opened since carry the owner sink as admin, which has no way to migrate anything." },
  { key: 'router', title: "Terra Swap's router", address: TERRA_SWAP_ROUTER, blurb: 'One transaction through pools on both factories, and the swap on arrival over IBC (contracts/router). No owner, no admin, no fee.' },
  { key: 'astroport', title: "Astroport's contracts this page also uses", blurb: "Not Terra Swap's. Swaps and positions can go through them, and Astroport can upgrade them; shown so that is plain." },
]

async function run(push: (c: Check) => void): Promise<void> {
  const [fInfo, fSum, astroInfo, config] = await Promise.all([
    contractInfo(TERRA_SWAP_FACTORY), codeChecksum(EXPECT.factory.code), contractInfo(ASTRO_FACTORY),
    smart<{ owner: string; pair_configs: PairConfig[] }>(TERRA_SWAP_FACTORY, { config: {} }),
  ])
  push({ group: 'factory', what: 'Code', expected: `${EXPECT.factory.code} · ${shortHash(EXPECT.factory.checksum)}`, found: `${fInfo?.code_id ?? 'no answer'} · ${shortHash(fSum)}`, state: fInfo?.code_id === EXPECT.factory.code && fSum === EXPECT.factory.checksum ? 'ok' : 'bad', href: addressUrl(TERRA_SWAP_FACTORY) })
  push({ group: 'factory', what: "Same code as Astroport's factory", expected: EXPECT.factory.code, found: astroInfo?.code_id ?? 'no answer', state: !!astroInfo && astroInfo.code_id === fInfo?.code_id ? 'ok' : 'bad', href: addressUrl(ASTRO_FACTORY) })
  push({ group: 'factory', what: 'Migrate admin', expected: 'none', found: fInfo ? fInfo.admin || 'none' : 'no answer', state: fInfo && !fInfo.admin ? 'ok' : 'bad' })
  push({ group: 'factory', what: 'Owner', expected: 'the owner sink', found: config?.owner ?? 'no answer', state: config?.owner === OWNER_SINK ? 'ok' : 'bad', href: config?.owner ? addressUrl(config.owner) : undefined })
  const xyk = config?.pair_configs?.find(c => 'xyk' in (c.pair_type ?? {}))
  const others = (config?.pair_configs ?? []).filter(c => c !== xyk && !c.is_disabled)
  push({
    group: 'factory', what: 'Pools it can create', expected: 'xyk only · code 392 · fee 30 bps · maker fee 0',
    found: xyk ? `xyk · code ${xyk.code_id} · fee ${xyk.total_fee_bps} bps · maker fee ${xyk.maker_fee_bps}${others.length ? ` · and ${others.length} other type${others.length === 1 ? '' : 's'}` : ' only'}` : 'no answer',
    state: xyk && String(xyk.code_id) === EXPECT.pair.code && xyk.total_fee_bps === 30 && xyk.maker_fee_bps === 0 && !xyk.is_disabled && others.length === 0 ? 'ok' : 'bad',
  })

  const [sInfo, sSum, target] = await Promise.all([contractInfo(OWNER_SINK), codeChecksum(EXPECT.sink.code), smart<string>(OWNER_SINK, { target: {} })])
  push({ group: 'sink', what: 'Code', expected: `${EXPECT.sink.code} · ${shortHash(EXPECT.sink.checksum)} (this repository's build)`, found: `${sInfo?.code_id ?? 'no answer'} · ${shortHash(sSum)}`, state: sInfo?.code_id === EXPECT.sink.code && sSum === EXPECT.sink.checksum ? 'ok' : 'bad', href: `${REPO}/tree/main/contracts/owner-sink` })
  push({ group: 'sink', what: 'Migrate admin', expected: 'none', found: sInfo ? sInfo.admin || 'none' : 'no answer', state: sInfo && !sInfo.admin ? 'ok' : 'bad' })
  push({ group: 'sink', what: 'Holds ownership of', expected: "Terra Swap's factory", found: target ?? 'no answer', state: target === TERRA_SWAP_FACTORY ? 'ok' : 'bad' })

  const pairs: string[] = []
  let startAfter: unknown
  for (let i = 0; i < 20; i++) {
    const page = await smart<{ pairs: { contract_addr: string; asset_infos: unknown }[] }>(TERRA_SWAP_FACTORY, { pairs: { limit: 30, ...(startAfter ? { start_after: startAfter } : {}) } })
    const got = page?.pairs ?? []
    pairs.push(...got.map(p => p.contract_addr))
    if (got.length < 30) break
    startAfter = got[got.length - 1].asset_infos
  }
  const pSum = await codeChecksum(EXPECT.pair.code)
  const infos: ({ code_id: string; admin: string } | null)[] = []
  for (let i = 0; i < pairs.length; i += 6) infos.push(...(await Promise.all(pairs.slice(i, i + 6).map(contractInfo))))
  const wrongCode = infos.filter(x => !x || x.code_id !== EXPECT.pair.code).length
  // Pools opened after the renounce were given the factory's owner as their admin, and that owner is the sink. The
  // sink's code sends one message, the ownership claim; it has no way to migrate a contract or change an admin.
  const none = infos.filter(x => x && !x.admin).length
  const bySink = infos.filter(x => x && x.admin === OWNER_SINK).length
  const other = pairs.length - none - bySink
  push({ group: 'pools', what: 'Pair code', expected: `${EXPECT.pair.code} · ${shortHash(EXPECT.pair.checksum)}`, found: `${shortHash(pSum)} · ${pairs.length - wrongCode} of ${pairs.length} pools run it`, state: pairs.length > 0 && wrongCode === 0 && pSum === EXPECT.pair.checksum ? 'ok' : 'bad' })
  push({ group: 'pools', what: 'Migrate admin', expected: 'none, or the owner sink, which cannot migrate', found: pairs.length ? `${none} have none · ${bySink} have the owner sink${other ? ` · ${other} someone else` : ''}` : 'no answer', state: pairs.length > 0 && other === 0 ? 'ok' : 'bad' })

  if (TERRA_SWAP_ROUTER) {
    const [rInfo, rSum, rConfig] = await Promise.all([contractInfo(TERRA_SWAP_ROUTER), codeChecksum(EXPECT.router.code), smart<{ factories: string[] }>(TERRA_SWAP_ROUTER, { config: {} })])
    push({ group: 'router', what: 'Code', expected: `${EXPECT.router.code} · ${shortHash(EXPECT.router.checksum)} (this repository's build)`, found: `${rInfo?.code_id ?? 'no answer'} · ${shortHash(rSum)}`, state: rInfo?.code_id === EXPECT.router.code && rSum === EXPECT.router.checksum ? 'ok' : 'bad', href: `${REPO}/tree/main/contracts/router` })
    push({ group: 'router', what: 'Migrate admin', expected: 'none', found: rInfo ? rInfo.admin || 'none' : 'no answer', state: rInfo && !rInfo.admin ? 'ok' : 'bad' })
    const f = rConfig?.factories ?? []
    push({ group: 'router', what: 'Factories it trusts', expected: "Terra Swap's and Astroport's, nothing else", found: f.length ? f.map(x => (x === TERRA_SWAP_FACTORY ? 'Terra Swap' : x === ASTRO_FACTORY ? 'Astroport' : x)).join(' + ') : 'no answer', state: f.length === 2 && f[0] === TERRA_SWAP_FACTORY && f[1] === ASTRO_FACTORY ? 'ok' : 'bad' })
  }

  const external: [string, string][] = [["Astroport's factory", ASTRO_FACTORY], ["Astroport's router", ASTRO_ROUTER], ["Astroport's incentives", VENUE_INCENTIVES.astroport ?? '']]
  const exInfos = await Promise.all(external.map(([, a]) => (a ? contractInfo(a) : Promise.resolve(null))))
  external.forEach(([name, a], i) => {
    const x = exInfos[i]
    push({ group: 'astroport', what: name, expected: 'Astroport can migrate it', found: x ? (x.admin ? `code ${x.code_id} · admin ${x.admin.slice(0, 12)}…` : `code ${x.code_id} · no admin`) : 'no answer', state: 'note', href: a ? addressUrl(a) : undefined })
  })
}

export default function VerifyPage() {
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)
  const [at, setAt] = useState<Date | null>(null)
  // Only the latest run writes: "check again" mid-run, or React running the effect twice in development, must not interleave rows.
  const runId = useRef(0)
  const start = useCallback(() => {
    const id = ++runId.current
    setChecks([]); setRunning(true)
    run(c => { if (runId.current === id) setChecks(cs => [...cs, c]) })
      .finally(() => { if (runId.current === id) { setRunning(false); setAt(new Date()) } })
  }, [])
  useEffect(() => { start() }, [start])
  const bad = checks.filter(c => c.state === 'bad').length
  const passed = checks.filter(c => c.state === 'ok').length

  return (
    <>
      <Head>
        <title>Verify · Terra Swap</title>
        <link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700&display=swap' />
      </Head>
      <main style={{ minHeight: '100vh', background: 'radial-gradient(120% 80% at 50% -10%, #111729 0%, #0a0d18 42%, #05070f 100%)', color: C.textPrimary, fontFamily: TERRA_FONT, padding: '1.4rem 1.2rem 4rem' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <SiteNav here='verify' />
          <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.4rem)', margin: '0.6rem 0 0.4rem', letterSpacing: '-0.02em' }}>
            <span style={{ fontWeight: 700, color: C.goldLit }}>Verify</span> <span style={{ fontWeight: 300 }}>the contracts</span>
          </h1>
          <p style={{ fontSize: TEXT.sm.size, color: C.textSecondary, lineHeight: 1.65, margin: `0 0 ${SPACE['3']}px` }}>
            Everything below is read from Terra when this page opens, by your browser, from a public endpoint. Nothing comes from this site&apos;s server. The contracts written for Terra Swap are compared with the reproducible builds in <a href={REPO} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>the repository</a>; the factory and the pools run Astroport&apos;s own code. From a terminal, <code>contracts/owner-sink/verify.sh</code> and <code>contracts/router/verify.sh</code> check the same things.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flexWrap: 'wrap', margin: `0 0 ${SPACE['3']}px` }}>
            <span style={{ fontSize: TEXT.sm.size, fontWeight: 700, color: running ? C.textMuted : bad ? C.alert : C.success }}>
              {running ? `Checking… ${passed} passed so far` : bad ? `${bad} check${bad === 1 ? '' : 's'} did not pass` : `All ${passed} checks passed`}
            </span>
            {at && !running && <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>at {at.toLocaleTimeString('en-GB')}</span>}
            <button type='button' onClick={start} disabled={running} style={{ marginLeft: 'auto', padding: '0.45rem 0.9rem', background: 'transparent', color: C.textSecondary, border: `1px solid ${C.divider}`, borderRadius: 9, fontSize: TEXT.xs.size, fontWeight: 600, cursor: running ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {running ? 'checking…' : 'check again'}
            </button>
          </div>
          <div style={{ display: 'grid', gap: SPACE['3'] }}>
            {GROUPS.map(g => {
              const rows = checks.filter(c => c.group === g.key)
              if (g.key === 'router' && !TERRA_SWAP_ROUTER) return null
              return (
                <section key={g.key} style={{ background: C.surfaceElev, border: `1px solid ${C.divider}`, borderRadius: 16, padding: '1rem 1.1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'], flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: TEXT.md.size, margin: 0 }}>{g.title}</h2>
                    {g.address && <a href={addressUrl(g.address)} target='_blank' rel='noreferrer' style={{ fontSize: TEXT.xs.size, color: C.textMuted, fontFamily: 'monospace', wordBreak: 'break-all' }}>{g.address}</a>}
                  </div>
                  <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '4px 0 8px' }}>{g.blurb}</p>
                  {rows.length === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>{running ? 'reading…' : 'no answer from the chain'}</div>}
                  {rows.map(c => (
                    <div key={c.what} style={{ display: 'grid', gridTemplateColumns: '1.4rem minmax(8rem, 12rem) 1fr', gap: '0.2rem 0.6rem', padding: '6px 0', borderTop: `1px solid ${C.divider}`, fontSize: TEXT.xs.size, alignItems: 'baseline' }}>
                      <span style={{ color: c.state === 'ok' ? C.success : c.state === 'bad' ? C.alert : C.textMuted, fontWeight: 700 }}>{c.state === 'ok' ? '✓' : c.state === 'bad' ? '✗' : '•'}</span>
                      <span style={{ color: C.textSecondary }}>{c.href ? <a href={c.href} target='_blank' rel='noreferrer' style={{ color: 'inherit' }}>{c.what} ↗</a> : c.what}</span>
                      <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: C.textPrimary }}>
                        {c.found}
                        {c.state !== 'ok' && <span style={{ display: 'block', color: C.textWhisper, fontFamily: TERRA_FONT }}>expected: {c.expected}</span>}
                      </span>
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        </div>
      </main>
    </>
  )
}
