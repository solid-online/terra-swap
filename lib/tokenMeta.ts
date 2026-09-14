/**
 * What each listed token is and where it came from, for the token picker.
 *
 * Read from the chain on 2026-09-14: cw20 names from each token's token_info,
 * and for IBC tokens the denom trace plus the chain id behind the channel it
 * arrived on. The installed chain registry knows fewer than half of these, so
 * they are written down here instead. `tags` are the words people type when
 * they do not know the ticker: "bitcoin", "gold", "euro", "staked".
 */

export interface TokenMeta {
  name: string
  /** the chain it comes from, and how */
  origin: string
  tags: string[]
}

export const TOKEN_META: Record<string, TokenMeta> = {
  SOLID: { name: 'Solid', origin: 'Terra, cw20', tags: ['solid'] },
  LUNA: { name: 'Terra', origin: 'Terra, native', tags: ['terra', 'luna', 'native', 'gas'] },
  USDC: { name: 'USD Coin', origin: 'Noble', tags: ['usd', 'dollar', 'stable', 'circle', 'noble'] },
  CAPA: { name: 'Capapult governance token', origin: 'Terra, cw20', tags: ['capapult'] },
  ROAR: { name: 'Lion DAO', origin: 'Terra, cw20', tags: ['lion', 'dao'] },
  'wBTC.atom': { name: 'Wrapped Bitcoin', origin: 'Ethereum, over IBC Eureka via the Cosmos Hub', tags: ['btc', 'bitcoin', 'wbtc', 'ethereum', 'eureka'] },
  PAXG: { name: 'Pax Gold', origin: 'Ethereum, over IBC Eureka via the Cosmos Hub', tags: ['gold', 'xau', 'paxos', 'ethereum', 'eureka'] },
  'USDC.inj': { name: 'USD Coin', origin: 'Injective', tags: ['usd', 'dollar', 'stable', 'circle', 'injective'] },
  ampLUNA: { name: 'ERIS Amplified LUNA', origin: 'Terra, liquid staking', tags: ['eris', 'staked', 'lst', 'liquid', 'luna'] },
  arbLUNA: { name: 'ERIS Arbitrage LUNA', origin: 'Terra, vault', tags: ['eris', 'arbitrage', 'vault', 'luna'] },
  EURe: { name: 'Monerium EURe', origin: 'Noble', tags: ['eur', 'euro', 'stable', 'monerium', 'noble'] },
  USDT: { name: 'Tether USDt', origin: 'Kava', tags: ['usd', 'dollar', 'stable', 'tether', 'kava'] },
  ATOM: { name: 'Cosmos Hub', origin: 'Cosmos Hub', tags: ['cosmos', 'hub', 'atom'] },
  'ASTRO.cw20': { name: 'Astroport, original cw20', origin: 'Terra, cw20', tags: ['astroport', 'old'] },
  ASTRO: { name: 'Astroport', origin: 'Neutron', tags: ['astroport', 'neutron'] },
  bLUNA: { name: 'BackBone boneLuna', origin: 'Terra, liquid staking', tags: ['backbone', 'bone', 'staked', 'lst', 'liquid', 'luna'] },
  LunaX: { name: 'Stader LunaX', origin: 'Terra, liquid staking', tags: ['stader', 'staked', 'lst', 'liquid', 'luna'] },
  stLUNA: { name: 'Stride staked LUNA', origin: 'Stride', tags: ['stride', 'staked', 'lst', 'liquid', 'luna'] },
  stATOM: { name: 'Stride staked ATOM', origin: 'Stride', tags: ['stride', 'staked', 'lst', 'liquid', 'atom', 'cosmos'] },
  dATOM: { name: 'Drop staked ATOM', origin: 'Neutron', tags: ['drop', 'staked', 'lst', 'liquid', 'atom', 'cosmos', 'neutron'] },
  INJ: { name: 'Injective', origin: 'Injective', tags: ['injective'] },
  ampROAR: { name: 'ERIS Amplified ROAR', origin: 'Terra, liquid staking', tags: ['eris', 'lion', 'staked', 'roar'] },
  FUEL: { name: 'FUEL', origin: 'Neutron', tags: ['neutron'] },
  VKR: { name: 'Valkyrie', origin: 'Terra, cw20', tags: ['valkyrie'] },
  'USDT.axl': { name: 'Tether USDt', origin: 'Axelar', tags: ['usd', 'dollar', 'stable', 'tether', 'axelar'] },
}

const FILLER = new Set(['from', 'on', 'via', 'the', 'a', 'token', 'coin'])

/**
 * How well a token matches what was typed, 0 for no match. Every word has to
 * match something: the exact address or denom, the ticker, the name, a tag,
 * or the origin chain, in that order of weight. A ticker typed with a letter
 * missing ("amplna") still finds it.
 */
export function tokenScore(t: { key: string; label: string; id: string }, query: string): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(w => w && !FILLER.has(w))
  if (words.length === 0) return 1
  const meta = TOKEN_META[t.key] ?? TOKEN_META[t.label]
  const id = t.id.toLowerCase(), label = t.label.toLowerCase()
  const name = meta?.name.toLowerCase() ?? '', origin = meta?.origin.toLowerCase() ?? ''
  let total = 0
  for (const w of words) {
    let s = 0
    if (id === w) s = 100
    else if (label === w) s = 90
    else if (label.startsWith(w)) s = 80
    else if (name.split(/[\s,]+/).some(p => p.startsWith(w))) s = 70
    else if (meta?.tags.some(g => g.startsWith(w))) s = 60
    else if (label.includes(w) || name.includes(w)) s = 50
    else if (origin.includes(w)) s = 40
    else if (w.length >= 6 && id.includes(w)) s = 30
    else {
      let i = 0
      for (const ch of label) if (ch === w[i]) i++
      if (i === w.length && w.length >= 3) s = 20
    }
    if (s === 0) return 0
    total += s
  }
  return total / words.length
}
