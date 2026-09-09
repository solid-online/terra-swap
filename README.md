# Terra Swap

An open interface for permissionless liquidity pools on Terra (phoenix-1),
plus **Terra Predict**, an admin-less prediction market. Experimental.

Anyone can run this. The pools are on chain and belong to no one; this
repository is one way to look at them.

**Live instance:** https://swap.terraluna.app

## What it is

- **Pools** are Astroport's audited constant-product pair contract
  (code id 392), created through an instance of Astroport's own factory
  (code id 3108). Nothing in the AMM is ours.
- **The factory's ownership has been renounced** to a contract that can never
  use it, and the migrate admin is cleared on the factory and on every pool.
  Nobody can change fees, upgrade code, or stop pool creation.
  Factory: `terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd`
  Owner sink: `terra1ylr5lqj9e4ehjpxc4944rhjcmq7zdaju50r3tn60vn7rsqym50gq5w27l3`
  Check it yourself: query the factory's `{"config":{}}` and any pool's
  contract info on a public LCD.
- **No interface fee.** The pool fee (0.3%) goes to liquidity providers.
- **Non-custodial.** The wallet signs, the chain executes. Nothing is held.
- **Terra Predict** (`/predict`) is a parimutuel YES/NO market settled by a
  time-weighted price read from an Astroport pair, by whoever shows up to read
  it. Contract source, tests and reproducible build: `contracts/predict`.
  The interface shows "not live yet" until a contract address is configured.
- **`contracts/owner-sink`** is the 60-line contract the factory's ownership
  was handed to, with the script and the read-only verifier used to do it.

## Run it

```bash
git clone https://github.com/solid-online/terra-swap
cd terra-swap
cp .env.example .env.local        # defaults point at the live factory
npm install
npm run dev                       # http://localhost:3000
```

Production: `npm run build && npm start`, or any Node host.

### Deploy to Vercel in one click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsolid-online%2Fterra-swap&env=NEXT_PUBLIC_DEX_FACTORY&envDescription=The%20factory%20address%20the%20swap%20reads%20pools%20from&project-name=terra-swap)

Everything else is optional: see `.env.example`.

## Configuration

| variable | what |
|---|---|
| `NEXT_PUBLIC_DEX_FACTORY` | factory address (required) |
| `NEXT_PUBLIC_PREDICT_CONTRACT` | Terra Predict contract; empty shows "not live yet" |
| `NEXT_PUBLIC_LCD`, `NEXT_PUBLIC_RPC` | chain endpoints, any public Terra node |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | needed only for mobile wallets |
| `NEXT_PUBLIC_BOOST_CW721` | cw721 whose holders get 1.5× points; empty to disable |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel KV for the board and caches; optional |
| `BLOCKED_COUNTRIES` | where wallet actions are withheld, default `US,CA,GB` |
| `GEOBLOCK_BYPASS_SECRET` | `?bypass=<secret>` lifts the gate for testing |

## Region posture

Pages and read APIs are open everywhere. In the countries listed in
`BLOCKED_COUNTRIES` the interface withholds the wallet connection. That is
this interface's posture; each host sets their own. The contracts on chain
are permissionless regardless.

## Structure

```
pages/index.tsx            the swap: swap · pools · open a pool · board
pages/predict.tsx          Terra Predict
pages/api/dex.ts           pools, TVL, chain head
pages/api/dex-market.ts    reference prices from Astroport's deepest pools
pages/api/dex-prices.ts    trade series per pair
pages/api/dex-leaderboard.ts the board, from on-chain events
pages/api/dex-arcade.ts    arcade scores
pages/api/predict.ts       markets, spot, running TWAPs
pages/api/og/swap.tsx      social card (edge)
lib/dex.ts                 pool maths, queries, known tokens
lib/predict.ts             market helpers
components/transactions/   the messages the wallet signs
middleware.ts              region cookie
```

## License

MIT. Fork it, host it, change it. If you run a public instance, say so in
Telegram so people can find it.
