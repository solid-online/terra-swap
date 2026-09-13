/**
 * Transaction hooks. Each one builds its messages in lib/msgs and broadcasts
 * them with a two-layer region gate and a `code !== 0` check
 * (signAndBroadcast does not throw on revert).
 *
 * There is no interface fee: the only fees are the pools' own, and they cannot
 * be bypassed.
 */

import { useCallback } from 'react'
import { useMutation } from 'react-query'
import type { EncodeObject } from '@cosmjs/proto-signing'
import { useWallet } from 'components/providers/WalletProvider'
import { useTxRegionGate, RegionRestricted } from 'components/RegionGate'
import { DEX_FACTORY, IS_ASTRO } from 'lib/dex'
import {
  astroExitMsgs, claimMsg, createPairMsg, exitMsgs, provideMsgs, routeMsgs, stakeMsg, unstakeMsg, zapMsgs,
  type AstroExitArgs, type CreatePairArgs, type ExitArgs, type ProvideArgs, type ZapArgs,
} from 'lib/msgs'
import type { RoutePlan } from 'lib/route'

const MEMO = IS_ASTRO ? 'Terra Pools' : 'Terra Swap'

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

export interface RouteSwapArgs {
  /** from lib/route planRoute */
  plan: RoutePlan
  /** 0.01 = 1%: the limit each separate swap carries */
  maxSpread: number
  sender: string
  memo?: string
}

/** A quote across one or more pools, on either site, in one transaction. If anything falls short of its limit, all of it reverts. */
export const useRouteSwap = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: RouteSwapArgs) =>
    broadcast(routeMsgs(a.sender, a.plan, a.maxSpread), `${MEMO}: ${a.memo ?? (a.plan.legs.length > 1 ? 'routed swap' : 'swap')}`))
}

export const useExitPosition = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ExitArgs) => {
    const msgs = exitMsgs(a)
    return broadcast(msgs, `${MEMO}: ${msgs.length > 1 ? 'unstake and remove liquidity' : 'remove liquidity'}`)
  })
}

export const useUnstake = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { incentives: string; lpToken: string; amount: string; sender: string }) =>
    broadcast([unstakeMsg(a)], `${MEMO}: unstake LP`))
}

export const useClaimRewards = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { incentives: string; lpTokens: string[]; sender: string }) =>
    broadcast([claimMsg(a)], `${MEMO}: claim rewards`))
}

export const useStakeLp = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { incentives: string; lpToken: string; amount: string; sender: string }) =>
    broadcast([stakeMsg(a)], `${MEMO}: stake LP`))
}

export const useProvideLiquidity = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ProvideArgs) => broadcast(provideMsgs(a), `${MEMO}: add liquidity`))
}

export const useZap = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: ZapArgs) => broadcast(zapMsgs(a), `${MEMO}: zap`))
}

export const useCreatePair = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: CreatePairArgs) => broadcast([createPairMsg(DEX_FACTORY, a)], `${MEMO}: create pool`))
}

export const useAstroLegacyExit = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: AstroExitArgs) => {
    const what = a.xastroAmount !== '0' && a.convertAmount !== '0' ? 'unstake old xASTRO and convert' : a.xastroAmount !== '0' ? 'unstake old xASTRO' : 'convert ASTRO'
    return broadcast(astroExitMsgs(a), `${MEMO}: ${what}`)
  })
}
