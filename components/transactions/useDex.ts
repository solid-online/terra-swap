/**
 * Terra Swap transaction hooks.
 *
 * All of these talk to Astroport's pair contracts: Terra Swap's pools run
 * Astroport's own xyk code (392), and a routed swap may also cross Astroport's
 * pools directly. The message shapes are Astroport's. There is no interface
 * fee: the only fees are the pools' own, and they cannot be bypassed.
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
import type { ExecLeg } from 'lib/route'

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

/** One Astroport swap message: native funds straight to the pair, cw20 through the token's Send hook. */
function swapMsg(sender: string, pair: string, offer: Asset, expectedReturn: string, maxSpread: number): EncodeObject {
  // belief_price = offer / expected; max_spread bounds how far below it the return may land.
  const beliefPrice = (Number(offer.amount) / Math.max(1, Number(expectedReturn))).toFixed(18)
  const inner = { max_spread: maxSpread.toFixed(3), belief_price: beliefPrice }
  if ('native_token' in offer.info) {
    return exec(sender, pair, { swap: { offer_asset: offer, ...inner } }, [{ denom: offer.info.native_token.denom, amount: offer.amount }])
  }
  return exec(sender, offer.info.token.contract_addr, { send: { contract: pair, amount: offer.amount, msg: b64({ swap: inner }) } })
}

export interface RouteSwapArgs {
  /** from lib/route executionLegs: each leg already sized to what the previous one is guaranteed to return */
  legs: ExecLeg[]
  /** 0.01 = 1%, applied to every leg */
  maxSpread: number
  sender: string
  memo?: string
}

/**
 * A route across one or more pools, on either site, in one transaction. Every
 * leg carries its own price limit; if any leg fails, the whole thing reverts.
 */
export const useRouteSwap = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: RouteSwapArgs) => {
    if (a.legs.length === 0 || a.legs.some(l => l.offerAmount === '0')) throw new Error('Amount too small to route')
    const msgs = a.legs.map(l => swapMsg(a.sender, l.pair, { info: l.offerInfo, amount: l.offerAmount }, l.expectedReturn, a.maxSpread))
    return broadcast(msgs, `${MEMO}: ${a.memo ?? (a.legs.length > 1 ? 'routed swap' : 'swap')}`)
  })
}

/** Send LP to a contract with a hook message: cw20 LP through Send, native LP as funds. */
function lpSend(sender: string, lpToken: string, contract: string, amount: string, hook: object): EncodeObject {
  return lpToken.startsWith('terra1')
    ? exec(sender, lpToken, { send: { contract, amount, msg: b64(hook) } })
    : exec(sender, contract, hook, [{ denom: lpToken, amount }])
}

export interface ExitArgs {
  pair: string
  lpToken: string
  /** the venue's incentives contract, when some of the LP is staked there */
  incentives: string | null
  walletLp: string
  stakedLp: string
  /** LP to withdraw, smallest units, up to wallet + staked */
  amount: string
  sender: string
}

/**
 * Leave all or part of a position in one transaction: take whatever the wallet
 * does not already hold out of the incentives contract, then withdraw the
 * liquidity. Both tokens land in the wallet. If either step fails, neither
 * happens.
 */
export const useExitPosition = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ExitArgs) => {
    const amount = BigInt(a.amount), wallet = BigInt(a.walletLp || '0'), staked = BigInt(a.stakedLp || '0')
    if (amount <= BigInt(0) || amount > wallet + staked) throw new Error('That is more LP than this position holds')
    const msgs: EncodeObject[] = []
    const fromStake = amount > wallet ? amount - wallet : BigInt(0)
    if (fromStake > BigInt(0)) {
      if (!a.incentives) throw new Error('This pool has no incentives contract to unstake from')
      msgs.push(exec(a.sender, a.incentives, { withdraw: { lp_token: a.lpToken, amount: fromStake.toString() } }))
    }
    msgs.push(lpSend(a.sender, a.lpToken, a.pair, amount.toString(), { withdraw_liquidity: {} }))
    return broadcast(msgs, `${MEMO}: ${fromStake > BigInt(0) ? 'unstake and remove liquidity' : 'remove liquidity'}`)
  })
}

/** Take staked LP back to the wallet without withdrawing the liquidity. */
export const useUnstake = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { incentives: string; lpToken: string; amount: string; sender: string }) =>
    broadcast([exec(a.sender, a.incentives, { withdraw: { lp_token: a.lpToken, amount: a.amount } })], `${MEMO}: unstake LP`))
}

/** Claim pending incentive rewards for several pools at once. */
export const useClaimRewards = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { incentives: string; lpTokens: string[]; sender: string }) =>
    broadcast([exec(a.sender, a.incentives, { claim_rewards: { lp_tokens: a.lpTokens } })], `${MEMO}: claim rewards`))
}

/** Stake wallet LP in the incentives contract. Only offered where the pool pays rewards. */
export const useStakeLp = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { incentives: string; lpToken: string; amount: string; sender: string }) =>
    broadcast([lpSend(a.sender, a.lpToken, a.incentives, a.amount, { deposit: {} })], `${MEMO}: stake LP`))
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
  /** Routed zap: buy the other side through these legs instead of inside the pool. */
  legs?: ExecLeg[]
}

/**
 * Single-sided add in one signature: the swap,
 * allowances for any cw20 side, then provide_liquidity. All-or-nothing — if
 * the provide leg cannot be satisfied the whole tx reverts and nothing moved.
 */
export const useZap = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ZapArgs) => {
    const msgs: EncodeObject[] = a.legs?.length
      // Routed: the other side is bought through the best path elsewhere, then both go in.
      ? a.legs.map(l => swapMsg(a.sender, l.pair, { info: l.offerInfo, amount: l.offerAmount }, l.expectedReturn, a.maxSpread))
      : [swapMsg(a.sender, a.pair, a.offer, a.expectedReturn, a.maxSpread)]
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
  /** Terra Swap's factory only has xyk; Astroport's also opens concentrated pools. */
  pairType?: 'xyk' | 'concentrated'
  /** Concentrated pools need their curve settings and a starting price. */
  initParams?: object
}

/** Permissionless on both factories: anyone can open a pool. */
export const useCreatePair = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: CreatePairArgs) =>
    broadcast([exec(a.sender, DEX_FACTORY, {
      create_pair: {
        pair_type: a.pairType === 'concentrated' ? { custom: 'concentrated' } : { xyk: {} },
        asset_infos: a.assetInfos,
        ...(a.initParams ? { init_params: b64(a.initParams) } : {}),
      },
    })], `${MEMO}: create pool`),
  )
}

export interface AstroExitArgs {
  staking: string
  xastro: string
  converter: string
  astroCw20: string
  /** old xASTRO to unstake, smallest units, '0' to skip */
  xastroAmount: string
  /** ASTRO.cw20 to convert after that, smallest units, '0' to skip */
  convertAmount: string
  sender: string
}

/**
 * Old ASTRO, brought current in one transaction: unstake xASTRO from Astroport's
 * first staking contract (`leave`), then send ASTRO.cw20 to Astroport's converter,
 * which pays out the IBC ASTRO. If the convert asks for more than the unstake
 * returned, the whole thing reverts.
 */
export const useAstroLegacyExit = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: AstroExitArgs) => {
    const msgs: EncodeObject[] = []
    if (a.xastroAmount !== '0') msgs.push(exec(a.sender, a.xastro, { send: { contract: a.staking, amount: a.xastroAmount, msg: b64({ leave: {} }) } }))
    if (a.convertAmount !== '0') msgs.push(exec(a.sender, a.astroCw20, { send: { contract: a.converter, amount: a.convertAmount, msg: b64({}) } }))
    if (msgs.length === 0) throw new Error('Nothing to convert')
    return broadcast(msgs, `${MEMO}: ${a.xastroAmount !== '0' ? 'unstake old xASTRO and convert' : 'convert ASTRO'}`)
  })
}
