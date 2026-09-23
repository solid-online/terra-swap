/**
 * Checks that a request comes from a GitHub Actions workflow, and from which
 * one, with the OpenID Connect token GitHub gives every run that asks for it.
 * GitHub signs the token; its claims name the repository, the branch and the
 * workflow file. So the pool-scan workflow can hand its results to this site
 * without a secret anyone has to create, keep or rotate.
 *
 * https://docs.github.com/en/actions/concepts/security/openid-connect
 */

import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'crypto'

export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`
/** Tokens are a few minutes old at most; this much clock difference is forgiven. */
const SKEW_S = 60

export interface GithubClaims {
  iss: string
  aud: string | string[]
  exp: number
  iat: number
  nbf?: number
  /** "owner/name" */
  repository: string
  repository_id: string
  /** "refs/heads/main" */
  ref: string
  /** "owner/name/.github/workflows/file.yml@refs/heads/main" */
  workflow_ref: string
  event_name: string
  run_id: string
}

let jwks: { at: number; keys: Map<string, KeyObject> } | null = null
let jwksLoading: Promise<void> | null = null

async function loadKeys(): Promise<void> {
  const r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`GitHub's keys: ${r.status}`)
  const keys = new Map<string, KeyObject>()
  for (const k of ((await r.json())?.keys ?? []) as { kid?: string; kty?: string }[]) {
    if (!k.kid || k.kty !== 'RSA') continue
    try { keys.set(k.kid, createPublicKey({ key: k as JsonWebKey, format: 'jwk' })) } catch { /* a key we cannot read signs nothing we accept */ }
  }
  jwks = { at: Date.now(), keys }
}

/** GitHub's signing key by id: kept an hour, and read again (at most once a minute) for an id not seen yet, since GitHub rotates them. */
async function keyFor(kid: string): Promise<KeyObject | null> {
  const age = jwks ? Date.now() - jwks.at : Infinity
  if (age > 3600_000 || (!jwks?.keys.has(kid) && age > 60_000)) {
    jwksLoading ??= loadKeys().finally(() => { jwksLoading = null })
    await jwksLoading.catch(() => {})
  }
  return jwks?.keys.get(kid) ?? null
}

const part = (s: string) => Buffer.from(s, 'base64url')

/** The token's claims if GitHub signed it for this audience and it has not expired, else null. */
export async function verifyGithubToken(token: string, audience: string, now = Date.now()): Promise<GithubClaims | null> {
  const [h, p, sig, extra] = token.split('.')
  if (!h || !p || !sig || extra !== undefined) return null
  let header: { alg?: string; kid?: string }, claims: GithubClaims
  try {
    header = JSON.parse(part(h).toString('utf8'))
    claims = JSON.parse(part(p).toString('utf8'))
  } catch { return null }
  if (header.alg !== 'RS256' || !header.kid) return null
  const key = await keyFor(header.kid)
  if (!key) return null
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, part(sig))) return null
  const t = now / 1000
  if (claims.iss !== GITHUB_ISSUER) return null
  if (!(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience)) return null
  if (!(typeof claims.exp === 'number' && claims.exp > t - SKEW_S)) return null
  if (typeof claims.nbf === 'number' && claims.nbf > t + SKEW_S) return null
  return claims
}

/** For tests: use these keys instead of GitHub's. */
export function useKeysForTest(keys: Map<string, KeyObject>): void {
  jwks = { at: Date.now(), keys }
}
