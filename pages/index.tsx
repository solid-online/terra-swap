/**
 * Terra Swap — the swap page. Served at /.
 *
 * Pools are Astroport's audited xyk pair code, created through a factory
 * whose ownership and admin keys have been renounced. This interface takes
 * no fee; the pool fee goes to liquidity providers. Renders "not live yet"
 * until NEXT_PUBLIC_DEX_FACTORY is set.
 */

import Head from 'next/head'
import Link from 'next/link'
import type { GetServerSideProps } from 'next'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useMyAddress from 'components/hooks/useMyAddress'
import WalletButton from 'components/WalletButton'
import { WalletName } from 'components/WalletName'
import ElectricPulse from 'components/ElectricPulse'
import LstBoard from 'components/LstBoard'
import CommandPalette, { type PaletteItem } from 'components/CommandPalette'
import AppSwitcher, { GOV_URL, HOME_URL, NFT_URL } from 'components/AppSwitcher'
import { PairIcons, TokenIcon } from 'components/TokenIcon'
import { isPredictLive } from 'lib/predict'
import { SPACE, RADIUS, TEXT } from 'components/tokens'
import { isCrystalHolder } from 'lib/holders'
import {
  KNOWN_TOKENS, NOBLE_USDC, USDC_INJ_DENOM, ATOM_DENOM, TERRA_SWAP_ROUTER, assetId, sameAsset, tokenFor, toMicro, fromMicro,
  simulateSwap, queryBalance, queryCw20Balance, planZap, annotateMarket, annotateValues, resolveToken,
  lpPosition, lpConcentration, IS_ASTRO, HOME_VENUE, VENUE_FACTORY, VENUE_NAME, VENUE_INCENTIVES, TERRA_SWAP_FACTORY_V2, factoryOf, smart, type Venue,
  COIN_REGISTRY, ASTRO_STAKING, XASTRO_CW20, ASTRO_CONVERTER, ASTRO_CW20, ASTRO_IBC_DENOM, DATOM_DENOM, FUEL_DENOM, STLUNA_DENOM, STATOM_DENOM,
  type PoolView, type KnownToken, type AssetInfo, type ZapPlan,
} from 'lib/dex'
import { arbPlans, fmtAmount, fmtUsd, totalUsd, type ArbPlan } from 'lib/arb'
import type { DexResponse } from 'pages/api/dex'
import type { BoardResponse, PoolActivity } from 'pages/api/dex-leaderboard'
import type { LpFlow } from 'lib/dex-ledger'
import type { PricesResponse } from 'pages/api/dex-prices'
import type { VenueResponse } from 'pages/api/dex-venue'
import type { SkeletonResponse } from 'pages/api/dex-skeleton'
import type { PositionsResponse } from 'pages/api/positions'
import type { HistoryResponse } from 'pages/api/history'
import type { HistoryRow, Moved } from 'lib/history'
import type { PoolFeesResponse } from 'pages/api/pool-fees'
import { quoteBest, quoteExactOut, planRoute, planTrade, routeText, tradeText, tradeMemo, reachable, quoteLoop, planRoutedZap, routerPlan, type Quotes, type Loop, type RoutedZap, type RoutePlan, type TradePlan } from 'lib/route'
import DepthCurve from 'components/DepthCurve'
import type { DepthResponse } from 'pages/api/depth'
import { historyCsv, plainAmount } from 'lib/csv'
import { removeContact, rememberRecipient, saveContact, useContacts } from 'lib/contacts'
import { disablePush, enablePush, usePush } from 'lib/push'
import { LANGS, setLang, useLang, type Lang } from 'lib/i18n'
import type { TradesResponse } from 'pages/api/dex-trades'
import type { WalletStats } from 'lib/trades'
import type { HoldersResponse, PoolHolders } from 'pages/api/dex-holders'
import { useRouteSwap, useTradeSwap, useProvideLiquidity, useExitPosition, useUnstake, useClaimRewards, useStakeLp, useAstroLegacyExit, useCreatePair, useZap, useLstBond, useLstUnbond, useLstWithdraw, useCosmosMsgs, useTerraMsgs, useInjectiveMsgs } from 'components/transactions/useDex'
import { useChain } from '@cosmos-kit/react'
import { fromBech32 } from '@cosmjs/encoding'
import type { EncodeObject } from '@cosmjs/proto-signing'
import { arrivalSwapMsg, ibcTransferMsg, routeMsgs, sendMsg, tradeMsgs } from 'lib/msgs'
import { NOBLE_CHAIN_ID, NOBLE_TO_TERRA_CHANNEL, NOBLE_USDC_DENOM, TERRA_CHAIN_ID, TERRA_TO_NOBLE_CHANNEL, nobleUsdcBalance } from 'lib/noble'
import { HUB_ATOM_DENOM, HUB_CHAIN_ID, HUB_TO_TERRA_CHANNEL, TERRA_TO_HUB_CHANNEL, hubAtomBalance } from 'lib/cosmoshub'
import { NEUTRON_ASTRO, NEUTRON_CHAIN_ID, NEUTRON_DATOM, NEUTRON_FEE_DENOM, NEUTRON_FUEL, NEUTRON_TO_TERRA_CHANNEL, TERRA_TO_NEUTRON_CHANNEL, neutronBalance } from 'lib/neutron'
import { STRIDE_CHAIN_ID, STRIDE_FEE_DENOM, STRIDE_TO_TERRA_CHANNEL, TERRA_TO_STRIDE_CHANNEL, strideBalance } from 'lib/stride'
import { estimateFee } from 'lib/gas'
import { INJECTIVE_CHAIN_ID, INJECTIVE_TO_TERRA_CHANNEL, TERRA_TO_INJECTIVE_CHANNEL, USDC_INJ_ON_INJECTIVE, injectiveBalance, toInjectiveAddress } from 'lib/injective'
import { hubForToken, hubInfo, type HubInfo } from 'lib/lst'
import { lcdFetch } from 'lib/lcd'
import { TOKEN_META, tokenScore } from 'lib/tokenMeta'
import { explainTx, humanizeTxError, type TxFix } from 'lib/errors'
import { recentMovePct, suggestSlippage, type SlipAdvice } from 'lib/slippage'
import { SWEEP_KEEP_LUNA_MICRO, SWEEP_MAX, planSweep, poolsFor, type SweepLine, type SweepPick } from 'lib/sweep'
import { GAS_DROP_BELOW_MICRO, LUNA, gasDropMicro, planGasDrop } from 'lib/gasDrop'
import { askNotifications, fmtUsdPrice, notificationsAllowed, removeAlert, toggleFavorite, useAlertWatcher, usePrefs } from 'lib/alerts'

type Tab = 'swap' | 'pools' | 'positions' | 'wallet' | 'history' | 'transfer' | 'create' | 'board'

/** How the pools list is ordered. */
type PoolSort = 'suggested' | 'tvl' | 'traded' | 'name'
const POOL_SORT_LABEL: Record<PoolSort, string> = { suggested: 'Suggested', tvl: 'TVL', traded: 'Most traded', name: 'Name' }

/**
 * Each section has an address (?tab=bridge, ?tab=portfolio…), so any of them can be linked to and survives
 * a reload. Named for what people call them; the keys inside stay as they were. Swap is the page itself.
 */
const TAB_PARAM: Record<Tab, string> = { swap: '', pools: 'pools', positions: 'portfolio', wallet: 'wallet', history: 'history', transfer: 'bridge', create: 'open-pool', board: 'board' }
const PARAM_TAB: Record<string, Tab> = { pools: 'pools', portfolio: 'positions', positions: 'positions', wallet: 'wallet', history: 'history', bridge: 'transfer', transfer: 'transfer', 'open-pool': 'create', create: 'create', board: 'board' }

// The classic Terra brand face is Gotham (terra.money served "Gotham A/B"
// from Hoefler & Co's cloud.typography in 2020–21; the wordmark is Gotham
// Bold). Gotham is a commercial licence and not on Google Fonts, which is the
// only font host our CSP allows, so we use Montserrat — the well-known free
// Gotham lookalike (same geometric skeleton, double-storey a, flat e).
const TERRA_FONT = "'Montserrat', 'Space Grotesk', 'Inter', system-ui, sans-serif"
/** Astroport mode: this page as a plain interface to Astroport's pools. See DEX_MODE in lib/dex. */
const LITE = IS_ASTRO
const APP_NAME = LITE ? 'Terra Pools' : 'Terra Swap'
/** What a pool charges. Astroport's pairs send part of it to their maker, so "to LPs" is only true on ours. */
const poolFeeText = (p: PoolView | null | undefined, poolFeeBps: number) => {
  if (!LITE) return `${poolFeeBps / 100}% to LPs`
  if (!p) return 'set by the pool'
  return p.pairType === 'xyk' ? '0.3%, set by the pool' : p.pairType === 'stable' ? '0.05%, set by the pool' : 'dynamic, set by the pool'
}
/** One leg's pool fee, for a pool on any venue. Terra Swap's factory sends all of it to LPs; Skeleton Swap's pools each set their own. */
/** A share of a swap in basis points as a short percentage: 30 → "0.3%". */
const bpsPct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`
const poolFeeTextFor = (p: PoolView) => p.venue === 'terraswap'
  ? '0.3% to LPs on Terra Swap'
  : p.venue === 'skeleton'
    ? p.fees ? `${bpsPct(p.fees.lpBps + p.fees.protocolBps + p.fees.burnBps)}, ${bpsPct(p.fees.lpBps)} of it to LPs, on Skeleton Swap` : 'fee set by the pool, on Skeleton Swap'
    : `${p.pairType === 'xyk' ? '0.3%' : p.pairType === 'stable' ? '0.05%' : 'dynamic'} on Astroport`

// Retro Terra 2020 palette — deep royal navy, electric Terra blue, cool white.
// Scoped to this page: it shadows the shared Atrium tokens (gold/ember roles
// are remapped to blue) so the swap surface reads as classic Terra without
// touching any other page's theme.
// LUNA gold on midnight, with a taeguk-red accent — a Seoul night market, not
// Astroport's blue. (v1 of this page was navy/electric-blue and read as a
// clone of theirs; changed 2026-09-09.)
const C = {
  void: '#05070f',
  surface: '#0b0f1c',
  surfaceElev: '#111729',
  surfaceHover: '#1a1f36',
  divider: 'rgba(255,216,61,0.13)',
  dividerStrong: 'rgba(255,216,61,0.28)',
  dividerWarm: 'rgba(255,179,71,0.34)',
  emberLit: '#ffb347',
  emberSoft: 'rgba(255,179,71,0.12)',
  goldCore: '#caa022',
  goldLit: '#ffd83d',
  goldSoft: 'rgba(255,216,61,0.10)',
  textPrimary: '#f4f1e8',
  textSecondary: '#d6cfbd',
  textMuted: '#9a927f',
  textWhisper: '#6b6555',
  success: '#3ddc97',
  successSoft: 'rgba(61,220,151,0.12)',
  alert: '#e04a5a',
  alertSoft: 'rgba(224,74,90,0.14)',
  /** taeguk red — kicker, wire tag, the spicy bits */
  korea: '#e0485a',
} as const

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className='terra-card' style={{
      background: C.surfaceElev, border: `1px solid ${C.divider}`,
      borderRadius: 16, padding: '1.1rem 1.2rem',
    }}>{children}</div>
  )
}

function Section({ title }: { title: string }) {
  return (
    <div style={{
      fontFamily: TERRA_FONT, fontWeight: 700, fontSize: TEXT.md.size,
      color: C.textPrimary, letterSpacing: '-0.01em', marginBottom: SPACE['2'],
    }}>{title}</div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      padding: '2rem 1.2rem', textAlign: 'center',
      border: `1px dashed ${C.divider}`, borderRadius: 16, background: C.surface,
    }}>
      <div style={{ color: C.textPrimary, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {body && <div style={{ color: C.textMuted, fontSize: TEXT.sm.size, lineHeight: 1.6 }}>{body}</div>}
    </div>
  )
}

const field: React.CSSProperties = {
  width: '100%', padding: '0.7rem 0.8rem',
  background: 'rgba(0,0,0,0.32)', border: `1px solid ${C.divider}`,
  borderRadius: 10, color: C.textPrimary, fontSize: TEXT.md.size,
  fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
}
const select: React.CSSProperties = { ...field, cursor: 'pointer', fontSize: TEXT.sm.size, width: 'auto', minWidth: 120 }

// Token marks live in components/TokenIcon, shared with the token and pool pages.


/** A native <select> (works everywhere, including iOS) with the chosen token's mark laid over its left edge. */
type TokenOption = { key: string; label: string; info: Parameters<typeof assetId>[0]; decimals?: number; cw20?: boolean }

/**
 * Prices and liquidity per token, published once by the page for every token
 * picker, so the picker can rank by depth and value balances without each
 * one re-reading the pools.
 */
let tokenData: { px: Record<string, number> | null; liquidity: Map<string, number> } = { px: null, liquidity: new Map() }
const tokenDataListeners = new Set<() => void>()
function publishTokenData(next: typeof tokenData) {
  tokenData = next
  tokenDataListeners.forEach(f => f())
}
function useTokenData() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump(n => n + 1)
    tokenDataListeners.add(f)
    return () => { tokenDataListeners.delete(f) }
  }, [])
  return tokenData
}
/** Half of each pool's value counts toward each of its two tokens. */
function liquidityByToken(pools: PoolView[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of pools) {
    if (!p.tvlUsd) continue
    for (const t of p.tokens) m.set(assetId(t.info), (m.get(assetId(t.info)) ?? 0) + p.tvlUsd / 2)
  }
  return m
}

/** Every listed token this wallet holds: native balances in one read, cw20s one query each. */
const balanceCache = new Map<string, { at: number; v: Record<string, string> }>()
async function walletBalances(addr: string, options: ReadonlyArray<TokenOption>): Promise<Record<string, string>> {
  const hit = balanceCache.get(addr)
  if (hit && Date.now() - hit.at < 20_000) return hit.v
  const out: Record<string, string> = {}
  try {
    const r = await lcdFetch(`/cosmos/bank/v1beta1/balances/${addr}?pagination.limit=300`)
    if (r.ok) for (const c of ((await r.json())?.balances ?? []) as { denom: string; amount: string }[]) out[c.denom] = c.amount
  } catch { /* balances are a nicety; the picker works without them */ }
  await Promise.all(options.filter(t => 'token' in t.info).map(async t => {
    const id = assetId(t.info)
    const b = await queryCw20Balance(id, addr)
    if (b !== '0') out[id] = b
  }))
  balanceCache.set(addr, { at: Date.now(), v: out })
  return out
}

const RECENT_KEY = 'terra_recent_tokens'
function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
function rememberToken(id: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, 6))) } catch { /* private mode */ }
}
const compactUsd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : n >= 1 ? `$${Math.round(n)}` : n > 0 ? `$${n.toFixed(2)}` : '')

/**
 * Picking a token by looking for it, not by scrolling a list: search by
 * ticker, name, chain, what it is ("bitcoin", "gold", "staked") or a pasted
 * address. Tokens you hold come first with their value, then the rest by how
 * much liquidity stands behind them, so the ones you can actually trade are
 * at the top. Tokens that share a name (USDC and USDC.inj) always say where
 * they come from.
 */
function TokenPicker({ options, value, onPick, onClose }: {
  options: ReadonlyArray<TokenOption>; value: string; onPick: (id: string) => void; onClose: () => void
}) {
  const me = useMyAddress()
  const { px, liquidity } = useTokenData()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [bal, setBal] = useState<Record<string, string>>({})
  const { favorites } = usePrefs()
  const { t: tr } = useLang()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    if (!me) return
    let alive = true
    walletBalances(me, options).then(b => { if (alive) setBal(b) }).catch(() => {})
    return () => { alive = false }
  }, [me, options])

  const decimalsOf = (t: TokenOption) => t.decimals ?? tokenFor(t.info).decimals
  const held = (t: TokenOption) => Number(bal[assetId(t.info)] ?? 0) / 10 ** decimalsOf(t)
  const usdHeld = (t: TokenOption) => { const p = px?.[assetId(t.info)]; return p ? held(t) * p : 0 }
  const liq = (t: TokenOption) => liquidity.get(assetId(t.info)) ?? 0
  /** Tokens sharing a name with another listed token, so each can say which one it is not. */
  const namesakes = useMemo(() => {
    const byName = new Map<string, string[]>()
    for (const t of options) { const n = TOKEN_META[t.key]?.name ?? t.label; byName.set(n, [...(byName.get(n) ?? []), t.label]) }
    return byName
  }, [options])

  const rank = (score: number) => (score >= 90 ? 2 : score >= 40 ? 1 : 0)
  const list = useMemo(() => {
    const rows = options
      .map(t => ({ t, score: tokenScore({ key: t.key, label: t.label, id: assetId(t.info) }, q) }))
      .filter(r => r.score > 0)
    return q.trim()
      // An exact ticker or address goes first; among the other real matches, the deepest market wins.
      ? rows.sort((a, b) => rank(b.score) - rank(a.score) || liq(b.t) - liq(a.t)).map(r => r.t)
      : rows.map(r => r.t).sort((a, b) => Number(favorites.includes(assetId(b.info))) - Number(favorites.includes(assetId(a.info))) || Number(held(b) > 0) - Number(held(a) > 0) || usdHeld(b) - usdHeld(a) || liq(b) - liq(a))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, q, bal, px, liquidity, favorites])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const popular = useMemo(() => [...options].sort((a, b) => liq(b) - liq(a)).slice(0, 5),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, liquidity])
  const recent = useMemo(() => readRecent().map(id => options.find(t => assetId(t.info) === id)).filter((t): t is TokenOption => !!t).slice(0, 5), [options])
  const pick = (t: TokenOption) => { rememberToken(assetId(t.info)); onPick(assetId(t.info)) }
  const looksLikeAddress = /^(terra1|ibc\/|factory\/|cw20:)/i.test(q.trim())

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, list.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]) }
  }
  const chip = (t: TokenOption) => (
    <button key={t.key} type='button' onClick={() => pick(t)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, color: C.textPrimary }}>
      <TokenIcon label={t.label} size={16} />{t.label}
    </button>
  )

  return (
    <div role='dialog' aria-modal='true' aria-label='Select a token' onKeyDown={onKey} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3,5,12,0.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ width: 'min(460px, 100%)', maxHeight: 'min(680px, 88vh)', display: 'flex', flexDirection: 'column', background: C.surfaceElev, border: `1px solid ${C.divider}`, borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
        <div style={{ padding: `${SPACE['3']}px ${SPACE['3']}px ${SPACE['2']}px` }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: SPACE['2'] }}>
            <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{tr('Select a token')}</b>
            <button type='button' onClick={onClose} aria-label='Close' style={{ ...ghostBtn, marginLeft: 'auto', padding: '2px 9px' }}>esc</button>
          </div>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Name, ticker, chain, or paste an address')}
            style={{ ...field, width: '100%', boxSizing: 'border-box' }} spellCheck={false} autoComplete='off' />
          {!q.trim() && (
            <div style={{ marginTop: SPACE['2'], display: 'grid', gap: 6 }}>
              {(() => {
                const favs = favorites.map(id => options.find(t => assetId(t.info) === id)).filter((t): t is TokenOption => !!t).slice(0, 8)
                return favs.length > 0 ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}><span style={{ fontSize: TEXT.xs.size, color: C.textWhisper, minWidth: 54 }}>{tr('★ Starred')}</span>{favs.map(chip)}</div> : null
              })()}
              {recent.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}><span style={{ fontSize: TEXT.xs.size, color: C.textWhisper, minWidth: 54 }}>{tr('Recent')}</span>{recent.map(chip)}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}><span style={{ fontSize: TEXT.xs.size, color: C.textWhisper, minWidth: 54 }}>{tr('Deepest')}</span>{popular.map(chip)}</div>
              <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>{tr('Try “bitcoin”, “gold”, “euro”, “staked luna” or “from noble”.')}</div>
            </div>
          )}
        </div>
        <div ref={listRef} role='listbox' style={{ overflowY: 'auto', padding: `0 ${SPACE['2']}px ${SPACE['2']}px`, borderTop: `1px solid ${C.divider}` }}>
          {list.length === 0 && (
            <div style={{ padding: SPACE['3'], fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6 }}>
              {tr(looksLikeAddress ? 'That address is not one of the listed tokens here. Unlisted tokens are not offered, so a look-alike cannot slip in.' : 'No listed token matches that.')}
            </div>
          )}
          {list.map((t, i) => {
            const id = assetId(t.info)
            const meta = TOKEN_META[t.key]
            const h = held(t), usd = usdHeld(t), depth = liq(t)
            const others = (namesakes.get(meta?.name ?? t.label) ?? []).filter(l => l !== t.label)
            const twin = others.length > 0
            const fav = favorites.includes(id)
            return (
              <div key={id} data-row={i} role='option' aria-selected={id === value} onMouseEnter={() => setActive(i)} onClick={() => pick(t)}
                style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], padding: '9px 10px', marginTop: 4, borderRadius: 10, cursor: 'pointer', background: i === active ? C.surface : 'transparent', border: `1px solid ${id === value ? C.goldCore : 'transparent'}` }}>
                <TokenIcon label={t.label} size={30} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{t.label}</b>
                    <span style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{meta?.name ?? ''}</span>
                  </div>
                  <div style={{ fontSize: TEXT.xs.size, color: twin ? C.goldLit : C.textWhisper }}>{meta?.origin ?? (('token' in t.info) ? 'Terra, cw20' : '')}{twin ? ` · ${tr('a different token from {others}', { others: others.join(' and ') })}` : ''}</div>
                </div>
                <button type='button' aria-label={fav ? `Unstar ${t.label}` : `Star ${t.label}`} title={fav ? 'Starred: shown first' : 'Star it to keep it at the top'}
                  onClick={e => { e.stopPropagation(); toggleFavorite(id) }}
                  style={{ background: 'transparent', border: 'none', color: fav ? C.goldLit : C.textWhisper, cursor: 'pointer', fontSize: '1rem', padding: '0 2px', lineHeight: 1 }}>
                  {fav ? '★' : '☆'}
                </button>
                <div style={{ textAlign: 'right', fontSize: TEXT.xs.size, fontVariantNumeric: 'tabular-nums' }}>
                  {h > 0
                    ? <><div style={{ color: C.textPrimary }}>{fmtAmount(h)}</div><div style={{ color: C.textMuted }}>{compactUsd(usd)}</div></>
                    : depth > 0 ? <div style={{ color: C.textWhisper }}>{tr('{amount} liquidity', { amount: compactUsd(depth) })}</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** The button that opens TokenPicker. Same props the old native select took. */
function TokenSelect({ value, onChange, options, style }: {
  value: string; onChange: (v: string) => void
  options: ReadonlyArray<TokenOption>
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const cur = options.find(t => assetId(t.info) === value)
  return (
    <div style={{ position: 'relative', display: 'flex', ...style }}>
      <button type='button' onClick={() => setOpen(true)} aria-haspopup='dialog' aria-label={cur ? `Token: ${cur.label}. Change` : 'Select a token'}
        style={{ ...select, width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', color: C.textPrimary }}>
        {cur ? <><TokenIcon label={cur.label} size={20} /><span style={{ fontWeight: 700 }}>{cur.label}</span></> : <span style={{ color: C.textMuted }}>Select</span>}
        <span aria-hidden style={{ marginLeft: 'auto', color: C.textMuted, fontSize: '0.8em' }}>▾</span>
      </button>
      {open && <TokenPicker options={options} value={value} onPick={v => { onChange(v); setOpen(false) }} onClose={() => setOpen(false)} />}
    </div>
  )
}
const label: React.CSSProperties = {
  display: 'block', fontSize: TEXT.xs.size, color: C.textMuted,
  letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
}
const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '0.8rem',
  background: 'linear-gradient(135deg, #caa022 0%, #ffd83d 100%)',
  color: '#1a1405', border: '1px solid #ffd83d', borderRadius: 10,
  fontWeight: 700, fontSize: TEXT.sm.size, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  padding: '0.5rem 0.8rem', background: 'transparent',
  color: C.textSecondary, border: `1px solid ${C.divider}`, borderRadius: 9,
  fontSize: TEXT.xs.size, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: SPACE['3'],
  fontSize: TEXT.xs.size, color: C.textMuted, padding: '3px 0',
}

function Row({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <div style={rowStyle}>
      <span>{k}</span>
      <span style={{ color: hi ? C.goldLit : C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

// ─── Moon, days, titles ─────────────────────────────────────────

/** LUNA means moon. So we show the moon. Synodic month from the 2000-01-06 new moon. */
function moonPhase(d = new Date()) {
  const SYN = 29.530588853
  const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000
  const phase = ((days % SYN) + SYN) % SYN / SYN
  const names = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent']
  const emojis = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
  const i = Math.round(phase * 8) % 8
  const daysToFull = Math.round((((0.5 - phase) + 1) % 1) * SYN)
  return { emoji: emojis[i], name: names[i], daysToFull, full: i === 4 }
}

/** The factory went up on this day. Every visit is "day N of the experiment". */
const EXPERIMENT_START = Date.UTC(2026, 8, 8)
const dayOfExperiment = () => Math.max(1, Math.floor((Date.now() - EXPERIMENT_START) / 86_400_000) + 1)

/** Titles are flavour. They buy nothing, like the points they come from. */
function rankTitle(points: number): string {
  if (points >= 1000) return 'Cosmic'
  if (points >= 500) return 'Phoenix'
  if (points >= 200) return 'Degen Emeritus'
  if (points >= 50) return 'Steady Lad'
  return 'Lunatic'
}

/** Prices for humans: no scientific notation, ever. 2.6e-7 becomes 0.00000026. */
function fmtPrice(n: number): string {
  if (!(n > 0)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toFixed(3)
  if (n >= 0.001) return n.toPrecision(3)
  // below 0.001: show three significant digits at fixed precision, trimmed
  const places = Math.min(12, Math.ceil(-Math.log10(n)) + 2)
  return n.toFixed(places).replace(/0+$/, '')
}

/** Today's fortune for an address. Deterministic per day, whimsical, never financial. */
const FORTUNES = [
  'A pool will remember you.',
  'Your size is not size, but your timing is.',
  'Someone will type kimchi because of you.',
  'The burrito is closer than you think.',
  'Steady. Lads.',
  'Hang tight. Then let go.',
  'You will debate the poor. You will lose. Gracefully.',
  'The moon is not a date. It is a direction.',
  'A first hand is waiting for a hand.',
  'Today the wire says your name twice.',
  'Deploy small. Sleep well.',
  'Somebody in Seoul just said gm to you.',
  'The chain does not forget. Neither should you.',
  'Press p. It will help.',
  'Nobody knows what happens next. That is the fun.',
  'You are written down. Act like it.',
]
/** Race by hash. He would ask. */
function race(addr: string): string {
  let h = 0; for (const ch of addr) h = (h * 33 + ch.charCodeAt(0)) >>> 0
  return [['Protoss', 'My life for Aiur. My liquidity for LUNA.'], ['Terran', 'Nuclear launch detected. It was a swap.'], ['Zerg', 'Spawn more Overlords. Or pools.']][h % 3].join(' · ')
}
function fortune(addr: string): string {
  const day = new Date().toISOString().slice(0, 10)
  let h = 0; for (const ch of addr + day) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FORTUNES[h % FORTUNES.length]
}

const ACTION_EMOJI: Record<string, string> = { create_pair: '🏗️', provide_liquidity: '💧', swap: '🔁', withdraw_liquidity: '🏃' }
const ACTION_VERB: Record<string, string> = { create_pair: 'opened', provide_liquidity: 'added to', swap: 'swapped on', withdraw_liquidity: 'pulled from' }

/** The wire: every move on every pool, newest first, scrolling. Bloomberg for a DEX built in a night. */
function Wire({ board, pools, onOpen }: { board: BoardResponse | null; pools: PoolView[]; onOpen: () => void }) {
  const [floats, setFloats] = useState<{ id: number; x: number; y: number; e: string }[]>([])
  const float = (ev: React.MouseEvent) => {
    const id = Date.now() + Math.random(); const e = ['🫡', '🐎', '🌕', '대박'][Math.floor(Math.random() * 4)]
    setFloats(f => [...f, { id, x: ev.clientX, y: ev.clientY, e }]); setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 1300)
  }
  const items = useMemo(() => {
    if (!board?.recent?.length) return []
    const byAddr = new Map(pools.map(p => [p.contract_addr, p.label]))
    return board.recent.map(e => ({
      key: e.id,
      emoji: ACTION_EMOJI[e.action] ?? '•',
      who: `${e.address.slice(0, 9)}…${e.address.slice(-4)}`,
      verb: ACTION_VERB[e.action] ?? e.action,
      where: byAddr.get(e.contract) ?? (e.action === 'create_pair' ? 'a new pool' : 'a pool'),
      h: e.height,
    }))
  }, [board, pools])
  if (!items.length) return null
  const track = [...items, ...items] // duplicated for a seamless loop
  return (
    <div className='terra-wire' aria-label='Latest moves on-chain'>
      {floats.map(f => <span key={f.id} className='terra-float' style={{ left: f.x, top: f.y }}>{f.e}</span>)}
      <button type='button' className='terra-wire-tag' onClick={onOpen} title='every move, with receipts' style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>THE WIRE ↗</button>
      <div className='terra-wire-mask'>
        <div className='terra-wire-track'>
          {track.map((it, i) => (
            <span key={`${it.key}-${i}`} className='terra-wire-item' onClick={float} style={{ cursor: 'pointer' }}>
              <span>{it.emoji}</span>
              <span style={{ color: C.textPrimary }}>{it.who}</span>
              <span>{it.verb}</span>
              <span style={{ color: C.goldLit }}>{it.where}</span>
              <span style={{ color: C.textWhisper }}>#{it.h.toLocaleString('en-US')}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The wire, unrolled: every recent move with its receipt on Terrascope. */
function LedgerOverlay({ board, pools, onClose }: { board: BoardResponse | null; pools: PoolView[]; onClose: () => void }) {
  const byAddr = new Map(pools.map(p => [p.contract_addr, p.label]))
  const rows = board?.recent ?? []
  return (
    <div className='terra-party' onClick={onClose} role='presentation' style={{ cursor: 'default', alignItems: 'flex-start', paddingTop: '8vh', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.surfaceElev, border: `1px solid ${C.dividerStrong}`, borderRadius: 16, padding: '1.1rem 1.2rem',
        width: 'min(92vw, 560px)', fontFamily: TERRA_FONT, color: C.textPrimary, position: 'relative', zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, letterSpacing: '0.12em', fontSize: '0.7rem', color: C.emberLit }}>THE WIRE · UNROLLED</div>
          <div style={{ marginLeft: 'auto', fontSize: '0.66rem', color: C.textWhisper }}>{board?.totalEvents ?? 0} moves total</div>
        </div>
        <div style={{ display: 'grid', gap: 2, maxHeight: '60vh', overflowY: 'auto' }}>
          {rows.map(e => (
            <a key={e.id} href={finderTx(e.txhash)} target='_blank' rel='noreferrer' className='terra-tape-row' style={{
              display: 'grid', gridTemplateColumns: '1.4rem 1fr auto', gap: 8, alignItems: 'baseline', textDecoration: 'none',
              fontSize: '0.8rem', color: C.textMuted, padding: '6px 6px', borderRadius: 8, borderBottom: `1px solid ${C.divider}`,
            }}>
              <span>{ACTION_EMOJI[e.action] ?? '•'}</span>
              <span><span style={{ color: C.textPrimary }}><WalletName address={e.address} head={8} tail={4} /></span> {ACTION_VERB[e.action] ?? e.action} <span style={{ color: C.goldLit }}>{byAddr.get(e.contract) ?? (e.action === 'create_pair' ? 'a new pool' : 'a pool')}</span></span>
              <span style={{ color: C.textWhisper, fontVariantNumeric: 'tabular-nums' }}>#{e.height.toLocaleString('en-US')} ↗</span>
            </a>
          ))}
          {rows.length === 0 && <div style={{ color: C.textWhisper, fontSize: '0.8rem', padding: 8 }}>Nothing yet. The first line is still unwritten.</div>}
        </div>
        <div style={{ marginTop: 10, fontSize: '0.7rem', color: C.textWhisper, fontStyle: 'italic' }}>Every line is a real transaction. Click one for the receipt.</div>
      </div>
    </div>
  )
}

function Footer({ height, soundOn, onToggleSound, onSecret, seoul }: { height?: number; soundOn: boolean; onToggleSound: () => void; onSecret: () => void; seoul?: { temp: number; code: number } | null }) {
  const m = moonPhase()
  const taps = useRef<number[]>([])
  const tap = () => { const now = Date.now(); taps.current = [...taps.current.filter(t => now - t < 3000), now]; if (taps.current.length >= 7) { taps.current = []; onSecret() } }
  const day = dayOfExperiment()
  const { lang } = useLang()
  return (
    <div style={{
      marginTop: SPACE['5'], paddingTop: SPACE['3'], borderTop: `1px solid ${C.divider}`,
      display: 'flex', flexWrap: 'wrap', gap: SPACE['2'], alignItems: 'center',
      fontFamily: TERRA_FONT, fontSize: '0.64rem', letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase',
    }}>
      <span onClick={tap} title={m.full ? 'wen moon? now.' : `wen moon? ${m.daysToFull} days. literally.`} style={{ cursor: 'help', color: C.textSecondary, userSelect: 'none' }}>
        {m.emoji} {m.name}{m.full ? ' · wen moon: now' : ` · full in ${m.daysToFull}d`}
      </span>
      <span>·</span>
      <span style={{ color: C.goldLit }}>Day {day} of the experiment</span>
      <span>·</span>
      <span title='born in seoul. rebuilt everywhere.'>🇰🇷 seoul {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date())}{seoul ? ` · ${seoul.temp}°C ${wxEmoji(seoul.code)}` : ''}{(() => { const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date())); return h >= 20 || h < 2 ? ' · PC방 hours' : '' })()}</span>
      <span>·</span>
      <span>phoenix-1{height ? ` #${height.toLocaleString('en-US')}` : ''}</span>
      <span>·</span>
      <Link href='/verify' title='check every contract from this browser' style={{ color: C.textSecondary, textDecoration: 'none' }}>verify the contracts</Link>
      <span>·</span>
      <Link href='/stats' title='liquidity, fees, liquid staking against the hubs, routing and uptime' style={{ color: C.textSecondary, textDecoration: 'none' }}>stats</Link>
      <span>·</span>
      <Link href='/developers' title='embed a live quote on your site, or call the quote API' style={{ color: C.textSecondary, textDecoration: 'none' }}>build</Link>
      <select aria-label='Language' value={lang} onChange={e => setLang(e.target.value as Lang)} style={{
        marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.divider}`, borderRadius: 999, padding: '2px 6px',
        color: C.textSecondary, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem',
      }}>
        {LANGS.map(l => <option key={l.code} value={l.code} style={{ background: C.surfaceElev }}>{l.name}</option>)}
      </select>
      <button type='button' onClick={onToggleSound} title={soundOn ? 'sound on · click to mute' : 'sound off · click for tiny beeps'} style={{
        background: 'transparent', border: `1px solid ${C.divider}`, borderRadius: 999, padding: '2px 8px',
        color: soundOn ? C.goldLit : C.textWhisper, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem',
      }}>{soundOn ? '🔊' : '🔇'}</button>
      <span style={{ color: C.textWhisper }} title='press ? for keys'>steady lads</span>
    </div>
  )
}

// ─── Deploying Capital: the game ────────────────────────────────
//
// You are the man on the line. Capital falls. Catch it. Kimchi falls too.
// Somewhere in there is the burrito nobody could account for.

const speak = (text: string) => { try { window.dispatchEvent(new CustomEvent('terra:speak', { detail: text })) } catch { /* ssr */ } }

type Drop = { x: number; y: number; vy: number; kind: 'coin' | 'gem' | 'chili' | 'horse' | 'burrito' }
// 💰 not 🪙: Apple draws the coin silver-grey and it reads as a tiny moon. Capital should look like capital.
const DROP_EMOJI: Record<Drop['kind'], string> = { coin: '💰', gem: '💎', chili: '🌶️', horse: '🐎', burrito: '🌯' }
const DROP_POINTS: Record<Drop['kind'], number> = { coin: 5, gem: 20, chili: 0, horse: 10, burrito: 50 }
const gameTitle = (n: number) => n >= 900 ? 'Cosmic' : n >= 500 ? 'Phoenix' : n >= 250 ? 'Degen Emeritus' : n >= 100 ? 'Steady Lad' : 'Lunatic'

function CapitalGame({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hud, setHud] = useState({ score: 0, lives: 3, t: 30, over: false, burrito: false, best: 0 })
  const st = useRef({ x: 320, vx: 0, drops: [] as Drop[], score: 0, lives: 3, start: 0, lastSpawn: 0, over: false, burrito: false, flash: 0, keys: new Set<string>() })
  const W = 640, H = 420, GROUND = H - 34

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const g = st.current
    let best = 0; try { best = Number(localStorage.getItem('terraswap_game_best') || '0') } catch { /* private */ }
    setHud(h => ({ ...h, best }))
    g.start = performance.now() + 2600; g.lastSpawn = g.start   // 2.6 s of countdown before anything falls
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) { e.preventDefault(); if (e.type === 'keydown') g.keys.add(e.key); else g.keys.delete(e.key) }
    }
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey)
    const onPointer = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); g.vx = (e.clientX - r.left) / r.width < 0.5 ? -6 : 6 }
    const onUp = () => { g.vx = 0 }
    cv.addEventListener('pointerdown', onPointer); window.addEventListener('pointerup', onUp)

    const drawKwon = (x: number, salute: boolean) => {
      ctx.strokeStyle = '#ffd83d'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      const y = GROUND
      ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x - 8, y); ctx.moveTo(x, y - 30); ctx.lineTo(x + 8, y)      // legs
      ctx.moveTo(x, y - 30); ctx.lineTo(x, y - 52)                                                                     // body
      ctx.moveTo(x, y - 48); ctx.lineTo(x - 11, y - 36)                                                                // back arm
      if (salute) { ctx.moveTo(x, y - 48); ctx.lineTo(x + 10, y - 60); ctx.lineTo(x + 4, y - 66) } else { ctx.moveTo(x, y - 48); ctx.lineTo(x + 12, y - 38) }
      ctx.stroke()
      ctx.beginPath(); ctx.arc(x + 1, y - 64, 10, 0, Math.PI * 2); ctx.stroke()                                        // head
      ctx.beginPath(); ctx.arc(x - 3, y - 64, 3.4, 0, Math.PI * 2); ctx.moveTo(x + 8.4, y - 64); ctx.arc(x + 5, y - 64, 3.4, 0, Math.PI * 2); ctx.stroke() // glasses
      ctx.beginPath(); ctx.moveTo(x - 7, y - 70); ctx.lineTo(x - 10, y - 76); ctx.moveTo(x - 2, y - 73); ctx.lineTo(x - 3, y - 79); ctx.moveTo(x + 4, y - 73); ctx.lineTo(x + 6, y - 79); ctx.stroke() // hair
    }

    let raf = 0
    const loop = (now: number) => {
      const elapsed = (now - g.start) / 1000
      const left = Math.max(0, 30 - elapsed)
      if (elapsed < 0) {
        // countdown: 3 · 2 · 1 · 화이팅
        ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
        ctx.strokeStyle = '#ffd83d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, GROUND + 2); ctx.lineTo(W, GROUND + 2); ctx.stroke()
        drawKwon(g.x, false)
        const n = Math.ceil(-elapsed)
        ctx.fillStyle = '#ffd83d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.font = '700 84px "Montserrat", system-ui, sans-serif'; ctx.fillText(n > 0 && -elapsed > 0.5 ? String(Math.min(3, n)) : '화이팅!', W / 2, H / 2 - 20)
        ctx.fillStyle = '#9a927f'; ctx.font = '700 14px "Montserrat", system-ui, sans-serif'; ctx.fillText('준비 · READY · CATCH THE CAPITAL', W / 2, H / 2 + 44)
        raf = requestAnimationFrame(loop); return
      }
      if (!g.over) {
        // input
        let vx = g.vx
        if (g.keys.has('ArrowLeft') || g.keys.has('a') || g.keys.has('A')) vx = -6
        if (g.keys.has('ArrowRight') || g.keys.has('d') || g.keys.has('D')) vx = 6
        g.x = Math.max(24, Math.min(W - 24, g.x + vx))
        // spawn, faster over time
        const gap = Math.max(300, 620 - elapsed * 11)
        if (now - g.lastSpawn > gap) {
          g.lastSpawn = now
          const r = Math.random()
          const kind: Drop['kind'] = r < 0.012 && !g.burrito ? 'burrito' : r < 0.07 ? 'horse' : r < 0.17 ? 'gem' : r < 0.42 ? 'chili' : 'coin'
          g.drops.push({ x: 30 + Math.random() * (W - 60), y: -20, vy: 2 + Math.random() * 1.6 + elapsed * 0.06, kind })
        }
        // move + catch
        for (const d of g.drops) d.y += d.vy
        const keep: Drop[] = []
        for (const d of g.drops) {
          const caught = d.y > GROUND - 70 && d.y < GROUND && Math.abs(d.x - g.x) < 26
          if (caught) {
            if (d.kind === 'chili') { g.lives -= 1; sound('mutter'); if (g.lives <= 0) g.over = true }
            else { g.score += DROP_POINTS[d.kind]; g.flash = 8; sound(d.kind === 'burrito' ? 'party' : 'tick'); if (d.kind === 'burrito') { g.burrito = true; try { localStorage.setItem('terraswap_burrito', '1') } catch { /* private */ } } }
            continue
          }
          if (d.y < H + 20) keep.push(d)
        }
        g.drops = keep
        if (left <= 0) g.over = true
        if (g.over) {
          try { if (g.score > best) { best = g.score; localStorage.setItem('terraswap_game_best', String(best)) } } catch { /* private */ }
          setHud({ score: g.score, lives: g.lives, t: 0, over: true, burrito: g.burrito, best })
        } else if (Math.floor(elapsed * 10) % 3 === 0) setHud({ score: g.score, lives: g.lives, t: Math.ceil(left), over: false, burrito: g.burrito, best })
      }
      // draw
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      const grd = ctx.createRadialGradient(W / 2, H * 1.1, 20, W / 2, H * 1.1, 420); grd.addColorStop(0, 'rgba(255,216,61,0.22)'); grd.addColorStop(1, 'rgba(5,7,15,0)')
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = '#ffd83d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, GROUND + 2); ctx.lineTo(W, GROUND + 2); ctx.stroke()
      ctx.font = '26px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      for (const d of g.drops) ctx.fillText(DROP_EMOJI[d.kind], d.x, d.y)
      drawKwon(g.x, g.flash > 0); if (g.flash > 0) g.flash -= 1
      ctx.fillStyle = '#9a927f'; ctx.font = '700 12px "Montserrat", system-ui, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(`CAPITAL  ${g.score}`, 14, 20); ctx.textAlign = 'right'; ctx.fillText(`${'🫡'.repeat(Math.max(0, g.lives))}   ${Math.ceil(left)}s`, W - 14, 20)
      if (!g.over) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); cv.removeEventListener('pointerdown', onPointer); window.removeEventListener('pointerup', onUp) }
  }, [])

  const [arcade, setArcade] = useState<{ top: { name: string; score: number; burrito: boolean }[]; burritos: number; plays: number } | null>(null)
  const posted = useRef(false)
  useEffect(() => {
    if (!hud.over || posted.current) return
    posted.current = true
    let name = ''
    try {
      const me = (window as unknown as { __terraMe?: string }).__terraMe
      name = me ? `${me.slice(0, 9)}…${me.slice(-4)}` : (localStorage.getItem('terraswap_handle') || '')
      if (!name) { name = `lunatic-${Math.floor(1000 + Math.random() * 9000)}`; localStorage.setItem('terraswap_handle', name) }
    } catch { name = `lunatic-${Math.floor(1000 + Math.random() * 9000)}` }
    fetch('/api/dex-arcade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, score: hud.score, burrito: hud.burrito }) })
      .then(r => r.ok ? r.json() : null).then(j => { if (j) setArcade(j) }).catch(() => {})
  }, [hud.over, hud.score, hud.burrito])
  const share = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I caught ${hud.score} of capital on Terra Swap as a ${gameTitle(hud.score)}.${hud.burrito ? ' And I found the burrito. 🌯' : ''} Steady lads. 🫡\n${location.origin}`)}`
  return (
    <div className='terra-party' onClick={e => { if (e.target === e.currentTarget) onClose() }} role='presentation' style={{ cursor: 'default' }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', zIndex: 2, width: 'min(92vw, 640px)', fontFamily: TERRA_FONT }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <div style={{ fontWeight: 700, letterSpacing: '0.14em', fontSize: '0.7rem', color: C.korea }}>DEPLOYING CAPITAL</div>
          <div style={{ fontSize: '0.66rem', color: C.textMuted }}>← → or tap · catch 💰 💎 🐎 · dodge 🌶️ · find the 🌯</div>
          <div style={{ marginLeft: 'auto', fontSize: '0.66rem', color: C.textWhisper }}>best {hud.best}</div>
        </div>
        <canvas ref={canvasRef} width={640} height={420} style={{ width: '100%', height: 'auto', borderRadius: 14, border: `1px solid ${C.dividerStrong}`, display: 'block', touchAction: 'none' }} />
        {hud.over && (
          <div style={{ position: 'absolute', inset: '30px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'rgba(5,7,15,0.92)', border: `1px solid ${C.goldCore}`, borderRadius: 16, padding: '18px 22px', textAlign: 'center', maxWidth: 380 }}>
              <div style={{ fontSize: '0.62rem', letterSpacing: '0.2em', color: C.korea, fontWeight: 800 }}>{hud.lives <= 0 ? 'TOO MUCH KIMCHI' : 'TIME'}</div>
              <div style={{ fontSize: '2.6rem', fontWeight: 700, color: C.goldLit, lineHeight: 1.1 }}>{hud.score}</div>
              <div style={{ color: C.textPrimary, fontWeight: 700 }}>{gameTitle(hud.score)}{hud.score >= hud.best && hud.score > 0 ? ' · new best' : ''}</div>
              <div style={{ color: C.textMuted, fontSize: TEXT.xs.size, marginTop: 6, lineHeight: 1.5 }}>
                {hud.burrito ? '🌯 Burrito accounted for. Finally.' : hud.score < 50 ? 'Not enough minerals. The burrito remains unaccounted for.' : 'The burrito remains unaccounted for.'}<br />Points here buy nothing either. Steady lads.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                <button type='button' onClick={() => { st.current = { ...st.current, x: 320, vx: 0, drops: [], score: 0, lives: 3, start: performance.now(), lastSpawn: performance.now(), over: false, burrito: false, flash: 0 }; setHud(h => ({ ...h, score: 0, lives: 3, t: 30, over: false, burrito: false })); onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('terra:play')), 30) }} style={{ ...primaryBtn, width: 'auto', padding: '0.5rem 1rem' }}>again</button>
                <a href={share} target='_blank' rel='noreferrer' style={{ ...ghostBtn, textDecoration: 'none', color: C.goldLit, borderColor: C.goldCore }}>share on X</a>
                <button type='button' onClick={onClose} style={ghostBtn}>close</button>
              </div>
              {arcade && arcade.top.length > 0 && (
                <div style={{ marginTop: 14, textAlign: 'left', borderTop: `1px solid ${C.divider}`, paddingTop: 10 }}>
                  <div style={{ fontSize: '0.58rem', letterSpacing: '0.18em', color: C.korea, fontWeight: 800, marginBottom: 4 }}>ARCADE · TOP LADS · {arcade.plays} plays</div>
                  {arcade.top.slice(0, 5).map((e, k) => (
                    <div key={`${e.name}-${k}`} style={{ display: 'flex', gap: 10, fontSize: TEXT.xs.size, color: C.textSecondary, padding: '2px 0' }}>
                      <span style={{ width: 16, color: C.textWhisper }}>{k + 1}</span><span style={{ flex: 1 }}>{e.name}{e.burrito ? ' 🌯' : ''}</span><span style={{ color: C.goldLit, fontVariantNumeric: 'tabular-nums' }}>{e.score}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: '0.6rem', color: C.textWhisper, marginTop: 4 }}>🌯 accounted for in the arcade: {arcade.burritos}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sound (opt-in, synthesised, no files) ──────────────────────

type SoundKind = 'swap' | 'party' | 'tick' | 'mutter'
const SOUND_KEY = 'terraswap_sound'
let audio: AudioContext | null = null
function playSound(kind: SoundKind) {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    // One shared context: Kwon mutters several times a second and a fresh
    // context per blip would get throttled and then leak.
    audio ??= new AC()
    if (audio.state === 'suspended') void audio.resume()
    const ctx = audio
    const notes: [number, number, number][] = kind === 'party'
      ? [[523.25, 0, 0.12], [659.25, 0.12, 0.12], [783.99, 0.24, 0.12], [1046.5, 0.36, 0.28]]
      : kind === 'swap' ? [[880, 0, 0.07], [1318.5, 0.08, 0.1]]
      : kind === 'mutter' ? [[220 + Math.random() * 380, 0, 0.045]]
      : [[1760, 0, 0.04]]
    const vol = kind === 'mutter' ? 0.06 : 0.18
    for (const [f, at, dur] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = kind === 'mutter' ? 'square' : 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur)
      o.connect(g); g.connect(ctx.destination)
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur + 0.02)
    }
  } catch { /* no audio, no problem */ }
}
/**
 * Single-key shortcuts vs. typed words: "pylon" starts with p, "steady" has a t.
 * A shortcut only fires if no other key follows within 350 ms, and every typed
 * letter cancels whatever is pending — so a word is just a word.
 */
const keyGate = { t: null as ReturnType<typeof setTimeout> | null }
const deferKey = (fn: () => void) => { if (keyGate.t) clearTimeout(keyGate.t); keyGate.t = setTimeout(() => { keyGate.t = null; fn() }, 350) }
const cancelKey = () => { if (keyGate.t) { clearTimeout(keyGate.t); keyGate.t = null } }

/** Fire from anywhere; the page decides whether sound is on. */
const sound = (kind: SoundKind) => { try { window.dispatchEvent(new CustomEvent('terra:sound', { detail: kind })) } catch { /* ssr */ } }

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [['⌘K', 'search everything'], ['/', 'jump to the amount'], ['f', 'flip the pair'], ['1 · 2 · 3', 'slippage 0.5 / 1 / 3 %'], ['p', 'deploy capital (a game)'], ['k', 'make him say something'], ['t', '2020 mode, twelve seconds'], ['v', 'tv mode · lunatic news 24'], ['m', 'minimap'], ['?', 'this'], ['esc', 'close this']]
  return (
    <div className='terra-party' onClick={onClose} role='presentation' style={{ cursor: 'default' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.surfaceElev, border: `1px solid ${C.dividerStrong}`, borderRadius: 16, padding: '1.2rem 1.4rem',
        minWidth: 280, maxWidth: '90vw', fontFamily: TERRA_FONT, color: C.textPrimary, position: 'relative', zIndex: 2,
      }}>
        <div style={{ fontWeight: 700, letterSpacing: '0.12em', fontSize: '0.7rem', color: C.emberLit, marginBottom: 10 }}>KEYBOARD</div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '5px 0', fontSize: '0.85rem', borderBottom: `1px solid ${C.divider}` }}>
            <kbd style={{ fontFamily: 'inherit', color: C.goldLit, fontWeight: 700 }}>{k}</kbd><span style={{ color: C.textSecondary }}>{v}</span>
          </div>
        ))}
        <div style={{ marginTop: 12, fontSize: '0.72rem', color: C.textWhisper, fontStyle: 'italic' }}>There are more. Find them.</div>
      </div>
    </div>
  )
}

/** Blocks → rough human time at ~6.2s a block. */
function blocksToHuman(blocks: number): string {
  const s = blocks * 6.2
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** The trials: what you have done, what is left. All read off the chain. */
function Trials({ mine, crystal }: { mine: LeaderRowLike | null; crystal: boolean }) {
  const m = mine ?? { swaps: 0, provides: 0, creates: 0, firstHands: 0, early: false }
  const t: { e: string; title: string; done: boolean; prog?: string }[] = [
    { e: '🔁', title: 'Make a swap', done: m.swaps >= 1 },
    { e: '💧', title: 'Add liquidity', done: m.provides >= 1 },
    { e: '🏗️', title: 'Open a pool', done: m.creates >= 1 },
    { e: '🌊', title: 'Be the first hand in a pool', done: m.firstHands >= 1 },
    { e: '🐎', title: 'Move while the Steady Lad window is open', done: m.early },
    { e: '🔁', title: 'Ten swaps', done: m.swaps >= 10, prog: `${Math.min(m.swaps, 10)}/10` },
    { e: '💧', title: 'Three adds', done: m.provides >= 3, prog: `${Math.min(m.provides, 3)}/3` },
    { e: '✦', title: 'Hold a Crystal', done: crystal },
    { e: '🌯', title: 'Account for the burrito (arcade)', done: (() => { try { return localStorage.getItem('terraswap_burrito') === '1' } catch { return false } })() },
  ]
  const n = t.filter(x => x.done).length
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'] }}>
        <Section title='The trials' />
        <span style={{ marginLeft: 'auto', fontFamily: TERRA_FONT, fontWeight: 700, color: n === t.length ? C.success : C.goldLit, fontVariantNumeric: 'tabular-nums' }}>{n}/{t.length}</span>
      </div>
      <div style={{ display: 'grid', gap: 3 }}>
        {t.map(x => (
          <div key={x.title} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: TEXT.sm.size, padding: '4px 6px', borderRadius: 8, background: x.done ? 'rgba(61,220,151,0.07)' : 'transparent' }}>
            <span style={{ width: 18, textAlign: 'center', filter: x.done ? 'none' : 'grayscale(1) opacity(0.45)' }}>{x.e}</span>
            <span style={{ color: x.done ? C.textPrimary : C.textMuted, textDecoration: x.done ? 'none' : 'none', flex: 1 }}>{x.title}</span>
            {x.prog && !x.done && <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper, fontVariantNumeric: 'tabular-nums' }}>{x.prog}</span>}
            <span style={{ color: x.done ? C.success : C.textWhisper, fontWeight: 700 }}>{x.done ? '✓' : '·'}</span>
          </div>
        ))}
      </div>
      {n === t.length && <div style={{ marginTop: 8, fontSize: TEXT.xs.size, color: C.success, fontStyle: 'italic' }}>All of them. Cosmic. There is nothing left to prove, so keep going anyway.</div>}
    </Card>
  )
}
type LeaderRowLike = { swaps: number; provides: number; creates: number; firstHands: number; early: boolean }

// ─── Kwon on the line ───────────────────────────────────────────
//
// A La Linea homage: one gold stroke, a little man who walks the line, stops,
// and says things. Every bubble is a real public post or interview quote of
// his — the receipts are the joke. Parody of a public persona, never of the
// people who got hurt.

const KWON_LINES: { q: string; when: string; pose: 'salute' | 'point' | 'shrug' | 'stand'; fact?: boolean }[] = [
  { q: 'Steady lads, deploying more capital 🫡', when: '@stablekwon · 9 May 2022', pose: 'salute' },
  { q: "I don't debate the poor on Twitter.", when: '@stablekwon · 2021', pose: 'shrug' },
  { q: 'Yeah but your size is not size. $10 short incoming, everyone take cover.', when: '@stablekwon · 2021', pose: 'point' },
  { q: 'By my hand $DAI will die.', when: '@stablekwon · 23 Mar 2022', pose: 'point' },
  { q: "95% are going to die, but there's also entertainment in watching companies die too.", when: 'podcast · May 2022, days before', pose: 'stand' },
  { q: 'Close to announcing a recovery plan for $UST. Hang tight. Stay strong, lunatics.', when: '@stablekwon · 10 May 2022', pose: 'salute' },
  { q: 'Baby Luna 💛 My dearest creation named after my greatest invention.', when: '@stablekwon · 17 Apr 2022', pose: 'stand' },
  { q: 'Took a $1M bet that LUNA would be above $88 a year later. Then made it $11M.', when: 'Mar 2022, vs Algod', pose: 'point', fact: true },
  { q: "I'm making zero effort to hide. I go on walks and malls.", when: '@stablekwon · Sep 2022', pose: 'shrug' },
  { q: '*goes for a walk. to the mall.*', when: 'stage direction', pose: 'stand', fact: true },
  { q: 'The chain outlived the tweets. Steady lads.', when: 'us · today', pose: 'salute', fact: true },
  { q: '*deploys capital. small capital.*', when: 'stage direction', pose: 'salute', fact: true },
  { q: '*builds a pylon. feels powered.*', when: 'stage direction · he named a protocol after one', pose: 'stand', fact: true },
  { q: '*not enough minerals. deploys anyway.*', when: 'stage direction', pose: 'shrug', fact: true },
]

type KwonLineT = (typeof KWON_LINES)[number]

/** What he says when the chain moves. All real lines, matched to the move. */
const KWON_REACTS: Record<string, KwonLineT> = {
  swap:              { q: 'Yeah but your size is not size.', when: 'reacting to a swap · @stablekwon 2021', pose: 'point' },
  provide_liquidity: { q: 'Steady lads, deploying more capital 🫡', when: 'reacting to liquidity · @stablekwon 2022', pose: 'salute' },
  create_pair:       { q: 'Close to announcing a recovery plan. Hang tight.', when: 'reacting to a new pool · @stablekwon 2022', pose: 'stand' },
  withdraw_liquidity:{ q: "I don't debate the poor on Twitter.", when: 'reacting to a withdrawal · @stablekwon 2021', pose: 'shrug' },
}
const POOR_SIGNS = ['one question ser', 'wen recovery plan', 'size?', 'is $DAI ok', 'ser. ser.', 'hang tight how long']

/** Fire from anywhere: make the man on the line say something. */
const kwonSay = (line: KwonLineT) => { try { window.dispatchEvent(new CustomEvent('terra:kwon', { detail: line })) } catch { /* ssr */ } }

function KwonLine({ recent }: { recent?: { id: string; action: string; address: string }[] }) {
  const [x, setX] = useState(10)          // % across the strip
  const [dir, setDir] = useState<1 | -1>(1)
  const [walking, setWalking] = useState(true)
  const [dur, setDur] = useState(4000)
  const [i, setI] = useState(-1)
  const [bubble, setBubble] = useState<KwonLineT | null>(null)
  const [typed, setTyped] = useState('')
  const [poor, setPoor] = useState<{ x: number; sign: string; dir: 1 | -1; say?: string } | null>(null)
  const state = useRef({ cur: 10, d: 1 as 1 | -1, k: -1, cycles: 0, t: null as ReturnType<typeof setTimeout> | null, stop: false })
  const persist = () => { try { const st = state.current; sessionStorage.setItem('terraswap_kwon', JSON.stringify({ cur: st.cur, d: st.d, k: st.k })) } catch { /* private */ } }
  const stageRef = useRef<HTMLDivElement>(null)
  const clicks = useRef<number[]>([])
  const [stageW, setStageW] = useState(640)
  useEffect(() => {
    const m = () => setStageW(stageRef.current?.clientWidth ?? 640)
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Typewriter: the bubble types itself out, La Linea muttering style.
  useEffect(() => {
    if (!bubble) { setTyped(''); return }
    let n = 0; setTyped(''); speak(bubble.q)
    const iv = setInterval(() => { n += 1; setTyped(bubble.q.slice(0, n)); if (n % 3 === 0 && bubble.q[n - 1] !== ' ') sound('mutter'); if (n >= bubble.q.length) clearInterval(iv) }, 22)
    return () => clearInterval(iv)
  }, [bubble])

  const clear = () => { const st = state.current; if (st.t) clearTimeout(st.t) }
  const walk = () => {
    const st = state.current; if (st.stop) return
    let target = st.cur + st.d * (18 + Math.random() * 30)
    if (target > 88) { st.d = -1; target = st.cur - (18 + Math.random() * 30) }
    if (target < 12) { st.d = 1; target = st.cur + (18 + Math.random() * 30) }
    target = Math.max(12, Math.min(88, target))
    const ms = Math.abs(target - st.cur) * 55
    setDir(st.d); setDur(ms); setWalking(true); setBubble(null); setPoor(null); setX(target); st.cur = target; persist()
    st.t = setTimeout(talk, ms + 150)
  }
  const talk = () => {
    const st = state.current; if (st.stop) return
    st.cycles += 1
    // Every third stop, the poor arrive with a sign. He does not debate them.
    if (st.cycles % 3 === 0) {
      const fromLeft = st.cur > 50
      setPoor({ x: fromLeft ? -6 : 106, sign: POOR_SIGNS[Math.floor(Math.random() * POOR_SIGNS.length)], dir: fromLeft ? 1 : -1 })
      setTimeout(() => setPoor(p => p ? { ...p, x: fromLeft ? st.cur - 14 : st.cur + 14 } : p), 60)
      setDir(fromLeft ? -1 : 1); setWalking(false); setI(1); setBubble(null)
      // setup, then punchline: the poor say 'ser.', then he does not debate them.
      setTimeout(() => setPoor(p => p ? { ...p, say: 'ser.' } : p), 1500)
      setTimeout(() => { setBubble(KWON_LINES[1]); setPoor(p => p ? { ...p, say: undefined } : p) }, 2500)
      st.t = setTimeout(() => { st.d = fromLeft ? 1 : -1; walk() }, 7000)
      return
    }
    st.k = (st.k + 1) % KWON_LINES.length
    // Late in Seoul, he notices.
    const kst = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()))
    const night = kst >= 0 && kst < 5 && Math.random() < 0.35
    const line: KwonLineT = night ? { q: `*it is ${kst === 0 ? 12 : kst}am in seoul. someone is seeding a pool.*`, when: 'stage direction · seoul time', pose: 'stand', fact: true } : KWON_LINES[st.k]
    setI(night ? -1 : st.k); setWalking(false); setBubble(line); persist()
    st.t = setTimeout(walk, 4200 + Math.min(2500, line.q.length * 22))
  }
  const say = (line: KwonLineT, hold = 4600) => {
    const st = state.current; clear()
    setWalking(false); setBubble(line); setI(-1)
    st.t = setTimeout(walk, hold)
  }

  useEffect(() => {
    const st = state.current; st.stop = false
    if (reduced) { setWalking(false); setX(50); setI(0); setBubble(KWON_LINES[0]); const iv = setInterval(() => setI(k => { const n = (k + 1) % KWON_LINES.length; setBubble(KWON_LINES[n]); return n }), 5000); return () => clearInterval(iv) }
    // Pick up where he left off, if this tab has seen him before.
    try { const saved = JSON.parse(sessionStorage.getItem('terraswap_kwon') || 'null'); if (saved && typeof saved.cur === 'number') { st.cur = Math.max(12, Math.min(88, saved.cur)); st.d = saved.d === -1 ? -1 : 1; st.k = Number.isInteger(saved.k) ? saved.k : -1; setX(st.cur); setDir(st.d) } } catch { /* fresh */ }
    st.t = setTimeout(walk, 600)
    const onSay = (e: Event) => say((e as CustomEvent<KwonLineT>).detail)
    window.addEventListener('terra:kwon', onSay)
    return () => { st.stop = true; clear(); window.removeEventListener('terra:kwon', onSay) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  // React to the chain: a new move on the wire gets the matching line.
  const seen = useRef<string | null>(null)
  useEffect(() => {
    const top = recent?.[0]
    if (!top) return
    if (seen.current === null) { seen.current = top.id; return }
    if (top.id === seen.current) return
    seen.current = top.id
    const r = KWON_REACTS[top.action]
    if (r && !reduced) say({ ...r, when: `${r.when} · ${top.address.slice(0, 9)}…${top.address.slice(-4)}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent])

  const pose = walking ? 'walk' : (bubble?.pose ?? 'stand')
  // A bubble must never be clipped: clamp its centre so the whole box stays
  // inside the stage, and aim the tail at him from wherever it ended up.
  const bw = Math.min(320, Math.max(180, stageW * 0.6))
  const manPx = (x / 100) * stageW
  const centre = Math.max(bw / 2 + 6, Math.min(stageW - bw / 2 - 6, manPx))
  const tail = Math.max(16, Math.min(bw - 16, manPx - (centre - bw / 2)))
  return (
    <div id='kwon-line' style={{ marginTop: SPACE['5'] }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'], marginBottom: 4 }}>
        <div style={{ fontFamily: TERRA_FONT, fontWeight: 700, color: C.textPrimary, letterSpacing: '-0.01em' }}>Kwon on the line</div>
        <div style={{ fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.korea, fontWeight: 800 }}>things he actually said</div>
        <button type='button' onClick={e => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('terra:play')) }} style={{ ...ghostBtn, padding: '2px 9px', fontSize: '0.62rem', color: C.goldLit, borderColor: C.goldCore }} title='press p'>▶ play</button>
        <div style={{ marginLeft: 'auto', fontSize: '0.62rem', color: C.textWhisper, fontFamily: TERRA_FONT }}>{i >= 0 ? `${i + 1} / ${KWON_LINES.length}` : bubble ? 'live' : ''}</div>
      </div>
      <div
        ref={stageRef}
        className='kwon-stage'
        style={{ background: seoulSky() }}
        onClick={() => {
          // Click him too much and, like any StarCraft unit, he has opinions about it.
          const now = Date.now(); clicks.current = [...clicks.current.filter(t => now - t < 3000), now]
          const n = clicks.current.length
          if (n >= 4) {
            const ANNOYED = ['*stop clicking.*', '*i said stop.*', "*i don't debate the poor. or the clickers.*", '*your click is not click.*', '*…steady. lads. stop.*', '*fine. deploying more capital. happy?*', '*what.*']
            say({ q: ANNOYED[Math.min(n - 4, ANNOYED.length - 1)], when: `unit response · clicked ${n}×`, pose: 'shrug', fact: true }, 2600); setI(-1); return
          }
          const k = Math.floor(Math.random() * KWON_LINES.length); say(KWON_LINES[k]); setI(k)
        }}
        title='click him. he has more.'
      >
        {bubble && (
          <div className='kwon-bubble' style={{ left: centre, width: bw, transitionDuration: `${dur}ms`, ['--tail' as string]: `${tail}px` }}>
            <div className={bubble.fact ? 'kwon-bubble-fact' : undefined}>{typed}<span className='kwon-caret'>▍</span></div>
            <div className='kwon-bubble-when'>{bubble.when}</div>
          </div>
        )}
        {poor && (
          <div className='kwon-poor' style={{ left: `${poor.x}%`, transform: `translateX(-50%) scaleX(${poor.dir})` }}>
            <div className='kwon-sign' style={{ transform: `scaleX(${poor.dir})` }}>{poor.sign}</div>
            {poor.say && <div className='kwon-poor-say'><span style={{ display: 'inline-block', transform: `scaleX(${poor.dir})` }}>{poor.say}</span></div>}
            <svg viewBox='0 0 60 92' width='44' height='68' fill='none' stroke='#9a927f' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
              <path className='kwon-leg-l' d='M30 60 L22 90' /><path className='kwon-leg-r' d='M30 60 L38 90' />
              <path d='M30 60 L30 38' /><path d='M30 42 L42 30 L42 14' /><path d='M30 42 L20 56' />
              <circle cx='31' cy='24' r='10' /><path d='M26 22 L28 22 M34 22 L36 22' /><path d='M27 29 Q31 27 35 29' />
            </svg>
          </div>
        )}
        <div className={`kwon-man kwon-pose-${pose}`} style={{ left: `${x}%`, transitionDuration: `${dur}ms`, transform: `translateX(-50%) scaleX(${dir})` }}>
          <svg viewBox='0 0 60 92' width='60' height='92' fill='none' stroke='#ffd83d' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
            <path className='kwon-leg-l' d='M30 60 L22 90' />
            <path className='kwon-leg-r' d='M30 60 L38 90' />
            <path d='M30 60 L30 38' />
            <path d='M22 44 Q30 36 38 44' />
            <path className='kwon-arm-b' d='M30 42 L20 56' />
            <path className='kwon-arm-f' d='M30 42 L41 54' />
            <circle cx='31' cy='24' r='10' />
            <path d='M23 18 L20 12 M28 15 L27 9 M34 15 L36 9' />
            <circle cx='27' cy='24' r='3.6' /><circle cx='35.5' cy='24' r='3.6' /><path d='M30.6 24 L31.9 24' />
            <path d='M40 25 L44 28 L40 30' />
          </svg>
          <div className='kwon-badge'>🫡</div>
        </div>
        <div className='kwon-ground' />
      </div>
      <div style={{ fontSize: '0.62rem', color: C.textWhisper, marginTop: 6, lineHeight: 1.5 }}>
        Parody. Every line is his own public post or interview, dated. He reacts to real moves on the wire. Click him for more.
      </div>
    </div>
  )
}

/** Credits. Everyone on the board, rolling, forever. */
function Credits({ board }: { board: BoardResponse | null }) {
  const rows = board?.rows ?? []
  const [burritos, setBurritos] = useState<number | null>(null)
  useEffect(() => { fetch('/api/dex-arcade').then(r => r.ok ? r.json() : null).then(j => { if (j) setBurritos(j.burritos ?? 0) }).catch(() => {}) }, [])
  if (!rows.length) return null
  const cast = [...rows, ...rows]
  return (
    <div style={{ marginTop: SPACE['5'], textAlign: 'center', fontFamily: TERRA_FONT }}>
      <div style={{ fontSize: '0.6rem', letterSpacing: '0.34em', color: C.korea, fontWeight: 800, textTransform: 'uppercase' }}>Starring</div>
      <div className='terra-credits'>
        <div className='terra-credits-roll' style={{ animationDuration: `${Math.max(14, rows.length * 3.2)}s` }}>
          {cast.map((r, k) => (
            <div key={`${r.address}-${k}`} style={{ padding: '6px 0' }}>
              <div style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}><WalletName address={r.address} head={8} tail={4} /> <span>{r.badges.map(b => b.emoji).join('')}</span></div>
              <div style={{ color: C.textWhisper, fontSize: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase' }}>as {rankTitle(r.points)} · #{r.rank}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textWhisper, lineHeight: 1.9 }}>
        directed by nobody · produced by gas fees · shot on phoenix-1<br />
        no animals were harmed · one burrito unaccounted for{burritos ? ` · ${burritos} accounted for in the arcade` : ''}
      </div>
    </div>
  )
}

// ─── Fun toolkit ────────────────────────────────────────────────

/**
 * Explorer links. Terra Finder's shell is still up but its backend is gone —
 * a tx page spins on "Searching transaction" forever (checked 2026-09-08).
 * Terrascope resolves phoenix-1 fully, memo and decoded swap included.
 */
const finderTx = (hash: string) => `https://terrasco.pe/mainnet/tx/${hash}`

interface Party { emoji: string; title: string; sub: string; tone?: 'red' | 'moon' }

/** Full-screen moment for the things worth a moment: builder, first hand, konami. */
function Celebrate({ party, onDone }: { party: Party; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t) }, [party, onDone])
  const horses = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    left: (i * 37 + 11) % 100, delay: (i * 131) % 900, dur: 1800 + (i * 97) % 900, size: 18 + (i * 7) % 16,
  })), [])
  return (
    <div className={`terra-party${party.tone ? ` terra-party-${party.tone}` : ''}`} onClick={onDone} role='presentation'>
      {horses.map((h, i) => (
        <span key={i} className='terra-party-horse' style={{ left: `${h.left}%`, animationDelay: `${h.delay}ms`, animationDuration: `${h.dur}ms`, fontSize: h.size }}>{party.tone === 'red' ? '🌶️' : party.tone === 'moon' ? '🌕' : '🐎'}</span>
      ))}
      <div className='terra-party-inner'>
        <div className='terra-party-emoji'>{party.emoji}</div>
        <div className='terra-party-title' style={{ fontFamily: TERRA_FONT }}>{party.title}</div>
        <div className='terra-party-sub'>{party.sub}</div>
      </div>
    </div>
  )
}

function Toast({ msg, href, onDone }: { msg: string; href?: string; onDone: () => void }) {
  // Re-armed on every new message: a toast that replaces another gets its
  // full time, instead of dying on the previous one's clock.
  useEffect(() => { const t = setTimeout(onDone, 5200); return () => clearTimeout(t) }, [msg, href, onDone])
  return (
    <div className='terra-toast' role='status'>
      <span>{msg}</span>
      {href && <a href={href} target='_blank' rel='noreferrer' style={{ color: C.goldLit, fontWeight: 700, marginLeft: 10, whiteSpace: 'nowrap' }}>View on Terrascope →</a>}
    </div>
  )
}

/** ↑↑↓↓←→←→BA. You know the code. */
function useKonami(cb: () => void) {
  useEffect(() => {
    const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']
    let i = 0
    const on = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      i = k === seq[i] ? i + 1 : (k === seq[0] ? 1 : 0)
      if (i === seq.length) { i = 0; cb() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [cb])
}

/** Amount field easter eggs. Small, and only for the ones who type them. */
function amountEgg(amount: string, fromLabel: string): string | null {
  const a = amount.trim()
  if (!a) return null
  if (a === '1337') return 'leet.'
  if (a === '69' || a === '420') return 'nice.'
  if (a === '42') return 'the answer.'
  if (a === '888') return 'lucky number. steady.'
  if (a === '1' && fromLabel === 'LUNA') return 'one LUNA. respect.'
  if (a === '2020') return 'the year. we remember.'
  if (/^0\.0+1$/.test(a)) return 'dust. but dust that is written down.'
  return null
}

// ─── Price chart ────────────────────────────────────────────────

function PriceChart({ pool, from, to, compact }: { pool: PoolView; from: KnownToken; to: KnownToken; compact?: boolean }) {
  const [data, setData] = useState<PricesResponse | null>(null)
  useEffect(() => {
    let alive = true
    setData(null)
    fetch(`/api/dex-prices?pair=${pool.contract_addr}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (alive && j) setData(j) })
    return () => { alive = false }
  }, [pool.contract_addr])

  // Everything is displayed as "to per from" (1 from = N to). The API returns
  // quote-per-base with base = pool.tokens[0]; invert when the user's `from`
  // is the quote side. Live reserve spot is appended as the freshest point.
  const fromIsBase = sameAsset(from.info, pool.tokens[0].info)
  const spotToPerFrom = fromIsBase ? pool.price : (pool.price > 0 ? 1 / pool.price : 0)

  // Exchange-style: the number blinks green or red the moment it moves.
  const prevSpot = useRef(spotToPerFrom)
  const lastDip = useRef(0)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    const prev = prevSpot.current
    prevSpot.current = spotToPerFrom
    if (!(prev > 0) || !(spotToPerFrom > 0) || prev === spotToPerFrom) return
    setFlash(spotToPerFrom > prev ? 'up' : 'down')
    if (spotToPerFrom < prev && Date.now() - lastDip.current > 60_000) { lastDip.current = Date.now(); kwonSay({ q: 'Stay strong, lunatics.', when: '@stablekwon · 10 May 2022 · the price just dipped', pose: 'salute' }) }
    const t = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(t)
  }, [spotToPerFrom])

  const series = useMemo(() => {
    const raw = (data?.points ?? []).map(pt => (fromIsBase ? pt.p : (pt.p > 0 ? 1 / pt.p : 0))).filter(n => Number.isFinite(n) && n > 0)
    if (spotToPerFrom > 0) raw.push(spotToPerFrom)
    return raw
  }, [data, fromIsBase, spotToPerFrom])

  const change = series.length >= 2 ? (series[series.length - 1] - series[0]) / series[0] * 100 : null
  const up = (change ?? 0) >= 0
  const stroke = change === null ? C.emberLit : up ? C.success : C.alert

  // Sparkline path
  const W = 300, H = 56, PAD = 3
  const path = useMemo(() => {
    if (series.length < 2) return ''
    const min = Math.min(...series), max = Math.max(...series), span = max - min || 1
    return series.map((v, i) => {
      const x = PAD + (i / (series.length - 1)) * (W - PAD * 2)
      const y = H - PAD - ((v - min) / span) * (H - PAD * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [series])


  return (
    <div className={compact ? 'terra-pricecompact' : undefined} style={{
      background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 12,
      padding: compact ? `6px ${SPACE['3']}px` : `${SPACE['2']}px ${SPACE['3']}px`, marginBottom: SPACE['3'],
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE['2'] }}>
        <div>
          <div style={{ fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted }}>
            1 {from.label} =
          </div>
          <div className={flash ? `terra-flash-${flash}` : undefined} style={{ fontFamily: TERRA_FONT, fontWeight: 700, fontSize: TEXT.lg.size, color: C.textPrimary, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {spotToPerFrom > 0 ? `${fmtPrice(spotToPerFrom)} ${to.label}` : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {change !== null && (
            <div style={{ fontSize: TEXT.sm.size, fontWeight: 700, color: stroke, fontVariantNumeric: 'tabular-nums' }}>
              {up ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
            </div>
          )}
          <div style={{ fontSize: '0.58rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textWhisper }}>
            {data
              ? `${data.trades} trade${data.trades === 1 ? '' : 's'}${data.volumeQuote > 0 ? ` · vol ${data.volumeQuote.toLocaleString('en-US', { maximumFractionDigits: data.volumeQuote >= 100 ? 0 : 4 })} ${pool.tokens[1].label}` : ''}`
              : 'loading'}
          </div>
        </div>
      </div>
      {!compact && (series.length >= 2 ? (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' style={{ width: '100%', height: 56, marginTop: 6, display: 'block' }}>
          <defs>
            <linearGradient id={`pxfill-${pool.contract_addr.slice(-6)}`} x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={stroke} stopOpacity='0.28' />
              <stop offset='100%' stopColor={stroke} stopOpacity='0' />
            </linearGradient>
          </defs>
          <path d={`${path} L${W - PAD},${H} L${PAD},${H} Z`} fill={`url(#pxfill-${pool.contract_addr.slice(-6)})`} stroke='none' />
          <path d={path} fill='none' stroke={stroke} strokeWidth='2' vectorEffect='non-scaling-stroke' strokeLinejoin='round' strokeLinecap='round' />
        </svg>
      ) : (
        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 8, textAlign: 'center', padding: '8px 0' }}>
          Not enough trades for a chart yet. Be the print that starts it.
        </div>
      ))}
      {!compact && data && data.tape.length > 0 && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.divider}`, paddingTop: 6 }}>
          <div style={{ fontSize: '0.58rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textWhisper, marginBottom: 4 }}>The tape · live from the chain</div>
          {data.tape.slice(0, 3).map(r => {
            // Tape is base-oriented; base = pool.tokens[0]. Show it the way this trader reads it.
            const bt = pool.tokens[0], qt = pool.tokens[1]
            const buy = r.side === 'buy'
            return (
              <a key={r.tx} href={finderTx(r.tx)} target='_blank' rel='noreferrer' className='terra-tape-row' style={{
                display: 'flex', gap: 8, alignItems: 'baseline', fontSize: '0.7rem', textDecoration: 'none',
                color: C.textMuted, fontVariantNumeric: 'tabular-nums', padding: '2px 0',
              }}>
                <span style={{ color: buy ? C.success : C.alert, fontWeight: 700, width: 14 }}>{buy ? '▲' : '▼'}</span>
                {/* fmtAmount, not two decimals: a PAXG or wBTC leg is usually well under 0.01 and printed as "0". */}
                <span style={{ color: C.textSecondary }}>{buy ? 'bought' : 'sold'} {fmtAmount(r.base)} {bt.label}</span>
                <span>for {fmtAmount(r.quote)} {qt.label}</span>
                <span style={{ marginLeft: 'auto', color: C.textWhisper }}>#{r.h.toLocaleString('en-US')}</span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** How much a pool has moved over its last trades (lib/slippage recentMovePct), read at most once a minute per pool. */
const moveCache = new Map<string, { at: number; pct: Promise<number> }>()
function poolMovePct(pair: string): Promise<number> {
  const hit = moveCache.get(pair)
  if (hit && Date.now() - hit.at < 60_000) return hit.pct
  const pct = fetch(`/api/dex-prices?pair=${pair}`)
    .then(r => (r.ok ? r.json() : null))
    .then((j: PricesResponse | null) => recentMovePct(j?.points ?? []))
    .catch(() => 0)
  moveCache.set(pair, { at: Date.now(), pct })
  return pct
}

/**
 * The route drawn: for each part of the trade, the tokens it passes through
 * and the site whose pool each hop uses, with what that hop returns at the
 * quote. A split shows both paths with their share of the amount. Hovering a
 * hop names the pool, its fee and its liquidity.
 */
function RouteMap({ parts }: { parts: TradePlan['parts'] }) {
  const { t } = useLang()
  const first = Math.round(parts[0].share * 100)
  return (
    <div style={{ display: 'grid', gap: 6, padding: '2px 0 6px' }}>
      <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{t(parts.length > 1 ? 'Split over two paths that share no pool' : 'Route')}</div>
      {parts.map((part, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, fontSize: TEXT.xs.size }}>
          {parts.length > 1 && <span style={{ color: C.goldLit, fontWeight: 700, minWidth: 34 }}>{i === 0 ? first : 100 - first}%</span>}
          <RouteToken t={part.quote.legs[0].offer} micro={part.quote.legs[0].offerMicro} />
          {part.quote.legs.map((l, k) => (
            <Fragment key={k}>
              <span title={`${l.pool.label} · ${poolFeeTextFor(l.pool)}${l.pool.tvlUsd != null ? ` · $${Math.round(l.pool.tvlUsd).toLocaleString('en-US')} liquidity` : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: C.textWhisper, cursor: 'help' }}>
                <span aria-hidden>→</span>
                <span style={{ fontSize: '0.56rem', letterSpacing: '0.08em', textTransform: 'uppercase', border: `1px solid ${C.divider}`, borderRadius: 6, padding: '1px 5px', color: C.textMuted, whiteSpace: 'nowrap' }}>{VENUE_NAME[l.pool.venue]}</span>
                <span aria-hidden>→</span>
              </span>
              <RouteToken t={l.ask} micro={l.returnMicro} />
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

function RouteToken({ t, micro }: { t: KnownToken; micro: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.divider}`, borderRadius: 999, padding: '2px 8px 2px 3px', color: C.textSecondary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      <TokenIcon label={t.label} size={16} />{fmtAmount(Number(micro) / 10 ** t.decimals)} {t.label}
    </span>
  )
}

/** How large this trade could be before its price moves (lib/depth, /api/depth), read once per pair and kept for the visit. */
const depthCache = new Map<string, Promise<DepthResponse | null>>()
const sizeText = (usd: number) => (usd >= 10_000 ? `$${Math.round(usd / 1000).toLocaleString('en-US')}k` : usd >= 1000 ? `$${(usd / 1000).toFixed(1)}k` : `$${Math.round(usd)}`)

function SizeRow({ from, to, amount }: { from: KnownToken; to: KnownToken; amount: string }) {
  const { t } = useLang()
  const { px } = useTokenData()
  const [d, setD] = useState<DepthResponse | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    setD(null)
    const key = `${from.key}|${to.key}`
    let job = depthCache.get(key)
    if (!job) {
      job = fetch(`/api/depth?from=${encodeURIComponent(from.key)}&to=${encodeURIComponent(to.key)}`)
        .then(r => (r.ok ? (r.json() as Promise<DepthResponse>) : null))
        .catch(() => null)
        .then(j => { if (!j) depthCache.delete(key); return j })
      depthCache.set(key, job)
    }
    job.then(j => { if (alive) setD(j) })
    return () => { alive = false }
  }, [from.key, to.key])
  if (!d || d.kind !== 'route') return null
  const last = d.points[d.points.length - 1]?.usd ?? 0
  const marks = d.marks.map(m => t('{pct}% at {size}', {
    pct: m.pct,
    size: m.usd == null ? t('over {size}', { size: sizeText(last) }) : m.below ? t('under {size}', { size: sizeText(Math.max(m.usd, 1)) }) : t('about {size}', { size: sizeText(m.usd) }),
  }))
  const price = px?.[assetId(from.info)]
  const atUsd = price && Number(amount) > 0 ? Number(amount) * price : null
  return (
    <div>
      <button type='button' onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ ...rowStyle, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{t('Size before the price moves')} {open ? '▴' : '▾'}</span>
        <span style={{ color: C.textSecondary, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{marks.join(' · ')}</span>
      </button>
      {open && <div style={{ padding: '2px 0 6px' }}><DepthCurve depth={d} atUsd={atUsd} height={80} /></div>}
    </div>
  )
}

// ─── Swap tab ───────────────────────────────────────────────────

/** A pair and a size handed to the swap panel from somewhere else on the page. */
export interface SwapPreset { fromId: string; toId: string; amount: string; n: number }

function SwapPanel({ pools, venuePools, crystal, feeBps, poolFeeBps, onDone, arbs, preset, onTakeArb, onNext }: {
  pools: PoolView[]; venuePools: PoolView[]; crystal: boolean; feeBps: number; poolFeeBps: number; onDone: () => void
  arbs?: ArbPlan[]; preset?: SwapPreset | null; onTakeArb?: (p: ArbPlan) => void
  /** after a swap lands: open History, or Pools filtered to the token that arrived */
  onNext?: (where: 'history' | 'pools', tokenKey?: string) => void
}) {
  const me = useMyAddress()
  const swap = useTradeSwap()
  const tradable = useMemo(() => pools.filter(p => !p.empty), [pools])
  // Both sites' pools. A swap takes whichever path pays best (lib/route).
  const routePools = useMemo(() => [...tradable, ...venuePools.filter(p => !p.empty)], [tradable, venuePools])
  const tokens = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of routePools) for (const t of p.tokens) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [routePools])

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  /** 'in': what to pay is typed. 'out': what should arrive is typed, and what to pay is worked out for it (lib/route quoteExactOut). */
  const [mode, setMode] = useState<'in' | 'out'>('in')
  const [receive, setReceive] = useState('')
  const [solving, setSolving] = useState(false)
  const [noSolve, setNoSolve] = useState(false)
  /** Bumped when the price moved under a "receive exactly" swap, so what to pay is worked out again. */
  const [solveTick, setSolveTick] = useState(0)
  const { lang, t } = useLang()
  const [slippage, setSlippage] = useState('auto')
  const [advice, setAdvice] = useState<SlipAdvice | null>(null)
  const [balance, setBalance] = useState('0')
  const [err, setErr] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [quip, setQuip] = useState('')
  const [holding, setHolding] = useState(false)
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0)
  const [receipt, setReceipt] = useState<{ from: string; to: string; amtIn: string; amtOut: string; fee: string; tx: string; height?: number; route?: string } | null>(null)
  const holdT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  // Swap prices the trade again before the wallet opens; when it got worse, the new number is shown first (go).
  const [checking, setChecking] = useState(false)
  const [moved, setMoved] = useState<{ was: string; now: string } | null>(null)
  const [netFee, setNetFee] = useState<string | null>(null)
  /** The chain's own simulation of these exact messages says they would fail right now, and why (lib/gas estimateFee). */
  const [simFail, setSimFail] = useState<{ text: string; fix: TxFix } | null>(null)
  /** What would fix the swap that just failed. */
  const [failFix, setFailFix] = useState<TxFix>(null)
  const retryAfterSlip = useRef(false)
  const [copied, setCopied] = useState(false)

  /* The receive side a preset or a shared link asked for, parked until `toOptions` has been rebuilt around the new pay side. */
  const [wantTo, setWantTo] = useState('')
  /* The first pair is chosen once: by a shared link (?from=LUNA&to=SOLID&amount=100, see share below) when
     there is one, otherwise by the first impression. One effect and a ref, so nothing can choose after it,
     not even React running mount effects twice in development. The other site's pools arrive a little after
     this site's, so a linked token only they carry is waited for. */
  const firstPair = useRef(false)
  useEffect(() => {
    if (firstPair.current || fromId || !tokens.length) return
    const q = new URLSearchParams(window.location.search)
    const wantFrom = q.get('from'), wantTok = q.get('to')
    const find = (v: string | null) => (v ? tokens.find(t => t.key.toLowerCase() === v.toLowerCase() || assetId(t.info) === v) : undefined)
    const f = find(wantFrom), t = find(wantTok)
    if (wantFrom && (!f || (wantTok && !t)) && venuePools.length === 0) return
    firstPair.current = true
    if (f) {
      setFromId(assetId(f.info))
      const amt = q.get('amount') ?? ''
      if (/^\d{1,12}(\.\d{1,8})?$/.test(amt)) setAmount(amt)
      // ?receive=5: a link that asks for an amount to arrive, like a payment request.
      const rcv = q.get('receive') ?? ''
      if (t && /^\d{1,12}(\.\d{1,8})?$/.test(rcv) && Number(rcv) > 0) { setMode('out'); setReceive(rcv) }
      if (t) setWantTo(assetId(t.info))
      return
    }
    // First impression: the deepest pool, LUNA on the pay side when it has one.
    const deepest = [...tradable].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]
    const pick = deepest ? (deepest.tokens.find(x => x.key === 'LUNA') ?? deepest.tokens[0]) : tokens[0]
    setFromId(assetId(pick.info))
  }, [tokens, fromId, tradable, venuePools.length])

  const from = tokens.find(t => assetId(t.info) === fromId) ?? null
  // Anything reachable in one or two hops across both sites.
  const toOptions = useMemo(() => (from ? reachable(routePools, from, tokens) : []), [from, routePools, tokens])
  useEffect(() => {
    if (toOptions.find(t => assetId(t.info) === toId)) return
    // Default to the other side of the deepest pool the pay token sits in, so
    // LUNA opens on LUNA/USDC rather than on whichever token sorts first.
    const deepest = from
      ? tradable.filter(p => p.tokens.some(t => sameAsset(t.info, from.info))).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]
      : undefined
    const other = deepest && from ? deepest.tokens.find(t => !sameAsset(t.info, from.info)) : undefined
    const pick = (other && toOptions.find(t => sameAsset(t.info, other.info))) || toOptions[0]
    setToId(pick ? assetId(pick.info) : '')
  }, [toOptions, toId, from, tradable])

  /* A preset arrives as a pair plus a size. The pay side and the amount land
     immediately; the receive side has to wait one pass for `toOptions` to be
     rebuilt around the new pay side, so it is parked here until it fits. */
  const presetSeen = useRef(0)
  useEffect(() => {
    if (!preset || preset.n === presetSeen.current) return
    presetSeen.current = preset.n
    setFromId(preset.fromId); setAmount(preset.amount); setWantTo(preset.toId)
  }, [preset])
  useEffect(() => {
    if (wantTo && toOptions.some(t => assetId(t.info) === wantTo)) { setToId(wantTo); setWantTo('') }
  }, [wantTo, toOptions])

  const to = toOptions.find(t => assetId(t.info) === toId) ?? null
  // The deepest direct pool for the pair on either site. The chart, the tab
  // title and the fee line read from it; the trade itself follows the route.
  const pool = useMemo(() => {
    if (!from || !to) return null
    const both = routePools.filter(p => p.tokens.some(t => sameAsset(t.info, from.info)) && p.tokens.some(t => sameAsset(t.info, to.info)))
    return both.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0] ?? null
  }, [from, to, routePools])

  useEffect(() => {
    if (!me || !from) { setBalance('0'); return }
    queryBalance(me, from.info).then(setBalance)
  }, [me, from, txHash])

  const micro = from ? toMicro(amount, from.decimals) : null
  const debounced = useDebounced(micro, 350)
  const receiveMicro = to && mode === 'out' ? toMicro(receive, to.decimals) : null
  const receiveDebounced = useDebounced(receiveMicro, 450)
  // Auto follows the route (lib/slippage, advice below); a number picked by hand is used as it is.
  const slipPct = slippage === 'auto' ? advice?.pct ?? 1 : Number(slippage)
  const slip = Math.min(0.5, Math.max(0.001, slipPct / 100 || 0.01))
  // Quote every path on both sites, and a split over two paths when that pays.
  // A background refresh of the pools re-quotes quietly; only a new pair or
  // amount clears the number shown.
  const [quotes, setQuotes] = useState<Quotes | null>(null)
  const quoteKey = useRef('')
  useEffect(() => {
    let alive = true
    const key = `${fromId}|${toId}|${debounced ?? ''}`
    if (key !== quoteKey.current) { quoteKey.current = key; setQuotes(null); setMoved(null) }
    if (!from || !to || !debounced || debounced === '0') return
    quoteBest(routePools, from, to, debounced, HOME_VENUE, { slip, split: true }).then(q => { if (alive) setQuotes(q) }).catch(() => {})
    return () => { alive = false }
  }, [routePools, from, to, fromId, toId, debounced, slip])
  const route = quotes?.best ?? null

  // Receive exactly: when what should arrive is typed, work out what to pay and put it in the pay field, where
  // the quote above prices it as it prices any amount. Rounded up to eight decimals, so the minimum still covers it.
  useEffect(() => {
    if (mode !== 'out') return
    setNoSolve(false)
    if (!from || !to || !receiveDebounced || receiveDebounced === '0') { setSolving(false); if (!receive.trim()) setAmount(''); return }
    let alive = true
    setSolving(true)
    quoteExactOut(routePools, from, to, receiveDebounced, HOME_VENUE, { slip })
      .then(x => {
        if (!alive) return
        if (!x) { setNoSolve(true); setAmount(''); return }
        const unit = BigInt(`1${'0'.repeat(Math.max(0, from.decimals - 8))}`)
        const up = ((BigInt(x.amountMicro) + unit - BigInt(1)) / unit) * unit
        setAmount(plainAmount(up.toString(), from.decimals))
      })
      .catch(() => { if (alive) setNoSolve(true) })
      .finally(() => { if (alive) setSolving(false) })
    return () => { alive = false }
  // Not on every background refresh of the pools: the quote above re-prices with fresh pools anyway.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, receiveDebounced, fromId, toId, slip, solveTick])

  const fee = '0'
  const insufficient = !!micro && BigInt(micro) + BigInt(fee) > BigInt(balance || '0')
  // How a trade is signed decides what arrives: through Astroport's router the quote itself, as separate swaps a little less.
  const trade: TradePlan | null = useMemo(() => (quotes?.best ? planTrade(quotes.split ?? [{ quote: quotes.best, share: 1 }], slip) : null), [quotes, slip])
  const impact = trade ? trade.impactPct : 0
  const sim = trade ? { ret: trade.expectedOut } : null
  const minOut = trade?.minOut ?? '0'
  const perLeg = !!trade && trade.parts.some(p => p.plan.kind === 'legs' && p.quote.legs.length > 1)
  // The quote must be for the amount on screen, not the one before the debounce caught up.
  const canSwap = !!me && !!route && !!trade && !!from && !!to && !!micro && micro === quotes?.amountMicro
    && trade.parts.every(p => p.plan.legs.every(l => l.offerAmount !== '0') && p.plan.minOut !== '0') && minOut !== '0' && !insufficient && !swap.isLoading && !checking
    // Receive exactly signs only a trade whose minimum covers what was asked for.
    && (mode !== 'out' || (!solving && !!receiveMicro && receiveMicro !== '0' && BigInt(minOut) >= BigInt(receiveMicro)))

  // The network fee the wallet will propose, from the chain's own simulation of these exact messages (lib/gas).
  // It needs the wallet's balances, so it is only shown with a wallet connected.
  const tradeRef = useRef(trade)
  tradeRef.current = trade
  const feeKey = me && trade && micro && micro === quotes?.amountMicro && !insufficient && minOut !== '0' ? `${me}|${micro}|${slip}|${tradeText(trade.parts)}` : ''
  useEffect(() => {
    setNetFee(null); setSimFail(null)
    const t = tradeRef.current
    if (!feeKey || !t) return
    let alive = true
    const timer = setTimeout(() => {
      estimateFee(me, tradeMsgs(me, t, slip)).then(f => { if (alive) setNetFee(f.uluna) }).catch(e => { if (alive) setSimFail(explainTx(e)) })
    }, 400)
    return () => { alive = false; clearTimeout(timer) }
  }, [feeKey, me, slip])

  // Auto slippage reads how the route's pools have been moving and how deep they are. The last advice stays until a new route is priced.
  const routeKey = trade ? Array.from(new Set(trade.parts.flatMap(p => p.quote.legs.map(l => l.pool.contract_addr)))).join(',') : ''
  useEffect(() => {
    const t = tradeRef.current
    if (!routeKey || !t) return
    let alive = true
    const used = new Map<string, PoolView>()
    for (const p of t.parts) for (const l of p.quote.legs) used.set(l.pool.contract_addr, l.pool)
    const route = Array.from(used.values())
    const advise = (moves: number[]) => { if (alive) setAdvice(suggestSlippage({ pools: route.map((p, i) => ({ label: p.label, tvlUsd: p.tvlUsd, movePct: moves[i] })), separateLegs: perLeg })) }
    // A busy pool's trade history can take several seconds to read. Advise from depth and route length first, then again once the moves are in.
    const soon = (p: Promise<number>) => Promise.race([p, new Promise<number>(r => setTimeout(() => r(0), 1500))])
    const moves = route.map(p => poolMovePct(p.contract_addr))
    Promise.all(moves.map(soon)).then(advise).catch(() => {})
    Promise.all(moves).then(advise).catch(() => {})
    return () => { alive = false }
  }, [routeKey, perLeg])

  /** The next slippage worth trying after a swap landed past its limit; none once it is already 3%. */
  const wider = slipPct < 1 ? '1' : slipPct < 3 ? '3' : null
  // "Try again at 3%": once the new setting is in the plan, the swap goes again. It is a new signature in the wallet.
  useEffect(() => {
    if (!retryAfterSlip.current || !canSwap) return
    retryAfterSlip.current = false
    void go()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSwap, slip])

  /** A link that opens this swap filled in, and unfurls as it in chats (getServerSideProps, /api/og/swap). */
  const share = () => {
    if (!from || !to) return
    const u = new URL(window.location.origin)
    u.searchParams.set('from', from.key)
    u.searchParams.set('to', to.key)
    if (mode === 'out' && /^\d{1,12}(\.\d{1,8})?$/.test(receive.trim()) && Number(receive) > 0) u.searchParams.set('receive', receive.trim())
    else if (/^\d{1,12}(\.\d{1,8})?$/.test(amount.trim()) && Number(amount) > 0) u.searchParams.set('amount', amount.trim())
    navigator.clipboard?.writeText(u.toString()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  const flip = useCallback(() => {
    if (!from || !to) return
    const nf = toId, nt = fromId
    setFromId(nf); setToId(nt); setQuotes(null); setErr(null); setMode('in')
  }, [from, to, toId, fromId])

  // Keyboard: `/` jumps to the amount, `f` flips, 1/2/3 pick slippage. Only
  // when you are not already typing somewhere.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
      if (e.key === '/' && !typing) { e.preventDefault(); amountRef.current?.focus() }
      if (typing) return
      if (e.key === 'f' || e.key === 'F') deferKey(flip)
      if (e.key === '0') setSlippage('auto')
      if (e.key === '1') setSlippage('0.5')
      if (e.key === '2') setSlippage('1')
      if (e.key === '3') setSlippage('3')
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [flip])

  // Tab title reads like an old exchange: the live rate, then the venue.
  const spot = pool && from ? (sameAsset(from.info, pool.tokens[0].info) ? pool.price : (pool.price > 0 ? 1 / pool.price : 0)) : 0
  useEffect(() => {
    if (!from || !to || !(spot > 0)) return
    document.title = `1 ${from.label} = ${fmtPrice(spot)} ${to.label} · ${APP_NAME}`
    return () => { document.title = APP_NAME }
  }, [from, to, spot])

  const egg = from && !LITE ? amountEgg(amount, from.label) : null

  const go = async () => {
    if (!canSwap || !route || !trade || !from || !to || !micro) return
    setErr(null); setReceipt(null); setFailFix(null)
    // The quote on screen can be a minute old. Price it again before the wallet opens: if it now delivers
    // more than half the slippage less, show the new number and let the next press sign that.
    let signed = trade
    let short = quotes?.short ?? null
    const key = quoteKey.current
    setChecking(true)
    try {
      const fresh = await quoteBest(routePools, from, to, micro, HOME_VENUE, { slip, split: true })
      if (quoteKey.current !== key) return
      if (fresh.best) {
        const next = planTrade(fresh.split ?? [{ quote: fresh.best, share: 1 }], slip)
        setQuotes(fresh)
        if (BigInt(next.expectedOut) * BigInt(20_000) < BigInt(trade.expectedOut) * BigInt(20_000 - Math.round(slip * 10_000))) {
          setMoved({ was: trade.expectedOut, now: next.expectedOut })
          return
        }
        // Receive exactly: if the fresh price no longer covers what was asked for, work out what to pay again first.
        if (mode === 'out' && receiveMicro && BigInt(next.minOut) < BigInt(receiveMicro)) {
          setMoved({ was: trade.expectedOut, now: next.expectedOut })
          setSolveTick(n => n + 1)
          return
        }
        signed = next
        short = fresh.short
      }
    } catch {
      // An endpoint had a bad moment. The quote on screen still carries its minimum, so that is what gets signed.
    } finally { setChecking(false) }
    setMoved(null)
    // The stepper: asking your wallet → broadcasting → written down.
    setPhase(1)
    const p2 = setTimeout(() => setPhase(2), 2500)
    try {
      // The memo says what was quoted and what the routing added, so the wallet's history and the monthly report can check it.
      const r = await swap.mutateAsync({ trade: signed, maxSpread: slip, sender: me, memo: tradeMemo(signed, short, slip, to) })
      clearTimeout(p2); setPhase(3); setTimeout(() => setPhase(0), 2600)
      const hash = (r as { transactionHash?: string })?.transactionHash ?? 'ok'
      const first = signed.parts[0].quote
      setReceipt({
        from: from.label, to: to.label, amtIn: fromMicro(micro, from.decimals, 6), amtOut: fromMicro(signed.expectedOut, to.decimals, 6),
        fee: crystal ? '0 (Crystal)' : `${fromMicro(fee, from.decimals, 6)} ${from.label}`, tx: hash, height: (r as { height?: number })?.height,
        route: signed.parts.length > 1 || first.legs.length > 1 || first.legs[0].pool.venue !== HOME_VENUE ? tradeText(signed.parts) : undefined,
      })
      setTimeout(() => setReceipt(null), 20000)
      setTxHash(hash)
      setQuip(SWAP_QUIPS[Math.floor(Math.random() * SWAP_QUIPS.length)])
      sound('swap')
      kwonSay({ q: 'Steady lads, deploying more capital 🫡', when: 'reacting to you · just now', pose: 'salute' })
      setAmount('')
      setReceive('')
      setMode('in')
      onDone()
      setTimeout(() => setTxHash(null), 6000)
    } catch (e) { clearTimeout(p2); setPhase(0); const why = explainTx(e); setErr(why.text); setFailFix(why.fix) }
  }

  if (tradable.length === 0) {
    return <Empty title='No pool has liquidity yet' body='Someone has to go first. Add liquidity in the Pools tab, or open a new pool. The first ones are being written down.' />
  }

  return (
    <Card>
      <div className='terra-panel-head' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE['3'] }}>
        <span className='terra-panel-title'><Section title={t('Swap')} /></span>
        {/* The fee line is the resting state. When a pool has drifted off the
            reference, that is the more useful thing to say in the same space. */}
        {(() => {
          const best = arbs?.[0]
          if (!best) return (
            <span style={{
              fontSize: TEXT.xs.size, padding: '3px 9px', borderRadius: 999,
              color: crystal ? C.success : C.textMuted,
              border: `1px solid ${crystal ? C.success : C.divider}`,
            }}>
              {feeBps === 0 ? (LITE ? `No interface fee · pool fee ${poolFeeText(pool, poolFeeBps)}` : t('Best route on Terra · no interface fee')) : crystal ? '✦ Crystal · 0 protocol fee' : `Protocol fee ${feeBps / 100}% · Crystal holders 0`}
            </span>
          )
          const total = totalUsd(arbs!)
          return (
            <button
              type='button'
              className='terra-arb-pill'
              onClick={() => onTakeArb?.(best)}
              title={`${best.pool.label} prices ${best.outToken.label} ${best.off.toFixed(2)}× away from the Astroport reference. ${fmtAmount(best.inAmount)} ${best.inToken.label} in is the size that closes it. Anyone can take it, and it moves on every trade.`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                fontSize: TEXT.xs.size, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 700, color: C.goldLit,
                background: C.goldSoft, border: `1px solid ${C.goldCore}`,
              }}
            >
              <span className='terra-pulse' />
              {fmtUsd(total)} on the table{' '}
              <span style={{ color: C.textMuted, fontWeight: 500 }}>· {best.pool.label} {best.off.toFixed(1)}× off →</span>
            </button>
          )
        })()}
      </div>

      {pool && from && to && <PriceChart pool={pool} from={from} to={to} compact />}
      {pool && from && to && pool.deviation != null && (pool.deviation > 1.25 || pool.deviation < 0.8) && (!route || (route.legs.length === 1 && route.legs[0].pool.contract_addr === pool.contract_addr)) && (() => {
        const off = pool.deviation > 1 ? pool.deviation : 1 / pool.deviation
        const fromIsBase = sameAsset(from.info, pool.tokens[0].info)
        // is the token you RECEIVE cheap here (good for you) or expensive (bad)?
        const cheapHere = pool.deviation > 1 ? pool.tokens[1] : pool.tokens[0]
        const good = sameAsset(cheapHere.info, to.info)
        return (
          <div style={{ fontSize: TEXT.xs.size, lineHeight: 1.5, padding: `${SPACE['2']}px ${SPACE['3']}px`, borderRadius: 10, marginBottom: SPACE['3'], background: good ? C.successSoft : C.alertSoft, color: good ? C.success : C.alert, border: `1px solid ${good ? 'rgba(61,220,151,0.3)' : 'rgba(224,74,90,0.35)'}` }}>
            {good
              ? <>⚡ This pool sells {to.label} {off.toFixed(1)}× cheaper than market. You are the arb. Size is small; so is the pool.</>
              : <>⚠ This pool is {off.toFixed(1)}× off market and it is against you: {to.label} costs {off.toFixed(1)}× more here than on Astroport. You are the exit liquidity. Consider not.</>}
            {!fromIsBase && null}
          </div>
        )
      })()}

      <label className='terra-label' style={label}>{t('You pay')}</label>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['2'] }}>
        <input ref={amountRef} style={field} type='number' min='0' step='any' placeholder={mode === 'out' && solving ? '…' : '0.0'} value={amount} aria-label={t('You pay')}
          onChange={e => { setMode('in'); setAmount(e.target.value) }} />
        <TokenSelect value={fromId} onChange={setFromId} options={tokens} />
      </div>
      <div style={{ ...rowStyle, marginBottom: SPACE['3'] }}>
        <span>{t('Balance')} {from ? fromMicro(balance, from.decimals) : '—'}{from && me && (() => {
          // The poor-o-meter. His words, our balances.
          if (LITE) return null
          const n = Number(balance) / 10 ** from.decimals
          const tag = n === 0 ? 'the poor. we debate you anyway.' : n < 10 ? 'size is not size.' : n < 100 ? 'steady.' : n < 1000 ? 'deploying capital.' : 'lad.'
          return <span style={{ color: C.textWhisper, fontStyle: 'italic' }}> · {tag}</span>
        })()}</span>
        {from && Number(balance) > 0 && (
          <button type='button' style={{ ...ghostBtn, padding: '2px 8px' }}
            onClick={() => { setMode('in'); setAmount(fromMicro((BigInt(balance) * BigInt(10_000 - feeBps - 1) / BigInt(10_000)).toString(), from.decimals, 6).replace(/,/g, '')) }}>
            {t('max')}
          </button>
        )}
      </div>
      {egg && <div style={{ fontSize: TEXT.xs.size, color: C.goldLit, fontStyle: 'italic', margin: `-4px 0 ${SPACE['2']}px` }}>✦ {egg}</div>}

      <div className='terra-flip-row' style={{ display: 'flex', justifyContent: 'center', margin: `-2px 0 ${SPACE['2']}px` }}>
        {/* While a swap is being signed and sent, the current runs between the two tokens. */}
        {(phase === 1 || phase === 2) && from && to ? (
          <div style={{ width: '100%', maxWidth: 300 }}>
            <ElectricPulse compact active left={<TokenIcon label={from.label} size={24} />} right={<TokenIcon label={to.label} size={24} />} />
          </div>
        ) : <button
          type='button'
          onClick={flip}
          disabled={!from || !to}
          aria-label='Flip direction'
          className='atrium-swap-flip'
          style={{
            width: 34, height: 34, borderRadius: 999, cursor: from && to ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.surfaceElev, border: `1px solid ${C.divider}`,
            color: C.goldLit, fontSize: '1rem', lineHeight: 1, fontFamily: 'inherit',
            transition: 'transform 0.35s ease, border-color 0.2s, color 0.2s',
          }}
        >⇅</button>}
      </div>

      <label className='terra-label' style={label}>{t('You receive')}</label>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: mode === 'out' && (solving || noSolve) ? SPACE['1'] : SPACE['3'] }}>
        {/* Shows what the swap delivers; typing in it asks for that amount to arrive instead. */}
        <input style={{ ...field, color: mode === 'out' || sim ? C.textPrimary : C.textMuted, borderColor: mode === 'out' ? C.goldCore : C.divider }}
          type='number' min='0' step='any' data-receive aria-label={t('You receive')} placeholder={t('or type what you want to receive')}
          value={mode === 'out' ? receive : sim && to ? fromMicro(sim.ret, to.decimals, 6).replace(/,/g, '') : ''}
          onChange={e => { setMode('out'); setReceive(e.target.value) }} />
        <TokenSelect value={toId} onChange={setToId} options={toOptions} />
      </div>
      {mode === 'out' && solving && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginBottom: SPACE['3'] }}>{t('Finding what to pay…')}</div>}
      {mode === 'out' && !solving && noSolve && <div style={{ fontSize: TEXT.xs.size, color: C.emberLit, marginBottom: SPACE['3'] }}>{t('No amount found that delivers that right now. The pools may be too thin.')}</div>}

      {route && trade && from && to && (
        <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: 'rgba(0,0,0,0.22)', borderRadius: 10, marginBottom: SPACE['3'] }}>
          <RouteMap parts={trade.parts} />
          {mode === 'out' && receiveMicro && <Row k={t('You receive at least')} v={`${fromMicro(receiveMicro, to.decimals, 6)} ${to.label}`} hi />}
          {trade.parts.length > 1 && (() => {
            // What splitting is worth, against the best single path.
            const gain = (Number(trade.expectedOut) / Math.max(1, Number(planRoute(route, slip).expectedOut)) - 1) * 100
            return gain > 0.01 ? <Row k={t('vs one path')} v={t('+{pct}% more {token}', { pct: gain.toFixed(2), token: to.label })} hi /> : null
          })()}
          {(() => {
            // What routing is worth, measured against this site's own pools alone.
            if (!trade.parts.some(p => p.quote.legs.some(l => l.pool.venue !== HOME_VENUE))) return null
            const home = quotes?.home
            if (!home) return <Row k={`${VENUE_NAME[HOME_VENUE]} alone`} v='no path for this pair' />
            const gain = (Number(trade.expectedOut) / Math.max(1, Number(planRoute(home, slip).expectedOut)) - 1) * 100
            return gain > 0.05 ? <Row k={t('vs {venue} alone', { venue: VENUE_NAME[HOME_VENUE] })} v={t('+{pct}% more {token}', { pct: gain >= 100 ? gain.toFixed(0) : gain.toFixed(1), token: to.label })} hi /> : null
          })()}
          <Row k={t('Rate')} v={`1 ${from.label} ≈ ${fromMicro((Number(sim?.ret ?? route.outMicro) / Math.max(1, Number(micro))) * 10 ** from.decimals, to.decimals)} ${to.label}`} />
          <Row k={t('Price impact')} v={`${impact.toFixed(2)}%`} hi={impact > 3} />
          <SizeRow from={from} to={to} amount={amount} />
          {(() => {
            const used = new Map<string, PoolView>()
            for (const p of trade.parts) for (const l of p.quote.legs) used.set(l.pool.contract_addr, l.pool)
            const list = Array.from(used.values())
            // Pools with the same fee say it once: three Astroport pools with dynamic fees are one line, not three.
            return <Row k={t(list.length > 1 ? 'Pool fees' : 'Pool fee')} v={Array.from(new Set(list.map(poolFeeTextFor))).join(' · ')} />
          })()}
          {feeBps > 0 && <Row k='Protocol fee' v={crystal ? '0 · Crystal' : `${fromMicro(fee, from.decimals)} ${from.label}`} hi={crystal} />}
          <Row k={t(perLeg ? 'Min. received ({pct}% per leg)' : slippage === 'auto' ? 'Min. received ({pct}% slippage, auto)' : 'Min. received ({pct}% slippage)', { pct: slipPct })} v={`${fromMicro(minOut, to.decimals)} ${to.label}`} />
          {netFee && <Row k={t('Network fee')} v={`≈ ${fromMicro(netFee, 6, 4)} LUNA`} />}
          {mode === 'out' && (
            <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5, paddingTop: 2 }}>
              {t('What to pay is worked out from the pools right now, with {pct}% room for the price to move. If the price holds, a little more arrives.', { pct: slipPct })}
            </div>
          )}
          {(trade.parts.length > 1 || route.legs.length > 1) && (
            <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5, paddingTop: 2 }}>
              {trade.parts.length > 1
                ? <>One transaction, the amount split over two paths that share no pool, so neither moves its pools as far as one path would. Each part carries its own minimum, and if either would land short, all of it reverts.</>
                : trade.parts[0].plan.kind === 'router'
                  ? <>One transaction through Astroport&apos;s router: each swap&apos;s full return goes into the next, and it reverts if less than the minimum arrives.</>
                  : trade.parts[0].plan.kind === 'multi'
                    ? <>One transaction through Terra Swap&apos;s router, across both sites&apos; pools: each swap&apos;s full return goes into the next, and it reverts if less than the minimum arrives.</>
                    : <>One transaction, {route.legs.length} swaps. Each swap after the first spends the least the one before it can return, so if any leg would land past its limit, all of it reverts.</>}
              {trade.leftover.length > 0 && <> At the quoted prices about {trade.leftover.map(x => `${fromMicro(x.micro, x.token.decimals, 6)} ${x.token.label}`).join(' and ')} stays in your wallet.</>}
            </div>
          )}
        </div>
      )}

      {from && to && <HubAlternative from={from} to={to} micro={micro} swapOut={trade?.expectedOut ?? null} blocked={insufficient} onDone={onDone} />}

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: SPACE['2'], marginBottom: SPACE['3'], fontSize: TEXT.xs.size, color: C.textMuted }}>
        <span>{t('Slippage')}</span>
        <button type='button' onClick={() => setSlippage('auto')}
          title={advice ? (advice.reasons.length ? `Auto: ${advice.reasons.join(' · ')}` : 'Auto: the pools on this route are deep and have been quiet') : "Auto: set from how the route's pools have been moving"}
          style={{ ...ghostBtn, padding: '2px 8px', color: slippage === 'auto' ? C.goldLit : C.textMuted, borderColor: slippage === 'auto' ? C.goldCore : C.divider }}>
          {t('Auto')}{advice ? ` ${advice.pct}%` : ''}
        </button>
        {['0.5', '1', '3'].map(s => (
          <button key={s} type='button' style={{ ...ghostBtn, padding: '2px 8px', color: slippage === s ? C.goldLit : C.textMuted, borderColor: slippage === s ? C.goldCore : C.divider }} onClick={() => setSlippage(s)}>{s}%</button>
        ))}
              {slippage === '3' && <span style={{ fontSize: TEXT.xs.size, color: C.korea, fontStyle: 'italic' }}>brave.</span>}
        {from && to && (
          <button type='button' onClick={share} title='A link that opens this swap, with its own preview card'
            style={{ ...ghostBtn, padding: '2px 8px', marginLeft: 'auto', color: copied ? C.success : C.textMuted }}>
            {t(copied ? 'link copied ✓' : 'share link')}
          </button>
        )}
</div>
      <div className='terra-kbd' style={{ fontSize: '0.6rem', letterSpacing: '0.06em', color: C.textWhisper, margin: `-2px 0 ${SPACE['2']}px`, fontFamily: TERRA_FONT }}>
        ⌨ <b style={{ color: C.textMuted }}>/</b> amount · <b style={{ color: C.textMuted }}>f</b> flip · <b style={{ color: C.textMuted }}>0</b> auto · <b style={{ color: C.textMuted }}>1 2 3</b> slippage
      </div>

      {slippage !== 'auto' && advice && trade && Number(slippage) < advice.pct && (
        <div style={{ fontSize: TEXT.xs.size, color: C.emberLit, marginBottom: SPACE['2'], lineHeight: 1.5 }}>
          {slippage}% is tighter than this route has been moving{advice.reasons[0] ? ` (${advice.reasons[0]})` : ''}, so the swap may fail. Auto would use {advice.pct}%.
        </div>
      )}
      {impact > 5 && <div style={{ fontSize: TEXT.xs.size, color: C.emberLit, marginBottom: SPACE['2'] }}>{t('High price impact: even the best path is thin for this size. Trade smaller.')}</div>}
      {insufficient && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>{LITE || lang !== 'en' ? t('Not enough balance.') : 'Not enough minerals.'} ({from?.label})</div>}
      {moved && to && (
        <div style={{ fontSize: TEXT.xs.size, color: C.emberLit, marginBottom: SPACE['2'], lineHeight: 1.5 }}>
          {t('The price moved while this was open: the swap now gives about {now} {token} instead of {was}. Press Swap again to take the new price.', { now: fromMicro(moved.now, to.decimals, 6), token: to.label, was: fromMicro(moved.was, to.decimals, 6) })}
        </div>
      )}
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>{t(err)}</div>}
      {err && failFix === 'slippage' && wider && (
        <button type='button' onClick={() => { retryAfterSlip.current = true; setErr(null); setFailFix(null); setSlippage(wider) }}
          style={{ ...ghostBtn, padding: '3px 10px', marginBottom: SPACE['2'], color: C.goldLit, borderColor: C.goldCore }}>
          {t('Try again at {pct}% slippage', { pct: wider })}
        </button>
      )}
      {/* Checked before anyone signs: the chain's simulation of these exact messages. Shown only for causes a person can act on. */}
      {!err && simFail && (simFail.fix === 'slippage' || simFail.fix === 'balance') && (
        <div style={{ fontSize: TEXT.xs.size, color: C.emberLit, marginBottom: SPACE['2'], lineHeight: 1.5 }}>
          {t('Checked against the chain before you sign: as it stands this would fail.')} {t(simFail.text)}
          {simFail.fix === 'slippage' && wider && <> <button type='button' onClick={() => setSlippage(wider)} style={{ ...ghostBtn, padding: '1px 8px', color: C.goldLit, borderColor: C.goldCore }}>{t('Use {pct}%', { pct: wider })}</button></>}
        </div>
      )}
      {txHash && !err && (
        <div style={{ fontSize: TEXT.xs.size, color: C.success, marginBottom: SPACE['2'], display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{(!LITE && lang === 'en' && quip) || t('✓ Swapped.')}</span>
          {txHash !== 'ok' && <Link href={`/tx/${txHash}`} style={{ color: C.goldLit, fontWeight: 700 }}>{t('Receipt →')}</Link>}
        </div>
      )}
      {/* What people do next with what just arrived: check it landed, or put it to work in a pool. */}
      {txHash && !err && onNext && to && (
        <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginBottom: SPACE['2'], display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{t('Next:')}</span>
          <button type='button' onClick={() => onNext('history')} style={{ ...ghostBtn, padding: '2px 10px' }}>{t('See it in your history')}</button>
          <button type='button' onClick={() => onNext('pools', to.key)} style={{ ...ghostBtn, padding: '2px 10px' }}>{t('Pools with {token}', { token: to.label })}</button>
        </div>
      )}
      {phase > 0 && (
        <div className='terra-stepper' aria-live='polite'>
          {(['asking your wallet', 'broadcasting · steady', 'written down'] as const).map((step, k) => {
            const n = (k + 1) as 1 | 2 | 3
            const on = phase >= n, now = phase === n
            return (
              <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: on ? (n === 3 ? C.success : C.goldLit) : C.textWhisper }}>
                <span className={`terra-step-dot${now ? ' terra-step-now' : ''}`} style={{ background: on ? (n === 3 ? C.success : C.goldLit) : C.divider }} />
                {lang === 'en' ? step : t(step.replace(' · steady', ''))}{now && n < 3 ? '…' : n === 3 && on ? ' ✓' : ''}
              </span>
            )
          })}
        </div>
      )}
      {receipt && (
        <div className='terra-receipt' onClick={() => setReceipt(null)} title='click to dismiss'>
          <div className='terra-receipt-h'>영수증 · TERRA SWAP</div>
          <div className='terra-receipt-row'><span>{receipt.from} → {receipt.to}</span><span>{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className='terra-receipt-row'><span>paid</span><span>{receipt.amtIn} {receipt.from}</span></div>
          <div className='terra-receipt-row'><span>received (est.)</span><span>{receipt.amtOut} {receipt.to}</span></div>
          {feeBps > 0 && <div className='terra-receipt-row'><span>protocol fee</span><span>{receipt.fee}</span></div>}
          <div className='terra-receipt-row'><span>{receipt.route ? 'route' : 'pool fee'}</span><span>{receipt.route ?? (LITE ? poolFeeText(pool, poolFeeBps) : `${poolFeeBps} bps → LPs`)}</span></div>
          {receipt.height ? <div className='terra-receipt-row'><span>block</span><span>#{receipt.height.toLocaleString('en-US')}</span></div> : null}
          <div className='terra-receipt-row'><span>tx</span><span>{receipt.tx === 'ok' ? '—' : <Link href={`/tx/${receipt.tx}`} style={{ color: 'inherit' }}>{receipt.tx.slice(0, 8)}…{receipt.tx.slice(-4)} ↗</Link>}</span></div>
          <div className='terra-receipt-f'>{LITE ? 'thank you' : '감사합니다 · thank you · steady lads 🫡'}</div>
        </div>
      )}

      {me
        ? <button type='button' style={{ ...primaryBtn, opacity: canSwap ? 1 : 0.5, cursor: canSwap ? 'pointer' : 'not-allowed' }} disabled={!canSwap} onClick={go}
            onMouseDown={() => { holdT.current = setTimeout(() => setHolding(true), 650) }}
            onMouseUp={() => { if (holdT.current) clearTimeout(holdT.current); setHolding(false) }}
            onMouseLeave={() => { if (holdT.current) clearTimeout(holdT.current); setHolding(false) }}>
            {checking ? t('Checking the price…') : swap.isLoading ? t('Confirm in wallet…') : holding ? (LITE || lang !== 'en' ? t('Swapping…') : 'Deploying capital… 🫡') : impact > 5 ? (LITE || lang !== 'en' ? t('Swap anyway') : 'Swap anyway · steady lads') : t('Swap')}
          </button>
        : <div className='terra-connect-cta'><WalletButton /></div>}
      {pool && from && to && (
        <div style={{ marginTop: SPACE['3'] }}>
          <div style={{ fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textWhisper, marginBottom: 6 }}>Market · {pool.label}</div>
          <PriceChart pool={pool} from={from} to={to} />
        </div>
      )}
    </Card>
  )
}

// ─── Positions: everything a wallet holds, on either site ───────

/**
 * Every pool position the connected wallet holds on Terra Swap or Astroport,
 * LP staked in Astroport's incentives contract included, with the ways out.
 * Built so nobody has to open Astroport's app to find or leave a position.
 */
/**
 * A liquid staking token's hub can beat the pool: redeeming there pays the full
 * exchange rate after unbonding, and minting there can cost less than buying.
 * When it does, say by how much and offer it next to the swap. See lib/lst.
 */
function HubAlternative({ from, to, micro, swapOut, blocked, onDone }: {
  from: KnownToken; to: KnownToken; micro: string | null; swapOut: string | null; blocked: boolean; onDone: () => void
}) {
  const me = useMyAddress()
  const bond = useLstBond()
  const unbond = useLstUnbond()
  const fromId = assetId(from.info), toId = assetId(to.info)
  const minting = fromId === 'uluna'
  const hub = minting ? hubForToken(toId) : toId === 'uluna' ? hubForToken(fromId) : null
  const [info, setInfo] = useState<HubInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setInfo(null); setErr(null); setDone(null)
    if (hub) hubInfo(hub).then(v => { if (alive) setInfo(v) }).catch(() => {})
    return () => { alive = false }
  }, [hub])
  if (!hub || !info || !micro || micro === '0') return null
  // LUNA, ampLUNA and bLUNA all have 6 decimals, so the amounts compare directly.
  const hubOut = Math.floor(minting ? Number(micro) / info.rate : Number(micro) * info.rate)
  const swap = Number(swapOut ?? 0)
  const edge = swap > 0 ? (hubOut / swap - 1) * 100 : null
  // Worth a line only when the hub pays noticeably more than the swap, or there is no swap at all.
  if (edge !== null && edge < 0.1) return null
  const out = fromMicro(String(hubOut), 6, 4)
  const days = `${Math.round(info.unbondDays)} to ${Math.round(info.unbondDays + info.epochDays)} days`
  const busy = bond.isLoading || unbond.isLoading
  const go = async () => {
    if (!me || blocked || busy) return
    setErr(null); setDone(null)
    try {
      if (minting) {
        await bond.mutateAsync({ hub: hub.hub, amount: micro, sender: me })
        setDone(`Staked at ${hub.provider}. The ${hub.key} is in your wallet.`)
      } else {
        await unbond.mutateAsync({ token: hub.token, hub: hub.hub, amount: micro, sender: me })
        setDone(`Queued at ${hub.provider}. Withdraw the LUNA from Portfolio when it is ready, in about ${days}.`)
      }
      onDone()
    } catch (e) { setErr(humanizeTxError(e)) }
  }
  return (
    <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, borderRadius: 10, marginBottom: SPACE['3'], background: C.surface, border: `1px solid ${C.dividerWarm}`, fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6 }}>
      {minting
        ? <><b style={{ color: C.textPrimary }}>Or stake at {hub.provider}:</b> {out} {hub.key} straight from its hub{edge !== null && <>, <b style={{ color: C.success }}>{edge.toFixed(2)}% more</b> than this swap</>}. Instant, at the hub&apos;s exchange rate.</>
        : <><b style={{ color: C.textPrimary }}>Or unstake at {hub.provider}:</b> about {out} LUNA{edge !== null && <>, <b style={{ color: C.success }}>{edge.toFixed(2)}% more</b> than selling now</>}, ready in about {days}. You withdraw it from Portfolio.</>}
      {err && <div style={{ color: C.alert, marginTop: 4 }}>{err}</div>}
      {done && <div style={{ color: C.success, marginTop: 4 }}>✓ {done}</div>}
      {me && (
        <div style={{ marginTop: 6 }}>
          <button type='button' style={{ ...ghostBtn, padding: '3px 10px', opacity: blocked || busy ? 0.5 : 1 }} disabled={blocked || busy} onClick={go}>
            {busy ? 'Confirm in wallet…' : minting ? `Stake at ${hub.provider} instead` : `Unstake at ${hub.provider} instead`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Moving tokens between Noble or the Cosmos Hub and Terra ────

/** A chain the wallet kit signs for directly, and the one token this panel moves between it and Terra. */
interface SourceChain {
  chainName: 'noble' | 'cosmoshub' | 'neutron' | 'stride'
  /** what the source chain charges its network fee in, and a way to read that balance */
  feeDenom: string
  feeLabel: string
  feeBalance: (address: string) => Promise<string>
  chainId: string
  name: string
  /** bech32 prefix of its addresses */
  prefix: string
  /** the token as it is on Terra, and as the source chain names it */
  terraDenom: string
  sourceDenom: string
  label: string
  toTerra: string
  fromTerra: string
  balance: (address: string) => Promise<string>
  /** what max leaves behind on the source chain, which takes its network fee in this same token */
  feeReserve: bigint
  txUrl: (hash: string) => string
  /** Terra tokens this token never turns into here, nor comes from, and whose pools a route avoids */
  never: string[]
  footnote: string
}

type SourceKey = 'noble' | 'cosmoshub' | 'neutron-astro' | 'neutron-datom' | 'neutron-fuel' | 'stride-stluna' | 'stride-statom'
/** Every way into Terra the Bridge tab offers: the chains above, and Injective, which signs differently (InjectiveTransfer). */
type NetKey = SourceKey | 'injective'

/** A token from Neutron: its fee is NTRN, so a transfer can move all of the token. Checked on both chains 2026-09-15 (lib/neutron). */
const neutronToken = (label: string, sourceDenom: string, terraDenom: string): SourceChain => ({
  chainName: 'neutron', chainId: NEUTRON_CHAIN_ID, name: 'Neutron', prefix: 'neutron', terraDenom, sourceDenom, label,
  toTerra: NEUTRON_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_NEUTRON_CHANNEL, balance: a => neutronBalance(a, sourceDenom), feeReserve: BigInt(0),
  feeDenom: NEUTRON_FEE_DENOM, feeLabel: 'NTRN', feeBalance: a => neutronBalance(a, NEUTRON_FEE_DENOM),
  txUrl: h => `https://www.mintscan.io/neutron/tx/${h}`, never: [],
  footnote: 'Neutron charges its network fee in NTRN, so the Neutron wallet needs a little of it.',
})
/** A token from Stride: its fee is STRD. Checked on both chains 2026-09-15 (lib/stride). */
const strideToken = (label: string, sourceDenom: string, terraDenom: string): SourceChain => ({
  chainName: 'stride', chainId: STRIDE_CHAIN_ID, name: 'Stride', prefix: 'stride', terraDenom, sourceDenom, label,
  toTerra: STRIDE_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_STRIDE_CHANNEL, balance: a => strideBalance(a, sourceDenom), feeReserve: BigInt(0),
  feeDenom: STRIDE_FEE_DENOM, feeLabel: 'STRD', feeBalance: a => strideBalance(a, STRIDE_FEE_DENOM),
  txUrl: h => `https://www.mintscan.io/stride/tx/${h}`, never: [],
  footnote: 'Stride charges its network fee in STRD, so the Stride wallet needs a little of it.',
})

const SOURCE_CHAINS: Record<SourceKey, SourceChain> = {
  noble: {
    feeDenom: NOBLE_USDC_DENOM, feeLabel: 'USDC', feeBalance: nobleUsdcBalance,
    chainName: 'noble', chainId: NOBLE_CHAIN_ID, name: 'Noble', prefix: 'noble', terraDenom: NOBLE_USDC, sourceDenom: NOBLE_USDC_DENOM, label: 'USDC',
    toTerra: NOBLE_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_NOBLE_CHANNEL, balance: nobleUsdcBalance, feeReserve: BigInt(50_000),
    txUrl: h => `https://www.mintscan.io/noble/tx/${h}`,
    // USDC.inj is a different dollar with its own switch, so USDC never turns into it here, or comes from it.
    never: [USDC_INJ_DENOM],
    footnote: 'This route carries USDC issued on Noble; USDC.inj from Injective has its own switch above. Noble charges its network fee in USDC.',
  },
  cosmoshub: {
    feeDenom: HUB_ATOM_DENOM, feeLabel: 'ATOM', feeBalance: hubAtomBalance,
    chainName: 'cosmoshub', chainId: HUB_CHAIN_ID, name: 'Cosmos Hub', prefix: 'cosmos', terraDenom: ATOM_DENOM, sourceDenom: HUB_ATOM_DENOM, label: 'ATOM',
    toTerra: HUB_TO_TERRA_CHANNEL, fromTerra: TERRA_TO_HUB_CHANNEL, balance: hubAtomBalance, feeReserve: BigInt(20_000),
    txUrl: h => `https://www.mintscan.io/cosmos/tx/${h}`,
    never: [],
    footnote: 'The Cosmos Hub charges its network fee in ATOM.',
  },
  'neutron-astro': neutronToken('ASTRO', NEUTRON_ASTRO, ASTRO_IBC_DENOM),
  'neutron-datom': neutronToken('dATOM', NEUTRON_DATOM, DATOM_DENOM),
  'neutron-fuel': neutronToken('FUEL', NEUTRON_FUEL, FUEL_DENOM),
  'stride-stluna': strideToken('stLUNA', 'stuluna', STLUNA_DENOM),
  'stride-statom': strideToken('stATOM', 'stuatom', STATOM_DENOM),
}

/** The Bridge tab's chains, and the tokens each one moves. */
const BRIDGE_CHAINS: { name: string; tokens: [NetKey, string][] }[] = [
  { name: 'Noble', tokens: [['noble', 'USDC']] },
  { name: 'Cosmos Hub', tokens: [['cosmoshub', 'ATOM']] },
  { name: 'Injective', tokens: [['injective', 'USDC.inj']] },
  { name: 'Neutron', tokens: [['neutron-astro', 'ASTRO'], ['neutron-datom', 'dATOM'], ['neutron-fuel', 'FUEL']] },
  { name: 'Stride', tokens: [['stride-stluna', 'stLUNA'], ['stride-statom', 'stATOM']] },
]
const isNetKey = (v: string | null): v is NetKey => !!v && BRIDGE_CHAINS.some(c => c.tokens.some(([k]) => k === v))

/**
 * A token between Noble or the Cosmos Hub and Terra without leaving the page.
 *
 * Into Terra: a plain IBC transfer, or, when it should arrive as another
 * token, the same transfer carrying a call to Terra Swap's router that Terra's
 * IBC hooks run as it lands (lib/msgs arrivalSwapMsg). If the swap cannot
 * deliver its minimum, the transfer fails and the source chain returns the
 * tokens. Out of Terra: any listed token is swapped to the chain's token by
 * this site's own routing and sent in the same transaction. See lib/noble and
 * lib/cosmoshub.
 */
function CosmosTransfer({ net, routePools, onDone, switcher }: { net: SourceChain; routePools: PoolView[]; onDone: () => void; switcher: JSX.Element }) {
  const me = useMyAddress()
  const source = useChain(net.chainName)
  const sourceMsgs = useCosmosMsgs(net.chainName, net.name)
  const terraMsgs = useTerraMsgs()
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [tokenId, setTokenId] = useState(net.terraDenom)
  const [sendTo, setSendTo] = useState('')
  const [srcBal, setSrcBal] = useState('0')
  const [terraBal, setTerraBal] = useState('0')
  const [quote, setQuote] = useState<{ out: string; secs: number; path: string; note?: string; plan?: RoutePlan; trade?: TradePlan } | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const SLIP = 0.01

  const base = useMemo(() => tokenFor({ native_token: { denom: net.terraDenom } }), [net])
  /** Routes avoid pools holding a token this one is never exchanged for. */
  const pools = useMemo(() => routePools.filter(p => !p.tokens.some(t => net.never.includes(assetId(t.info)))), [routePools, net])
  const allTokens = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of pools) for (const t of p.tokens) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [pools])
  const routable = useMemo(() => reachable(pools, base, allTokens), [pools, base, allTokens])
  /** A deposit can arrive as the token itself, or swapped on arrival by Terra Swap's router into anything routable. */
  const inOptions = useMemo(() => (TERRA_SWAP_ROUTER ? [base, ...routable] : [base]), [base, routable])
  /** Anything this site can route to the token can leave for its chain. */
  const outOptions = useMemo(() => [base, ...routable], [base, routable])
  const options = dir === 'in' ? inOptions : outOptions
  useEffect(() => { if (!options.some(t => assetId(t.info) === tokenId)) setTokenId(net.terraDenom) }, [options, tokenId, net])
  const token = options.find(t => assetId(t.info) === tokenId) ?? base
  const plain = tokenId === net.terraDenom
  const micro = toMicro(amount, dir === 'in' ? base.decimals : token.decimals)
  const debounced = useDebounced(micro, 400)
  const gas = useGasDrop({ me, incoming: dir === 'in', from: base, target: token, amountMicro: debounced, pools, refresh: status?.done })
  /** What the main transfer carries once about one LUNA's worth is set aside for fees. */
  const mainDebounced = gas.main(debounced)
  const srcAddr = source.address ?? ''
  const isSourceAddress = (a: string) => { try { const { prefix, data } = fromBech32(a); return prefix === net.prefix && data.length === 20 } catch { return false } }
  const destination = dir === 'out' ? (sendTo.trim() || srcAddr) : ''

  useEffect(() => {
    if (!srcAddr) { setSrcBal('0'); return }
    net.balance(srcAddr).then(setSrcBal).catch(() => {})
  }, [srcAddr, net, status?.done])
  // Neutron and Stride take their fee in their own token, not the one being moved: a wallet without any cannot send.
  const [feeBal, setFeeBal] = useState<string | null>(null)
  useEffect(() => {
    if (!srcAddr || net.feeDenom === net.sourceDenom) { setFeeBal(null); return }
    net.feeBalance(srcAddr).then(setFeeBal).catch(() => {})
  }, [srcAddr, net, status?.done])
  useEffect(() => {
    if (!me) { setTerraBal('0'); return }
    queryBalance(me, dir === 'in' ? base.info : token.info).then(setTerraBal).catch(() => {})
  }, [me, dir, token, base, status?.done])

  useEffect(() => {
    let alive = true
    setQuote(null); setQuoteErr(null)
    if (!mainDebounced || mainDebounced === '0') return
    if (plain) {
      setQuote({ out: mainDebounced, secs: 30, path: dir === 'in' ? `IBC transfer from ${net.name} to Terra` : `IBC transfer from Terra to ${net.name}` })
      return
    }
    if (dir === 'in') {
      // One path and no split: the swap on arrival is a single call to the router, run inside the relayer's
      // transaction. Kept to two pools: on 2026-09-14 a two-pool call simulated at 1.02 to 1.10M gas, and the
      // relayer delivering Skip's hooked packets from Noble spent 1.09M of 2.18M the same day.
      quoteBest(pools, base, token, mainDebounced, HOME_VENUE, { slip: SLIP, threeHop: false }).then(q => {
        if (!alive) return
        const plan = q.best ? routerPlan(q.best, SLIP) : null
        if (!q.best || !plan) { setQuoteErr(`No route from ${net.label} to ${token.label} through up to two pools right now. Bring ${net.label} to Terra and swap it here.`); return }
        setQuote({
          out: plan.expectedOut, secs: 45, plan,
          path: `IBC transfer to Terra, swapped on arrival by Terra Swap's router: ${routeText(q.best)}`,
          note: `At least ${fromMicro(plan.minOut, token.decimals, 6)} ${token.label} arrives, or the swap does not happen and ${net.name} returns the ${net.label} to you.`,
        })
      }).catch(() => { if (alive) setQuoteErr('Could not price that right now.') })
    } else {
      quoteBest(pools, token, base, mainDebounced, HOME_VENUE, { slip: SLIP, split: true }).then(q => {
        if (!alive) return
        if (!q.best) { setQuoteErr(`No route from ${token.label} to ${net.label} right now.`); return }
        const trade = planTrade(q.split ?? [{ quote: q.best, share: 1 }], SLIP)
        setQuote({
          out: trade.minOut, secs: 60, trade, path: `${tradeText(trade.parts)}, then IBC transfer to ${net.name}`,
          note: `The swap should give about ${fromMicro(trade.expectedOut, base.decimals)} ${net.label}. At least ${fromMicro(trade.minOut, base.decimals)} is sent to ${net.name}, and anything above that stays in your Terra wallet as ${net.label}.`,
        })
      }).catch(() => { if (alive) setQuoteErr('Could not price that right now.') })
    }
    return () => { alive = false }
  }, [dir, tokenId, token, plain, mainDebounced, pools, base, net])

  const go = async () => {
    setErr(null); setStatus(null)
    if (!micro || micro === '0' || !quote) return
    setBusy(true)
    try {
      if (dir === 'in') {
        if (!me) throw new Error('Connect your wallet first')
        if (!srcAddr) throw new Error(`Connect your wallet on ${net.name} first`)
        // With the fee drop, the main transfer carries the rest and the drop goes as its own transfer, swapped into LUNA on arrival.
        const send = gas.ready ? gas.main(micro) ?? micro : micro
        const drop = gas.ready && gas.plan && gas.micro
          ? [arrivalSwapMsg({ sender: srcAddr, terraAddress: me, channel: net.toTerra, sourceDenom: net.sourceDenom, terraDenom: net.terraDenom, amount: gas.micro, plan: gas.plan })]
          : []
        const msgs: EncodeObject[] = [
          plain
            ? ibcTransferMsg({ sender: srcAddr, receiver: me, channel: net.toTerra, denom: net.sourceDenom, amount: send })
            : arrivalSwapMsg({ sender: srcAddr, terraAddress: me, channel: net.toTerra, sourceDenom: net.sourceDenom, terraDenom: net.terraDenom, amount: send, plan: quote.plan! }),
          ...drop,
        ]
        const [before, srcBefore] = await Promise.all([queryBalance(me, token.info), net.balance(srcAddr)])
        const res = await sourceMsgs.mutateAsync({ msgs, memo: `${plain ? `${net.label} to Terra` : `${net.label} to Terra as ${token.label}`}${drop.length ? ', and LUNA for fees' : ''}` }) as { transactionHash?: string }
        const hash = res?.transactionHash ?? ''
        setStatus({ tx: hash, chain: net.chainId, text: `Sent on ${net.name}. Arriving on Terra as ${token.label}…` })
        if (hash) followIbc(before, () => queryBalance(me, token.info), setStatus, {
          check: cameBack(() => net.balance(srcAddr), srcBefore, send),
          text: plain
            ? `It was not delivered, and the ${net.label} is back on ${net.name}.`
            : `The swap into ${token.label} could not deliver its minimum, so the transfer failed and the ${net.label} is back on ${net.name}. Nothing was swapped.`,
        })
      } else {
        if (!me) throw new Error('Connect your wallet first')
        if (!destination || !isSourceAddress(destination)) throw new Error(`Enter a ${net.name} address, or connect your wallet on ${net.name}`)
        const send = plain ? micro : quote.trade!.minOut
        const msgs = [
          ...(plain ? [] : tradeMsgs(me, quote.trade!, SLIP)),
          ibcTransferMsg({ sender: me, receiver: destination, channel: net.fromTerra, denom: net.terraDenom, amount: send }),
        ]
        const [before, terraBefore] = await Promise.all([net.balance(destination), queryBalance(me, base.info)])
        const res = await terraMsgs.mutateAsync({ msgs, memo: plain ? `${net.label} to ${net.name}` : `${token.label} to ${net.name} as ${net.label}` }) as { transactionHash?: string }
        const hash = res?.transactionHash ?? ''
        setStatus({ tx: hash, chain: TERRA_CHAIN_ID, text: `Sent on Terra. Arriving on ${net.name}…` })
        // Only a plain send can be recognised coming back: after a swap the Terra balance moves for other reasons too.
        if (hash) followIbc(before, () => net.balance(destination), setStatus, plain
          ? { check: cameBack(() => queryBalance(me, base.info), terraBefore, send), text: `It was not delivered, and the ${net.label} is back in your Terra wallet.` }
          : undefined)
      }
      setAmount('')
      onDone()
    } catch (e) {
      const text = String((e as Error)?.message ?? e)
      setErr(dir === 'in' && /retrieve account|account .*not found|does not exist/i.test(text) ? `This wallet has no account on ${net.name} yet. It needs some ${net.label} there first.` : humanizeTxError(e))
    } finally { setBusy(false) }
  }

  const noGas = dir === 'in' && !!srcAddr && feeBal === '0'
  const needSource = dir === 'in' || !sendTo.trim()
  const fromBal = dir === 'in' ? srcBal : terraBal
  const fromDecimals = dir === 'in' ? base.decimals : token.decimals
  const insufficient = !!micro && BigInt(micro) > BigInt(fromBal || '0')
  const canGo = !!me && !!quote && !!micro && micro !== '0' && !insufficient && !busy && (dir === 'in' ? !!srcAddr && !noGas && (!gas.active || gas.ready) : !!destination && isSourceAddress(destination))
  const turn = (d: 'in' | 'out') => { setDir(d); setAmount(''); setStatus(null); setErr(null) }
  const terraIcon = <img src='/img/terra-globe.svg' alt='' width={46} height={46} />

  return (
    <Card>
      <Section title='Bridge' />
      {switcher}
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `${SPACE['2']}px 0 ${SPACE['3']}px` }}>
        Move {net.label} between {net.name} and Terra in one signature. Arriving on Terra it can land as {net.label} or already swapped into another token; leaving Terra, any token here is swapped to {net.label} on the way out.
      </p>
      <div style={{ margin: `0 0 ${SPACE['3']}px` }}>
        <ElectricPulse
          caption='IBC'
          active={busy || (!!status && !status.done && !status.failed)}
          onSwap={() => turn(dir === 'in' ? 'out' : 'in')}
          left={dir === 'in' ? <TokenIcon label={net.label} size={40} /> : terraIcon}
          right={dir === 'in' ? terraIcon : <TokenIcon label={net.label} size={40} />}
          leftLabel={dir === 'in' ? `From · ${net.name}` : 'From · Terra'}
          rightLabel={dir === 'in' ? 'To · Terra' : `To · ${net.name}`}
        />
      </div>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['3'] }}>
        {(['in', 'out'] as const).map(d => (
          <button key={d} type='button' onClick={() => turn(d)}
            style={{ ...ghostBtn, padding: '4px 12px', color: dir === d ? C.goldLit : C.textMuted, borderColor: dir === d ? C.goldCore : C.divider }}>
            {d === 'in' ? `${net.name} → Terra` : `Terra → ${net.name}`}
          </button>
        ))}
      </div>

      <label style={label}>{dir === 'in' ? `From ${net.name}` : 'From Terra'}</label>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['2'] }}>
        <input style={field} type='number' min='0' step='any' placeholder='0.0' value={amount} onChange={e => setAmount(e.target.value)} />
        {dir === 'in'
          ? <div style={{ ...select, display: 'flex', alignItems: 'center', gap: 8, color: C.textPrimary }}><TokenIcon label={net.label} size={20} /><b>{net.label}</b></div>
          : <TokenSelect value={tokenId} onChange={setTokenId} options={outOptions} />}
      </div>
      <div style={{ ...rowStyle, marginBottom: SPACE['3'] }}>
        <span>{dir === 'in' ? (srcAddr ? `On ${net.name}: ${fromMicro(srcBal, base.decimals)} ${net.label}` : `${net.name} not connected`) : `Balance ${fromMicro(terraBal, fromDecimals)} ${token.label}`}</span>
        {Number(fromBal) > 0 && (dir === 'out' || srcAddr) && (
          <button type='button' style={{ ...ghostBtn, padding: '2px 8px' }} onClick={() => {
            // The source chain takes its network fee in the same token, so leave a little behind when moving all of it.
            const keep = dir === 'in' ? net.feeReserve : BigInt(0)
            const max = BigInt(fromBal) > keep ? BigInt(fromBal) - keep : BigInt(0)
            setAmount(fromMicro(max.toString(), fromDecimals, 6).replace(/,/g, ''))
          }}>max</button>
        )}
      </div>

      <label style={label}>{dir === 'in' ? 'Arrive on Terra as' : `To this ${net.name} address`}</label>
      {dir === 'in'
        ? <div style={{ display: 'flex', marginBottom: SPACE['3'] }}><TokenSelect value={tokenId} onChange={setTokenId} options={inOptions} style={{ flex: 1 }} /></div>
        : (
          <div style={{ marginBottom: SPACE['3'] }}>
            <input style={{ ...field, width: '100%', boxSizing: 'border-box' }} placeholder={srcAddr || `${net.prefix}1…`} value={sendTo} onChange={e => setSendTo(e.target.value)} spellCheck={false} autoComplete='off' />
            {sendTo.trim() && !isSourceAddress(sendTo.trim()) && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: 4 }}>That is not a {net.name} address.</div>}
            {sendTo.trim() && isSourceAddress(sendTo.trim()) && sendTo.trim() !== srcAddr && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Sending to someone else&apos;s address, or an exchange? Check that it accepts {net.label} on {net.name}.</div>}
            {!sendTo.trim() && srcAddr && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Your wallet&apos;s {net.name} address.</div>}
          </div>
        )}

      {(quote || quoteErr) && (
        <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: 'rgba(0,0,0,0.22)', borderRadius: 10, marginBottom: SPACE['3'] }}>
          {quoteErr
            ? <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6 }}>{quoteErr}</div>
            : quote && (
              <>
                <Row k={dir === 'in' ? 'You receive on Terra' : plain ? `You receive on ${net.name}` : `At least, on ${net.name}`} v={`${fromMicro(quote.out, dir === 'in' ? token.decimals : base.decimals, 6)} ${dir === 'in' ? token.label : net.label}`} hi />
                <Row k='How' v={quote.path} />
                <Row k='Time' v={`about ${quote.secs < 90 ? `${quote.secs} seconds` : `${Math.round(quote.secs / 60)} minutes`}`} />
                {quote.note && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5, paddingTop: 2 }}>{quote.note}</div>}
                {dir === 'in' && <GasDropRow gas={gas} from={base} sourceName={net.name} />}
              </>
            )}
        </div>
      )}

      {noGas && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>This {net.name} wallet has no {net.feeLabel}. {net.name} charges its network fee in {net.feeLabel}, so it needs a little first.</div>}
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>{err}</div>}
      {status && (
        <div style={{ fontSize: TEXT.xs.size, color: status.failed ? C.alert : status.done ? C.success : C.textSecondary, marginBottom: SPACE['2'], lineHeight: 1.6 }}>
          {status.done ? '✓ ' : ''}{status.text}{' '}
          {status.tx && <a href={status.chain === net.chainId ? net.txUrl(status.tx) : finderTx(status.tx)} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>View tx →</a>}
        </div>
      )}

      {!me
        ? <div className='terra-connect-cta'><WalletButton /></div>
        : needSource && !srcAddr
          ? <button type='button' style={primaryBtn} onClick={() => { source.connect().catch(() => {}) }}>Connect your wallet on {net.name}</button>
          : <button type='button' style={{ ...primaryBtn, opacity: canGo ? 1 : 0.5 }} disabled={!canGo} onClick={go}>
              {busy ? 'Confirm in wallet…' : insufficient ? `Not enough ${dir === 'in' ? `${net.label} on ${net.name}` : token.label}` : dir === 'in' ? 'Move to Terra' : `Move to ${net.name}`}
            </button>}

      <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.6, marginTop: SPACE['3'] }}>
        Plain transfers are ordinary IBC. A swap on arrival travels in the same transfer: Terra&apos;s IBC hooks hand the {net.label} to Terra Swap&apos;s router (no owner, no fee), which swaps it through pools listed here and sends the result to your Terra address. If less than the minimum would arrive, the transfer fails and {net.name} returns the {net.label}. {net.footnote} This page adds no fee.
      </div>
    </Card>
  )
}

type TransferStatus = { tx: string; chain: string; text: string; done?: boolean; failed?: boolean }

/**
 * About one LUNA for network fees, set aside from a transfer in while the
 * Terra wallet holds almost none (lib/gasDrop). Gives the part to set aside,
 * its router plan once priced, and what the main transfer carries.
 */
function useGasDrop(a: { me: string; incoming: boolean; from: KnownToken; target: KnownToken; amountMicro: string | null; pools: PoolView[]; refresh?: unknown }) {
  const { px } = useTokenData()
  const [terraLuna, setOpenfields] = useState<string | null>(null)
  const [on, setOn] = useState(true)
  const [priced, setPriced] = useState<{ micro: string; plan: RoutePlan } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!a.me) { setOpenfields(null); return }
    queryBalance(a.me, LUNA.info).then(setOpenfields).catch(() => {})
  }, [a.me, a.refresh])
  const wanted = a.incoming && terraLuna != null && BigInt(terraLuna || '0') < GAS_DROP_BELOW_MICRO && !sameAsset(a.target.info, LUNA.info)
  const micro = wanted ? gasDropMicro({ from: a.from, amountMicro: a.amountMicro, fromUsd: px?.[assetId(a.from.info)], lunaUsd: px?.uluna }) : null
  const { pools, from } = a
  useEffect(() => {
    if (!micro) return
    let alive = true
    planGasDrop(pools, from, micro, 0.03)
      .then(plan => { if (!alive) return; if (plan) setPriced({ micro, plan }); else setFailed(micro) })
      .catch(() => { if (alive) setFailed(micro) })
    return () => { alive = false }
  }, [micro, pools, from])
  const active = on && !!micro && failed !== micro
  const ready = active && priced?.micro === micro
  return {
    micro, on, setOn, active, ready,
    failed: !!micro && failed === micro,
    plan: ready && priced ? priced.plan : null,
    /** what the main transfer carries out of `amount` */
    main: (amount: string | null) => (active && micro && amount && BigInt(amount) > BigInt(micro) ? (BigInt(amount) - BigInt(micro)).toString() : amount),
  }
}

function GasDropRow({ gas, from, sourceName }: { gas: ReturnType<typeof useGasDrop>; from: KnownToken; sourceName: string }) {
  if (!gas.micro) return null
  return (
    <>
      <div style={{ ...rowStyle, alignItems: 'center', paddingTop: 4 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type='checkbox' checked={gas.on} onChange={e => gas.setOn(e.target.checked)} style={{ accentColor: C.goldLit }} />
          <span>Also about 1 LUNA for network fees</span>
        </label>
        <span style={{ color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {!gas.on ? 'off' : gas.failed ? 'no route right now' : gas.plan ? `≈ ${fromMicro(gas.plan.expectedOut, 6, 2)} LUNA for ${fromMicro(gas.micro, from.decimals, 4)} ${from.label}` : 'pricing…'}
        </span>
      </div>
      {gas.on && !gas.failed && (
        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5, paddingTop: 2 }}>
          Your Terra wallet has almost no LUNA, and every transaction on Terra pays its fee in LUNA. This part travels as its own transfer in the same signature and is swapped into LUNA on arrival; if that swap cannot deliver its minimum, {sourceName} returns this part and the rest still arrives.
        </div>
      )}
    </>
  )
}

/**
 * Whether an IBC transfer came back, read from the balance it left: once the
 * send shows there, a rise by the whole amount is the chain returning it (a
 * swap on arrival that could not meet its minimum, or a packet nobody relayed
 * in time).
 */
function cameBack(read: () => Promise<string>, before: string, amount: string): () => Promise<boolean> {
  let low: bigint | null = null
  return async () => {
    const now = BigInt((await read()) || '0')
    if (now + BigInt(amount) <= BigInt(before || '0')) { if (low === null || now < low) low = now; return false }
    return low !== null && now >= low + BigInt(amount)
  }
}

/** Follow an IBC transfer until the balance it should arrive in rises, or `returned` sees it come back. */
function followIbc(before: string, readDest: () => Promise<string>, setStatus: (f: (s: TransferStatus | null) => TransferStatus | null) => void, returned?: { check: () => Promise<boolean>; text: string }) {
  let n = 0
  const tick = async () => {
    n++
    const [now, back] = await Promise.all([readDest().catch(() => before), returned ? returned.check().catch(() => false) : Promise.resolve(false)])
    if (BigInt(now || '0') > BigInt(before || '0')) { setStatus(s => s && { ...s, text: 'Arrived.', done: true }); return }
    if (back && returned) { setStatus(s => s && { ...s, text: returned.text, failed: true }); return }
    if (n < 40) setTimeout(tick, 7000)
    else setStatus(s => s && { ...s, text: 'Still on its way. IBC transfers usually land within a few minutes, and one that is not delivered goes back to where it was sent from.' })
  }
  setTimeout(tick, 6000)
}

const injectiveTxUrl = (hash: string) => `https://www.mintscan.io/injective/tx/${hash}`

/** Which token to move: USDC on Noble, ATOM on the Cosmos Hub, or USDC.inj on Injective. The two dollars are separate tokens, never swapped for each other here. */
function TransferPanel({ routePools, onDone, initialNet = 'noble' }: { routePools: PoolView[]; onDone: () => void; initialNet?: NetKey }) {
  const [net, setNet] = useState<NetKey>(initialNet)
  const chain = BRIDGE_CHAINS.find(c => c.tokens.some(([k]) => k === net)) ?? BRIDGE_CHAINS[0]
  const switcher = (
    <div style={{ display: 'grid', gap: 6, marginTop: SPACE['2'] }}>
      <div role='tablist' aria-label='Which chain' style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE['2'] }}>
        {BRIDGE_CHAINS.map(c => {
          const on = c === chain
          return (
            <button key={c.name} type='button' role='tab' aria-selected={on} onClick={() => setNet(c.tokens[0][0])}
              title={`${c.tokens.map(([, label]) => label).join(', ')} on ${c.name}`}
              style={{ ...ghostBtn, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 7, color: on ? C.goldLit : C.textMuted, borderColor: on ? C.goldCore : C.divider }}>
              {/* The marks say which tokens; the chain keeps its name, because a row of
                  coins alone does not tell anyone where the tokens are coming from. */}
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center' }}>
                {c.tokens.map(([k, label], i) => (
                  <TokenIcon key={k} label={label} size={15} style={i > 0 ? { marginLeft: -5 } : undefined} />
                ))}
              </span>
              {c.name}
            </button>
          )
        })}
      </div>
      {chain.tokens.length > 1 && (
        <div role='tablist' aria-label='Which token to move' style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chain.tokens.map(([k, label]) => (
            <button key={k} type='button' role='tab' aria-selected={net === k} onClick={() => setNet(k)}
              style={{ ...ghostBtn, padding: '2px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6, color: net === k ? C.goldLit : C.textMuted, borderColor: net === k ? C.goldCore : C.divider }}>
              <TokenIcon label={label} size={14} />{label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
  return net === 'injective'
    ? <InjectiveTransfer routePools={routePools} onDone={onDone} switcher={switcher} />
    : <CosmosTransfer key={net} net={SOURCE_CHAINS[net]} routePools={routePools} onDone={onDone} switcher={switcher} />
}

/**
 * USDC.inj between Injective and Terra: ordinary IBC both ways. It leaves
 * Injective as Circle's USDC and arrives on Terra as USDC.inj, a token of its
 * own that this site never exchanges for, or counts as, USDC from Noble.
 * Arriving, it can also be swapped into another token by Terra Swap's router
 * through Terra's IBC hooks, never into USDC from Noble and never through a
 * pool holding both.
 */
function InjectiveTransfer({ routePools, onDone, switcher }: { routePools: PoolView[]; onDone: () => void; switcher: JSX.Element }) {
  const me = useMyAddress()
  const injective = useChain('injective')
  const injectiveMsgs = useInjectiveMsgs()
  const terraMsgs = useTerraMsgs()
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [injTo, setInjTo] = useState('')
  const [injBal, setInjBal] = useState('0')
  const [injGas, setInjGas] = useState<string | null>(null)
  const [terraBal, setTerraBal] = useState('0')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const token = useMemo(() => tokenFor({ native_token: { denom: USDC_INJ_DENOM } }), [])
  const micro = toMicro(amount, 6)
  const injAddr = injective.address ?? ''
  const typed = injTo.trim()
  const typedAddr = typed ? toInjectiveAddress(typed) : null
  const destination = typed ? typedAddr ?? '' : injAddr

  // Swap on arrival: through any pool that does not hold USDC from Noble, into anything but USDC from Noble.
  const SLIP = 0.01
  const [targetId, setTargetId] = useState(USDC_INJ_DENOM)
  const [quote, setQuote] = useState<{ plan: RoutePlan; path: string } | null>(null)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const pools = useMemo(() => routePools.filter(p => !p.tokens.some(t => assetId(t.info) === NOBLE_USDC)), [routePools])
  const arriveOptions = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of pools) for (const t of p.tokens) m.set(assetId(t.info), t)
    return TERRA_SWAP_ROUTER ? [token, ...reachable(pools, token, Array.from(m.values()))] : [token]
  }, [pools, token])
  useEffect(() => { if (!arriveOptions.some(t => assetId(t.info) === targetId)) setTargetId(USDC_INJ_DENOM) }, [arriveOptions, targetId])
  const target = arriveOptions.find(t => assetId(t.info) === targetId) ?? token
  const plain = dir === 'out' || targetId === USDC_INJ_DENOM
  const debounced = useDebounced(micro, 400)
  const gas = useGasDrop({ me, incoming: dir === 'in', from: token, target, amountMicro: debounced, pools, refresh: status?.done })
  const mainDebounced = gas.main(debounced)
  useEffect(() => {
    let alive = true
    setQuote(null); setQuoteErr(null)
    if (plain || !mainDebounced || mainDebounced === '0') return
    // One path through up to two pools, for the same reason as from Noble: it runs inside the relayer's transaction.
    quoteBest(pools, token, target, mainDebounced, HOME_VENUE, { slip: SLIP, threeHop: false }).then(q => {
      if (!alive) return
      const plan = q.best ? routerPlan(q.best, SLIP) : null
      if (!q.best || !plan) { setQuoteErr(`No route from USDC.inj to ${target.label} through up to two pools right now. Bring USDC.inj to Terra and swap it here.`); return }
      setQuote({ plan, path: `IBC transfer to Terra, swapped on arrival by Terra Swap's router: ${routeText(q.best)}` })
    }).catch(() => { if (alive) setQuoteErr('Could not price that right now.') })
    return () => { alive = false }
  }, [plain, mainDebounced, pools, token, target])

  useEffect(() => {
    if (!injAddr) { setInjBal('0'); setInjGas(null); return }
    injectiveBalance(injAddr, USDC_INJ_ON_INJECTIVE).then(setInjBal).catch(() => {})
    injectiveBalance(injAddr, 'inj').then(setInjGas).catch(() => {})
  }, [injAddr, status?.done])
  useEffect(() => {
    if (!me) { setTerraBal('0'); return }
    queryBalance(me, token.info).then(setTerraBal).catch(() => {})
  }, [me, token, status?.done])

  const turn = (d: 'in' | 'out') => { setDir(d); setAmount(''); setStatus(null); setErr(null) }
  const follow = (hash: string, before: string, readDest: () => Promise<string>) => { if (hash) followIbc(before, readDest, setStatus) }

  const go = async () => {
    setErr(null); setStatus(null)
    if (!micro || micro === '0') return
    setBusy(true)
    try {
      if (!me) throw new Error('Connect your wallet first')
      if (dir === 'in') {
        if (!injAddr) throw new Error('Connect your wallet on Injective first')
        if (!plain && !quote) throw new Error('Wait for the price, then try again')
        const [before, injBefore] = await Promise.all([queryBalance(me, target.info), injectiveBalance(injAddr, USDC_INJ_ON_INJECTIVE)])
        const send = gas.ready ? gas.main(micro) ?? micro : micro
        const drop = gas.ready && gas.plan && gas.micro
          ? [arrivalSwapMsg({ sender: injAddr, terraAddress: me, channel: INJECTIVE_TO_TERRA_CHANNEL, sourceDenom: USDC_INJ_ON_INJECTIVE, terraDenom: USDC_INJ_DENOM, amount: gas.micro, plan: gas.plan })]
          : []
        const hash = await injectiveMsgs.mutateAsync({
          msgs: [
            plain
              ? ibcTransferMsg({ sender: injAddr, receiver: me, channel: INJECTIVE_TO_TERRA_CHANNEL, denom: USDC_INJ_ON_INJECTIVE, amount: send })
              : arrivalSwapMsg({ sender: injAddr, terraAddress: me, channel: INJECTIVE_TO_TERRA_CHANNEL, sourceDenom: USDC_INJ_ON_INJECTIVE, terraDenom: USDC_INJ_DENOM, amount: send, plan: quote!.plan }),
            ...drop,
          ],
          memo: `${plain ? 'USDC.inj to Terra' : `USDC.inj to Terra as ${target.label}`}${drop.length ? ', and LUNA for fees' : ''}`,
        })
        setStatus({ tx: hash, chain: INJECTIVE_CHAIN_ID, text: `Sent on Injective. Arriving on Terra as ${target.label}…` })
        if (hash) followIbc(before, () => queryBalance(me, target.info), setStatus, plain ? undefined : {
          check: cameBack(() => injectiveBalance(injAddr, USDC_INJ_ON_INJECTIVE), injBefore, send),
          text: `The swap into ${target.label} could not deliver its minimum, so the transfer failed and the USDC.inj is back on Injective. Nothing was swapped.`,
        })
      } else {
        if (!destination) throw new Error('Enter an Injective address (inj1… or 0x…), or connect your wallet on Injective')
        const before = await injectiveBalance(destination, USDC_INJ_ON_INJECTIVE).catch(() => '0')
        const res = await terraMsgs.mutateAsync({
          msgs: [ibcTransferMsg({ sender: me, receiver: destination, channel: TERRA_TO_INJECTIVE_CHANNEL, denom: USDC_INJ_DENOM, amount: micro })],
          memo: 'USDC.inj to Injective',
        }) as { transactionHash?: string }
        const hash = res?.transactionHash ?? ''
        setStatus({ tx: hash, chain: TERRA_CHAIN_ID, text: 'Sent on Terra. Arriving on Injective…' })
        follow(hash, before, () => injectiveBalance(destination, USDC_INJ_ON_INJECTIVE))
      }
      setAmount('')
      onDone()
    } catch (e) {
      setErr(humanizeTxError(e))
    } finally { setBusy(false) }
  }

  const fromBal = dir === 'in' ? injBal : terraBal
  const insufficient = !!micro && BigInt(micro) > BigInt(fromBal || '0')
  const noGas = dir === 'in' && !!injAddr && injGas === '0'
  const needInjective = dir === 'in' || !typed
  const canGo = !!me && !!micro && micro !== '0' && !insufficient && !busy && (dir === 'in' ? !!injAddr && !noGas && (!gas.active || gas.ready) && (plain || (!!quote && quote.plan.legs[0]?.offerAmount === (gas.ready ? gas.main(micro) : micro))) : !!destination)
  const injIcon = <TokenIcon label='INJ' size={40} />
  const terraIcon = <img src='/img/terra-globe.svg' alt='' width={46} height={46} />

  return (
    <Card>
      <Section title='Bridge' />
      {switcher}
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `${SPACE['2']}px 0 ${SPACE['3']}px` }}>
        Move USDC.inj, Circle&apos;s USDC as issued on Injective, between Injective and Terra in one signature. On Terra it is USDC.inj, a token of its own with its own pools; arriving, it can stay USDC.inj or be swapped into another token, never into USDC from Noble.
      </p>
      <div style={{ margin: `0 0 ${SPACE['3']}px` }}>
        <ElectricPulse
          caption='IBC'
          active={busy || (!!status && !status.done && !status.failed)}
          onSwap={() => turn(dir === 'in' ? 'out' : 'in')}
          left={dir === 'in' ? injIcon : terraIcon}
          right={dir === 'in' ? terraIcon : injIcon}
          leftLabel={dir === 'in' ? 'From · Injective' : 'From · Terra'}
          rightLabel={dir === 'in' ? 'To · Terra' : 'To · Injective'}
        />
      </div>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['3'] }}>
        {(['in', 'out'] as const).map(d => (
          <button key={d} type='button' onClick={() => turn(d)}
            style={{ ...ghostBtn, padding: '4px 12px', color: dir === d ? C.goldLit : C.textMuted, borderColor: dir === d ? C.goldCore : C.divider }}>
            {d === 'in' ? 'Injective → Terra' : 'Terra → Injective'}
          </button>
        ))}
      </div>

      <label style={label}>{dir === 'in' ? 'From Injective' : 'From Terra'}</label>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['2'] }}>
        <input style={field} type='number' min='0' step='any' placeholder='0.0' value={amount} onChange={e => setAmount(e.target.value)} />
        <div style={{ ...select, display: 'flex', alignItems: 'center', gap: 8, color: C.textPrimary }}><TokenIcon label='USDC.inj' size={20} /><b>USDC.inj</b></div>
      </div>
      <div style={{ ...rowStyle, marginBottom: SPACE['3'] }}>
        <span>{dir === 'in' ? (injAddr ? `On Injective: ${fromMicro(injBal, 6)} USDC.inj` : 'Injective not connected') : `Balance ${fromMicro(terraBal, 6)} USDC.inj`}</span>
        {Number(fromBal) > 0 && (dir === 'out' || injAddr) && (
          // Injective takes its fee in INJ, so all of the USDC.inj can go.
          <button type='button' style={{ ...ghostBtn, padding: '2px 8px' }} onClick={() => setAmount(fromMicro(fromBal, 6, 6).replace(/,/g, ''))}>max</button>
        )}
      </div>

      {dir === 'in' && (
        <>
          <label style={label}>Arrive on Terra as</label>
          <div style={{ display: 'flex', marginBottom: SPACE['3'] }}><TokenSelect value={targetId} onChange={setTargetId} options={arriveOptions} style={{ flex: 1 }} /></div>
        </>
      )}
      {dir === 'out' && (
        <>
          <label style={label}>To this Injective address</label>
          <div style={{ marginBottom: SPACE['3'] }}>
            <input style={{ ...field, width: '100%', boxSizing: 'border-box' }} placeholder={injAddr || 'inj1… or 0x…'} value={injTo} onChange={e => setInjTo(e.target.value)} spellCheck={false} autoComplete='off' />
            {typed && !typedAddr && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: 4 }}>That is not an Injective address.</div>}
            {typedAddr && /^0x/i.test(typed) && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Goes to {typedAddr}, the same Injective account as that 0x address.</div>}
            {typedAddr && typedAddr !== injAddr && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Sending to someone else&apos;s address, or an exchange? Check that it accepts USDC on Injective arriving over IBC.</div>}
            {!typed && injAddr && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Your wallet&apos;s Injective address.</div>}
          </div>
        </>
      )}

      {!!micro && micro !== '0' && (
        <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: 'rgba(0,0,0,0.22)', borderRadius: 10, marginBottom: SPACE['3'] }}>
          {plain
            ? <>
                <Row k={dir === 'in' ? 'You receive on Terra' : 'You receive on Injective'} v={`${fromMicro(dir === 'in' && gas.ready ? gas.main(micro) ?? micro : micro, 6, 6)} USDC.inj`} hi />
                <Row k='How' v={dir === 'in' ? 'IBC transfer from Injective to Terra' : 'IBC transfer from Terra to Injective'} />
              </>
            : quoteErr
              ? <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6 }}>{quoteErr}</div>
              : quote
                ? <>
                    <Row k='You receive on Terra' v={`${fromMicro(quote.plan.expectedOut, target.decimals, 6)} ${target.label}`} hi />
                    <Row k='How' v={quote.path} />
                    <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5, paddingTop: 2 }}>At least {fromMicro(quote.plan.minOut, target.decimals, 6)} {target.label} arrives, or the swap does not happen and Injective returns the USDC.inj to you.</div>
                  </>
                : <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Pricing the swap on arrival…</div>}
          {dir === 'in' && <GasDropRow gas={gas} from={token} sourceName='Injective' />}
          <Row k='Time' v={plain ? 'about 30 seconds' : 'about 45 seconds'} />
          <Row k='Network fee' v={dir === 'in' ? 'a little INJ, on Injective' : 'a little LUNA, on Terra'} />
        </div>
      )}

      {noGas && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>This Injective wallet has no INJ. Injective charges its network fee in INJ, so it needs a little first.</div>}
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>{err}</div>}
      {status && (
        <div style={{ fontSize: TEXT.xs.size, color: status.failed ? C.alert : status.done ? C.success : C.textSecondary, marginBottom: SPACE['2'], lineHeight: 1.6 }}>
          {status.done ? '✓ ' : ''}{status.text}{' '}
          {status.tx && <a href={status.chain === INJECTIVE_CHAIN_ID ? injectiveTxUrl(status.tx) : finderTx(status.tx)} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>View tx →</a>}
        </div>
      )}

      {!me
        ? <div className='terra-connect-cta'><WalletButton /></div>
        : needInjective && !injAddr
          ? <button type='button' style={primaryBtn} onClick={() => { injective.connect().catch(() => {}) }}>Connect your wallet on Injective</button>
          : <button type='button' style={{ ...primaryBtn, opacity: canGo ? 1 : 0.5 }} disabled={!canGo} onClick={go}>
              {busy ? 'Confirm in wallet…' : insufficient ? `Not enough USDC.inj${dir === 'in' ? ' on Injective' : ''}` : dir === 'in' ? 'Move to Terra' : 'Move to Injective'}
            </button>}

      <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.6, marginTop: SPACE['3'] }}>
        Ordinary IBC over the channel between Injective and Terra, in both directions. A swap on arrival travels in the same transfer: Terra&apos;s IBC hooks hand the USDC.inj to Terra Swap&apos;s router (no owner, no fee), which swaps it and sends the result to your Terra address; if less than the minimum would arrive, the transfer fails and Injective returns the USDC.inj. Injective charges its network fee in INJ. This page adds no fee.
      </div>
    </Card>
  )
}

function PositionsPanel({ onDone, flows }: { onDone: () => void; flows?: Record<string, LpFlow> }) {
  const me = useMyAddress()
  const exit = useExitPosition()
  const unstake = useUnstake()
  const claim = useClaimRewards()
  const stake = useStakeLp()
  const astroExit = useAstroLegacyExit()
  const withdrawLst = useLstWithdraw()
  const { px: tokenPx } = useTokenData()
  const day = (s: number | null) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : 'soon')
  const [data, setData] = useState<PositionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  useEffect(() => {
    if (!me) { setData(null); return }
    let alive = true
    setLoading(true)
    fetch(`/api/positions?address=${me}${reload ? `&_=${reload}` : ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: PositionsResponse | null) => { if (alive && j?.positions) setData(j) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [me, reload])

  const run = async (key: string, f: () => Promise<unknown>, msg: string) => {
    setErr(null); setOk(null); setBusy(key)
    try {
      await f()
      setOk(msg); onDone()
      // The block lands in ~6s and the LCD indexes a moment later.
      ;[5000, 11000].forEach(ms => setTimeout(() => setReload(Date.now()), ms))
    } catch (e) { setErr(humanizeTxError(e)) } finally { setBusy(null) }
  }

  if (!me) {
    return (
      <Card>
        <Section title='Your positions' />
        <p style={{ fontSize: TEXT.sm.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
          Connect a wallet to see every pool position it holds on Terra Swap and Astroport, LP staked in Astroport&apos;s incentives included, and to leave any of them from here.
        </p>
        <div className='terra-connect-cta'><WalletButton /></div>
      </Card>
    )
  }

  const positions = data?.positions ?? []
  const incentives = data?.incentives ?? null
  const claimable = positions.filter(p => p.pending.length > 0)
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'] }}>
        <Section title='Your positions' />
        <button type='button' onClick={() => setReload(Date.now())} style={{ ...ghostBtn, marginLeft: 'auto', padding: '2px 8px' }} disabled={loading}>{loading ? 'reading…' : 'refresh'}</button>
      </div>
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
        Every pool position this wallet holds on Terra Swap and Astroport, including LP staked in Astroport&apos;s incentives contract, and any old ASTRO. Withdrawing takes one signature: it unstakes what it needs and sends both tokens to your wallet.
      </p>
      {loading && !data && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading your positions from the chain…</div>}
      {data && positions.length === 0 && !(data.astro && (data.astro.xastro !== '0' || data.astro.astroCw20 !== '0')) && !(data.unstaking?.length) && <div style={{ fontSize: TEXT.sm.size, color: C.textMuted }}>No pool positions found for this wallet.</div>}
      {incentives && claimable.length > 0 && (
        <button type='button' style={{ ...primaryBtn, marginBottom: SPACE['3'], opacity: busy ? 0.5 : 1 }} disabled={!!busy}
          onClick={() => run('claim', () => claim.mutateAsync({ incentives, lpTokens: claimable.map(p => p.pool.liquidity_token), sender: me }), 'Rewards claimed to your wallet.')}>
          {busy === 'claim' ? 'Confirm in wallet…' : `Claim rewards from ${claimable.length} pool${claimable.length === 1 ? '' : 's'}`}
        </button>
      )}
      {data?.astro && (data.astro.xastro !== '0' || data.astro.astroCw20 !== '0') && (() => {
        const ax = data.astro
        // Convert what unstaking returns (a hair under the estimate, in case the ratio moves) plus what is already held.
        const convertAmount = (BigInt(ax.astroCw20) + (BigInt(ax.leaveEstimate) * BigInt(9_999)) / BigInt(10_000)).toString()
        // The converter pays out of its own balance and nothing else. It held none on 2026-09-13 and every
        // conversion failed with "insufficient funds", so only offer one it can actually pay.
        const canConvert = BigInt(ax.converterFunds || '0') >= BigInt(convertAmount)
        const hasX = ax.xastro !== '0'
        return (
          <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.dividerWarm}`, display: 'grid', gap: 2, marginBottom: SPACE['3'] }}>
            <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>Old ASTRO on Terra</b>
            {ax.xastro !== '0' && <div style={rowStyle}><span>xASTRO in the first staking</span><span style={{ color: C.textSecondary }}>{fromMicro(ax.xastro, 6)} · unstakes to about {fromMicro(ax.leaveEstimate, 6)} ASTRO.cw20</span></div>}
            {ax.astroCw20 !== '0' && <div style={rowStyle}><span>ASTRO.cw20 in wallet</span><span style={{ color: C.textSecondary }}>{fromMicro(ax.astroCw20, 6)}</span></div>}
            <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.5 }}>
              {canConvert
                ? <>Astroport now uses the ASTRO that comes over IBC from Neutron. This {hasX ? 'unstakes the xASTRO and ' : ''}converts all ASTRO.cw20 through Astroport&apos;s own converter, in one signature.</>
                : <>Astroport&apos;s converter to today&apos;s ASTRO has nothing left to pay out right now, so a conversion would fail. {hasX ? 'Unstaking still works and returns ASTRO.cw20 to your wallet.' : 'The ASTRO.cw20 stays in your wallet.'}</>}
            </div>
            {(canConvert || hasX) && (
              <button type='button' disabled={!!busy} style={{ ...primaryBtn, marginTop: 4, opacity: busy && busy !== 'astro' ? 0.5 : 1 }}
                onClick={() => run('astro', () => astroExit.mutateAsync({
                  staking: ASTRO_STAKING, xastro: XASTRO_CW20, converter: ASTRO_CONVERTER, astroCw20: ASTRO_CW20,
                  xastroAmount: ax.xastro, convertAmount: canConvert ? convertAmount : '0', sender: me,
                }), canConvert ? 'Done. The ASTRO is in your wallet.' : 'Unstaked. The ASTRO.cw20 is in your wallet.')}>
                {busy === 'astro' ? 'Confirm in wallet…' : canConvert ? (hasX ? 'Unstake and convert to ASTRO' : 'Convert to ASTRO') : 'Unstake to ASTRO.cw20'}
              </button>
            )}
          </div>
        )
      })()}
      {(data?.unstaking ?? []).length > 0 && (
        <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.dividerWarm}`, display: 'grid', gap: 2, marginBottom: SPACE['3'] }}>
          <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>Unstaking at liquid staking hubs</b>
          {(data?.unstaking ?? []).map(u => (
            <div key={u.hub} style={{ display: 'grid', gap: 2, marginTop: 4 }}>
              {u.requests.map(r => (
                <div key={`${u.hub}:${r.batch}`} style={rowStyle}>
                  <span>{u.key} at {u.provider}</span>
                  <span style={{ color: r.status === 'ready' ? C.success : C.textSecondary }}>
                    about {fromMicro(r.lunaMicro, 6)} LUNA · {r.status === 'ready'
                      ? 'ready to withdraw'
                      : r.status === 'queued'
                        ? `in the next batch, ready about ${day(r.readyAt)}`
                        : r.readyAt && r.readyAt * 1000 < Date.now() ? `settling at ${u.provider}` : `ready about ${day(r.readyAt)}`}
                  </span>
                </div>
              ))}
              {BigInt(u.readyMicro) > BigInt(0) && (
                <button type='button' disabled={!!busy} style={{ ...primaryBtn, marginTop: 4, opacity: busy && busy !== `lst:${u.hub}` ? 0.5 : 1 }}
                  onClick={() => run(`lst:${u.hub}`, () => withdrawLst.mutateAsync({ hub: u.hub, sender: me }), `Withdrawn from ${u.provider}. The LUNA is in your wallet.`)}>
                  {busy === `lst:${u.hub}` ? 'Confirm in wallet…' : `Withdraw ${fromMicro(u.readyMicro, 6)} LUNA from ${u.provider}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gap: SPACE['2'] }}>
        {positions.map(pos => {
          const { pool } = pos
          const [t0, t1] = pool.tokens
          const key = pool.contract_addr
          const total = BigInt(pos.walletLp || '0') + BigInt(pos.stakedLp || '0')
          const part = (pct: number) => ((total * BigInt(pct)) / BigInt(100)).toString()
          const staked = BigInt(pos.stakedLp || '0') > BigInt(0)
          return (
            <div key={key} style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.divider}`, display: 'grid', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flexWrap: 'wrap' }}>
                <PairIcons a={t0.label} b={t1.label} size={18} />
                <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{pool.label}</b>
                <span style={{ fontSize: TEXT.caption.size, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted }}>{VENUE_NAME[pool.venue]}</span>
                {pos.usd != null && <span style={{ marginLeft: 'auto', color: C.goldLit, fontWeight: 700, fontSize: TEXT.sm.size }}>{fmtUsd(pos.usd)}</span>}
              </div>
              <div style={rowStyle}><span>Claim on</span><span style={{ color: C.textSecondary }}>{fmtAmount(pos.amounts[0])} {t0.label} + {fmtAmount(pos.amounts[1])} {t1.label}</span></div>
              <PutInRow flow={data?.flows?.[`${me}|${key}`] ?? flows?.[`${me}|${key}`]} tokens={pool.tokens} amounts={pos.amounts} usd={pos.usd} px={tokenPx} />
              <div style={rowStyle}>
                <span>LP</span>
                <span style={{ color: C.textSecondary }}>{fromMicro(pos.walletLp, 6)} in wallet{staked ? ` · ${fromMicro(pos.stakedLp, 6)} staked in Astroport Incentives` : ''}</span>
              </div>
              {pos.pending.length > 0 && (
                <div style={rowStyle}><span>Pending rewards</span><span style={{ color: C.success }}>{pos.pending.map(r => `${fromMicro(r.amount, r.token.decimals)} ${r.token.label}`).join(' · ')}</span></div>
              )}
              <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap', marginTop: 4 }}>
                {[25, 50, 100].map(pct => (
                  <button key={pct} type='button' disabled={!!busy}
                    style={{ ...ghostBtn, padding: '3px 10px', color: pct === 100 ? C.goldLit : C.textSecondary, borderColor: pct === 100 ? C.goldCore : C.divider, opacity: busy && busy !== `${key}:${pct}` ? 0.5 : 1 }}
                    onClick={() => run(`${key}:${pct}`, () => exit.mutateAsync({
                      pair: key, lpToken: pool.liquidity_token, incentives: VENUE_INCENTIVES[pool.venue],
                      walletLp: pos.walletLp, stakedLp: pos.stakedLp, amount: part(pct), sender: me,
                    }), pct === 100 ? `Left ${pool.label}. Both tokens are in your wallet.` : `Withdrew ${pct}% of ${pool.label}.`)}>
                    {busy === `${key}:${pct}` ? 'Confirm in wallet…' : pct === 100 ? 'Withdraw all' : `Withdraw ${pct}%`}
                  </button>
                ))}
                {staked && incentives && (
                  <button type='button' disabled={!!busy} style={{ ...ghostBtn, padding: '3px 10px', opacity: busy && busy !== `${key}:unstake` ? 0.5 : 1 }}
                    onClick={() => run(`${key}:unstake`, () => unstake.mutateAsync({ incentives, lpToken: pool.liquidity_token, amount: pos.stakedLp, sender: me }), 'Unstaked. The LP is back in your wallet.')}>
                    {busy === `${key}:unstake` ? 'Confirm in wallet…' : 'Unstake only'}
                  </button>
                )}
                {pos.rewardsActive && incentives && BigInt(pos.walletLp || '0') > BigInt(0) && (
                  <button type='button' disabled={!!busy} style={{ ...ghostBtn, padding: '3px 10px', opacity: busy && busy !== `${key}:stake` ? 0.5 : 1 }}
                    onClick={() => run(`${key}:stake`, () => stake.mutateAsync({ incentives, lpToken: pool.liquidity_token, amount: pos.walletLp, sender: me }), 'Staked in Astroport Incentives.')}>
                    {busy === `${key}:stake` ? 'Confirm in wallet…' : 'Stake for rewards'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: SPACE['2'] }}>{err}</div>}
      {ok && <div style={{ fontSize: TEXT.xs.size, color: C.success, marginTop: SPACE['2'] }}>✓ {ok}</div>}
    </Card>
  )
}

// ─── Wallet: what it holds, and the leftovers sold in one go ────

/**
 * Every listed token in the connected wallet with its value, and a way to
 * sell the small leftover balances in one signature (lib/sweep): tick them,
 * pick USDC or LUNA, sign once. Balances under $10 start ticked. LUNA never
 * does, and sweeping it always leaves one LUNA behind for fees.
 */
function WalletPanel({ pools, onDone }: { pools: PoolView[]; onDone: () => void }) {
  const me = useMyAddress()
  const { px } = useTokenData()
  const send = useTerraMsgs()
  const [bal, setBal] = useState<Record<string, string> | null>(null)
  const [reload, setReload] = useState(0)
  const [targetKey, setTargetKey] = useState<'USDC' | 'LUNA'>('USDC')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [touched, setTouched] = useState(false)
  const [lines, setLines] = useState<SweepLine[] | null>(null)
  const [pricing, setPricing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<{ text: string; tx: string } | null>(null)
  const SLIP = 0.02
  const tokens = useMemo(() => {
    const m = new Map<string, KnownToken>()
    for (const p of pools) for (const t of p.tokens) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [pools])
  const target = useMemo(() => KNOWN_TOKENS.find(t => t.key === targetKey) ?? LUNA, [targetKey])

  useEffect(() => {
    if (!me || tokens.length === 0) { setBal(null); return }
    let alive = true
    if (reload) balanceCache.delete(me)
    walletBalances(me, tokens).then(b => { if (alive) setBal(b) }).catch(() => {})
    return () => { alive = false }
  }, [me, tokens, reload])

  const holdings = useMemo(() => {
    if (!bal) return []
    return tokens
      .map(t => {
        const micro = bal[assetId(t.info)] ?? '0'
        const p = px?.[assetId(t.info)]
        return { token: t, micro, usd: p ? (Number(micro) / 10 ** t.decimals) * p : null }
      })
      .filter(h => h.micro !== '0')
      .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))
  }, [bal, tokens, px])

  /** What of a holding a sweep into the target can sell, smallest units, or null. */
  const sellable = useCallback((h: { token: KnownToken; micro: string }) => {
    if (sameAsset(h.token.info, target.info) || poolsFor(pools, h.token, target).length === 0) return null
    const keep = assetId(h.token.info) === 'uluna' ? SWEEP_KEEP_LUNA_MICRO : BigInt(0)
    const can = BigInt(h.micro) - keep
    return can > BigInt(0) ? can.toString() : null
  }, [pools, target])

  // Small balances start ticked, until the person ticks something themselves.
  useEffect(() => {
    if (touched) return
    const next = new Set<string>()
    for (const h of holdings) {
      if (next.size >= SWEEP_MAX) break
      if (h.usd != null && h.usd < 10 && assetId(h.token.info) !== 'uluna' && sellable(h)) next.add(assetId(h.token.info))
    }
    setPicked(next)
  }, [holdings, sellable, touched])

  const picks: SweepPick[] = holdings
    .filter(h => picked.has(assetId(h.token.info)))
    .map(h => ({ token: h.token, micro: sellable(h) ?? '0' }))
    .filter(p => p.micro !== '0')
  const pickKey = `${targetKey}|${picks.map(p => `${assetId(p.token.info)}:${p.micro}`).join(',')}`
  const picksRef = useRef(picks)
  picksRef.current = picks
  useEffect(() => {
    setLines(null)
    const now = picksRef.current
    if (now.length === 0) { setPricing(false); return }
    let alive = true
    setPricing(true)
    const t = setTimeout(() => {
      planSweep(pools, now, target, SLIP)
        .then(l => { if (alive) setLines(l) })
        .catch(() => {})
        .finally(() => { if (alive) setPricing(false) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey])

  const ready = (lines ?? []).filter((l): l is SweepLine & { plan: RoutePlan } => !!l.plan)
  const totalOut = ready.reduce((s, l) => s + BigInt(l.plan.expectedOut), BigInt(0))
  const totalMin = ready.reduce((s, l) => s + BigInt(l.plan.minOut), BigInt(0))
  const canGo = !!me && ready.length > 0 && !busy && !pricing

  const toggle = (id: string, on: boolean) => {
    setTouched(true)
    setPicked(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  }

  const go = async () => {
    if (!canGo) return
    setErr(null); setOk(null); setBusy(true)
    try {
      const msgs = ready.flatMap(l => routeMsgs(me, l.plan, SLIP))
      const r = await send.mutateAsync({ msgs, memo: `sweep ${ready.length} token${ready.length === 1 ? '' : 's'} into ${target.label}` }) as { transactionHash?: string }
      setOk({ text: `Sold ${ready.map(l => l.token.label).join(', ')} into ${target.label}.`, tx: r?.transactionHash ?? '' })
      setTouched(true); setPicked(new Set()); setLines(null)
      onDone()
      ;[5000, 11000].forEach(ms => setTimeout(() => setReload(Date.now()), ms))
    } catch (e) { setErr(humanizeTxError(e)) } finally { setBusy(false) }
  }

  if (!me) {
    return (
      <Card>
        <Section title='Your wallet' />
        <p style={{ fontSize: TEXT.sm.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
          Connect a wallet to see every listed token it holds with its value, and to sell small leftover balances into USDC or LUNA in one signature.
        </p>
        <div className='terra-connect-cta'><WalletButton /></div>
      </Card>
    )
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'] }}>
        <Section title='Your wallet' />
        <button type='button' onClick={() => setReload(Date.now())} style={{ ...ghostBtn, marginLeft: 'auto', padding: '2px 8px' }}>refresh</button>
      </div>
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
        Every listed token in this wallet, with its value at market prices. Tick the small balances you would rather not keep, pick what they become, and sell them all in one signature, up to {SWEEP_MAX} at a time.
      </p>
      {!bal && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading the wallet…</div>}
      {bal && holdings.length === 0 && <div style={{ fontSize: TEXT.sm.size, color: C.textMuted }}>This wallet holds none of the tokens listed here.</div>}
      {holdings.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flexWrap: 'wrap', marginBottom: SPACE['2'], fontSize: TEXT.xs.size, color: C.textMuted }}>
            <span>Sell the ticked ones into</span>
            {(['USDC', 'LUNA'] as const).map(k => (
              <button key={k} type='button' onClick={() => { setTargetKey(k); setTouched(false) }}
                style={{ ...ghostBtn, padding: '2px 10px', display: 'inline-flex', alignItems: 'center', gap: 6, color: targetKey === k ? C.goldLit : C.textMuted, borderColor: targetKey === k ? C.goldCore : C.divider }}>
                <TokenIcon label={k} size={14} />{k}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {holdings.map(h => {
              const id = assetId(h.token.info)
              const can = sellable(h)
              const on = picked.has(id)
              const line = lines?.find(l => assetId(l.token.info) === id)
              const why = sameAsset(h.token.info, target.info) ? 'what they become' : id === 'uluna' ? 'one LUNA stays for fees' : `never swapped for ${target.label} here`
              return (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], padding: '6px 10px', background: C.surface, borderRadius: 10, border: `1px solid ${on ? C.goldCore : C.divider}`, cursor: can ? 'pointer' : 'default', opacity: can ? 1 : 0.65 }}>
                  <input type='checkbox' checked={on} disabled={!can || busy || (!on && picked.size >= SWEEP_MAX)} onChange={e => toggle(id, e.target.checked)} style={{ accentColor: C.goldLit }} />
                  <TokenIcon label={h.token.label} size={20} />
                  <span style={{ display: 'grid', minWidth: 0 }}>
                    <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{h.token.label}</b>
                    <span style={{ color: C.textMuted, fontSize: TEXT.xs.size, fontVariantNumeric: 'tabular-nums' }}>{fromMicro(h.micro, h.token.decimals, 6)}</span>
                  </span>
                  <span style={{ marginLeft: 'auto', textAlign: 'right', fontSize: TEXT.xs.size, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                    {h.usd != null ? fmtUsd(h.usd) : '—'}
                    {!can && <span style={{ display: 'block', color: C.textWhisper }}>{why}</span>}
                    {can && on && (line
                      ? <span style={{ display: 'block', color: line.plan ? C.success : C.emberLit }}>{line.plan ? `→ ${fromMicro(line.plan.expectedOut, target.decimals, 4)} ${target.label}` : line.why}</span>
                      : pricing ? <span style={{ display: 'block', color: C.textWhisper }}>pricing…</span> : null)}
                  </span>
                </label>
              )
            })}
          </div>
          {picks.length > 0 && (
            <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: 'rgba(0,0,0,0.22)', borderRadius: 10, marginTop: SPACE['3'] }}>
              <Row k='You receive' v={lines ? `${fromMicro(totalOut.toString(), target.decimals, 4)} ${target.label}` : 'pricing…'} hi />
              {lines && ready.length > 0 && <Row k={`At least (${SLIP * 100}% slippage on each)`} v={`${fromMicro(totalMin.toString(), target.decimals, 4)} ${target.label}`} />}
              <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5, paddingTop: 2 }}>
                One transaction, one swap per token, each through its best path on either site with its own minimum. If any of them would arrive short, nothing is sold.
              </div>
            </div>
          )}
          {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: SPACE['2'] }}>{err}</div>}
          {ok && <div style={{ fontSize: TEXT.xs.size, color: C.success, marginTop: SPACE['2'] }}>✓ {ok.text}{ok.tx && <> <a href={finderTx(ok.tx)} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>View tx →</a></>}</div>}
          <button type='button' style={{ ...primaryBtn, marginTop: SPACE['3'], opacity: canGo ? 1 : 0.5 }} disabled={!canGo} onClick={go}>
            {busy ? 'Confirm in wallet…' : pricing ? 'Pricing…' : ready.length > 0 ? `Sell ${ready.length} into ${target.label}` : picks.length > 0 ? 'Nothing ticked can be sold right now' : 'Tick what to sell'}
          </button>
        </>
      )}
    </Card>
  )
}

// ─── Send, and price alerts, in the wallet view ─────────────────

/**
 * Sending a listed token to another Terra address. The address is checked
 * before anything is signed: that it is a Terra address, that it is not this
 * wallet, whether it has ever been used, and whether it is a contract. A memo
 * goes through exactly as typed, for an exchange that asks for one.
 */
function SendPanel({ pools, onDone }: { pools: PoolView[]; onDone: () => void }) {
  const me = useMyAddress()
  const send = useTerraMsgs()
  const tokens = useMemo(() => {
    const m = new Map<string, KnownToken>([['uluna', LUNA]])
    for (const p of pools) for (const t of p.tokens) if (KNOWN_TOKENS.some(k => k.key === t.key)) m.set(assetId(t.info), t)
    return Array.from(m.values())
  }, [pools])
  const [tokenId, setTokenId] = useState('uluna')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [bal, setBal] = useState('0')
  const [seen, setSeen] = useState<'used' | 'new' | 'unknown' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<{ text: string; tx: string } | null>(null)
  // The address book and the addresses sent to lately, in this browser only (lib/contacts).
  const { contacts, recent } = useContacts()
  const [saveName, setSaveName] = useState('')
  const token = tokens.find(t => assetId(t.info) === tokenId) ?? LUNA
  useEffect(() => {
    if (!me) { setBal('0'); return }
    queryBalance(me, token.info).then(setBal).catch(() => {})
  }, [me, token, ok])

  const addr = to.trim()
  const kind = (() => {
    try {
      const { prefix, data } = fromBech32(addr)
      return prefix === 'terra' && (data.length === 20 || data.length === 32) ? (data.length === 32 ? 'contract' : 'wallet') : null
    } catch { return null }
  })()
  useEffect(() => {
    setSeen(null)
    if (!kind) return
    let alive = true
    lcdFetch(`/cosmos/auth/v1beta1/accounts/${addr}`)
      .then(r => { if (alive) setSeen(r.ok ? 'used' : r.status === 404 ? 'new' : 'unknown') })
      .catch(() => { if (alive) setSeen('unknown') })
    return () => { alive = false }
  }, [addr, kind])

  const micro = toMicro(amount, token.decimals)
  const isLuna = assetId(token.info) === 'uluna'
  const insufficient = !!micro && BigInt(micro) > BigInt(bal || '0')
  const self = !!me && addr === me
  const canSend = !!me && !!kind && !self && !!micro && micro !== '0' && !insufficient && !busy

  const go = async () => {
    if (!canSend || !micro) return
    setErr(null); setOk(null); setBusy(true)
    try {
      const r = await send.mutateAsync({ msgs: [sendMsg({ sender: me, recipient: addr, info: token.info, amount: micro })], memo: memo.trim(), raw: true }) as { transactionHash?: string }
      setOk({ text: `Sent ${fromMicro(micro, token.decimals, 6)} ${token.label} to ${addr.slice(0, 10)}…${addr.slice(-6)}.`, tx: r?.transactionHash ?? '' })
      rememberRecipient(addr)
      setAmount('')
      onDone()
    } catch (e) { setErr(humanizeTxError(e)) } finally { setBusy(false) }
  }

  if (!me) return null
  return (
    <Card>
      <Section title='Send' />
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
        Any listed token to another Terra address. A send cannot be undone, so the address is checked before you sign. Name an address to keep it, with its memo, in this browser&apos;s address book.
      </p>
      <label style={label}>Token and amount</label>
      <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['2'] }}>
        <input style={field} type='number' min='0' step='any' placeholder='0.0' value={amount} onChange={e => setAmount(e.target.value)} />
        <TokenSelect value={tokenId} onChange={setTokenId} options={tokens} />
      </div>
      <div style={{ ...rowStyle, marginBottom: SPACE['3'] }}>
        <span>Balance {fromMicro(bal, token.decimals)} {token.label}</span>
        {BigInt(bal || '0') > BigInt(0) && (
          <button type='button' style={{ ...ghostBtn, padding: '2px 8px' }} onClick={() => {
            // Sending all LUNA would leave nothing for this transaction's fee, or the next one.
            const keep = isLuna ? BigInt(100_000) : BigInt(0)
            const max = BigInt(bal) > keep ? BigInt(bal) - keep : BigInt(0)
            setAmount(fromMicro(max.toString(), token.decimals, 6).replace(/,/g, ''))
          }}>max</button>
        )}
      </div>
      <label style={label}>To this Terra address</label>
      {(contacts.length > 0 || recent.some(a => a !== me)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {contacts.map(c => (
            <button key={c.address} type='button' title={c.address} onClick={() => { setTo(c.address); setMemo(c.memo ?? '') }}
              style={{ ...ghostBtn, padding: '3px 10px', borderRadius: 999, color: addr === c.address ? C.goldLit : C.textPrimary, borderColor: addr === c.address ? C.goldCore : C.divider }}>
              {c.name}
            </button>
          ))}
          {recent.filter(a => a !== me && !contacts.some(c => c.address === a)).slice(0, 4).map(a => (
            <button key={a} type='button' title={`Sent to lately: ${a}`} onClick={() => setTo(a)}
              style={{ ...ghostBtn, padding: '3px 10px', borderRadius: 999, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: addr === a ? C.goldLit : C.textMuted }}>
              {a.slice(0, 9)}…{a.slice(-4)}
            </button>
          ))}
        </div>
      )}
      <input style={{ ...field, width: '100%', boxSizing: 'border-box' }} placeholder='terra1…' value={to} onChange={e => setTo(e.target.value)} spellCheck={false} autoComplete='off' />
      <div style={{ fontSize: TEXT.xs.size, lineHeight: 1.5, margin: `4px 0 ${SPACE['2']}px`, minHeight: 18 }}>
        {addr && !kind && <span style={{ color: C.alert }}>That is not a Terra address.</span>}
        {self && <span style={{ color: C.alert }}>That is this wallet.</span>}
        {kind && !self && seen === 'new' && <span style={{ color: C.emberLit }}>This address has never been used on Terra. Check every character before sending.</span>}
        {kind === 'contract' && !self && <span style={{ color: C.emberLit, display: 'block' }}>This is a contract address. Send only if it accepts {token.label}; tokens sent to a contract that does not handle them can be lost.</span>}
        {kind === 'wallet' && !self && seen === 'used' && <span style={{ color: C.textWhisper }}>An address that has been used on Terra before.</span>}
      </div>
      {kind && !self && (() => {
        const saved = contacts.find(c => c.address === addr)
        return saved ? (
          <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, margin: `-4px 0 ${SPACE['2']}px`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>In your address book as <b style={{ color: C.textSecondary }}>{saved.name}</b>{saved.memo ? ', with its memo' : ''}.</span>
            <button type='button' onClick={() => removeContact(addr)} style={{ ...ghostBtn, padding: '1px 8px' }}>remove</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: `-4px 0 ${SPACE['2']}px`, flexWrap: 'wrap' }}>
            <input value={saveName} onChange={e => setSaveName(e.target.value.slice(0, 32))} placeholder='Name it to save it, for example My exchange' aria-label='Name for this address'
              style={{ ...field, flex: '1 1 180px', width: 'auto', padding: '0.35rem 0.6rem', fontSize: TEXT.xs.size }} />
            <button type='button' disabled={!saveName.trim()} onClick={() => { saveContact({ address: addr, name: saveName, memo }); setSaveName('') }}
              style={{ ...ghostBtn, padding: '3px 10px', opacity: saveName.trim() ? 1 : 0.5 }}>{memo.trim() ? 'Save with memo' : 'Save'}</button>
          </div>
        )
      })()}
      <label style={label}>Memo, only if the receiver asks for one</label>
      <input style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: SPACE['3'] }} placeholder='for example an exchange deposit memo' value={memo} onChange={e => setMemo(e.target.value.slice(0, 256))} spellCheck={false} autoComplete='off' />
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>{err}</div>}
      {ok && <div style={{ fontSize: TEXT.xs.size, color: C.success, marginBottom: SPACE['2'] }}>✓ {ok.text}{ok.tx && <> <Link href={`/tx/${ok.tx}`} style={{ color: C.goldLit }}>Receipt →</Link></>}</div>}
      <button type='button' style={{ ...primaryBtn, opacity: canSend ? 1 : 0.5 }} disabled={!canSend} onClick={go}>
        {busy ? 'Confirm in wallet…' : insufficient ? `Not enough ${token.label}` : micro && micro !== '0' && kind && !self ? `Send ${fromMicro(micro, token.decimals, 6)} ${token.label} to ${addr.slice(0, 10)}…${addr.slice(-4)}` : 'Send'}
      </button>
    </Card>
  )
}

/** Price alerts and starred tokens, both kept in this browser only (lib/alerts). */
function AlertsPanel() {
  const { alerts, favorites } = usePrefs()
  const push = usePush(alerts)
  const [pushNote, setPushNote] = useState<string | null>(null)
  const togglePush = async (on: boolean) => {
    setPushNote(null)
    if (!on) { await disablePush(); return }
    const r = await enablePush()
    if (!r.ok) setPushNote(r.why)
  }
  const [allowed, setAllowed] = useState(false)
  useEffect(() => { setAllowed(notificationsAllowed()) }, [alerts])
  const waiting = alerts.filter(a => !a.firedAt)
  const starred = favorites.map(id => KNOWN_TOKENS.find(t => assetId(t.info) === id)).filter((t): t is KnownToken => !!t)
  return (
    <Card>
      <Section title='Price alerts and starred tokens' />
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['2']}px` }}>
        Kept in this browser. An alert goes off once, when the market reference crosses its level: on an open Terra Swap page, and with the option below, as a notification with the page closed. Set one on any token&apos;s page, for example <Link href='/token/LUNA' style={{ color: C.goldLit }}>LUNA</Link>; star tokens in the token picker to keep them at the top.
      </p>
      {waiting.length > 0 && !allowed && typeof Notification !== 'undefined' && (
        <button type='button' onClick={async () => setAllowed(await askNotifications())} style={{ ...ghostBtn, padding: '3px 10px', marginBottom: SPACE['2'] }}>Allow browser notifications</button>
      )}
      {push.supported && (
        <div style={{ margin: `0 0 ${SPACE['2']}px` }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: TEXT.sm.size, color: C.textPrimary, cursor: 'pointer' }}>
            <input type='checkbox' checked={push.on} onChange={e => void togglePush(e.target.checked)} />
            Also when no Terra Swap page is open
          </label>
          <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.6, marginTop: 2 }}>
            This keeps this browser&apos;s notification address and its alert levels on Terra Swap&apos;s server, and nothing else: no wallet, no name. Checked every ten minutes. Turn it off to delete them.
          </div>
          {pushNote && <div style={{ fontSize: TEXT.xs.size, color: C.emberLit, marginTop: 2 }}>{pushNote}</div>}
        </div>
      )}
      {alerts.length === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>No alerts set.</div>}
      {alerts.map(a => (
        <div key={a.id} style={{ ...rowStyle, alignItems: 'center' }}>
          <Link href={`/token/${encodeURIComponent(a.key)}`} style={{ color: C.textSecondary, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <TokenIcon label={a.label} size={16} />{a.label} {a.dir} ${fmtUsdPrice(a.usd)}
          </Link>
          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: a.firedAt ? C.success : C.textWhisper }}>{a.firedAt ? `went off at $${fmtUsdPrice(a.firedUsd ?? 0)}` : 'waiting'}</span>
            <button type='button' aria-label='Remove alert' onClick={() => removeAlert(a.id)} style={{ background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer' }}>✕</button>
          </span>
        </div>
      ))}
      {starred.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: SPACE['2'], alignItems: 'center' }}>
          <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>★ Starred</span>
          {starred.map(t => (
            <Link key={t.key} href={`/token/${encodeURIComponent(t.key)}`} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, color: C.textPrimary, textDecoration: 'none' }}>
              <TokenIcon label={t.label} size={14} />{t.label}
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── History: what a wallet did, read back from the chain ───────

const KIND_TEXT: Record<HistoryRow['kind'], string> = {
  swap: 'Swap', zap: 'Zap', 'add liquidity': 'Added liquidity', 'remove liquidity': 'Removed liquidity',
  stake: 'Staked LP', unstake: 'Unstaked LP', claim: 'Claimed rewards', 'transfer out': 'Sent over IBC',
  'transfer in': 'Arrived over IBC', 'arrived swapped': 'Arrived swapped', 'create pool': 'Opened a pool',
  'liquid staking': 'Liquid staking', other: 'Other',
}

/**
 * The connected wallet's recent transactions on Terra, read back from the
 * chain (lib/history): what left, what arrived and the network fee, and for a
 * swap signed here, what it was quoted beside what actually arrived.
 */
function HistoryPanel({ pools }: { pools: PoolView[] }) {
  const me = useMyAddress()
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [year, setYear] = useState(() => new Date().getUTCFullYear())
  const [exporting, setExporting] = useState<{ busy: boolean; text: string } | null>(null)
  useEffect(() => {
    if (!me) { setData(null); return }
    let alive = true
    setLoading(true); setFailed(false)
    fetch(`/api/history?address=${me}${reload ? `&_=${reload}` : ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: HistoryResponse | null) => { if (!alive) return; if (j?.rows) setData(j); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [me, reload])
  const lpNames = useMemo(() => new Map(pools.map(p => [p.liquidity_token, `${p.label} LP`])), [pools])
  const tokenOf = useCallback((id: string) => {
    const lp = lpNames.get(id)
    if (lp) return { label: lp, decimals: 6 }
    const t = tokenFor(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } })
    return { label: t.label, decimals: t.decimals }
  }, [lpNames])
  const show = (m: Moved) => { const t = tokenOf(m.id); return `${fromMicro(m.amount, t.decimals, 6)} ${t.label}` }

  /** Every transaction of a calendar year as a CSV file (lib/csv), with each token's real decimals read from the chain. */
  const exportCsv = async () => {
    if (!me) return
    setExporting({ busy: true, text: `Reading every transaction of ${year}…` })
    try {
      const r = await fetch(`/api/history?address=${me}&year=${year}`, { cache: 'no-store' })
      const j = r.ok ? ((await r.json()) as HistoryResponse) : null
      if (!j) { setExporting({ busy: false, text: 'The chain did not answer. Try again in a moment.' }); return }
      const ids = Array.from(new Set(j.rows.flatMap(row => [...row.in, ...row.out].map(m => m.id))))
      const named = new Map<string, { symbol: string; decimals: number }>()
      await Promise.all(ids.map(async id => {
        const lp = lpNames.get(id)
        if (lp) { named.set(id, { symbol: lp, decimals: 6 }); return }
        const tk = await resolveToken(id.startsWith('terra1') ? { token: { contract_addr: id } } : { native_token: { denom: id } }).catch(() => null)
        const listed = !!tk && KNOWN_TOKENS.some(k => k.key === tk.key)
        named.set(id, { symbol: listed ? tk!.label : tk && tk.label !== tk.key ? `${tk.label} (${id})` : id, decimals: tk?.decimals ?? 6 })
      }))
      const csv = historyCsv(j.rows, id => named.get(id) ?? { symbol: id, decimals: 6 })
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `terra-${me.slice(-6)}-${year}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      const n = j.rows.length
      setExporting({ busy: false, text: `${n} transaction${n === 1 ? '' : 's'} in ${year}, saved as ${a.download}.${j.complete ? '' : ' The chain stopped answering before the start of the year, so the oldest may be missing. Try again later for the whole year.'}` })
    } catch {
      setExporting({ busy: false, text: 'The chain did not answer. Try again in a moment.' })
    }
  }

  if (!me) {
    return (
      <Card>
        <Section title='History' />
        <p style={{ fontSize: TEXT.sm.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
          Connect a wallet to see its swaps, liquidity and transfers on Terra, read back from the chain, with what each swap here was quoted beside what arrived.
        </p>
        <div className='terra-connect-cta'><WalletButton /></div>
      </Card>
    )
  }

  const rows = data?.rows ?? []
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'] }}>
        <Section title='History' />
        <button type='button' onClick={() => setReload(Date.now())} style={{ ...ghostBtn, marginLeft: 'auto', padding: '2px 8px' }} disabled={loading}>{loading ? 'reading…' : 'refresh'}</button>
      </div>
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px` }}>
        This wallet&apos;s recent transactions on Terra, read back from the chain: what left, what arrived, and the network fee. A swap signed here carries its quote in the memo, so what it was quoted sits beside what actually arrived.
      </p>
      <div style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 10, marginBottom: SPACE['3'], display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: TEXT.xs.size, color: C.textSecondary }}>Every transaction of</span>
          <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label='Year' style={{ ...select, minWidth: 0, padding: '2px 8px', fontSize: TEXT.xs.size }}>
            {Array.from({ length: new Date().getUTCFullYear() - 2021 }, (_, i) => new Date().getUTCFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type='button' onClick={exportCsv} disabled={exporting?.busy} style={{ ...ghostBtn, padding: '3px 10px', color: C.goldLit, borderColor: C.goldCore, marginLeft: 'auto', opacity: exporting?.busy ? 0.6 : 1 }}>
            {exporting?.busy ? 'Reading…' : 'Download CSV'}
          </button>
        </div>
        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5 }}>
          For tax software, in the columns Koinly imports. A dollar value is filled in only where one side of a swap is USDC from Noble; the rest is left for the software to price.
        </div>
        {exporting && !exporting.busy && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.5 }}>{exporting.text}</div>}
        {exporting?.busy && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{exporting.text}</div>}
      </div>
      {loading && !data && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Reading the chain…</div>}
      {failed && !data && <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary }}>The chain&apos;s history endpoint did not answer. Try refresh in a moment.</div>}
      {data && rows.length === 0 && <div style={{ fontSize: TEXT.sm.size, color: C.textMuted }}>No transactions found for this wallet.</div>}
      <div style={{ display: 'grid', gap: SPACE['2'] }}>
        {rows.map(row => {
          const q = row.quote
          const got = q ? row.in.find(m => tokenOf(m.id).label === q.label) : undefined
          const gotNum = got ? Number(got.amount) / 10 ** tokenOf(got.id).decimals : null
          const vsQuote = q && gotNum != null && q.amount > 0 ? (gotNum / q.amount - 1) * 100 : null
          return (
            <div key={row.hash} style={{ padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${row.ok ? C.divider : 'rgba(224,74,90,0.35)'}`, display: 'grid', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'], flexWrap: 'wrap' }}>
                <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{KIND_TEXT[row.kind]}</b>
                {row.chain && <span style={{ fontSize: TEXT.caption.size, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted }}>{row.kind === 'transfer out' ? `to ${row.chain}` : `from ${row.chain}`}</span>}
                <span style={{ marginLeft: 'auto', fontSize: TEXT.xs.size, color: C.textWhisper }}>{new Date(row.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {!row.ok && <div style={{ fontSize: TEXT.xs.size, color: C.alert }}>Failed on chain: nothing moved but the network fee.</div>}
              {row.out.length > 0 && <div style={rowStyle}><span>Left</span><span style={{ color: C.textSecondary }}>{row.out.map(show).join(' + ')}</span></div>}
              {row.in.length > 0 && <div style={rowStyle}><span>Arrived</span><span style={{ color: C.textSecondary }}>{row.in.map(show).join(' + ')}</span></div>}
              {q && (
                <div style={rowStyle}>
                  <span>Quoted</span>
                  <span style={{ color: C.textSecondary }}>
                    {fmtAmount(q.amount)} {q.label}
                    {vsQuote != null && <> · arrived <span style={{ color: vsQuote >= -0.05 ? C.success : C.emberLit }}>{vsQuote >= 0 ? '+' : ''}{vsQuote.toFixed(2)}%</span></>}
                  </span>
                </div>
              )}
              {q?.gainPct != null && q.gainPct >= 0.005 && <div style={rowStyle}><span>Routing added</span><span style={{ color: C.success }}>+{q.gainPct.toFixed(2)}% over the best path through up to two pools</span></div>}
              {row.minimum && <div style={rowStyle}><span>Least it allowed</span><span style={{ color: C.textSecondary }}>{show(row.minimum)}</span></div>}
              <div style={rowStyle}>
                <span>Network fee</span>
                <span style={{ display: 'inline-flex', gap: 10 }}>
                  <span style={{ color: C.textSecondary }}>{row.feeUluna !== '0' ? `${fromMicro(row.feeUluna, 6, 4)} LUNA` : 'paid by the relayer'}</span>
                  <Link href={`/tx/${row.hash}`} style={{ color: C.goldLit }}>receipt</Link>
                  <a href={finderTx(row.hash)} target='_blank' rel='noreferrer' style={{ color: C.textMuted }}>tx ↗</a>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Closing a gap in one transaction ───────────────────────────

const LOOP_SLIP = 0.005

/**
 * "Take it", done properly. The old button handed the swap panel one side of
 * the trade and left the person holding the other token. This buys the cheap
 * side in the drifted pool and sells it straight back through the best path
 * elsewhere, in one transaction, ending in the token it started with. It is
 * offered only when even the worst case, every leg slipping to its limit,
 * ends ahead. First come: the gap moves on every trade.
 */
function LoopPanel({ plan, pools, onClose, onOneSided, onDone }: {
  plan: ArbPlan; pools: PoolView[]; onClose: () => void; onOneSided: (p: ArbPlan) => void; onDone: () => void
}) {
  const me = useMyAddress()
  const run = useRouteSwap()
  const poolsRef = useRef(pools)
  poolsRef.current = pools
  const [loop, setLoop] = useState<Loop | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setLoop(undefined); setErr(null); setDone(null)
    quoteLoop(poolsRef.current, plan.pool, plan.inToken, plan.inMicro, LOOP_SLIP)
      .then(l => { if (alive) setLoop(l) })
      .catch(() => { if (alive) setLoop(null) })
    return () => { alive = false }
  }, [plan])
  const start = plan.inToken
  const amt = (m: string) => fromMicro(m, start.decimals, 6)
  const go = async () => {
    if (!loop || !me) return
    setErr(null)
    try {
      const r = await run.mutateAsync({ plan: planRoute(loop.quote, LOOP_SLIP), maxSpread: LOOP_SLIP, sender: me, memo: 'close a gap' })
      setDone((r as { transactionHash?: string })?.transactionHash ?? 'ok')
      onDone()
    } catch (e) { setErr(humanizeTxError(e)) }
  }
  return (
    <div style={{ marginBottom: SPACE['3'] }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'], flexWrap: 'wrap' }}>
          <Section title='Close the gap' />
          <span style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{plan.pool.label} · {plan.off.toFixed(2)}× off market</span>
          <button type='button' onClick={onClose} style={{ ...ghostBtn, marginLeft: 'auto', padding: '2px 8px' }}>close</button>
        </div>
        {loop === undefined && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Pricing the way back through both sites…</div>}
        {loop === null && (
          <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6 }}>
            No round trip pays right now: selling back elsewhere costs more than the gap is worth. You can still take one side of it.
            <div style={{ marginTop: SPACE['2'] }}><button type='button' style={ghostBtn} onClick={() => onOneSided(plan)}>Trade one side instead</button></div>
          </div>
        )}
        {loop && (
          <div style={{ display: 'grid', gap: SPACE['2'] }}>
            <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6 }}>
              {loop.quote.legs.map((l, i) => (
                <div key={i}>{i + 1} · {l.offer.label} → {l.ask.label} on {VENUE_NAME[l.pool.venue]}{l.pool.contract_addr === plan.pool.contract_addr ? ', the drifted pool' : ''}</div>
              ))}
            </div>
            <div>
              <Row k='You put in' v={`${amt(loop.inMicro)} ${start.label}`} />
              <Row k='Expected back' v={`${amt(loop.expectedOutMicro)} ${start.label}`} />
              <Row k={`At worst, with ${LOOP_SLIP * 100}% slippage`} v={`${amt(loop.worstOutMicro)} ${start.label} · +${amt(loop.worstGainMicro)}`} hi />
            </div>
            <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5 }}>
              One transaction, before gas. If any leg would land past its limit, all of it reverts and only gas is spent. Someone else can close it first.
            </div>
            {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert }}>{err}</div>}
            {done && <div style={{ fontSize: TEXT.xs.size, color: C.success }}>✓ Closed.{done !== 'ok' && <> <a href={finderTx(done)} target='_blank' rel='noreferrer' style={{ color: C.goldLit }}>View tx →</a></>}</div>}
            {me
              ? <button type='button' style={{ ...primaryBtn, opacity: run.isLoading || done ? 0.5 : 1 }} disabled={run.isLoading || !!done} onClick={go}>{run.isLoading ? 'Confirm in wallet…' : 'Close it · one signature'}</button>
              : <div className='terra-connect-cta'><WalletButton /></div>}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Pools tab ──────────────────────────────────────────────────

/**
 * What a pool paid its liquidity providers in the last 7 and 30 days, from its
 * own swap events (/api/pool-fees), at today's prices. History, never a rate:
 * nothing here says what a pool will pay. Asked for once the row comes near
 * the screen, since a busy pool takes a moment to read.
 */
function PoolFees({ pair }: { pair: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [f, setF] = useState<PoolFeesResponse | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  useEffect(() => {
    if (!near) return
    let alive = true
    fetch(`/api/pool-fees?pair=${pair}`).then(r => (r.ok ? r.json() : null)).then((j: PoolFeesResponse | null) => { if (alive && j) setF(j) }).catch(() => {})
    return () => { alive = false }
  }, [near, pair])
  // Fees paid in a token without a reference price are counted, not priced.
  const usd = (v: number | null, swaps: number) => (v == null ? `${swaps} swap${swaps === 1 ? '' : 's'}` : fmtUsd(v))
  // A busy pool's scan stops early; then the longer figure covers the days it reached.
  const days = f && !f.complete && f.since ? Math.max(1, Math.round((f.at - Date.parse(f.since)) / 86_400_000)) : 30
  return (
    <div ref={ref} style={f ? { ...rowStyle, marginTop: 2 } : { minHeight: 1 }}>
      {f && (
        <>
          <span title="From the pool's own swap events, less what goes to Astroport's maker. At today's prices.">Fees to LPs</span>
          <span style={{ color: f.day30.swaps ? C.textSecondary : C.textWhisper }}>
            {!f.day30.swaps ? `no swaps in ${days} days` : days < 7 ? `last ${days} day${days === 1 ? '' : 's'} ${usd(f.day30.usd, f.day30.swaps)}` : `7 days ${usd(f.day7.usd, f.day7.swaps)} · ${days} days ${usd(f.day30.usd, f.day30.swaps)}`}
          </span>
        </>
      )}
    </div>
  )
}

/** A tiny price line for the deepest pools. Same data as the chart, 22px tall. */
function Spark({ pair }: { pair: string }) {
  const [pts, setPts] = useState<number[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/dex-prices?pair=${pair}`).then(r => r.ok ? r.json() : null).then((j: PricesResponse | null) => { if (alive && j) setPts(j.points.map(x => x.p)) }).catch(() => {})
    return () => { alive = false }
  }, [pair])
  if (!pts || pts.length < 2) return null
  const W = 120, H = 22, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1) * W).toFixed(1)},${(H - 2 - (v - min) / span * (H - 4)).toFixed(1)}`).join(' ')
  const up = pts[pts.length - 1] >= pts[0]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textWhisper }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}><path d={d} fill='none' stroke={up ? C.success : C.alert} strokeWidth='1.6' strokeLinejoin='round' strokeLinecap='round' /></svg>
      <span>last {pts.length} trades</span>
    </div>
  )
}

/**
 * What a wallet put into a pool, against what its LP is a claim on now, per
 * token. In tokens, not dollars: pricing a deposit made last Tuesday needs
 * last Tuesday's price, and inventing one turns an honest number into a
 * flattering one. Two sides moving opposite ways is impermanent loss, shown
 * plainly. On the pool cards, and in Positions since the community chat asked
 * for it there too (2026-09-14).
 */
function PutInRow({ flow, tokens, amounts, usd, px }: { flow?: LpFlow; tokens: [KnownToken, KnownToken]; amounts: [number, number]; usd?: number | null; px?: Record<string, number> | null }) {
  if (!flow) return null
  const [t0, t1] = tokens
  const put = [Number(flow.net[assetId(t0.info)] ?? '0') / 10 ** t0.decimals, Number(flow.net[assetId(t1.info)] ?? '0') / 10 ** t1.decimals]
  if (!(put[0] > 0) && !(put[1] > 0)) return null
  const delta = (i: 0 | 1) => (put[i] > 0 ? (amounts[i] / put[i] - 1) * 100 : null)
  const tag = (v: number | null) => v == null ? null : (
    <span style={{ color: v >= 0 ? C.success : C.korea }}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>
  )
  const [d0, d1] = [delta(0), delta(1)]
  // Against holding: the position now beside what the tokens put in would be worth had they stayed in the wallet,
  // both at today's prices. The difference is the pool's fees and the effect of the two prices moving apart, together.
  // Only while nothing has been taken out, so "what was put in" means one thing.
  const p0 = px?.[assetId(t0.info)], p1 = px?.[assetId(t1.info)]
  const held = flow.withdraws === 0 && p0 && p1 ? Math.max(0, put[0]) * p0 + Math.max(0, put[1]) * p1 : null
  const vs = held && held > 0 && usd != null ? (usd / held - 1) * 100 : null
  return (
    <>
      <div style={{ ...rowStyle, marginTop: 2 }}>
        <span>Put in{flow.provides > 1 ? ` · ${flow.provides} deposits` : ''}{flow.withdraws > 0 ? `, ${flow.withdraws} out` : ''}</span>
        <span style={{ color: C.textSecondary }}>
          {fmtAmount(put[0])} {t0.label} + {fmtAmount(put[1])} {t1.label}
          {(d0 != null || d1 != null) && <> · {tag(d0)} / {tag(d1)}</>}
        </span>
      </div>
      {vs != null && held != null && usd != null && (
        <div style={rowStyle} title="Both at today's prices. The difference is what the pool's fees added and what the two prices moving apart took, together. It says what happened, not what will.">
          <span>Against holding it</span>
          <span style={{ color: C.textSecondary }}>
            {fmtUsd(usd)} in the pool · {fmtUsd(held)} if kept in the wallet · {tag(vs)}
          </span>
        </div>
      )}
    </>
  )
}

function PoolRow({ p, routePools, onDone, onParty, act, height, firstHand, crystal, badge, spark, arb, onTake, holders, flow }: { p: PoolView; routePools: PoolView[]; onDone: () => void; onParty: (x: Party) => void; act?: PoolActivity; height?: number; firstHand?: { address: string; height: number; txhash?: string }; crystal: boolean; badge?: 'deepest' | 'hottest'; spark?: boolean; arb?: ArbPlan; onTake?: (a: ArbPlan) => void; holders?: PoolHolders; flow?: LpFlow }) {
  const me = useMyAddress()
  const provide = useProvideLiquidity()
  const withdraw = useExitPosition()
  const [mode, setMode] = useState<'none' | 'add' | 'remove' | 'trades'>('none')
  const [a0, setA0] = useState(''); const [a1, setA1] = useState('')
  const [lp, setLp] = useState('0'); const [lpAmt, setLpAmt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [t0, t1] = p.tokens

  // A cw20 LP token answers its own balance query; a TokenFactory LP denom (Skeleton Swap's pools, Astroport's newer ones) sits in the bank.
  useEffect(() => {
    if (!me) return
    const read = p.liquidity_token.startsWith('terra1') ? queryCw20Balance(p.liquidity_token, me) : queryBalance(me, { native_token: { denom: p.liquidity_token } })
    read.then(setLp)
  }, [me, p.liquidity_token, ok])
  // LP staked in Astroport's incentives contract is still this wallet's. Count
  // it, and let Remove unstake whatever the wallet does not hold.
  const [staked, setStaked] = useState('0')
  useEffect(() => {
    const inc = VENUE_INCENTIVES[p.venue]
    if (!me || !inc) { setStaked('0'); return }
    smart<string>(inc, { deposit: { lp_token: p.liquidity_token, user: me } }).then(v => setStaked(typeof v === 'string' ? v : '0'))
  }, [me, p.venue, p.liquidity_token, ok])
  const lpAll = (BigInt(lp || '0') + BigInt(staked || '0')).toString()

  // Both sides' wallet balances, read while the add form is open. Asked for in
  // the community chat 2026-09-12: "how much of either side is in your wallet
  // and how much of the other side you need to get". Until now the only way to
  // find out was to try, or to zap and pay 10% on a thin pool.
  const [bal, setBal] = useState<[string, string]>(['0', '0'])
  useEffect(() => {
    if (!me || mode !== 'add') return
    let alive = true
    Promise.all([queryBalance(me, t0.info), queryBalance(me, t1.info)]).then(b => { if (alive) setBal([b[0], b[1]]) })
    return () => { alive = false }
  }, [me, mode, t0, t1, ok])

  // Either amount drives the other at the pool ratio, so a provider can't
  // deposit at a wrong price and get arbed. An empty pool leaves both free.
  const dp = (t: KnownToken) => (t.decimals >= 8 ? 8 : 6)
  const plain = (n: number, places: number) => (Number.isFinite(n) && n > 0 ? n.toFixed(places).replace(/\.?0+$/, '') : '')
  const onA0 = (v: string) => {
    setA0(v)
    if (!p.empty) setA1(v ? plain(Number(v) * p.reserveRatio, dp(t1)) : '')
  }
  const onA1 = (v: string) => {
    setA1(v)
    if (!p.empty && p.reserveRatio > 0) setA0(v ? plain(Number(v) / p.reserveRatio, dp(t0)) : '')
  }
  const human = (micro: string, t: KnownToken) => Number(micro) / 10 ** t.decimals
  // Gas is paid in LUNA, so a LUNA side keeps a little back.
  const spendable = (i: 0 | 1) => Math.max(0, human(bal[i], p.tokens[i]) - (assetId(p.tokens[i].info) === 'uluna' ? 0.5 : 0))
  /** The largest both-sides deposit this wallet can fund at the pool ratio. */
  const fillMax = () => {
    if (p.empty || !(p.reserveRatio > 0)) return
    const x = Math.min(spendable(0), spendable(1) / p.reserveRatio) * 0.999
    if (x > 0) onA0(plain(x, dp(t0)))
  }
  /**
   * All of one side, rounded down so it never asks for more than the wallet
   * holds; on a pool with liquidity the other side follows at the pool ratio.
   * Asked for in the community chat 2026-09-14.
   */
  const fillSide = (i: 0 | 1) => {
    const places = dp(p.tokens[i])
    const x = Math.floor(spendable(i) * 10 ** places) / 10 ** places
    if (!(x > 0)) return
    const v = plain(x, places)
    if (i === 0) onA0(v)
    else onA1(v)
  }
  const short: [number, number] = [
    Math.max(0, (Number(a0) || 0) - human(bal[0], t0)),
    Math.max(0, (Number(a1) || 0) - human(bal[1], t1)),
  ]
  /** USD per whole token on side i, at the market reference. */
  const unitUsd = (i: 0 | 1) => {
    const r = human(p.reserves[i], p.tokens[i])
    return p.sideUsd && r > 0 ? p.sideUsd[i] / r : null
  }
  /** xyk: taking y out of a side holding Y moves the price about y / (Y − y). */
  const impactFor = (i: 0 | 1, y: number) => {
    const Y = human(p.reserves[i], p.tokens[i])
    return y >= Y ? Infinity : (y / (Y - y)) * 100
  }
  const m0 = toMicro(a0, t0.decimals), m1 = toMicro(a1, t1.decimals)
  const canAdd = !!me && !!m0 && !!m1 && m0 !== '0' && m1 !== '0' && !provide.isLoading

  // ── zap: one token in, swap-half-then-provide in a single signature ──
  const zap = useZap()
  const [side, setSide] = useState<'both' | 'zap'>('both')
  /** A pool of USDC from Noble and USDC.inj takes both sides only: a zap would swap one dollar for the other, which this site never does. */
  const twoDollars = p.tokens.some(t => assetId(t.info) === NOBLE_USDC) && p.tokens.some(t => assetId(t.info) === USDC_INJ_DENOM)
  const [zIdx, setZIdx] = useState<0 | 1>(0)
  const [zAmt, setZAmt] = useState('')
  const [zBal, setZBal] = useState('0')
  const [zPlan, setZPlan] = useState<ZapPlan | null>(null)
  const [zRouted, setZRouted] = useState<RoutedZap | null>(null)
  const zTok = p.tokens[zIdx]
  const zMicro = toMicro(zAmt, zTok.decimals)
  const zDebounced = useDebounced(zMicro, 350)
  useEffect(() => { if (me && side === 'zap') queryBalance(me, zTok.info).then(setZBal); else setZBal('0') }, [me, side, zTok, ok])
  // Routing pools refresh in the background; plan against the latest without re-planning on each refresh.
  const routeRef = useRef(routePools)
  routeRef.current = routePools
  useEffect(() => {
    let alive = true; setZPlan(null); setZRouted(null)
    if (side !== 'zap' || p.empty || !zDebounced || zDebounced === '0') return
    planZap(p, zIdx, zDebounced, 0.01).then(pl => { if (alive) setZPlan(pl) })
    // The same zap with its swap done through the best path elsewhere. On a thin
    // pool that is the difference between 10% impact and almost none.
    planRoutedZap(routeRef.current, p, zIdx, zDebounced, 0.01).then(rz => { if (alive) setZRouted(rz) }).catch(() => {})
    return () => { alive = false }
  }, [side, p, zIdx, zDebounced])
  // Routed wins when it moves the price meaningfully less than swapping inside this pool.
  const useRouted = !!zRouted && (!zPlan || zRouted.impactPct + 0.5 < zPlan.impact)
  const zInsufficient = !!zMicro && BigInt(zMicro) > BigInt(zBal || '0')
  const canZap = !!me && (useRouted || !!zPlan) && !zInsufficient && !zap.isLoading
  const doZap = async () => {
    if (!canZap) return
    setErr(null); setOk(null)
    try {
      if (useRouted && zRouted) {
        const tOut = p.tokens[zIdx === 0 ? 1 : 0]
        const keep = { info: zTok.info, amount: zRouted.keepMicro }, got = { info: tOut.info, amount: zRouted.getMicro }
        await zap.mutateAsync({
          pair: p.contract_addr, route: zRouted.plan, maxSpread: 0.01, provide: zIdx === 0 ? [keep, got] : [got, keep], slippage: 0.02, sender: me,
        })
      } else if (zPlan) {
        await zap.mutateAsync({
          pair: p.contract_addr, offer: { info: zTok.info, amount: zPlan.swapAmount }, limitReturn: zPlan.limitReturn,
          maxSpread: 0.01, provide: zPlan.provide, slippage: 0.02, sender: me,
        })
      } else return
      setOk(useRouted && zRouted ? `Zapped in. The swap went through ${Array.from(new Set(zRouted.swap.legs.map(l => VENUE_NAME[l.pool.venue]))).join(' and ')}.` : 'Zapped in. One signature, both sides.'); setZAmt(''); setMode('none'); onDone()
      kwonSay({ q: 'Steady lads, deploying more capital 🫡', when: 'reacting to your zap · just now', pose: 'salute' })
    } catch (e) { setErr(humanizeTxError(e)) }
  }

  const add = async () => {
    if (!canAdd || !m0 || !m1) return
    setErr(null); setOk(null)
    try {
      const wasEmpty = p.empty
      await provide.mutateAsync({ pair: p.contract_addr, assets: [{ info: t0.info, amount: m0 }, { info: t1.info, amount: m1 }], slippage: 0.01, sender: me, venue: p.venue })
      setOk('Liquidity added.'); setA0(''); setA1(''); setMode('none'); onDone()
      if (wasEmpty) onParty({ emoji: '🌊', title: 'FIRST HAND', sub: `First liquidity into ${p.label}. +100 points, and it is written down. 대박.` })
    } catch (e) { setErr(humanizeTxError(e)) }
  }
  const lpMicro = toMicro(lpAmt, 6)
  const canRemove = !!me && !!lpMicro && lpMicro !== '0' && BigInt(lpMicro) <= BigInt(lpAll) && !withdraw.isLoading
  const remove = async () => {
    if (!canRemove || !lpMicro) return
    setErr(null); setOk(null)
    try {
      await withdraw.mutateAsync({ pair: p.contract_addr, lpToken: p.liquidity_token, incentives: VENUE_INCENTIVES[p.venue], walletLp: lp, stakedLp: staked, amount: lpMicro, sender: me })
      setOk('Liquidity removed.'); setLpAmt(''); setMode('none'); onDone()
    } catch (e) { setErr(humanizeTxError(e)) }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['3'], flexWrap: 'wrap' }}>
        <div style={{ fontSize: TEXT.md.size, fontWeight: 700, color: C.textPrimary, display: 'flex', alignItems: 'center' }}>
          <PairIcons a={p.tokens[0].label} b={p.tokens[1].label} />{p.label}
          {p.venue !== HOME_VENUE && <span style={{ marginLeft: 8, fontSize: TEXT.caption.size, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>{VENUE_NAME[p.venue]}</span>}
          {p.venue !== 'skeleton' && <Link href={`/pool/${p.contract_addr}`} title='Its own page: liquidity, price impact, fees paid and recent trades' style={{ marginLeft: 8, fontSize: TEXT.xs.size, color: C.textMuted, fontWeight: 500, textDecoration: 'none' }}>details ↗</Link>}
        </div>
        {badge && <span style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: badge === 'deepest' ? C.goldLit : C.korea, fontWeight: 800 }}>{badge === 'deepest' ? '🏆 deepest' : '🔥 most traded'}</span>}
        {(() => {
          // Vibe tag from real activity: hot = moves in the last hour and a few of them, new = barely touched, quiet = the rest.
          if (!act) return null
          const ago = height && act.last ? height - act.last : Infinity
          const v = ago < 600 && act.count >= 3 ? { e: '🔥', t: 'hot', c: C.alert }
            : act.count <= 2 ? { e: '🌱', t: 'new', c: C.success }
            : { e: '🧊', t: 'quiet', c: C.textMuted }
          return <span title={`${act.count} move${act.count === 1 ? '' : 's'} · last at #${act.last.toLocaleString('en-US')}`} style={{ fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: v.c, cursor: 'default' }}>{v.e} {v.t} · {act.count}</span>
        })()}
        {p.empty
          ? <span style={{ fontSize: TEXT.xs.size, color: C.emberLit }}>empty · be the first</span>
          : <span style={{ fontSize: TEXT.xs.size, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
              {p.tvlUsd != null && <span style={{ color: C.goldLit, fontWeight: 700 }}>${p.tvlUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} TVL</span>}
              {p.deviation != null && (() => {
                // Off-market flag vs Astroport's deepest pools. 4× = token[1] is 4× too cheap here.
                const d = p.deviation, off = d > 1 ? d : 1 / d
                if (off < 1.15) return <span style={{ color: C.success }}> · ≈ market</span>
                const cheap = d > 1 ? p.tokens[1].label : p.tokens[0].label
                return <span title={`market: 1 ${p.tokens[0].label} = ${fmtPrice(p.marketPrice ?? 0)} ${p.tokens[1].label} (Astroport)`} style={{ color: off > 2 ? C.alert : C.emberLit, fontWeight: 700 }}> · ⚠ {off.toFixed(off >= 10 ? 0 : 1)}× off market · {cheap} is cheap here</span>
              })()}
              {p.tvlUsd != null && p.tvlUsd > 0 && (() => {
                // xyk: a $100 trade against one side (≈ tvl/2) moves price by about 100/(side+100).
                const imp = 100 / (p.tvlUsd / 2 + 100) * 100
                const c = imp > 10 ? C.alert : imp > 3 ? C.emberLit : C.success
                return <span title='price impact of a $100 swap, from the reserves'> · <span style={{ color: c }}>$100 moves it ~{imp.toFixed(imp >= 10 ? 0 : 1)}%</span></span>
              })()}
              {p.tvlUsd != null && ' · '}
              {/* Dollars and share per side read at a glance; the token counts
                  are still there on hover for anyone who wants them. A pool at
                  market sits near 50/50, so a skew is the imbalance itself. */}
              {p.sideUsd
                ? (() => {
                    const [va, vb] = p.sideUsd
                    const tot = va + vb
                    const pct = (v: number) => (tot > 0 ? Math.round((v / tot) * 100) : 50)
                    const usd = (v: number) => (v >= 10 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(v >= 1 ? 1 : 2)}`)
                    return (
                      <span title={`${fromMicro(p.reserves[0], t0.decimals)} ${t0.label} · ${fromMicro(p.reserves[1], t1.decimals)} ${t1.label}`}>
                        {pct(va)}% {usd(va)} {t0.label} · {pct(vb)}% {usd(vb)} {t1.label}
                      </span>
                    )
                  })()
                : <>{fromMicro(p.reserves[0], t0.decimals)} {t0.label} · {fromMicro(p.reserves[1], t1.decimals)} {t1.label}</>}
            </span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: SPACE['2'] }}>
          {/* This site's trade tape reads its own ledger, which does not follow Skeleton Swap's pools. */}
          {!p.empty && p.venue !== 'skeleton' && <button type='button' style={{ ...ghostBtn, color: mode === 'trades' ? C.goldLit : C.textSecondary, borderColor: mode === 'trades' ? C.goldCore : C.divider }} onClick={() => setMode(mode === 'trades' ? 'none' : 'trades')} title='chart, tape and the wallets behind it'>Trades</button>}
          {p.depositsEnabled !== false && <button type='button' style={{ ...ghostBtn, color: mode === 'add' ? C.goldLit : C.textSecondary, borderColor: mode === 'add' ? C.goldCore : C.divider }} onClick={() => setMode(mode === 'add' ? 'none' : 'add')}>Add</button>}
          {Number(lpAll) > 0 && p.withdrawalsEnabled !== false && <button type='button' style={{ ...ghostBtn, color: mode === 'remove' ? C.goldLit : C.textSecondary, borderColor: mode === 'remove' ? C.goldCore : C.divider }} onClick={() => setMode(mode === 'remove' ? 'none' : 'remove')}>Remove</button>}
        </div>
      </div>
      {/* Skeleton Swap's pools set their own fee and split it, and their owner can pause swaps, deposits or withdrawals: say both, from the pool's own config. */}
      {p.venue === 'skeleton' && (
        <div style={{ ...rowStyle, marginTop: 4 }}>
          <span>{p.fees ? `Fee ${bpsPct(p.fees.lpBps + p.fees.protocolBps + p.fees.burnBps)} per swap` : 'Fee set by the pool'}</span>
          <span style={{ color: C.textSecondary }}>
            {p.fees ? `${bpsPct(p.fees.lpBps)} to LPs · ${bpsPct(p.fees.protocolBps)} to White Whale${p.fees.burnBps > 0 ? ` · ${bpsPct(p.fees.burnBps)} burned` : ''}` : ''}
            {[p.swapsEnabled === false ? 'swaps paused' : '', p.depositsEnabled === false ? 'deposits paused' : '', p.withdrawalsEnabled === false ? 'withdrawals paused' : ''].filter(Boolean).map(s => ` · ${s}`).join('')}
          </span>
        </div>
      )}
      {/* The gap, sized. Without the number, "1.9× off market" is a warning
          nobody can act on; with it, it is a trade with a known size. */}
      {arb && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: SPACE['2'], flexWrap: 'wrap',
          margin: `${SPACE['2']}px 0 0`, padding: '7px 10px', borderRadius: 10,
          background: C.goldSoft, border: `1px solid ${C.dividerStrong}`,
          fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.5,
        }}>
          <span style={{ flex: 1, minWidth: 190 }}>
            <b style={{ color: C.goldLit }}>{fmtAmount(arb.inAmount)} {arb.inToken.label}</b>
            <span style={{ color: C.textWhisper }}> ({fmtUsd(arb.inUsd)})</span> closes the gap and returns{' '}
            <b style={{ color: C.goldLit }}>{fmtAmount(arb.outAmount)} {arb.outToken.label}</b>
            <span style={{ color: C.textWhisper }}>, about </span>
            <b style={{ color: C.success }}>{fmtUsd(arb.profitUsd)}</b>
            <span style={{ color: C.textWhisper }}> more than you put in, at reference prices. First come.</span>
          </span>
          <button type='button' style={{ ...ghostBtn, color: C.goldLit, borderColor: C.goldCore, flex: 'none' }} onClick={() => onTake?.(arb)}>
            Take it
          </button>
        </div>
      )}
      {spark && <Spark pair={p.contract_addr} />}
      {firstHand && (
        <div style={{ ...rowStyle, marginTop: 4 }}>
          <span>{firstHand.txhash ? <a href={finderTx(firstHand.txhash)} target='_blank' rel='noreferrer' style={{ color: 'inherit' }} title='the receipt'>🌊 First hand ↗</a> : '🌊 First hand'}</span>
          <span style={{ color: C.textSecondary, display: 'inline-flex', gap: 6, alignItems: 'baseline' }}><WalletName address={firstHand.address} head={8} tail={4} /><span style={{ color: C.textWhisper }}>#{firstHand.height.toLocaleString('en-US')}</span></span>
        </div>
      )}
      {/* How easily this pool can walk away. Depth tells you what a trade costs
          today; this tells you whether the depth will still be here tomorrow. */}
      {(() => {
        const c = holders ? lpConcentration(holders.total, holders.holders) : null
        if (!c) return null
        const alone = c.toHalf === 1
        return (
          <div style={{ ...rowStyle, marginTop: 4 }}>
            <span>Liquidity held by</span>
            <span style={{ color: alone ? C.emberLit : C.textSecondary }}>
              {c.count} {c.count === 1 ? 'wallet' : 'wallets'} · largest {c.topPct.toFixed(0)}%
              {alone ? ' · one signature empties it' : ` · ${c.toHalf} hold the majority`}
            </span>
          </div>
        )
      })()}

      {/* Fees paid are read from Astroport-code swap events; White Whale's pairs write theirs differently. */}
      {!p.empty && p.venue !== 'skeleton' && (p.tvlUsd ?? 0) >= 10 && <PoolFees pair={p.contract_addr} />}

      {/* An LP balance is a claim on a fraction of the pool. Say which fraction,
          of what, and what it is worth. The raw token count said none of that. */}
      {(() => {
        const pos = lpPosition(p, lpAll)
        if (!pos) return null
        const usd = pos.usd == null ? null : pos.usd >= 10 ? `$${Math.round(pos.usd).toLocaleString('en-US')}` : `$${pos.usd.toFixed(2)}`
        return (
          <div style={{ ...rowStyle, marginTop: 2 }}>
            <span>Your LP · <b style={{ color: C.goldLit }}>{pos.sharePct.toFixed(pos.sharePct >= 10 ? 0 : 1)}%</b> of the pool{staked !== '0' && <span style={{ color: C.textWhisper }}> · {fromMicro(staked, 6)} staked</span>}</span>
            <span style={{ color: C.textSecondary }}>
              {fmtAmount(pos.amounts[0])} {t0.label} + {fmtAmount(pos.amounts[1])} {t1.label}{usd ? ` · ${usd}` : ''}
            </span>
          </div>
        )
      })()}

      {(() => {
        const pos = lpPosition(p, lpAll)
        return pos ? <PutInRow flow={flow} tokens={p.tokens} amounts={pos.amounts} /> : null
      })()}

      {mode === 'add' && (
        <div style={{ marginTop: SPACE['3'], display: 'grid', gap: SPACE['2'] }}>
          {p.empty && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>Empty pool: the ratio you deposit sets the opening price. Choose it deliberately.{p.marketPrice ? <> Market says 1 {t0.label} ≈ <b style={{ color: C.goldLit }}>{fmtPrice(p.marketPrice)} {t1.label}</b>. Start there.</> : null}</div>}
          {!p.empty && p.deviation != null && (p.deviation > 1.25 || p.deviation < 0.8) && (
            <div style={{ fontSize: TEXT.xs.size, color: C.alert, lineHeight: 1.5 }}>
              ⚠ This pool is {(p.deviation > 1 ? p.deviation : 1 / p.deviation).toFixed(1)}× off market. Adding at this ratio hands the difference to whoever arbitrages it. Swap it back toward {fmtPrice(p.marketPrice ?? 0)} {t1.label} per {t0.label} first, or accept that you are the exit liquidity.
            </div>
          )}
          {/* Zap sizing is constant-product maths, so it is offered on xyk pools only. Not on Skeleton Swap's: its in-pool swap limit is Astroport-shaped. */}
          {!p.empty && p.pairType === 'xyk' && !twoDollars && p.venue !== 'skeleton' && (
            <div style={{ display: 'flex', gap: SPACE['2'] }}>
              {(['both', 'zap'] as const).map(sd => (
                <button key={sd} type='button' onClick={() => setSide(sd)} style={{ ...ghostBtn, padding: '3px 10px', color: side === sd ? C.goldLit : C.textMuted, borderColor: side === sd ? C.goldCore : C.divider }}>
                  {sd === 'both' ? 'Both sides' : 'One side · zap ⚡'}
                </button>
              ))}
            </div>
          )}
          {side === 'both' || p.empty || p.pairType !== 'xyk' || twoDollars || p.venue === 'skeleton' ? (
            <>
              <div style={{ display: 'flex', gap: SPACE['2'] }}>
                <input style={field} type='number' min='0' step='any' placeholder={`0.0 ${t0.label}`} value={a0} onChange={e => onA0(e.target.value)} />
                <input style={field} type='number' min='0' step='any' placeholder={`0.0 ${t1.label}`} value={a1} onChange={e => onA1(e.target.value)} />
              </div>
              {me && (
                <div style={{ ...rowStyle, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>In wallet · {fromMicro(bal[0], t0.decimals)} {t0.label} · {fromMicro(bal[1], t1.decimals)} {t1.label}</span>
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                    {([0, 1] as const).filter(i => spendable(i) > 0).map(i => (
                      <button key={i} type='button' style={{ ...ghostBtn, padding: '2px 8px' }} onClick={() => fillSide(i)}
                        title={p.empty ? `all the ${p.tokens[i].label} in this wallet` : `all the ${p.tokens[i].label} in this wallet, the other side at the pool ratio`}>
                        max {p.tokens[i].label}
                      </button>
                    ))}
                    {!p.empty && spendable(0) > 0 && spendable(1) > 0 && (
                      <button type='button' style={{ ...ghostBtn, padding: '2px 8px' }} onClick={fillMax} title='the most this wallet can add at the pool ratio'>max both</button>
                    )}
                  </span>
                </div>
              )}
              {/* What is missing, sized, and what fetching it here would cost.
                  A thin pool makes buying the other side in-pool expensive;
                  the number says when to go get it somewhere deeper first. */}
              {me && !p.empty && (short[0] > 0 || short[1] > 0) && (() => {
                const gaps = ([0, 1] as const).filter(i => short[i] > 0)
                const one = gaps.length === 1 ? gaps[0] : null
                const imp = one == null || p.pairType !== 'xyk' ? null : impactFor(one, short[one])
                return (
                  <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6, padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.dividerWarm}` }}>
                    You need {gaps.map((i, k) => {
                      const usd = unitUsd(i)
                      return (
                        <span key={i}>{k > 0 ? ' and ' : ''}<b style={{ color: C.goldLit }}>{fmtAmount(short[i])} {p.tokens[i].label}</b>{usd ? <span style={{ color: C.textWhisper }}> ({fmtUsd(short[i] * usd)})</span> : null}</span>
                      )
                    })} more for this deposit.
                    {one != null && imp != null && (Number.isFinite(imp)
                      ? <> Buying it in this pool would move the price about <b style={{ color: imp > 3 ? C.alert : C.textPrimary }}>{imp.toFixed(imp >= 10 ? 0 : 1)}%</b>{imp > 3 ? ', so getting it from a deeper market first is cheaper.' : '.'}</>
                      : <> That is more than this pool holds, so it has to come from somewhere else.</>)}
                  </div>
                )
              })()}
              {me
                ? <button type='button' style={{ ...primaryBtn, opacity: canAdd ? 1 : 0.5 }} disabled={!canAdd} onClick={add}>
                    {provide.isLoading ? 'Confirm in wallet…' : 'Add liquidity'}
                  </button>
                : <div className='terra-connect-cta'><WalletButton /></div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.5 }}>
                Bring one token. We swap the right slice for the other side and add both in <b style={{ color: C.textPrimary }}>one signature</b>. If any leg fails, nothing moves.
              </div>
              <div style={{ display: 'flex', gap: SPACE['2'] }}>
                <input style={field} type='number' min='0' step='any' placeholder={`0.0 ${zTok.label}`} value={zAmt} onChange={e => setZAmt(e.target.value)} />
                <div style={{ position: 'relative', display: 'flex' }}>
                  <TokenIcon label={zTok.label} size={20} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 1 }} />
                  <select style={{ ...select, paddingLeft: 38 }} value={zIdx} onChange={e => { setZIdx(Number(e.target.value) as 0 | 1); setZAmt('') }}>
                    <option value={0}>{t0.label}</option><option value={1}>{t1.label}</option>
                  </select>
                </div>
              </div>
              <div style={rowStyle}>
                <span>Balance {fromMicro(zBal, zTok.decimals)}</span>
                {me && Number(zBal) > 0 && <button type='button' style={{ ...ghostBtn, padding: '2px 8px' }} onClick={() => setZAmt(fromMicro((BigInt(zBal) * BigInt(9_960) / BigInt(10_000)).toString(), zTok.decimals, 6).replace(/,/g, ''))}>max</button>}
              </div>
              {useRouted && zRouted ? (() => {
                const tOut = p.tokens[zIdx === 0 ? 1 : 0]
                const legs = zRouted.plan.legs
                const via = zRouted.plan.kind === 'multi' ? " in one call to Terra Swap's router" : zRouted.plan.kind === 'router' ? " in one call to Astroport's router" : ''
                return (
                  <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6, padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.dividerWarm}` }}>
                    <div>1 · swap <b style={{ color: C.goldLit }}>{fromMicro(legs[0].offerAmount, zTok.decimals, 6)} {zTok.label}</b> → at least {fromMicro(zRouted.getMicro, tOut.decimals, 6)} {tOut.label}, routed {routeText(zRouted.swap)}{via} <span style={{ color: zRouted.impactPct > 3 ? C.alert : C.textMuted }}>({zRouted.impactPct.toFixed(2)}% impact{zPlan ? `, against ${zPlan.impact.toFixed(1)}% inside this pool` : ''})</span></div>
                    <div>2 · add <b style={{ color: C.goldLit }}>{fromMicro(zRouted.keepMicro, zTok.decimals, 6)} {zTok.label}</b> + <b style={{ color: C.goldLit }}>{fromMicro(zRouted.getMicro, tOut.decimals, 6)} {tOut.label}</b></div>
                    <div style={{ color: C.textWhisper }}>Anything the swap returns above that, and any {zTok.label} not needed to match, stays in your wallet.</div>
                  </div>
                )
              })() : zPlan && (() => {
                const tOut = p.tokens[zIdx === 0 ? 1 : 0]
                const keep = zPlan.provide[zIdx], got = zPlan.provide[zIdx === 0 ? 1 : 0]
                return (
                  <div style={{ fontSize: TEXT.xs.size, color: C.textSecondary, lineHeight: 1.6, padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.divider}` }}>
                    <div>1 · swap <b style={{ color: C.goldLit }}>{fromMicro(zPlan.swapAmount, zTok.decimals, 6)} {zTok.label}</b> → ≈ {fromMicro(zPlan.expectedReturn, tOut.decimals, 6)} {tOut.label} <span style={{ color: zPlan.impact > 3 ? C.alert : C.textMuted }}>({zPlan.impact.toFixed(2)}% impact)</span></div>
                    <div>2 · add <b style={{ color: C.goldLit }}>{fromMicro(keep.amount, zTok.decimals, 6)} {zTok.label}</b> + <b style={{ color: C.goldLit }}>{fromMicro(got.amount, tOut.decimals, 6)} {tOut.label}</b></div>
                    <div style={{ color: C.textWhisper }}>No interface fee · pool fee {poolFeeTextFor(p)} · dust from rounding stays in your wallet</div>
                  </div>
                )
              })()}
              {zInsufficient && <div style={{ fontSize: TEXT.xs.size, color: C.alert }}>{LITE ? 'Not enough balance.' : 'Not enough minerals.'} ({zTok.label})</div>}
              {me
                ? <button type='button' style={{ ...primaryBtn, opacity: canZap ? 1 : 0.5 }} disabled={!canZap} onClick={doZap}>
                    {zap.isLoading ? 'Confirm in wallet…' : useRouted ? 'Zap in ⚡ · routed · one signature' : zPlan ? 'Zap in ⚡ · one signature' : 'Enter an amount'}
                  </button>
                : <div className='terra-connect-cta'><WalletButton /></div>}
            </>
          )}
        </div>
      )}
      {mode === 'remove' && (
        <div style={{ marginTop: SPACE['3'], display: 'grid', gap: SPACE['2'] }}>
          <div style={{ display: 'flex', gap: SPACE['2'] }}>
            <input style={field} type='number' min='0' step='any' placeholder='LP amount' value={lpAmt} onChange={e => setLpAmt(e.target.value)} />
            <button type='button' style={ghostBtn} onClick={() => setLpAmt(fromMicro(lpAll, 6, 6).replace(/,/g, ''))}>all</button>
          </div>
          <button type='button' style={{ ...primaryBtn, opacity: canRemove ? 1 : 0.5 }} disabled={!canRemove} onClick={remove}>
            {withdraw.isLoading ? 'Confirm in wallet…' : 'Remove liquidity'}
          </button>
        </div>
      )}
      {mode === 'trades' && <PoolTrades p={p} />}
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginTop: SPACE['2'] }}>{err}</div>}
      {ok && <div style={{ fontSize: TEXT.xs.size, color: C.success, marginTop: SPACE['2'] }}>✓ {ok}</div>}
    </Card>
  )
}

// ─── Trades: who trades a pool, and how ─────────────────────────

const tradePanel: React.CSSProperties = {
  padding: `${SPACE['2']}px ${SPACE['3']}px`, background: C.surface, borderRadius: 10, border: `1px solid ${C.divider}`,
}
const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit',
  color: C.emberLit, textDecoration: 'underline dotted', textUnderlineOffset: 3,
}
/** Blocks → rough wall time at ~6s a block. */
function gapLabel(blocks: number): string {
  const s = blocks * 6
  if (s < 90) return `${Math.round(s)}s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 129_600) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86_400)} d`
}

function WalletLine({ s, base, quote }: { s: WalletStats; base: string; quote: string }) {
  return (
    <div style={{ display: 'grid', gap: 3, marginTop: 6, fontSize: TEXT.xs.size, color: C.textSecondary, fontVariantNumeric: 'tabular-nums', lineHeight: 1.5 }}>
      <div>
        {s.trades} trade{s.trades === 1 ? '' : 's'} here · <span style={{ color: C.success }}>{s.buys} bought</span> {fmtAmount(s.baseBought)} {base} · <span style={{ color: C.alert }}>{s.sells} sold</span> {fmtAmount(s.baseSold)} {base}
      </div>
      <div>
        Average buy {s.avgBuy == null ? '—' : fmtPrice(s.avgBuy)} · average sell {s.avgSell == null ? '—' : fmtPrice(s.avgSell)} {quote} per {base}
        {s.spreadPct != null && <> · spread <b style={{ color: s.spreadPct >= 0 ? C.success : C.alert }}>{s.spreadPct >= 0 ? '+' : ''}{s.spreadPct.toFixed(1)}%</b></>}
      </div>
      {s.medianGapBlocks != null && (
        <div style={{ color: C.textMuted }}>
          Trades about every {gapLabel(s.medianGapBlocks)} (median) · first #{s.firstH.toLocaleString('en-US')} · last #{s.lastH.toLocaleString('en-US')}
        </div>
      )}
    </div>
  )
}

/**
 * A pool opened up: its chart, its tape, and the wallets behind the tape.
 * Asked for in the community chat 2026-09-12, after Coinhall went: "click on
 * that address and see how that wallet behaves. Was really easy to identify
 * bots." Click a wallet and everything narrows to it: what it bought and sold
 * here, at what average prices, how often it trades, and where else it trades.
 * Nobody gets labelled a bot; a wallet trading both ways every few blocks at a
 * thin spread reads as what it is.
 */
function PoolTrades({ p }: { p: PoolView }) {
  const [t0, t1] = p.tokens
  const [who, setWho] = useState<string | null>(null)
  const [data, setData] = useState<TradesResponse | null>(null)
  const [across, setAcross] = useState<TradesResponse | null>(null)
  useEffect(() => {
    let alive = true
    setData(null)
    fetch(`/api/dex-trades?pair=${p.contract_addr}${who ? `&address=${who}` : ''}`)
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setData(j) }).catch(() => {})
    return () => { alive = false }
  }, [p.contract_addr, who])
  useEffect(() => {
    let alive = true
    setAcross(null)
    if (!who) return
    fetch(`/api/dex-trades?address=${who}`)
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive) setAcross(j) }).catch(() => {})
    return () => { alive = false }
  }, [who])

  const elsewhere = (across?.byPool ?? []).filter(b => b.pair !== p.contract_addr)
  return (
    <div style={{ marginTop: SPACE['3'], display: 'grid', gap: SPACE['2'] }}>
      <PriceChart pool={p} from={t0} to={t1} />
      {!data ? (
        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>Reading the ledger…</div>
      ) : (
        <>
          {who ? (
            <div style={tradePanel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flexWrap: 'wrap' }}>
                <span style={{ fontSize: TEXT.sm.size, color: C.textPrimary, fontWeight: 700 }}><Nick address={who} head={10} tail={6} /></span>
                <a href={`https://terrasco.pe/mainnet/address/${who}`} target='_blank' rel='noreferrer' style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>explorer ↗</a>
                <button type='button' style={{ ...ghostBtn, padding: '2px 8px', marginLeft: 'auto' }} onClick={() => setWho(null)}>all wallets</button>
              </div>
              {data.wallets[0] && data.wallets[0].trades > 0
                ? <WalletLine s={data.wallets[0]} base={t0.label} quote={t1.label} />
                : <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginTop: 6 }}>No trades in this pool.</div>}
              {elsewhere.length > 0 && (
                <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginTop: 6 }}>
                  Also trades {elsewhere.map(b => `${b.label} ×${b.stats.trades}`).join(' · ')}
                </div>
              )}
            </div>
          ) : (
            <div style={tradePanel}>
              <div style={{ ...rowStyle, padding: '0 0 4px', flexWrap: 'wrap' }}>
                <span>
                  {data.total} trade{data.total === 1 ? '' : 's'} · <span style={{ color: C.success }}>{data.buys} buys</span> · <span style={{ color: C.alert }}>{data.sells} sells</span>
                </span>
                <span style={{ color: C.textWhisper }}>a buy takes {t0.label} out</span>
              </div>
              {data.wallets.map(s => (
                <div key={s.address} style={{ display: 'flex', gap: SPACE['2'], alignItems: 'baseline', flexWrap: 'wrap', fontSize: TEXT.xs.size, color: C.textMuted, padding: '3px 0', fontVariantNumeric: 'tabular-nums' }}>
                  <button type='button' style={linkBtn} onClick={() => setWho(s.address)} title='show only this wallet'><Nick address={s.address} head={8} tail={4} /></button>
                  <span>{s.trades} · <span style={{ color: C.success }}>{s.buys}▲</span> <span style={{ color: C.alert }}>{s.sells}▼</span></span>
                  {s.spreadPct != null && <span>spread {s.spreadPct >= 0 ? '+' : ''}{s.spreadPct.toFixed(1)}%</span>}
                  {s.medianGapBlocks != null && <span style={{ marginLeft: 'auto', color: C.textWhisper }}>every ~{gapLabel(s.medianGapBlocks)}</span>}
                </div>
              ))}
            </div>
          )}
          <div style={tradePanel}>
            <div style={{ fontSize: TEXT.caption.size, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textWhisper, marginBottom: 4 }}>
              {who ? 'Their trades here' : 'Every trade'} · newest first
            </div>
            {data.tape.length === 0 && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>No trades yet.</div>}
            {data.tape.map(t => (
              <div key={t.tx} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: TEXT.xs.size, color: C.textMuted, fontVariantNumeric: 'tabular-nums', padding: '3px 0', borderTop: `1px solid ${C.divider}` }}>
                <span style={{ color: t.side === 'buy' ? C.success : C.alert, fontWeight: 700, minWidth: 30 }}>{t.side === 'buy' ? 'BUY' : 'SELL'}</span>
                <span style={{ color: C.textSecondary }}>{fmtAmount(t.base)} {t0.label}</span>
                <span>for {fmtAmount(t.quote)} {t1.label}</span>
                <span style={{ color: C.textWhisper }}>@ {fmtPrice(t.price)}</span>
                {!who && <button type='button' style={linkBtn} onClick={() => setWho(t.address)} title='show only this wallet'><Nick address={t.address} head={6} tail={4} /></button>}
                <a href={finderTx(t.tx)} target='_blank' rel='noreferrer' style={{ marginLeft: 'auto', color: C.textWhisper, textDecoration: 'none' }}>#{t.h.toLocaleString('en-US')} ↗</a>
              </div>
            ))}
            {data.unpriced > 0 && (
              <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>
                {data.unpriced} older swap{data.unpriced === 1 ? '' : 's'} recorded before amounts were kept, counted but not shown.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Create tab ─────────────────────────────────────────────────

/**
 * Astroport's own settings for a concentrated pool, read from its LUNA/USDC and
 * CAPA/LUNA pools on 2026-09-13; the two were identical. Only the starting
 * price differs from pool to pool.
 */
/**
 * Tokens a new pool can hold. Astroport's factory rejects a TokenFactory denom
 * with capitals in it ("Non-IBC token denom should be lowercase"), so ampROAR
 * trades in its existing pools but cannot open new ones.
 */
const CREATABLE_TOKENS = KNOWN_TOKENS.filter(t => !('native_token' in t.info && t.info.native_token.denom.startsWith('factory/') && /[A-Z]/.test(t.info.native_token.denom)))

const PCL_DEFAULTS = {
  amp: '10', gamma: '0.000145', mid_fee: '0.0026', out_fee: '0.0045', fee_gamma: '0.00023',
  repeg_profit_threshold: '0.000002', min_price_scale_delta: '0.000146', ma_half_time: 600,
}
/**
 * LUNA against a liquid staking token, whose price creeps up as staking
 * rewards accrue: the settings of Astroport's own LUNA/ampLUNA pool, read
 * 2026-09-16. A high amp keeps liquidity tight around the price, and the pool
 * re-pegs on small profits so it follows the token's rising rate.
 */
const PCL_LST = {
  amp: '500', gamma: '0.01', mid_fee: '0.0003', out_fee: '0.0045', fee_gamma: '0.3',
  repeg_profit_threshold: '0.00000001', min_price_scale_delta: '0.0000055', ma_half_time: 600, track_asset_balances: false,
}
/** Astroport's stable pools on Terra use amp 10 (its LUNA/bLUNA pool, read 2026-09-16). */
const STABLE_DEFAULTS = { amp: 10 }
const LST_KEYS = new Set(['ampLUNA', 'bLUNA', 'arbLUNA', 'stLUNA', 'LunaX'])
type PoolKind = 'xyk' | 'concentrated' | 'stable'

function CreatePanel({ pools, marketPx, onDone, onCreated, onBack, onParty }: { pools: PoolView[]; marketPx?: Record<string, number> | null; onDone: () => void; onCreated: () => void; onBack?: () => void; onParty: (x: Party) => void }) {
  const me = useMyAddress()
  const create = useCreatePair()
  // Both factories from one page since pools.openfields.app was folded into this one (2026-09-14).
  const [venue, setVenue] = useState<Venue>(HOME_VENUE)
  const [a, setA] = useState(assetId(KNOWN_TOKENS[0].info))
  const [b, setB] = useState(assetId(KNOWN_TOKENS[1].info))
  const [kind, setKind] = useState<PoolKind>('xyk')
  const [startPrice, setStartPrice] = useState('')
  const [registered, setRegistered] = useState<boolean | null>(true)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const ta = KNOWN_TOKENS.find(t => assetId(t.info) === a)!
  const tb = KNOWN_TOKENS.find(t => assetId(t.info) === b)!
  const ia = ta.info, ib = tb.info
  // Terra Swap has two factories: standard pools on the first, concentrated and stable pools on factory v2 (contracts/factory-v2).
  const v2 = venue === 'terraswap' && !!TERRA_SWAP_FACTORY_V2
  const kinds: PoolKind[] = v2 ? ['xyk', 'concentrated', 'stable'] : ['xyk', 'concentrated']
  const factory = venue === 'terraswap' && kind !== 'xyk' ? TERRA_SWAP_FACTORY_V2 : VENUE_FACTORY[venue]
  const exists = pools.some(p => factoryOf(p) === factory && p.tokens.some(t => sameAsset(t.info, ia)) && p.tokens.some(t => sameAsset(t.info, ib)))
  // A pool type the chosen factory does not open falls back to standard.
  useEffect(() => {
    if ((venue === 'astroport' && kind === 'stable') || (venue === 'terraswap' && !TERRA_SWAP_FACTORY_V2 && kind !== 'xyk')) setKind('xyk')
  }, [venue, kind])

  // Astroport's factory refuses a native token its coin registry does not know. Say so before asking for a signature.
  useEffect(() => {
    let alive = true
    const natives = [ia, ib].filter(i => 'native_token' in i).map(i => assetId(i))
    if ((venue !== 'astroport' && kind === 'xyk') || natives.length === 0) { setRegistered(true); return }
    setRegistered(null)
    Promise.all(natives.map(d => smart<number>(COIN_REGISTRY, { native_token: { denom: d } })))
      .then(r => { if (alive) setRegistered(r.every(x => typeof x === 'number')) })
    return () => { alive = false }
  }, [ia, ib, venue, kind])

  // A concentrated pool starts at a price: how much of the first token one of the second is worth.
  useEffect(() => {
    const pa = marketPx?.[a], pb = marketPx?.[b]
    setStartPrice(pa && pb && pa > 0 && pb > 0 ? String(Number((pb / pa).toPrecision(8))) : '')
  }, [a, b, marketPx])
  const priceScale = (() => {
    const n = Number(startPrice)
    if (!(n > 0) || !Number.isFinite(n)) return null
    const s = n.toFixed(18).replace(/\.?0+$/, '')
    return Number(s) > 0 ? s : null
  })()
  const pcl = kind === 'concentrated' && (venue === 'astroport' || v2)
  const stable = kind === 'stable' && v2
  const lstPair = [ta, tb].some(t => LST_KEYS.has(t.key)) && [ta, tb].some(t => 'native_token' in t.info && t.info.native_token.denom === 'uluna')
  const can = !!me && !!factory && a !== b && !exists && registered === true && (!pcl || !!priceScale) && !create.isLoading
  const go = async () => {
    if (!can) return
    setErr(null); setOk(false)
    try {
      await create.mutateAsync({
        assetInfos: [ia, ib] as [AssetInfo, AssetInfo], sender: me,
        pairType: pcl ? 'concentrated' : stable ? 'stable' : 'xyk',
        initParams: pcl && priceScale ? { ...(lstPair ? PCL_LST : PCL_DEFAULTS), price_scale: priceScale } : stable ? STABLE_DEFAULTS : undefined,
        factory,
      })
      setOk(true); onDone()
      // The board scores Terra Swap's pools; an Astroport pool earns no stamp.
      if (!LITE && venue === 'terraswap') onParty({ emoji: '🏗️', title: 'BUILDER', sub: 'You opened a pool. 50 points, the stamp is yours, and it is empty. Go be its first hand too.' })
      // The pool exists now but is empty; take them straight to Pools where
      // they (or anyone) can be the first hand in it.
      setTimeout(onCreated, 3400)
    } catch (e) { setErr(humanizeTxError(e)) }
  }
  return (
    <Card>
      {/* Opening a pool lives inside Pools; the way back is where people look for it, beside the title. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE['2'] }}>
        <Section title='Open a pool' />
        {onBack && <button type='button' onClick={onBack} style={{ background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer', fontFamily: 'inherit', fontSize: TEXT.xs.size, padding: 0 }}>← All pools</button>}
      </div>
      <div style={{ display: 'flex', gap: SPACE['2'], margin: `${SPACE['2']}px 0 0`, flexWrap: 'wrap' }}>
        {(['terraswap', 'astroport'] as const).map(v => (
          <button key={v} type='button' onClick={() => setVenue(v)} style={{ ...ghostBtn, padding: '3px 10px', color: venue === v ? C.goldLit : C.textMuted, borderColor: venue === v ? C.goldCore : C.divider }}>
            On {VENUE_NAME[v]}
          </button>
        ))}
      </div>
      <p style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6, margin: `${SPACE['2']}px 0 ${SPACE['3']}px` }}>
        {venue === 'astroport'
          ? <>Astroport&apos;s factory lets anyone open a pool. It costs gas; the pool opens empty and the first deposit fills it. A standard pool spreads liquidity over every price. A concentrated pool uses Astroport&apos;s own settings and starts at the price you give it. Not affiliated with Astroport.</>
          : v2
            ? <>Terra Swap&apos;s factories have no owner and take no fee: a pool&apos;s fee goes to its liquidity providers. A standard pool spreads liquidity over every price. A concentrated pool keeps it near the price, which suits LUNA against ampLUNA or bLUNA. A stable pool is for two tokens that should trade 1:1. Creating a pool costs gas and nothing else, and it opens empty.</>
            : <>Terra Swap&apos;s factory has no owner and takes no fee. Creating the pool costs gas and nothing else; it opens empty, and whoever adds liquidity first sets the price.</>}
      </p>
      {(venue === 'astroport' || v2) && (
        <div style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['3'] }}>
          {kinds.map(k => (
            <button key={k} type='button' onClick={() => setKind(k)} style={{ ...ghostBtn, padding: '3px 10px', color: kind === k ? C.goldLit : C.textMuted, borderColor: kind === k ? C.goldCore : C.divider }}>
              {k === 'xyk' ? 'Standard' : k === 'concentrated' ? 'Concentrated' : 'Stable'}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: SPACE['2'], alignItems: 'center', marginBottom: SPACE['3'] }}>
        <TokenSelect value={a} onChange={setA} options={CREATABLE_TOKENS} style={{ flex: 1 }} />
        <span style={{ color: C.textMuted }}>/</span>
        <TokenSelect value={b} onChange={setB} options={CREATABLE_TOKENS} style={{ flex: 1 }} />
      </div>
      {pcl && (
        <div style={{ marginBottom: SPACE['3'] }}>
          <label style={label}>Starting price · 1 {tb.label} = ? {ta.label}</label>
          <input style={field} type='number' min='0' step='any' placeholder='0.0' value={startPrice} onChange={e => setStartPrice(e.target.value)} />
          <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Filled from the market where both tokens have a price. Check it: the pool trades around it until liquidity moves it.</div>
          {lstPair && <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, marginTop: 4 }}>Uses the settings of Astroport&apos;s LUNA/ampLUNA pool, made for a token whose price rises slowly against LUNA.</div>}
        </div>
      )}
      {registered === false && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>Astroport&apos;s coin registry does not know one of these tokens, so the factory would refuse the pool.</div>}
      {exists && <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginBottom: SPACE['2'] }}>That pool already exists. Add liquidity to it instead.{!LITE && <> <span style={{ color: C.goldLit }}>You must construct additional pylons.</span></>}</div>}
      {a === b && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>Pick two different tokens.</div>}
      {err && <div style={{ fontSize: TEXT.xs.size, color: C.alert, marginBottom: SPACE['2'] }}>{err}</div>}
      {ok && <div style={{ fontSize: TEXT.xs.size, color: C.success, marginBottom: SPACE['2'] }}>✓ Pool created. It will show in Pools once the block lands.</div>}
      {me
        ? <button type='button' style={{ ...primaryBtn, opacity: can ? 1 : 0.5 }} disabled={!can} onClick={go}>
            {create.isLoading ? 'Confirm in wallet…' : 'Create pool'}
          </button>
        : <div className='terra-connect-cta'><WalletButton /></div>}
    </Card>
  )
}

// ─── Leaderboard ────────────────────────────────────────────────

function BadgeChip({ b }: { b: { emoji: string; name: string; hint: string } }) {
  return (
    <span title={`${b.name} · ${b.hint}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999,
      fontSize: TEXT.xs.size, color: C.textSecondary, border: `1px solid ${C.divider}`,
      background: 'rgba(255,216,61,0.04)', whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: '0.95em' }}>{b.emoji}</span>{b.name}
    </span>
  )
}

function Leaderboard({ board, me, onGoSwap, height, crystal, spotlight }: { board: BoardResponse | null; me: string; onGoSwap: () => void; height: number; crystal: boolean; spotlight: string }) {
  // Rows whose points moved since the last poll flash gold for a beat. Hooks
  // live above the early return so their order never changes.
  const prevPts = useRef<Map<string, number> | null>(null)
  const rowsNow = board?.rows ?? []
  const changed = new Set<string>()
  if (prevPts.current) for (const r of rowsNow) { const p = prevPts.current.get(r.address); if (p !== undefined && p !== r.points) changed.add(r.address) }
  useEffect(() => { prevPts.current = new Map(rowsNow.map(r => [r.address, r.points])) }, [board]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!board) return <Empty title='Loading the board…' body='' />
  const rules = board.rules
  const mine = board.rows.find(r => r.address === me)
  return (
    <div style={{ display: 'grid', gap: SPACE['3'] }}>
      {me && !mine && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['3'], flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontFamily: TERRA_FONT, fontWeight: 700, color: C.textPrimary }}>You are here. You are not written down yet.</div>
              <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginTop: 3, lineHeight: 1.5 }}>One swap fixes that. Five points, a spot on the board, and the 🐎 if you are quick.</div>
            </div>
            <button type='button' onClick={onGoSwap} style={{ ...primaryBtn, width: 'auto', padding: '0.6rem 1rem' }}>Make a move →</button>
          </div>
        </Card>
      )}
      {mine && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['3'], flexWrap: 'wrap' }}>
            <span style={{ fontSize: TEXT.xs.size, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center' }}><Glyph addr={me} size={18} />You</span>
            <span style={{ fontFamily: TERRA_FONT, fontSize: TEXT.lg.size, color: C.goldLit }}>#{mine.rank}</span>
            <span style={{ fontSize: TEXT.md.size, color: C.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{mine.points.toLocaleString('en-US')} pts</span>
            <span style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.emberLit, fontFamily: TERRA_FONT }}>{rankTitle(mine.points)}</span>
            {mine.rank > 1 && board.rows[0] && (() => {
              const gap = board.rows[0].points - mine.points
              const per = mine.crystal ? 7.5 : 5
              return <span style={{ fontSize: TEXT.xs.size, color: C.textMuted, width: '100%' }}>{gap.toLocaleString('en-US')} pts behind #1 · that is {Math.ceil(gap / per)} swaps, or a pool and its first hand</span>
            })()}
            {mine.rank === 1 && <span style={{ fontSize: TEXT.xs.size, color: C.goldLit, width: '100%' }}>Top of the board. Everyone below is coming for it.</span>}
            {board.rows[mine.rank] && (() => { const r = board.rows[mine.rank]; const gap = mine.points - r.points; return <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper, width: '100%' }}>Behind you: <WalletName address={r.address} head={6} tail={4} /> · {gap.toLocaleString('en-US')} pts back{gap <= 25 ? ' · one swap and they pass you' : ''}.</span> })()}
            <span style={{ fontSize: TEXT.xs.size, color: C.textSecondary, width: '100%', fontStyle: 'italic' }}>🥠 오늘의 운세 · {fortune(me)}</span>
            <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper, width: '100%' }}>{race(me)}</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{mine.badges.map(b => <BadgeChip key={b.name} b={b} />)}</div>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${mine.badges.map(b => b.emoji).join('')} #${mine.rank} on the Terra Swap board · ${mine.points.toLocaleString('en-US')} pts\n\nA DEX built in a night for the price of gas. Steady lads.\n${location.origin}/?who=${me}`)}`}
              target='_blank' rel='noreferrer'
              style={{ ...ghostBtn, marginLeft: 'auto', textDecoration: 'none', color: C.goldLit, borderColor: C.goldCore }}
            >Share on X</a>
            <a href={`/api/og/swap?who=${me}`} target='_blank' rel='noreferrer' style={{ ...ghostBtn, textDecoration: 'none' }} title='your card, as a picture'>Your card ↗</a>
          </div>
        </Card>
      )}

      {board.lotd && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE['3'], flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.6rem' }}>🌕</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: C.korea, fontWeight: 800 }}>Lunatic of the day · 오늘의 루나틱</div>
              <div style={{ fontFamily: TERRA_FONT, fontWeight: 700, color: C.textPrimary, fontSize: TEXT.md.size }}><WalletName address={board.lotd.address} head={8} tail={4} /></div>
              <div style={{ fontSize: TEXT.xs.size, color: C.textMuted }}>{board.lotd.moves} move{board.lotd.moves === 1 ? '' : 's'} in the last ~24h. 대박.{board.lotd.address === me ? ' That is you. Take a bow.' : ''}</div>
            </div>
          </div>
        </Card>
      )}
      {(() => {
        const left = (board.rules.cutoffHeight ?? 0) - (height || 0)
        const open = height > 0 && left > 0
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12,
            background: open ? 'rgba(255,179,71,0.08)' : C.surface, border: `1px solid ${open ? C.dividerWarm : C.divider}`,
            fontFamily: TERRA_FONT, fontSize: TEXT.xs.size, color: C.textSecondary,
          }}>
            <span style={{ fontSize: '1.1rem' }}>🐎</span>
            {open ? (
              <span>Steady Lad window <b style={{ color: C.goldLit }}>closes in ~{blocksToHuman(left)}</b> · block {board.rules.cutoffHeight.toLocaleString('en-US')} · anyone who moves before then keeps the badge forever</span>
            ) : height > 0 ? (
              <span>The Steady Lad window has closed. The ones who made it are marked. That is that.</span>
            ) : <span>Steady Lad window: first week from launch.</span>}
          </div>
        )
      })()}
      {me && <Trials mine={mine ?? null} crystal={crystal} />}

      <Card>
        <Section title='The board' />
        {board.rows.length >= 2 && <Podium rows={board.rows} />}
        {board.rows.length === 0 ? (
          <p style={{ fontSize: TEXT.sm.size, color: C.textMuted, margin: `${SPACE['2']}px 0 0`, lineHeight: 1.6 }}>
            Nobody yet. The first swap, the first pool, the first liquidity: whoever does it goes straight to the top, and stays written down.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 2, marginTop: SPACE['2'] }}>
            {board.rows.slice(0, 50).map(r => (
              <div key={r.address} id={`row-${r.address}`} className={[r.address === spotlight ? 'terra-spotlight' : '', changed.has(r.address) ? 'terra-row-flash' : ''].join(' ').trim() || undefined} onClick={() => {
                const you = r.address === me
                const line = r.swaps === 0 ? { q: "I don't debate the poor on Twitter.", pose: 'shrug' as const }
                  : r.swaps >= 10 ? { q: 'Yeah but your size is not size.', pose: 'point' as const }
                  : r.creates > 0 ? { q: 'Steady lads, deploying more capital 🫡', pose: 'salute' as const }
                  : { q: 'Close to announcing a recovery plan. Hang tight.', pose: 'stand' as const }
                kwonSay({ ...line, when: `reacting to #${r.rank}${you ? ' · you' : ''} · @stablekwon` })
                document.getElementById('kwon-line')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }} onDoubleClick={e => { e.preventDefault(); const cur = readNicks()[r.address] ?? ''; const n = window.prompt('Name this lad (only on this device):', cur); if (n !== null) setNick(r.address, n) }} title='click: the man on the line has an opinion · double-click: name this lad' style={{ cursor: 'pointer',
                display: 'grid', gridTemplateColumns: '2.2rem 1fr auto', alignItems: 'center', gap: SPACE['2'],
                padding: '7px 8px', borderRadius: 8,
                background: r.address === spotlight ? 'rgba(61,220,151,0.10)' : r.address === me ? 'rgba(255,216,61,0.06)' : r.rank <= 3 ? 'rgba(255,179,71,0.04)' : 'transparent',
                borderLeft: `2px solid ${r.address === spotlight ? C.success : r.rank === 1 ? C.goldLit : r.rank <= 3 ? C.emberLit : 'transparent'}`,
              }}>
                <span style={{ fontFamily: TERRA_FONT, fontWeight: 700, color: r.rank <= 3 ? C.goldLit : C.textMuted, fontSize: TEXT.sm.size }}>{r.rank}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: TEXT.sm.size, color: C.textPrimary, display: 'inline-flex', alignItems: 'center' }}><Glyph addr={r.address} /><Nick address={r.address} head={8} tail={4} /></span>
                    {r.badges.map(b => <span key={b.name} title={`${b.name} · ${b.hint}`} style={{ fontSize: '0.95rem', cursor: 'default' }}>{b.emoji}</span>)}
                  </div>
                  <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, marginTop: 2 }}>
                    {[r.swaps && `${r.swaps} swap${r.swaps === 1 ? '' : 's'}`, r.provides && `${r.provides} add${r.provides === 1 ? '' : 's'}`, r.creates && `${r.creates} pool${r.creates === 1 ? '' : 's'}`, r.firstHands && `${r.firstHands} first hand${r.firstHands === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || '—'}
                    {/* Standing, not history: this is liquidity still in the pools right now. */}
                    {r.liquidityUsd != null && r.liquidityUsd > 0 && (
                      <span style={{ color: C.goldLit }}> · <b>${r.liquidityUsd >= 10 ? Math.round(r.liquidityUsd).toLocaleString('en-US') : r.liquidityUsd.toFixed(2)} still in</b></span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: TEXT.sm.size, color: C.goldLit, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.points.toLocaleString('en-US')}</div>
                  <div style={{ fontSize: '0.56rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textWhisper, fontFamily: TERRA_FONT }}>{rankTitle(r.points)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {board.rows.some(r => r.early) && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE['2'] }}>
            <Section title='🐎 The Steady Lads' />
            <span style={{ marginLeft: 'auto', fontSize: TEXT.xs.size, color: C.textWhisper }}>here in week one · marked forever</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {board.rows.filter(r => r.early).map(r => (
              <span key={r.address} style={{ fontSize: TEXT.xs.size, color: r.address === me ? C.goldLit : C.textSecondary, background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 999, padding: '3px 9px' }}>
                <WalletName address={r.address} head={6} tail={4} />
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <Section title='How points work' />
        <div style={{ display: 'grid', gap: 4, marginTop: SPACE['2'], fontSize: TEXT.xs.size, color: C.textMuted }}>
          <Row k='🏗️ Open a pool' v={`${rules.points.create_pair} pts`} />
          <Row k='🌊 First liquidity into a pool' v={`+${rules.firstHand} pts`} hi />
          <Row k='💧 Add liquidity' v={`${rules.points.provide_liquidity} pts`} />
          <Row k='🔁 Swap' v={`${rules.points.swap} pts`} />
          <Row k='✦ Hold a Crystal' v={`everything × ${rules.crystalMultiplier}`} hi />
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: SPACE['3'] }}>
          {Object.values(rules.badges).map(b => <BadgeChip key={b.name} b={b} />)}
        </div>
        <p style={{ fontSize: TEXT.xs.size, color: C.textWhisper, margin: `${SPACE['3']}px 0 0`, lineHeight: 1.5 }}>
          Points are a game and buy nothing. Read straight off the chain, so they can&apos;t be edited, only earned.
        </p>
      </Card>
    </div>
  )
}

// ─── Flavour ────────────────────────────────────────────────────
//
// Terra survivor humour: the community jokes about having *stayed*, never
// about the people who got hurt. Steady lads. The chain that came back named
// itself Phoenix. Half of these are real hints wearing a costume.

const STEADY_LINES: string[] = [
  'steady lads.',
  'still here. still bidding.',
  'the chain came back from the dead and named itself Phoenix. on the nose, honestly.',
  'Lunatics: the only community that turned a tombstone into a group chat.',
  'we all said we were early. turns out we were just here first.',
  'gm to everyone who never sold the story.',
  'wen? now. that is the whole answer. now.',
  'diamond hands was never the flex. still being here is.',
  'somewhere a spreadsheet says this is a bad idea. deploy anyway.',
  'not financial advice. barely even a suggestion.',
  'hold a Crystal → 1.5× on every point. ✦',
  'first liquidity into a pool is +100 points and a 🌊 nobody can take back.',
  'open a pool for 50 points. permissionless. nobody is asking your permission.',
  'every point is read straight off the chain. cannot be bought. only done.',
  '🐎 the Steady Lad badge means you were here in week one. the clock is running.',
  'pool fee is 30 bps and all of it goes to whoever provides the liquidity. we keep none.',
  'the board never lies. it just reads the chain back to you.',
  'you don not need our permission to open a pool. that is sort of the whole point.',
  'small size. big vibes. this is a beta and proud of it.',
  '"there is also entertainment in watching them die." we chose to be the entertainment.',
  '"i don\'t debate the poor." we do. we are the poor. gm.',
  '"steady lads, deploying more capital." we did. it was twelve dollars.',
  'born in seoul. burned everywhere. rebuilt by whoever stayed. 화이팅.',
  '빨리빨리 mode: press / then type. the koreans were right about speed.',
  'type kimchi. we dare you.',
  'type soju. it is late somewhere.',
  '대박 means jackpot. it is what you say when someone seeds a pool at 3am.',
  'the moon in the footer is real. luna means moon. this was always about the moon.',
  'there is a man walking a line at the bottom of the page. he has things to say. he said them first.',
  'press p. catch the capital. dodge the kimchi. the burrito is in there somewhere.',
  'turn the sound on and he will read his tweets to you. we are sorry. we are not sorry.',
  'on a phone? tap the moon in the footer seven times.',
  'press t. twelve seconds of 2020. station blue. we were all younger.',
  'press v. the page becomes a korean news channel. he is the anchor. of course he is.',
  'double-click a name on the board to call them something. only your screen will know.',
  'the footer knows the weather in seoul. the sky over the line follows it. this is a normal dex.',
  'pylon protocol was a starcraft reference. he is a starcraft man. this page has apm now.',
  'terra. terran. he is korean. you do the math.',
  'type pylon. type gg. type aiur. the page went to a pc방 in 2009 and never fully came back.',
  'there is a minimap. bottom left. press m. the empty pools are in the fog.',
  'the cheat codes work. some of them. try black sheep wall.',
  'click him too many times. go on. he is a unit. units have opinions.',
  'connected? there is a fortune on your card. 오늘의 운세. it changes at midnight.',
  'to the moon is a destination. steady lads is a lifestyle.',
  'terra finder is a ghost now, still says "searching" forever. we link terrascope. respect to both.',
  'terra station used to show you the block. look top right. so do we.',
  'press / to type an amount. press f to flip. you are welcome.',
  'there is a code. up up down down. you know the rest.',
  'triple-click the wordmark. go on.',
  'the tape under the chart is every real trade, straight off the chain. no candles were harmed.',
  'gm is still said daily in the terra channels. the channels are still there. so are we.',
  'wen moon? check the footer. it is a real moon. it has a real date.',
  'the wire above never stops. every line is a real human doing a real thing on-chain.',
  'type gm. anywhere. go on.',
  'lunatic → steady lad → degen emeritus → phoenix → cosmic. titles buy nothing. they are still yours.',
  'there are trials on the board. eight of them. nobody has all eight yet.',
  'every pool remembers its first hand. scroll the pools. names are there.',
  'the steady lad window is a real block number. it is closing. it will not reopen.',
  'there is a speaker in the footer. it is off. it is tiny. it is optional.',
  'the block pill says who proposed it. when it says SOLID, that was us. 🫡',
  'click THE WIRE. every move, every receipt. nothing hidden, nothing edited.',
  'type moon. type luna. type wen. the page has opinions.',
  '$100 moves it ~x% on every pool row. that is how thin the water is. add to it.',
]

function Ticker({ extra }: { extra?: string[] }) {
  const lines = useMemo(() => {
    const base = [...(extra ?? []), ...STEADY_LINES]
    for (let i = base.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[base[i], base[j]] = [base[j], base[i]]
    }
    return base
  }, [extra])
  const [i, setI] = useState(0)
  const [vis, setVis] = useState(true)
  useEffect(() => {
    const iv = setInterval(() => {
      setVis(false)
      setTimeout(() => { setI(x => (x + 1) % lines.length); setVis(true) }, 450)
    }, 7000)
    return () => clearInterval(iv)
  }, [lines.length])
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, minHeight: '2.4em',
      margin: `-${SPACE['2']}px 0 ${SPACE['4']}px`, paddingLeft: SPACE['3'],
      fontSize: TEXT.xs.size, color: C.goldLit, lineHeight: 1.6, letterSpacing: '0.02em',
    }}>
      <span style={{ opacity: vis ? 1 : 0.25, transition: 'opacity 0.45s ease', flexShrink: 0 }}>✦</span>
      <span style={{ opacity: vis ? 1 : 0, transition: 'opacity 0.45s ease', fontStyle: 'italic' }}>{lines[i]}</span>
    </div>
  )
}

/** A different confirmation every time a swap lands — small dopamine. */
const SWAP_QUIPS: string[] = [
  '✓ Done. Steady.',
  '✓ 화이팅. Filled.',
  '✓ 대박. Swapped.',
  '✓ Deploying capital. Small capital. Done. 🫡',
  '✓ 빨리빨리. Done.',
  '✓ Swapped. The board saw that.',
  '✓ Filled. Written down.',
  '✓ Executed. gm.',
  '✓ Sent it. Small size, big energy.',
  '✓ Done. The chain remembers.',
]

// ─── Hero + live stats ──────────────────────────────────────────

/** Local nicknames: name a lad on THIS device only. Never leaves the browser. */
const NICK_KEY = 'terraswap_nicks'
function readNicks(): Record<string, string> { try { return JSON.parse(localStorage.getItem(NICK_KEY) || '{}') } catch { return {} } }
function setNick(addr: string, name: string) { try { const n = readNicks(); if (name.trim()) n[addr] = name.trim().slice(0, 18); else delete n[addr]; localStorage.setItem(NICK_KEY, JSON.stringify(n)); window.dispatchEvent(new CustomEvent('terra:nicks')) } catch { /* private */ } }
function Nick({ address, head = 6, tail = 4 }: { address: string; head?: number; tail?: number }) {
  const [nick, setN] = useState<string | undefined>(undefined)
  useEffect(() => {
    const load = () => setN(readNicks()[address])
    load(); window.addEventListener('terra:nicks', load)
    return () => window.removeEventListener('terra:nicks', load)
  }, [address])
  return nick
    ? <span title={address} style={{ color: C.goldLit }}>{nick} <span style={{ color: C.textWhisper, fontWeight: 400, fontSize: '0.85em' }}>· {address.slice(0, head)}…{address.slice(-tail)}</span></span>
    : <WalletName address={address} head={head} tail={tail} />
}

/** 추석 — Korean harvest moon festival. Three days; the moon is full and so is the table. */
const CHUSEOK: Record<number, string> = { 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12' }
function isChuseok(d = new Date()): boolean {
  const c = CHUSEOK[d.getFullYear()]; if (!c) return false
  const mid = new Date(c + 'T12:00:00Z').getTime(), t = d.getTime()
  return Math.abs(t - mid) <= 36 * 3600 * 1000
}

/** TV mode: the page as a Korean 24h news channel. Press v. */
function TvMode({ data, board, onClose }: { data: DexResponse; board: BoardResponse | null; onClose: () => void }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const kst = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
  const deepest = [...data.pools].filter(p => !p.empty).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]
  const m = moonPhase()
  const byAddr = new Map(data.pools.map(p => [p.contract_addr, p.label]))
  const nicks = readNicks()
  const who = (a: string) => (nicks[a] ?? `${a.slice(0, 9)}…${a.slice(-4)}`).toUpperCase()
  const headline = (e: { action: string; address: string; contract: string; height: number }) => {
    const where = (byAddr.get(e.contract) ?? 'A POOL').toUpperCase()
    switch (e.action) {
      case 'create_pair': return `BREAKING · ${who(e.address)} OPENS ${where}. NOBODY ASKED PERMISSION.`
      case 'provide_liquidity': return `${who(e.address)} ADDS TO ${where}. MARKETS: STEADY.`
      case 'swap': return `${who(e.address)} SWAPS ON ${where}. SIZE: NOT SIZE.`
      case 'withdraw_liquidity': return `${who(e.address)} PULLS FROM ${where}. NO COMMENT FROM THE LINE.`
      default: return `${who(e.address)} MOVES ON ${where}.`
    }
  }
  const crawl = (board?.recent ?? []).map(e => `${ACTION_EMOJI[e.action] ?? '•'} ${who(e.address)} ${(ACTION_VERB[e.action] ?? e.action).toUpperCase()} ${(byAddr.get(e.contract) ?? 'A POOL').toUpperCase()} #${e.height.toLocaleString('en-US')}`)
  const stats = `LIQUIDITY $${Math.round(data.tvlUsd).toLocaleString('en-US')} · POOLS ${data.pools.length} · ON THE BOARD ${board?.rows.length ?? 0} · MOVES ${board?.totalEvents ?? 0} · BLOCK #${data.height.toLocaleString('en-US')}${data.proposer ? ` · PROPOSED BY ${data.proposer.toUpperCase()}` : ''}`
  const track = [...crawl, stats, ...crawl, stats]
  return (
    <div className='terra-tv' onClick={onClose} role='presentation'>
      <div className='terra-tv-top'>
        <span className='terra-tv-live'>● LIVE</span>
        <span style={{ fontWeight: 700, letterSpacing: '0.18em' }}>LUNATIC NEWS 24 · 서울</span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{kst} KST</span>
        <span>{m.emoji} {m.name.toUpperCase()}</span>
        {data.seoul && <span>SEOUL {data.seoul.temp}°C {wxEmoji(data.seoul.code)}</span>}
        <span>DAY {dayOfExperiment()}</span>
      </div>
      <div className='terra-tv-body' onClick={e => e.stopPropagation()}>
        <div className='terra-tv-main'>
          <div className='terra-tv-tag'>MARKET · {deepest ? deepest.label.toUpperCase() : 'NO POOL'}</div>
          {deepest && <PriceChart pool={deepest} from={deepest.tokens[0]} to={deepest.tokens[1]} />}
          <div className='terra-tv-anchor'>
            <span className='terra-tv-tag' style={{ color: C.goldLit }}>ANCHOR · @STABLEKWON</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.textPrimary, lineHeight: 1.3 }}>“{KWON_LINES[(Math.floor(now.getTime() / 12000)) % KWON_LINES.length].q}”</div>
          </div>
        </div>
        <div className='terra-tv-side'>
          <div className='terra-tv-tag'>HEADLINES</div>
          {(board?.recent ?? []).slice(0, 7).map((e, k) => (
            <div key={e.id} className='terra-tv-head' style={{ animationDelay: `${k * 90}ms` }}>
              <span style={{ color: C.korea, fontWeight: 800, marginRight: 8 }}>{k === 0 ? 'NEW' : `${k + 1}`}</span>{headline(e)}
            </div>
          ))}
          {!(board?.recent?.length) && <div className='terra-tv-head'>NOTHING HAS HAPPENED YET. THIS IS THE STORY.</div>}
        </div>
      </div>
      <div className='terra-tv-crawl'><div className='terra-tv-track'>{track.map((t, i) => <span key={i}>{t}<span style={{ color: C.korea, margin: '0 26px' }}>◆</span></span>)}</div></div>
      <div className='terra-tv-hint'>press v or esc to leave the studio</div>
    </div>
  )
}

/** WMO weather code → one emoji. */
function wxEmoji(code: number): string {
  if (code === 0) return '☀️'; if (code <= 3) return '⛅'; if (code <= 48) return '🌫️'; if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'; if (code <= 82) return '🌦️'; return '⛈️'
}

/** A gold seal for an address: 5×5 mirrored glyph from its hash. Same address, same seal, everywhere. */
function Glyph({ addr, size = 16 }: { addr: string; size?: number }) {
  let h = 2166136261
  for (const ch of addr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  const cells: [number, number][] = []
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { if ((h >> (y * 3 + x)) & 1) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]) } }
  const hue = (h >>> 20) % 2 === 0 ? '#ffd83d' : '#ffb347'
  return (
    <svg width={size} height={size} viewBox='0 0 5 5' style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6, flexShrink: 0 }} aria-hidden>
      {cells.map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width='1' height='1' fill={hue} rx='0.15' />)}
    </svg>
  )
}

/** Top three, as men on a podium. Because of course. */
function Podium({ rows }: { rows: BoardResponse['rows'] }) {
  const top = rows.slice(0, 3)
  if (top.length === 0) return null
  const order = [top[1], top[0], top[2]]   // silver · gold · bronze
  const meta = [{ h: 82, c: '#cfcfcf', pose: 'point' }, { h: 104, c: '#ffd83d', pose: 'salute' }, { h: 70, c: '#cd7f32', pose: 'stand' }]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, padding: '18px 0 0' }}>
      {order.map((r, k) => r ? (
        <div key={r.address} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '31%', maxWidth: 190 }}>
          <div className={`kwon-man kwon-pose-${meta[k].pose}`} style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none', width: 44, height: 68 }}>
            <svg viewBox='0 0 60 92' width='44' height='68' fill='none' stroke={meta[k].c} strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
              <path className='kwon-leg-l' d='M30 60 L22 90' /><path className='kwon-leg-r' d='M30 60 L38 90' /><path d='M30 60 L30 38' /><path d='M22 44 Q30 36 38 44' />
              <path className='kwon-arm-b' d='M30 42 L20 56' /><path className='kwon-arm-f' d='M30 42 L41 54' />
              <circle cx='31' cy='24' r='10' /><circle cx='27' cy='24' r='3.6' /><circle cx='35.5' cy='24' r='3.6' /><path d='M30.6 24 L31.9 24' />
            </svg>
            {k === 1 && <div className='kwon-badge' style={{ opacity: 1, right: -14, top: -6, fontSize: 14 }}>🫡</div>}
          </div>
          <div style={{ width: '100%', height: meta[k].h, background: `linear-gradient(180deg, ${meta[k].c}33, ${meta[k].c}0d)`, border: `1px solid ${meta[k].c}66`, borderBottom: 'none', borderRadius: '8px 8px 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <div style={{ fontFamily: TERRA_FONT, fontWeight: 700, fontSize: TEXT.lg.size, color: meta[k].c, lineHeight: 1 }}>{['🥈', '🥇', '🥉'][k]}</div>
            <div style={{ fontSize: '0.62rem', color: C.textPrimary, maxWidth: '95%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Nick address={r.address} head={5} tail={4} /></div>
            <div style={{ fontSize: '0.6rem', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{r.points.toLocaleString('en-US')} · {rankTitle(r.points)}</div>
          </div>
        </div>
      ) : <div key={k} style={{ width: '31%', maxWidth: 190 }} />)}
    </div>
  )
}

/** The sky over the line follows Seoul's clock. */
function seoulSky(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()))
  if (h >= 5 && h < 8) return 'linear-gradient(180deg, rgba(255,140,90,0.10) 0%, rgba(255,216,61,0.05) 60%, transparent 100%)'          // dawn
  if (h >= 8 && h < 17) return 'linear-gradient(180deg, rgba(255,216,61,0.02) 0%, rgba(255,216,61,0.06) 100%)'                            // day
  if (h >= 17 && h < 20) return 'linear-gradient(180deg, rgba(224,72,90,0.12) 0%, rgba(255,179,71,0.08) 55%, transparent 100%)'          // dusk
  return 'radial-gradient(60% 80% at 80% 10%, rgba(255,216,61,0.08) 0%, transparent 60%), linear-gradient(180deg, transparent, rgba(255,216,61,0.02))' // night
}

/** StarCraft minimap: every pool is a dot, empty ones sit in fog, new moves ping. Press m. */
function Minimap({ pools, board, revealed, onJump }: { pools: PoolView[]; board: BoardResponse | null; revealed: boolean; onJump: (contract: string) => void }) {
  const W = 168, H = 126
  const pos = (addr: string) => { let h = 5381; for (const ch of addr) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return { x: 12 + (h % 1000) / 1000 * (W - 24), y: 12 + ((h >>> 10) % 1000) / 1000 * (H - 24) } }
  const acts = board?.poolActivity ?? {}
  const height = board?.recent?.[0]?.height ?? 0
  const [pings, setPings] = useState<{ id: string; c: string }[]>([])
  const seen = useRef<string | null>(null)
  useEffect(() => {
    const top = board?.recent?.[0]; if (!top) return
    if (seen.current === null) { seen.current = top.id; return }
    if (top.id === seen.current) return
    seen.current = top.id
    setPings(p => [...p, { id: top.id, c: top.contract }]); setTimeout(() => setPings(p => p.filter(x => x.id !== top.id)), 2400)
  }, [board])
  return (
    <div className='terra-minimap' title='minimap · m to hide'>
      <div className='terra-minimap-h'><span>MINIMAP</span><span style={{ color: C.textWhisper }}>{pools.length} pools</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
        <defs><pattern id='mm-grid' width='14' height='14' patternUnits='userSpaceOnUse'><path d='M14 0 H0 V14' fill='none' stroke='rgba(255,216,61,0.08)' strokeWidth='0.6' /></pattern></defs>
        <rect width={W} height={H} fill='#05070f' /><rect width={W} height={H} fill='url(#mm-grid)' />
        {pools.map(p => {
          const { x, y } = pos(p.contract_addr); const a = acts[p.contract_addr]
          const hot = a && height - a.last < 600 && a.count >= 3
          const r = p.empty ? 2.2 : 3 + Math.min(6, Math.log10((p.tvlUsd ?? 0) + 1) * 2.2)
          const fill = p.empty ? '#6b6555' : hot ? '#e0485a' : '#ffd83d'
          return (
            <g key={p.contract_addr} onClick={() => onJump(p.contract_addr)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={r} fill={fill} opacity={p.empty && !revealed ? 0.25 : 0.95} />
              {hot && <circle cx={x} cy={y} r={r + 3} fill='none' stroke='#e0485a' strokeWidth='0.8' opacity='0.6' />}
              <title>{p.label}{p.tvlUsd ? ` · $${Math.round(p.tvlUsd)}` : ' · empty'}</title>
            </g>
          )
        })}
        {pings.map(pg => { const { x, y } = pos(pg.c); return <circle key={pg.id} className='terra-mm-ping' cx={x} cy={y} r='3' fill='none' stroke='#e0485a' strokeWidth='1.5' /> })}
        {!revealed && pools.some(p => p.empty) && <text x={W - 6} y={H - 5} fontSize='6' fill='#6b6555' textAnchor='end' fontFamily='monospace'>fog: {pools.filter(p => p.empty).length}</text>}
      </svg>
    </div>
  )
}

type ExploreKey = 'swap' | 'bridge' | 'pools' | 'portfolio' | 'history' | 'lst' | 'gap' | 'search'

/**
 * Everything the site does, one card each, straight under the product. Most
 * people come to swap; this is how they find the rest without reading the
 * footer. Each card says what you get in a line and opens the part it names.
 * Facts only: no rates, no promises.
 */
function Explore({ pools, gaps, onGo }: { pools: number; gaps: number; onGo: (k: ExploreKey) => void }) {
  const cards: { k: ExploreKey | 'verify' | 'stats'; icon: string; title: string; body: string; cta: string; muted?: boolean }[] = [
    { k: 'bridge', icon: '🌉', title: 'Bring money in', body: 'USDC from Noble, ATOM from the Cosmos Hub, USDC.inj from Injective, ASTRO and dATOM from Neutron, stLUNA from Stride, already swapped into another token when it lands.', cta: 'Bridge' },
    { k: 'pools', icon: '💧', title: 'Provide liquidity', body: `${pools} pools with liquidity on Terra Swap and Astroport. Add both sides or zap in with one token, and see what each pool paid its providers.`, cta: 'Pools' },
    { k: 'portfolio', icon: '🧾', title: 'Everything you hold', body: 'Every position on both sites, closed in one signature, and against simply holding. Sell leftover balances in one go; your history shows each quote beside what arrived.', cta: 'Portfolio' },
    { k: 'lst', icon: '🥩', title: 'Liquid staking against the hubs', body: 'When redeeming ampLUNA or bLUNA at its hub pays more than selling in a pool, and by how much.', cta: 'See the rates' },
    { k: 'gap', icon: '⚡', title: gaps ? `${gaps} pool${gaps === 1 ? '' : 's'} off the market` : 'Pools off the market', body: 'A pool that drifted from the market, with the round trip that closes the gap in one transaction.', cta: gaps ? 'Close one' : 'None right now', muted: !gaps },
    { k: 'verify', icon: '✓', title: 'No owner, no admin, no cut', body: "Nobody can change Terra Swap's pools or take a cut. Check every contract from your own browser.", cta: 'Verify' },
    { k: 'stats', icon: '📊', title: 'The numbers', body: 'Liquidity, what the pools paid their providers, what routing adds, and uptime, read from the chain.', cta: 'Stats' },
    { k: 'search', icon: '⌕', title: 'Find anything', body: 'Any token to buy or sell, any pool, any part of the site, one search away. ⌘K from anywhere.', cta: 'Search' },
  ]
  const card: React.CSSProperties = {
    display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 6, textAlign: 'left', padding: '12px 14px', borderRadius: 14,
    background: 'rgba(17,23,41,0.72)', border: `1px solid ${C.divider}`, color: C.textSecondary, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'none',
  }
  const inner = (c: (typeof cards)[number]) => (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ fontSize: '1.05rem', width: 22, textAlign: 'center', color: C.goldLit }}>{c.icon}</span>
        <b style={{ color: C.textPrimary, fontSize: TEXT.sm.size }}>{c.title}</b>
      </span>
      <span className='terra-explore-body' style={{ fontSize: TEXT.xs.size, lineHeight: 1.55, color: C.textMuted }}>{c.body}</span>
      <span style={{ fontSize: TEXT.xs.size, fontWeight: 700, color: c.muted ? C.textWhisper : C.goldLit }}>{c.cta}{c.muted ? '' : ' →'}</span>
    </>
  )
  return (
    <section aria-labelledby='explore-title' style={{ marginTop: SPACE['4'] }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: SPACE['2'], rowGap: 2, marginBottom: SPACE['2'] }}>
        <h2 id='explore-title' style={{ fontFamily: TERRA_FONT, fontSize: TEXT.md.size, margin: 0, color: C.textPrimary }}>Beyond the swap</h2>
        <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>every route runs through Terra Swap&apos;s and Astroport&apos;s pools, with no interface fee</span>
      </div>
      <div className='terra-explore' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: SPACE['2'] }}>
        {cards.map(c => (c.k === 'verify' || c.k === 'stats')
          ? <Link key={c.k} href={`/${c.k}`} className='terra-explore-card' style={card}>{inner(c)}</Link>
          : <button key={c.k} type='button' className='terra-explore-card' onClick={() => onGo(c.k as ExploreKey)} disabled={c.muted} style={{ ...card, cursor: c.muted ? 'default' : 'pointer' }}>{inner(c)}</button>)}
      </div>
    </section>
  )
}

/** Positions, Wallet and History are one place, Portfolio: what you hold in pools and in the wallet, and what you did. */
function PortfolioSwitch({ view, onView }: { view: 'positions' | 'wallet' | 'history'; onView: (v: 'positions' | 'wallet' | 'history') => void }) {
  return (
    <div role='tablist' aria-label='Portfolio' style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['2'] }}>
      {([['positions', 'Positions'], ['wallet', 'Wallet'], ['history', 'History']] as const).map(([k, text]) => (
        <button key={k} type='button' role='tab' aria-selected={view === k} onClick={() => onView(k)}
          style={{ ...ghostBtn, padding: '3px 12px', borderRadius: 999, color: view === k ? C.goldLit : C.textMuted, borderColor: view === k ? C.goldCore : C.divider }}>
          {text}
        </button>
      ))}
    </div>
  )
}

function StatBand({ data, board }: { data: DexResponse; board: BoardResponse | null }) {
  // APM, because he would want to know: moves in the last hour of blocks (≈580 at 6.2 s), per minute.
  const apm = (() => { const h = data.height || 0; const n = (board?.recent ?? []).filter(e => h - e.height <= 580).length; return (n / 60).toFixed(n ? 2 : 1) })()
  const tvl = data.tvlUsd ?? 0
  const tvlStr = tvl >= 1000 ? `$${Math.round(tvl / 1000)}k` : tvl > 0 ? `$${Math.round(tvl)}` : '0'
  const stats: { n: string; label: string; taunt: string }[] = [
    { n: tvlStr, label: 'liquidity', taunt: 'dry' },
    { n: String(data.pools.length), label: 'pools', taunt: 'none yet' },
    { n: String(board?.rows.length ?? 0), label: 'on the board', taunt: 'wide open' },
    { n: String(board?.totalEvents ?? 0), label: `moves · apm ${apm}`, taunt: 'silence' },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SPACE['2'],
      margin: `${SPACE['4']}px 0`, padding: `${SPACE['3']}px 0`,
      borderTop: `1px solid ${C.divider}`, borderBottom: `1px solid ${C.divider}`,
    }}>
      {stats.map(s => {
        const zero = s.n === '0'
        return (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: TERRA_FONT, fontWeight: 700, fontSize: 'clamp(1.4rem, 5vw, 2rem)', lineHeight: 1,
              color: zero ? C.textMuted : C.goldLit, fontVariantNumeric: 'tabular-nums',
              textShadow: zero ? 'none' : '0 0 18px rgba(255,216,61,0.25)',
            }}>{s.n}</div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textMuted, marginTop: 5 }}>
              {zero ? s.taunt : s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Hero({ poolFeeBps, onReplay, onHome, onToast, me, right }: { poolFeeBps: number; onReplay: () => void; onHome: () => void; onToast: (m: string) => void; me?: string; right?: React.ReactNode }) {
  const clicks = useRef(0)
  const { t } = useLang()
  // The wordmark is the way home. A modified click opens the home page in a new tab like any link; three clicks still replay the intro.
  const wordmarkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    onHome()
    clicks.current += 1
    if (clicks.current >= 3) { clicks.current = 0; if (!LITE) onReplay() }
    setTimeout(() => { clicks.current = 0 }, 900)
  }
  return (
    <div className='terra-hero' style={{ marginTop: SPACE['3'], display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE['3'], flexWrap: 'wrap' }}>
     <div style={{ minWidth: 0 }}>
      {/* The family on its own line: inside the kicker it inherited uppercase and wide
          tracking, which is exactly what made two navigations read as one muddle. */}
      {!LITE && <AppSwitcher />}
      <div style={{ fontSize: '0.62rem', letterSpacing: '0.34em', color: C.korea, fontWeight: 800, textTransform: 'uppercase', margin: `${SPACE['2']} 0`, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span>{(() => {
          const h = new Date().getHours()
          const gm = isChuseok() ? '추석 · happy harvest moon' : moonPhase().full ? '🌕 full moon' : h >= 5 && h < 11 ? 'gm' : h >= 22 || h < 5 ? 'gn' : ''
          const who = me ? `${me.slice(0, 9)}…${me.slice(-4)}` : ''
          void who
          const greet = gm ? `${gm} · ` : ''
          return LITE ? 'Unofficial · Astroport pools' : `${greet}${t('Experimental')}`
        })()}</span>
      </div>
      <h1 style={{
        fontFamily: TERRA_FONT, fontSize: 'clamp(2rem, 6.5vw, 3rem)', lineHeight: 1.02,
        margin: '0 0 0.6rem', letterSpacing: '-0.02em', fontWeight: 700,
        display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap',
      }}>
        <Link href='/' className='atrium-swap-title' aria-label={`${APP_NAME} home`} style={{ fontFamily: TERRA_FONT, cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.28em', whiteSpace: 'nowrap', textDecoration: 'none' }} onClick={wordmarkClick} title='Home'>
          {/* Like the original lockup: "Terra" heavy, the product word light. */}
          <span><span style={{ fontWeight: 700 }}>Terra</span> <span style={{ fontWeight: 300, letterSpacing: '0' }}>{LITE ? 'Pools' : 'Swap'}</span></span>
        </Link>
      </h1>
      <div style={{ margin: '2px 0 0.6rem', fontSize: '0.72rem', letterSpacing: '0.12em', color: '#9a927f' }}>openfields.app</div>
      {/* Above the fold on purpose: nobody should have to reach the footer to learn who does not stand behind this. */}
      <p className='tl-independent' style={{ margin: '0 0 0.6rem', maxWidth: '46rem', fontSize: '0.72rem', lineHeight: 1.55, color: '#9a927f' }}>
        An independent project, not an official Terra product. Not affiliated with, endorsed by or connected to
        Terraform Labs, Phoenix Foundation or the Phoenix Directive.
      </p>
     </div>
      {right && (
        <div className='terra-hero-right' style={{ display: 'flex', alignItems: 'center', gap: SPACE['2'], flex: 'none', marginBottom: '0.6rem' }}>
          {right}
        </div>
      )}
    </div>
  )
}

// ─── Retro-Terra intro ──────────────────────────────────────────

function IntroSplash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  // The parent passes a fresh onDone on every render and re-renders all the time while data arrives;
  // keyed on it, the timers restarted with each render and the splash could stay up for many seconds.
  const done = useRef(onDone)
  done.current = onDone
  const dismiss = () => { setLeaving(true); setTimeout(() => done.current(), 620) }
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 1500)
    const t2 = setTimeout(() => done.current(), 2100)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])
  return (
    <div
      onClick={dismiss}
      className={`terra-intro${leaving ? ' terra-intro-leave' : ''}`}
      style={{ position: 'fixed', inset: 0, zIndex: 60, cursor: 'pointer' }}
      aria-hidden
    >
      <div className='terra-intro-grid' />
      <div className='terra-intro-sun' />
      <div className='terra-intro-inner'>
        <div className='terra-intro-kicker'>A DECENTRALIZED EXCHANGE ON TERRA</div>
        <div className='terra-intro-word' style={{ fontFamily: TERRA_FONT }}>
          <img src='/img/terra-globe.svg' alt='' aria-hidden width={52} height={49} draggable={false} className='terra-intro-globe' />
          Terra <span className='terra-intro-thin'>Swap</span>
        </div>
        <div className='terra-intro-sub'>swap · pools · liquidity</div>
      </div>
      <div className='terra-intro-skip'>click to enter</div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────

function SwapPageInner() {
  const me = useMyAddress()
  const { lang, t } = useLang()
  const [data, setData] = useState<DexResponse | null>(null)
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [tab, setTab] = useState<Tab>('swap')
  const [crystal, setCrystal] = useState(false)
  const [syncedAt, setSyncedAt] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [nowTick, setNowTick] = useState(0)
  const [intro, setIntro] = useState(false)
  const [party, setParty] = useState<Party | null>(null)
  const [toast, setToast] = useState<{ msg: string; href?: string } | null>(null)
  const clearParty = useCallback(() => setParty(null), [])
  const [soundOn, setSoundOn] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [game, setGame] = useState(false)
  const [tv, setTv] = useState(false)
  const [mapOn, setMapOn] = useState(false)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => { try { setMapOn(localStorage.getItem('terraswap_map') !== '0' && window.innerWidth >= 900) } catch { setMapOn(window.innerWidth >= 900) } }, [])
  const toggleMap = () => setMapOn(v => { const n = !v; try { localStorage.setItem('terraswap_map', n ? '1' : '0') } catch { /* private */ } return n })
  useEffect(() => {
    const on = () => setGame(true)
    window.addEventListener('terra:play', on)
    return () => window.removeEventListener('terra:play', on)
  }, [])
  // Kwon talks. Literally. Browser TTS, robot pitch, only with sound on.
  useEffect(() => {
    const on = (e: Event) => {
      if (!soundOn) return
      try {
        const ss = window.speechSynthesis; if (!ss) return
        ss.cancel()
        const u = new SpeechSynthesisUtterance(String((e as CustomEvent<string>).detail).replace(/[*🫡]/g, ''))
        u.rate = 0.95; u.pitch = 0.55; u.volume = 0.8
        const v = ss.getVoices().find(x => /en[-_]US/i.test(x.lang)) ?? ss.getVoices().find(x => /^en/i.test(x.lang))
        if (v) u.voice = v
        ss.speak(u)
      } catch { /* no tts */ }
    }
    window.addEventListener('terra:speak', on)
    return () => window.removeEventListener('terra:speak', on)
  }, [soundOn])
  const [spotlight, setSpotlight] = useState('')
  const [ledgerOpen, setLedgerOpen] = useState(false)
  useEffect(() => { try { setSoundOn(localStorage.getItem(SOUND_KEY) === '1') } catch { /* private */ } }, [])
  const toggleSound = () => {
    setSoundOn(v => { const n = !v; try { localStorage.setItem(SOUND_KEY, n ? '1' : '0') } catch { /* private */ } if (n) playSound('tick'); return n })
  }
  // Panels fire sound events; only the page knows whether sound is on.
  useEffect(() => {
    const on = (e: Event) => { if (soundOn) playSound((e as CustomEvent<SoundKind>).detail) }
    window.addEventListener('terra:sound', on)
    return () => window.removeEventListener('terra:sound', on)
  }, [soundOn])
  useEffect(() => { if (party) sound('party') }, [party])

  // `?` opens the shortcut sheet, esc closes it. None of the keys exist in Astroport mode.
  useEffect(() => {
    if (LITE) return
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.key === '?') setShortcuts(v => !v)
      if (e.key === 'p' || e.key === 'P') deferKey(() => setGame(v => !v))
      if (e.key === 'v' || e.key === 'V') deferKey(() => setTv(v => { if (!v) sound('party'); return !v }))
      if (e.key === 'm' || e.key === 'M') deferKey(toggleMap)
      if (e.key === 't' || e.key === 'T') deferKey(() => { kwonSay({ q: '*squints. it is bright in here. it is 2020.*', when: 'stage direction', pose: 'shrug', fact: true }); document.documentElement.classList.add('terra-2020'); setToast({ msg: '2020 mode. Station blue. We were all younger.' }); setTimeout(() => document.documentElement.classList.remove('terra-2020'), 12000) })
      if (e.key === 'k' || e.key === 'K') deferKey(() => { kwonSay(KWON_LINES[Math.floor(Math.random() * KWON_LINES.length)]); document.getElementById('kwon-line')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
      if (e.key === 'Escape') { setShortcuts(false); setTv(false) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  // A shared link lands where it points: ?tab=bridge opens that section, ?who=terra1… opens the board on their row.
  const tabFromUrl = useRef(false)
  /** A pool a link asked for (?pool=terra1…, from a pool's own page), opened once the pools are in. */
  const wantPool = useRef('')
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const linked = PARAM_TAB[params.get('tab') ?? '']
      if (linked && !(LITE && linked === 'board')) setTab(linked)
      const net = params.get('net')
      if (isNetKey(net)) setBridgeNet(net)
      const pool = params.get('pool') || ''
      if (/^terra1[0-9a-z]{38,}$/.test(pool)) wantPool.current = pool
      const who = params.get('who') || ''
      if (!LITE && /^terra1[0-9a-z]{38,}$/.test(who)) { setSpotlight(who); setTab('board') }
    } catch { /* ssr */ }
    tabFromUrl.current = true
  }, [])
  // …and the address follows the section, once the one it asked for has been opened.
  useEffect(() => {
    if (!tabFromUrl.current) return
    try {
      const u = new URL(window.location.href)
      const want = TAB_PARAM[tab]
      if ((u.searchParams.get('tab') ?? '') === want) return
      if (want) u.searchParams.set('tab', want); else u.searchParams.delete('tab')
      window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
    } catch { /* sandboxed */ }
  }, [tab])
  useEffect(() => {
    if (!spotlight || tab !== 'board' || !board) return
    const el = document.getElementById(`row-${spotlight}`)
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setToast({ msg: 'Here is where they are written down.' }) }
  }, [spotlight, tab, board])

  // Climbed the board since last visit? Say so.
  useEffect(() => {
    if (!me || !board?.live) return
    const mine = board.rows.find(r => r.address === me)
    if (!mine) return
    try {
      const prev = Number(localStorage.getItem('terraswap_rank') || '0')
      if (prev > 0 && mine.rank < prev && mine.rank <= 3) setParty({ emoji: ['🥇', '🥈', '🥉'][mine.rank - 1], title: `TOP ${mine.rank}`, sub: `You climbed to #${mine.rank}. ${rankTitle(mine.points)}. Everyone below is coming for it.` })
      else if (prev > 0 && mine.rank < prev) setToast({ msg: `You climbed to #${mine.rank}. ${rankTitle(mine.points)}.` })
      localStorage.setItem('terraswap_rank', String(mine.rank))
    } catch { /* private */ }
  }, [me, board])
  const clearToast = useCallback(() => setToast(null), [])
  useKonami(useCallback(() => setParty({ emoji: '🐎', title: 'STEADY LADS', sub: 'You know the code. Deploying capital. Small capital. 🫡' }), []))

  // Type a word anywhere on the page (not in a field). Some of them answer.
  useEffect(() => {
    if (LITE) return
    let buf = ''
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.key.length !== 1) return
      if (buf.length > 0) cancelKey()   // a second letter means a word, not a shortcut
      buf = (buf + e.key.toLowerCase()).slice(-24)
      const m = moonPhase()
      const say = (msg: string) => { setToast({ msg }); buf = '' }
      if (buf.endsWith('show me the money')) say('not on this chain. try the arcade. press p.')
      else if (buf.endsWith('power overwhelming')) { setParty({ emoji: '⚡', title: 'POWER OVERWHELMING', sub: 'Invincible. For 3.2 seconds. Then back to the pool.' }); buf = '' }
      else if (buf.endsWith('black sheep wall')) { setRevealed(true); setMapOn(true); say('fog of war lifted. every pool, even the empty ones.') }
      else if (buf.endsWith('operation cwal')) { document.documentElement.classList.add('terra-cwal'); say('operation cwal. everything is faster for twelve seconds.'); setTimeout(() => document.documentElement.classList.remove('terra-cwal'), 12000) }
      else if (buf.endsWith('something for nothing')) say('nothing for nothing. 30 bps to LPs, always.')
      else if (buf.endsWith('there is no cow level')) say('there is no cow level. there is a burrito, though.')
      else if (buf.endsWith('steady')) say('lads.')
      else if (buf.endsWith('kimchi')) { setParty({ emoji: '🌶️', title: 'SPICY', tone: 'red', sub: 'You typed kimchi. The page is now 30% hotter. This wears off.' }); buf = '' }
      else if (buf.endsWith('soju')) say('🍶 one for the lads. one for the ones who stayed.')
      else if (buf.endsWith('kwon')) { say('🫡 he is on the line. scroll.'); document.getElementById('kwon-line')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
      else if (buf.endsWith('seoul') || buf.endsWith('korea')) say('🇰🇷 where it started. still here. 화이팅.')
      else if (buf.endsWith('poor')) say('we debate the poor. we are the poor.')
      else if (buf.endsWith('dai')) say('by our hand, nothing dies. we just swap.')
      else if (buf.endsWith('daebak') || buf.endsWith('대박')) say('대박.')
      else if (buf.endsWith('pylon')) { setParty({ emoji: '🔷', title: 'ADDITIONAL PYLONS', tone: 'moon', sub: 'You must construct additional pylons. Pylon Protocol was his idea. He is a StarCraft man.' }); buf = '' }
      else if (buf.endsWith('aiur')) say('my life for aiur. my liquidity for luna.')
      else if (buf.endsWith('gg')) say('gg. wp. steady.')
      else if (buf.endsWith('apm')) say(`apm on this dex right now: ${(document.body.innerText.match(/apm ([\d.]+)/) || [])[1] ?? '0.0'}. he would be disappointed.`)
      else if (buf.endsWith('zerg')) say('spawn more overlords.')
      else if (buf.endsWith('moon')) { setParty({ emoji: '🌕', title: 'WEN MOON', tone: 'moon', sub: m.full ? 'Now. It is full. Look up.' : `${m.daysToFull} days to full. Literally. Luna means moon.` }); buf = '' }
      else if (buf.endsWith('luna')) say('🌕 still here.')
      else if (buf.endsWith('wen')) say('now.')
      else if (buf.endsWith('gm')) say('gm. steady.')
      else if (buf.endsWith('gn')) say('gn. the chain does not sleep, but you should.')
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  // The wire, live: when a move by someone else shows up between polls, say so.
  const seenMoves = useRef<Set<string> | null>(null)
  useEffect(() => {
    const recent = board?.recent ?? []
    if (!recent.length) return
    if (!seenMoves.current) { seenMoves.current = new Set(recent.map(e => e.id)); return }
    const fresh = recent.filter(e => !seenMoves.current!.has(e.id))
    for (const e of recent) seenMoves.current.add(e.id)
    const other = fresh.find(e => e.address !== me)
    if (fresh.length >= 3) { setToast({ msg: `Zerg rush. ${fresh.length} moves in one block window. 대박.` }); sound('party') }
    else if (other) {
      const where = data?.pools.find(p => p.contract_addr === other.contract)?.label ?? (other.action === 'create_pair' ? 'a new pool' : 'a pool')
      if (other.action === 'withdraw_liquidity') speak('Nuclear launch detected.')
      setToast({ msg: other.action === 'withdraw_liquidity' ? `☢ Nuclear launch detected. ${other.address.slice(0, 9)}…${other.address.slice(-4)} pulled from ${where}.` : `${ACTION_EMOJI[other.action] ?? '•'} ${other.address.slice(0, 9)}…${other.address.slice(-4)} just ${ACTION_VERB[other.action] ?? other.action} ${where}.`, href: finderTx(other.txhash) })
      sound('tick')
    }
  }, [board, me, data])

  // The retro-Terra splash no longer plays on arrival: a first visit opens on the swap itself, the way the
  // community asked ("swap should be visible upon load"). It is still there as a replay from the wordmark.

  // Market reference arrives on the side; the page never waits for it.
  const marketRef = useRef<Record<string, number> | null>(null)
  const [marketPx, setMarketPx] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/dex-market').then(r => r.ok ? r.json() : null).then((j: { px?: Record<string, number> } | null) => {
      if (!alive || !j?.px || Object.keys(j.px).length < 2) return
      marketRef.current = j.px
      setMarketPx(j.px)
      setData(d => d ? { ...d, pools: annotateValues(annotateMarket(d.pools.map(p => ({ ...p })), j.px!), j.px!) } : d)
    }).catch(() => {})
    pull(); const iv = setInterval(pull, 300_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  /* Pools that have drifted off the reference, sized and priced. Bots skip
     these — the gaps are worth a few dollars, which is under the cost of
     running a bot and squarely in reach of a person who is already looking. */
  // Not in Astroport mode: the sizing maths is constant-product, and most of their depth is concentrated.
  const arbs = useMemo(() => (data?.live && !LITE ? arbPlans(data.pools, marketPx) : []), [data, marketPx])

  /** The other site's pools: routed through, and listed in Pools. Arrives on the side; swaps work without it. */
  const [venuePools, setVenuePools] = useState<PoolView[]>([])
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/dex-venue').then(r => (r.ok ? r.json() : null)).then((j: VenueResponse | null) => {
      if (alive && j?.pools) setVenuePools(j.pools)
    }).catch(() => {})
    pull(); const iv = setInterval(pull, 60_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])
  /**
   * Skeleton Swap's pools (lib/skeleton): listed in Pools, and routed through by the swap when their swaps are on.
   * Not used by zaps or swaps on arrival, which need a router that cannot reach them. Arrives on the side too.
   */
  const [skeletonPools, setSkeletonPools] = useState<PoolView[]>([])
  useEffect(() => {
    if (LITE) return
    let alive = true
    const pull = () => fetch('/api/dex-skeleton').then(r => (r.ok ? r.json() : null)).then((j: SkeletonResponse | null) => {
      if (alive && j?.pools) setSkeletonPools(j.pools)
    }).catch(() => {})
    pull(); const iv = setInterval(pull, 60_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])
  const swapVenuePools = useMemo(() => [...venuePools, ...skeletonPools.filter(p => p.swapsEnabled === true)], [venuePools, skeletonPools])
  /** Every venue's pools in one list: both sites', since pools.openfields.app was folded into this page (2026-09-14), and Skeleton Swap's (2026-09-15). */
  const allPools = useMemo(() => {
    const own = data?.pools ?? []
    const seen = new Set(own.map(p => p.contract_addr))
    const away = venuePools.filter(p => !seen.has(p.contract_addr))
    away.forEach(p => seen.add(p.contract_addr))
    return [...own, ...away, ...skeletonPools.filter(p => !seen.has(p.contract_addr))]
  }, [data, venuePools, skeletonPools])
  const [venueFilter, setVenueFilter] = useState<'all' | Venue>('all')
  /** Find a pool by any of its tokens: "luna", "sol usdc". Every word has to match. */
  const [poolQuery, setPoolQuery] = useState('')
  /* How the list is ordered. "Suggested" is the house order (SOLID first, then
     depth); the rest are what people ask for: deepest, most traded, name. */
  const [poolSort, setPoolSort] = useState<PoolSort>(LITE ? 'tvl' : 'suggested')

  /* Depth and most-traded are the two people came for; the order below decides
     the rest. Empty pools sink to the bottom without being asked to.
     "Most traded" ranks by recorded moves on the pool (board activity), 0 when
     the board has not loaded or a pool has none. */
  const sortedPools = useMemo(() => {
    const activity = (p: PoolView) => board?.poolActivity?.[p.contract_addr]?.count ?? 0
    const solidFirst = (p: PoolView) => (!LITE && p.tokens.some(t => t.key === 'SOLID') ? 0 : 1)
    const tvl = (p: PoolView) => p.tvlUsd ?? 0
    const cmp: Record<PoolSort, (a: PoolView, b: PoolView) => number> = {
      suggested: (a, b) => solidFirst(a) - solidFirst(b) || tvl(b) - tvl(a),
      tvl: (a, b) => tvl(b) - tvl(a),
      traded: (a, b) => activity(b) - activity(a) || tvl(b) - tvl(a),
      name: (a, b) => a.label.localeCompare(b.label),
    }
    const words = poolQuery.toLowerCase().split(/[\s/]+/).filter(Boolean)
    const matches = (p: PoolView) => {
      const hay = `${p.label} ${p.tokens.map(t => `${t.key} ${TOKEN_META[t.key]?.name ?? ''}`).join(' ')}`.toLowerCase()
      return words.every(w => hay.includes(w))
    }
    return allPools
      .filter(p => (venueFilter === 'all' || p.venue === venueFilter) && matches(p))
      .sort(cmp[poolSort])
  }, [allPools, venueFilter, poolQuery, poolSort, board])

  /* Anyone can open a pool, so most of them are empty shells someone made to
     see what happened. Showing fifteen of those buries the five that matter.
     A search looks through all of them. */
  const DUST_USD = 10
  const [showDust, setShowDust] = useState(false)
  const visiblePools = useMemo(
    () => (showDust || poolQuery.trim() ? sortedPools : sortedPools.filter(p => (p.tvlUsd ?? 0) >= DUST_USD)),
    [sortedPools, showDust, poolQuery],
  )
  const dustCount = sortedPools.length - sortedPools.filter(p => (p.tvlUsd ?? 0) >= DUST_USD).length

  /** Who holds each pool's LP. Arrives on the side; the page never waits for it. */
  const [holders, setHolders] = useState<Record<string, PoolHolders>>({})
  useEffect(() => {
    if (LITE) return
    let alive = true
    const pull = () => fetch('/api/dex-holders').then(r => (r.ok ? r.json() : null)).then((j: HoldersResponse | null) => {
      if (alive && j?.pools) setHolders(j.pools)
    }).catch(() => {})
    pull(); const iv = setInterval(pull, 120_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])
  const routePoolsAll = useMemo(() => [...(data?.pools ?? []).filter(p => !p.empty), ...venuePools], [data, venuePools])
  // Every token picker ranks by these.
  useEffect(() => { publishTokenData({ px: marketPx, liquidity: liquidityByToken(routePoolsAll) }) }, [marketPx, routePoolsAll])

  // Price alerts (lib/alerts): read the market reference once a minute while any alert is waiting, and say so when one goes off.
  const { alerts: priceAlerts } = usePrefs()
  const alertsArmed = priceAlerts.some(a => !a.firedAt)
  const [alertPx, setAlertPx] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!alertsArmed) return
    let alive = true
    const read = () => fetch('/api/dex-market').then(r => (r.ok ? r.json() : null)).then((j: { px?: Record<string, number> } | null) => { if (alive && j?.px) setAlertPx(j.px) }).catch(() => {})
    const t = setInterval(read, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [alertsArmed])
  useAlertWatcher(alertPx ?? marketPx, fired => setToast({ msg: fired.map(f => `${f.label} is ${f.dir} $${fmtUsdPrice(f.usd)}: $${fmtUsdPrice(f.firedUsd ?? 0)} now.`).join(' ') }))
  /** "Take it" opens the round trip in one transaction. The one-sided trade stays as the fallback. */
  const [loopFor, setLoopFor] = useState<ArbPlan | null>(null)
  const [preset, setPreset] = useState<SwapPreset | null>(null)
  const oneSided = useCallback((plan: ArbPlan) => {
    setLoopFor(null)
    setPreset({
      fromId: assetId(plan.inToken.info),
      toId: assetId(plan.outToken.info),
      amount: fromMicro(plan.inMicro, plan.inToken.decimals, 6).replace(/,/g, ''),
      n: Date.now(),
    })
    setTab('swap')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  const takeArb = useCallback((plan: ArbPlan) => {
    setLoopFor(plan)
    setTab('swap')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  /** The wordmark goes home: the Swap tab at the top, without a shared link's or a spotlight's state in the address. */
  const goHome = useCallback(() => {
    setTab('swap'); setLoopFor(null); setSpotlight('')
    try { if (window.location.search) window.history.replaceState(null, '', '/') } catch { /* sandboxed */ }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // ── Finding things: the search palette, and the ways into each part of the site ──
  const [palette, setPalette] = useState(false)
  const [bridgeNet, setBridgeNet] = useState<NetKey>('noble')
  // Installing as an app: browsers that offer it hand over the prompt, which search then offers (see paletteItems).
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstallPrompt(e as unknown as { prompt: () => Promise<void> }) }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const openTab = useCallback((t: Tab) => { setTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }) }, [])
  const openBridge = useCallback((net: NetKey) => { setBridgeNet(net); openTab('transfer') }, [openTab])
  /** Open the Pools tab on something in it, clearing whatever would hide it. */
  const openInPools = useCallback((elementId: string, dust = false) => {
    setVenueFilter('all'); setPoolQuery(''); if (dust) setShowDust(true)
    setTab('pools')
    setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: elementId === 'lst' ? 'start' : 'center' }), 150)
  }, [])
  useEffect(() => {
    const addr = wantPool.current
    const p = addr ? allPools.find(x => x.contract_addr === addr) : undefined
    if (!p) return
    wantPool.current = ''
    openInPools(`pool-${addr}`, (p.tvlUsd ?? 0) < DUST_USD)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPools, openInPools])
  /** A swap with the pair filled in and the amount left to the person. */
  const openSwap = useCallback((fromId: string, toId: string) => {
    setLoopFor(null)
    setPreset({ fromId, toId, amount: '', n: Date.now() })
    openTab('swap')
  }, [openTab])
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const icon = (e: string) => <span>{e}</span>
    const items: PaletteItem[] = [
      { id: 'do-bridge-noble', group: 'Do', label: 'Bring USDC in from Noble', hint: 'arrives as USDC, or already swapped into another token', keywords: 'bridge deposit transfer ibc noble usdc move in', icon: icon('🌉'), run: () => openBridge('noble') },
      { id: 'do-bridge-hub', group: 'Do', label: 'Bring ATOM in from the Cosmos Hub', hint: 'arrives as ATOM, or already swapped into another token', keywords: 'bridge deposit transfer ibc cosmos hub atom move in', icon: icon('⚛️'), run: () => openBridge('cosmoshub') },
      { id: 'do-bridge-inj', group: 'Do', label: 'Bring USDC.inj in from Injective', hint: 'arrives as USDC.inj, or already swapped into another token', keywords: 'bridge deposit transfer ibc injective usdc.inj move in', icon: icon('🌊'), run: () => openBridge('injective') },
      { id: 'do-bridge-neutron', group: 'Do', label: 'Bring ASTRO, dATOM or FUEL in from Neutron', hint: 'arrives as itself, or already swapped into another token', keywords: 'bridge deposit transfer ibc neutron astro datom drop fuel move in', icon: icon('⚡'), run: () => openBridge('neutron-astro') },
      { id: 'do-bridge-stride', group: 'Do', label: 'Bring stLUNA or stATOM in from Stride', hint: 'arrives as itself, or already swapped into another token', keywords: 'bridge deposit transfer ibc stride stluna statom staked move in', icon: icon('🏃'), run: () => openBridge('stride-stluna') },
      { id: 'do-lst', group: 'Do', label: 'Liquid staking against the hubs', hint: 'when redeeming ampLUNA or bLUNA at its hub beats selling in the pool', keywords: 'lst stake unstake redeem mint ampluna bluna eris backbone hub', icon: icon('🥩'), run: () => openInPools('lst') },
      ...(arbs[0] ? [{ id: 'do-gap', group: 'Do', label: 'Close the biggest gap', hint: `${arbs[0].pool.label} is ${arbs[0].off.toFixed(1)}× off the market`, keywords: 'arbitrage arb drift gap off market', icon: icon('⚡'), run: () => takeArb(arbs[0]) }] : []),
      { id: 'do-open-pool', group: 'Do', label: 'Open a pool', hint: "on Terra Swap's or Astroport's factory, one signature", keywords: 'create new pair pool list token factory', icon: icon('🏗️'), run: () => openTab('create') },
      { id: 'do-sweep', group: 'Do', label: 'Sell small balances in one go', hint: 'leftover tokens into USDC or LUNA, one signature', keywords: 'sweep dust leftovers clean wallet balances sell all convert', icon: icon('🧹'), run: () => openTab('wallet') },
      { id: 'do-keys', group: 'Do', label: 'Keyboard shortcuts', hint: '⌘K search · / amount · f flip the pair', keywords: 'keys hotkeys keyboard', icon: icon('⌨️'), run: () => setShortcuts(true) },
      { id: 'go-swap', group: 'Go to', label: 'Swap', hint: "the best route through Terra Swap's, Astroport's and Skeleton Swap's pools", keywords: 'trade exchange buy sell convert skeleton white whale', icon: icon('🔀'), run: () => openTab('swap') },
      { id: 'go-pools', group: 'Go to', label: 'Pools', hint: `${allPools.length} pools on Terra Swap, Astroport and Skeleton Swap: add, zap in, remove`, keywords: 'liquidity lp provide add remove zap fees skeleton white whale', icon: icon('💧'), run: () => openTab('pools') },
      { id: 'go-bridge', group: 'Go to', label: 'Bridge', hint: 'USDC from Noble, ATOM from the Cosmos Hub, USDC.inj from Injective, ASTRO and dATOM from Neutron, stLUNA from Stride, and back', keywords: 'transfer ibc deposit withdraw move chains', icon: icon('🌉'), run: () => openTab('transfer') },
      { id: 'go-positions', group: 'Go to', label: 'Portfolio', hint: 'every position on both sites, staked LP included, and a way out of each', keywords: 'positions lp exit withdraw staked rewards claim holdings', icon: icon('🧾'), run: () => openTab('positions') },
      { id: 'go-history', group: 'Go to', label: 'History', hint: 'your swaps, liquidity and transfers, each quote beside what arrived', keywords: 'transactions receipts activity past', icon: icon('🕘'), run: () => openTab('history') },
      ...(!LITE ? [{ id: 'go-board', group: 'Go to', label: 'Board', hint: 'who was here first, and what they did', keywords: 'leaderboard points badges ranks', icon: icon('🏆'), run: () => openTab('board') }] : []),
      { id: 'page-stats', group: 'Pages', label: 'Stats', hint: 'liquidity, fees paid to providers, liquid staking, routing and uptime', keywords: 'analytics numbers volume tvl uptime data', icon: icon('📊'), run: () => { window.location.href = '/stats' } },
      { id: 'page-verify', group: 'Pages', label: 'Verify the contracts', hint: 'no owner, no admin, no fee: checked from your own browser', keywords: 'security audit renounced keys checksum trust safe', icon: icon('✓'), run: () => { window.location.href = '/verify' } },
      { id: 'page-developers', group: 'Pages', label: 'Build with Terra Swap', hint: 'embed a live quote on your site, or call the quote API', keywords: 'developers api embed widget iframe quote integrate', icon: icon('🧩'), run: () => { window.location.href = '/developers' } },
      { id: 'do-alerts', group: 'Do', label: 'Price alerts and favourites', hint: 'kept in this browser; set an alert on any token page', keywords: 'alert notify notification price watch favourite favorite star', icon: icon('🔔'), run: () => openTab('wallet') },
      {
        id: 'do-install', group: 'Do', label: 'Install Terra Swap as an app', hint: installPrompt ? 'on this device, with its own icon' : 'on a phone: Share, then Add to Home Screen',
        keywords: 'install app pwa home screen phone mobile desktop', icon: icon('📲'),
        run: () => { if (installPrompt) installPrompt.prompt().catch(() => {}); else setToast({ msg: 'On a phone: open the browser menu or Share, then Add to Home Screen.' }) },
      },
      { id: 'do-receive', group: 'Do', label: 'Receive an exact amount', hint: 'type what should arrive, and the swap works out what to pay', keywords: 'exact output receive exactly pay request invoice amount out', icon: icon('🎯'), run: () => { openTab('swap'); setTimeout(() => document.querySelector<HTMLInputElement>('input[data-receive]')?.focus(), 200) } },
      { id: 'do-export', group: 'Do', label: 'Export your history as CSV', hint: 'every transaction of a year, in the columns tax software imports', keywords: 'csv export download tax koinly report history transactions year', icon: icon('🧮'), run: () => openTab('history') },
      { id: 'do-contacts', group: 'Do', label: 'Send to a saved address', hint: 'an address book with memos, kept in this browser', keywords: 'send transfer address book contacts saved recipient memo exchange', icon: icon('📇'), run: () => openTab('wallet') },
      { id: 'do-push', group: 'Do', label: 'Price alerts with the page closed', hint: 'a notification on this device when a token crosses your level', keywords: 'push notification alert closed background phone', icon: icon('📣'), run: () => openTab('wallet') },
      ...LANGS.map(l => ({
        id: `lang-${l.code}`, group: 'Do', label: `Language: ${l.name}`, hint: l.code === lang ? 'in use' : 'the swap, the token picker and the wallet',
        keywords: `language lang translate ${l.code} ${l.name} english korean spanish vietnamese 한국어 español tiếng việt`, icon: icon('🌐'), run: () => setLang(l.code),
      })),
      { id: 'page-source', group: 'Pages', label: 'Source code', hint: 'MIT licensed; anyone can run their own copy', keywords: 'github open source code repository', icon: icon('⌥'), run: () => { window.open('https://github.com/solid-online/terra-swap', '_blank', 'noopener') } },
      ...(!LITE ? [
        { id: 'app-nft', group: 'Pages', label: 'Terra NFT', hint: 'collections, listings and offers on Terra NFT, Necropolis and Boost', keywords: 'nft collectibles marketplace necropolis boost listings offers buy sell terraluna apps', icon: icon('◆'), run: () => { window.location.href = NFT_URL } },
        { id: 'app-gov', group: 'Pages', label: 'Terra Gov', hint: 'proposals, votes, validators and where the community pool’s money went', keywords: 'governance proposals vote validators community pool phoenix directive treasury terraluna apps', icon: icon('§'), run: () => { window.location.href = GOV_URL } },
        { id: 'app-home', group: 'Pages', label: 'All Openfields apps', hint: 'openfields.app', keywords: 'terraluna apps home other products nft gov switcher', icon: icon('🌍'), run: () => { window.location.href = HOME_URL } },
      ] : []),
    ]
    const tokens = new Map<string, KnownToken>()
    for (const p of routePoolsAll) for (const t of p.tokens) tokens.set(assetId(t.info), t)
    const lunaId = 'uluna'
    for (const t of Array.from(tokens.values())) {
      const id = assetId(t.info)
      const meta = TOKEN_META[t.key]
      const words = `${t.key} ${meta?.name ?? ''} ${meta?.origin ?? ''} ${(meta?.tags ?? []).join(' ')}`
      items.push({ id: `buy-${id}`, group: 'Tokens', label: `Buy ${t.label}`, hint: meta?.name ?? t.label, keywords: `${words} get swap into`, icon: <TokenIcon label={t.label} size={20} />, run: () => openSwap(id === lunaId ? NOBLE_USDC : lunaId, id) })
      items.push({ id: `sell-${id}`, group: 'Tokens', label: `Sell ${t.label}`, hint: meta?.name ?? t.label, keywords: `${words} swap out of`, icon: <TokenIcon label={t.label} size={20} />, run: () => openSwap(id, id === NOBLE_USDC || id === USDC_INJ_DENOM ? lunaId : NOBLE_USDC) })
      if (KNOWN_TOKENS.some(k => k.key === t.key)) {
        items.push({ id: `page-${id}`, group: 'Tokens', label: `${t.label}: price and pools`, hint: `${meta?.name ?? t.label}: price over time, who controls it, its pools`, keywords: `${words} page price info about chart history pools who controls mint admin backing holders safety size depth`, icon: <TokenIcon label={t.label} size={20} />, run: () => { window.location.href = `/token/${encodeURIComponent(t.key)}` } })
      }
    }
    // Deepest first, so a tie on the name goes to the pool worth trading in.
    for (const p of allPools.filter(p => !p.empty && (p.tvlUsd ?? 0) >= 1).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))) {
      items.push({
        id: `pool-${p.contract_addr}`, group: 'Pools', label: `${p.label} pool`,
        hint: `${VENUE_NAME[p.venue]}${p.tvlUsd != null ? ` · $${Math.round(p.tvlUsd).toLocaleString('en-US')} liquidity` : ''}`,
        keywords: `${p.tokens.map(t => `${t.key} ${TOKEN_META[t.key]?.name ?? ''}`).join(' ')} liquidity add remove`,
        icon: <PairIcons a={p.tokens[0].label} b={p.tokens[1].label} size={16} />,
        run: () => openInPools(`pool-${p.contract_addr}`, (p.tvlUsd ?? 0) < DUST_USD),
      })
    }
    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPools, routePoolsAll, arbs, openBridge, openInPools, openSwap, openTab, takeArb, installPrompt, lang])
  const load = useCallback(async () => {
    setSyncing(true)
    try {
      const [d, b] = await Promise.all([
        fetch('/api/dex', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        LITE ? Promise.resolve(null) : fetch('/api/dex-leaderboard', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      ])
      if (d) { if (marketRef.current) { annotateMarket(d.pools, marketRef.current); annotateValues(d.pools, marketRef.current) } setData(d) }
      if (b) setBoard(b)
      setSyncedAt(Date.now())
    } finally {
      setSyncing(false)
    }
  }, [])

  // First load + gentle background poll so another trader's swap or a new pool
  // shows up on its own. Pause while the tab is hidden; catch up on return.
  useEffect(() => {
    load()
    const iv = setInterval(() => { if (!document.hidden) load() }, 20_000)
    const onWake = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onWake); window.removeEventListener('focus', onWake) }
  }, [load])

  // Keep the "updated Ns ago" label honest without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { if (me) isCrystalHolder(me).then(setCrystal); else setCrystal(false) }, [me])
  // The arcade signs scores with your short address when you are connected.
  useEffect(() => { (window as unknown as { __terraMe?: string }).__terraMe = me || undefined }, [me])
  // He notices when you walk in.
  const greeted2 = useRef('')
  useEffect(() => {
    if (LITE || !me || greeted2.current === me) return
    greeted2.current = me
    setTimeout(() => kwonSay({ q: `gm ${me.slice(0, 9)}…${me.slice(-4)}. Yeah but your size is not size.`, when: 'reacting to your wallet · @stablekwon 2021', pose: 'point' }), 1200)
  }, [me])

  // After a tx, the block needs ~6s to land and the LCD a moment more to index
  // it. A single poll usually fires too early, so fire a short burst — cheap,
  // idempotent server-side, and it makes the pool/board/balances update on
  // their own the instant the chain catches up.
  const refresh = useCallback(() => {
    [1500, 4000, 7000, 12000].forEach(ms => setTimeout(load, ms))
  }, [load])

  // Round-number blocks deserve a nod. Fires once when a 10,000 line is crossed.
  const prevHeight = useRef(0)
  useEffect(() => {
    const h = data?.height ?? 0
    const prev = prevHeight.current
    prevHeight.current = h
    if (prev > 0 && h > prev && Math.floor(h / 10_000) > Math.floor(prev / 10_000)) {
      setToast({ msg: `Block ${(Math.floor(h / 10_000) * 10_000).toLocaleString('en-US')} crossed. Round numbers deserve a nod.` })
    }
    if (h > 0 && h !== prev && /(777|888)$/.test(String(h))) setToast({ msg: `Block ${h.toLocaleString('en-US')}. Lucky block. 대박.` })
    // The Steady Lad window closing is a moment. Once, for whoever is here.
    const cut = board?.rules?.cutoffHeight ?? 0
    if (cut > 0 && prev > 0 && prev < cut && h >= cut) {
      setParty({ emoji: '🐎', title: 'THE WINDOW CLOSED', sub: 'Week one is over. The Steady Lads are marked. Forever.' })
    }
  }, [data?.height, board])

  // Every fifty moves on the chain: supply blocked.
  const lastFifty = useRef(-1)
  useEffect(() => {
    if (!board?.live) return
    const t = board.totalEvents; const bucket = Math.floor(t / 50)
    if (lastFifty.current === -1) { lastFifty.current = bucket; return }
    if (bucket > lastFifty.current) { lastFifty.current = bucket; setToast({ msg: `${bucket * 50} moves. Spawn more Overlords.` }) }
  }, [board?.totalEvents])
  // Welcome back: how much moved while you were away. Said quietly on the board strip, not in a toast over the product on arrival.
  const greeted = useRef(false)
  const [awayMoves, setAwayMoves] = useState(0)
  useEffect(() => {
    if (greeted.current || !board?.live) return
    greeted.current = true
    try {
      const seen = Number(localStorage.getItem('terraswap_seen_moves') || '0')
      if (seen > 0 && board.totalEvents > seen) setAwayMoves(board.totalEvents - seen)
      localStorage.setItem('terraswap_seen_moves', String(board.totalEvents))
    } catch { /* private mode */ }
  }, [board])

  const agoLabel = (() => {
    void nowTick
    if (!syncedAt) return ''
    const s = Math.round((Date.now() - syncedAt) / 1000)
    return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`
  })()

  /** A tab button. `on` covers a tab that owns more than one section (Pools opens a pool, Portfolio holds History). */
  const tabBtn = (t: Tab, txt: React.ReactNode, on = tab === t) => (
    <button type='button' onClick={() => setTab(t)} aria-current={on ? 'page' : undefined} style={{
      ...ghostBtn, padding: '0.45rem 0.9rem', whiteSpace: 'nowrap',
      color: on ? C.goldLit : C.textMuted,
      borderColor: on ? C.goldCore : C.divider,
      background: on ? 'rgba(255,216,61,0.06)' : 'transparent',
    }}>{txt}</button>
  )

  return (
    <>
      <Head>
        <title>{APP_NAME}</title>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap' />
      </Head>
      {intro && <IntroSplash onDone={() => setIntro(false)} />}
      {party && <Celebrate party={party} onDone={clearParty} />}
      {shortcuts && <ShortcutsOverlay onClose={() => setShortcuts(false)} />}
      {game && <CapitalGame onClose={() => setGame(false)} />}
      {tv && data && <TvMode data={data} board={board} onClose={() => setTv(false)} />}
      {!LITE && mapOn && data?.live && <Minimap pools={data.pools} board={board} revealed={revealed} onJump={c => { setTab('pools'); setTimeout(() => document.getElementById(`pool-${c}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120) }} />}
      {ledgerOpen && <LedgerOverlay board={board} pools={data?.pools ?? []} onClose={() => setLedgerOpen(false)} />}
      {toast && <Toast msg={toast.msg} href={toast.href} onDone={clearToast} />}
      {palette && <CommandPalette items={paletteItems} onClose={() => setPalette(false)} />}
      {/* Opaque Terra ground that sits ABOVE the Atrium cathedral backdrop
          (its layers cap at z-index 0), so this surface is pure retro Terra. */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'none',
        background: 'radial-gradient(120% 80% at 50% -10%, #111729 0%, #0a0d18 42%, #05070f 100%)',
      }} />
      {/* Night-market lanterns: a few warm glows drifting behind everything. */}
      <div className='terra-lanterns' aria-hidden>
        {[0, 1, 2, 3, 4, 5].map(k => <span key={k} className={`terra-lantern terra-lantern-${k}`} />)}
      </div>
      <main style={{ minHeight: '100vh', background: 'transparent', paddingBottom: '4rem', position: 'relative', zIndex: 2 }}>
        {/* Width and scale live in the stylesheet (.terra-article) so desktop can grow without touching phones. */}
        <article className='terra-article' style={{ margin: '0 auto', padding: '1.4rem 1.2rem 2rem' }}>
          {/* No "back to Atrium" row: the wallet sits on the wordmark's line instead, which buys
              a whole row above the fold. The struck-through Atrium in the h1 still tells the story. */}
          <Hero poolFeeBps={data?.poolFeeBps ?? 30} onReplay={() => setIntro(true)} onHome={goHome} onToast={m => setToast({ msg: m })} me={me || undefined}
            right={<WalletButton />} />

          {data && !data.live && (
            <Empty title='Not live yet' body='The factory is being set up. Check back shortly.' />
          )}

          {data?.live && (
            <>
              {/* Five places, named for what people come to do. Opening a pool lives in Pools, History in Portfolio,
                  and everything else, tokens and pools included, is one search away. */}
              <div className='terra-tabs' style={{ display: 'flex', gap: SPACE['2'], marginBottom: SPACE['3'], alignItems: 'center' }}>
                {tabBtn('swap', t('Swap'))}
                {tabBtn('pools', <>{t('Pools')}<span className='terra-tab-count'> · {allPools.length}</span></>, tab === 'pools' || tab === 'create')}
                {tabBtn('transfer', t('Bridge'))}
                {tabBtn('positions', t('Portfolio'), tab === 'positions' || tab === 'wallet' || tab === 'history')}
                {!LITE && tabBtn('board', <>{t('Board')}{board?.rows.length ? <span className='terra-tab-count'> · {board.rows.length}</span> : null}</>)}
                {/* Terra Predict lives next door, once it is live. A link to "not live yet" is a dead end. */}
                {!LITE && isPredictLive() && <Link href='/predict' style={{ ...ghostBtn, padding: '0.45rem 0.9rem', textDecoration: 'none', color: C.emberLit, borderColor: C.dividerWarm, whiteSpace: 'nowrap' }}>Predict ↗</Link>}
                <button type='button' onClick={() => setPalette(true)} title='Search tokens, pools and everything this site does (⌘K)' aria-label='Search everything'
                  className='terra-search-btn' style={{ ...ghostBtn, padding: '0.45rem 0.8rem', marginLeft: 'auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden style={{ color: C.goldLit }}>⌕</span>
                  <span className='terra-search-label'>{t('Search')}</span>
                  <kbd className='terra-kbd-hint' style={{ fontFamily: 'inherit', fontSize: '0.62rem', color: C.textWhisper, border: `1px solid ${C.divider}`, borderRadius: 5, padding: '0 5px' }}>⌘K</kbd>
                </button>
              </div>
              {tab === 'swap' && loopFor && <LoopPanel plan={loopFor} pools={routePoolsAll} onClose={() => setLoopFor(null)} onOneSided={oneSided} onDone={refresh} />}
              {tab === 'swap' && <SwapPanel pools={data.pools} venuePools={swapVenuePools} crystal={crystal} feeBps={data.feeBps} poolFeeBps={data.poolFeeBps} onDone={refresh} arbs={arbs} preset={preset} onTakeArb={takeArb}
                onNext={(k, key) => { if (k === 'pools') { setVenueFilter('all'); setPoolQuery(key ?? '') } openTab(k) }} />}
              {tab === 'pools' && (
                allPools.length === 0
                  ? <Empty title='No pools yet' body={LITE ? 'Could not read the pool list. Try again in a moment.' : 'Open the first one. One signature, gas only. Your name goes to the top of the board and everyone sees it was you.'} />
                  : <div style={{ display: 'grid', gap: SPACE['3'] }}>
                    {/* ampLUNA and bLUNA in the pools against their hubs; "swap" opens the trade in the Swap tab, which offers the hub when it is the better side. */}
                    <div style={{ display: 'grid', gap: SPACE['2'] }}>
                      <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap', alignItems: 'center' }}>
                        <input value={poolQuery} onChange={e => setPoolQuery(e.target.value)} aria-label='Find a pool'
                          placeholder='Find a pool: LUNA, SOLID USDC…' spellCheck={false} autoComplete='off'
                          style={{ ...field, flex: '1 1 200px', minWidth: 0, padding: '0.45rem 0.75rem', fontSize: TEXT.sm.size }} />
                        <button type='button' onClick={() => setTab('create')} style={{ ...ghostBtn, padding: '0.45rem 0.9rem', color: C.goldLit, borderColor: C.goldCore, whiteSpace: 'nowrap' }}>
                          + Open a pool
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap' }}>
                        {(['all', 'terraswap', 'astroport', 'skeleton'] as const).filter(v => v !== 'skeleton' || allPools.some(p => p.venue === 'skeleton')).map(v => (
                          <button key={v} type='button' onClick={() => { setVenueFilter(v); setShowDust(false) }}
                            style={{ ...ghostBtn, padding: '3px 10px', color: venueFilter === v ? C.goldLit : C.textMuted, borderColor: venueFilter === v ? C.goldCore : C.divider }}>
                            {v === 'all' ? `All · ${allPools.length}` : `${VENUE_NAME[v]} · ${allPools.filter(p => p.venue === v).length}`}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: SPACE['2'], flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: TEXT.xs.size, color: C.textWhisper }}>Sort</span>
                        {(['suggested', 'tvl', 'traded', 'name'] as const).filter(s => s !== 'suggested' || !LITE).map(s => (
                          <button key={s} type='button' onClick={() => setPoolSort(s)} aria-pressed={poolSort === s}
                            style={{ ...ghostBtn, padding: '3px 10px', color: poolSort === s ? C.goldLit : C.textMuted, borderColor: poolSort === s ? C.goldCore : C.divider }}>
                            {POOL_SORT_LABEL[s]}
                          </button>
                        ))}
                      </div>
                      {poolSort === 'traded' && !board && (
                        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5 }}>Reading recent activity…</div>
                      )}
                      {poolQuery.trim() && visiblePools.length === 0 && (
                        <div style={{ fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6 }}>
                          No pool here holds that. <button type='button' onClick={() => setTab('create')} style={{ background: 'transparent', border: 'none', color: C.goldLit, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }}>Open one</button>, it takes one signature.
                        </div>
                      )}
                      {(venueFilter === 'all' || venueFilter === 'astroport') && allPools.some(p => p.venue === 'astroport') && (
                        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5 }}>
                          Astroport&apos;s pools are its own contracts, reached here directly: swaps, deposits and withdrawals go straight to them. Not affiliated with Astroport.
                        </div>
                      )}
                      {(venueFilter === 'all' || venueFilter === 'skeleton') && allPools.some(p => p.venue === 'skeleton') && (
                        <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, lineHeight: 1.5 }}>
                          Skeleton Swap&apos;s pools run on White Whale&apos;s pool contracts, reached here directly: swaps, deposits and withdrawals go straight to them. Each pool sets its own fee, part of it to White Whale, and its owner can change fees and pause swaps, deposits or withdrawals. Not affiliated with Skeleton Swap or White Whale.
                        </div>
                      )}
                    </div>
                    {visiblePools.length > 0 && !poolQuery.trim() && (
                      <div id='lst' style={{ scrollMarginTop: 12 }}>
                        {/* ampLUNA and bLUNA in the pools against their hubs; "swap" opens the trade in the Swap tab, which offers the hub when it is the better side. */}
                        <LstBoard onTrade={(fromId, toId, amount) => { setPreset({ fromId, toId, amount, n: Date.now() }); openTab('swap') }} />
                      </div>
                    )}
                    {visiblePools.map(p => <div key={p.contract_addr} id={`pool-${p.contract_addr}`}><PoolRow p={p} routePools={routePoolsAll} onDone={refresh} onParty={setParty} act={board?.poolActivity?.[p.contract_addr]} height={data.height} firstHand={board?.firstHands?.[p.contract_addr]} crystal={crystal} badge={(() => {
                    const deepest = allPools.reduce((b, q) => ((q.tvlUsd ?? 0) > (b?.tvlUsd ?? 0) ? q : b), null as PoolView | null)
                    const counts = board?.poolActivity ?? {}
                    const hottest = data.pools.reduce((b, q) => ((counts[q.contract_addr]?.count ?? 0) > (b ? (counts[b.contract_addr]?.count ?? 0) : 0) ? q : b), null as PoolView | null)
                    return deepest?.contract_addr === p.contract_addr && (p.tvlUsd ?? 0) > 0 ? 'deepest' : hottest?.contract_addr === p.contract_addr && (counts[p.contract_addr]?.count ?? 0) >= 3 ? 'hottest' : undefined
                  })()} spark={allPools.filter(q => q.venue !== 'skeleton' && (q.tvlUsd ?? 0) > 0).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)).slice(0, 4).some(q => q.contract_addr === p.contract_addr)} arb={arbs.find(a => a.pool.contract_addr === p.contract_addr)} onTake={takeArb} holders={holders[p.contract_addr]} flow={me ? board?.flows?.[`${me}|${p.contract_addr}`] : undefined} /></div>)}
                    {dustCount > 0 && (
                      <button type='button' style={{ ...ghostBtn, justifySelf: 'center' }} onClick={() => setShowDust(s => !s)}>
                        {showDust ? 'Hide the empty ones' : `Show ${dustCount} pool${dustCount === 1 ? '' : 's'} under $${DUST_USD}`}
                      </button>
                    )}
                    </div>
              )}
              {(tab === 'positions' || tab === 'wallet' || tab === 'history') && <PortfolioSwitch view={tab} onView={setTab} />}
              {tab === 'positions' && <PositionsPanel onDone={refresh} flows={me ? board?.flows : undefined} />}
              {tab === 'wallet' && (
                <div style={{ display: 'grid', gap: SPACE['3'] }}>
                  <WalletPanel pools={routePoolsAll} onDone={refresh} />
                  <SendPanel pools={routePoolsAll} onDone={refresh} />
                  <AlertsPanel />
                </div>
              )}
              {tab === 'history' && <HistoryPanel pools={allPools} />}
              {tab === 'transfer' && <TransferPanel key={bridgeNet} initialNet={bridgeNet} routePools={routePoolsAll} onDone={refresh} />}
              {tab === 'create' && <CreatePanel pools={allPools} marketPx={marketPx} onDone={refresh} onCreated={() => setTab('pools')} onBack={() => setTab('pools')} onParty={setParty} />}
              {tab === 'board' && <Leaderboard board={board} me={me} onGoSwap={() => setTab('swap')} height={data.height} crystal={crystal} spotlight={spotlight} />}
              <div style={{ marginTop: SPACE['3'] }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: SPACE['3'], fontSize: TEXT.xs.size, color: C.textWhisper }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                  background: syncing ? C.emberLit : C.success,
                  boxShadow: syncing ? `0 0 6px ${C.emberLit}` : 'none',
                  transition: 'background 0.3s',
                }} />
                <span>{syncing ? 'Syncing with the chain…' : agoLabel ? `Live · updated ${agoLabel}` : 'Live'}</span>
                <button type='button' onClick={() => load()} style={{
                  marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.textMuted, fontSize: TEXT.xs.size, fontFamily: 'inherit', padding: 0,
                }}>Refresh now</button>
              </div>
              {tab !== 'board' && board && board.rows.length > 0 && (
                <button type='button' onClick={() => setTab('board')} style={{
                  display: 'flex', alignItems: 'center', gap: SPACE['2'], width: '100%', textAlign: 'left',
                  padding: `${SPACE['2']}px ${SPACE['3']}px`, marginBottom: SPACE['3'], cursor: 'pointer', fontFamily: 'inherit',
                  background: 'rgba(255,216,61,0.04)', border: `1px solid ${C.divider}`, borderRadius: RADIUS.md,
                  fontSize: TEXT.xs.size, color: C.textMuted,
                }}>
                  {board.rows.slice(0, 3).map(r => (
                    <span key={r.address} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.textSecondary }}>
                      {r.badges[0]?.emoji}<WalletName address={r.address} head={6} tail={4} /><span style={{ color: C.goldLit, fontVariantNumeric: 'tabular-nums' }}>{r.points}</span>
                    </span>
                  ))}
                  <span style={{ marginLeft: 'auto', color: C.emberLit, fontWeight: 600, whiteSpace: 'nowrap' }}>{awayMoves > 0 ? `${awayMoves} new since your last visit · ` : ''}The board →</span>
                </button>
              )}
            </>
          )}
          {!data && <Empty title='Loading…' body='' />}

          {/* Below the fold: what this is, the numbers, the wire, and the fun. The panel above is the product. */}
          {data?.live && LITE && (
            <p style={{ color: C.textMuted, margin: `${SPACE['4']}px 0 0`, fontSize: TEXT.xs.size, lineHeight: 1.6 }}>
              An unofficial, open-source interface to Astroport&apos;s pool contracts on Terra. Not affiliated with Astroport.
              It adds no fee and holds nothing: every swap and deposit goes straight to the pool contract, and pool fees are whatever that contract charges.
              Every Astroport token with real liquidity, pool creation, and a Portfolio tab that finds and exits LP anywhere on Terra Swap or Astroport, staked LP and old ASTRO included. The code is MIT and anyone can host their own copy.
            </p>
          )}
          {data?.live && !LITE && tab === 'swap' && (
            <Explore
              pools={allPools.filter(p => !p.empty).length}
              gaps={arbs.length}
              onGo={k => {
                if (k === 'gap') { if (arbs[0]) takeArb(arbs[0]); return }
                if (k === 'lst') { openInPools('lst'); return }
                if (k === 'search') { setPalette(true); return }
                openTab(k === 'bridge' ? 'transfer' : k === 'portfolio' ? 'positions' : k === 'history' ? 'history' : k)
              }}
            />
          )}
          {data?.live && !LITE && (
            <p style={{ color: C.textWhisper, margin: `${SPACE['3']}px 0 0`, fontSize: TEXT.xs.size, lineHeight: 1.6 }}>
              A decentralized exchange on Terra, open source and experimental. Pools run Astroport&apos;s audited contract code; pool fee {(data.poolFeeBps / 100).toFixed(1)}% on Terra Swap&apos;s pools, all to liquidity providers, and no interface fee. Swaps also route through Astroport&apos;s pools and Skeleton Swap&apos;s (White Whale&apos;s pool contracts) when they price better. Independent, not affiliated with Terraswap (app.terraswap.io), Astroport, Skeleton Swap or White Whale. Amounts are small: trade what you are happy to lose.
            </p>
          )}
          {data?.live && !LITE && <div style={{ marginTop: SPACE['5'] }}><StatBand data={data} board={board} /></div>}
          {data?.live && !LITE && <Wire board={board} pools={data.pools} onOpen={() => setLedgerOpen(true)} />}
          {data?.live && !LITE && (
            <p style={{ fontSize: TEXT.xs.size, color: C.goldLit, lineHeight: 1.6, margin: `0 0 ${SPACE['3']}px`, paddingLeft: SPACE['3'], letterSpacing: '0.02em' }}>
              ✦ We keep a list of who was here first. The earliest hands in the earliest pools get remembered.
              What that comes to mean, you find out. Nobody knows what happens next. That is the fun.
            </p>
          )}
          {data?.live && !LITE && <Ticker extra={data.pools.every(p => p.empty) ? ['0 pools with liquidity. the board is blank. move first and own the top of it.'] : undefined} />}
          {data?.live && !LITE && <KwonLine recent={board?.recent} />}
          {data?.live && !LITE && <Credits board={board} />}
          {LITE ? (
            <div style={{ marginTop: SPACE['5'], paddingTop: SPACE['3'], borderTop: `1px solid ${C.divider}`, display: 'flex', flexWrap: 'wrap', gap: SPACE['2'], fontFamily: TERRA_FONT, fontSize: '0.64rem', letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase' }}>
              <span>phoenix-1{data?.height ? ` #${data.height.toLocaleString('en-US')}` : ''}</span>
              <span>·</span>
              <a href='https://github.com/solid-online/terra-swap' target='_blank' rel='noreferrer' style={{ color: C.textMuted }}>source · MIT ↗</a>
            </div>
          ) : (
            <Footer height={data?.height} seoul={data?.seoul} soundOn={soundOn} onToggleSound={toggleSound} onSecret={() => setParty({ emoji: '🐎', title: 'STEADY LADS', sub: 'Seven taps on the moon. You found the thumb code. 🫡' })} />
          )}
        </article>
      </main>

      <style jsx global>{`
        .atrium-swap-title {
          background: linear-gradient(
            100deg,
            #caa022 0%, #ffd83d 22%, #fff8dc 40%, #ffd83d 58%, #caa022 78%, #caa022 100%
          );
          background-size: 250% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          animation: atriumSwapShimmer 6s linear infinite;
        }
        @keyframes atriumSwapShimmer {
          to { background-position: 250% center; }
        }
        @media (prefers-reduced-motion: reduce) {
          .atrium-swap-title { animation: none; }
        }

        /* ── Retro Terra intro ── */
        .terra-intro {
          background: radial-gradient(120% 90% at 50% 120%, #1a1d30 0%, #0a0d18 45%, #05070f 100%);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; animation: terraIntroIn 0.5s ease both;
        }
        .terra-intro-leave { animation: terraIntroOut 0.6s cubic-bezier(0.7,0,0.3,1) forwards; }
        .terra-intro-inner {
          position: relative; z-index: 2; text-align: center;
          display: flex; flex-direction: column; align-items: center;
        }
        .terra-intro-sun {
          /* LUNA means moon. A gold moon rises, not a sun. */
          position: absolute; left: 50%; bottom: -30vh; transform: translateX(-50%);
          width: 78vh; height: 78vh; border-radius: 999px; z-index: 1;
          background: radial-gradient(circle at 42% 40%, rgba(255,248,220,0.95) 0%, rgba(255,216,61,0.85) 18%, rgba(202,160,34,0.55) 34%, rgba(202,160,34,0.18) 52%, transparent 66%);
          box-shadow: 0 0 120px 30px rgba(255,216,61,0.18);
          animation: terraSun 2.4s cubic-bezier(0.16,1,0.3,1) both;
          filter: blur(1.5px);
        }
        .terra-intro-grid {
          position: absolute; inset: 0; z-index: 0; opacity: 0.5;
          background-image:
            linear-gradient(rgba(255,179,71,0.10) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,179,71,0.10) 1px, transparent 1px);
          background-size: 46px 46px;
          mask-image: radial-gradient(120% 70% at 50% 90%, #000 30%, transparent 75%);
          -webkit-mask-image: radial-gradient(120% 70% at 50% 90%, #000 30%, transparent 75%);
          animation: terraGrid 2.6s linear both;
        }
        .terra-intro-kicker {
          font-family: ${TERRA_FONT};
          font-size: 0.62rem; letter-spacing: 0.42em; text-transform: uppercase;
          color: #ffb347; font-weight: 600; margin-bottom: 1.1rem;
          opacity: 0; animation: terraFade 0.8s ease 0.5s both;
        }
        .terra-intro-globe {
          width: 0.8em; height: auto; vertical-align: -0.06em; margin-right: 0.22em;
          filter: drop-shadow(0 0 24px rgba(52,88,184,0.55));
          animation: terraGlobeSpin 1.5s cubic-bezier(0.16,1,0.3,1) both;
        }
        @keyframes terraGlobeSpin { from { opacity: 0; transform: rotate(-140deg) scale(0.4); } to { opacity: 1; transform: none; } }
        .terra-intro-thin { font-weight: 300; }
        .terra-intro-word {
          font-size: clamp(2.6rem, 12vw, 6.4rem); font-weight: 700; line-height: 0.95; white-space: nowrap;
          background: linear-gradient(180deg, #fff8dc 0%, #ffd83d 55%, #caa022 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          text-shadow: 0 0 60px rgba(255,216,61,0.5);
          animation: terraWord 1.5s cubic-bezier(0.16,1,0.3,1) both;
        }
        .terra-intro-sub {
          font-family: ${TERRA_FONT};
          font-size: 0.9rem; letter-spacing: 0.5em; text-transform: uppercase;
          color: #d6cfbd; margin-top: 1rem; padding-left: 0.5em;
          opacity: 0; animation: terraFade 0.9s ease 1.1s both;
        }
        .terra-intro-skip {
          position: absolute; bottom: 6vh; left: 0; right: 0; text-align: center; z-index: 2;
          font-family: ${TERRA_FONT};
          font-size: 0.6rem; letter-spacing: 0.3em; text-transform: uppercase;
          color: #6b6555; opacity: 0; animation: terraFade 1s ease 1.6s both;
        }
        @keyframes terraIntroIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes terraIntroOut { to { opacity: 0; transform: translateY(-8%); } }
        @keyframes terraSun { from { transform: translateX(-50%) translateY(45vh); opacity: 0 } to { transform: translateX(-50%) translateY(0); opacity: 1 } }
        @keyframes terraGrid { from { opacity: 0; transform: perspective(500px) rotateX(20deg) translateY(20px) } to { opacity: 0.5; transform: perspective(500px) rotateX(20deg) translateY(0) } }
        @keyframes terraWord { 0% { opacity: 0; letter-spacing: 0.5em; transform: translateY(18px) } 100% { opacity: 1; letter-spacing: 0.06em; transform: translateY(0) } }
        @keyframes terraFade { to { opacity: 1 } }
        .terra-pulse {
          width: 7px; height: 7px; border-radius: 999px; background: #3ddc97;
          box-shadow: 0 0 0 0 rgba(61,220,151,0.6); animation: terraPulse 2.4s ease-out infinite;
        }
        @keyframes terraPulse { 0% { box-shadow: 0 0 0 0 rgba(61,220,151,0.55) } 70% { box-shadow: 0 0 0 7px rgba(61,220,151,0) } 100% { box-shadow: 0 0 0 0 rgba(61,220,151,0) } }
        .terra-tape-row:hover span { color: #f4f1e8 !important; }

        .terra-party {
          position: fixed; inset: 0; z-index: 70; cursor: pointer; overflow: hidden;
          background: radial-gradient(80% 60% at 50% 50%, rgba(202,160,34,0.55) 0%, rgba(7,15,36,0.92) 70%);
          display: flex; align-items: center; justify-content: center;
          animation: terraIntroIn 0.25s ease both;
        }
        .terra-party-red { background: radial-gradient(80% 60% at 50% 50%, rgba(224,72,90,0.62) 0%, rgba(40,6,12,0.94) 70%) !important; }
        .terra-party-red .terra-party-title { background: linear-gradient(180deg, #fff1e6 0%, #ff8a7a 55%, #e0485a 100%); -webkit-background-clip: text; background-clip: text; }
        .terra-party-moon { background: radial-gradient(60% 60% at 50% 45%, rgba(255,248,220,0.30) 0%, rgba(255,216,61,0.16) 30%, rgba(5,7,15,0.94) 72%) !important; }
        .terra-party-inner { text-align: center; position: relative; z-index: 2; }
        .terra-party-emoji { font-size: clamp(4rem, 18vw, 8rem); line-height: 1; animation: terraPop 0.7s cubic-bezier(0.16,1.4,0.3,1) both; filter: drop-shadow(0 0 40px rgba(255,179,71,0.6)); }
        .terra-party-title {
          font-size: clamp(2rem, 9vw, 4rem); font-weight: 700; letter-spacing: 0.08em; margin-top: 0.4rem;
          background: linear-gradient(180deg, #fff8dc 0%, #ffd83d 55%, #caa022 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
          animation: terraWord 0.9s cubic-bezier(0.16,1,0.3,1) 0.15s both;
        }
        .terra-party-sub { color: #d6cfbd; font-size: 0.9rem; margin-top: 0.6rem; max-width: 34ch; margin-left: auto; margin-right: auto; line-height: 1.5; opacity: 0; animation: terraFade 0.6s ease 0.6s both; }
        .terra-party-horse { position: absolute; top: -40px; z-index: 1; animation-name: terraRain; animation-timing-function: linear; animation-fill-mode: both; }
        @keyframes terraPop { from { transform: scale(0.2) rotate(-12deg); opacity: 0 } to { transform: scale(1) rotate(0); opacity: 1 } }
        @keyframes terraRain { from { transform: translateY(0) rotate(0deg); opacity: 0 } 10% { opacity: 1 } to { transform: translateY(110vh) rotate(24deg); opacity: 0.9 } }

        .terra-toast {
          position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 65;
          display: flex; align-items: center; max-width: min(92vw, 520px);
          padding: 10px 14px; border-radius: 12px; font-size: 0.82rem; line-height: 1.4;
          background: #111729; color: #f4f1e8; border: 1px solid rgba(255,216,61,0.30);
          box-shadow: 0 12px 40px rgba(0,0,0,0.45); animation: terraToastIn 0.35s cubic-bezier(0.16,1,0.3,1) both;
        }
        @keyframes terraToastIn { from { opacity: 0; transform: translateX(-50%) translateY(14px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
        .terra-wire {
          display: flex; align-items: center; gap: 10px; margin: -6px 0 14px;
          padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(255,216,61,0.16); background: #0b0f1c;
          font-family: ${TERRA_FONT}; font-size: 0.68rem; color: #9a927f; overflow: hidden;
        }
        .terra-wire-tag { flex-shrink: 0; letter-spacing: 0.18em; font-weight: 700; color: #e0485a; font-size: 0.58rem; }
        .terra-wire-mask { flex: 1; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
        .terra-wire-track { display: inline-flex; gap: 28px; white-space: nowrap; animation: terraWire 48s linear infinite; will-change: transform; }
        .terra-wire:hover .terra-wire-track { animation-play-state: paused; }
        .terra-wire-item { display: inline-flex; gap: 6px; align-items: baseline; }
        @keyframes terraWire { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .terra-flash-up { animation: terraFlashUp 0.9s ease-out; }
        .terra-flash-down { animation: terraFlashDown 0.9s ease-out; }
        @keyframes terraFlashUp { 0% { color: #3ddc97; text-shadow: 0 0 18px rgba(61,220,151,0.7) } 100% { color: inherit; text-shadow: none } }
        @keyframes terraFlashDown { 0% { color: #e04a5a; text-shadow: 0 0 18px rgba(255,107,107,0.7) } 100% { color: inherit; text-shadow: none } }
        @media (prefers-reduced-motion: reduce) { .terra-wire-track { animation: none; } }
        .terra-spotlight { animation: terraSpot 1.6s ease-out 2; }
        @keyframes terraSpot { 0% { box-shadow: 0 0 0 0 rgba(61,220,151,0.55) } 100% { box-shadow: 0 0 0 14px rgba(61,220,151,0) } }
        /* Full-bleed: the line runs from screen edge to screen edge, not just across the column. */
        .kwon-stage { position: relative; height: 230px; overflow: hidden; cursor: pointer; width: 100vw; margin-left: calc(50% - 50vw); background: linear-gradient(180deg, transparent 0%, rgba(255,216,61,0.03) 100%); }
        .kwon-ground { position: absolute; left: 0; right: 0; bottom: 22px; height: 3px; background: #ffd83d; border-radius: 2px; box-shadow: 0 0 14px rgba(255,216,61,0.35); }
        .kwon-man { position: absolute; bottom: 20px; width: 60px; height: 92px; transition-property: left; transition-timing-function: linear; will-change: left; }
        .kwon-man svg { display: block; overflow: visible; }
        .kwon-leg-l, .kwon-leg-r, .kwon-arm-b, .kwon-arm-f { transform-box: view-box; }
        .kwon-leg-l, .kwon-leg-r { transform-origin: 30px 60px; }
        .kwon-arm-b, .kwon-arm-f { transform-origin: 30px 42px; }
        .kwon-pose-walk .kwon-leg-l { animation: kwonLegA 0.55s ease-in-out infinite; }
        .kwon-pose-walk .kwon-leg-r { animation: kwonLegB 0.55s ease-in-out infinite; }
        .kwon-pose-walk .kwon-arm-f { animation: kwonLegB 0.55s ease-in-out infinite; }
        .kwon-pose-walk .kwon-arm-b { animation: kwonLegA 0.55s ease-in-out infinite; }
        .kwon-pose-walk svg { animation: kwonBob 0.55s ease-in-out infinite; }
        @keyframes kwonLegA { 0%,100% { transform: rotate(-22deg) } 50% { transform: rotate(22deg) } }
        @keyframes kwonLegB { 0%,100% { transform: rotate(22deg) } 50% { transform: rotate(-22deg) } }
        @keyframes kwonBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        .kwon-pose-salute .kwon-arm-f { transform: rotate(-150deg); }
        .kwon-pose-point .kwon-arm-f { transform: rotate(-75deg); }
        .kwon-pose-shrug .kwon-arm-f { transform: rotate(-110deg); }
        .kwon-pose-shrug .kwon-arm-b { transform: rotate(70deg); }
        .kwon-pose-shrug svg { transform: translateY(-3px); }
        .kwon-badge { position: absolute; top: -10px; right: -16px; font-size: 18px; opacity: 0; transition: opacity 0.25s; }
        .kwon-pose-salute .kwon-badge { opacity: 1; }
        .kwon-bubble {
          position: absolute; bottom: 124px; transform: translateX(-50%);
          background: #f4f1e8; color: #05070f; border-radius: 14px; padding: 9px 12px; font-size: 0.82rem; line-height: 1.35;
          font-family: ${TERRA_FONT}; font-weight: 500; box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          transition-property: left; transition-timing-function: linear; animation: kwonPop 0.28s cubic-bezier(0.16,1.4,0.3,1) both;
        }
        .kwon-bubble::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -9px; width: 14px; height: 14px; background: #f4f1e8; transform: translateX(-50%) rotate(45deg); border-radius: 2px; }
        .kwon-bubble-when { margin-top: 5px; font-size: 0.62rem; letter-spacing: 0.06em; color: #6b6555; text-transform: uppercase; font-weight: 700; }
        .kwon-bubble-fact { font-style: italic; }
        @keyframes kwonPop { from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.9) } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) } }
        @media (prefers-reduced-motion: reduce) { .kwon-pose-walk .kwon-leg-l, .kwon-pose-walk .kwon-leg-r, .kwon-pose-walk .kwon-arm-f, .kwon-pose-walk .kwon-arm-b, .kwon-pose-walk svg { animation: none; } .kwon-man, .kwon-bubble { transition: none; } }
        .kwon-poor { position: absolute; bottom: 20px; width: 44px; height: 68px; transition: left 2.6s cubic-bezier(0.3,0.7,0.4,1); }
        .kwon-poor .kwon-leg-l { animation: kwonLegA 0.6s ease-in-out infinite; } .kwon-poor .kwon-leg-r { animation: kwonLegB 0.6s ease-in-out infinite; }
        .kwon-sign { position: absolute; top: -30px; left: 50%; margin-left: -6px; white-space: nowrap; background: #9a927f; color: #05070f; font-size: 0.58rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 7px; border-radius: 4px; transform-origin: center; }
        .kwon-caret { color: #caa022; animation: kwonCaret 0.8s steps(1) infinite; }
        .kwon-poor-say { position: absolute; top: -58px; left: 50%; margin-left: -18px; background: #d6cfbd; color: #05070f; font-size: 0.7rem; font-weight: 700; padding: 4px 8px; border-radius: 10px; white-space: nowrap; animation: kwonPop 0.25s cubic-bezier(0.16,1.4,0.3,1) both; }
        .kwon-poor-say::after { content: ''; position: absolute; left: 14px; bottom: -5px; width: 9px; height: 9px; background: #d6cfbd; transform: rotate(45deg); }
        @keyframes kwonCaret { 50% { opacity: 0 } }
        .terra-credits { height: 132px; overflow: hidden; position: relative; margin: 10px auto 6px; max-width: 420px;
          mask-image: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent); -webkit-mask-image: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent); }
        .terra-credits-roll { animation: terraCredits linear infinite; }
        @keyframes terraCredits { from { transform: translateY(0) } to { transform: translateY(-50%) } }
        @media (prefers-reduced-motion: reduce) { .terra-credits-roll { animation: none; } .kwon-poor { transition: none; } }
        .terra-stepper { display: flex; gap: 14px; flex-wrap: wrap; font-family: ${TERRA_FONT}; font-size: 0.68rem; letter-spacing: 0.04em; margin: 8px 0 10px; }
        .terra-step-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
        .terra-step-now { animation: terraPulse 1.2s ease-out infinite; }
        .terra-receipt {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; color: #1a1405; background: #f4f1e8;
          border-radius: 6px; padding: 10px 12px; margin: 6px 0 12px; cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,0.4);
          background-image: repeating-linear-gradient(180deg, transparent 0 22px, rgba(0,0,0,0.035) 22px 23px);
          animation: terraReceipt 0.5s cubic-bezier(0.16,1,0.3,1) both; transform-origin: top;
        }
        .terra-receipt-h { font-weight: 700; letter-spacing: 0.12em; text-align: center; border-bottom: 1px dashed #9a927f; padding-bottom: 6px; margin-bottom: 6px; }
        .terra-receipt-row { display: flex; justify-content: space-between; gap: 12px; padding: 1px 0; }
        .terra-receipt-f { text-align: center; border-top: 1px dashed #9a927f; margin-top: 6px; padding-top: 6px; letter-spacing: 0.06em; }
        @keyframes terraReceipt { from { opacity: 0; transform: scaleY(0.6) translateY(-8px) } to { opacity: 1; transform: none } }
        .terra-float { position: fixed; z-index: 80; pointer-events: none; font-size: 1.3rem; transform: translate(-50%, -50%); animation: terraFloat 1.25s ease-out forwards; }
        @keyframes terraFloat { from { opacity: 1; transform: translate(-50%, -50%) scale(0.8) } to { opacity: 0; transform: translate(-50%, -190%) scale(1.4) rotate(10deg) } }
        .terra-lanterns { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
        .terra-lantern { position: absolute; width: 38vmin; height: 38vmin; border-radius: 999px; filter: blur(40px); opacity: 0.16; animation: terraDrift linear infinite alternate; will-change: transform; }
        .terra-lantern-0 { left: -8vw; top: 8vh; background: #ffd83d; animation-duration: 52s; }
        .terra-lantern-1 { left: 70vw; top: -6vh; background: #e0485a; animation-duration: 64s; opacity: 0.12; }
        .terra-lantern-2 { left: 30vw; top: 60vh; background: #ffb347; animation-duration: 58s; }
        .terra-lantern-3 { left: 85vw; top: 55vh; background: #ffd83d; animation-duration: 71s; opacity: 0.11; }
        .terra-lantern-4 { left: -4vw; top: 78vh; background: #e0485a; animation-duration: 66s; opacity: 0.1; }
        .terra-lantern-5 { left: 50vw; top: 25vh; background: #caa022; animation-duration: 80s; opacity: 0.08; }
        @keyframes terraDrift { from { transform: translate(0, 0) } to { transform: translate(12vw, -10vh) } }
        @media (prefers-reduced-motion: reduce) { .terra-lantern { animation: none; } .terra-float { animation-duration: 0.01s; } }
        /* 2020 mode: invert the whole page and gold becomes Station blue on warm white. Twelve seconds of nostalgia. */
        html.terra-2020 { filter: invert(1) hue-rotate(180deg); transition: filter 0.6s; }
        html.terra-2020 img, html.terra-2020 canvas { filter: invert(1) hue-rotate(180deg); }
        .terra-tv { position: fixed; inset: 0; z-index: 66; background: #05070f; display: flex; flex-direction: column; font-family: ${TERRA_FONT}; color: #f4f1e8; animation: terraIntroIn 0.3s ease both; }
        .terra-tv-top { display: flex; gap: 22px; align-items: center; padding: 12px 22px; background: #e0485a; color: #fff1e6; font-size: 0.8rem; letter-spacing: 0.08em; }
        .terra-tv-live { font-weight: 800; animation: kwonCaret 1.2s steps(1) infinite; }
        .terra-tv-body { flex: 1; display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; padding: 18px 22px; min-height: 0; }
        .terra-tv-main { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
        .terra-tv-side { border-left: 1px solid rgba(255,216,61,0.2); padding-left: 18px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
        .terra-tv-tag { font-size: 0.62rem; letter-spacing: 0.22em; color: #e0485a; font-weight: 800; }
        .terra-tv-head { font-size: 1.05rem; font-weight: 700; line-height: 1.3; padding: 8px 0; border-bottom: 1px solid rgba(255,216,61,0.12); animation: terraToastIn 0.4s cubic-bezier(0.16,1,0.3,1) both; transform: none !important; }
        .terra-tv-anchor { margin-top: auto; padding: 14px 16px; border: 1px solid rgba(255,216,61,0.25); border-radius: 12px; background: #0b0f1c; display: flex; flex-direction: column; gap: 6px; }
        .terra-tv-crawl { background: #ffd83d; color: #05070f; font-weight: 800; font-size: 0.86rem; letter-spacing: 0.04em; padding: 10px 0; overflow: hidden; white-space: nowrap; }
        .terra-tv-track { display: inline-block; animation: terraWire 70s linear infinite; padding-left: 100%; }
        .terra-tv-hint { text-align: center; font-size: 0.6rem; letter-spacing: 0.2em; color: #6b6555; padding: 8px; text-transform: uppercase; }
        @media (max-width: 800px) { .terra-tv-body { grid-template-columns: 1fr; } .terra-tv-side { border-left: none; padding-left: 0; } }
        .terra-row-flash { animation: terraRowFlash 1.4s ease-out; }
        @keyframes terraRowFlash { 0% { background: rgba(255,216,61,0.28) } 100% { background: transparent } }
        .terra-minimap { position: fixed; left: 16px; bottom: 16px; z-index: 40; background: #0b0f1c; border: 1px solid rgba(255,216,61,0.3); border-radius: 8px; padding: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: ${TERRA_FONT}; }
        .terra-minimap-h { display: flex; justify-content: space-between; font-size: 0.56rem; letter-spacing: 0.18em; color: #e0485a; font-weight: 800; margin-bottom: 4px; }
        .terra-mm-ping { animation: terraPing 2.4s ease-out both; transform-box: fill-box; transform-origin: center; }
        @keyframes terraPing { 0% { transform: scale(0.4); opacity: 1 } 100% { transform: scale(5); opacity: 0 } }
        html.terra-cwal .terra-wire-track { animation-duration: 12s !important; }
        html.terra-cwal .terra-credits-roll { animation-duration: 4s !important; }
        html.terra-cwal .kwon-pose-walk .kwon-leg-l, html.terra-cwal .kwon-pose-walk .kwon-leg-r, html.terra-cwal .kwon-pose-walk .kwon-arm-f, html.terra-cwal .kwon-pose-walk .kwon-arm-b { animation-duration: 0.18s !important; }
        html.terra-cwal .kwon-man { transition-duration: 900ms !important; }
        @media (max-width: 900px) { .terra-minimap { display: none; } }
        /* ── Desktop: 640px of 11px text in a 1500px window left most of the screen empty and the
              numbers hard to read (community feedback 2026-09-12). Wider column, and the whole
              column scaled up so every inline size grows together. Phones are untouched. ── */
        .terra-article { max-width: 640px; }
        @media (min-width: 1100px) { .terra-article { max-width: 760px; zoom: 1.15; } }
        @media (min-width: 1600px) { .terra-article { max-width: 780px; zoom: 1.3; } }
        /* ── Small screens: the swap must fit without scrolling. Every rule here removes something that is not the swap. ── */
        @media (max-width: 640px) {
          .terra-chainpill, .terra-strike, .terra-kbd { display: none !important; }
          /* The pill keeps the money and the pulse; the pair name is in the row below anyway. */
          .terra-arb-pill span:last-child { display: none; }
          .terra-article { padding-top: 0.7rem !important; }
          .terra-hero { margin-top: 0 !important; gap: 8px !important; }
          /* Small enough that the wordmark and the wallet pill share one line on a 375px phone. */
          .terra-hero h1 { font-size: 1.4rem !important; margin-bottom: 0.3rem !important; }
          .terra-hero-right { margin-bottom: 0.3rem !important; }
          .terra-tabs { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; margin-bottom: 8px !important; }
          .terra-tabs::-webkit-scrollbar { display: none; }
          .terra-tabs button { padding: 0.32rem 0.65rem !important; white-space: nowrap; }
          /* Counts are for wide screens; on a phone the five names have to fit. Search stays pinned at the
             right end of the row while the tabs scroll under it, so finding things never needs a swipe first. */
          .terra-tab-count, .terra-search-label, .terra-kbd-hint { display: none; }
          .terra-tabs .terra-search-btn { position: sticky; right: 0; flex: none; background: ${C.void} !important; box-shadow: -14px 0 12px ${C.void}; padding: 0.32rem 0.7rem !important; }
          /* Beyond the swap: two columns of names on a phone, not eight paragraphs to scroll past. */
          .terra-explore { grid-template-columns: 1fr 1fr !important; }
          .terra-explore-body { display: none; }
          .terra-explore-card { padding: 10px 12px !important; }
          .terra-card { padding: 0.75rem 0.8rem !important; }
          .terra-panel-head { margin-bottom: 4px !important; }
          .terra-panel-title { display: none; }   /* the tab already says Swap */
          .terra-pricecompact > div > div:first-child > div { white-space: nowrap; }                  /* the price itself stays on one line */
          .terra-pricecompact > div > div:first-child > div:nth-child(2) { font-size: 1.05rem !important; }
          .terra-pricecompact > div > div:last-child > div:last-child { display: none; }               /* trades · vol lives in the full chart below */
          .terra-label { margin-bottom: 3px !important; }
          .terra-flip-row { margin: -8px 0 2px !important; }
          .terra-flip-row button { width: 28px !important; height: 28px !important; }
        }
        /* Short screens (old iPhones, landscape): the price line goes below with the chart, inputs get tighter. */
        @media (max-height: 620px) and (max-width: 640px) {
          .terra-pricecompact { display: none !important; }
          .terra-card input, .terra-card select { padding: 0.5rem 0.7rem !important; }
          .terra-label { font-size: 0.6rem !important; }
        }
        .terra-connect-cta { display: grid; }
        .terra-connect-cta button { width: 100%; justify-content: center; }
        @media (prefers-reduced-motion: reduce) {
          .terra-intro, .terra-intro-sun, .terra-intro-grid, .terra-intro-word,
          .terra-intro-kicker, .terra-intro-sub, .terra-intro-skip { animation: none; }
        }
      `}</style>
    </>
  )
}

export default function SwapPage() {
  return <SwapPageInner />
}

/**
 * Social card. The page itself is client-rendered; this only feeds _app's
 * server-rendered Head so crawlers get a Terra Swap card instead of Atrium's
 * default Crystal. With ?who=terra1… the image and copy become that person's.
 */
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const base = `https://${ctx.req.headers.host ?? 'localhost:3000'}`
  const q = ctx.query.who
  const who = typeof q === 'string' && /^terra1[0-9a-z]{38,}$/.test(q) ? q : ''
  const short = who ? `${who.slice(0, 9)}…${who.slice(-4)}` : ''
  // A shared swap (SwapPanel's "share link") unfurls as that swap. Only tokens this site names; anything else gets the generic card.
  const known = (v: unknown) => (typeof v === 'string' ? KNOWN_TOKENS.find(t => t.key.toLowerCase() === v.toLowerCase()) : undefined)
  const sf = known(ctx.query.from), st = known(ctx.query.to)
  const sa = typeof ctx.query.amount === 'string' && /^\d{1,12}(\.\d{1,8})?$/.test(ctx.query.amount) && Number(ctx.query.amount) > 0 ? ctx.query.amount : ''
  const share = !LITE && !who && sf && st && sf.key !== st.key
    ? { query: `?from=${encodeURIComponent(sf.key)}&to=${encodeURIComponent(st.key)}${sa ? `&amount=${sa}` : ''}`, title: `Swap ${sa ? `${sa} ` : ''}${sf.label} for ${st.label} on Terra Swap` }
    : null
  return {
    props: {
      og: {
        title: LITE ? 'Terra Pools' : who ? `${short} on Terra Swap` : share ? share.title : 'Terra Swap',
        image: LITE ? `${base}/img/terra-globe-180.png` : `${base}/api/og/swap${who ? `?who=${who}` : share ? share.query : ''}`,
        contract: '', token: '',
        description: LITE
          ? `An unofficial, open-source interface to Astroport's pool contracts on Terra. No fee, no keys, self-hostable. Not affiliated with Astroport.`
          : who
          ? `${short} is written down on the Terra Swap board. A DEX for Terra built in a night for the price of gas. Steady lads.`
          : share
          ? `Opens Terra Swap with this swap filled in. The route is priced across Terra Swap's and Astroport's pools when the page opens. No interface fee.`
          : 'A DEX for Terra, shipped overnight on audited pool code, with every fee handed back to the people who show up. No permission. Not affiliated with Terraswap. Steady lads.',
        url: `${base}/${who ? `?who=${who}` : share ? share.query : ''}`,
        type: 'website',
        // The Terra globe as this page's favicon (terra-money/assets); PNG for Safari/iOS home screen.
        icon: '/img/terra-globe.svg',
        touchIcon: '/img/terra-globe-180.png',
      },
    },
  }
}
