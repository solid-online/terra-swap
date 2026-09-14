/**
 * Liquid staking tokens against their hubs.
 *
 * ampLUNA (ERIS) and bLUNA (Backbone) are minted and redeemed by a hub at an
 * exchange rate, and the pools trade them at whatever the last trade left.
 * For a $100 and a $5,000 trade this prices both directions through the best
 * route on either site, pool fees included, and sets each beside the hub:
 * selling against redeeming at the rate (paid after unbonding), buying against
 * minting at the rate (instant). The same comparison the swap panel makes for
 * one trade (HubAlternative), for everyone at once. Today's prices only;
 * nothing here says what a token will be worth later.
 */

import { assetId, toMicro, type KnownToken, type PoolView } from 'lib/dex'
import { LST_HUBS, hubInfo } from 'lib/lst'
import { planTrade, quoteBest, tradeText } from 'lib/route'

export interface LstSide {
  /** what goes in, display units, for a link that opens the swap */
  amount: string
  /** selling: LUNA per token. buying: tokens per LUNA. Through the route, pool fees included. */
  rate: number
  /** against the hub: redeeming when selling, minting when buying, % */
  vsHubPct: number
  route: string
}

export interface LstSize {
  usd: number
  sell: LstSide | null
  buy: LstSide | null
}

export interface LstRow {
  key: string
  provider: string
  token: string
  hub: string
  /** LUNA per token at the hub */
  rate: number
  unbondDays: number
  epochDays: number
  sizes: LstSize[]
}

const SIZES_USD = [100, 5000]
const SLIP = 0.01

export async function lstBoard(pools: PoolView[], px: Record<string, number>): Promise<LstRow[]> {
  const tokens = new Map<string, KnownToken>()
  for (const p of pools) for (const t of p.tokens) tokens.set(assetId(t.info), t)
  const luna = tokens.get('uluna')
  const rows = await Promise.all(LST_HUBS.map(async (h): Promise<LstRow | null> => {
    const token = tokens.get(h.token)
    const info = await hubInfo(h).catch(() => null)
    if (!token || !luna || !info) return null
    const side = async (from: KnownToken, to: KnownToken, usd: number, vsHub: (rate: number) => number): Promise<LstSide | null> => {
      const price = px[assetId(from.info)]
      if (!(price > 0)) return null
      const units = (usd / price).toFixed(Math.min(from.decimals, 6))
      const micro = toMicro(units, from.decimals)
      if (!micro || micro === '0') return null
      const q = await quoteBest(pools, from, to, micro, undefined, { slip: SLIP, split: true })
      if (!q.best) return null
      const trade = planTrade(q.split ?? [{ quote: q.best, share: 1 }], SLIP)
      const rate = (Number(trade.expectedOut) / 10 ** to.decimals) / (Number(micro) / 10 ** from.decimals)
      return { amount: units, rate, vsHubPct: vsHub(rate), route: tradeText(trade.parts) }
    }
    // Sizes one after the other: every quote is a dozen simulations, and public endpoints refuse a burst of them.
    const sizes: LstSize[] = []
    for (const usd of SIZES_USD) {
      const [sell, buy] = await Promise.all([
        side(token, luna, usd, r => (r / info.rate - 1) * 100),
        side(luna, token, usd, r => (r * info.rate - 1) * 100),
      ])
      sizes.push({ usd, sell, buy })
    }
    return { key: h.key, provider: h.provider, token: h.token, hub: h.hub, rate: info.rate, unbondDays: info.unbondDays, epochDays: info.epochDays, sizes }
  }))
  return rows.filter((r): r is LstRow => r !== null)
}
