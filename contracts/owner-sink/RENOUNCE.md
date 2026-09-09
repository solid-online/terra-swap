# Renouncing control of the Terra Swap factory and pools

State on chain 2026-09-09 (checked via LCD):

| what | value |
|---|---|
| factory | `terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd` (code 3108, Astroport's own factory code) |
| factory migrate admin | `terra1ef4g5xlfzts7a9c0p22q7wuc6mwjzzekd6afsv` |
| factory config owner | same key |
| 15 pools (code 392) | migrate admin = same key |
| maker fee | 0 bps (pool fee 30 bps, all to LPs) |

Two kinds of control exist: the **migrate admin** (can swap the code under a
contract) and the factory **owner** (can change fees, fee address, disable
pair types). Both go.

Astroport's factory has no renounce; ownership is proposed by the owner and
claimed by the new owner. Nothing at a burn address can claim, so ownership
is handed to a contract whose only ability is to claim it: `owner-sink`.

## Step 0 — build and test the sink

```bash
cd Astral/contracts/owner-sink
cargo test                 # 1 test: ownership dies in the sink
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="owner_sink_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0
cat artifacts/checksums.txt
```

## One-shot alternative: `renounce.sh`

On the validator server (terrad + the `atrium-admin` key in the `file`
keyring, which is the key that instantiated the factory):

```bash
cd /root/terra-swap-renounce && ./renounce.sh atrium-admin
```

It asks for the keyring passphrase once, uses the local node, and runs
steps 1–4 below with an on-chain check after each. `./verify.sh` re-checks
from a public LCD without any key. The manual steps follow.

## Step 1 — store and instantiate the sink (you sign, `--no-admin`)

```bash
NODE=https://terra-rpc.publicnode.com:443
terrad tx wasm store artifacts/owner_sink.wasm --from <key> --chain-id phoenix-1 \
  --node $NODE --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
# take code_id from the events, then:
terrad tx wasm instantiate <code_id> \
  '{"target":"terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd"}' \
  --label "terra-swap-owner-sink" --no-admin --from <key> --chain-id phoenix-1 \
  --node $NODE --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
# take the sink address from the events → SINK
```

## Step 2 — propose the sink as owner (from the owner key)

```bash
terrad tx wasm execute terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd \
  '{"propose_new_owner":{"owner":"<SINK>","expires_in":604800}}' \
  --from <owner-key> --chain-id phoenix-1 --node $NODE \
  --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
```

## Step 3 — claim (anyone, any key)

```bash
terrad tx wasm execute <SINK> '{"claim":{}}' --from <any-key> --chain-id phoenix-1 \
  --node $NODE --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
```

Verify: factory `{"config":{}}` must show `"owner":"<SINK>"`.

```bash
terrad query wasm contract-state smart terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd '{"config":{}}' --node $NODE
```

From here on, pools the factory creates get the sink as their migrate admin
(the factory sets `admin = owner` on new pairs), i.e. no admin that can act.

## Step 4 — clear the migrate admin on the factory and the 15 pools

```bash
terrad tx wasm clear-contract-admin terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd \
  --from <owner-key> --chain-id phoenix-1 --node $NODE --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y

# every pool the factory knows about, one tx each:
for P in $(terrad query wasm contract-state smart terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd \
    '{"pairs":{"limit":30}}' --node $NODE -o json | jq -r '.data.pairs[].contract_addr'); do
  terrad tx wasm clear-contract-admin $P --from <owner-key> --chain-id phoenix-1 --node $NODE \
    --gas auto --gas-adjustment 1.4 --gas-prices 0.015uluna -y
  sleep 7
done
```

Verify: `terrad query wasm contract <addr> --node $NODE` shows an empty `admin`
for the factory and every pool.

## What this changes, in plain words

- Nobody can upgrade the factory or any pool.
- Nobody can change the pool fee, add a maker fee, change the fee address, or
  disable pair creation.
- The interface fee is already 0 in the frontend (lib/atrium/dex.ts, DEX_FEE_BPS).
- What remains is open-source Astroport code with permissionless pools and a
  website that reads it. Keep the treasury address out of the story: nothing
  flows to it from swaps any more.

Order matters: do step 2–3 before step 4. Once the admin is cleared nothing
depends on it, but clearing the admin does not remove the owner.
