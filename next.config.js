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
