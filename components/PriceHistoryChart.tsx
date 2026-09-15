/**
 * A price over time from the site's own record (lib/priceHistory,
 * /api/price-history): a token's dollar price, or a pool's own price drawn
 * over the market for the same pair, so a pool that drifts shows as two lines
 * parting. Ranges from a day to ninety, a crosshair that reads any point, and
 * a plain empty state while the record is young.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { C, fmtNum } from 'components/PageShell'
import { TEXT } from 'components/tokens'
import type { Point, Range, Series } from 'lib/priceHistory'

const RANGES: Range[] = ['1d', '7d', '30d', '90d']
const W = 640, H = 190, PAD_Y = 10

const when = (ms: number, range: Range) => new Date(ms).toLocaleString('en-GB', range === '1d'
  ? { hour: '2-digit', minute: '2-digit' }
  : { day: 'numeric', month: 'short', ...(range === '7d' ? { hour: '2-digit', minute: '2-digit' } : {}) })

export default function PriceHistoryChart({ query, unit, marketName = 'Market' }: {
  /** "token=LUNA", or "pool=terra1…&base=LUNA&quote=USDC" */
  query: string
  /** '$' for dollars, otherwise the quote token's label */
  unit: string
  marketName?: string
}) {
  const [range, setRange] = useState<Range>('7d')
  const [data, setData] = useState<Series | null>(null)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setFailed(false)
    fetch(`/api/price-history?${query}&range=${range}`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: Series | null) => { if (!alive) return; if (j) setData(j); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [query, range])

  const points = useMemo(() => data?.points ?? [], [data])
  const market = useMemo(() => data?.market ?? [], [data])
  const scale = useMemo(() => {
    const all = [...points, ...market]
    if (all.length < 2) return null
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]))
    let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]))
    if (hi === lo) { lo *= 0.99; hi *= 1.01 }
    const pad = (hi - lo) * 0.06
    lo -= pad; hi += pad
    return {
      x: (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * W : W / 2),
      y: (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - PAD_Y * 2),
      t0, t1,
    }
  }, [points, market])

  /** A path that lifts the pen across a gap longer than three steps, so a pause in recording is not drawn as a flat line. */
  const pathOf = (pts: Point[]) => {
    if (!scale || pts.length < 2) return ''
    const steps = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((a, b) => a - b)
    const typical = steps[Math.floor(steps.length / 2)] || 1
    return pts.map((p, i) => `${i === 0 || p[0] - pts[i - 1][0] > typical * 3 ? 'M' : 'L'}${scale.x(p[0]).toFixed(1)},${scale.y(p[1]).toFixed(1)}`).join(' ')
  }

  const first = points[0]?.[1], last = points[points.length - 1]?.[1]
  const change = points.length >= 2 && first && last ? (last / first - 1) * 100 : null
  const up = (change ?? 0) >= 0
  const stroke = change == null ? C.goldLit : up ? C.success : C.alert
  const show = (v: number) => (unit === '$' ? `$${fmtNum(v)}` : `${fmtNum(v)} ${unit}`)
  const nearest = (pts: Point[], t: number) => pts.reduce<Point | null>((b, p) => (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b), null)
  const hp = hover != null && scale ? nearest(points.length ? points : market, scale.t0 + (hover / W) * (scale.t1 - scale.t0)) : null
  const hm = hp && market.length ? nearest(market, hp[0]) : null

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !r.width) return
    setHover(Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)))
  }

  const btn = (on: boolean): React.CSSProperties => ({
    padding: '2px 9px', borderRadius: 999, fontSize: TEXT.xs.size, fontFamily: 'inherit', cursor: 'pointer',
    background: on ? 'rgba(255,216,61,0.08)' : 'transparent', color: on ? C.goldLit : C.textMuted, border: `1px solid ${on ? C.goldCore : C.divider}`,
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: '1.35rem', fontWeight: 700, color: C.goldLit, fontVariantNumeric: 'tabular-nums' }}>{hp ? show(hp[1]) : last ? show(last) : '—'}</span>
        {!hp && change != null && <span style={{ fontSize: TEXT.sm.size, fontWeight: 700, color: stroke, fontVariantNumeric: 'tabular-nums' }}>{up ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>}
        {hp && <span style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{new Date(hp[0]).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{hm ? ` · ${marketName.toLowerCase()} ${show(hm[1])}` : ''}</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {RANGES.map(r => <button key={r} type='button' onClick={() => setRange(r)} style={btn(range === r)}>{r.toUpperCase()}</button>)}
        </span>
      </div>
      {scale ? (
        <div ref={box} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ position: 'relative', touchAction: 'pan-y' }}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' style={{ width: '100%', height: 190, display: 'block' }} role='img' aria-label={`Price over ${range}`}>
            <defs>
              <linearGradient id={`hist-${query.length}-${range}`} x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor={stroke} stopOpacity='0.22' />
                <stop offset='100%' stopColor={stroke} stopOpacity='0' />
              </linearGradient>
            </defs>
            {market.length > 1 && <path d={pathOf(market)} fill='none' stroke={C.textMuted} strokeWidth='1.5' strokeDasharray='4 4' vectorEffect='non-scaling-stroke' />}
            {points.length > 1 && <path d={`${pathOf(points)} L${scale.x(points[points.length - 1][0]).toFixed(1)},${H} L${scale.x(points[0][0]).toFixed(1)},${H} Z`} fill={`url(#hist-${query.length}-${range})`} stroke='none' />}
            {points.length > 1 && <path d={pathOf(points)} fill='none' stroke={stroke} strokeWidth='2' vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />}
            {hp && <line x1={scale.x(hp[0])} x2={scale.x(hp[0])} y1={0} y2={H} stroke={C.textWhisper} strokeWidth='1' vectorEffect='non-scaling-stroke' />}
          </svg>
          {hp && <span aria-hidden style={{ position: 'absolute', left: `${(scale.x(hp[0]) / W) * 100}%`, top: `${(scale.y(hp[1]) / H) * 100}%`, width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: 999, background: stroke, boxShadow: `0 0 8px ${stroke}` }} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>
            <span>{when(scale.t0, range)}</span>
            {market.length > 1 && <span><span style={{ color: stroke }}>━</span> this pool · <span style={{ color: C.textMuted }}>┅</span> {marketName.toLowerCase()}</span>}
            <span>{when(scale.t1, range)}</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, padding: '18px 0' }}>
          {failed
            ? 'The price record did not answer. Try again in a moment.'
            : !data
              ? 'Reading the price record…'
              : data.since
                ? `The site has written prices down since ${new Date(`${data.since}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, a point every ten minutes. This range fills in as it goes.`
                : 'The site writes prices down every ten minutes from its first recording on. Nothing before that is filled in, so the chart starts empty.'}
        </div>
      )}
    </div>
  )
}
