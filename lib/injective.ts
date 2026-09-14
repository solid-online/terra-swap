/**
 * Moving USDC.inj between Injective and Terra.
 *
 * USDC.inj is Circle's USDC as issued on Injective
 * (erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a). It reaches Terra as an
 * ordinary IBC transfer from Injective's channel-151, which is Terra's
 * channel-255, and goes back the same way. Checked 2026-09-14: both channels
 * open, both light clients active, and Skip Go lists the same single IBC hop
 * in both directions. The USDC.inj already on Terra had come the long way,
 * swapped on Osmosis and forwarded through Injective; this page sends it
 * straight across.
 *
 * Injective accounts use Ethereum-style keys (ethsecp256k1). The generic
 * signing client writes every public key as a Cosmos secp256k1 key, which
 * Injective rejects, so the transaction envelope is built here. The message
 * inside it is still built in lib/msgs.
 */

import { Registry, makeSignDoc, type EncodeObject, type OfflineDirectSigner } from '@cosmjs/proto-signing'
import { defaultRegistryTypes } from '@cosmjs/stargate'
import { fromBase64, fromBech32, fromHex, toBase64, toBech32 } from '@cosmjs/encoding'
import { AuthInfo, Fee, SignerInfo, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing'
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys'

export const INJECTIVE_CHAIN_ID = 'injective-1'
/** Injective's IBC channel to Terra, and Terra's to Injective. */
export const INJECTIVE_TO_TERRA_CHANNEL = 'channel-151'
export const TERRA_TO_INJECTIVE_CHANNEL = 'channel-255'
/** USDC.inj on Injective. On Terra the same token is lib/dex USDC_INJ_DENOM. */
export const USDC_INJ_ON_INJECTIVE = 'erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a'

/** Injective endpoints that answer browsers (CORS checked 2026-09-14). */
export const INJECTIVE_REST_ENDPOINTS = ['https://sentry.lcd.injective.network', 'https://injective-api.polkachu.com', 'https://rest.cosmos.directory/injective']
export const INJECTIVE_RPC_ENDPOINTS = ['https://sentry.tm.injective.network', 'https://injective-rpc.polkachu.com', 'https://rpc.cosmos.directory/injective']

/** Injective's minimum is 160000000inj per unit of gas, which is what relayers pay; this sits a little above it. */
const GAS_PRICE = BigInt(500_000_000)
const ETHSECP256K1_PUBKEY = '/injective.crypto.v1beta1.ethsecp256k1.PubKey'
const registry = new Registry(defaultRegistryTypes)

async function rest<T>(path: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  let last: unknown = null
  for (const base of INJECTIVE_REST_ENDPOINTS) {
    let r: Response
    try {
      r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) { last = e; continue }
    const j = await r.json().catch(() => null)
    if (r.ok) return j as T
    // A server error with no answer from the chain is the node's problem, not the request's: ask the next one.
    if (r.status >= 500 && !j?.message) { last = new Error(`Injective node answered ${r.status}`); continue }
    throw new Error(j?.message || `Injective answered ${r.status}`)
  }
  throw last instanceof Error ? last : new Error('No Injective node is answering')
}

/** A token balance on Injective, smallest units. */
export async function injectiveBalance(address: string, denom: string): Promise<string> {
  const j = await rest<{ balance?: { amount?: string } }>(`/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`)
  return j?.balance?.amount ?? '0'
}

/** An inj1… address as typed, or an Injective 0x address written as the inj1… address of the same account. Null for anything else. */
export function toInjectiveAddress(input: string): string | null {
  const a = input.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return toBech32('inj', fromHex(a.slice(2)))
  try {
    const { prefix, data } = fromBech32(a)
    return prefix === 'inj' && data.length === 20 ? toBech32('inj', data) : null
  } catch { return null }
}

async function injectiveAccount(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  let j: { account?: { base_account?: { account_number?: string; sequence?: string }; account_number?: string; sequence?: string } }
  try {
    j = await rest(`/cosmos/auth/v1beta1/accounts/${address}`)
  } catch (e) {
    if (/not found/i.test(String((e as Error)?.message))) throw new Error('This wallet has no account on Injective yet. It needs some INJ there first.')
    throw e
  }
  const acc = j.account?.base_account ?? j.account
  return { accountNumber: BigInt(acc?.account_number ?? 0), sequence: BigInt(acc?.sequence ?? 0) }
}

/** The body and auth info as Injective expects them: the key written as ethsecp256k1, signed in direct mode, fee in INJ. */
export function injectiveTxParts(a: { pubkey: Uint8Array; sequence: bigint; msgs: EncodeObject[]; memo: string; gasLimit: bigint }) {
  const bodyBytes = registry.encodeTxBody({ messages: a.msgs, memo: a.memo })
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [SignerInfo.fromPartial({
      publicKey: { typeUrl: ETHSECP256K1_PUBKEY, value: PubKey.encode({ key: a.pubkey }).finish() },
      modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
      sequence: a.sequence,
    })],
    fee: Fee.fromPartial({ amount: [{ denom: 'inj', amount: (a.gasLimit * GAS_PRICE).toString() }], gasLimit: a.gasLimit }),
  })).finish()
  return { bodyBytes, authInfoBytes }
}

/** The gas Injective reports for these messages, with room to spare. Nothing is signed. */
export async function simulateInjective(a: { pubkey: Uint8Array; sequence: bigint; msgs: EncodeObject[]; memo: string }): Promise<bigint> {
  const { bodyBytes, authInfoBytes } = injectiveTxParts({ ...a, gasLimit: BigInt(0) })
  const tx = TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] })).finish()
  const j = await rest<{ gas_info?: { gas_used?: string } }>('/cosmos/tx/v1beta1/simulate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: toBase64(tx) }),
  }, 20_000)
  const used = BigInt(j?.gas_info?.gas_used ?? '0')
  if (used === BigInt(0)) throw new Error('Injective did not return a gas estimate')
  return (used * BigInt(14)) / BigInt(10)
}

/** Sign with the connected wallet and broadcast on Injective. Resolves with the hash once a block has included it, and throws if it failed there. */
export async function sendInjectiveTx(signer: OfflineDirectSigner, address: string, msgs: EncodeObject[], memo: string): Promise<string> {
  const key = (await signer.getAccounts()).find(x => x.address === address)
  if (!key) throw new Error('The wallet did not return this Injective address')
  const { accountNumber, sequence } = await injectiveAccount(address)
  const gasLimit = await simulateInjective({ pubkey: key.pubkey, sequence, msgs, memo })
  const { bodyBytes, authInfoBytes } = injectiveTxParts({ pubkey: key.pubkey, sequence, msgs, memo, gasLimit })
  // The wallet may adjust the fee, so broadcast exactly what it signed.
  const { signed, signature } = await signer.signDirect(address, makeSignDoc(bodyBytes, authInfoBytes, INJECTIVE_CHAIN_ID, Number(accountNumber)))
  const txBytes = TxRaw.encode(TxRaw.fromPartial({ bodyBytes: signed.bodyBytes, authInfoBytes: signed.authInfoBytes, signatures: [fromBase64(signature.signature)] })).finish()
  const sent = await rest<{ tx_response?: { code?: number; txhash?: string; raw_log?: string } }>('/cosmos/tx/v1beta1/txs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: toBase64(txBytes), mode: 'BROADCAST_MODE_SYNC' }),
  }, 20_000)
  const res = sent?.tx_response
  if (!res?.txhash) throw new Error('Injective did not accept the transaction')
  if (res.code) throw new Error(res.raw_log || `Transaction refused on Injective (code ${res.code})`)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const t = await rest<{ tx_response?: { code?: number; raw_log?: string } }>(`/cosmos/tx/v1beta1/txs/${res.txhash}`).catch(() => null)
    if (!t?.tx_response) continue
    if (t.tx_response.code) throw new Error(t.tx_response.raw_log || `Transaction failed on Injective (code ${t.tx_response.code})`)
    break
  }
  return res.txhash
}
