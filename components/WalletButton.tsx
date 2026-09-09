'use client'

/**
 * Connect / disconnect. A small modal lists the wallets cosmos-kit knows
 * about for this environment: browser extensions on desktop, the in-wallet
 * browser's own wallet inside Keplr Mobile or Leap, WalletConnect wallets
 * on other mobile browsers (when a project id is configured).
 *
 * In a gated region the button becomes a "browse-only" pill: pages and data
 * stay open, only the act of connecting is withheld.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useChainWallet } from '@cosmos-kit/react'
import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension'
import { wallets as leapWallets } from '@cosmos-kit/leap-extension'
import { customWallets, mobileWallets } from 'constants/wallet'
import { defaultChain } from 'constants/chain'
import useMyAddress from './hooks/useMyAddress'
import { useWallet } from './providers/WalletProvider'
import { useTxRegionGate } from './RegionGate'

type WalletList = typeof customWallets | typeof mobileWallets

function resolveWallets(): WalletList {
  if (typeof window === 'undefined') return customWallets
  const ua = window.navigator.userAgent.toLowerCase()
  if (ua.includes('keplrwalletmobile')) return keplrWallets as WalletList
  if (ua.includes('leapcosmos')) return leapWallets as WalletList
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return mobileWallets.length ? mobileWallets : customWallets
  return customWallets
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.55rem 0.95rem', borderRadius: 999,
  border: '1px solid rgba(255,216,61,0.28)', background: '#111729', color: '#f4f1e8',
  fontFamily: 'inherit', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
}

function WalletRow({ wallet, onDone }: { wallet: WalletList[number]; onDone: () => void }) {
  const w = useChainWallet(defaultChain, wallet.walletName)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const logo = wallet.walletInfo.logo
  const logoSrc = typeof logo === 'string' ? logo : logo && 'major' in logo ? logo.major : undefined
  return (
    <button
      type='button'
      disabled={busy}
      onClick={async () => {
        setErr(null); setBusy(true)
        try { await w.connect(); onDone() } catch (e) { setErr(e instanceof Error ? e.message : 'Connection failed') } finally { setBusy(false) }
      }}
      style={{
        ...pill, width: '100%', justifyContent: 'flex-start', borderRadius: 12, padding: '0.8rem 1rem',
        background: 'rgba(0,0,0,0.32)', opacity: busy ? 0.7 : 1,
      }}
    >
      {logoSrc && <img src={logoSrc} alt='' width={24} height={24} style={{ borderRadius: 6 }} />}
      <span style={{ flex: 1, textAlign: 'left' }}>{wallet.walletPrettyName}</span>
      {err && <span style={{ color: '#e04a5a', fontSize: '0.72rem', fontWeight: 500 }}>{err.slice(0, 60)}</span>}
    </button>
  )
}

export default function WalletButton({ className, onClick }: { className?: string; onClick?: () => void }) {
  const { disconnect } = useWallet()
  const me = useMyAddress()
  const { txAllowed, country } = useTxRegionGate()
  const [wallets, setWallets] = useState<WalletList>(customWallets)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setWallets(resolveWallets()); setMounted(true) }, [])
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])

  if (me) {
    return (
      <button type='button' className={className} style={pill} onClick={() => (onClick ? onClick() : disconnect())} title='Disconnect'>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: '#3ddc97', boxShadow: '0 0 8px #3ddc97' }} />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{me.slice(0, 9)}…{me.slice(-4)}</span>
        <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>▾</span>
      </button>
    )
  }

  if (txAllowed === false) {
    return (
      <button
        type='button' className={className} style={{ ...pill, cursor: 'help', opacity: 0.65 }}
        title={`Wallet actions are not available in ${country ?? 'your region'}. Everything else stays open. The contracts are permissionless and reachable with any Terra wallet.`}
        onClick={() => { /* explanation lives in the title and the banner */ }}
      >
        ⓘ Browse-only
      </button>
    )
  }

  return (
    <>
      <button type='button' className={className} style={pill} onClick={() => setOpen(true)}>Connect</button>
      {mounted && open && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(5,7,15,0.78)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <section style={{ width: 'min(92vw, 380px)', background: '#0b0f1c', border: '1px solid rgba(255,216,61,0.28)', borderRadius: 18, padding: '1.2rem', color: '#f4f1e8', fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Connect a wallet</h3>
              <button type='button' onClick={() => setOpen(false)} aria-label='Close' style={{ background: 'transparent', border: 'none', color: '#9a927f', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#9a927f', lineHeight: 1.5 }}>Terra, phoenix-1. Nothing is stored; the wallet signs, the chain does the rest.</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {wallets.length === 0 && <div style={{ fontSize: '0.8rem', color: '#9a927f' }}>No wallet available in this browser. Open this page inside Keplr Mobile or Leap, or use a desktop browser with the extension.</div>}
              {wallets.map(w => <WalletRow key={w.walletName} wallet={w} onDone={() => setOpen(false)} />)}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}
