/**
 * Token marks, shared by the swap page and the token and pool pages.
 *
 * Self-hosted so the CSP never has to trust a third-party image host, and so a
 * visitor's browser never asks one. LUNA is terra-money/assets; USDC, wBTC,
 * PAXG, ROAR, ampLUNA, arbLUNA, EURe, USDT, ATOM and both ASTROs come from the
 * Cosmos chain registry; SOLID and CAPA are our own marks, cropped square.
 */

const SURFACE = '#0b0f1c', SURFACE_ELEV = '#111729', DIVIDER = 'rgba(255,216,61,0.13)', MUTED = '#9a927f'

export const TOKEN_ICONS: Record<string, string> = {
  LUNA: '/img/tokens/luna.svg', USDC: '/img/tokens/usdc.svg', SOLID: '/img/tokens/solid.svg', CAPA: '/img/tokens/capa.svg',
  ROAR: '/img/tokens/roar.png', 'wBTC.atom': '/img/tokens/wbtc.svg', PAXG: '/img/tokens/paxg.svg',
  // Same issuer, same mark. The label is what tells it apart from Noble USDC.
  'USDC.inj': '/img/tokens/usdc.svg',
  ampLUNA: '/img/tokens/ampluna.svg', arbLUNA: '/img/tokens/arbluna.svg', EURe: '/img/tokens/eure.svg',
  USDT: '/img/tokens/usdt.svg', ATOM: '/img/tokens/atom.svg',
  // Two ASTROs on Terra: the original cw20 and the IBC one from Neutron that Astroport pays in now.
  'ASTRO.cw20': '/img/tokens/astro-cw20.svg', ASTRO: '/img/tokens/astro.png',
  bLUNA: '/img/tokens/bluna.png', ampROAR: '/img/tokens/amproar.png', stLUNA: '/img/tokens/stluna.svg',
  stATOM: '/img/tokens/statom.svg', dATOM: '/img/tokens/datom.svg', INJ: '/img/tokens/inj.svg', FUEL: '/img/tokens/fuel.png',
  'USDT.axl': '/img/tokens/usdt.svg',
  // LunaX and VKR have no mark in the chain registry; they get the lettered coin.
}

export function TokenIcon({ label, size = 20, style }: { label: string; size?: number; style?: React.CSSProperties }) {
  const src = TOKEN_ICONS[label]
  const base: React.CSSProperties = { width: size, height: size, borderRadius: '50%', flex: 'none', ...style }
  if (!src) {
    // A token we have no mark for (someone's own pool): a lettered coin, never a broken image.
    return (
      <span aria-hidden style={{ ...base, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: SURFACE_ELEV, border: `1px solid ${DIVIDER}`, color: MUTED, fontSize: size * 0.5, fontWeight: 700, lineHeight: 1 }}>
        {label.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return <img src={src} alt='' aria-hidden width={size} height={size} draggable={false} style={base} />
}

/** Two coins, the second tucked behind the first: the pair at a glance. */
export function PairIcons({ a, b, size = 22 }: { a: string; b: string; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flex: 'none', marginRight: 9 }}>
      <TokenIcon label={a} size={size} style={{ position: 'relative', zIndex: 1, boxShadow: `0 0 0 2px ${SURFACE}` }} />
      <TokenIcon label={b} size={size} style={{ marginLeft: -size * 0.32 }} />
    </span>
  )
}
