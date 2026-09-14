/**
 * Liquid staking tokens can be redeemed at their hub, not only sold in a pool.
 *
 * ampLUNA (ERIS) and bLUNA (Backbone) are minted by a hub contract at an
 * exchange rate that only rises as staking rewards come in, and pools drift
 * from it: on 2026-09-14 ampLUNA traded 0.78% under ERIS's rate and bLUNA 0.74%
 * under Backbone's. Selling in a pool is instant. Queueing the tokens at the
 * hub pays the full rate after the chain's 21-day unbonding plus up to one
 * 3-day batch window. Minting at the hub is instant, and beats buying in the
 * pool whenever the pool trades above the rate.
 *
 * Both hubs are Steak-style contracts, checked by simulation on 2026-09-14:
 * `bond {}` with LUNA, a cw20 send with `{queue_unbond: {}}`, and
 * `withdraw_unbonded {}`. Finished batches report `uluna_unclaimed` on ERIS
 * and `amount_unclaimed` on Backbone; that is the only difference used here.
 */

import { AMPLUNA_CW20, BLUNA_CW20, smart } from 'lib/dex'

export interface LstHub {
  /** the token's key in KNOWN_TOKENS */
  key: 'ampLUNA' | 'bLUNA'
  token: string
  hub: string
  /** who runs the hub, for labels */
  provider: string
}

export const LST_HUBS: LstHub[] = [
  { key: 'ampLUNA', token: AMPLUNA_CW20, hub: 'terra10788fkzah89xrdm27zkj5yvhj9x3494lxawzm5qq3vvxcqz2yzaqyd3enk', provider: 'ERIS' },
  { key: 'bLUNA', token: BLUNA_CW20, hub: 'terra1l2nd99yze5fszmhl5svyh5fky9wm4nz4etlgnztfu4e8809gd52q04n3ea', provider: 'Backbone' },
]

export const hubForToken = (tokenAddr: string) => LST_HUBS.find(h => h.token === tokenAddr) ?? null

export interface HubInfo {
  /** LUNA per token */
  rate: number
  unbondDays: number
  epochDays: number
}

const infoCache = new Map<string, { at: number; v: HubInfo }>()
export async function hubInfo(h: LstHub): Promise<HubInfo | null> {
  const hit = infoCache.get(h.hub)
  if (hit && Date.now() - hit.at < 60_000) return hit.v
  const [state, config] = await Promise.all([
    smart<{ exchange_rate?: string }>(h.hub, { state: {} }),
    smart<{ unbond_period?: number; epoch_period?: number }>(h.hub, { config: {} }),
  ])
  const rate = Number(state?.exchange_rate)
  if (!(rate > 0)) return null
  const v = { rate, unbondDays: (config?.unbond_period ?? 1_814_400) / 86_400, epochDays: (config?.epoch_period ?? 259_200) / 86_400 }
  infoCache.set(h.hub, { at: Date.now(), v })
  return v
}

export interface UnstakeRequest {
  batch: number
  /** tokens queued, smallest units */
  shares: string
  /** LUNA it is worth, smallest units: the batch's figure, or today's rate while the batch is still open */
  lunaMicro: string
  /** queued: waiting for the next batch. unbonding: in the chain's unbonding, or waiting for the hub to settle. ready: can be withdrawn */
  status: 'queued' | 'unbonding' | 'ready'
  /** unix seconds from which it should be withdrawable */
  readyAt: number | null
}

export interface Unstaking {
  key: LstHub['key']
  hub: string
  provider: string
  requests: UnstakeRequest[]
  /** LUNA withdrawable now, smallest units */
  readyMicro: string
}

interface Batch {
  id: number
  reconciled: boolean
  total_shares: string
  uluna_unclaimed?: string
  amount_unclaimed?: string
  est_unbond_end_time: number
}

/** A wallet's redemptions in progress at every hub it has used. */
export async function readUnstaking(user: string): Promise<Unstaking[]> {
  const out: Unstaking[] = []
  const now = Date.now() / 1000
  for (const h of LST_HUBS) {
    const reqs = await smart<{ id: number; shares: string }[]>(h.hub, { unbond_requests_by_user: { user } })
    if (!Array.isArray(reqs) || reqs.length === 0) continue
    const [pending, info] = await Promise.all([
      smart<{ id: number; est_unbond_start_time: number }>(h.hub, { pending_batch: {} }),
      hubInfo(h),
    ])
    const unbondSecs = (info?.unbondDays ?? 21) * 86_400
    let ready = BigInt(0)
    const requests: UnstakeRequest[] = []
    for (const r of reqs) {
      if (pending && r.id === pending.id) {
        const luna = info ? Math.floor(Number(r.shares) * info.rate) : 0
        requests.push({ batch: r.id, shares: r.shares, lunaMicro: String(luna), status: 'queued', readyAt: pending.est_unbond_start_time + unbondSecs })
        continue
      }
      const b = await smart<Batch>(h.hub, { previous_batch: r.id })
      if (!b) continue
      const unclaimed = BigInt(b.uluna_unclaimed ?? b.amount_unclaimed ?? '0')
      const total = BigInt(b.total_shares || '0')
      const luna = total > BigInt(0) ? (BigInt(r.shares) * unclaimed) / total : BigInt(0)
      const isReady = b.reconciled && now >= b.est_unbond_end_time
      if (isReady) ready += luna
      requests.push({ batch: r.id, shares: r.shares, lunaMicro: luna.toString(), status: isReady ? 'ready' : 'unbonding', readyAt: b.est_unbond_end_time })
    }
    out.push({ key: h.key, hub: h.hub, provider: h.provider, requests, readyMicro: ready.toString() })
  }
  return out
}
