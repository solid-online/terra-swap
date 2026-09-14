//! Terra Swap router.
//!
//! One transaction, several swaps, pools on more than one Astroport factory.
//!
//! Astroport's router looks every pair up in Astroport's factory, so a route
//! that crosses into Terra Swap's pools (a second factory running the same
//! pair code) had to be signed as separate swap messages. Separate messages
//! cannot hand one swap's actual return to the next: each later swap had to
//! offer the least the one before it could return, and the rest stayed in the
//! wallet as an intermediate token, about the slippage setting per hop
//! (measured 2026-09-14: 0.177 SOLID left over on a 20 USDC.inj to LUNA route).
//!
//! This router takes each hop's pair from a factory on its fixed list, swaps
//! everything it holds of the offered token, keeps each intermediate return
//! for the next hop, sends the last return straight to the receiver, and
//! reverts the whole transaction unless at least `minimum_receive` arrived.
//!
//! No owner, no admin, no fee, no migrate entry point. The factory list is set
//! when the contract is instantiated and can never change. Between
//! transactions the router holds nothing.

use std::fmt;

use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{
    entry_point, from_json, to_json_binary, Addr, Api, Binary, Coin, CosmosMsg, Decimal, Deps, DepsMut, Env,
    MessageInfo, QuerierWrapper, Response, StdError, StdResult, Uint128, WasmMsg,
};
use cw2::set_contract_version;
use cw20::{BalanceResponse, Cw20ExecuteMsg, Cw20QueryMsg, Cw20ReceiveMsg};
use cw_storage_plus::Item;
use serde::Deserialize;
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:terra-swap-router";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The longest route the router accepts.
pub const MAX_OPERATIONS: usize = 6;

/// Astroport pairs refuse a max_spread above 50%. With no belief price it only
/// caps each pool's own price impact; the route's minimum is what protects the trade.
fn max_spread() -> Decimal {
    Decimal::percent(50)
}

// ─── Messages ───────────────────────────────────────────────────

/// Astroport's asset info, same JSON: `{"token":{"contract_addr":…}}` or `{"native_token":{"denom":…}}`.
#[cw_serde]
pub enum AssetInfo {
    Token { contract_addr: Addr },
    NativeToken { denom: String },
}

impl fmt::Display for AssetInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AssetInfo::Token { contract_addr } => write!(f, "{contract_addr}"),
            AssetInfo::NativeToken { denom } => write!(f, "{denom}"),
        }
    }
}

#[cw_serde]
pub struct Asset {
    pub info: AssetInfo,
    pub amount: Uint128,
}

#[cw_serde]
pub struct InstantiateMsg {
    /// Factories whose pairs the router may swap through. Fixed forever.
    pub factories: Vec<String>,
}

#[cw_serde]
pub struct SwapOperation {
    /// The factory that owns the pair for these two assets. It must be on the router's list.
    pub factory: String,
    pub offer_asset_info: AssetInfo,
    pub ask_asset_info: AssetInfo,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Start a route with a cw20 token: send it here with a `Cw20HookMsg` as the message.
    Receive(Cw20ReceiveMsg),
    /// Start a route with a native token: attach exactly one coin, the first operation's offer.
    ExecuteSwapOperations {
        operations: Vec<SwapOperation>,
        minimum_receive: Uint128,
        /// who receives the output; the sender when absent
        to: Option<String>,
    },
    /// Internal: one hop, with everything the router holds of the offered token. Only the router may call it.
    ExecuteSwapOperation { operation: SwapOperation, to: Option<String> },
    /// Internal: the last step of every route. Only the router may call it.
    AssertMinimumReceive { asset_info: AssetInfo, prev_balance: Uint128, minimum_receive: Uint128, receiver: String },
}

#[cw_serde]
pub enum Cw20HookMsg {
    ExecuteSwapOperations { operations: Vec<SwapOperation>, minimum_receive: Uint128, to: Option<String> },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(ConfigResponse)]
    Config {},
}

#[cw_serde]
pub struct ConfigResponse {
    pub factories: Vec<Addr>,
}

/// What the router sends a pair. Only fields every Astroport pair type on Terra accepts:
/// the pairs reject unknown fields, so nothing optional is written unless it is set.
#[cw_serde]
enum PairExecuteMsg {
    Swap {
        offer_asset: Asset,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_spread: Option<Decimal>,
        #[serde(skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
}

#[cw_serde]
enum PairCw20HookMsg {
    Swap {
        #[serde(skip_serializing_if = "Option::is_none")]
        max_spread: Option<Decimal>,
        #[serde(skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
}

#[cw_serde]
enum FactoryQueryMsg {
    Pair { asset_infos: Vec<AssetInfo> },
}

/// The part of a factory's pair answer the router reads. Not `cw_serde`: the answer carries more fields.
#[derive(Deserialize)]
struct PairInfoResponse {
    asset_infos: Vec<AssetInfo>,
    contract_addr: String,
}

pub const FACTORIES: Item<Vec<Addr>> = Item::new("factories");

// ─── Errors ─────────────────────────────────────────────────────

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),
    #[error("At least one factory is required")]
    NoFactories {},
    #[error("A route needs between 1 and {max} operations")]
    OperationCount { max: usize },
    #[error("Operation {index} uses a factory the router does not know: {factory}")]
    UnknownFactory { index: usize, factory: String },
    #[error("Operation {index} offers and asks for the same token")]
    SameAsset { index: usize },
    #[error("Operation {index} offers a token the operation before it does not return")]
    BrokenRoute { index: usize },
    #[error("Send exactly one coin, the first operation's offer")]
    InvalidFunds {},
    #[error("The token sent is not the first operation's offer")]
    WrongOffer {},
    #[error("Nothing to swap")]
    NothingToSwap {},
    #[error("The router cannot receive the output")]
    ReceiverIsRouter {},
    #[error("The factory answered with a pair for other tokens")]
    PairMismatch {},
    #[error("Only the router itself can do that")]
    Unauthorized {},
    #[error("Received {amount}, less than the minimum {minimum}")]
    MinimumReceive { minimum: Uint128, amount: Uint128 },
}

// ─── Entry points ───────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(deps: DepsMut, _env: Env, _info: MessageInfo, msg: InstantiateMsg) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let mut factories: Vec<Addr> = vec![];
    for f in msg.factories {
        let a = deps.api.addr_validate(&f)?;
        if !factories.contains(&a) {
            factories.push(a);
        }
    }
    if factories.is_empty() {
        return Err(ContractError::NoFactories {});
    }
    FACTORIES.save(deps.storage, &factories)?;
    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("factories", factories.iter().map(|a| a.as_str()).collect::<Vec<_>>().join(",")))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(deps: DepsMut, env: Env, info: MessageInfo, msg: ExecuteMsg) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Receive(r) => {
            if !info.funds.is_empty() {
                return Err(ContractError::InvalidFunds {});
            }
            let Cw20HookMsg::ExecuteSwapOperations { operations, minimum_receive, to } = from_json(&r.msg)?;
            let sender = deps.api.addr_validate(&r.sender)?;
            let offered = AssetInfo::Token { contract_addr: info.sender };
            start(deps, env, sender, offered, r.amount, operations, minimum_receive, to)
        }
        ExecuteMsg::ExecuteSwapOperations { operations, minimum_receive, to } => {
            if info.funds.len() != 1 {
                return Err(ContractError::InvalidFunds {});
            }
            let coin = info.funds[0].clone();
            let offered = AssetInfo::NativeToken { denom: coin.denom };
            start(deps, env, info.sender, offered, coin.amount, operations, minimum_receive, to)
        }
        ExecuteMsg::ExecuteSwapOperation { operation, to } => {
            if info.sender != env.contract.address {
                return Err(ContractError::Unauthorized {});
            }
            swap_operation(deps, env, operation, to)
        }
        ExecuteMsg::AssertMinimumReceive { asset_info, prev_balance, minimum_receive, receiver } => {
            if info.sender != env.contract.address {
                return Err(ContractError::Unauthorized {});
            }
            assert_minimum_receive(deps.as_ref(), asset_info, prev_balance, minimum_receive, receiver)
        }
    }
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&ConfigResponse { factories: FACTORIES.load(deps.storage)? }),
    }
}

// ─── Route ──────────────────────────────────────────────────────

fn validate_asset(api: &dyn Api, asset: &AssetInfo) -> StdResult<()> {
    if let AssetInfo::Token { contract_addr } = asset {
        api.addr_validate(contract_addr.as_str())?;
    }
    Ok(())
}

fn self_call(env: &Env, msg: &ExecuteMsg) -> StdResult<CosmosMsg> {
    Ok(WasmMsg::Execute { contract_addr: env.contract.address.to_string(), msg: to_json_binary(msg)?, funds: vec![] }.into())
}

#[allow(clippy::too_many_arguments)]
fn start(
    deps: DepsMut,
    env: Env,
    sender: Addr,
    offered: AssetInfo,
    amount: Uint128,
    operations: Vec<SwapOperation>,
    minimum_receive: Uint128,
    to: Option<String>,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::NothingToSwap {});
    }
    let n = operations.len();
    if n == 0 || n > MAX_OPERATIONS {
        return Err(ContractError::OperationCount { max: MAX_OPERATIONS });
    }
    let factories = FACTORIES.load(deps.storage)?;
    for (i, op) in operations.iter().enumerate() {
        let factory = deps.api.addr_validate(&op.factory)?;
        if !factories.contains(&factory) {
            return Err(ContractError::UnknownFactory { index: i, factory: op.factory.clone() });
        }
        validate_asset(deps.api, &op.offer_asset_info)?;
        validate_asset(deps.api, &op.ask_asset_info)?;
        if op.offer_asset_info == op.ask_asset_info {
            return Err(ContractError::SameAsset { index: i });
        }
        if i > 0 && operations[i - 1].ask_asset_info != op.offer_asset_info {
            return Err(ContractError::BrokenRoute { index: i });
        }
    }
    if operations[0].offer_asset_info != offered {
        return Err(ContractError::WrongOffer {});
    }
    let receiver = match to {
        Some(t) => deps.api.addr_validate(&t)?,
        None => sender,
    };
    if receiver == env.contract.address {
        return Err(ContractError::ReceiverIsRouter {});
    }
    let target = operations[n - 1].ask_asset_info.clone();
    let prev_balance = balance_of(&deps.querier, &target, &receiver)?;

    let mut msgs: Vec<CosmosMsg> = Vec::with_capacity(n + 1);
    for (i, operation) in operations.into_iter().enumerate() {
        let to = if i == n - 1 { Some(receiver.to_string()) } else { None };
        msgs.push(self_call(&env, &ExecuteMsg::ExecuteSwapOperation { operation, to })?);
    }
    msgs.push(self_call(
        &env,
        &ExecuteMsg::AssertMinimumReceive { asset_info: target.clone(), prev_balance, minimum_receive, receiver: receiver.to_string() },
    )?);

    Ok(Response::new()
        .add_messages(msgs)
        .add_attribute("action", "execute_swap_operations")
        .add_attribute("operations", n.to_string())
        .add_attribute("offer_asset", offered.to_string())
        .add_attribute("offer_amount", amount)
        .add_attribute("ask_asset", target.to_string())
        .add_attribute("minimum_receive", minimum_receive)
        .add_attribute("receiver", receiver))
}

fn pair_of(querier: &QuerierWrapper, op: &SwapOperation) -> Result<String, ContractError> {
    let info: PairInfoResponse = querier.query_wasm_smart(
        &op.factory,
        &FactoryQueryMsg::Pair { asset_infos: vec![op.offer_asset_info.clone(), op.ask_asset_info.clone()] },
    )?;
    if !(info.asset_infos.contains(&op.offer_asset_info) && info.asset_infos.contains(&op.ask_asset_info)) {
        return Err(ContractError::PairMismatch {});
    }
    Ok(info.contract_addr)
}

fn balance_of(querier: &QuerierWrapper, asset: &AssetInfo, who: &Addr) -> StdResult<Uint128> {
    match asset {
        AssetInfo::NativeToken { denom } => Ok(querier.query_balance(who, denom)?.amount),
        AssetInfo::Token { contract_addr } => {
            let r: BalanceResponse = querier.query_wasm_smart(contract_addr, &Cw20QueryMsg::Balance { address: who.to_string() })?;
            Ok(r.balance)
        }
    }
}

fn swap_operation(deps: DepsMut, env: Env, op: SwapOperation, to: Option<String>) -> Result<Response, ContractError> {
    let pair = pair_of(&deps.querier, &op)?;
    // Everything the router holds of the offered token: on the first hop what the sender just sent,
    // on every later hop the whole return of the hop before.
    let amount = balance_of(&deps.querier, &op.offer_asset_info, &env.contract.address)?;
    if amount.is_zero() {
        return Err(ContractError::NothingToSwap {});
    }
    let msg: CosmosMsg = match &op.offer_asset_info {
        AssetInfo::NativeToken { denom } => WasmMsg::Execute {
            contract_addr: pair.clone(),
            msg: to_json_binary(&PairExecuteMsg::Swap {
                offer_asset: Asset { info: op.offer_asset_info.clone(), amount },
                max_spread: Some(max_spread()),
                to,
            })?,
            funds: vec![Coin { denom: denom.clone(), amount }],
        }
        .into(),
        AssetInfo::Token { contract_addr } => WasmMsg::Execute {
            contract_addr: contract_addr.to_string(),
            msg: to_json_binary(&Cw20ExecuteMsg::Send {
                contract: pair.clone(),
                amount,
                msg: to_json_binary(&PairCw20HookMsg::Swap { max_spread: Some(max_spread()), to })?,
            })?,
            funds: vec![],
        }
        .into(),
    };
    Ok(Response::new()
        .add_message(msg)
        .add_attribute("action", "swap_operation")
        .add_attribute("pair", pair)
        .add_attribute("offer_asset", op.offer_asset_info.to_string())
        .add_attribute("offer_amount", amount))
}

fn assert_minimum_receive(
    deps: Deps,
    asset_info: AssetInfo,
    prev_balance: Uint128,
    minimum_receive: Uint128,
    receiver: String,
) -> Result<Response, ContractError> {
    let receiver = deps.api.addr_validate(&receiver)?;
    let now = balance_of(&deps.querier, &asset_info, &receiver)?;
    let received = now.checked_sub(prev_balance).unwrap_or_default();
    if received < minimum_receive {
        return Err(ContractError::MinimumReceive { minimum: minimum_receive, amount: received });
    }
    Ok(Response::new()
        .add_attribute("action", "assert_minimum_receive")
        .add_attribute("received", received)
        .add_attribute("minimum_receive", minimum_receive))
}

// ─── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::{coins, Empty};
    use cw20::Cw20Coin;
    use cw_multi_test::{App, Contract, ContractWrapper, Executor};

    /// A pair as strict as Astroport's about its messages (unknown fields are refused),
    /// trading at a fixed price, paying out to `to` or to whoever sent the offer.
    mod pair {
        use super::super::{Asset, AssetInfo};
        use cosmwasm_schema::cw_serde;
        use cosmwasm_std::{
            from_json, to_json_binary, Addr, BankMsg, Binary, Coin, CosmosMsg, Decimal, Deps, DepsMut, Env,
            MessageInfo, Response, StdError, StdResult, WasmMsg,
        };
        use cw20::{Cw20ExecuteMsg, Cw20ReceiveMsg};
        use cw_storage_plus::Item;

        #[cw_serde]
        pub struct Inst {
            pub assets: [AssetInfo; 2],
            /// asset 1 received per asset 0 offered is num / den
            pub num: u128,
            pub den: u128,
        }
        #[cw_serde]
        pub enum Exec {
            Swap { offer_asset: Asset, max_spread: Option<Decimal>, to: Option<String> },
            Receive(Cw20ReceiveMsg),
        }
        #[cw_serde]
        pub enum Hook {
            Swap { max_spread: Option<Decimal>, to: Option<String> },
        }
        #[cw_serde]
        pub enum Query {
            Nothing {},
        }
        const CFG: Item<Inst> = Item::new("cfg");

        pub fn instantiate(deps: DepsMut, _: Env, _: MessageInfo, m: Inst) -> StdResult<Response> {
            CFG.save(deps.storage, &m)?;
            Ok(Response::new())
        }
        pub fn execute(deps: DepsMut, _: Env, info: MessageInfo, m: Exec) -> StdResult<Response> {
            let cfg = CFG.load(deps.storage)?;
            let (offer, amount, sender, to, spread) = match m {
                Exec::Swap { offer_asset, max_spread, to } => {
                    let AssetInfo::NativeToken { denom } = &offer_asset.info else {
                        return Err(StdError::generic_err("cw20 offers come through Receive"));
                    };
                    if info.funds.len() != 1 || &info.funds[0].denom != denom || info.funds[0].amount != offer_asset.amount {
                        return Err(StdError::generic_err("funds do not match the offer"));
                    }
                    (offer_asset.info, offer_asset.amount, info.sender, to, max_spread)
                }
                Exec::Receive(r) => {
                    let Hook::Swap { max_spread, to } = from_json(&r.msg)?;
                    (AssetInfo::Token { contract_addr: info.sender }, r.amount, Addr::unchecked(r.sender), to, max_spread)
                }
            };
            if spread.map_or(false, |s| s > Decimal::percent(50)) {
                return Err(StdError::generic_err("max spread above 50%"));
            }
            let (ask, out) = if offer == cfg.assets[0] {
                (cfg.assets[1].clone(), amount.multiply_ratio(cfg.num, cfg.den))
            } else if offer == cfg.assets[1] {
                (cfg.assets[0].clone(), amount.multiply_ratio(cfg.den, cfg.num))
            } else {
                return Err(StdError::generic_err("asset not in this pair"));
            };
            let recipient = to.unwrap_or_else(|| sender.to_string());
            let msg: CosmosMsg = match &ask {
                AssetInfo::NativeToken { denom } => BankMsg::Send { to_address: recipient, amount: vec![Coin { denom: denom.clone(), amount: out }] }.into(),
                AssetInfo::Token { contract_addr } => WasmMsg::Execute {
                    contract_addr: contract_addr.to_string(),
                    msg: to_json_binary(&Cw20ExecuteMsg::Transfer { recipient, amount: out })?,
                    funds: vec![],
                }
                .into(),
            };
            Ok(Response::new().add_message(msg).add_attribute("return_amount", out))
        }
        pub fn query(_: Deps, _: Env, _: Query) -> StdResult<Binary> {
            Err(StdError::generic_err("no queries"))
        }
    }

    /// A factory that answers `pair` in either asset order, with the extra fields a real one returns.
    mod factory {
        use super::super::AssetInfo;
        use cosmwasm_schema::cw_serde;
        use cosmwasm_std::{to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdError, StdResult};
        use cw_storage_plus::Item;

        #[cw_serde]
        pub struct Inst {}
        #[cw_serde]
        pub enum Exec {
            Register { pair: String, assets: [AssetInfo; 2] },
        }
        #[cw_serde]
        pub enum Query {
            Pair { asset_infos: Vec<AssetInfo> },
        }
        #[cw_serde]
        pub enum PairType {
            Xyk {},
        }
        #[cw_serde]
        pub struct PairInfo {
            pub asset_infos: Vec<AssetInfo>,
            pub contract_addr: String,
            pub liquidity_token: String,
            pub pair_type: PairType,
        }
        const PAIRS: Item<Vec<(String, [AssetInfo; 2])>> = Item::new("pairs");

        pub fn instantiate(deps: DepsMut, _: Env, _: MessageInfo, _: Inst) -> StdResult<Response> {
            PAIRS.save(deps.storage, &vec![])?;
            Ok(Response::new())
        }
        pub fn execute(deps: DepsMut, _: Env, _: MessageInfo, m: Exec) -> StdResult<Response> {
            let Exec::Register { pair, assets } = m;
            let mut all = PAIRS.load(deps.storage)?;
            all.push((pair, assets));
            PAIRS.save(deps.storage, &all)?;
            Ok(Response::new())
        }
        pub fn query(deps: Deps, _: Env, m: Query) -> StdResult<Binary> {
            let Query::Pair { asset_infos } = m;
            let found = PAIRS
                .load(deps.storage)?
                .into_iter()
                .find(|(_, a)| asset_infos.len() == 2 && a.contains(&asset_infos[0]) && a.contains(&asset_infos[1]))
                .ok_or_else(|| StdError::generic_err("Pair not found"))?;
            to_json_binary(&PairInfo {
                asset_infos: found.1.to_vec(),
                contract_addr: found.0,
                liquidity_token: "lp".into(),
                pair_type: PairType::Xyk {},
            })
        }
    }

    fn router_code() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(execute, instantiate, query))
    }
    fn pair_code() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(pair::execute, pair::instantiate, pair::query))
    }
    fn factory_code() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(factory::execute, factory::instantiate, factory::query))
    }
    fn cw20_code() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(cw20_base::contract::execute, cw20_base::contract::instantiate, cw20_base::contract::query))
    }

    const USER: &str = "user";
    const WHALE: &str = "whale";

    struct World {
        app: App,
        router: Addr,
        /// "Terra Swap": USDC/SOLID at 2 SOLID per USDC
        fac_a: Addr,
        /// "Astroport": SOLID/LUNA at 10 LUNA per SOLID, LUNA/USDC at 1 USDC per 20 LUNA
        fac_b: Addr,
        /// a factory the router was not given
        fac_x: Addr,
        solid: Addr,
    }

    fn native(d: &str) -> AssetInfo {
        AssetInfo::NativeToken { denom: d.into() }
    }
    fn token(a: &Addr) -> AssetInfo {
        AssetInfo::Token { contract_addr: a.clone() }
    }
    fn op(f: &Addr, offer: AssetInfo, ask: AssetInfo) -> SwapOperation {
        SwapOperation { factory: f.to_string(), offer_asset_info: offer, ask_asset_info: ask }
    }
    fn text(e: anyhow::Error) -> String {
        format!("{e:#}")
    }

    fn world() -> World {
        let mut app = App::new(|router, _, storage| {
            // A denom no pool trades, so sending the wrong coin reaches the router instead of failing in the bank.
            let mut user = coins(1_000, "uatom");
            user.extend(coins(1_000_000, "uusdc"));
            router.bank.init_balance(storage, &Addr::unchecked(USER), user).unwrap();
            let mut whale = coins(1_000_000_000, "uluna");
            whale.extend(coins(1_000_000_000, "uusdc"));
            router.bank.init_balance(storage, &Addr::unchecked(WHALE), whale).unwrap();
        });
        let whale = Addr::unchecked(WHALE);
        let cw20 = app.store_code(cw20_code());
        let solid = app
            .instantiate_contract(
                cw20,
                whale.clone(),
                &cw20_base::msg::InstantiateMsg {
                    name: "Solid".into(),
                    symbol: "SOLID".into(),
                    decimals: 6,
                    initial_balances: vec![
                        Cw20Coin { address: WHALE.into(), amount: Uint128::new(1_000_000_000) },
                        Cw20Coin { address: USER.into(), amount: Uint128::new(1_000) },
                    ],
                    mint: None,
                    marketing: None,
                },
                &[],
                "solid",
                None,
            )
            .unwrap();
        let fcode = app.store_code(factory_code());
        let fac_a = app.instantiate_contract(fcode, whale.clone(), &factory::Inst {}, &[], "terra swap", None).unwrap();
        let fac_b = app.instantiate_contract(fcode, whale.clone(), &factory::Inst {}, &[], "astroport", None).unwrap();
        let fac_x = app.instantiate_contract(fcode, whale.clone(), &factory::Inst {}, &[], "stranger", None).unwrap();
        let pcode = app.store_code(pair_code());
        let add_pair = |app: &mut App, fac: &Addr, a: AssetInfo, b: AssetInfo, num: u128, den: u128| {
            let p = app
                .instantiate_contract(pcode, whale.clone(), &pair::Inst { assets: [a.clone(), b.clone()], num, den }, &[], "pair", None)
                .unwrap();
            app.execute_contract(whale.clone(), fac.clone(), &factory::Exec::Register { pair: p.to_string(), assets: [a, b] }, &[]).unwrap();
            // Reserves on both sides.
            app.send_tokens(whale.clone(), p.clone(), &coins(100_000_000, "uluna")).unwrap();
            app.send_tokens(whale.clone(), p.clone(), &coins(100_000_000, "uusdc")).unwrap();
            app.execute_contract(whale.clone(), solid.clone(), &Cw20ExecuteMsg::Transfer { recipient: p.to_string(), amount: Uint128::new(100_000_000) }, &[]).unwrap();
            p
        };
        add_pair(&mut app, &fac_a, native("uusdc"), token(&solid), 2, 1);
        add_pair(&mut app, &fac_b, token(&solid), native("uluna"), 10, 1);
        add_pair(&mut app, &fac_b, native("uluna"), native("uusdc"), 1, 20);
        // The stranger factory has a pair too, so rejecting it is about the list, not a missing pair.
        add_pair(&mut app, &fac_x, native("uusdc"), token(&solid), 3, 1);
        let rcode = app.store_code(router_code());
        let router = app
            .instantiate_contract(
                rcode,
                whale.clone(),
                &InstantiateMsg { factories: vec![fac_a.to_string(), fac_b.to_string(), fac_a.to_string()] },
                &[],
                "router",
                None,
            )
            .unwrap();
        World { app, router, fac_a, fac_b, fac_x, solid }
    }

    fn native_balance(w: &World, who: &str, denom: &str) -> u128 {
        w.app.wrap().query_balance(who, denom).unwrap().amount.u128()
    }
    fn solid_balance(w: &World, who: &str) -> u128 {
        let r: BalanceResponse = w.app.wrap().query_wasm_smart(&w.solid, &Cw20QueryMsg::Balance { address: who.into() }).unwrap();
        r.balance.u128()
    }
    fn assert_router_empty(w: &World) {
        let r = w.router.as_str();
        assert_eq!(native_balance(w, r, "uusdc"), 0, "router kept USDC");
        assert_eq!(native_balance(w, r, "uluna"), 0, "router kept LUNA");
        assert_eq!(solid_balance(w, r), 0, "router kept SOLID");
    }

    /// The exact JSON a hop sends a pair. Astroport's pairs refuse unknown fields, so this is pinned,
    /// and the same bytes were simulated against Terra Swap's and Astroport's pairs on mainnet.
    #[test]
    fn pair_messages_carry_only_fields_astroport_pairs_accept() {
        let offer = Asset { info: native("uluna"), amount: Uint128::new(5) };
        let hop = cosmwasm_std::to_json_string(&PairExecuteMsg::Swap { offer_asset: offer.clone(), max_spread: Some(max_spread()), to: None }).unwrap();
        assert_eq!(hop, r#"{"swap":{"offer_asset":{"info":{"native_token":{"denom":"uluna"}},"amount":"5"},"max_spread":"0.5"}}"#);
        let last = cosmwasm_std::to_json_string(&PairExecuteMsg::Swap { offer_asset: offer, max_spread: Some(max_spread()), to: Some("terra1receiver".into()) }).unwrap();
        assert_eq!(last, r#"{"swap":{"offer_asset":{"info":{"native_token":{"denom":"uluna"}},"amount":"5"},"max_spread":"0.5","to":"terra1receiver"}}"#);
        let hook = cosmwasm_std::to_json_string(&PairCw20HookMsg::Swap { max_spread: Some(max_spread()), to: None }).unwrap();
        assert_eq!(hook, r#"{"swap":{"max_spread":"0.5"}}"#);
        let lookup = cosmwasm_std::to_json_string(&FactoryQueryMsg::Pair { asset_infos: vec![native("uluna"), native("uusdc")] }).unwrap();
        assert_eq!(lookup, r#"{"pair":{"asset_infos":[{"native_token":{"denom":"uluna"}},{"native_token":{"denom":"uusdc"}}]}}"#);
    }

    #[test]
    fn config_is_the_deduplicated_list() {
        let w = world();
        let c: ConfigResponse = w.app.wrap().query_wasm_smart(&w.router, &QueryMsg::Config {}).unwrap();
        assert_eq!(c.factories, vec![w.fac_a.clone(), w.fac_b.clone()]);
    }

    #[test]
    fn no_factories_is_refused() {
        let mut app = App::default();
        let code = app.store_code(router_code());
        let e = app.instantiate_contract(code, Addr::unchecked(WHALE), &InstantiateMsg { factories: vec![] }, &[], "r", None).unwrap_err();
        assert!(text(e).contains("At least one factory"));
    }

    #[test]
    fn native_route_across_two_factories_delivers_every_hop_in_full() {
        let mut w = world();
        let ops = vec![op(&w.fac_a, native("uusdc"), token(&w.solid)), op(&w.fac_b, token(&w.solid), native("uluna"))];
        w.app
            .execute_contract(
                Addr::unchecked(USER),
                w.router.clone(),
                &ExecuteMsg::ExecuteSwapOperations { operations: ops, minimum_receive: Uint128::new(2_000), to: None },
                &coins(100, "uusdc"),
            )
            .unwrap();
        // 100 USDC → 200 SOLID → 2,000 LUNA, all of it.
        assert_eq!(native_balance(&w, USER, "uluna"), 2_000);
        assert_eq!(native_balance(&w, USER, "uusdc"), 1_000_000 - 100);
        assert_eq!(solid_balance(&w, USER), 1_000, "no intermediate token reached the wallet");
        assert_router_empty(&w);
    }

    #[test]
    fn cw20_route_with_three_hops_and_another_receiver() {
        let mut w = world();
        let ops = vec![
            op(&w.fac_b, token(&w.solid), native("uluna")),
            op(&w.fac_b, native("uluna"), native("uusdc")),
            op(&w.fac_a, native("uusdc"), token(&w.solid)),
        ];
        let hook = Cw20HookMsg::ExecuteSwapOperations { operations: ops, minimum_receive: Uint128::new(1_000), to: Some("bob".into()) };
        w.app
            .execute_contract(
                Addr::unchecked(USER),
                w.solid.clone(),
                &Cw20ExecuteMsg::Send { contract: w.router.to_string(), amount: Uint128::new(1_000), msg: to_json_binary(&hook).unwrap() },
                &[],
            )
            .unwrap();
        // 1,000 SOLID → 10,000 LUNA → 500 USDC → 1,000 SOLID, to bob.
        assert_eq!(solid_balance(&w, "bob"), 1_000);
        assert_eq!(solid_balance(&w, USER), 0);
        assert_eq!(native_balance(&w, USER, "uluna"), 0);
        assert_router_empty(&w);
    }

    #[test]
    fn a_route_back_to_the_starting_token_checks_what_came_back() {
        let mut w = world();
        let ops = vec![op(&w.fac_a, native("uusdc"), token(&w.solid)), op(&w.fac_b, token(&w.solid), native("uluna")), op(&w.fac_b, native("uluna"), native("uusdc"))];
        // 100 USDC → 200 SOLID → 2,000 LUNA → 100 USDC: exactly the 100 that left.
        w.app
            .execute_contract(Addr::unchecked(USER), w.router.clone(), &ExecuteMsg::ExecuteSwapOperations { operations: ops.clone(), minimum_receive: Uint128::new(100), to: None }, &coins(100, "uusdc"))
            .unwrap();
        assert_eq!(native_balance(&w, USER, "uusdc"), 1_000_000);
        let e = w
            .app
            .execute_contract(Addr::unchecked(USER), w.router.clone(), &ExecuteMsg::ExecuteSwapOperations { operations: ops, minimum_receive: Uint128::new(101), to: None }, &coins(100, "uusdc"))
            .unwrap_err();
        assert!(text(e).contains("Received 100, less than the minimum 101"));
        assert_router_empty(&w);
    }

    #[test]
    fn short_of_the_minimum_reverts_everything() {
        let mut w = world();
        let ops = vec![op(&w.fac_a, native("uusdc"), token(&w.solid)), op(&w.fac_b, token(&w.solid), native("uluna"))];
        let e = w
            .app
            .execute_contract(Addr::unchecked(USER), w.router.clone(), &ExecuteMsg::ExecuteSwapOperations { operations: ops, minimum_receive: Uint128::new(2_001), to: None }, &coins(100, "uusdc"))
            .unwrap_err();
        assert!(text(e).contains("Received 2000, less than the minimum 2001"));
        assert_eq!(native_balance(&w, USER, "uusdc"), 1_000_000, "the USDC never left");
        assert_eq!(native_balance(&w, USER, "uluna"), 0);
        assert_router_empty(&w);
    }

    #[test]
    fn bad_routes_and_funds_are_refused() {
        let mut w = world();
        let user = Addr::unchecked(USER);
        let usdc_solid_a = op(&w.fac_a, native("uusdc"), token(&w.solid));
        let solid_luna_b = op(&w.fac_b, token(&w.solid), native("uluna"));
        let run = |w: &mut World, ops: Vec<SwapOperation>, funds: Vec<Coin>, to: Option<String>| {
            let r = w.router.clone();
            text(w.app.execute_contract(user.clone(), r, &ExecuteMsg::ExecuteSwapOperations { operations: ops, minimum_receive: Uint128::new(1), to }, &funds).unwrap_err())
        };
        let fx = w.fac_x.clone();
        let solid = w.solid.clone();
        assert!(run(&mut w, vec![op(&fx, native("uusdc"), token(&solid))], coins(10, "uusdc"), None).contains("factory the router does not know"));
        assert!(run(&mut w, vec![], coins(10, "uusdc"), None).contains("between 1 and 6"));
        assert!(run(&mut w, vec![usdc_solid_a.clone(); 7], coins(10, "uusdc"), None).contains("between 1 and 6"));
        assert!(run(&mut w, vec![usdc_solid_a.clone(), usdc_solid_a.clone()], coins(10, "uusdc"), None).contains("operation before it does not return"));
        let fa = w.fac_a.clone();
        assert!(run(&mut w, vec![op(&fa, native("uusdc"), native("uusdc"))], coins(10, "uusdc"), None).contains("same token"));
        assert!(run(&mut w, vec![solid_luna_b.clone()], coins(10, "uusdc"), None).contains("not the first operation's offer"));
        assert!(run(&mut w, vec![usdc_solid_a.clone()], coins(10, "uatom"), None).contains("not the first operation's offer"));
        assert!(run(&mut w, vec![usdc_solid_a.clone()], vec![], None).contains("exactly one coin"));
        let mut two = coins(10, "uatom");
        two.extend(coins(10, "uusdc"));
        assert!(run(&mut w, vec![usdc_solid_a.clone()], two, None).contains("exactly one coin"));
        let router = w.router.to_string();
        assert!(run(&mut w, vec![usdc_solid_a.clone()], coins(10, "uusdc"), Some(router)).contains("cannot receive the output"));
        // The pair for SOLID/LUNA lives on factory B; asking factory A for it fails.
        let fa = w.fac_a.clone();
        assert!(run(&mut w, vec![usdc_solid_a, op(&fa, token(&solid), native("uluna"))], coins(10, "uusdc"), None).contains("Pair not found"));
        assert_eq!(native_balance(&w, USER, "uusdc"), 1_000_000);
        assert_router_empty(&w);
    }

    #[test]
    fn internal_steps_answer_only_to_the_router() {
        let mut w = world();
        let user = Addr::unchecked(USER);
        let e = w
            .app
            .execute_contract(user.clone(), w.router.clone(), &ExecuteMsg::ExecuteSwapOperation { operation: op(&w.fac_a, native("uusdc"), token(&w.solid)), to: None }, &[])
            .unwrap_err();
        assert!(text(e).contains("Only the router itself"));
        let e = w
            .app
            .execute_contract(
                user,
                w.router.clone(),
                &ExecuteMsg::AssertMinimumReceive { asset_info: native("uluna"), prev_balance: Uint128::zero(), minimum_receive: Uint128::zero(), receiver: USER.into() },
                &[],
            )
            .unwrap_err();
        assert!(text(e).contains("Only the router itself"));
    }

    #[test]
    fn a_cw20_that_is_not_the_first_offer_is_refused() {
        let mut w = world();
        let hook = Cw20HookMsg::ExecuteSwapOperations { operations: vec![op(&w.fac_a, native("uusdc"), token(&w.solid))], minimum_receive: Uint128::new(1), to: None };
        let e = w
            .app
            .execute_contract(
                Addr::unchecked(USER),
                w.solid.clone(),
                &Cw20ExecuteMsg::Send { contract: w.router.to_string(), amount: Uint128::new(10), msg: to_json_binary(&hook).unwrap() },
                &[],
            )
            .unwrap_err();
        assert!(text(e).contains("not the first operation's offer"));
        assert_eq!(solid_balance(&w, USER), 1_000);
    }
}
