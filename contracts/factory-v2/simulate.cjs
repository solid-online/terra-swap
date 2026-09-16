// Dry-run factory v2 as the deploy address against the live chain: instantiating the factory,
// the sink and the router, and opening pools with the liquid staking and stable presets.
// Nothing is signed or broadcast (simulate skips signature checks).
//   NODE_PATH=../../node_modules node simulate.cjs
const { MsgInstantiateContract, MsgExecuteContract } = require('cosmjs-types/cosmwasm/wasm/v1/tx')
const { TxBody, AuthInfo, TxRaw } = require('cosmjs-types/cosmos/tx/v1beta1/tx')
const { SignMode } = require('cosmjs-types/cosmos/tx/signing/v1beta1/signing')

const LCD = 'https://terra-lcd.publicnode.com'
const DEPLOYER = 'terra1ef4g5xlfzts7a9c0p22q7wuc6mwjzzekd6afsv'
const V1 = 'terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd'
const ASTRO = 'terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r'
const REGISTRY = 'terra1zuf8fla02926nhpfvk09k2pg6qv9aayflp0qt4a0msppu2h4exqs6af275'

const enc = o => Buffer.from(JSON.stringify(o))
const factoryInit = {
  owner: DEPLOYER,
  token_code_id: 69,
  whitelist_code_id: 70,
  coin_registry_address: REGISTRY,
  fee_address: null,
  generator_address: null,
  pair_configs: [
    { code_id: 2569, pair_type: { custom: 'concentrated' }, total_fee_bps: 0, maker_fee_bps: 0, is_disabled: false, is_generator_disabled: true, permissioned: false },
    { code_id: 428, pair_type: { stable: {} }, total_fee_bps: 5, maker_fee_bps: 0, is_disabled: false, is_generator_disabled: true, permissioned: false },
  ],
}

async function simulate(name, typeUrl, value, encoder) {
  const acc = await fetch(`${LCD}/cosmos/auth/v1beta1/accounts/${DEPLOYER}`).then(r => r.json())
  const sequence = BigInt(acc.account?.sequence ?? acc.account?.base_account?.sequence ?? 0)
  const body = TxBody.fromPartial({ messages: [{ typeUrl, value: encoder.encode(value).finish() }], memo: '' })
  const auth = AuthInfo.fromPartial({ signerInfos: [{ modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } }, sequence }], fee: { amount: [], gasLimit: BigInt(0) } })
  const raw = TxRaw.fromPartial({ bodyBytes: TxBody.encode(body).finish(), authInfoBytes: AuthInfo.encode(auth).finish(), signatures: [new Uint8Array()] })
  const res = await fetch(`${LCD}/cosmos/tx/v1beta1/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx_bytes: Buffer.from(TxRaw.encode(raw).finish()).toString('base64') }) }).then(r => r.json())
  if (res.gas_info) {
    const events = res.result?.events ?? []
    const addr = events.flatMap(e => e.attributes ?? []).find(a => a.key === '_contract_address')?.value
    const owner = events.flatMap(e => e.attributes ?? []).filter(a => /owner|action/.test(a.key)).map(a => `${a.key}=${a.value}`).slice(0, 6)
    console.log(`OK   ${name}: gas ${res.gas_info.gas_used}; new contract ${addr ?? '-'}; ${owner.join(' ')}`)
  } else {
    console.log(`FAIL ${name}: ${res.message ?? JSON.stringify(res).slice(0, 400)}`)
  }
}

;(async () => {
  await simulate('factory v2 instantiate (no admin)', '/cosmwasm.wasm.v1.MsgInstantiateContract',
    MsgInstantiateContract.fromPartial({ sender: DEPLOYER, admin: '', codeId: BigInt(3108), label: 'terra-swap-factory-v2', msg: enc(factoryInit), funds: [] }), MsgInstantiateContract)
  await simulate('sink instantiate (schema, target v1)', '/cosmwasm.wasm.v1.MsgInstantiateContract',
    MsgInstantiateContract.fromPartial({ sender: DEPLOYER, admin: '', codeId: BigInt(4025), label: 'terra-swap-owner-sink-v2', msg: enc({ target: V1 }), funds: [] }), MsgInstantiateContract)
  await simulate('router v2 instantiate (schema, three factories with v1 twice)', '/cosmwasm.wasm.v1.MsgInstantiateContract',
    MsgInstantiateContract.fromPartial({ sender: DEPLOYER, admin: '', codeId: BigInt(4028), label: 'Terra Swap router v2', msg: enc({ factories: [V1, ASTRO, V1] }), funds: [] }), MsgInstantiateContract)
  await simulate('router v2 instantiate (schema, two factories)', '/cosmwasm.wasm.v1.MsgInstantiateContract',
    MsgInstantiateContract.fromPartial({ sender: DEPLOYER, admin: '', codeId: BigInt(4028), label: 'Terra Swap router v2', msg: enc({ factories: [V1, ASTRO] }), funds: [] }), MsgInstantiateContract)
  // Pool creation with the presets, on Astroport's factory, which runs the same pair code: a pair that
  // does not exist yet gets instantiated in the simulation, so the settings are validated by the pair itself.
  const ARB = { token: { contract_addr: 'terra1se7rvuerys4kd2snt6vqswh9wugu49vhyzls8ymc02wl37g2p2ms5yz490' } }
  const BL = { token: { contract_addr: 'terra17aj4ty4sz4yhgm08na8drc0v03v2jwr3waxcqrwhajj729zhl7zqnpc0ml' } }
  const preset = { amp: '500', gamma: '0.01', mid_fee: '0.0003', out_fee: '0.0045', fee_gamma: '0.3', repeg_profit_threshold: '0.00000001', min_price_scale_delta: '0.0000055', price_scale: '1.2', ma_half_time: 600, track_asset_balances: false }
  await simulate('concentrated pool, liquid staking preset', '/cosmwasm.wasm.v1.MsgExecuteContract',
    MsgExecuteContract.fromPartial({ sender: DEPLOYER, contract: ASTRO, msg: enc({ create_pair: { pair_type: { custom: 'concentrated' }, asset_infos: [ARB, BL], init_params: Buffer.from(JSON.stringify(preset)).toString('base64') } }), funds: [] }), MsgExecuteContract)
  await simulate('stable pool, amp 10', '/cosmwasm.wasm.v1.MsgExecuteContract',
    MsgExecuteContract.fromPartial({ sender: DEPLOYER, contract: ASTRO, msg: enc({ create_pair: { pair_type: { stable: {} }, asset_infos: [ARB, BL], init_params: Buffer.from(JSON.stringify({ amp: 10 })).toString('base64') } }), funds: [] }), MsgExecuteContract)
})()
