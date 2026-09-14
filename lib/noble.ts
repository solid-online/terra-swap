/**
 * Moving money between Noble and Terra.
 *
 * Every transfer is an ordinary IBC message built in lib/msgs. A deposit that
 * should arrive as another token carries a call to Terra Swap's router in its
 * memo, which Terra's IBC hooks run as the USDC lands (lib/msgs
 * arrivalSwapMsg). Until 2026-09-14 Skip Go built those deposits; it only
 * reached Astroport's pools and put a third party's contracts in the path.
 *
 * Checked 2026-09-14: Noble USDC comes into Terra over Noble's channel-30 and
 * leaves over Terra's channel-253, and Terra ran an IBC hook on a packet from
 * that channel the same day (tx 5FB49A54…, acknowledged with a contract result).
 */

export const NOBLE_CHAIN_ID = 'noble-1'
export const TERRA_CHAIN_ID = 'phoenix-1'
/** Noble's IBC channel to Terra, and Terra's to Noble. */
export const NOBLE_TO_TERRA_CHANNEL = 'channel-30'
export const TERRA_TO_NOBLE_CHANNEL = 'channel-253'
/** USDC on Noble. On Terra the same USDC is lib/dex NOBLE_USDC. */
export const NOBLE_USDC_DENOM = 'uusdc'

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
