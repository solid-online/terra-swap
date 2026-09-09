import { ChainProvider as Provider } from '@cosmos-kit/react'
import { ReactNode } from 'react'
import { customWallets, mobileWallets, WALLETCONNECT_PROJECT_ID } from 'constants/wallet'
// Narrow import — only terra2. Default `chain-registry` import pulls
// the entire mainnet/ directory into every visitor's bundle.
import terra2Chain from 'chain-registry/mainnet/terra2/chain'
import terra2Assets from 'chain-registry/mainnet/terra2/assets'
import { EndpointOptions, SignerOptions } from '@cosmos-kit/core'
import { CHAIN_CONFIGS } from 'constants/chainsConfig'
import { GasPrice } from '@cosmjs/stargate'
import { Chain } from '@chain-registry/types'

const chains = [terra2Chain]
const assets = [terra2Assets]

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
      [config.registryChainName]: {
        rpc: [config.rpc],
        rest: [config.lcd],
      },
    }),
    {},
  ),
  isLazy: true,
}

const signerOptionsStatic: SignerOptions = {
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
