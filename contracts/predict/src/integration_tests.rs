//! End-to-end tests against a mock Astroport pair whose cumulative counter
//! we drive by hand. Time moves with `app.update_block`.

use cosmwasm_std::{coins, Addr, Coin, Decimal256, Empty, Uint128};
use cw_multi_test::{App, AppBuilder, Contract, ContractWrapper, Executor};

use crate::contract::{MIN_LEAD_SECONDS, VOID_GRACE_SECONDS};
use crate::msg::{ClaimableResponse, ExecuteMsg, InstantiateMsg, MarketsResponse, QueryMsg, TwapResponse};
use crate::state::{AssetInfo, Market, Outcome, Position, Side};
use crate::ContractError;

// ─── a pair that answers cumulative_prices with whatever we set ─────────

mod mock_pair {
    use cosmwasm_schema::cw_serde;
    use cosmwasm_std::{
        entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
        Uint128,
    };
    use cw_storage_plus::Item;

    use crate::state::{AssetInfo, CumulativePricesResponse};

    #[cw_serde]
    pub struct Inst {
        pub base: AssetInfo,
        pub quote: AssetInfo,
        pub cum_base_quote: Uint128,
        pub cum_quote_base: Uint128,
    }
    #[cw_serde]
    pub enum Exec {
        Set { cum_base_quote: Uint128, cum_quote_base: Uint128 },
    }
    #[cw_serde]
    pub enum Query {
        CumulativePrices {},
    }
    const STATE: Item<Inst> = Item::new("state");

    #[entry_point]
    pub fn instantiate(deps: DepsMut, _: Env, _: MessageInfo, msg: Inst) -> StdResult<Response> {
        STATE.save(deps.storage, &msg)?;
        Ok(Response::new())
    }
    #[entry_point]
    pub fn execute(deps: DepsMut, _: Env, _: MessageInfo, msg: Exec) -> StdResult<Response> {
        let Exec::Set { cum_base_quote, cum_quote_base } = msg;
        STATE.update(deps.storage, |mut s| -> StdResult<_> {
            s.cum_base_quote = cum_base_quote;
            s.cum_quote_base = cum_quote_base;
            Ok(s)
        })?;
        Ok(Response::new())
    }
    #[entry_point]
    pub fn query(deps: Deps, _: Env, _: Query) -> StdResult<Binary> {
        let s = STATE.load(deps.storage)?;
        to_json_binary(&CumulativePricesResponse {
            cumulative_prices: vec![
                (s.base.clone(), s.quote.clone(), s.cum_base_quote),
                (s.quote, s.base, s.cum_quote_base),
            ],
        })
    }
}

fn predict_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        crate::contract::execute,
        crate::contract::instantiate,
        crate::contract::query,
    ))
}
fn pair_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(mock_pair::execute, mock_pair::instantiate, mock_pair::query))
}

const DENOM: &str = "uluna";

fn luna() -> AssetInfo {
    AssetInfo::NativeToken { denom: "uluna".into() }
}
fn usdc() -> AssetInfo {
    AssetInfo::NativeToken { denom: "ibc/USDC".into() }
}

struct World {
    app: App,
    predict: Addr,
    pair: Addr,
    treasury: Addr,
    alice: Addr,
    bob: Addr,
    carol: Addr,
    keeper: Addr,
}

fn setup(fee_bps: u16, bounty_bps: u16) -> World {
    let alice = Addr::unchecked("alice");
    let bob = Addr::unchecked("bob");
    let carol = Addr::unchecked("carol");
    let keeper = Addr::unchecked("keeper");
    let treasury = Addr::unchecked("treasury");
    let mut app = AppBuilder::new().build(|router, _, storage| {
        for a in [&alice, &bob, &carol, &keeper] {
            router
                .bank
                .init_balance(storage, a, vec![Coin::new(1_000_000_000, DENOM), Coin::new(1_000_000_000, "ibc/USDC")])
                .unwrap();
        }
    });
    let pair_code = app.store_code(pair_contract());
    let pair = app
        .instantiate_contract(
            pair_code,
            alice.clone(),
            &mock_pair::Inst {
                base: luna(),
                quote: usdc(),
                cum_base_quote: Uint128::new(1_000_000_000),
                cum_quote_base: Uint128::new(5_000_000_000),
            },
            &[],
            "pair",
            None,
        )
        .unwrap();
    let code = app.store_code(predict_contract());
    let predict = app
        .instantiate_contract(
            code,
            alice.clone(),
            &InstantiateMsg {
                fee_bps,
                fee_recipient: Some(treasury.to_string()),
                bounty_bps,
                min_window: 600,
            },
            &[],
            "predict",
            None,
        )
        .unwrap();
    World { app, predict, pair, treasury, alice, bob, carol, keeper }
}

impl World {
    fn now(&self) -> u64 {
        self.app.block_info().time.seconds()
    }
    fn advance(&mut self, secs: u64) {
        self.app.update_block(|b| {
            b.time = b.time.plus_seconds(secs);
            b.height += secs / 6 + 1;
        });
    }
    fn set_cumulative(&mut self, base_quote: u128) {
        self.app
            .execute_contract(
                self.alice.clone(),
                self.pair.clone(),
                &mock_pair::Exec::Set {
                    cum_base_quote: Uint128::new(base_quote),
                    cum_quote_base: Uint128::new(5_000_000_000),
                },
                &[],
            )
            .unwrap();
    }
    fn create(&mut self, threshold: &str, close_in: u64, window: u64) -> u64 {
        let now = self.now();
        let res = self
            .app
            .execute_contract(
                self.alice.clone(),
                self.predict.clone(),
                &ExecuteMsg::CreateMarket {
                    question: "1 LUNA ≥ threshold USDC?".into(),
                    pair: self.pair.to_string(),
                    base: luna(),
                    quote: usdc(),
                    base_decimals: 6,
                    quote_decimals: 6,
                    threshold: threshold.parse().unwrap(),
                    price_precision: None,
                    denom: DENOM.into(),
                    min_bet: Uint128::new(1_000_000),
                    close_at: now + close_in,
                    resolve_at: now + close_in + window,
                    twap_window: window,
                },
                &[],
            )
            .unwrap();
        res.events
            .iter()
            .flat_map(|e| e.attributes.iter())
            .find(|a| a.key == "market_id")
            .map(|a| a.value.parse().unwrap())
            .unwrap()
    }
    fn bet(&mut self, who: &Addr, id: u64, side: Side, amount: u128) -> Result<(), ContractError> {
        self.app
            .execute_contract(
                who.clone(),
                self.predict.clone(),
                &ExecuteMsg::Bet { market_id: id, side },
                &coins(amount, DENOM),
            )
            .map(|_| ())
            .map_err(|e| e.downcast().unwrap())
    }
    fn exec(&mut self, who: &Addr, msg: ExecuteMsg) -> Result<(), ContractError> {
        self.app
            .execute_contract(who.clone(), self.predict.clone(), &msg, &[])
            .map(|_| ())
            .map_err(|e| e.downcast().unwrap())
    }
    fn market(&self, id: u64) -> Market {
        self.app
            .wrap()
            .query_wasm_smart(self.predict.clone(), &QueryMsg::Market { id })
            .unwrap()
    }
    fn position(&self, id: u64, who: &Addr) -> Position {
        self.app
            .wrap()
            .query_wasm_smart(
                self.predict.clone(),
                &QueryMsg::Position { market_id: id, address: who.to_string() },
            )
            .unwrap()
    }
    fn claimable(&self, id: u64, who: &Addr) -> ClaimableResponse {
        self.app
            .wrap()
            .query_wasm_smart(
                self.predict.clone(),
                &QueryMsg::Claimable { market_id: id, address: who.to_string() },
            )
            .unwrap()
    }
    fn balance(&self, who: &Addr) -> u128 {
        self.app.wrap().query_balance(who, DENOM).unwrap().amount.u128()
    }
    fn contract_balance(&self) -> u128 {
        self.app.wrap().query_balance(&self.predict, DENOM).unwrap().amount.u128()
    }
}

// ─── the happy path, with the maths spelled out ─────────────────────────

#[test]
fn yes_wins_pays_winners_fee_and_bounty() {
    let mut w = setup(100, 20); // 1% fee, 0.2% bounty
    let window = 3600;
    let id = w.create("0.045", 7200, window);

    w.bet(&w.alice.clone(), id, Side::Yes, 100_000_000).unwrap();
    w.bet(&w.bob.clone(), id, Side::No, 50_000_000).unwrap();
    w.bet(&w.carol.clone(), id, Side::Yes, 100_000_000).unwrap();
    let m = w.market(id);
    assert_eq!(m.yes_total.u128(), 200_000_000);
    assert_eq!(m.no_total.u128(), 50_000_000);
    assert_eq!(w.contract_balance(), 250_000_000);
    let bob_pos = w.position(id, &w.bob);
    assert_eq!((bob_pos.yes.u128(), bob_pos.no.u128(), bob_pos.claimed), (0, 50_000_000, false));

    // Window opens at close_at (7200s from creation). Observe at its start.
    w.advance(7200);
    w.set_cumulative(1_000_000_000);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }).unwrap();

    // Price averages 0.05 USDC/LUNA over the hour: counter grows 0.05·1e6 per second.
    w.advance(window);
    w.set_cumulative(1_000_000_000 + 3600 * 50_000);
    let twap: TwapResponse = w
        .app
        .wrap()
        .query_wasm_smart(w.predict.clone(), &QueryMsg::Twap { market_id: id })
        .unwrap();
    assert_eq!(twap.twap.unwrap(), Decimal256::from_ratio(5u128, 100u128));

    let keeper_before = w.balance(&w.keeper);
    w.exec(&w.bob.clone(), ExecuteMsg::Resolve { market_id: id }).unwrap(); // bob resolves, keeper observed
    let m = w.market(id);
    let res = m.resolution.clone().unwrap();
    assert_eq!(res.outcome, Outcome::Yes);
    assert_eq!(res.twap.unwrap(), Decimal256::from_ratio(5u128, 100u128));

    // losing pool 50: fee 0.5 → treasury, bounty 0.1 split keeper/bob, 49.4 to winners.
    assert_eq!(w.balance(&w.treasury), 500_000);
    assert_eq!(w.balance(&w.keeper) - keeper_before, 50_000);
    assert_eq!(res.payout_pool.u128(), 49_400_000);

    // alice: 100 back + 100/200 of 49.4 = 124.7
    assert_eq!(w.claimable(id, &w.alice).amount.u128(), 124_700_000);
    let before = w.balance(&w.alice);
    w.exec(&w.alice.clone(), ExecuteMsg::Claim { market_id: id }).unwrap();
    assert_eq!(w.balance(&w.alice) - before, 124_700_000);
    assert_eq!(w.exec(&w.alice.clone(), ExecuteMsg::Claim { market_id: id }), Err(ContractError::AlreadyClaimed));
    w.exec(&w.carol.clone(), ExecuteMsg::Claim { market_id: id }).unwrap();
    // bob lost; his position pays nothing.
    assert_eq!(w.exec(&w.bob.clone(), ExecuteMsg::Claim { market_id: id }), Err(ContractError::NothingToClaim));
    // Everything left the contract except rounding dust (none here).
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn no_wins_when_twap_below_threshold() {
    let mut w = setup(0, 0);
    let id = w.create("0.06", 1200, 600);
    w.bet(&w.alice.clone(), id, Side::Yes, 10_000_000).unwrap();
    w.bet(&w.bob.clone(), id, Side::No, 30_000_000).unwrap();
    w.advance(1200);
    w.set_cumulative(1_000_000_000);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }).unwrap();
    w.advance(600);
    w.set_cumulative(1_000_000_000 + 600 * 40_000); // 0.04 average
    w.exec(&w.keeper.clone(), ExecuteMsg::Resolve { market_id: id }).unwrap();
    let res = w.market(id).resolution.unwrap();
    assert_eq!(res.outcome, Outcome::No);
    // No fee, no bounty: bob gets his 30 plus all of alice's 10.
    assert_eq!(res.payout_pool.u128(), 10_000_000);
    assert_eq!(w.claimable(id, &w.bob).amount.u128(), 40_000_000);
    assert_eq!(w.claimable(id, &w.alice).amount.u128(), 0);
}

#[test]
fn void_when_nobody_observed_refunds_everyone() {
    let mut w = setup(100, 20);
    let id = w.create("0.05", 1200, 600);
    w.bet(&w.alice.clone(), id, Side::Yes, 10_000_000).unwrap();
    w.bet(&w.bob.clone(), id, Side::No, 30_000_000).unwrap();
    w.advance(1800);
    w.exec(&w.keeper.clone(), ExecuteMsg::Resolve { market_id: id }).unwrap();
    let res = w.market(id).resolution.unwrap();
    assert_eq!(res.outcome, Outcome::Void);
    assert_eq!(res.payout_pool.u128(), 0);
    assert_eq!(w.balance(&w.treasury), 0);
    assert_eq!(w.claimable(id, &w.alice).amount.u128(), 10_000_000);
    assert_eq!(w.claimable(id, &w.bob).amount.u128(), 30_000_000);
    w.exec(&w.alice.clone(), ExecuteMsg::Claim { market_id: id }).unwrap();
    w.exec(&w.bob.clone(), ExecuteMsg::Claim { market_id: id }).unwrap();
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn empty_winning_side_is_void() {
    let mut w = setup(100, 20);
    let id = w.create("0.05", 1200, 600);
    w.bet(&w.alice.clone(), id, Side::No, 10_000_000).unwrap(); // only NO bets
    w.advance(1200);
    w.set_cumulative(1_000_000_000);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }).unwrap();
    w.advance(600);
    w.set_cumulative(1_000_000_000 + 600 * 60_000); // 0.06 → YES would win, but nobody bet YES
    w.exec(&w.keeper.clone(), ExecuteMsg::Resolve { market_id: id }).unwrap();
    let res = w.market(id).resolution.unwrap();
    assert_eq!(res.outcome, Outcome::Void);
    assert_eq!(w.claimable(id, &w.alice).amount.u128(), 10_000_000);
}

#[test]
fn escape_hatch_after_a_week() {
    let mut w = setup(100, 20);
    let id = w.create("0.05", 1200, 600);
    w.bet(&w.alice.clone(), id, Side::Yes, 10_000_000).unwrap();
    w.advance(1200);
    w.set_cumulative(1_000_000_000);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }).unwrap();
    w.advance(600);
    assert!(matches!(
        w.exec(&w.keeper.clone(), ExecuteMsg::Void { market_id: id }),
        Err(ContractError::TooEarly(_))
    ));
    w.advance(VOID_GRACE_SECONDS);
    w.exec(&w.bob.clone(), ExecuteMsg::Void { market_id: id }).unwrap();
    assert_eq!(w.market(id).resolution.unwrap().outcome, Outcome::Void);
    assert_eq!(w.claimable(id, &w.alice).amount.u128(), 10_000_000);
}

// ─── the rules ──────────────────────────────────────────────────────────

#[test]
fn timing_rules() {
    let mut w = setup(100, 20);
    let id = w.create("0.05", 1200, 600);
    // observe before the window
    assert!(matches!(w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }), Err(ContractError::TooEarly(_))));
    // resolve before resolve_at
    assert!(matches!(w.exec(&w.keeper.clone(), ExecuteMsg::Resolve { market_id: id }), Err(ContractError::TooEarly(_))));
    w.bet(&w.alice.clone(), id, Side::Yes, 10_000_000).unwrap();
    w.advance(1200);
    // betting closed at close_at
    assert_eq!(w.bet(&w.bob.clone(), id, Side::No, 10_000_000), Err(ContractError::BettingClosed));
    // observation only in the first half of the window
    w.advance(301);
    assert!(matches!(w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }), Err(ContractError::TooLate(_))));
}

#[test]
fn observe_once_and_in_first_half() {
    let mut w = setup(100, 20);
    let id = w.create("0.05", 1200, 600);
    w.advance(1200 + 299);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }).unwrap();
    assert_eq!(w.exec(&w.bob.clone(), ExecuteMsg::Observe { market_id: id }), Err(ContractError::AlreadyObserved));
}

#[test]
fn payment_rules() {
    let mut w = setup(100, 20);
    let id = w.create("0.05", 1200, 600);
    // below min bet
    assert!(matches!(w.bet(&w.alice.clone(), id, Side::Yes, 999_999), Err(ContractError::BelowMinBet(_))));
    // wrong denom
    let err = w
        .app
        .execute_contract(
            w.alice.clone(),
            w.predict.clone(),
            &ExecuteMsg::Bet { market_id: id, side: Side::Yes },
            &[Coin::new(5_000_000, "ibc/USDC")],
        )
        .unwrap_err();
    assert!(matches!(err.downcast::<ContractError>().unwrap(), ContractError::Payment(_)));
    // no funds
    assert!(matches!(w.exec(&w.alice.clone(), ExecuteMsg::Bet { market_id: id, side: Side::Yes }), Err(ContractError::Payment(_))));
    // unknown market
    assert_eq!(w.bet(&w.alice.clone(), 99, Side::Yes, 5_000_000), Err(ContractError::MarketNotFound(99)));
}

#[test]
fn creation_rules() {
    let mut w = setup(100, 20);
    let now = w.now();
    let pair = w.pair.to_string();
    let mk = |close_at: u64, resolve_at: u64, window: u64, threshold: &str, question: &str| ExecuteMsg::CreateMarket {
        question: question.into(),
        pair: pair.clone(),
        base: luna(),
        quote: usdc(),
        base_decimals: 6,
        quote_decimals: 6,
        threshold: threshold.parse().unwrap(),
        price_precision: None,
        denom: DENOM.into(),
        min_bet: Uint128::new(1),
        close_at,
        resolve_at,
        twap_window: window,
    };
    let a = w.alice.clone();
    assert!(matches!(w.exec(&a, mk(now + 60, now + 1000, 600, "0.05", "q")), Err(ContractError::ClosesTooSoon(_))));
    assert_eq!(w.exec(&a, mk(now + 1200, now + 1500, 600, "0.05", "q")), Err(ContractError::WindowOverlapsBetting));
    assert!(matches!(w.exec(&a, mk(now + 1200, now + 1800, 60, "0.05", "q")), Err(ContractError::WindowTooShort(_))));
    assert_eq!(w.exec(&a, mk(now + 1200, now + 1800, 600, "0", "q")), Err(ContractError::BadThreshold));
    assert!(matches!(w.exec(&a, mk(now + 1200, now + 1800, 600, "0.05", "   ")), Err(ContractError::BadQuestion(_))));
    assert_eq!(w.exec(&a, mk(now + MIN_LEAD_SECONDS, now + 400 * 86_400, 600, "0.05", "q")), Err(ContractError::TooLong(366 * 86_400)));
    // a pair that does not quote the route
    let bad = ExecuteMsg::CreateMarket {
        question: "q".into(),
        pair: w.pair.to_string(),
        base: luna(),
        quote: AssetInfo::NativeToken { denom: "ibc/OTHER".into() },
        base_decimals: 6,
        quote_decimals: 6,
        threshold: "0.05".parse().unwrap(),
        price_precision: None,
        denom: DENOM.into(),
        min_bet: Uint128::new(1),
        close_at: now + 1200,
        resolve_at: now + 1800,
        twap_window: 600,
    };
    assert!(matches!(w.exec(&a, bad), Err(ContractError::PairMissingRoute(_, _))));
    // and a good one lists
    w.create("0.05", 1200, 600);
    let list: MarketsResponse = w
        .app
        .wrap()
        .query_wasm_smart(w.predict.clone(), &QueryMsg::Markets { start_after: None, limit: None })
        .unwrap();
    assert_eq!(list.count, 1);
    assert_eq!(list.markets.len(), 1);
}

#[test]
fn decimals_are_scaled() {
    // 8-decimal base (wBTC-like) quoted in 6-decimal USDC: the raw counter is
    // micro-USDC per satoshi, so 60,000 USDC per BTC is 600 raw
    // (60,000 · 10^6 / 10^8), and the counter grows 600 · 10^6 per second.
    let mut w = setup(0, 0);
    let now = w.now();
    let btc = AssetInfo::NativeToken { denom: "ibc/BTC".into() };
    let pair_code = w.app.store_code(pair_contract());
    let pair = w
        .app
        .instantiate_contract(
            pair_code,
            w.alice.clone(),
            &mock_pair::Inst { base: btc.clone(), quote: usdc(), cum_base_quote: Uint128::new(0), cum_quote_base: Uint128::new(0) },
            &[],
            "btc-pair",
            None,
        )
        .unwrap();
    w.app
        .execute_contract(
            w.alice.clone(),
            w.predict.clone(),
            &ExecuteMsg::CreateMarket {
                question: "BTC ≥ 55k?".into(),
                pair: pair.to_string(),
                base: btc,
                quote: usdc(),
                base_decimals: 8,
                quote_decimals: 6,
                threshold: "55000".parse().unwrap(),
                price_precision: None,
                denom: DENOM.into(),
                min_bet: Uint128::new(1),
                close_at: now + 1200,
                resolve_at: now + 1800,
                twap_window: 600,
            },
            &[],
        )
        .unwrap();
    w.bet(&w.alice.clone(), 1, Side::Yes, 1_000_000).unwrap();
    w.bet(&w.bob.clone(), 1, Side::No, 1_000_000).unwrap();
    w.advance(1200);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: 1 }).unwrap();
    w.advance(600);
    w.app
        .execute_contract(
            w.alice.clone(),
            pair,
            &mock_pair::Exec::Set { cum_base_quote: Uint128::new(600 * 600_000_000), cum_quote_base: Uint128::zero() },
            &[],
        )
        .unwrap();
    w.exec(&w.keeper.clone(), ExecuteMsg::Resolve { market_id: 1 }).unwrap();
    let res = w.market(1).resolution.unwrap();
    assert_eq!(res.twap.unwrap(), Decimal256::from_ratio(60_000u128, 1u128));
    assert_eq!(res.outcome, Outcome::Yes);
}

#[test]
fn wrapping_counter_still_averages() {
    let mut w = setup(0, 0);
    let id = w.create("0.05", 1200, 600);
    w.bet(&w.alice.clone(), id, Side::Yes, 1_000_000).unwrap();
    w.bet(&w.bob.clone(), id, Side::No, 1_000_000).unwrap();
    w.advance(1200);
    w.set_cumulative(u128::MAX - 1_000);
    w.exec(&w.keeper.clone(), ExecuteMsg::Observe { market_id: id }).unwrap();
    w.advance(600);
    // wrapped past u128::MAX by exactly 600·60_000 − 1_001
    w.set_cumulative(600 * 60_000 - 1_001);
    w.exec(&w.keeper.clone(), ExecuteMsg::Resolve { market_id: id }).unwrap();
    assert_eq!(w.market(id).resolution.unwrap().twap.unwrap(), Decimal256::from_ratio(6u128, 100u128));
}

#[test]
fn instantiate_bounds() {
    let mut app = App::default();
    let code = app.store_code(predict_contract());
    let err = app
        .instantiate_contract(
            code,
            Addr::unchecked("x"),
            &InstantiateMsg { fee_bps: 501, fee_recipient: None, bounty_bps: 0, min_window: 60 },
            &[],
            "p",
            None,
        )
        .unwrap_err();
    assert_eq!(err.downcast::<ContractError>().unwrap(), ContractError::FeeTooHigh(501, 500));
}
