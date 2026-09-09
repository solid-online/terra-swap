import { useWallet } from 'components/providers/WalletProvider'
import { useMemo } from 'react'

export const terraChains = ['phoenix-1', 'pisco-1'] as const

const useMyAddress = (): string => {
  const { address, isWalletConnected } = useWallet()

  const myAddress = useMemo(() => {
    if (!isWalletConnected || !address) return ''

    return address
  }, [address, isWalletConnected])

  return myAddress
}

export default useMyAddress
