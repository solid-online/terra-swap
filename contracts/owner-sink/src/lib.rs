//! Owner sink.
//!
//! Astroport's factory has no "renounce ownership". Ownership moves in two
//! steps: the owner proposes a new owner, the new owner claims. A burn
//! address can never claim, so ownership can never be sent there.
//!
//! This contract can. Its only executable message, `claim`, makes it call
//! `claim_ownership` on the target. That is the whole surface: no other
//! message exists, there is no admin, and there is no migrate entry point.
//! Once the target's owner is this contract, `update_config`,
//! `update_pair_config`, `propose_new_owner` and every other owner-only call
//! on the target are unreachable forever.
//!
//! Anyone may call `claim`; it is idempotent in effect (a second call fails
//! at the target, which is fine).

use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response,
    StdResult, WasmMsg,
};
use cw2::set_contract_version;
use cw_storage_plus::Item;

const CONTRACT_NAME: &str = "crates.io:owner-sink";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cw_serde]
pub struct InstantiateMsg {
    /// The contract whose ownership this sink will accept (an Astroport factory).
    pub target: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Accept the pending ownership proposal on the target. Anyone may call.
    Claim {},
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(Addr)]
    Target {},
}

/// The one message we ever send: Astroport's `claim_ownership {}`.
#[cw_serde]
enum TargetMsg {
    ClaimOwnership {},
}

pub const TARGET: Item<Addr> = Item::new("target");

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(deps: DepsMut, _env: Env, _info: MessageInfo, msg: InstantiateMsg) -> StdResult<Response> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let target = deps.api.addr_validate(&msg.target)?;
    TARGET.save(deps.storage, &target)?;
    Ok(Response::new().add_attribute("action", "instantiate").add_attribute("target", target))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(deps: DepsMut, _env: Env, info: MessageInfo, msg: ExecuteMsg) -> StdResult<Response> {
    let ExecuteMsg::Claim {} = msg;
    let target = TARGET.load(deps.storage)?;
    Ok(Response::new()
        .add_message(WasmMsg::Execute {
            contract_addr: target.to_string(),
            msg: to_json_binary(&TargetMsg::ClaimOwnership {})?,
            funds: vec![],
        })
        .add_attribute("action", "claim")
        .add_attribute("target", target)
        .add_attribute("caller", info.sender))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Target {} => to_json_binary(&TARGET.load(deps.storage)?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::Empty;
    use cw_multi_test::{App, Contract, ContractWrapper, Executor};

    /// Just enough of an Astroport factory: an owner, a two-step ownership
    /// transfer, and one owner-only action so we can prove it dies.
    mod factory {
        use cosmwasm_schema::cw_serde;
        use cosmwasm_std::{
            entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response,
            StdError, StdResult,
        };
        use cw_storage_plus::Item;

        #[cw_serde]
        pub struct Inst { pub owner: String }
        #[cw_serde]
        pub enum Exec {
            ProposeNewOwner { owner: String, expires_in: u64 },
            ClaimOwnership {},
            UpdateConfig { fee_address: String },
        }
        #[cw_serde]
        pub enum Query { Config {} }
        #[cw_serde]
        pub struct Config { pub owner: Addr, pub fee_address: String }

        const CFG: Item<Config> = Item::new("cfg");
        const PROPOSED: Item<Addr> = Item::new("proposed");

        #[entry_point]
        pub fn instantiate(deps: DepsMut, _: Env, _: MessageInfo, m: Inst) -> StdResult<Response> {
            CFG.save(deps.storage, &Config { owner: deps.api.addr_validate(&m.owner)?, fee_address: "treasury".into() })?;
            Ok(Response::new())
        }
        #[entry_point]
        pub fn execute(deps: DepsMut, _: Env, info: MessageInfo, m: Exec) -> StdResult<Response> {
            let mut cfg = CFG.load(deps.storage)?;
            match m {
                Exec::ProposeNewOwner { owner, .. } => {
                    if info.sender != cfg.owner { return Err(StdError::generic_err("Unauthorized")); }
                    PROPOSED.save(deps.storage, &deps.api.addr_validate(&owner)?)?;
                }
                Exec::ClaimOwnership {} => {
                    let p = PROPOSED.may_load(deps.storage)?.ok_or_else(|| StdError::generic_err("no proposal"))?;
                    if info.sender != p { return Err(StdError::generic_err("Unauthorized")); }
                    cfg.owner = p;
                    PROPOSED.remove(deps.storage);
                    CFG.save(deps.storage, &cfg)?;
                }
                Exec::UpdateConfig { fee_address } => {
                    if info.sender != cfg.owner { return Err(StdError::generic_err("Unauthorized")); }
                    cfg.fee_address = fee_address;
                    CFG.save(deps.storage, &cfg)?;
                }
            }
            Ok(Response::new())
        }
        #[entry_point]
        pub fn query(deps: Deps, _: Env, _: Query) -> StdResult<Binary> {
            to_json_binary(&CFG.load(deps.storage)?)
        }
    }

    fn sink() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(execute, instantiate, query))
    }
    fn fac() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(factory::execute, factory::instantiate, factory::query))
    }

    #[test]
    fn ownership_dies_in_the_sink() {
        let mut app = App::default();
        let alice = Addr::unchecked("alice"); // today's owner
        let bob = Addr::unchecked("bob"); // anyone
        let fcode = app.store_code(fac());
        let f = app.instantiate_contract(fcode, alice.clone(), &factory::Inst { owner: alice.to_string() }, &[], "factory", None).unwrap();
        let scode = app.store_code(sink());
        let s = app.instantiate_contract(scode, alice.clone(), &InstantiateMsg { target: f.to_string() }, &[], "sink", None).unwrap();

        // Claiming with no proposal fails at the factory, and the sink relays that failure.
        assert!(app.execute_contract(bob.clone(), s.clone(), &ExecuteMsg::Claim {}, &[]).is_err());

        // Owner proposes the sink; anyone triggers the claim.
        app.execute_contract(alice.clone(), f.clone(), &factory::Exec::ProposeNewOwner { owner: s.to_string(), expires_in: 604_800 }, &[]).unwrap();
        app.execute_contract(bob.clone(), s.clone(), &ExecuteMsg::Claim {}, &[]).unwrap();
        let cfg: factory::Config = app.wrap().query_wasm_smart(f.clone(), &factory::Query::Config {}).unwrap();
        assert_eq!(cfg.owner, s);

        // The old owner is powerless, and nothing can make the sink act as owner.
        assert!(app.execute_contract(alice.clone(), f.clone(), &factory::Exec::UpdateConfig { fee_address: "alice".into() }, &[]).is_err());
        assert!(app.execute_contract(alice.clone(), f.clone(), &factory::Exec::ProposeNewOwner { owner: alice.to_string(), expires_in: 1 }, &[]).is_err());
        let t: Addr = app.wrap().query_wasm_smart(s.clone(), &QueryMsg::Target {}).unwrap();
        assert_eq!(t, f);
        let cfg: factory::Config = app.wrap().query_wasm_smart(f, &factory::Query::Config {}).unwrap();
        assert_eq!(cfg.fee_address, "treasury");
    }
}
