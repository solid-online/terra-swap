/**
 * Moving ATOM between the Cosmos Hub and Terra.
 *
 * Checked 2026-09-14: the Hub's channel-339 is Terra's channel-0, both open,
 * and ATOM arrives on Terra as lib/dex ATOM_DENOM. The Hub runs ibc-go v10, so
 * a transfer's memo can carry a call to Terra Swap's router for Terra's IBC
 * hooks, the same swap on arrival as from Noble (lib/msgs arrivalSwapMsg). Its
 * fee market's minimum gas price is 0.005uatom.
 */

import { bankBalance } from 'lib/noble'

export const HUB_CHAIN_ID = 'cosmoshub-4'
/** The Hub's IBC channel to Terra, and Terra's to the Hub. */
export const HUB_TO_TERRA_CHANNEL = 'channel-339'
export const TERRA_TO_HUB_CHANNEL = 'channel-0'
/** ATOM on the Hub. */
export const HUB_ATOM_DENOM = 'uatom'
/** Twice the fee market's minimum, so a transaction still lands when blocks fill up and the price rises. */
export const HUB_GAS_PRICE = '0.01uatom'

/** Hub endpoints that answer browsers (CORS checked 2026-09-14). */
export const HUB_REST_ENDPOINTS = ['https://cosmos-rest.publicnode.com', 'https://rest.cosmos.directory/cosmoshub']
export const HUB_RPC_ENDPOINTS = ['https://cosmos-rpc.publicnode.com:443', 'https://cosmos-rpc.polkachu.com', 'https://rpc.cosmos.directory/cosmoshub']

/** ATOM on the Hub for an address, smallest units. */
export const hubAtomBalance = (address: string) => bankBalance(HUB_REST_ENDPOINTS, address, HUB_ATOM_DENOM)
