use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Decimal256, Uint128};

// `Config` and `Position` only appear inside `#[returns(...)]`, which the
// wasm build strips; keep the import quiet there.
#[allow(unused_imports)]
use crate::state::{AssetInfo, Config, Market, Position, Side};

#[cw_serde]
pub struct InstantiateMsg {
    /// Max 500 (5%). Immutable.
    pub fee_bps: u16,
    pub fee_recipient: Option<String>,
    /// Max 100 (1%). Immutable.
    pub bounty_bps: u16,
    /// Seconds. Immutable.
    pub min_window: u64,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Open a market. Anyone may. All timestamps are unix seconds.
    CreateMarket {
        question: String,
        /// An Astroport pair (xyk or concentrated) that answers `cumulative_prices`.
        pair: String,
        base: AssetInfo,
        quote: AssetInfo,
        base_decimals: u8,
        quote_decimals: u8,
        /// YES if the TWAP of `quote per base` (display units) is at or above this.
        threshold: Decimal256,
        /// Defaults to 1_000_000 (Astroport's TWAP_PRECISION).
        price_precision: Option<Uint128>,
        /// Native denom stakes are placed in.
        denom: String,
        min_bet: Uint128,
        close_at: u64,
        resolve_at: u64,
        twap_window: u64,
    },
    /// Stake the attached coin on a side. One coin, the market's denom.
    Bet { market_id: u64, side: Side },
    /// Record the window's first observation. Allowed in the first half of
    /// the window, once. The observer earns half the bounty at resolution.
    Observe { market_id: u64 },
    /// Settle at or after `resolve_at`. The resolver earns half the bounty.
    Resolve { market_id: u64 },
    /// Escape hatch: a week after `resolve_at`, an unresolved market can be
    /// voided by anyone so stakes are never stuck.
    Void { market_id: u64 },
    /// Collect winnings, or the refund of a void market.
    Claim { market_id: u64 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(Config)]
    Config {},
    #[returns(Market)]
    Market { id: u64 },
    #[returns(MarketsResponse)]
    Markets { start_after: Option<u64>, limit: Option<u32> },
    #[returns(Position)]
    Position { market_id: u64, address: String },
    /// The running TWAP since the observation, if there is one. What
    /// `Resolve` would settle on if called now.
    #[returns(TwapResponse)]
    Twap { market_id: u64 },
    /// What `address` would receive from `Claim` right now.
    #[returns(ClaimableResponse)]
    Claimable { market_id: u64, address: String },
}

#[cw_serde]
pub struct MarketsResponse {
    pub markets: Vec<Market>,
    pub count: u64,
}

#[cw_serde]
pub struct TwapResponse {
    pub twap: Option<Decimal256>,
    pub elapsed: u64,
}

#[cw_serde]
pub struct ClaimableResponse {
    pub amount: Uint128,
    pub claimed: bool,
}
