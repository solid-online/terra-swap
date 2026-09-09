import { wallets as keplrWallets } from '@cosmos-kit/keplr-extension'
import { wallets as leapWallets } from '@cosmos-kit/leap-extension'
import { wallets as keplrMobileWallets } from '@cosmos-kit/keplr-mobile'

/** WalletConnect Cloud project id. Only needed for mobile wallets (Keplr Mobile). */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ''

export const customWallets = [...keplrWallets, ...leapWallets]

/** Mobile wallets connect over WalletConnect and need a project id; without one the list is empty. */
export const mobileWallets = WALLETCONNECT_PROJECT_ID ? [...keplrMobileWallets] : []
