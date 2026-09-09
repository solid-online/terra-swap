/**
 * GET /api/og/swap[?who=terra1…] — the social card for Terra Swap.
 *
 * Rendered on the edge with next/og so it can carry live numbers: liquidity,
 * pools, names on the board, and the day of the experiment. With `?who=` it
 * becomes that person's card — rank, points, title, badges — which is what a
 * "Share on X" from the board links to. Without it, the generic card.
 *
 * Falls back to a bundled default font if Google Fonts is unreachable, and to
 * the generic card if the board is; the unfurl must never 500.
 */

// Next 13.5: ImageResponse ships from next/server (next/og arrived in 14).
import { ImageResponse, type NextRequest } from 'next/server'

export const config = { runtime: 'edge' }

const NAVY = '#05070f', CARD = '#0b0f1c', BLUE = '#e0485a', ROYAL = '#caa022', GOLD = '#ffd83d'
const TEXT = '#f4f1e8', MUTED = '#9a927f', WHISPER = '#6b6555'
const EXPERIMENT_START = Date.UTC(2026, 8, 8)

interface Row { address: string; rank: number; points: number; badges: { emoji: string; name: string }[] }

const fontCache = new Map<number, Promise<ArrayBuffer | null>>()
// Montserrat: the free stand-in for Gotham, the face of the Terra wordmark. Same as the page.
// 700 carries the card; 300 is the light "Swap" in the lockup.
function brandFont(weight: 300 | 700): Promise<ArrayBuffer | null> {
  const hit = fontCache.get(weight)
  if (hit) return hit
  const p: Promise<ArrayBuffer | null> = (async (): Promise<ArrayBuffer | null> => {
    try {
      // An old Safari UA makes Google Fonts hand back TTF, which Satori can read.
      const css = await fetch(`https://fonts.googleapis.com/css2?family=Montserrat:wght@${weight}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1' },
      }).then(r => r.text())
      const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1]
      if (!url) return null
      const buf: ArrayBuffer = await fetch(url).then(r => r.arrayBuffer())
      return buf
    } catch { return null }
  })()
  fontCache.set(weight, p)
  return p
}

function rankTitle(points: number): string {
  if (points >= 1000) return 'Cosmic'
  if (points >= 500) return 'Phoenix'
  if (points >= 200) return 'Degen Emeritus'
  if (points >= 50) return 'Steady Lad'
  return 'Lunatic'
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 terra-swap-og' }, signal: AbortSignal.timeout(6000) })
    return r.ok ? (await r.json()) as T : null
  } catch { return null }
}

export default async function handler(req: NextRequest) {
  const origin = new URL(req.url).origin
  const host = new URL(req.url).host
  const who = new URL(req.url).searchParams.get('who') || ''
  const personal = /^terra1[0-9a-z]{38,}$/.test(who)

  const [font, light, dex, board] = await Promise.all([
    brandFont(700),
    brandFont(300),
    getJson<{ tvlUsd: number; pools: { empty: boolean }[] }>(`${origin}/api/dex`),
    getJson<{ rows: Row[]; totalEvents: number }>(`${origin}/api/dex-leaderboard`),
  ])
  const tvl = dex?.tvlUsd ?? 0
  const pools = dex?.pools.length ?? 0
  const onBoard = board?.rows.length ?? 0
  const day = Math.max(1, Math.floor((Date.now() - EXPERIMENT_START) / 86_400_000) + 1)
  const me = personal ? board?.rows.find(r => r.address === who) ?? null : null
  const short = personal ? `${who.slice(0, 9)}…${who.slice(-4)}` : ''
  const tvlStr = tvl >= 1000 ? `$${Math.round(tvl / 1000)}k` : `$${Math.round(tvl)}`

  const fonts = font
    ? [
        { name: 'SG', data: font, weight: 700 as const, style: 'normal' as const },
        ...(light ? [{ name: 'SG', data: light, weight: 300 as const, style: 'normal' as const }] : []),
      ]
    : undefined
  const ff = font ? 'SG' : 'sans-serif'

  return new ImageResponse(
    (
      <div style={{
        width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 64, fontFamily: ff, color: TEXT,
        backgroundColor: NAVY,
        backgroundImage: `radial-gradient(circle at 50% -20%, #1a1d30 0%, #0a0d18 45%, ${NAVY} 100%)`,
      }}>
        {/* top: kicker + wordmark */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 22, letterSpacing: 8, color: BLUE, textTransform: 'uppercase' }}>
            {personal ? 'WRITTEN DOWN · TERRA SWAP' : 'EXPERIMENTAL · DEX ON TERRA'}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 18 }}>
            {/* The Terra globe, cap-height with the wordmark. */}
            <img src={`${origin}/img/terra-globe-180.png`} width={92} height={92} style={{ marginRight: 22, marginBottom: 4 }} />
            <div style={{
              display: 'flex', fontSize: 104, lineHeight: 1, letterSpacing: -2,
              backgroundImage: 'linear-gradient(180deg, #fff8dc 0%, #ffd83d 55%, #caa022 100%)',
              backgroundClip: 'text', color: 'transparent',
            }}>
              <span style={{ fontWeight: 700 }}>Terra</span>
              <span style={{ fontWeight: 300, marginLeft: 26 }}>Swap</span>
            </div>
          </div>
        </div>

        {/* middle: personal card or manifesto */}
        {me ? (
          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: CARD, border: `2px solid ${ROYAL}`, borderRadius: 24, padding: '28px 36px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', marginRight: 40 }}>
              <div style={{ display: 'flex', fontSize: 20, letterSpacing: 4, color: MUTED }}>RANK</div>
              <div style={{ display: 'flex', fontSize: 96, lineHeight: 1, color: GOLD }}>#{me.rank}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', fontSize: 40, color: TEXT }}>{short}</div>
              <div style={{ display: 'flex', fontSize: 28, color: BLUE, marginTop: 6 }}>
                {me.points.toLocaleString('en-US')} pts · {rankTitle(me.points)}
              </div>
              {/* ✦ is a dingbat, not an emoji — twemoji has no glyph for it, so the Crystal badge becomes a gem here. */}
              <div style={{ display: 'flex', fontSize: 44, marginTop: 10 }}>{me.badges.map(b => b.emoji === '✦' ? '💎' : b.emoji).join(' ')}</div>
            </div>
          </div>
        ) : personal ? (
          <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: CARD, border: `2px solid ${ROYAL}`, borderRadius: 24, padding: '28px 36px' }}>
            <div style={{ display: 'flex', fontSize: 40, color: TEXT }}>{short}</div>
            <div style={{ display: 'flex', fontSize: 28, color: MUTED, marginTop: 8 }}>Not written down yet. One swap fixes that.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 34, lineHeight: 1.35, color: TEXT, maxWidth: 1000 }}>
            A decentralized exchange on Terra. Swap LUNA, USDC, SOLID, CAPA, ROAR, PAXG and wBTC. Open pools, add liquidity. Experimental.
          </div>
        )}

        {/* bottom: live stats + footer */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            {[[tvlStr, 'LIQUIDITY'], [String(pools), 'POOLS'], [String(onBoard), 'ON THE BOARD'], [`DAY ${day}`, 'OF THE EXPERIMENT']].map(([n, l]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
                <div style={{ display: 'flex', fontSize: 56, lineHeight: 1, color: GOLD }}>{n}</div>
                <div style={{ display: 'flex', fontSize: 18, letterSpacing: 4, color: MUTED, marginTop: 8 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', height: 3, backgroundColor: GOLD, marginTop: 30, borderRadius: 2, opacity: 0.9 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 22, letterSpacing: 4, color: WHISPER }}>
            <div style={{ display: 'flex' }}>{host.toUpperCase()}</div>
            <div style={{ display: 'flex' }}>PHOENIX-1 · STEADY LADS</div>
          </div>
        </div>
        {/* the man on the line, saluting, bottom right */}
        <div style={{ position: 'absolute', right: 56, bottom: 92, display: 'flex' }}>
          <svg width='96' height='150' viewBox='0 0 60 92' fill='none' stroke='#ffd83d' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M30 60 L22 90' /><path d='M30 60 L38 90' /><path d='M30 60 L30 38' /><path d='M22 44 Q30 36 38 44' />
            <path d='M30 42 L20 56' /><path d='M30 42 L38 30 L34 26' />
            <circle cx='31' cy='24' r='10' /><path d='M23 18 L20 12 M28 15 L27 9 M34 15 L36 9' />
            <circle cx='27' cy='24' r='3.6' /><circle cx='35.5' cy='24' r='3.6' /><path d='M30.6 24 L31.9 24' /><path d='M40 25 L44 28 L40 30' />
          </svg>
        </div>
      </div>
    ),
    {
      width: 1200, height: 630, fonts, emoji: 'twemoji',
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    },
  )
}
