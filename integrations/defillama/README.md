# Terra Swap on DefiLlama

Two adapters, ready to submit as pull requests to DefiLlama's repositories. Nothing
here runs on this site; it is the code DefiLlama runs to read Terra Swap.

| File | Goes to | What it reads |
| --- | --- | --- |
| `projects/terra-swap-terraluna/index.js` | [DefiLlama-Adapters](https://github.com/DefiLlama/DefiLlama-Adapters) | Liquidity in the pools of Terra Swap's own factory, straight from the chain with DefiLlama's own factory helper |
| `dexs/terra-swap-terraluna/index.ts` | [dimension-adapters](https://github.com/DefiLlama/dimension-adapters) | Daily volume and pool fees from `https://swap.terraluna.app/api/volume` |

## Before submitting

- **The name.** DefiLlama already lists TerraSwap, an older and unrelated DEX with its own
  factory on the same chain. List this one under a name that cannot be read as that one,
  for example "Terra Swap (terraluna)", and link swap.terraluna.app.
- **Volume history starts when the site began writing prices down** (see
  `lib/priceHistory.ts`). Set `start` in the volume adapter to the first date
  `/api/volume?date=…` answers with `unpriced: 0` for a day with swaps.
- **What is counted.** Only pools on Terra Swap's factory. Swaps the site routes through
  Astroport's pools are Astroport's volume and are already on Astroport's listing.
- Test the TVL adapter from the root of DefiLlama-Adapters with
  `node test.js projects/terra-swap-terraluna/index.js`, and the volume adapter from the root
  of dimension-adapters with `npm test dexs terra-swap-terraluna`.
