import { ReactNode, createContext, useContext, useMemo } from 'react'
import { useChain } from '@cosmos-kit/react'
import type { ChainContext } from '@cosmos-kit/core'
import { defaultChain } from 'constants/chain'

const Context = createContext<ChainContext>({} as ChainContext)

const WalletProvider = ({ children }: { children: ReactNode }) => {
  const wallet = useChain(defaultChain)

  const value = useMemo(() => {
    return wallet
  }, [wallet])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export default WalletProvider

export function useWallet() {
  const context = useContext(Context)
  return context
}
