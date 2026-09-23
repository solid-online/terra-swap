import { Montserrat } from 'next/font/google'

/**
 * The typeface is bundled with the site at build time rather than loaded from
 * Google's servers when a page opens. Loading it from Google sends every
 * visitor's address to a third party, and a German court held in 2022 that
 * doing so without consent breaks the GDPR. Served from here, no visitor's
 * address goes anywhere but the host this page is on.
 */
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

/**
 * The bundled face under the name the build gives it ('Montserrat' alone no
 * longer matches anything). Canvas text needs it spelled out, since a CSS
 * variable does not reach there.
 */
export const MONTSERRAT = montserrat.style.fontFamily

// The classic Terra brand face is Gotham (terra.money served "Gotham A/B"
// from Hoefler & Co's cloud.typography in 2020–21; the wordmark is Gotham
// Bold). Gotham is a commercial licence, so we use Montserrat — the well-known
// free Gotham lookalike (same geometric skeleton, double-storey a, flat e).
export const TERRA_FONT = `${MONTSERRAT}, 'Space Grotesk', 'Inter', system-ui, sans-serif`
