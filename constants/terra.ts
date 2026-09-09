import { MainWalletBase } from '@cosmos-kit/core'
import { customWallets } from './wallet'

export interface ExplorerConfig {
  kind: string
  url: string
  tx_page: string
  account_page: string
}

export interface ChainConfig {
  chain: string
  registryChainName: string
  prettyName: string
  lcd: string
  rpc: string
  wallets: MainWalletBase[]
  gas: {
    gasPrice: {
      tokenPerGas: number
      denom: string
    }
    gasAdjustment: number
    maxGasLimit: number
  }
  explorerLink: ExplorerConfig[]
}

export interface ChainConfigs {
  [chainId: string]: ChainConfig
}

export const TERRA_CHAIN_CONFIGS: ChainConfigs = {
  'phoenix-1': {
    chain: 'terra',
    registryChainName: 'terra2',
    prettyName: 'Terra',
    lcd: process.env.NEXT_PUBLIC_LCD || 'https://terra-rest.publicnode.com',
    rpc: process.env.NEXT_PUBLIC_RPC || 'https://terra-rpc.publicnode.com:443',
    wallets: customWallets,
    gas: {
      gasPrice: {
        tokenPerGas: 0.0151,
        denom: 'uluna',
      },
      gasAdjustment: 1.5,
      maxGasLimit: 25_000_000,
    },
    explorerLink: [
      {
        kind: 'mintscan',
        url: 'https://www.mintscan.io/terra',
        tx_page: 'https://www.mintscan.io/terra/transactions/${txHash}',
        account_page:
          'https://www.mintscan.io/terra/accounts/${accountAddress}',
      },
    ],
  },
  'pisco-1': {
    chain: 'terra',
    registryChainName: 'terra2testnet',
    prettyName: 'Terra 2.0',
    lcd: 'https://pisco-lcd.terra.dev',
    rpc: 'https://terra-testnet-rpc.polkachu.com:443',
    wallets: customWallets,
    gas: {
      gasPrice: {
        tokenPerGas: 0.0151,
        denom: 'uluna',
      },
      gasAdjustment: 1.5,
      maxGasLimit: 25_000_000,
    },
    explorerLink: [
      {
        kind: 'mintscan',
        url: 'https://www.mintscan.io/terra',
        tx_page: 'https://www.mintscan.io/terra/transactions/${txHash}',
        account_page:
          'https://www.mintscan.io/terra/accounts/${accountAddress}',
      },
    ],
  },
}
