import { ReactNode, useState } from 'react'
import { QueryClient, QueryClientProvider } from 'react-query'
import ChainProvider from './ChainProvider'
import WalletProvider from './WalletProvider'

const Providers = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <ChainProvider>
        <WalletProvider>{children}</WalletProvider>
      </ChainProvider>
    </QueryClientProvider>
  )
}

export default Providers
