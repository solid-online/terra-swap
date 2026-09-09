use cosmwasm_std::StdError;
use cw_utils::PaymentError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("{0}")]
    Payment(#[from] PaymentError),

    #[error("fee too high: {0} bps (max {1})")]
    FeeTooHigh(u16, u16),

    #[error("bounty too high: {0} bps (max {1})")]
    BountyTooHigh(u16, u16),

    #[error("market {0} not found")]
    MarketNotFound(u64),

    #[error("question must be 1..{0} characters")]
    BadQuestion(usize),

    #[error("base and quote must differ")]
    SameAsset,

    #[error("decimals must be at most 18")]
    BadDecimals,

    #[error("threshold must be positive")]
    BadThreshold,

    #[error("twap window must be at least {0} seconds")]
    WindowTooShort(u64),

    #[error("betting must stay open at least {0} seconds")]
    ClosesTooSoon(u64),

    #[error("resolve_at must be at least close_at + twap_window")]
    WindowOverlapsBetting,

    #[error("market runs longer than {0} seconds")]
    TooLong(u64),

    #[error("min_bet must be positive")]
    BadMinBet,

    #[error("pair does not quote {0} in {1}")]
    PairMissingRoute(String, String),

    #[error("betting is closed")]
    BettingClosed,

    #[error("bet below minimum of {0}")]
    BelowMinBet(String),

    #[error("market already resolved")]
    AlreadyResolved,

    #[error("market not resolved yet")]
    NotResolved,

    #[error("too early: allowed from {0}")]
    TooEarly(u64),

    #[error("too late: allowed until {0}")]
    TooLate(u64),

    #[error("window already observed")]
    AlreadyObserved,

    #[error("nothing to claim")]
    NothingToClaim,

    #[error("already claimed")]
    AlreadyClaimed,
}
