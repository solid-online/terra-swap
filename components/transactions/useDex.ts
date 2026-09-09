/**
 * Terra Swap transaction hooks.
 *
 * All of these talk to Astroport's own xyk pair contract (code 392) and the
 * factory. The message shapes are Astroport's. There is no interface fee:
 * the only fee is the pool's (30 bps, all to LPs), and it cannot be bypassed.
 *
 * Each hook assembles its own EncodeObjects and broadcasts with a two-layer
 * region gate and a `code !== 0` check (signAndBroadcast does not throw on
 * revert).
 */

import { useCallback } from 'react'
import { useMutation } from 'react-query'
import type { EncodeObject } from '@cosmjs/proto-signing'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { toUtf8 } from '@cosmjs/encoding'
import { useWallet } from 'components/providers/WalletProvider'
import { useTxRegionGate, RegionRestricted } from 'components/RegionGate'
import {
  DEX_FACTORY,
  type AssetInfo, type Asset,
} from 'lib/dex'

const MEMO = 'Terra Swap'

function b64(o: object): string {
  return typeof window !== 'undefined'
    ? btoa(JSON.stringify(o))
    : Buffer.from(JSON.stringify(o)).toString('base64')
}

type Coin = { denom: string; amount: string }

/**
 * The SDK rejects `funds` unless the coins are sorted by denom, byte order
 * (`ibc/…` sorts before `uluna`). A LUNA/USDC provide in pair order failed
 * with "denomination … is not sorted" (2026-09-09, reported by a user). Sort
 * here, once, so no caller can get it wrong.
 */
function exec(sender: string, contract: string, msg: object, funds: Coin[] = []): EncodeObject {
  const sorted = [...funds].sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0))
  return {
    typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    value: MsgExecuteContract.fromPartial({ sender, contract, msg: toUtf8(JSON.stringify(msg)), funds: sorted }),
  }
}

function bankSend(from: string, to: string, coin: Coin): EncodeObject {
  return {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: MsgSend.fromPartial({ fromAddress: from, toAddress: to, amount: [coin] }),
  }
}

/** Move `amount` of `info` from signer to `to`. Native → bank send, cw20 → transfer. */
function transferMsg(sender: string, info: AssetInfo, amount: string, to: string): EncodeObject | null {
  if (amount === '0') return null
  if ('token' in info) return exec(sender, info.token.contract_addr, { transfer: { recipient: to, amount } })
  return bankSend(sender, to, { denom: info.native_token.denom, amount })
}

/** Shared broadcaster: region gate (cookie + server), sign, assert on-chain success. */
export function useDexBroadcast() {
  const { address, getSigningCosmWasmClient, isWalletConnected } = useWallet()
  const { txAllowed, country } = useTxRegionGate()
  return useCallback(async (msgs: EncodeObject[], memo: string) => {
    if (txAllowed === false) throw new RegionRestricted(country)
    if (!address || !isWalletConnected) throw new Error('Invalid address')
    try {
      const geo = await fetch('/api/geo', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      if (geo && geo.tx_allowed === false) throw new RegionRestricted(geo.country ?? country)
    } catch (e) {
      if (e instanceof RegionRestricted) throw e
    }
    const client = await getSigningCosmWasmClient()
    const res = await client.signAndBroadcast(address, msgs, 'auto', memo)
    if (res && typeof res.code === 'number' && res.code !== 0) {
      throw new Error(res.rawLog || `Transaction failed on chain (code ${res.code})`)
    }
    return res
  }, [address, getSigningCosmWasmClient, isWalletConnected, txAllowed, country])
}

export interface SwapArgs {
  pair: string
  offer: Asset
  /** Expected return from simulation — feeds belief_price. */
  expectedReturn: string
  /** 0.01 = 1% */
  maxSpread: number
  crystalHolder: boolean
  sender: string
}

export const useSwap = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: SwapArgs) => {
    const msgs: EncodeObject[] = []
    const info = a.offer.info


    // Astroport: belief_price = offer / ask; max_spread bounds slippage around it.
    const beliefPrice = (Number(a.offer.amount) / Math.max(1, Number(a.expectedReturn))).toFixed(18)
    const swapInner = { max_spread: a.maxSpread.toFixed(3), belief_price: beliefPrice }

    if ('native_token' in info) {
      msgs.push(exec(a.sender, a.pair, { swap: { offer_asset: a.offer, ...swapInner } },
        [{ denom: info.native_token.denom, amount: a.offer.amount }]))
    } else {
      // cw20 offers go through the token's Send hook, per Astroport.
      msgs.push(exec(a.sender, info.token.contract_addr,
        { send: { contract: a.pair, amount: a.offer.amount, msg: b64({ swap: swapInner }) } }))
    }
    return broadcast(msgs, `${MEMO}: swap`)
  })
}

export interface ProvideArgs {
  pair: string
  assets: [Asset, Asset]
  /** 0.01 = 1% */
  slippage: number
  sender: string
}

export const useProvideLiquidity = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ProvideArgs) => {
    const msgs: EncodeObject[] = []
    const funds: Coin[] = []
    for (const asset of a.assets) {
      if ('token' in asset.info) {
        // cw20 side: the pair pulls it with transfer_from, so allow it first.
        msgs.push(exec(a.sender, asset.info.token.contract_addr,
          { increase_allowance: { spender: a.pair, amount: asset.amount } }))
      } else {
        funds.push({ denom: asset.info.native_token.denom, amount: asset.amount })
      }
    }
    msgs.push(exec(a.sender, a.pair, {
      provide_liquidity: { assets: a.assets, slippage_tolerance: a.slippage.toFixed(3), auto_stake: false },
    }, funds))
    return broadcast(msgs, `${MEMO}: add liquidity`)
  })
}

export interface ZapArgs {
  pair: string
  /** the swap leg */
  offer: Asset
  expectedReturn: string
  /** 0.01 = 1% */
  maxSpread: number
  crystalHolder: boolean
  /** the provide leg, in pair order */
  provide: [Asset, Asset]
  slippage: number
  sender: string
}

/**
 * Single-sided add in one signature: the swap,
 * allowances for any cw20 side, then provide_liquidity. All-or-nothing — if
 * the provide leg cannot be satisfied the whole tx reverts and nothing moved.
 */
export const useZap = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ZapArgs) => {
    const msgs: EncodeObject[] = []
    const info = a.offer.info
    const beliefPrice = (Number(a.offer.amount) / Math.max(1, Number(a.expectedReturn))).toFixed(18)
    const swapInner = { max_spread: a.maxSpread.toFixed(3), belief_price: beliefPrice }
    if ('native_token' in info) {
      msgs.push(exec(a.sender, a.pair, { swap: { offer_asset: a.offer, ...swapInner } }, [{ denom: info.native_token.denom, amount: a.offer.amount }]))
    } else {
      msgs.push(exec(a.sender, info.token.contract_addr, { send: { contract: a.pair, amount: a.offer.amount, msg: b64({ swap: swapInner }) } }))
    }
    const funds: Coin[] = []
    for (const asset of a.provide) {
      if ('token' in asset.info) msgs.push(exec(a.sender, asset.info.token.contract_addr, { increase_allowance: { spender: a.pair, amount: asset.amount } }))
      else funds.push({ denom: asset.info.native_token.denom, amount: asset.amount })
    }
    msgs.push(exec(a.sender, a.pair, { provide_liquidity: { assets: a.provide, slippage_tolerance: a.slippage.toFixed(3), auto_stake: false } }, funds))
    return broadcast(msgs, `${MEMO}: zap`)
  })
}

export interface WithdrawArgs {
  pair: string
  lpToken: string
  amount: string
  sender: string
}

export const useWithdrawLiquidity = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: WithdrawArgs) =>
    broadcast([exec(a.sender, a.lpToken,
      { send: { contract: a.pair, amount: a.amount, msg: b64({ withdraw_liquidity: {} }) } })],
      `${MEMO}: remove liquidity`),
  )
}

export interface CreatePairArgs {
  assetInfos: [AssetInfo, AssetInfo]
  sender: string
}

/** Permissionless on our factory: anyone in the community can open a pool. */
export const useCreatePair = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: CreatePairArgs) =>
    broadcast([exec(a.sender, DEX_FACTORY,
      { create_pair: { pair_type: { xyk: {} }, asset_infos: a.assetInfos } })],
      `${MEMO}: create pool`),
  )
}
