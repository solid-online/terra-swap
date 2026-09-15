/**
 * Moving stLUNA and stATOM between Stride and Terra.
 *
 * Checked 2026-09-15 on both chains: Stride's channel-52 is Terra's
 * channel-46, open on both sides, Terra's client for Stride active, a packet
 * relayed the day before. stLUNA (stuluna) and stATOM (stuatom) are Stride's
 * own denoms and arrive on Terra as the denoms lib/dex lists. Stride runs
 * ibc-go v11, so a transfer's memo can carry a swap on arrival. Its minimum gas
 * price in STRD is 0.0005ustrd.
 */

import { bankBalance } from 'lib/noble'

export const STRIDE_CHAIN_ID = 'stride-1'
export const STRIDE_TO_TERRA_CHANNEL = 'channel-52'
export const TERRA_TO_STRIDE_CHANNEL = 'channel-46'
/** Twice the minimum. */
export const STRIDE_GAS_PRICE = '0.001ustrd'
export const STRIDE_FEE_DENOM = 'ustrd'

/** Stride endpoints that answer browsers (CORS checked 2026-09-15). */
export const STRIDE_REST_ENDPOINTS = ['https://stride-api.polkachu.com', 'https://rest.cosmos.directory/stride']
export const STRIDE_RPC_ENDPOINTS = ['https://stride-rpc.polkachu.com', 'https://rpc.cosmos.directory/stride']

export const strideBalance = (address: string, denom: string) => bankBalance(STRIDE_REST_ENDPOINTS, address, denom)
