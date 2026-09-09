import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import ErrorBoundary from 'components/ErrorBoundary'
import { TxRegionGateProvider } from 'components/RegionGate'
import RegionBanner from 'components/RegionBanner'
import 'styles/globals.css'

// The wallet stack (cosmos-kit, wallet adapters, WalletConnect) is client-only.
// Social meta is rendered here, server-side, so crawlers get it without it.
const Providers = dynamic(() => import('components/providers/Providers'), { ssr: false })

/** Per-page social card, resolved in the page's getServerSideProps. */
interface PageOg {
  title: string
  image?: string | null
  description?: string
  url?: string
  type?: 'website' | 'article'
  icon?: string
  touchIcon?: string
}

export default function App({ Component, pageProps }: AppProps) {
  const og = (pageProps as { og?: PageOg } | undefined)?.og ?? null
  const title = og?.title ?? 'Terra Swap'
  const description = og?.description ?? 'A decentralized exchange on Terra. Experimental.'
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta key='description' name='description' content={description} />
        <meta key='og:title' property='og:title' content={title} />
        <meta key='og:description' property='og:description' content={description} />
        <meta key='og:type' property='og:type' content={og?.type ?? 'website'} />
        {og?.url && <meta key='og:url' property='og:url' content={og.url} />}
        {og?.image && <meta key='og:image' property='og:image' content={og.image} />}
        <meta key='twitter:card' name='twitter:card' content='summary_large_image' />
        <meta key='twitter:title' name='twitter:title' content={title} />
        <meta key='twitter:description' name='twitter:description' content={description} />
        {og?.image && <meta key='twitter:image' name='twitter:image' content={og.image} />}
        <link key='icon' rel='icon' type='image/svg+xml' href={og?.icon ?? '/img/terra-globe.svg'} />
        <link key='apple-touch-icon' rel='apple-touch-icon' href={og?.touchIcon ?? '/img/terra-globe-180.png'} />
        <meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover' />
      </Head>
      <ErrorBoundary>
        <Providers>
          <TxRegionGateProvider>
            <RegionBanner />
            <ErrorBoundary>
              <Component {...pageProps} />
            </ErrorBoundary>
          </TxRegionGateProvider>
        </Providers>
      </ErrorBoundary>
    </>
  )
}
