# Terra Swap router — deploy

One transaction through pools on Terra Swap's and Astroport's factories. Each
hop names the factory that owns its pair; the router looks the pair up there,
swaps everything it holds of the offered token, hands the whole return to the
next hop, sends the last return straight to the receiver, and reverts unless at
least `minimum_receive` arrived. No owner, no admin, no fee, no migrate entry
point. The factory list is fixed at instantiation.

Why it exists: Astroport's router only looks pairs up in Astroport's factory,
so a route that touches Terra Swap's pools had to be signed as separate swaps,
and separate swaps leave about the slippage setting of each intermediate token
in the wallet.

## 1. Build (reproducible)

```bash
cd contracts/router
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="terra_swap_router_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0
sha256sum artifacts/terra_swap_router.wasm   # must match artifacts/checksums.txt
```

Tests: `cargo test` (10 tests against mock factories, a pair as strict as
Astroport's about its messages, and real cw20 tokens: routes across two
factories with native and cw20 entry, full hand-off with nothing left in the
router, the minimum reverting everything, bad routes and funds, internal steps
closed to outsiders, the exact JSON sent to pairs).

Stay on optimizer 0.16.x (Rust 1.78). `Cargo.lock` pins `zeroize 1.8.1` and
`base64ct 1.6.0`, which that toolchain can still read; re-pin if you regenerate
the lock with a newer Cargo:

```bash
cargo update -p zeroize --precise 1.8.1
cargo update -p base64ct --precise 1.6.0
```

## 2. Store

```bash
terrad tx wasm store artifacts/terra_swap_router.wasm \
  --from <your-key> --chain-id phoenix-1 \
  --node https://terra-rpc.publicnode.com:443 \
  --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
```

Take `code_id` from the tx events.

## 3. Instantiate, with `--no-admin`

```bash
terrad tx wasm instantiate <code_id> \
  '{"factories":["terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd","terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r"]}' \
  --label "Terra Swap router" --no-admin \
  --from <your-key> --chain-id phoenix-1 \
  --node https://terra-rpc.publicnode.com:443 \
  --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
```

The first factory is Terra Swap's, the second Astroport's. Take the contract
address from the tx events.

## 4. Check it

```bash
./verify.sh <router address>
```

Read-only, through a public endpoint: the stored code matches
`artifacts/checksums.txt`, the contract has no admin, and its factory list is
exactly the two above.

## 5. Point the site at it

Simulate a real route through the deployed router first (a route that crosses
from a Terra Swap pool into an Astroport pool). Then:

```bash
vercel env add NEXT_PUBLIC_TERRA_SWAP_ROUTER production   # the router address
vercel --prod --yes
```

Until the variable is set, routes that touch Terra Swap's pools stay signed as
separate swaps and the page says what they leave in the wallet.

## Messages

Native entry, attach exactly one coin, the first operation's offer:

```json
{"execute_swap_operations":{
  "operations":[
    {"factory":"terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd","offer_asset_info":{"native_token":{"denom":"ibc/E8481AD838C31D4FC12A504B10F9B4E2F830F8818D2735C2FFC707579B5FA60B"}},"ask_asset_info":{"token":{"contract_addr":"terra10aa3zdkrc7jwuf8ekl3zq7e7m42vmzqehcmu74e4egc7xkm5kr2s0muyst"}}},
    {"factory":"terra14x9fr055x5hvr48hzy2t4q7kvjvfttsvxusa4xsdcy702mnzsvuqprer8r","offer_asset_info":{"token":{"contract_addr":"terra10aa3zdkrc7jwuf8ekl3zq7e7m42vmzqehcmu74e4egc7xkm5kr2s0muyst"}},"ask_asset_info":{"native_token":{"denom":"uluna"}}}
  ],
  "minimum_receive":"380000000"
}}
```

cw20 entry: `send` the token to the router with the same object as the message.
Optional `to` sends the output to another address. At most 6 operations.
