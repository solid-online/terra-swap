'use client'

/**
 * RegionBanner — top-of-page strip explaining the open-browse /
 * gated-trade posture to blocked-region visitors. Renders only when
 * the RegionGate has resolved AND tx is not allowed. Otherwise: null.
 *
 * Designed to be added once at the top of _app.tsx's layout — never
 * per-page.
 */

import { useState } from 'react'
import { useTxRegionGate } from './RegionGate'

const PALETTE = {
  bg: 'rgba(220, 38, 38, 0.08)',
  border: 'rgba(220, 38, 38, 0.32)',
  text: '#ffdb8a',
  textMuted: '#bfa987',
}

export default function RegionBanner() {
  const { txAllowed, country, reason } = useTxRegionGate()
  const [collapsed, setCollapsed] = useState(false)

  if (txAllowed === null) return null  // still loading
  if (txAllowed) return null            // permitted region — no banner
  if (collapsed) return null

  return (
    <div
      role='status'
      aria-live='polite'
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: PALETTE.bg,
        borderBottom: `1px solid ${PALETTE.border}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '0.65rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        flexWrap: 'wrap',
        fontSize: '0.85rem',
        color: PALETTE.text,
        lineHeight: 1.5,
      }}
    >
      <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>ⓘ</span>
      <span style={{ flex: 1, minWidth: 200 }}>
        <strong style={{ color: PALETTE.text }}>Browse-only mode</strong>
        {country && (
          <span style={{ color: PALETTE.textMuted }}> · region {country}</span>
        )}
        {' — '}
        <span style={{ color: PALETTE.textMuted }}>
          {reason ?? 'Wallet actions are not available in your region. Everything else stays open.'}
        </span>
      </span>
      <button
        type='button'
        onClick={() => setCollapsed(true)}
        aria-label='Dismiss notice'
        style={{
          background: 'transparent',
          border: 'none',
          color: PALETTE.textMuted,
          cursor: 'pointer',
          padding: '0.2rem 0.5rem',
          fontSize: '1rem',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
