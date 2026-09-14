import { ChainProvider as Provider } from '@cosmos-kit/react'
import { ReactNode } from 'react'
import { customWallets, mobileWallets, WALLETCONNECT_PROJECT_ID } from 'constants/wallet'
// Narrow import — only terra2. Default `chain-registry` import pulls
// the entire mainnet/ directory into every visitor's bundle.
import terra2Chain from 'chain-registry/mainnet/terra2/chain'
import terra2Assets from 'chain-registry/mainnet/terra2/assets'
// Noble, for moving USDC in and out (lib/skip). Also narrow imports.
import nobleChain from 'chain-registry/mainnet/noble/chain'
import nobleAssets from 'chain-registry/mainnet/noble/assets'
// Injective, for moving USDC.inj in and out. Its transactions are built and
// broadcast in lib/injective, not by the wallet kit's signing client.
import injectiveChain from 'chain-registry/mainnet/injective/chain'
import injectiveAssets from 'chain-registry/mainnet/injective/assets'
import { EndpointOptions, SignerOptions } from '@cosmos-kit/core'
import { CHAIN_CONFIGS } from 'constants/chainsConfig'
import { GasPrice } from '@cosmjs/stargate'
import { Chain } from '@chain-registry/types'
import { REST_ENDPOINTS, RPC_ENDPOINTS } from 'lib/lcd'
import { NOBLE_REST_ENDPOINTS, NOBLE_RPC_ENDPOINTS } from 'lib/skip'
import { INJECTIVE_REST_ENDPOINTS, INJECTIVE_RPC_ENDPOINTS } from 'lib/injective'

const chains = [terra2Chain, nobleChain, injectiveChain]
const assets = [terra2Assets, nobleAssets, injectiveAssets]

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
      injective: { rpc: INJECTIVE_RPC_ENDPOINTS, rest: INJECTIVE_REST_ENDPOINTS, isLazy: false },
    },
  ),
  isLazy: true,
}

const signerOptionsStatic: SignerOptions = {
  // Noble charges its network fee in USDC.
  //@ts-ignore
  signingStargate: (chain: Chain) => (chain.chain_id === 'noble-1' ? { gasPrice: GasPrice.fromString('0.1uusdc') } : undefined),
  //@ts-ignore
  signingCosmwasm: (chain: Chain) => {
    switch (chain.chain_id) {
      case 'phoenix-1':
      case 'pisco-1':
        return {
          gasPrice: GasPrice.fromString('0.15uluna'),
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
