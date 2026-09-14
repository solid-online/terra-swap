/**
 * Every message the page asks a wallet to sign.
 *
 * Built here, without React, so the exact transactions can be simulated
 * against the chain before anyone signs one. That is how the 2026-09-13 audit
 * checked each of them against real wallets' balances: nothing signed,
 * nothing sent.
 *
 * They go to Astroport's own contracts (pairs on either factory, the
 * factories, the incentives contract, the router, the first ASTRO staking and
 * the ASTRO converter), to Terra Swap's router in contracts/router, to the
 * liquid staking hubs in lib/lst, and over IBC between Noble and Terra, where
 * a deposit can carry a call to Terra Swap's router that swaps it on arrival.
 * None sends anything anywhere else, and none takes a fee.
 */

import type { EncodeObject } from '@cosmjs/proto-signing'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'
import { MsgTransfer } from 'cosmjs-types/ibc/applications/transfer/v1/tx'
import { toUtf8 } from '@cosmjs/encoding'
import { ASTRO_ROUTER, TERRA_SWAP_ROUTER, VENUE_FACTORY, type Asset, type AssetInfo } from 'lib/dex'
import type { ExecLeg, RoutePlan, TradePlan } from 'lib/route'

type Coin = { denom: string; amount: string }

export function b64(o: object): string {
  return typeof window !== 'undefined'
    ? btoa(JSON.stringify(o))
    : Buffer.from(JSON.stringify(o)).toString('base64')
}

/**
 * The SDK rejects `funds` unless the coins are sorted by denom, byte order
 * (`ibc/…` sorts before `uluna`). A LUNA/USDC provide in pair order failed
 * with "denomination … is not sorted" (2026-09-09, reported by a user). Sort
 * here, once, so no caller can get it wrong.
 */
export function exec(sender: string, contract: string, msg: object, funds: Coin[] = []): EncodeObject {
  const sorted = [...funds].sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0))
  return {
    typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    value: MsgExecuteContract.fromPartial({ sender, contract, msg: toUtf8(JSON.stringify(msg)), funds: sorted }),
  }
}

// ─── Swaps ──────────────────────────────────────────────────────

/**
 * One Astroport swap: native funds straight to the pair, cw20 through the
 * token's Send hook. belief_price = offer / limitReturn, and max_spread is how
 * far under that the pair lets the return land. Pool types disagree on what
 * counts as the return; lib/dex priceLimit sets limitReturn for that.
 */
export function swapMsg(sender: string, pair: string, offer: Asset, limitReturn: string, maxSpread: number): EncodeObject {
  const beliefPrice = (Number(offer.amount) / Math.max(1, Number(limitReturn))).toFixed(18)
  const inner = { max_spread: maxSpread.toFixed(3), belief_price: beliefPrice }
  if ('native_token' in offer.info) {
    return exec(sender, pair, { swap: { offer_asset: offer, ...inner } }, [{ denom: offer.info.native_token.denom, amount: offer.amount }])
  }
  return exec(sender, offer.info.token.contract_addr, { send: { contract: pair, amount: offer.amount, msg: b64({ swap: inner }) } })
}

const legMsgs = (sender: string, legs: ExecLeg[], maxSpread: number): EncodeObject[] =>
  legs.map(l => swapMsg(sender, l.pair, { info: l.offerInfo, amount: l.offerAmount }, l.limitReturn, maxSpread))

/**
 * A whole route in one message to Astroport's router: each swap's full return
 * goes into the next, and `minimumReceive` is checked once, on what reaches
 * the wallet. max_spread sits at the router's ceiling on purpose. With no
 * belief price it only caps each pool's own price impact, which the quote has
 * already priced in; the minimum is the limit that protects the trade.
 */
export function routerMsg(sender: string, hops: { offer: AssetInfo; ask: AssetInfo }[], amount: string, minimumReceive: string, router = ASTRO_ROUTER): EncodeObject {
  const inner = {
    execute_swap_operations: {
      operations: hops.map(h => ({ astro_swap: { offer_asset_info: h.offer, ask_asset_info: h.ask } })),
      minimum_receive: minimumReceive,
      max_spread: '0.5',
    },
  }
  const first = hops[0].offer
  if ('native_token' in first) return exec(sender, router, inner, [{ denom: first.native_token.denom, amount }])
  return exec(sender, first.token.contract_addr, { send: { contract: router, amount, msg: b64(inner) } })
}

/** Legs as operations for Terra Swap's router, each naming the factory that owns its pair. */
const routerOperations = (legs: ExecLeg[]) => legs.map(l => ({ factory: VENUE_FACTORY[l.venue], offer_asset_info: l.offerInfo, ask_asset_info: l.askInfo }))

/**
 * A route through Terra Swap's router (contracts/router), which reaches pairs
 * on both factories. Each operation names the factory that owns its pair; the
 * router looks the pair up there, swaps everything it holds of the offered
 * token, and checks `minimumReceive` once, on what reaches the wallet. No
 * intermediate token is left in the wallet or in the router.
 */
export function terraSwapRouterMsg(sender: string, legs: ExecLeg[], amount: string, minimumReceive: string, router = TERRA_SWAP_ROUTER): EncodeObject {
  if (!router) throw new Error("Terra Swap's router is not on chain yet")
  const inner = {
    execute_swap_operations: {
      operations: routerOperations(legs),
      minimum_receive: minimumReceive,
    },
  }
  const first = legs[0].offerInfo
  if ('native_token' in first) return exec(sender, router, inner, [{ denom: first.native_token.denom, amount }])
  return exec(sender, first.token.contract_addr, { send: { contract: router, amount, msg: b64(inner) } })
}

/** A quote as lib/route planRoute decided to sign it: one message through a router, or one swap per leg. */
export function routeMsgs(sender: string, plan: RoutePlan, maxSpread: number): EncodeObject[] {
  if (plan.legs.length === 0 || plan.legs.some(l => l.offerAmount === '0') || plan.minOut === '0') throw new Error('Amount too small to route')
  if (plan.kind === 'router') return [routerMsg(sender, plan.legs.map(l => ({ offer: l.offerInfo, ask: l.askInfo })), plan.legs[0].offerAmount, plan.minOut)]
  if (plan.kind === 'multi') return [terraSwapRouterMsg(sender, plan.legs, plan.legs[0].offerAmount, plan.minOut)]
  return legMsgs(sender, plan.legs, maxSpread)
}

/**
 * A single path or a split (lib/route planTrade) in one transaction: each
 * part's messages in turn, each part with its own minimum. The parts share no
 * pool, so one cannot move the price the other gets.
 */
export function tradeMsgs(sender: string, trade: TradePlan, maxSpread: number): EncodeObject[] {
  if (trade.parts.length === 0) throw new Error('Nothing to trade')
  return trade.parts.flatMap(p => routeMsgs(sender, p.plan, maxSpread))
}

// ─── Liquidity ──────────────────────────────────────────────────

/** Send LP to a contract with a hook message: cw20 LP through Send, native LP as funds. */
export function lpSend(sender: string, lpToken: string, contract: string, amount: string, hook: object): EncodeObject {
  return lpToken.startsWith('terra1')
    ? exec(sender, lpToken, { send: { contract, amount, msg: b64(hook) } })
    : exec(sender, contract, hook, [{ denom: lpToken, amount }])
}

export interface ProvideArgs {
  pair: string
  assets: [Asset, Asset]
  /** 0.01 = 1% */
  slippage: number
  sender: string
}

/** Allowances for any cw20 side (the pair pulls it with transfer_from), then provide_liquidity with the native side as funds. */
export function provideMsgs(a: ProvideArgs): EncodeObject[] {
  const msgs: EncodeObject[] = []
  const funds: Coin[] = []
  for (const asset of a.assets) {
    if ('token' in asset.info) msgs.push(exec(a.sender, asset.info.token.contract_addr, { increase_allowance: { spender: a.pair, amount: asset.amount } }))
    else funds.push({ denom: asset.info.native_token.denom, amount: asset.amount })
  }
  msgs.push(exec(a.sender, a.pair, { provide_liquidity: { assets: a.assets, slippage_tolerance: a.slippage.toFixed(3), auto_stake: false } }, funds))
  return msgs
}

export interface ZapArgs {
  pair: string
  /** In-pool zap: the swap leg, and what its price limit is written against (ZapPlan.limitReturn). */
  offer?: Asset
  limitReturn?: string
  /** Routed zap: buy the other side along this route instead, signed as lib/route planRoute decided (RoutedZap.plan). */
  route?: RoutePlan
  /** 0.01 = 1%: the limit each swap carries */
  maxSpread: number
  /** the provide leg, in pair order */
  provide: [Asset, Asset]
  slippage: number
  sender: string
}

/**
 * Single-sided add in one signature: the swap (inside the pool, or through the
 * best path elsewhere, via a router when that path crosses several pools, so no
 * intermediate token is left over), then allowances and provide_liquidity. The
 * provide leg asks for no more than the swap is guaranteed to return, so if
 * anything cannot be satisfied the whole transaction reverts and nothing moves.
 */
export function zapMsgs(a: ZapArgs): EncodeObject[] {
  let swaps: EncodeObject[]
  if (a.route) swaps = routeMsgs(a.sender, a.route, a.maxSpread)
  else if (a.offer && a.limitReturn) swaps = [swapMsg(a.sender, a.pair, a.offer, a.limitReturn, a.maxSpread)]
  else throw new Error('Nothing to swap')
  return [...swaps, ...provideMsgs({ pair: a.pair, assets: a.provide, slippage: a.slippage, sender: a.sender })]
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
export function exitMsgs(a: ExitArgs): EncodeObject[] {
  const amount = BigInt(a.amount), wallet = BigInt(a.walletLp || '0'), staked = BigInt(a.stakedLp || '0')
  if (amount <= BigInt(0) || amount > wallet + staked) throw new Error('That is more LP than this position holds')
  const msgs: EncodeObject[] = []
  const fromStake = amount > wallet ? amount - wallet : BigInt(0)
  if (fromStake > BigInt(0)) {
    if (!a.incentives) throw new Error('This pool has no incentives contract to unstake from')
    msgs.push(unstakeMsg({ incentives: a.incentives, lpToken: a.lpToken, amount: fromStake.toString(), sender: a.sender }))
  }
  msgs.push(lpSend(a.sender, a.lpToken, a.pair, amount.toString(), { withdraw_liquidity: {} }))
  return msgs
}

/** Staked LP back to the wallet, liquidity left in the pool. */
export const unstakeMsg = (a: { incentives: string; lpToken: string; amount: string; sender: string }): EncodeObject =>
  exec(a.sender, a.incentives, { withdraw: { lp_token: a.lpToken, amount: a.amount } })

/** Pending incentive rewards for several pools at once. */
export const claimMsg = (a: { incentives: string; lpTokens: string[]; sender: string }): EncodeObject =>
  exec(a.sender, a.incentives, { claim_rewards: { lp_tokens: a.lpTokens } })

/** Wallet LP into the incentives contract. Only offered where the pool pays rewards. */
export const stakeMsg = (a: { incentives: string; lpToken: string; amount: string; sender: string }): EncodeObject =>
  lpSend(a.sender, a.lpToken, a.incentives, a.amount, { deposit: {} })

// ─── Pools and old ASTRO ────────────────────────────────────────

export interface CreatePairArgs {
  assetInfos: [AssetInfo, AssetInfo]
  sender: string
  /** Terra Swap's factory only has xyk; Astroport's also opens concentrated pools. */
  pairType?: 'xyk' | 'concentrated'
  /** Concentrated pools need their curve settings and a starting price. */
  initParams?: object
}

/** Permissionless on both factories: anyone can open a pool. */
export function createPairMsg(factory: string, a: CreatePairArgs): EncodeObject {
  return exec(a.sender, factory, {
    create_pair: {
      pair_type: a.pairType === 'concentrated' ? { custom: 'concentrated' } : { xyk: {} },
      asset_infos: a.assetInfos,
      ...(a.initParams ? { init_params: b64(a.initParams) } : {}),
    },
  })
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
 * Old ASTRO in one transaction: unstake xASTRO from Astroport's first staking
 * contract (`leave`), then, when the converter can pay, send ASTRO.cw20 to it
 * for the IBC ASTRO. If the convert asks for more than the unstake returned,
 * or more than the converter holds, the whole thing reverts.
 */
export function astroExitMsgs(a: AstroExitArgs): EncodeObject[] {
  const msgs: EncodeObject[] = []
  if (a.xastroAmount !== '0') msgs.push(exec(a.sender, a.xastro, { send: { contract: a.staking, amount: a.xastroAmount, msg: b64({ leave: {} }) } }))
  if (a.convertAmount !== '0') msgs.push(exec(a.sender, a.astroCw20, { send: { contract: a.converter, amount: a.convertAmount, msg: b64({}) } }))
  if (msgs.length === 0) throw new Error('Nothing to convert')
  return msgs
}

// ─── Liquid staking hubs ────────────────────────────────────────

/** Mint a liquid staking token at its hub: LUNA in, the token out at the hub's exchange rate (lib/lst). */
export const bondMsg = (a: { hub: string; amount: string; sender: string }): EncodeObject =>
  exec(a.sender, a.hub, { bond: {} }, [{ denom: 'uluna', amount: a.amount }])

/** Queue a liquid staking token for redemption at its hub. The LUNA is withdrawn after unbonding with withdrawUnbondedMsg. */
export const queueUnbondMsg = (a: { token: string; hub: string; amount: string; sender: string }): EncodeObject =>
  exec(a.sender, a.token, { send: { contract: a.hub, amount: a.amount, msg: b64({ queue_unbond: {} }) } })

/** Collect every finished redemption this wallet has at a hub. */
export const withdrawUnbondedMsg = (a: { hub: string; sender: string }): EncodeObject =>
  exec(a.sender, a.hub, { withdraw_unbonded: {} })

// ─── IBC between Noble and Terra ────────────────────────────────

const ZERO_HEIGHT = { revisionNumber: BigInt(0), revisionHeight: BigInt(0) }

/** An ICS-20 transfer. If it is not relayed within the timeout, the tokens return to the sender. */
export function ibcTransferMsg(a: { sender: string; receiver: string; channel: string; denom: string; amount: string; memo?: string; timeoutMinutes?: number }): EncodeObject {
  const timeoutTimestamp = BigInt(Date.now() + (a.timeoutMinutes ?? 10) * 60_000) * BigInt(1_000_000)
  return {
    typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
    value: MsgTransfer.fromPartial({
      sourcePort: 'transfer', sourceChannel: a.channel, token: { denom: a.denom, amount: a.amount },
      sender: a.sender, receiver: a.receiver, timeoutHeight: ZERO_HEIGHT, timeoutTimestamp, memo: a.memo ?? '',
    }),
  }
}

export interface ArrivalSwapArgs {
  /** the sender on the source chain */
  sender: string
  terraAddress: string
  /** the source chain's IBC channel to Terra (lib/noble, lib/cosmoshub, lib/injective) */
  channel: string
  /** the token as the source chain names it, and as it arrives on Terra */
  sourceDenom: string
  terraDenom: string
  /** smallest units, exactly as entered */
  amount: string
  /** lib/route routerPlan from the arriving token into the token asked for, priced for `amount` */
  plan: RoutePlan
  router?: string
  timeoutMinutes?: number
}

/**
 * A token leaving Noble, the Cosmos Hub or Injective and arriving on Terra
 * already swapped, in one signature and with no third party in the path. Terra
 * runs IBC hooks: a transfer whose receiver is a contract, and whose memo is
 * {"wasm":{"contract","msg"}} naming that same contract, is paid to the
 * contract and runs the message as the transfer lands. Here the contract is
 * Terra Swap's router, the message is the route with its minimum, and `to` is
 * the wallet's own Terra address. If the swap would deliver less than the
 * minimum, or anything else in it fails, the transfer is acknowledged as
 * failed and the source chain returns the tokens to the sender.
 */
export function arrivalSwapMsg(a: ArrivalSwapArgs): EncodeObject {
  const router = a.router ?? TERRA_SWAP_ROUTER
  if (!router) throw new Error("Terra Swap's router is not on chain")
  if (!/^terra1[02-9ac-hj-np-z]{38,58}$/.test(a.terraAddress)) throw new Error('That is not a Terra address')
  const legs = a.plan.legs
  const first = legs[0]?.offerInfo
  if (!first || a.plan.minOut === '0' || legs.some(l => l.offerAmount === '0')) throw new Error('Amount too small to route')
  if (!('native_token' in first) || first.native_token.denom !== a.terraDenom) throw new Error('The swap does not start from the token being sent')
  if (legs[0].offerAmount !== a.amount) throw new Error('The price was for a different amount. Wait a moment and try again.')
  const msg = { execute_swap_operations: { operations: routerOperations(legs), minimum_receive: a.plan.minOut, to: a.terraAddress } }
  return ibcTransferMsg({
    sender: a.sender, receiver: router, channel: a.channel, denom: a.sourceDenom, amount: a.amount,
    memo: JSON.stringify({ wasm: { contract: router, msg } }), timeoutMinutes: a.timeoutMinutes,
  })
}
