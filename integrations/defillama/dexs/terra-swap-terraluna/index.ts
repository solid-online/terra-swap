import { FetchOptions, FetchResultV2, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import fetchURL from "../../utils/fetchURL";

// Terra Swap's own pools on Terra (swap.terraluna.app). Every pool is constant-product with a 0.3% fee,
// all of it paid to liquidity providers; the protocol keeps nothing.
const fetch = async (options: FetchOptions): Promise<FetchResultV2> => {
  const r = await fetchURL(`https://swap.terraluna.app/api/volume?start=${options.startTimestamp}&end=${options.endTimestamp}`);
  const dailyFees = options.createBalances();
  dailyFees.addUSDValue(r.feesUsd);
  return {
    dailyVolume: r.volumeUsd,
    dailyFees,
    dailyUserFees: dailyFees,
    dailyRevenue: 0,
    dailyProtocolRevenue: 0,
    dailySupplySideRevenue: dailyFees,
  };
};

const adapter: SimpleAdapter = {
  version: 2,
  fetch,
  chains: [CHAIN.TERRA2],
  // The first day the site's own price record covers; see integrations/defillama/README.md.
  start: "2026-09-16",
  methodology: {
    Volume: "Dollar value of swaps through the pools of Terra Swap's own factory, each at its token's average price that day as recorded by the site. Swaps routed through Astroport's pools are not counted.",
    Fees: "0.3% of every swap, paid by the trader.",
    UserFees: "0.3% of every swap, paid by the trader.",
    Revenue: "The protocol keeps no part of the fee.",
    ProtocolRevenue: "The protocol keeps no part of the fee.",
    SupplySideRevenue: "All of the fee goes to the pool's liquidity providers.",
  },
};

export default adapter;
