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
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'" },
        ],
      },
    ]
  },
}

module.exports = nextConfig
