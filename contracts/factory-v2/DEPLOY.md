# Factory v2: concentrated and stable pools

Terra Swap's first factory only opens standard (xyk) pools, and its ownership is
already in a contract that can never use it, so no pool type can be added to it.
Factory v2 is a second factory with the same rules and two more pool types:

| Pool type | Code | For | Fees |
|---|---|---|---|
| Concentrated (Astroport PCL) | 2569 | liquid staking pairs such as LUNA/ampLUNA, and volatile pairs | set per pool at creation, 100% to liquidity providers |
| Stable | 428 | pairs that should trade near 1:1, such as two dollar stablecoins | 0.05%, 100% to liquidity providers |

## What makes it the same as v1

- **No fee to anyone but liquidity providers.** The factory has no fee address.
  Astroport's pair code only takes a maker fee when the factory names a fee
  address (`contracts/pair_concentrated/src/contract.rs`, `fee_info.fee_address`).
- **Nobody can change it.** It is instantiated with no admin, so it cannot be
  migrated. Its ownership goes to a fresh owner sink (code 4025,
  `contracts/owner-sink`), which can only accept ownership and never act on it.
  A pool's settings can only be changed by the factory owner, so every pool's
  settings are fixed at creation.
- **No new code.** Every contract runs code already on chain: Astroport's
  factory (3108) and pair code (2569, 428), the owner sink (4025) and the Terra
  Swap router (4028). `deploy.sh` checks all five checksums before signing.

## Router v2

The router checks that every pool on a route belongs to a factory it trusts,
and its list is fixed at instantiation. Router v1 trusts Terra Swap v1 and
Astroport. Router v2 is the same code trusting v1, v2 and Astroport, with no
admin.

## Steps

```bash
./deploy.sh <key-name>
```

1. Instantiate factory v2 with no admin (the deploy key is owner for one step).
2. Instantiate an owner sink pointed at it, with no admin.
3. Propose the sink as owner, then claim through the sink.
4. Instantiate router v2 with no admin.

Then set `NEXT_PUBLIC_DEX_FACTORY_V2` and `NEXT_PUBLIC_TERRA_SWAP_ROUTER` in the
site's environment. Until the first is set, the site shows nothing of v2.

## Checked before signing

`simulate.cjs` dry-runs the messages as the deploy address against the live
chain (no keys, nothing broadcast): the factory v2 instantiation with these
settings, the sink and router instantiations, and pool creation with the
liquid staking preset and the stable preset. All passed on 2026-09-16.

```bash
NODE_PATH=../../node_modules node simulate.cjs
./verify.sh <factory-v2> <router-v2>   # after deploying, read-only
```
