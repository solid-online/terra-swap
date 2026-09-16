/**
 * /sitemap.xml: the pages search engines should know about. The sections of
 * the app, /stats and /verify, a page per listed token that sits in a pool,
 * and a page per pool with liquidity on either factory. Built from the same
 * server-side pool read as the stats routes and cached at the edge for an hour.
 */

import type { GetServerSideProps } from 'next'
import { KNOWN_TOKENS, assetId } from 'lib/dex'
import { sitePools } from 'lib/sitePools'

export const config = { maxDuration: 60 }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const base = `https://${req.headers.host ?? 'swap.openfields.app'}`
  const urls = ['/', '/?tab=pools', '/?tab=bridge', '/stats', '/verify']
  let tokens = KNOWN_TOKENS.map(t => t.key)
  const pools: string[] = []
  try {
    const live = (await sitePools()).pools.filter(p => (p.tvlUsd ?? 0) >= 10)
    const held = new Set(live.flatMap(p => p.tokens.map(t => assetId(t.info))))
    tokens = KNOWN_TOKENS.filter(t => held.has(assetId(t.info))).map(t => t.key)
    for (const p of live) pools.push(`/pool/${p.contract_addr}`)
  } catch { /* the app's sections and every listed token still go out */ }
  urls.push(...tokens.map(k => `/token/${encodeURIComponent(k)}`), ...pools)
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(base + u)}</loc></url>`).join('\n')}\n</urlset>\n`
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.write(body)
  res.end()
  return { props: {} }
}

export default function Sitemap() {
  return null
}
