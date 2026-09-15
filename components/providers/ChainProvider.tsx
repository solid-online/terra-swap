import { ChainProvider as Provider } from '@cosmos-kit/react'
import { ReactNode } from 'react'
import { customWallets, mobileWallets, WALLETCONNECT_PROJECT_ID } from 'constants/wallet'
// Narrow import — only terra2. Default `chain-registry` import pulls
// the entire mainnet/ directory into every visitor's bundle.
import terra2Chain from 'chain-registry/mainnet/terra2/chain'
import terra2Assets from 'chain-registry/mainnet/terra2/assets'
// Noble, for moving USDC in and out (lib/noble). Also narrow imports.
import nobleChain from 'chain-registry/mainnet/noble/chain'
import nobleAssets from 'chain-registry/mainnet/noble/assets'
// The Cosmos Hub, for moving ATOM in and out (lib/cosmoshub).
import cosmoshubChain from 'chain-registry/mainnet/cosmoshub/chain'
import cosmoshubAssets from 'chain-registry/mainnet/cosmoshub/assets'
// Injective, for moving USDC.inj in and out. Its transactions are built and
// broadcast in lib/injective, not by the wallet kit's signing client.
import injectiveChain from 'chain-registry/mainnet/injective/chain'
import injectiveAssets from 'chain-registry/mainnet/injective/assets'
// Neutron (ASTRO, dATOM, FUEL) and Stride (stLUNA, stATOM), for moving their tokens in and out (lib/neutron, lib/stride).
import neutronChain from 'chain-registry/mainnet/neutron/chain'
import neutronAssets from 'chain-registry/mainnet/neutron/assets'
import strideChain from 'chain-registry/mainnet/stride/chain'
import strideAssets from 'chain-registry/mainnet/stride/assets'
import { EndpointOptions, SignerOptions } from '@cosmos-kit/core'
import { CHAIN_CONFIGS } from 'constants/chainsConfig'
import { GasPrice } from '@cosmjs/stargate'
import { Chain } from '@chain-registry/types'
import { REST_ENDPOINTS, RPC_ENDPOINTS } from 'lib/lcd'
import { NOBLE_REST_ENDPOINTS, NOBLE_RPC_ENDPOINTS } from 'lib/noble'
import { GAS_PRICE } from 'lib/gas'
import { HUB_CHAIN_ID, HUB_GAS_PRICE, HUB_REST_ENDPOINTS, HUB_RPC_ENDPOINTS } from 'lib/cosmoshub'
import { INJECTIVE_REST_ENDPOINTS, INJECTIVE_RPC_ENDPOINTS } from 'lib/injective'
import { NEUTRON_CHAIN_ID, NEUTRON_GAS_PRICE, NEUTRON_REST_ENDPOINTS, NEUTRON_RPC_ENDPOINTS } from 'lib/neutron'
import { STRIDE_CHAIN_ID, STRIDE_GAS_PRICE, STRIDE_REST_ENDPOINTS, STRIDE_RPC_ENDPOINTS } from 'lib/stride'

const chains = [terra2Chain, nobleChain, cosmoshubChain, injectiveChain, neutronChain, strideChain]
const assets = [terra2Assets, nobleAssets, cosmoshubAssets, injectiveAssets, neutronAssets, strideAssets]

// ─── Module-level frozen constants ─────────────────────────────
//
// Every prop passed to cosmos-kit's <Provider> must be a STABLE
// reference — otherwise its internal state machine partially
// re-initialises on re-renders, which looks to users like
// "logged out and back in". The cheapest way to get stability is
// to build these objects once, at module load, outside React.

const walletsStatic = [...customWallets, ...mobileWallets]

const endpointOptionsStatic: { endpoints: EndpointOptions['endpoints']; isLazy: boolean } = {
  endpoints: Object.values(CHAIN_CONFIGS).reduce<EndpointOptions['endpoints']>(
    (endpoints, config) => ({
      ...endpoints,
      // Terra mainnet gets every endpoint in lib/lcd, and the wallet kit
      // tests them at connect so one endpoint being down does not stop signing.
      [config.registryChainName]: config.registryChainName === 'terra2'
        ? { rpc: RPC_ENDPOINTS, rest: REST_ENDPOINTS, isLazy: false }
        : { rpc: [config.rpc], rest: [config.lcd] },
    }),
    {
      noble: { rpc: NOBLE_RPC_ENDPOINTS, rest: NOBLE_REST_ENDPOINTS, isLazy: false },
      cosmoshub: { rpc: HUB_RPC_ENDPOINTS, rest: HUB_REST_ENDPOINTS, isLazy: false },
      injective: { rpc: INJECTIVE_RPC_ENDPOINTS, rest: INJECTIVE_REST_ENDPOINTS, isLazy: false },
      neutron: { rpc: NEUTRON_RPC_ENDPOINTS, rest: NEUTRON_REST_ENDPOINTS, isLazy: false },
      stride: { rpc: STRIDE_RPC_ENDPOINTS, rest: STRIDE_REST_ENDPOINTS, isLazy: false },
    },
  ),
  isLazy: true,
}

const signerOptionsStatic: SignerOptions = {
  // Noble charges its network fee in USDC, the Hub in ATOM.
  //@ts-ignore
  signingStargate: (chain: Chain) => (chain.chain_id === 'noble-1'
    ? { gasPrice: GasPrice.fromString('0.1uusdc') }
    : chain.chain_id === HUB_CHAIN_ID ? { gasPrice: GasPrice.fromString(HUB_GAS_PRICE) }
    : chain.chain_id === NEUTRON_CHAIN_ID ? { gasPrice: GasPrice.fromString(NEUTRON_GAS_PRICE) }
    : chain.chain_id === STRIDE_CHAIN_ID ? { gasPrice: GasPrice.fromString(STRIDE_GAS_PRICE) } : undefined),
  //@ts-ignore
  signingCosmwasm: (chain: Chain) => {
    switch (chain.chain_id) {
      case 'phoenix-1':
      case 'pisco-1':
        return {
          gasPrice: GasPrice.fromString(GAS_PRICE),
        }
    }
  },
}

const walletConnectOptionsStatic = {
  signClient: {
    projectId: WALLETCONNECT_PROJECT_ID,
    relayUrl: 'wss://relay.walletconnect.org',
  },
}

const sessionOptionsStatic = {
  // 7-day session. cosmos-kit restores from localStorage on mount,
  // so even page reloads keep the user signed in for a week.
  duration: 1000 * 60 * 60 * 24 * 7,
}

const ChainProvider = ({ children }: { children: ReactNode }) => {
  return (
    <Provider
      chains={chains}
      wallets={walletsStatic}
      assetLists={assets}
      walletConnectOptions={walletConnectOptionsStatic}
      signerOptions={signerOptionsStatic}
      endpointOptions={endpointOptionsStatic}
      sessionOptions={sessionOptionsStatic}
    >
      {children}
    </Provider>
  )
}

export default ChainProvider
