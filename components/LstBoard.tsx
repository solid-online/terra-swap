/**
 * Liquid staking tokens against their hubs (/api/lst, lib/lstBoard): what the
 * best route through either site's pools pays for selling ampLUNA or bLUNA,
 * beside redeeming at the hub's rate after unbonding, and what it gets for
 * buying, beside minting at the hub. On the Pools tab and on /stats.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SPACE, TEXT } from 'components/tokens'
import type { LstResponse } from 'pages/api/lst'
import type { LstSide } from 'lib/lstBoard'
import { TERRA_FONT } from 'lib/font'

const C = {
  surface: '#0b0f1c', surfaceElev: '#111729', divider: 'rgba(255,216,61,0.13)', goldCore: '#caa022', goldLit: '#ffd83d',
  textPrimary: '#f4f1e8', textSecondary: '#d6cfbd', textMuted: '#9a927f', textWhisper: '#6b6555', success: '#3ddc97', ember: '#ffb347',
} as const

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const dollars = (n: number) => `$${n.toLocaleString('en-US')}`
/** Past this, the size is simply too big for the pools: the figure measures how thin they are, not the hub. */
const THIN_PCT = 10

export default function LstBoard({ onTrade }: {
  /** Open the swap panel on this trade. Without it the board links to the swap page instead. */
  onTrade?: (fromId: string, toId: string, amount: string) => void
}) {
  const [data, setData] = useState<LstResponse | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/lst')
      .then(r => (r.ok ? r.json() : null))
      .then((j: LstResponse | null) => { if (!alive) return; if (j?.rows?.length) { setData(j); setFailed(false) } else if (!data) setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    pull()
    const iv = setInterval(pull, 300_000)
    return () => { alive = false; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const action = (fromId: string, toId: string, fromKey: string, toKey: string, side: LstSide) => (
    onTrade
      ? <button type='button' onClick={() => onTrade(fromId, toId, side.amount)} style={{ background: 'transparent', border: `1px solid ${C.divider}`, borderRadius: 8, color: C.goldLit, fontSize: TEXT.xs.size, padding: '1px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>swap</button>
      : <Link href={`/?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}&amount=${side.amount}`} style={{ color: C.goldLit, fontSize: TEXT.xs.size }}>swap ↗</Link>
  )

  return (
    <section style={{ background: C.surfaceElev, border: `1px solid ${C.divider}`, borderRadius: 16, padding: '1rem 1.1rem', fontFamily: TERRA_FONT }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'], flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: TEXT.md.size, margin: 0, color: C.textPrimary }}>Liquid staking · pools against the hubs</h2>
        {data && <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>priced {new Date(data.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: '4px 0 10px' }}>
        ampLUNA and bLUNA are minted and redeemed by their hubs at an exchange rate, and the pools drift from it. For a $100 and a $5,000 trade, through the best route on Terra Swap&apos;s and Astroport&apos;s pools: selling beside redeeming at the hub, and buying beside minting there.
      </p>
      {!data && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{failed ? 'The hubs did not answer. Try again in a moment.' : 'Pricing both ways through both sites…'}</div>}
      <div style={{ display: 'grid', gap: SPACE['3'] }}>
        {data?.rows.map(row => {
          const days = `${Math.round(row.unbondDays)} to ${Math.round(row.unbondDays + row.epochDays)} days`
          return (
            <div key={row.key} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'], flexWrap: 'wrap' }}>
                <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{row.key}</b>
                <span style={{ fontSize: TEXT.xs.size, color: C.textSecondary }}>{row.provider}&apos;s hub: 1 {row.key} = {row.rate.toFixed(4)} LUNA</span>
                <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>redeeming takes about {days}</span>
              </div>
              {row.sizes.map(s => (
                <div key={s.usd} style={{ display: 'grid', gap: 2, padding: '6px 10px', background: C.surface, borderRadius: 10, border: `1px solid ${C.divider}` }}>
                  {!s.sell && !s.buy && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>{dollars(s.usd)}: the pools could not be priced just now.</div>}
                  {s.sell && (
                    <div style={{ display: 'flex', gap: SPACE['2'], alignItems: 'baseline', flexWrap: 'wrap', fontSize: TEXT.xs.size, color: C.textMuted }}>
                      <span style={{ minWidth: '6.5rem' }}>Sell {dollars(s.usd)}</span>
                      <span style={{ color: C.textSecondary }}>{s.sell.rate.toFixed(4)} LUNA each</span>
                      {Math.abs(s.sell.vsHubPct) > THIN_PCT
                        ? <span title={s.sell.route} style={{ color: C.textWhisper }}>the pools are too thin for this size ({signed(s.sell.vsHubPct)}); redeeming at {row.provider} pays the rate</span>
                        : <span title={s.sell.route} style={{ color: s.sell.vsHubPct < -0.05 ? C.ember : C.success }}>
                            {signed(s.sell.vsHubPct)} {s.sell.vsHubPct < -0.05 ? `against redeeming at ${row.provider}` : 'against the hub rate'}
                          </span>}
                      <span style={{ marginLeft: 'auto' }}>{action(row.token, 'uluna', row.key, 'LUNA', s.sell)}</span>
                    </div>
                  )}
                  {s.buy && (
                    <div style={{ display: 'flex', gap: SPACE['2'], alignItems: 'baseline', flexWrap: 'wrap', fontSize: TEXT.xs.size, color: C.textMuted }}>
                      <span style={{ minWidth: '6.5rem' }}>Buy {dollars(s.usd)}</span>
                      <span style={{ color: C.textSecondary }}>{s.buy.rate.toFixed(4)} {row.key} per LUNA</span>
                      {Math.abs(s.buy.vsHubPct) > THIN_PCT
                        ? <span title={s.buy.route} style={{ color: C.textWhisper }}>the pools are too thin for this size ({signed(s.buy.vsHubPct)}); minting at {row.provider} pays the rate</span>
                        : <span title={s.buy.route} style={{ color: s.buy.vsHubPct > 0.05 ? C.success : C.ember }}>
                            {signed(s.buy.vsHubPct)} against minting at {row.provider}
                          </span>}
                      <span style={{ marginLeft: 'auto' }}>{action('uluna', row.token, 'LUNA', row.key, s.buy)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {data && (
        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.6, marginTop: SPACE['2'] }}>
          Pool fees included, gas not. A negative figure on selling means redeeming at the hub pays more, once unbonding is over; a positive figure on buying means the pool gives more than minting. The swap panel offers the hub whenever it is the better side. Pools move with every trade and a hub&apos;s rate with its staking rewards, so these are today&apos;s numbers, not a forecast.
        </div>
      )}
    </section>
  )
}
