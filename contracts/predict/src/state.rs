use cosmwasm_schema::cw_serde;
use cosmwasm_std::{Addr, Decimal256, Timestamp, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Astroport's asset info, byte-for-byte the same JSON so the pair's
/// `cumulative_prices` answer deserialises straight into it.
#[cw_serde]
pub enum AssetInfo {
    Token { contract_addr: Addr },
    NativeToken { denom: String },
}

impl AssetInfo {
    pub fn label(&self) -> String {
        match self {
            AssetInfo::Token { contract_addr } => contract_addr.to_string(),
            AssetInfo::NativeToken { denom } => denom.clone(),
        }
    }
}

/// Only what we read from the pair. Deliberately NOT `cw_serde`: that would
/// add `deny_unknown_fields`, and the pair's response carries more.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct CumulativePricesResponse {
    pub cumulative_prices: Vec<(AssetInfo, AssetInfo, Uint128)>,
}

#[cw_serde]
pub enum PairQueryMsg {
    CumulativePrices {},
}

#[cw_serde]
pub struct Config {
    /// Cut of the losing pool sent to `fee_recipient` at resolution.
    pub fee_bps: u16,
    pub fee_recipient: Option<Addr>,
    /// Cut of the losing pool split between whoever observed the window and
    /// whoever resolved. This is what keeps settlement permissionless.
    pub bounty_bps: u16,
    /// Shortest TWAP window a market may use, in seconds.
    pub min_window: u64,
}

#[cw_serde]
pub enum Side {
    Yes,
    No,
}

#[cw_serde]
pub enum Outcome {
    Yes,
    No,
    /// Nobody observed the window, the pair could not be read, or the
    /// winning side was empty. Every stake is refundable.
    Void,
}

#[cw_serde]
pub struct Observation {
    pub time: Timestamp,
    pub cumulative: Uint128,
    pub observer: Addr,
}

#[cw_serde]
pub struct Resolution {
    pub outcome: Outcome,
    /// The settled TWAP in display units (quote per base), when one was read.
    pub twap: Option<Decimal256>,
    pub resolved_at: Timestamp,
    pub resolver: Addr,
    /// What winners share on top of their stakes, after fee and bounty.
    pub payout_pool: Uint128,
}

#[cw_serde]
pub struct Market {
    pub id: u64,
    pub creator: Addr,
    pub question: String,
    pub pair: Addr,
    pub base: AssetInfo,
    pub quote: AssetInfo,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    /// YES if TWAP (quote per base, display units) >= threshold.
    pub threshold: Decimal256,
    /// Scale of the pair's cumulative price. Astroport uses 10^6.
    pub price_precision: Uint128,
    /// Native denom stakes are placed in.
    pub denom: String,
    pub min_bet: Uint128,
    pub created_at: Timestamp,
    pub close_at: Timestamp,
    pub resolve_at: Timestamp,
    pub twap_window: u64,
    pub yes_total: Uint128,
    pub no_total: Uint128,
    pub observation: Option<Observation>,
    pub resolution: Option<Resolution>,
}

#[cw_serde]
#[derive(Default)]
pub struct Position {
    pub yes: Uint128,
    pub no: Uint128,
    pub claimed: bool,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const MARKET_COUNT: Item<u64> = Item::new("market_count");
pub const MARKETS: Map<u64, Market> = Map::new("markets");
pub const POSITIONS: Map<(u64, &Addr), Position> = Map::new("positions");
