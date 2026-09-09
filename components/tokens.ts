/**
 * Design tokens (spacing, radius, type scale).
 *
 * Apple HIG discipline meets cathedral aesthetic:
 *   • 8pt grid for spacing — never magic-numbers
 *   • 5-step type ramp — deliberate scale
 *   • Color is accent, NOT decoration (90% monochrome cosmic, 10% ember/gold)
 *   • Spring easing on interactions (cubic-bezier(0.34, 1.56, 0.64, 1))
 *   • Touch targets ≥48px (mobile-first — operator views on iPhone)
 *
 * All tokens flow into TS (used inline in styled components) and CSS vars
 * (for global access in :root). Single source of truth.
 */

export const COLOR = {
  // Cosmic substrate
  void:           '#05030a',
  surface:        '#0f0a18',
  surfaceElev:    '#171021',
  surfaceHover:   '#1c1428',

  // Borders
  divider:        'rgba(255, 219, 138, 0.08)',
  dividerStrong:  'rgba(255, 219, 138, 0.16)',
  dividerWarm:    'rgba(255, 138, 60, 0.22)',

  // Accents (used sparingly — active states + key CTAs)
  emberLit:       '#ff8a3c',
  emberSoft:      'rgba(255, 138, 60, 0.12)',
  goldCore:       '#e8a850',
  goldLit:        '#ffdb8a',
  goldSoft:       'rgba(232, 168, 80, 0.10)',

  // Type
  textPrimary:    '#f5ede0',
  textSecondary:  '#b5a898',
  textMuted:      '#7a6d5e',
  textWhisper:    '#5a5145',

  // Semantic (sparingly)
  success:        '#62ffd0',
  successSoft:    'rgba(98, 255, 208, 0.10)',
  alert:          '#ff6b6b',
  alertSoft:      'rgba(255, 107, 107, 0.10)',
} as const

export const SPACE = {
  '0_5': 2,
  '1':   4,
  '2':   8,
  '3':   12,
  '4':   16,
  '5':   20,
  '6':   24,
  '8':   32,
  '10':  40,
  '12':  48,
  '16':  64,
  '20':  80,
} as const

export const RADIUS = {
  sm:    8,
  md:    12,
  lg:    16,
  xl:    20,
  pill:  999,
} as const

/** Apple-inspired type ramp using Cinzel for display + system-stack for body.
 *  Sizes follow ~1.25 scale. Line-heights tighten as text grows. */
export const TYPE = {
  display: "'Cinzel', 'Times New Roman', serif",
  body: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro', 'Segoe UI', system-ui, sans-serif",
  mono: "'SF Mono', 'JetBrains Mono', 'Courier New', monospace",
} as const

export const TEXT = {
  xs:   { size: '11px', lh: 1.4,  weight: 500, tracking: '0.02em' },
  sm:   { size: '13px', lh: 1.45, weight: 500, tracking: '0.01em' },
  base: { size: '15px', lh: 1.55, weight: 400, tracking: '0' },
  md:   { size: '17px', lh: 1.4,  weight: 600, tracking: '-0.01em' },
  lg:   { size: '22px', lh: 1.3,  weight: 700, tracking: '-0.015em' },
  xl:   { size: '28px', lh: 1.2,  weight: 700, tracking: '-0.02em' },
  display: { size: 'clamp(1.8rem, 4vw, 2.8rem)', lh: 1.1, weight: 700, tracking: '0.04em' },
  caption: { size: '10.5px', lh: 1.4, weight: 700, tracking: '0.18em' },
} as const

export const MOTION = {
  durFast: '150ms',
  durBase: '250ms',
  durSlow: '400ms',
  durLong: '600ms',
  easeSpring:  'cubic-bezier(0.34, 1.56, 0.64, 1)',
  easeOut:     'cubic-bezier(0.16, 1, 0.3, 1)',
  easeInOut:   'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

export const SHADOW = {
  card:        '0 4px 24px rgba(0, 0, 0, 0.4)',
  cardHover:   '0 8px 32px rgba(0, 0, 0, 0.5)',
  glowEmber:   '0 0 24px rgba(255, 138, 60, 0.18)',
  glowGold:    '0 0 24px rgba(232, 168, 80, 0.14)',
  glowAlert:   '0 0 16px rgba(255, 107, 107, 0.20)',
} as const

export const TOUCH_MIN = 48 // px — Apple HIG min for iOS targets

/** CSS for a subtle frosted-glass-on-dark effect used for sticky tab-bar. */
export const FROST_DARK = {
  background: 'rgba(15, 10, 24, 0.78)',
  backdropFilter: 'blur(18px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
}
