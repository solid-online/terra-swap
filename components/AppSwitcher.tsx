/**
 * Every app in the family, on one line at the top of the page.
 *
 * This used to be an "Openfields ▾" dropdown, which put four of the five apps
 * behind a click and a guess about what the menu held. Showing them costs one
 * line and removes both. Each app is its symbol and its word; the app you are
 * in is marked and is not a link, so the row never navigates to where you
 * already are.
 *
 * Kept deliberately lighter than the page's own tabs: two navigations
 * competing at the same weight are two navigations nobody reads.
 */

import { useLang } from 'lib/i18n'

const trim = (u: string) => u.replace(/\/+$/, '')
export const NFT_URL = trim(process.env.NEXT_PUBLIC_NFT_URL || 'https://nft.openfields.app')
export const GOV_URL = trim(process.env.NEXT_PUBLIC_GOV_URL || 'https://gov.openfields.app')
export const STATUS_URL = trim(process.env.NEXT_PUBLIC_STATUS_URL || 'https://status.openfields.app')
export const STAKE_URL = trim(process.env.NEXT_PUBLIC_STAKE_URL || 'https://stake.openfields.app')
export const DATA_URL = trim(process.env.NEXT_PUBLIC_DATA_URL || 'https://data.openfields.app')
export const SCAN_URL = trim(process.env.NEXT_PUBLIC_SCAN_URL || 'https://scan.openfields.app')
export const DAILY_URL = trim(process.env.NEXT_PUBLIC_DAILY_URL || 'https://daily.openfields.app')
export const HOME_URL = trim(process.env.NEXT_PUBLIC_HOME_URL || 'https://openfields.app')

export default function AppSwitcher() {
  const { t } = useLang()

  const apps = [
    { key: 'swap', word: 'Swap', glyph: '⇅', description: t('Swap tokens, pools, liquidity, transfers'), url: '/', here: true },
    { key: 'nft', word: 'NFT', glyph: '◆', description: t('Collections, items, listings and offers'), url: NFT_URL, here: false },
    { key: 'gov', word: 'Gov', glyph: '§', description: t('Proposals, votes and the community pool'), url: GOV_URL, here: false },
    { key: 'status', word: 'Status', glyph: '●', description: t('Blocks, validators, bridges and endpoints, live'), url: STATUS_URL, here: false },
    { key: 'stake', word: 'Stake', glyph: '⬢', description: t('Stake LUNA, move it, collect rewards'), url: STAKE_URL, here: false },
    { key: 'data', word: 'Data', glyph: '▦', description: t('How the apps on Terra are actually used'), url: DATA_URL, here: false },
    { key: 'scan', word: 'Scan', glyph: '⌕', description: t('Transactions, addresses and blocks, in plain words'), url: SCAN_URL, here: false },
    { key: 'daily', word: 'Daily', glyph: '◷', description: t('A daily move, a calm minute and five Terra questions'), url: DAILY_URL, here: false },
  ]

  return (
    <nav className='tl-eco' aria-label={t('Openfields apps')}>
      {apps.map(a => (a.here ? (
        <span key={a.key} className='tl-eco-item is-here' aria-current='page'>
          <span className='tl-eco-glyph' aria-hidden>{a.glyph}</span>
          {a.word}
        </span>
      ) : (
        <a key={a.key} className='tl-eco-item' href={a.url} title={a.description}>
          <span className='tl-eco-glyph' aria-hidden>{a.glyph}</span>
          {a.word}
        </a>
      )))}
      <a className='tl-eco-home' href={HOME_URL}>{t('All apps')}</a>
    </nav>
  )
}
