/**
 * "TerraLuna ▾" in the kicker line: the other TerraLuna apps one click away,
 * and terraluna.app with all of them. The same menu Terra NFT shows, so the
 * apps read as one family. Deliberately small; the tabs do the navigating.
 */

import { useEffect, useRef, useState } from 'react'
import { useLang } from 'lib/i18n'

const trim = (u: string) => u.replace(/\/+$/, '')
export const NFT_URL = trim(process.env.NEXT_PUBLIC_NFT_URL || 'https://nft.terraluna.app')
export const GOV_URL = trim(process.env.NEXT_PUBLIC_GOV_URL || 'https://gov.terraluna.app')
export const STATUS_URL = trim(process.env.NEXT_PUBLIC_STATUS_URL || 'https://status.terraluna.app')
export const HOME_URL = trim(process.env.NEXT_PUBLIC_HOME_URL || 'https://terraluna.app')

const FONT = "'Montserrat', 'Space Grotesk', 'Inter', system-ui, sans-serif"

const CSS = `
.tls { position: relative; display: inline-flex; }
.tls-trigger { background: transparent; border: none; padding: 0.2rem 0; margin: 0; cursor: pointer; font: inherit; color: inherit;
  letter-spacing: inherit; text-transform: inherit; display: inline-flex; align-items: center; gap: 0.35rem; }
.tls-trigger:hover { color: #ffd83d; }
.tls-chevron { width: 0.85em; height: 0.85em; flex: none; transition: transform 160ms; }
.tls-trigger[aria-expanded='true'] .tls-chevron { transform: rotate(180deg); }
.tls-menu { position: absolute; left: 0; top: calc(100% + 0.5rem); z-index: 90; width: min(88vw, 20rem); padding: 0.45rem;
  background: #111729; border: 1px solid rgba(255,216,61,0.28); border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
  animation: tlsPop 180ms cubic-bezier(0.16,1,0.3,1) both; letter-spacing: normal; text-transform: none;
  font-family: ${FONT}; font-size: 1rem; font-weight: 400; color: #f4f1e8; }
.tls-heading { padding: 0.45rem 0.6rem 0.35rem; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: #9a927f; }
.tls-item { display: grid; grid-template-columns: 1.6rem 1fr auto; align-items: center; gap: 0.6rem; padding: 0.6rem; border-radius: 10px;
  text-decoration: none; color: #f4f1e8; }
.tls-item:hover { background: #0b0f1c; }
.tls-item[aria-current='true'] { background: rgba(255,216,61,0.06); }
.tls-item b { display: block; font-size: 0.86rem; font-weight: 700; }
.tls-desc { display: block; font-size: 0.72rem; color: #9a927f; margin-top: 1px; }
.tls-here { font-size: 0.6rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #ffd83d; }
.tls-arrow { color: #6b6555; }
.tls-glyph { width: 1.6rem; height: 1.6rem; border-radius: 8px; display: grid; place-items: center; background: #0b0f1c;
  border: 1px solid rgba(255,216,61,0.13); color: #ffd83d; font-size: 0.85rem; font-weight: 700; }
.tls-foot { display: block; margin-top: 0.3rem; padding: 0.6rem 0.6rem 0.4rem; border-top: 1px solid rgba(255,216,61,0.13);
  font-size: 0.72rem; color: #9a927f; text-decoration: none; }
.tls-foot:hover { color: #ffd83d; }
.tls-trigger:focus-visible, .tls-item:focus-visible, .tls-foot:focus-visible { outline: 2px solid #ffd83d; outline-offset: 2px; border-radius: 6px; }
@keyframes tlsPop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tls-menu { animation: none; } .tls-chevron { transition: none; } }
`

export default function AppSwitcher() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const apps = [
    { key: 'swap', word: 'Swap', glyph: '⇅', description: t('Swap tokens, pools, liquidity, transfers'), url: '/', here: true },
    { key: 'nft', word: 'NFT', glyph: '◆', description: t('Collections, items, listings and offers'), url: NFT_URL, here: false },
    { key: 'gov', word: 'Gov', glyph: '§', description: t('Proposals, votes and the community pool'), url: GOV_URL, here: false },
    { key: 'status', word: 'Status', glyph: '●', description: t('Blocks, validators, bridges and endpoints, live'), url: STATUS_URL, here: false },
  ]

  return (
    <div className='tls' ref={root}>
      <style>{CSS}</style>
      <button type='button' className='tls-trigger' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(o => !o)}>
        TerraLuna
        <svg className='tls-chevron' viewBox='0 0 12 12' aria-hidden fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M3 4.5 6 7.5 9 4.5' />
        </svg>
      </button>
      {open && (
        <div className='tls-menu' role='menu'>
          <div className='tls-heading'>{t('TerraLuna apps')}</div>
          {apps.map(a => (
            <a key={a.key} role='menuitem' className='tls-item' href={a.url} aria-current={a.here ? 'true' : undefined}
              onClick={e => { if (a.here) e.preventDefault(); setOpen(false) }}>
              <span className='tls-glyph' aria-hidden>{a.glyph}</span>
              <span style={{ minWidth: 0 }}>
                <b>Terra {a.word}</b>
                <span className='tls-desc'>{a.description}</span>
              </span>
              {a.here ? <span className='tls-here'>{t('here')}</span> : <span aria-hidden className='tls-arrow'>↗</span>}
            </a>
          ))}
          <a role='menuitem' className='tls-foot' href={HOME_URL} onClick={() => setOpen(false)}>
            {t('All apps at terraluna.app')} <span aria-hidden>↗</span>
          </a>
        </div>
      )}
    </div>
  )
}
