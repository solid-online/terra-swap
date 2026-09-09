use cosmwasm_std::{
    entry_point, to_json_binary, Addr, BankMsg, Binary, Coin, CosmosMsg, Decimal256, Deps,
    DepsMut, Env, MessageInfo, Order, Response, StdResult, Uint128, Uint256,
};
use cw2::set_contract_version;
use cw_storage_plus::Bound;
use cw_utils::must_pay;

use crate::error::ContractError;
use crate::msg::{ClaimableResponse, ExecuteMsg, InstantiateMsg, MarketsResponse, QueryMsg, TwapResponse};
use crate::state::{
    AssetInfo, Config, CumulativePricesResponse, Market, Observation, Outcome, PairQueryMsg,
    Position, Resolution, Side, CONFIG, MARKETS, MARKET_COUNT, POSITIONS,
};

const CONTRACT_NAME: &str = "crates.io:terra-predict";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const MAX_FEE_BPS: u16 = 500;
pub const MAX_BOUNTY_BPS: u16 = 100;
/// Betting has to stay open at least this long after creation.
pub const MIN_LEAD_SECONDS: u64 = 600;
pub const MAX_DURATION_SECONDS: u64 = 366 * 86_400;
/// After this much silence past `resolve_at`, anyone may void the market.
pub const VOID_GRACE_SECONDS: u64 = 7 * 86_400;
pub const MAX_QUESTION_LEN: usize = 200;
/// Astroport's TWAP_PRECISION is 6 decimals.
pub const DEFAULT_PRICE_PRECISION: u128 = 1_000_000;
const MAX_PAGE: u32 = 100;
const BPS: u128 = 10_000;

// ─── instantiate ────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    if msg.fee_bps > MAX_FEE_BPS {
        return Err(ContractError::FeeTooHigh(msg.fee_bps, MAX_FEE_BPS));
    }
    if msg.bounty_bps > MAX_BOUNTY_BPS {
        return Err(ContractError::BountyTooHigh(msg.bounty_bps, MAX_BOUNTY_BPS));
    }
    let fee_recipient = msg
        .fee_recipient
        .map(|a| deps.api.addr_validate(&a))
        .transpose()?;
    CONFIG.save(
        deps.storage,
        &Config {
            fee_bps: msg.fee_bps,
            fee_recipient,
            bounty_bps: msg.bounty_bps,
            min_window: msg.min_window,
        },
    )?;
    MARKET_COUNT.save(deps.storage, &0)?;
    Ok(Response::new().add_attribute("action", "instantiate"))
}

// ─── execute ────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::CreateMarket {
            question,
            pair,
            base,
            quote,
            base_decimals,
            quote_decimals,
            threshold,
            price_precision,
            denom,
            min_bet,
            close_at,
            resolve_at,
            twap_window,
        } => create_market(
            deps,
            env,
            info,
            CreateParams {
                question,
                pair,
                base,
                quote,
                base_decimals,
                quote_decimals,
                threshold,
                price_precision,
                denom,
                min_bet,
                close_at,
                resolve_at,
                twap_window,
            },
        ),
        ExecuteMsg::Bet { market_id, side } => bet(deps, env, info, market_id, side),
        ExecuteMsg::Observe { market_id } => observe(deps, env, info, market_id),
        ExecuteMsg::Resolve { market_id } => resolve(deps, env, info, market_id),
        ExecuteMsg::Void { market_id } => void(deps, env, info, market_id),
        ExecuteMsg::Claim { market_id } => claim(deps, env, info, market_id),
    }
}

pub struct CreateParams {
    pub question: String,
    pub pair: String,
    pub base: AssetInfo,
    pub quote: AssetInfo,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub threshold: Decimal256,
    pub price_precision: Option<Uint128>,
    pub denom: String,
    pub min_bet: Uint128,
    pub close_at: u64,
    pub resolve_at: u64,
    pub twap_window: u64,
}

fn create_market(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    p: CreateParams,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    let now = env.block.time.seconds();

    let question = p.question.trim().to_string();
    if question.is_empty() || question.chars().count() > MAX_QUESTION_LEN {
        return Err(ContractError::BadQuestion(MAX_QUESTION_LEN));
    }
    if p.base == p.quote {
        return Err(ContractError::SameAsset);
    }
    if p.base_decimals > 18 || p.quote_decimals > 18 {
        return Err(ContractError::BadDecimals);
    }
    if p.threshold.is_zero() {
        return Err(ContractError::BadThreshold);
    }
    if p.twap_window < cfg.min_window || p.twap_window == 0 {
        return Err(ContractError::WindowTooShort(cfg.min_window));
    }
    if p.close_at < now + MIN_LEAD_SECONDS {
        return Err(ContractError::ClosesTooSoon(MIN_LEAD_SECONDS));
    }
    // The whole window must lie after betting closes, or late bettors would
    // see most of the answer before staking.
    if p.resolve_at < p.close_at + p.twap_window {
        return Err(ContractError::WindowOverlapsBetting);
    }
    if p.resolve_at > now + MAX_DURATION_SECONDS {
        return Err(ContractError::TooLong(MAX_DURATION_SECONDS));
    }
    if p.min_bet.is_zero() {
        return Err(ContractError::BadMinBet);
    }
    if p.denom.trim().is_empty() {
        return Err(ContractError::Payment(cw_utils::PaymentError::NoFunds {}));
    }
    let pair = deps.api.addr_validate(&p.pair)?;
    let price_precision = p
        .price_precision
        .unwrap_or_else(|| Uint128::new(DEFAULT_PRICE_PRECISION));
    if price_precision.is_zero() {
        return Err(ContractError::BadThreshold);
    }
    // Fail now, not at settlement, if the pair cannot answer for this route.
    read_cumulative(deps.as_ref(), &pair, &p.base, &p.quote)?;

    let id = MARKET_COUNT.load(deps.storage)? + 1;
    MARKET_COUNT.save(deps.storage, &id)?;
    let market = Market {
        id,
        creator: info.sender.clone(),
        question,
        pair,
        base: p.base,
        quote: p.quote,
        base_decimals: p.base_decimals,
        quote_decimals: p.quote_decimals,
        threshold: p.threshold,
        price_precision,
        denom: p.denom,
        min_bet: p.min_bet,
        created_at: env.block.time,
        close_at: cosmwasm_std::Timestamp::from_seconds(p.close_at),
        resolve_at: cosmwasm_std::Timestamp::from_seconds(p.resolve_at),
        twap_window: p.twap_window,
        yes_total: Uint128::zero(),
        no_total: Uint128::zero(),
        observation: None,
        resolution: None,
    };
    MARKETS.save(deps.storage, id, &market)?;
    Ok(Response::new()
        .add_attribute("action", "create_market")
        .add_attribute("market_id", id.to_string())
        .add_attribute("creator", info.sender)
        .add_attribute("threshold", market.threshold.to_string())
        .add_attribute("resolve_at", p.resolve_at.to_string()))
}

fn bet(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    market_id: u64,
    side: Side,
) -> Result<Response, ContractError> {
    let mut market = load_market(deps.as_ref(), market_id)?;
    if market.resolution.is_some() {
        return Err(ContractError::AlreadyResolved);
    }
    if env.block.time >= market.close_at {
        return Err(ContractError::BettingClosed);
    }
    let paid = must_pay(&info, &market.denom)?;
    if paid < market.min_bet {
        return Err(ContractError::BelowMinBet(market.min_bet.to_string()));
    }
    let mut pos = POSITIONS
        .may_load(deps.storage, (market_id, &info.sender))?
        .unwrap_or_default();
    match side {
        Side::Yes => {
            market.yes_total += paid;
            pos.yes += paid;
        }
        Side::No => {
            market.no_total += paid;
            pos.no += paid;
        }
    }
    MARKETS.save(deps.storage, market_id, &market)?;
    POSITIONS.save(deps.storage, (market_id, &info.sender), &pos)?;
    Ok(Response::new()
        .add_attribute("action", "bet")
        .add_attribute("market_id", market_id.to_string())
        .add_attribute("bettor", info.sender)
        .add_attribute("side", side_label(&side))
        .add_attribute("amount", paid)
        .add_attribute("yes_total", market.yes_total)
        .add_attribute("no_total", market.no_total))
}

fn observe(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    market_id: u64,
) -> Result<Response, ContractError> {
    let mut market = load_market(deps.as_ref(), market_id)?;
    if market.resolution.is_some() {
        return Err(ContractError::AlreadyResolved);
    }
    if market.observation.is_some() {
        return Err(ContractError::AlreadyObserved);
    }
    let now = env.block.time.seconds();
    let window_start = market.resolve_at.seconds() - market.twap_window;
    // Must land in the first half of the window so the settled average
    // covers at least half of it. A last-minute observation would let a
    // single block set the price.
    let latest = window_start + market.twap_window / 2;
    if now < window_start {
        return Err(ContractError::TooEarly(window_start));
    }
    if now > latest {
        return Err(ContractError::TooLate(latest));
    }
    let cumulative = read_cumulative(deps.as_ref(), &market.pair, &market.base, &market.quote)?;
    market.observation = Some(Observation {
        time: env.block.time,
        cumulative,
        observer: info.sender.clone(),
    });
    MARKETS.save(deps.storage, market_id, &market)?;
    Ok(Response::new()
        .add_attribute("action", "observe")
        .add_attribute("market_id", market_id.to_string())
        .add_attribute("observer", info.sender)
        .add_attribute("cumulative", cumulative))
}

fn resolve(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    market_id: u64,
) -> Result<Response, ContractError> {
    let market = load_market(deps.as_ref(), market_id)?;
    if market.resolution.is_some() {
        return Err(ContractError::AlreadyResolved);
    }
    if env.block.time < market.resolve_at {
        return Err(ContractError::TooEarly(market.resolve_at.seconds()));
    }
    let (outcome, twap) = match &market.observation {
        None => (Outcome::Void, None),
        Some(obs) => {
            let cum_now = read_cumulative(deps.as_ref(), &market.pair, &market.base, &market.quote)?;
            let elapsed = env.block.time.seconds().saturating_sub(obs.time.seconds());
            let twap = twap_from(&market, obs.cumulative, cum_now, elapsed)?;
            let outcome = if twap >= market.threshold { Outcome::Yes } else { Outcome::No };
            (outcome, Some(twap))
        }
    };
    finalize(deps, env, info.sender, market, outcome, twap)
}

fn void(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    market_id: u64,
) -> Result<Response, ContractError> {
    let market = load_market(deps.as_ref(), market_id)?;
    if market.resolution.is_some() {
        return Err(ContractError::AlreadyResolved);
    }
    let allowed_from = market.resolve_at.seconds() + VOID_GRACE_SECONDS;
    if env.block.time.seconds() < allowed_from {
        return Err(ContractError::TooEarly(allowed_from));
    }
    finalize(deps, env, info.sender, market, Outcome::Void, None)
}

/// Settle the pools. Fee and bounty come out of the losing side only, so a
/// void market and a one-sided market cost nobody anything.
fn finalize(
    deps: DepsMut,
    env: Env,
    resolver: Addr,
    mut market: Market,
    outcome: Outcome,
    twap: Option<Decimal256>,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    let (winning_total, losing_total) = match outcome {
        Outcome::Yes => (market.yes_total, market.no_total),
        Outcome::No => (market.no_total, market.yes_total),
        Outcome::Void => (Uint128::zero(), Uint128::zero()),
    };
    // Nobody on the winning side: there is no one to pay the losing pool
    // to, so everyone simply gets their stake back.
    let outcome = if matches!(outcome, Outcome::Yes | Outcome::No) && winning_total.is_zero() {
        Outcome::Void
    } else {
        outcome
    };
    let mut msgs: Vec<CosmosMsg> = vec![];
    let mut payout_pool = Uint128::zero();
    if matches!(outcome, Outcome::Yes | Outcome::No) {
        let fee = losing_total.multiply_ratio(cfg.fee_bps as u128, BPS);
        let bounty = losing_total.multiply_ratio(cfg.bounty_bps as u128, BPS);
        payout_pool = losing_total - fee - bounty;
        if !fee.is_zero() {
            if let Some(to) = &cfg.fee_recipient {
                msgs.push(send(to, &market.denom, fee));
            } else {
                // No recipient configured: the fee stays with the winners.
                payout_pool += fee;
            }
        }
        if !bounty.is_zero() {
            let observer = market.observation.as_ref().map(|o| o.observer.clone());
            let half = bounty.multiply_ratio(1u128, 2u128);
            match observer {
                Some(o) if o != resolver => {
                    msgs.push(send(&o, &market.denom, half));
                    msgs.push(send(&resolver, &market.denom, bounty - half));
                }
                _ => msgs.push(send(&resolver, &market.denom, bounty)),
            }
        }
    }
    market.resolution = Some(Resolution {
        outcome: outcome.clone(),
        twap,
        resolved_at: env.block.time,
        resolver: resolver.clone(),
        payout_pool,
    });
    MARKETS.save(deps.storage, market.id, &market)?;
    let mut res = Response::new()
        .add_messages(msgs)
        .add_attribute("action", "resolve")
        .add_attribute("market_id", market.id.to_string())
        .add_attribute("outcome", outcome_label(&outcome))
        .add_attribute("payout_pool", payout_pool)
        .add_attribute("resolver", resolver);
    // The chain rejects empty attribute values, so only attach a TWAP when there is one.
    if let Some(t) = twap {
        res = res.add_attribute("twap", t.to_string());
    }
    Ok(res)
}

fn claim(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    market_id: u64,
) -> Result<Response, ContractError> {
    let market = load_market(deps.as_ref(), market_id)?;
    let res = market.resolution.as_ref().ok_or(ContractError::NotResolved)?;
    let mut pos = POSITIONS
        .may_load(deps.storage, (market_id, &info.sender))?
        .unwrap_or_default();
    if pos.claimed {
        return Err(ContractError::AlreadyClaimed);
    }
    let amount = payout_for(&market, res, &pos);
    if amount.is_zero() {
        return Err(ContractError::NothingToClaim);
    }
    pos.claimed = true;
    POSITIONS.save(deps.storage, (market_id, &info.sender), &pos)?;
    Ok(Response::new()
        .add_message(send(&info.sender, &market.denom, amount))
        .add_attribute("action", "claim")
        .add_attribute("market_id", market_id.to_string())
        .add_attribute("claimer", info.sender)
        .add_attribute("amount", amount))
}

// ─── maths ──────────────────────────────────────────────────────────────

/// Stake back plus a pro-rata share of the losing pool; a refund when void.
fn payout_for(market: &Market, res: &Resolution, pos: &Position) -> Uint128 {
    match res.outcome {
        Outcome::Void => pos.yes + pos.no,
        Outcome::Yes => {
            if pos.yes.is_zero() {
                return Uint128::zero();
            }
            pos.yes + pos.yes.multiply_ratio(res.payout_pool, market.yes_total)
        }
        Outcome::No => {
            if pos.no.is_zero() {
                return Uint128::zero();
            }
            pos.no + pos.no.multiply_ratio(res.payout_pool, market.no_total)
        }
    }
}

/// Cumulative prices are `Σ price_raw × precision × seconds`, where price_raw
/// is quote-micro per base-micro. The average over the interval, moved into
/// display units, is
///
/// ```text
/// (cum_now - cum_then) * 10^base_dec / (elapsed * precision * 10^quote_dec)
/// ```
///
/// Uint256 throughout, so an 18-decimal quote cannot overflow. The counter
/// wraps on purpose in Astroport; wrapping_sub keeps the difference right.
fn twap_from(
    market: &Market,
    cum_then: Uint128,
    cum_now: Uint128,
    elapsed: u64,
) -> Result<Decimal256, ContractError> {
    if elapsed == 0 {
        return Err(ContractError::TooEarly(0));
    }
    let diff = cum_now.wrapping_sub(cum_then);
    let num = Uint256::from(diff) * Uint256::from(10u128.pow(market.base_decimals as u32));
    let den = Uint256::from(elapsed)
        * Uint256::from(market.price_precision)
        * Uint256::from(10u128.pow(market.quote_decimals as u32));
    Ok(Decimal256::from_ratio(num, den))
}

/// The pair's cumulative counter for base→quote, or a clean error if the
/// pair does not quote that route.
fn read_cumulative(
    deps: Deps,
    pair: &Addr,
    base: &AssetInfo,
    quote: &AssetInfo,
) -> Result<Uint128, ContractError> {
    let res: CumulativePricesResponse = deps
        .querier
        .query_wasm_smart(pair, &PairQueryMsg::CumulativePrices {})?;
    res.cumulative_prices
        .into_iter()
        .find(|(from, to, _)| from == base && to == quote)
        .map(|(_, _, c)| c)
        .ok_or_else(|| ContractError::PairMissingRoute(base.label(), quote.label()))
}

fn load_market(deps: Deps, id: u64) -> Result<Market, ContractError> {
    MARKETS
        .may_load(deps.storage, id)?
        .ok_or(ContractError::MarketNotFound(id))
}

fn send(to: &Addr, denom: &str, amount: Uint128) -> CosmosMsg {
    BankMsg::Send {
        to_address: to.to_string(),
        amount: vec![Coin { denom: denom.to_string(), amount }],
    }
    .into()
}

fn side_label(s: &Side) -> &'static str {
    match s {
        Side::Yes => "yes",
        Side::No => "no",
    }
}

fn outcome_label(o: &Outcome) -> &'static str {
    match o {
        Outcome::Yes => "yes",
        Outcome::No => "no",
        Outcome::Void => "void",
    }
}

// ─── query ──────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::Market { id } => to_json_binary(&MARKETS.load(deps.storage, id)?),
        QueryMsg::Markets { start_after, limit } => {
            let limit = limit.unwrap_or(20).min(MAX_PAGE) as usize;
            let markets = MARKETS
                .range(
                    deps.storage,
                    start_after.map(Bound::exclusive),
                    None,
                    Order::Ascending,
                )
                .take(limit)
                .map(|r| r.map(|(_, m)| m))
                .collect::<StdResult<Vec<_>>>()?;
            to_json_binary(&MarketsResponse { markets, count: MARKET_COUNT.load(deps.storage)? })
        }
        QueryMsg::Position { market_id, address } => {
            let addr = deps.api.addr_validate(&address)?;
            to_json_binary(
                &POSITIONS
                    .may_load(deps.storage, (market_id, &addr))?
                    .unwrap_or_default(),
            )
        }
        QueryMsg::Twap { market_id } => {
            let market = MARKETS.load(deps.storage, market_id)?;
            let (twap, elapsed) = match &market.observation {
                None => (None, 0),
                Some(obs) => {
                    let elapsed = env.block.time.seconds().saturating_sub(obs.time.seconds());
                    let cum_now = read_cumulative(deps, &market.pair, &market.base, &market.quote)
                        .map_err(|e| cosmwasm_std::StdError::generic_err(e.to_string()))?;
                    let twap = twap_from(&market, obs.cumulative, cum_now, elapsed.max(1))
                        .map_err(|e| cosmwasm_std::StdError::generic_err(e.to_string()))?;
                    (Some(twap), elapsed)
                }
            };
            to_json_binary(&TwapResponse { twap, elapsed })
        }
        QueryMsg::Claimable { market_id, address } => {
            let market = MARKETS.load(deps.storage, market_id)?;
            let addr = deps.api.addr_validate(&address)?;
            let pos = POSITIONS
                .may_load(deps.storage, (market_id, &addr))?
                .unwrap_or_default();
            let amount = match &market.resolution {
                Some(res) if !pos.claimed => payout_for(&market, res, &pos),
                _ => Uint128::zero(),
            };
            to_json_binary(&ClaimableResponse { amount, claimed: pos.claimed })
        }
    }
}
