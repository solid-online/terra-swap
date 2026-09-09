/**
 * Terra Predict transaction hooks. Same broadcaster as the swap (two-layer
 * region gate, `code !== 0` check); the messages are the contract's own.
 */

import { useMutation } from 'react-query'
import type { EncodeObject } from '@cosmjs/proto-signing'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'
import { toUtf8 } from '@cosmjs/encoding'
import { useDexBroadcast } from 'components/transactions/useDex'
import { PREDICT_CONTRACT, type Side } from 'lib/predict'
import type { AssetInfo } from 'lib/dex'

const MEMO = 'Terra Predict'

type Coin = { denom: string; amount: string }

function exec(sender: string, msg: object, funds: Coin[] = []): EncodeObject {
  return {
    typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    value: MsgExecuteContract.fromPartial({ sender, contract: PREDICT_CONTRACT, msg: toUtf8(JSON.stringify(msg)), funds }),
  }
}

export interface CreateMarketArgs {
  sender: string
  question: string
  pair: string
  base: AssetInfo
  quote: AssetInfo
  baseDecimals: number
  quoteDecimals: number
  /** display units, quote per base, e.g. "0.05" */
  threshold: string
  denom: string
  minBetMicro: string
  closeAt: number
  resolveAt: number
  twapWindow: number
}

export const useCreateMarket = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: CreateMarketArgs) =>
    broadcast([exec(a.sender, {
      create_market: {
        question: a.question,
        pair: a.pair,
        base: a.base,
        quote: a.quote,
        base_decimals: a.baseDecimals,
        quote_decimals: a.quoteDecimals,
        threshold: a.threshold,
        price_precision: null,
        denom: a.denom,
        min_bet: a.minBetMicro,
        close_at: a.closeAt,
        resolve_at: a.resolveAt,
        twap_window: a.twapWindow,
      },
    })], `${MEMO}: open market`))
}

export const useBet = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { sender: string; marketId: number; side: Side; denom: string; amountMicro: string }) =>
    broadcast(
      [exec(a.sender, { bet: { market_id: a.marketId, side: a.side } }, [{ denom: a.denom, amount: a.amountMicro }])],
      `${MEMO}: ${a.side.toUpperCase()} on #${a.marketId}`,
    ))
}

export const useObserve = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { sender: string; marketId: number }) =>
    broadcast([exec(a.sender, { observe: { market_id: a.marketId } })], `${MEMO}: observe #${a.marketId}`))
}

export const useResolve = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { sender: string; marketId: number }) =>
    broadcast([exec(a.sender, { resolve: { market_id: a.marketId } })], `${MEMO}: resolve #${a.marketId}`))
}

export const useVoidMarket = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { sender: string; marketId: number }) =>
    broadcast([exec(a.sender, { void: { market_id: a.marketId } })], `${MEMO}: void #${a.marketId}`))
}

export const useClaim = () => {
  const broadcast = useDexBroadcast()
  return useMutation(async (a: { sender: string; marketId: number }) =>
    broadcast([exec(a.sender, { claim: { market_id: a.marketId } })], `${MEMO}: claim #${a.marketId}`))
}
