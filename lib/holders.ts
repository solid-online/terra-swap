/**
 * Holders of one cw721 collection get 1.5× points on the board (a purely
 * cosmetic boost; points buy nothing). Which collection is up to whoever
 * hosts this: NEXT_PUBLIC_BOOST_CW721, empty to disable. The default is the
 * CAPA Crystals collection the original deployment used.
 */

const LCD = process.env.NEXT_PUBLIC_LCD || 'https://terra-lcd.publicnode.com'
export const BOOST_CW721 =
  process.env.NEXT_PUBLIC_BOOST_CW721 ?? 'terra1htnzmetd2xlkgrqqdf3whu8wzwhtjlx7ahrk6qsxxneaktl63r9sx5v2uk'

/** Kept under its historical name so the swap and the ledger read the same. */
export async function isCrystalHolder(addr: string): Promise<boolean> {
  if (!addr || !BOOST_CW721) return false
  try {
    const msg = JSON.stringify({ tokens: { owner: addr, limit: 1 } })
    const q = typeof window !== 'undefined' ? btoa(msg) : Buffer.from(msg).toString('base64')
    const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${BOOST_CW721}/smart/${q}`)
    if (!r.ok) return false
    const j = (await r.json()) as { data?: { tokens?: string[] } }
    return Array.isArray(j.data?.tokens) && j.data!.tokens!.length > 0
  } catch {
    return false
  }
}
