# Terra Predict — deploy

Admin-less parimutuel YES/NO markets settled by an on-chain TWAP from an
Astroport pair. No oracle, no operator, no migrate entry point. What you
instantiate is what runs, forever.

## 1. Build (reproducible)

```bash
cd Astral/contracts/predict
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="terra_predict_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0
sha256sum artifacts/terra_predict.wasm   # must match artifacts/checksums.txt
```

Tests: `cargo test` (12 integration tests against a mock pair, incl. fee and
bounty maths, void paths, decimals scaling, counter wrap-around).

The optimizer image ships Cargo 1.78, which cannot read crates that use
edition 2024. `Cargo.lock` is pinned accordingly; if you ever regenerate it
with a newer local Cargo, re-pin before building:

```bash
cargo update -p zeroize --precise 1.8.1
cargo update -p base64ct --precise 1.6.0
```

Stay on optimizer 0.16.x (Rust 1.78): newer Rust turns on wasm
`reference-types`/`multivalue` by default, which CosmWasm 1.x chains reject.

## 2. Store

```bash
terrad tx wasm store artifacts/terra_predict.wasm \
  --from <your-key> --chain-id phoenix-1 \
  --node https://terra-rpc.publicnode.com:443 \
  --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
```

Take `code_id` from the tx events.

## 3. Instantiate — with `--no-admin`

Parameters are immutable afterwards. Suggested for the experiment:

| field | value | meaning |
|---|---|---|
| `fee_bps` | `100` | 1% of the losing pool to `fee_recipient` (max 500) |
| `fee_recipient` | your treasury | omit/null → the fee stays with the winners |
| `bounty_bps` | `20` | 0.2% of the losing pool, half to the observer, half to the resolver (max 100) |
| `min_window` | `600` | shortest TWAP window a market may use, seconds |

```bash
terrad tx wasm instantiate <code_id> \
  '{"fee_bps":100,"fee_recipient":"<treasury terra1…>","bounty_bps":20,"min_window":600}' \
  --label "Terra Predict" --no-admin \
  --from <your-key> --chain-id phoenix-1 \
  --node https://terra-rpc.publicnode.com:443 \
  --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
```

`--no-admin` matters: the contract has no migrate entry point, and without an
admin nobody can ever attach one.

## 4. Point the site at it

```bash
cd Solid/atrium
vercel env add NEXT_PUBLIC_PREDICT_CONTRACT production   # paste the contract address
vercel --prod --yes
```

Until the variable is set, swap.terraluna.app/predict shows "Not live yet".

## 5. First market (optional smoke test)

Anyone can open a market from the page. From the CLI, the deepest LUNA/USDC
market on Terra is Astroport's concentrated pair
`terra1v3lqxl0eyte9x3nhdgcj8hwvjq76aupnnzz0yll8mxs5cckc29pqvg2scu`
(verified 2026-09-09: `cumulative_prices` answers, precision 10^6).

```json
{"create_market":{
  "question":"1 LUNA ≥ 0.05 USDC?",
  "pair":"terra1v3lqxl0eyte9x3nhdgcj8hwvjq76aupnnzz0yll8mxs5cckc29pqvg2scu",
  "base":{"native_token":{"denom":"uluna"}},
  "quote":{"native_token":{"denom":"ibc/2C962DAB9F57FE0921435426AE75196009FAA1981BF86991203C8411F8980FDB"}},
  "base_decimals":6,"quote_decimals":6,
  "threshold":"0.05","price_precision":null,
  "denom":"uluna","min_bet":"1000000",
  "close_at":<unix>,"resolve_at":<unix + window>,"twap_window":3600
}}
```

Rules the contract enforces: betting stays open ≥ 10 min after creation; the
whole TWAP window lies after `close_at`; markets run ≤ 366 days.

## How settlement works, for the proposal text

1. Betting closes at `close_at`.
2. The window is the `twap_window` seconds ending at `resolve_at`. In its
   first half, anyone calls `observe`, which records the pair's cumulative
   price counter. First one in earns half the bounty.
3. At `resolve_at`, anyone calls `resolve`. The contract reads the counter
   again; the time-weighted average price over the elapsed interval decides
   YES (≥ threshold) or NO. The resolver earns the other half of the bounty.
4. Winners `claim`: stake back plus a pro-rata share of the losing pool minus
   fee and bounty. Losers get nothing.
5. If nobody observed, or the winning side is empty, the market is **void**:
   every stake is refundable, no fee, no bounty. If a market sits unresolved
   for a week after `resolve_at` (pair unreadable), anyone can `void` it.

## Legal note (the host's call, not the contract's)

A cash-settled yes/no on a price is economically a binary option. In several
jurisdictions (the EU under the ESMA product intervention, among others) that
cannot be offered to retail, and stakes in money can also fall under gambling
law. The contract is permissionless; an interface is published by someone.
Whoever hosts an interface decides where it may be used, and the reference
interface withholds wallet actions in the countries it lists.
