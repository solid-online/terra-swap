/** @type {import('next').NextConfig} */

// Optional canonical host: with CANONICAL_HOST=swap.example.com and
// REDIRECT_HOSTS=example.com,www.example.com, the alias hosts redirect to the
// canonical one. Unset → no redirects (any host serves the app).
const canonical = process.env.CANONICAL_HOST || ''
const aliases = (process.env.REDIRECT_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: { unoptimized: true },
  // Fewer script files per page in the browser. Next splits shared code into many
  // small files, and the swap page loaded 18 of them; every file is a request,
  // and Vercel's Hobby plan counts each one (2026-09-24). Now each page loads
  // Next's own four (webpack, framework, main, _app) and one file of its own,
  // and the two pages that carry the wallet (swap and Predict) share one more
  // with their libraries. The libraries change only when a dependency does, so
  // that file stays cached in the browser across deploys. Code both kinds of
  // page use is copied into each rather than split out; it is a few kB.
  webpack(config, { isServer, dev }) {
    const split = config.optimization && config.optimization.splitChunks
    if (!dev && !isServer && split && split.cacheGroups) {
      const heavy = new Set(['pages/index', 'pages/predict'])
      config.optimization.splitChunks = {
        ...split,
        cacheGroups: {
          framework: split.cacheGroups.framework,
          lib: false,
          default: false,
          defaultVendors: false,
          swapVendor: {
            name: 'swap-vendor',
            test: /[\\/]node_modules[\\/]/,
            chunks: chunk => heavy.has(chunk.name),
            priority: 20,
            enforce: true,
            reuseExistingChunk: true,
          },
        },
      }
    }
    return config
  },
  async rewrites() {
    // As on Terra Scan (2026-09-25): AI crawlers walk every transaction page, each read from the chain and rendered on
    // a function. robots.txt closes /tx/; until they read it again, the ones below get the static 404 there, before any
    // function runs. People and search engines are not matched.
    const crawler = { type: 'header', key: 'user-agent', value: '.*(GPTBot|ClaudeBot|Claude-SearchBot|anthropic-ai|CCBot|Bytespider|Amazonbot|PerplexityBot|meta-externalagent|OAI-SearchBot|Applebot-Extended|Diffbot|ImagesiftBot|Timpibot).*' }
    return { beforeFiles: [{ source: '/tx/:path*', has: [crawler], destination: '/crawler-closed' }] }
  },
  async redirects() {
    if (!canonical) return []
    return aliases.map(host => ({
      source: '/:path*',
      has: [{ type: 'host', value: host }],
      destination: `https://${canonical}/:path*`,
      permanent: false,
    }))
  },
  async headers() {
    return [
      {
        // Everything but the embed: never framed by another site.
        source: '/((?!embed).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'" },
        ],
      },
      {
        // Token icons and app icons: a day in the browser, then served stale while it checks. Without this every
        // icon was checked with the server on every visit (max-age=0), about twenty requests on the Pools tab.
        source: '/img/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
      {
        // The service worker (price alerts with the page closed) is checked for a new version on every visit.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // The embed is made to be framed anywhere. It holds no wallet and signs nothing; its button opens Terra Swap in a new tab.
        source: '/embed',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors *; form-action 'self'" },
        ],
      },
    ]
  },
}

module.exports = nextConfig
