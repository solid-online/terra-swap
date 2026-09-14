/**
 * Search everything the site does: ⌘K (Ctrl+K), or the Search button beside
 * the tabs. Sections and pages, the things people miss (bringing money in from
 * another chain, liquid staking against the hubs, closing a gap), every token
 * to buy or sell, and every pool with liquidity. Typing filters on the label,
 * the description and a few extra words each item answers to; arrows and Enter
 * pick. The site does a lot, and most of it was only findable by accident.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { TEXT } from 'components/tokens'

export interface PaletteItem {
  id: string
  group: string
  label: string
  hint?: string
  /** other words it answers to */
  keywords?: string
  icon?: React.ReactNode
  run: () => void
}

const TERRA_FONT = "'Montserrat', 'Space Grotesk', 'Inter', system-ui, sans-serif"
const C = {
  surface: '#0b0f1c', surfaceElev: '#111729', divider: 'rgba(255,216,61,0.13)', goldCore: '#caa022', goldLit: '#ffd83d',
  textPrimary: '#f4f1e8', textSecondary: '#d6cfbd', textMuted: '#9a927f', textWhisper: '#6b6555',
} as const

/** Shown before anything is typed, in this order. Tokens and pools wait for a query: there are too many. */
const RESTING = ['Do', 'Go to', 'Pages']
/**
 * When groups match equally well, the one more likely wanted comes first: typing "luna" means buying or
 * selling LUNA before it means one of the thirty pools holding it. Pools are capped so a common token
 * cannot push everything else out of the list.
 */
const PRIORITY: Record<string, number> = { 'Do': 3, 'Go to': 3, 'Pages': 2, 'Tokens': 2, 'Pools': 0 }
const CAP: Record<string, number> = { 'Tokens': 8, 'Pools': 8 }

function score(item: PaletteItem, words: string[]): number {
  const label = item.label.toLowerCase()
  const parts = label.split(/[\s/·]+/)
  const hay = `${label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  let s = 0
  for (const w of words) {
    if (!hay.includes(w)) return 0
    s += parts.includes(w) ? 5 : label.startsWith(w) ? 4 : parts.some(part => part.startsWith(w)) ? 3 : label.includes(w) ? 2 : 1
  }
  return s
}

export default function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      return items.filter(i => RESTING.includes(i.group)).sort((a, b) => RESTING.indexOf(a.group) - RESTING.indexOf(b.group))
    }
    // Best match first, and each group kept together so its heading appears once.
    const hits = items.map(i => ({ i, s: score(i, words) })).filter(x => x.s > 0)
    const best = new Map<string, number>()
    for (const h of hits) best.set(h.i.group, Math.max(best.get(h.i.group) ?? 0, h.s + (PRIORITY[h.i.group] ?? 1)))
    const shown = new Map<string, number>()
    return hits
      .sort((a, b) => (best.get(b.i.group)! - best.get(a.i.group)!) || a.i.group.localeCompare(b.i.group) || b.s - a.s)
      .filter(x => {
        const n = (shown.get(x.i.group) ?? 0) + 1
        shown.set(x.i.group, n)
        return n <= (CAP[x.i.group] ?? Infinity)
      })
      .slice(0, 40)
      .map(x => x.i)
  }, [items, q])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (item: PaletteItem) => { onClose(); item.run() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, list.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]) }
  }

  return (
    <div role='dialog' aria-modal='true' aria-label='Search everything' onKeyDown={onKey} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3,5,12,0.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 12px 12px' }}>
      <div style={{ width: 'min(560px, 100%)', maxHeight: 'min(640px, 80vh)', display: 'flex', flexDirection: 'column', background: C.surfaceElev, border: `1px solid ${C.divider}`, borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', overflow: 'hidden', fontFamily: TERRA_FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${C.divider}` }}>
          <span aria-hidden style={{ color: C.goldLit, fontSize: '1.1rem', lineHeight: 1 }}>⌕</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} aria-label='Search'
            placeholder='A token, a pool, or what you want to do'
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: C.textPrimary, fontSize: TEXT.md.size, fontFamily: 'inherit' }}
            spellCheck={false} autoComplete='off' />
          <button type='button' onClick={onClose} aria-label='Close' style={{ background: 'transparent', border: `1px solid ${C.divider}`, borderRadius: 8, color: C.textMuted, fontSize: TEXT.xs.size, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>esc</button>
        </div>
        <div ref={listRef} role='listbox' style={{ overflowY: 'auto', padding: 6 }}>
          {list.length === 0 && (
            <div style={{ padding: 12, fontSize: TEXT.xs.size, color: C.textMuted, lineHeight: 1.6 }}>
              Nothing matches that. Try a token such as LUNA or SOLID, or a word such as bridge, pool, stake or history.
            </div>
          )}
          {list.map((item, idx) => (
            <div key={item.id}>
              {(idx === 0 || list[idx - 1].group !== item.group) && (
                <div style={{ fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textWhisper, padding: '10px 10px 4px' }}>{item.group}</div>
              )}
              <div data-row={idx} role='option' aria-selected={idx === active} onMouseEnter={() => setActive(idx)} onClick={() => pick(item)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: idx === active ? C.surface : 'transparent', border: `1px solid ${idx === active ? C.divider : 'transparent'}` }}>
                <span aria-hidden style={{ width: 26, display: 'inline-flex', justifyContent: 'center', flex: 'none', fontSize: '1rem' }}>{item.icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: C.textPrimary, fontSize: TEXT.sm.size, fontWeight: 600 }}>{item.label}</div>
                  {item.hint && <div style={{ color: C.textMuted, fontSize: TEXT.xs.size, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.hint}</div>}
                </div>
                {idx === active && <span aria-hidden style={{ color: C.goldLit, fontSize: TEXT.xs.size }}>↵</span>}
              </div>
            </div>
          ))}
        </div>
        {!q && (
          <div style={{ fontSize: TEXT.xs.size, color: C.textWhisper, padding: '8px 14px', borderTop: `1px solid ${C.divider}`, lineHeight: 1.5 }}>
            Type a token to buy or sell it, or a pool to jump to it. ↑ ↓ to move, Enter to open.
          </div>
        )}
      </div>
    </div>
  )
}
