/**
 * Moving money between Noble and Terra.
 *
 * Plain transfers are ordinary IBC messages built in lib/msgs. Skip Go is used
 * for one thing only: USDC leaving Noble and arriving on Terra already swapped
 * into another token, in one signature. Skip's API returns an IBC transfer
 * whose memo tells its entry point contract on Terra what to swap and where to
 * send the result; lib/msgs checks every part of it before a wallet sees it.
 *
 * Checked 2026-09-14: Skip supports phoenix-1 and noble-1, routes Noble USDC
 * over channel-30 into Terra and Terra to Noble over channel-253, and prices
 * the same as this site's own routing. Skip also offered a route through
 * Axelar's USDC for a cw20 token; routes are therefore restricted to IBC, and
 * any route that touches a token this site does not list is refused.
 */

export const NOBLE_CHAIN_ID = 'noble-1'
export const TERRA_CHAIN_ID = 'phoenix-1'
/** Noble's IBC channel to Terra, and Terra's to Noble. */
export const NOBLE_TO_TERRA_CHANNEL = 'channel-30'
export const TERRA_TO_NOBLE_CHANNEL = 'channel-253'
/** USDC on Noble. On Terra the same USDC is lib/dex NOBLE_USDC. */
export const NOBLE_USDC_DENOM = 'uusdc'
/** Skip Go's entry point contract on Terra, the only contract a Skip deposit may send to. */
export const SKIP_ENTRY_POINT_TERRA = 'terra13jfx06k2zpajtxymdgq2r6mrezzx3ngrhzfe24gdh9mqs8x67lmspee8lp'

const API = 'https://api.skip.build'

async function post<T>(path: string, body: object, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.message ? `Skip: ${j.message}` : `Skip answered ${r.status}`)
  return j as T
}

export interface SkipRoute {
  amount_in: string
  amount_out: string
  source_asset_denom: string
  source_asset_chain_id: string
  dest_asset_denom: string
  dest_asset_chain_id: string
  operations: unknown[]
  required_chain_addresses: string[]
  estimated_route_duration_seconds?: number
  txs_required: number
  does_swap?: boolean
  warning?: { type: string; message: string } | null
}

export interface SkipCosmosMsg { msg: string; msg_type_url: string }
export interface SkipMsgsResponse {
  txs?: { cosmos_tx?: { chain_id: string; signer_address: string; msgs: SkipCosmosMsg[] } }[]
  min_amount_out?: string
}

/** A quote for USDC on Noble arriving on Terra as `destDenom`. Single transaction, IBC only, no fee. */
export function skipDepositRoute(amountIn: string, destDenom: string): Promise<SkipRoute> {
  return post<SkipRoute>('/v2/fungible/route', {
    amount_in: amountIn,
    source_asset_denom: NOBLE_USDC_DENOM,
    source_asset_chain_id: NOBLE_CHAIN_ID,
    dest_asset_denom: destDenom,
    dest_asset_chain_id: TERRA_CHAIN_ID,
    cumulative_affiliate_fee_bps: '0',
    allow_multi_tx: false,
    allow_unsafe: false,
    bridges: ['IBC'],
    // Swap only in Astroport's pools on Terra. Left to itself Skip sometimes swaps on Osmosis instead,
    // which needs an address on a third chain and pools this site cannot check.
    swap_venues: [{ name: 'terra-astroport', chain_id: TERRA_CHAIN_ID }],
    smart_relay: false,
    go_fast: false,
    smart_swap_options: { split_routes: false, evm_swaps: false },
  })
}

/** The messages for a route, with the user's own address on every chain it touches. */
export function skipDepositMsgs(route: SkipRoute, addresses: Record<string, string>, slippagePercent: string): Promise<SkipMsgsResponse> {
  const addressList = route.required_chain_addresses.map(chain => {
    const a = addresses[chain]
    if (!a) throw new Error(`This route needs an address on ${chain}, which this page does not handle`)
    return a
  })
  return post<SkipMsgsResponse>('/v2/fungible/msgs', {
    source_asset_denom: route.source_asset_denom,
    source_asset_chain_id: route.source_asset_chain_id,
    dest_asset_denom: route.dest_asset_denom,
    dest_asset_chain_id: route.dest_asset_chain_id,
    amount_in: route.amount_in,
    amount_out: route.amount_out,
    address_list: addressList,
    operations: route.operations,
    slippage_tolerance_percent: slippagePercent,
  })
}

export type SkipState = 'STATE_SUBMITTED' | 'STATE_PENDING' | 'STATE_COMPLETED_SUCCESS' | 'STATE_COMPLETED_ERROR' | 'STATE_ABANDONED' | 'STATE_PENDING_ERROR' | string

/** Ask Skip to follow a broadcast transaction across chains. */
export async function skipTrack(txHash: string, chainId: string): Promise<void> {
  await post('/v2/tx/track', { tx_hash: txHash, chain_id: chainId })
}

/** Noble endpoints that answer browsers (CORS checked 2026-09-14). */
export const NOBLE_RPC_ENDPOINTS = ['https://noble-rpc.polkachu.com', 'https://rpc.cosmos.directory/noble']
export const NOBLE_REST_ENDPOINTS = ['https://noble-api.polkachu.com', 'https://rest.cosmos.directory/noble']

/** USDC on Noble for an address, smallest units. */
export async function nobleUsdcBalance(address: string): Promise<string> {
  for (const base of NOBLE_REST_ENDPOINTS) {
    try {
      const r = await fetch(`${base}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${NOBLE_USDC_DENOM}`, { signal: AbortSignal.timeout(8000) })
      if (r.ok) return (await r.json())?.balance?.amount ?? '0'
    } catch { /* try the next endpoint */ }
  }
  return '0'
}

/** Where a tracked transaction is now. */
export async function skipStatus(txHash: string, chainId: string): Promise<SkipState> {
  const r = await fetch(`${API}/v2/tx/status?tx_hash=${encodeURIComponent(txHash)}&chain_id=${encodeURIComponent(chainId)}`, { signal: AbortSignal.timeout(15_000) })
  const j = await r.json().catch(() => null)
  return (j?.state ?? j?.transfers?.[0]?.state ?? 'STATE_PENDING') as SkipState
}
