/**
 * Every chain read goes through here, so one public endpoint having a bad
 * minute does not take the site down with it.
 *
 * During the 2026-09-13 audit the default endpoint answered 503s, refused
 * delegation lists, kept no history and dropped out for minutes at a time.
 * Requests now try a short list of public endpoints in turn and stay with the
 * last one that answered. A contract that rejects a query has answered, so
 * that comes back as it is instead of being retried elsewhere.
 *
 * Browsers can only use endpoints that send CORS headers; the server can use
 * any. NEXT_PUBLIC_LCD and NEXT_PUBLIC_RPC (comma separated) go in front of
 * the defaults, so a self-hosted copy can point at its own node first.
 */

const fromEnv = (v?: string) => (v ?? '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)
const unique = (xs: string[]) => Array.from(new Set(xs))

/** Checked 2026-09-14: all three answer contract queries with CORS; only the first also answers tx searches, slowly. */
const BROWSER_LCD = ['https://terra-lcd.publicnode.com', 'https://rest.cosmos.directory/terra2', 'https://terra-rest.publicnode.com']
/** Server side needs no CORS. Polkachu answers tx searches in about a second and keeps history. */
const SERVER_LCD = ['https://terra-lcd.publicnode.com', 'https://terra-api.polkachu.com', 'https://rest.cosmos.directory/terra2']
const SERVER_TXS = ['https://terra-api.polkachu.com', 'https://terra-lcd.publicnode.com']

/** For signing and broadcasting from the wallet. All three send CORS headers. */
export const RPC_ENDPOINTS = unique([
  ...fromEnv(process.env.NEXT_PUBLIC_RPC),
  'https://terra-rpc.publicnode.com:443', 'https://terra-rpc.polkachu.com', 'https://rpc.cosmos.directory/terra2',
])
/** REST endpoints handed to the wallet kit alongside RPC_ENDPOINTS. */
export const REST_ENDPOINTS = unique([...fromEnv(process.env.NEXT_PUBLIC_LCD), ...BROWSER_LCD])

/** 'txs' is a tx search, which only some endpoints answer in reasonable time. */
export type LcdKind = 'query' | 'txs'

export function lcdEndpoints(kind: LcdKind = 'query'): string[] {
  const base = typeof window !== 'undefined' ? BROWSER_LCD : kind === 'txs' ? SERVER_TXS : SERVER_LCD
  return unique([...fromEnv(process.env.NEXT_PUBLIC_LCD), ...base])
}

const RETRY = new Set([408, 425, 429, 500, 502, 503, 504])
const preferred = new Map<LcdKind, number>()

/** A CosmWasm query the contract refused comes back as a 500 carrying the contract's own error. That is an answer. */
async function contractAnswered(r: Response): Promise<boolean> {
  if (r.status !== 500) return false
  try { return /wasm|contract|unknown variant|parsing|not found|codespace/i.test(await r.clone().text()) } catch { return false }
}

export interface LcdInit extends Omit<RequestInit, 'signal'> {
  kind?: LcdKind
  /** per attempt, not in total */
  timeoutMs?: number
}

/** `fetch` for an LCD path ("/cosmos/…"), across endpoints. Throws only when none of them answered. */
export async function lcdFetch(path: string, init: LcdInit = {}): Promise<Response> {
  const { kind = 'query', timeoutMs = 8000, ...rest } = init
  const list = lcdEndpoints(kind)
  const first = Math.min(preferred.get(kind) ?? 0, list.length - 1)
  let failure: unknown = null
  for (let i = 0; i < list.length; i++) {
    const at = (first + i) % list.length
    try {
      const r = await fetch(list[at] + path, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
      if (!RETRY.has(r.status) || (await contractAnswered(r))) {
        preferred.set(kind, at)
        return r
      }
      failure = new Error(`${list[at]} answered ${r.status}`)
    } catch (e) {
      failure = e
    }
  }
  throw failure instanceof Error ? failure : new Error('No chain endpoint answered')
}
