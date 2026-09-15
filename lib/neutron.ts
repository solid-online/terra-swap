/**
 * Moving ASTRO, dATOM and FUEL between Neutron and Terra.
 *
 * Checked 2026-09-15 on both chains: Neutron's channel-25 is Terra's
 * channel-229, open on both sides, Terra's client for Neutron active, a packet
 * relayed the day before. Each of the three is a Neutron token factory denom,
 * and arrives on Terra as the denom lib/dex lists (its trace is
 * transfer/channel-229/<the Neutron denom>). Neutron runs ibc-go v10, so a
 * transfer's memo can carry a swap on arrival for Terra's IBC hooks. Its fee
 * market takes NTRN at a minimum of 0.0053untrn.
 */

import { bankBalance } from 'lib/noble'

export const NEUTRON_CHAIN_ID = 'neutron-1'
export const NEUTRON_TO_TERRA_CHANNEL = 'channel-25'
export const TERRA_TO_NEUTRON_CHANNEL = 'channel-229'
/** A little over the fee market's minimum, so a transaction still lands when the price rises. */
export const NEUTRON_GAS_PRICE = '0.008untrn'
export const NEUTRON_FEE_DENOM = 'untrn'

export const NEUTRON_ASTRO = 'factory/neutron1ffus553eet978k024lmssw0czsxwr97mggyv85lpcsdkft8v9ufsz3sa07/astro'
export const NEUTRON_DATOM = 'factory/neutron1k6hr0f83e7un2wjf29cspk7j69jrnskk65k3ek2nj9dztrlzpj6q00rtsa/udatom'
export const NEUTRON_FUEL = 'factory/neutron1zl2htquajn50vxu5ltz0y5hf2qzvkgnjaaza2rssef268xplq6vsjuruxm/fuel'

/** Neutron endpoints that answer browsers (CORS checked 2026-09-15). */
export const NEUTRON_REST_ENDPOINTS = ['https://neutron-api.polkachu.com', 'https://rest.cosmos.directory/neutron']
export const NEUTRON_RPC_ENDPOINTS = ['https://neutron-rpc.polkachu.com', 'https://rpc.cosmos.directory/neutron']

export const neutronBalance = (address: string, denom: string) => bankBalance(NEUTRON_REST_ENDPOINTS, address, denom)
