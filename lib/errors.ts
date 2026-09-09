/**
 * Transaction error humanizer.
 *
 * Cosmos-SDK + CosmWasm errors come back as raw RPC blobs full of
 * file paths, gas info, and chain internals. Users don't need any of
 * that — they need to know WHAT went wrong and WHAT to do.
 *
 * This helper covers the most common patterns we see in production
 * and falls back to a cleaned-up version of the raw message.
 */

/** Convert micro-units string back to a human display amount. */
function microToDisplay(microStr: string, denom: string): string {
  const n = parseInt(microStr, 10)
  if (!isFinite(n)) return microStr
  const v = n / 1_000_000
  const label = labelForDenom(denom)
  if (v >= 1000) return `${Math.round(v).toLocaleString('en-US')} ${label}`
  if (v >= 1) return `${v.toFixed(2)} ${label}`
  return `${v.toFixed(4)} ${label}`
}

function labelForDenom(d: string): string {
  if (d === 'uluna') return 'LUNA'
  if (d.startsWith('ibc/2C962DAB')) return 'USDC'
  return d
}

const SOLID_CW20 =
  'terra10aa3zdkrc7jwuf8ekl3zq7e7m42vmzqehcmu74e4egc7xkm5kr2s0muyst'
const CAPA_CW20 =
  'terra1t4p3u8khpd7f8qzurwyafxt648dya6mp6vur3vaapswt6m24gkuqrfdhar'

/**
 * Turn an unknown error into a short, user-readable string.
 *
 * Supported patterns (extend as new chain errors surface):
 *  - insufficient funds (native / cw20)
 *  - listing/offer not found
 *  - listing/offer expired
 *  - paused
 *  - Crystal-only allowlist rejection
 *  - cap exceeded
 *  - wallet not connected
 *  - generic-tx fallback
 */
export function humanizeTxError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err || '')).trim()
  if (!raw) return 'Transaction failed.'

  // ─── Wallet not connected / no signer ─────────────────────────────
  if (/Invalid address|wallet/i.test(raw) && /not connect/i.test(raw)) {
    return 'Wallet is not connected. Connect a wallet and try again.'
  }

  // ─── Signer account not on chain ──────────────────────────────────
  // cosmjs can't fetch account number/sequence for an address that has never
  // transacted on Terra2. The account only exists once it has received funds.
  if (/retrieve account from signer|does not exist on chain|account.*not found/i.test(raw)) {
    return 'This wallet has no account on Terra yet. Send it a little LUNA first (you need LUNA for gas anyway), then try again.'
  }

  // ─── Insufficient native funds ────────────────────────────────────
  // Cosmos-SDK: "spendable balance 1734264uluna is smaller than 4000000uluna"
  const insufficient = raw.match(/spendable balance (\d+)(\w[\w/]+?) is smaller than (\d+)(\w[\w/]+?)\b/i)
  if (insufficient) {
    const [, haveMicro, haveDenom, needMicro, needDenom] = insufficient
    const have = microToDisplay(haveMicro, haveDenom)
    const need = microToDisplay(needMicro, needDenom)
    return `Not enough ${labelForDenom(needDenom)}. You need ${need} but only have ${have}.`
  }

  // ─── Insufficient CW20 balance (SOLID / CAPA) ─────────────────────
  // CW20-base: "Cannot Sub with 1234 and 5678"
  const cw20Sub = raw.match(/Cannot Sub with (\d+) and (\d+)/i)
  if (cw20Sub) {
    const [, haveStr, needStr] = cw20Sub
    const have = parseInt(haveStr, 10) / 1e6
    const need = parseInt(needStr, 10) / 1e6
    // We can't tell which token from this error string alone. Caller can wrap.
    return `Not enough token balance. You need ${need.toFixed(2)} but only have ${have.toFixed(2)}.`
  }

  // ─── Marketplace contract errors (from atrium error.rs) ───────────
  if (/Marketplace is paused/.test(raw)) {
    return 'The marketplace is paused. Try again after the admin re-opens it.'
  }
  if (/Listing has expired/.test(raw)) {
    return 'This listing has expired. Ask the seller to relist.'
  }
  if (/Offer has expired/.test(raw)) {
    return 'This offer has expired.'
  }
  if (/Offer has not expired/.test(raw)) {
    return "Offer hasn't expired yet."
  }
  if (/NFT already listed/.test(raw)) {
    return 'This NFT is already listed. Cancel the existing listing first.'
  }
  if (/Cannot buy your own listing/.test(raw)) {
    return "You can't buy your own listing."
  }
  if (/Listing not found/.test(raw)) {
    return 'Listing not found — it may have been bought or cancelled.'
  }
  if (/Offer not found/.test(raw)) {
    return 'Offer not found — it may have been cancelled or settled.'
  }
  if (/Collection not allowlisted/.test(raw)) {
    return 'This collection is not on the Atrium allowlist. Only curated collections can be listed.'
  }

  // ─── Reprice pre-flight (thrown by useAtriumReprice, not the chain) ──
  if (/listing_locked_cannot_reprice/.test(raw)) {
    return 'This listing is already sold and awaiting release, so the price can no longer be changed.'
  }
  if (/listing_already_expired/.test(raw)) {
    return 'This listing has expired. Cancel it and list again to set a new price and expiry.'
  }
  if (/current_block_unknown/.test(raw)) {
    return "Couldn't read the current chain height, which this listing's expiry depends on. Refresh and try again."
  }
  if (/wrong_marketplace_for_collection/.test(raw)) {
    return 'This collection trades on a different marketplace contract. Use its own listing page.'
  }
  if (/active-listing cap/.test(raw)) {
    return 'This collection has reached its launch-cap. Wait for sales/cancels or for the admin to raise the cap.'
  }
  if (/active-offer cap/.test(raw)) {
    return 'This NFT has too many open offers right now. Wait for one to settle or expire.'
  }
  if (/Insufficient payment/.test(raw)) {
    return 'Payment amount must match the listing price exactly.'
  }
  if (/Wrong payment type/.test(raw)) {
    return "Your offer's denomination doesn't match the listing's. Re-offer in the right token."
  }
  if (/Send exactly one coin/.test(raw)) {
    return 'Send exactly one coin denomination.'
  }
  if (/Caller is not the listing's seller/.test(raw)) {
    return 'Only the seller can do that.'
  }
  if (/Caller is not the offer's buyer/.test(raw)) {
    return 'Only the original buyer can cancel this offer.'
  }
  if (/Caller is not the contract admin/.test(raw)) {
    return 'Admin-only action.'
  }
  if (/Price must be greater than zero/.test(raw)) {
    return 'Price must be greater than zero.'
  }

  // ─── User rejected in wallet ──────────────────────────────────────
  if (/user denied|rejected by user|request rejected/i.test(raw)) {
    return 'Transaction cancelled in your wallet.'
  }

  // ─── Out of gas ───────────────────────────────────────────────────
  if (/out of gas/i.test(raw)) {
    return 'Transaction ran out of gas. Try again — gas estimate may have been low.'
  }

  // ─── Fallback: trim cosmos-sdk file-path noise ────────────────────
  // Strip "[cosmos/cosmos-sdk@v.../path/file.go:NNN]" segments.
  let cleaned = raw.replace(/\[[^\]]*\.go:\d+\]/g, '').trim()
  // Strip ": with gas used: 'NNN'"
  cleaned = cleaned.replace(/: with gas used: '\d+'/g, '').trim()
  // Strip leading "rpc error: code = X desc = "
  cleaned = cleaned.replace(/^rpc error:\s*code = \w+\s*desc =\s*/i, '').trim()
  // Strip "failed to execute message; message index: X:"
  cleaned = cleaned.replace(/failed to execute message; message index: \d+:\s*/i, '').trim()
  // Strip trailing ": unknown request"
  cleaned = cleaned.replace(/:\s*unknown request$/i, '').trim()
  // Cap length so a wall of text doesn't break the modal layout
  if (cleaned.length > 240) cleaned = cleaned.slice(0, 235) + '…'
  return cleaned || 'Transaction failed.'
}

export const ATRIUM_ERROR_TOKENS = { SOLID_CW20, CAPA_CW20 } as const
