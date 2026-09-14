/**
 * Two ends and a live arc of current between them, a nod to the old Terra
 * Bridge's crackle between chains.
 *
 * Drawn here from scratch as SVG: a jagged bolt redrawn several times a second,
 * a wider blurred copy under it for the glow, a fainter second strand, and a
 * spark that runs from the source to the destination. It idles calmly and
 * speeds up while something is actually on its way. People who ask their
 * system for reduced motion get a still line, and nothing animates while the
 * pulse is off screen or the tab is hidden.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

const W = 300
const H = 80
const MID = H / 2

let counter = 0

/** A bolt pinned at both ends and wildest in the middle. */
function bolt(amp: number, segments = 16): string {
  const pts = [`0,${MID}`]
  for (let i = 1; i < segments; i++) {
    const x = (i / segments) * W
    const taper = Math.sin((i / segments) * Math.PI)
    pts.push(`${x.toFixed(1)},${(MID + (Math.random() * 2 - 1) * amp * taper).toFixed(1)}`)
  }
  pts.push(`${W},${MID}`)
  return pts.join(' ')
}

export default function ElectricPulse({
  left, right, leftLabel, rightLabel, caption, active = false, compact = false, onSwap,
  fromColor = '#62d9ff', toColor = '#c77dff',
}: {
  left: ReactNode
  right: ReactNode
  leftLabel?: string
  rightLabel?: string
  /** small label above the arc, e.g. "IBC" */
  caption?: string
  /** something is on its way: faster, brighter */
  active?: boolean
  compact?: boolean
  /** clicking the pulse switches direction */
  onSwap?: () => void
  fromColor?: string
  toColor?: string
}) {
  const [uid] = useState(() => `ep${++counter}`)
  const wrap = useRef<HTMLDivElement>(null)
  const [still, setStill] = useState(false)
  const [paths, setPaths] = useState<[string, string, string]>(() => [bolt(0), bolt(0), bolt(0)])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setStill(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (still) { setPaths([bolt(0), bolt(0), bolt(0)]); return }
    let raf = 0
    let last = 0
    let visible = true
    const io = typeof IntersectionObserver !== 'undefined' && wrap.current
      ? new IntersectionObserver(([e]) => { visible = e.isIntersecting })
      : null
    if (io && wrap.current) io.observe(wrap.current)
    const amp = active ? 15 : 8
    const every = active ? 55 : 95
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!visible || document.hidden || now - last < every) return
      last = now
      setPaths([bolt(amp), bolt(amp * 0.6, 12), bolt(amp * 1.15, 9)])
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); io?.disconnect() }
  }, [active, still])

  const size = compact ? 42 : 82
  const period = active ? 1100 : 2600
  const end = (node: ReactNode, label: string | undefined, color: string) => (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 6, flex: 'none' }}>
      <div style={{
        width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center',
        background: 'radial-gradient(circle at 50% 38%, rgba(255,255,255,0.07), rgba(0,0,0,0.4))',
        border: `2px solid ${color}`,
        boxShadow: `0 0 ${active ? 26 : 16}px ${color}66, inset 0 0 14px ${color}2e`,
        transition: 'box-shadow 0.4s ease',
      }}>{node}</div>
      {label && <span style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.72 }}>{label}</span>}
    </div>
  )

  return (
    <div ref={wrap} style={{ display: 'flex', alignItems: compact ? 'center' : 'flex-start', gap: compact ? 6 : 10, width: '100%' }}>
      {end(left, leftLabel, fromColor)}
      <div
        role={onSwap ? 'button' : undefined}
        tabIndex={onSwap ? 0 : undefined}
        title={onSwap ? 'Switch direction' : undefined}
        onClick={onSwap}
        onKeyDown={e => { if (onSwap && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSwap() } }}
        style={{ position: 'relative', flex: 1, minWidth: 60, height: compact ? 42 : size, cursor: onSwap ? 'pointer' : 'default', display: 'grid', alignItems: 'center' }}
      >
        {caption && (
          <span style={{ position: 'absolute', top: compact ? -4 : 4, left: 0, right: 0, textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', opacity: 0.7 }}>{caption}</span>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' aria-hidden style={{ width: '100%', height: compact ? 36 : 64, display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id={`${uid}g`} x1='0' x2='1' y1='0' y2='0'>
              <stop offset='0' stopColor={fromColor} />
              <stop offset='0.5' stopColor='#ffffff' />
              <stop offset='1' stopColor={toColor} />
            </linearGradient>
            <filter id={`${uid}f`} x='-10%' y='-80%' width='120%' height='260%'>
              <feGaussianBlur stdDeviation='2.6' result='b' />
              <feMerge><feMergeNode in='b' /><feMergeNode in='SourceGraphic' /></feMerge>
            </filter>
          </defs>
          <polyline points={paths[2]} fill='none' stroke={`url(#${uid}g)`} strokeWidth={7} strokeOpacity={active ? 0.3 : 0.2} vectorEffect='non-scaling-stroke' filter={`url(#${uid}f)`} />
          <polyline points={paths[1]} fill='none' stroke={`url(#${uid}g)`} strokeWidth={1} strokeOpacity={0.55} vectorEffect='non-scaling-stroke' />
          <polyline points={paths[0]} fill='none' stroke={`url(#${uid}g)`} strokeWidth={active ? 2.4 : 1.8} strokeLinejoin='round' vectorEffect='non-scaling-stroke' filter={`url(#${uid}f)`} />
        </svg>
        {!still && (
          <span aria-hidden className={`${uid}-spark`} style={{
            position: 'absolute', top: '50%', left: 0, width: compact ? 7 : 9, height: compact ? 7 : 9, marginTop: compact ? -3.5 : -4.5,
            borderRadius: '50%', background: '#fff', boxShadow: `0 0 10px 3px ${toColor}, 0 0 4px 1px ${fromColor}`,
            animation: `${uid}-run ${period}ms linear infinite`,
          }} />
        )}
        <style>{`@keyframes ${uid}-run { 0% { left: 0%; opacity: 0 } 12% { opacity: 1 } 88% { opacity: 1 } 100% { left: 100%; opacity: 0 } }`}</style>
      </div>
      {end(right, rightLabel, toColor)}
    </div>
  )
}
