/**
 * GET /api/og/tx?hash=<64 hex> — the share card for a transaction receipt
 * (/tx/[hash]). It reads the transaction from the chain itself; a hash that
 * does not resolve gets a plain card, so the image never shows anything the
 * chain did not say.
 */

// Next 13.5: ImageResponse ships from next/server (next/og arrived in 14).
import { ImageResponse, type NextRequest } from 'next/server'
import { tokenFor } from 'lib/dex'
import { fmtAmount } from 'lib/arb'
import { TX_HASH, readReceipt } from 'lib/txReceipt'

export const config = { runtime: 'edge' }

const NAVY = '#05070f', CARD = '#0b0f1c', RED = '#e0485a', ROYAL = '#caa022', GOLD = '#ffd83d', GREEN = '#3ddc97'
const TEXT = '#f4f1e8', MUTED = '#9a927f', WHISPER = '#6b6555'

async function brandFont(weight: 300 | 700): Promise<ArrayBuffer | null> {
  try {
    // An old Safari UA makes Google Fonts hand back TTF, which Satori can read.
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Montserrat:wght@${weight}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1' },
    }).then(r => r.text())
    const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1]
    return url ? await fetch(url).then(r => r.arrayBuffer()) : null
  } catch { return null }
}

const tokenOf = (id: string) => tokenFor(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } })
const show = (m: { id: string; amount: string }) => { const t = tokenOf(m.id); return `${fmtAmount(Number(m.amount) / 10 ** t.decimals)} ${t.label}` }

export default async function handler(req: NextRequest) {
  const url = new URL(req.url)
  const hash = url.searchParams.get('hash') ?? ''
  const [font, light, r] = await Promise.all([brandFont(700), brandFont(300), TX_HASH.test(hash) ? readReceipt(hash, 6000) : Promise.resolve(null)])
  const fonts = font
    ? [{ name: 'SG', data: font, weight: 700 as const, style: 'normal' as const }, ...(light ? [{ name: 'SG', data: light, weight: 300 as const, style: 'normal' as const }] : [])]
    : undefined
  const swap = r && r.ok && r.kind === 'swap' && r.out.length === 1 && r.in.length >= 1
  const got = r?.quote ? r.in.find(m => tokenOf(m.id).label === r.quote!.label) : undefined
  const vs = r?.quote && got && r.quote.amount > 0 ? (Number(got.amount) / 10 ** tokenOf(got.id).decimals / r.quote.amount - 1) * 100 : null
  const when = r ? new Date(r.time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
  const headline = !r ? 'A transaction on Terra'
    : swap ? `${show(r.out[0])} → ${show(r.in[0])}`
    : r.in.length ? `${show(r.in[0])} arrived` : r.out.length ? `${show(r.out[0])} sent` : 'A transaction on Terra'
  const lines = r?.quote
    ? [
        `quoted ${fmtAmount(r.quote.amount)} ${r.quote.label}${vs != null ? ` · arrived ${vs >= 0 ? '+' : ''}${vs.toFixed(2)}%` : ''}`,
        r.quote.gainPct != null && r.quote.gainPct >= 0.005 ? `routing added +${r.quote.gainPct.toFixed(2)}% over two pools` : '',
      ].filter(Boolean)
    : [r ? 'read from the chain' : 'not found on the chain yet']

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, fontFamily: font ? 'SG' : 'sans-serif', color: TEXT, backgroundColor: NAVY, backgroundImage: `radial-gradient(circle at 50% -20%, #1a1d30 0%, #0a0d18 45%, ${NAVY} 100%)` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={`${url.origin}/img/openfields-x.png`} alt='' width={64} height={64} style={{ marginRight: 18 }} />
          <div style={{ display: 'flex', fontSize: 56, lineHeight: 1, backgroundImage: 'linear-gradient(180deg, #fff8dc 0%, #ffd83d 55%, #caa022 100%)', backgroundClip: 'text', color: 'transparent' }}>
            <span style={{ fontWeight: 700 }}>Terra</span><span style={{ fontWeight: 300, marginLeft: 14 }}>Swap</span>
          </div>
          <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 22, letterSpacing: 6, color: RED }}>RECEIPT · READ FROM THE CHAIN</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: CARD, border: `2px solid ${ROYAL}`, borderRadius: 24, padding: '30px 38px' }}>
          <div style={{ display: 'flex', fontSize: headline.length > 34 ? 52 : 64, lineHeight: 1.1, color: TEXT }}>{headline}</div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', fontSize: 30, color: i === 1 ? GREEN : MUTED, marginTop: 12 }}>{l}</div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', height: 3, backgroundColor: GOLD, borderRadius: 2, opacity: 0.9 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 22, letterSpacing: 4, color: WHISPER }}>
            <div style={{ display: 'flex' }}>{r ? `${r.ok ? '✓ LANDED' : '✗ FAILED'} · BLOCK #${r.height.toLocaleString('en-US')} · ${when.toUpperCase()}` : url.host.toUpperCase()}</div>
            <div style={{ display: 'flex' }}>{hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : ''}</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, emoji: 'twemoji', headers: { 'Cache-Control': r ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=60' } },
  )
}
