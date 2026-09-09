//! Terra Predict.
//!
//! Parimutuel YES/NO markets on a price question ("1 LUNA ≥ 0.05 USDC at
//! time T?") that the chain settles by itself:
//!
//! * Anyone opens a market against an Astroport pair. Anyone bets either
//!   side, native coins only, until `close_at`.
//! * The answer is the time-weighted average price of the pair over the
//!   `twap_window` ending at `resolve_at`, read from the pair's own
//!   `cumulative_prices` query. Whoever records the window's first
//!   observation and whoever resolves share a small bounty from the losing
//!   pool, so no operator has to exist for markets to settle.
//! * Winners split the losing pool pro rata. If nobody observed the window,
//!   or the pair cannot be read for a week, the market is void and every
//!   stake is refundable.
//!
//! There is no admin, no migrate entry point, no pause, and no way to change
//! the fee or the outcome after the fact. What was instantiated is what runs.

pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

#[cfg(test)]
mod integration_tests;

pub use crate::error::ContractError;
