/**
 * OHLC candlesticks with a volume histogram for one pool, from the site's own
 * record (/api/dex-candles, lib/priceHistory). TradingView's lightweight-charts
 * draws it, the same library Astroport and Coinhall use. Price is quote per
 * base; volume is in the quote token. The record fills in over time, so a young
 * chart is sparse and says so.
 */

import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, CrosshairMode, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { C, fmtNum } from 'components/PageShell'
import { TEXT } from 'components/tokens'
import { CANDLE_INTERVALS, type CandleInterval } from 'lib/priceHistory'
import type { CandlesResponse } from 'lib/api/dex-candles'

const LABEL: Record<CandleInterval, string> = { '1h': '1H', '4h': '4H', '1d': '1D' }

export default function CandleChart({ pair, base, quote }: { pair: string; base: string; quote: string }) {
  const [interval, setInterval] = useState<CandleInterval>('1h')
  const [data, setData] = useState<CandlesResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    let alive = true
    setFailed(false)
    fetch(`/api/dex-candles?pair=${pair}&interval=${interval}`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: CandlesResponse | null) => { if (!alive) return; if (j) setData(j); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [pair, interval])

  useEffect(() => {
    const el = box.current
    if (!el || !data) return
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 300,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: C.textMuted, fontFamily: 'inherit', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: C.textWhisper, labelBackgroundColor: C.surfaceElev }, horzLine: { color: C.textWhisper, labelBackgroundColor: C.surfaceElev } },
      rightPriceScale: { borderColor: C.divider },
      timeScale: { borderColor: C.divider, timeVisible: interval !== '1d', secondsVisible: false },
      handleScale: { axisPressedMouseMove: false },
    })
    chartRef.current = chart
    const candleSeries = chart.addCandlestickSeries({
      upColor: C.success, downColor: C.alert, wickUpColor: C.success, wickDownColor: C.alert, borderVisible: false,
    })
    candleSeries.setData(data.candles.map(c => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })))
    const volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volSeries.setData(data.candles.filter(c => c.v > 0).map(c => ({ time: c.t as UTCTimestamp, value: c.v, color: c.c >= c.o ? 'rgba(61,220,151,0.5)' : 'rgba(224,74,90,0.5)' })))
    chart.timeScale().fitContent()

    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [data, interval])

  const candles = data?.candles ?? []
  const last = candles[candles.length - 1]
  const first = candles[0]
  const change = last && first && first.o > 0 ? (last.c - first.o) / first.o : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: TEXT.sm.size, color: C.textSecondary, fontWeight: 600 }}>{base} / {quote}</span>
          {last && <span style={{ fontSize: TEXT.sm.size, color: C.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(last.c)} {quote}</span>}
          {change != null && <span style={{ fontSize: TEXT.xs.size, color: change >= 0 ? C.success : C.alert }}>{change >= 0 ? '+' : ''}{(change * 100).toFixed(2)}%</span>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {CANDLE_INTERVALS.map(iv => (
            <button key={iv} type='button' onClick={() => setInterval(iv)} aria-pressed={interval === iv}
              style={{ padding: '2px 9px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: TEXT.xs.size,
                background: interval === iv ? C.goldLit : 'transparent', color: interval === iv ? '#05070f' : C.textMuted,
                border: `1px solid ${interval === iv ? C.goldLit : C.divider}`, fontWeight: 600 }}>
              {LABEL[iv]}
            </button>
          ))}
        </div>
      </div>
      <div ref={box} style={{ width: '100%', height: 300 }} />
      {failed && <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, margin: '8px 0 0' }}>The chart is not available right now.</p>}
      {!failed && candles.length === 0 && (
        <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, margin: '8px 0 0', lineHeight: 1.6 }}>
          No candles yet. The chart is drawn from this site&apos;s own record, which fills in every ten minutes{data?.since ? ` since ${data.since}` : ''}; a pool that trades rarely stays sparse.
        </p>
      )}
      {!failed && candles.length > 0 && (
        <p style={{ fontSize: '0.68rem', color: C.textWhisper, margin: '8px 0 0', lineHeight: 1.5 }}>
          From this site&apos;s own record, read from the chain every ten minutes{data?.since ? ` since ${data.since}` : ''}. Volume is in {quote}. No external feed.
        </p>
      )}
    </div>
  )
}
