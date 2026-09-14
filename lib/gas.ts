/**
 * What a transaction costs in LUNA, before anyone signs it.
 *
 * The chain simulates a transaction that carries no signature (the 2026-09-13
 * audit checked every message against real balances the same way), and the
 * wallet is asked for gas × GAS_MULTIPLIER × GAS_PRICE. Both numbers are the
 * ones the wallet kit signs Terra transactions with
 * (components/providers/ChainProvider, and cosmjs's 'auto' fee), so the
 * figure shown is the fee the wallet will propose.
 */

import { Registry, type EncodeObject } from '@cosmjs/proto-signing'
import { defaultRegistryTypes } from '@cosmjs/stargate'
import { wasmTypes } from '@cosmjs/cosmwasm-stargate'
import { toBase64 } from '@cosmjs/encoding'
import { AuthInfo, Fee, SignerInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing'
import { lcdFetch } from 'lib/lcd'

/** The gas price Terra transactions are signed with. */
export const GAS_PRICE = '0.15uluna'
const GAS_PRICE_ULUNA = 0.15
/** cosmjs 0.36 multiplies simulated gas by this for an 'auto' fee. */
export const GAS_MULTIPLIER = 1.4

const registry = new Registry([...defaultRegistryTypes, ...wasmTypes])

/** The next sequence of an account. Vesting accounts keep it under base_vesting_account.base_account. */
async function sequenceOf(address: string): Promise<bigint> {
  const r = await lcdFetch(`/cosmos/auth/v1beta1/accounts/${address}`)
  if (!r.ok) throw new Error('This account is not on chain yet')
  let a = (await r.json())?.account
  for (let i = 0; i < 4 && a && a.sequence == null; i++) a = a.base_account ?? a.base_vesting_account ?? null
  return BigInt(a?.sequence ?? 0)
}

/**
 * The fee the wallet will ask for, in uluna, and the gas behind it. Throws when
 * the chain would refuse the transaction (not enough balance, a limit that
 * cannot be met), in which case there is no fee to show.
 */
export async function estimateFee(sender: string, msgs: EncodeObject[], memo = ''): Promise<{ gas: number; uluna: string }> {
  const body = TxBody.fromPartial({ messages: msgs.map(m => registry.encodeAsAny(m)), memo })
  const authInfo = AuthInfo.fromPartial({
    signerInfos: [SignerInfo.fromPartial({ modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } }, sequence: await sequenceOf(sender) })],
    fee: Fee.fromPartial({ amount: [], gasLimit: BigInt(0) }),
  })
  const raw = TxRaw.encode(TxRaw.fromPartial({
    bodyBytes: TxBody.encode(body).finish(),
    authInfoBytes: AuthInfo.encode(authInfo).finish(),
    signatures: [new Uint8Array()],
  })).finish()
  const r = await lcdFetch('/cosmos/tx/v1beta1/simulate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: toBase64(raw) }),
    timeoutMs: 15_000,
  })
  const j = await r.json().catch(() => null)
  const used = Number(j?.gas_info?.gas_used)
  if (!r.ok || !(used > 0)) throw new Error(j?.message ?? 'The chain did not simulate this transaction')
  const gas = Math.round(used * GAS_MULTIPLIER)
  return { gas, uluna: String(Math.ceil(gas * GAS_PRICE_ULUNA)) }
}
