/**
 * /api/pool-scans: where the pool-scan workflow hands over what it built
 * (scripts/pool-scans.ts, lib/scanPlan).
 *
 * GET: what the workflow needs to build the same scans as this site (its
 * public build settings and the plan), whose workflow this site accepts, and
 * when it last heard from it. Open to anyone.
 *
 * POST: the workflow's results, with a GitHub OIDC token (lib/githubOidc) from
 * the pool-scans workflow on this site's own repository and branch. Each scan
 * is stored for every instance (lib/sharedCache) if `keep` accepts it
 * (lib/poolScans). With `want`, it answers the stored volume cursors for
 * those pools (lib/volumeScan), which the workflow scans on from. With
 * `record`, it writes the price-history slot from the site pools and the
 * volume the workflow scanned, and only then moves the cursors on to where the
 * workflow stopped, answering them: if someone else wrote the slot, they
 * counted its trades.
 *
 * Accepted from the repository in POOL_SCANS_REPO ("owner/name"), else the one
 * Vercel built this deployment from, on POOL_SCANS_BRANCH (default main).
 * POOL_SCANS_REPO=off turns it off. Without it the routes build their scans
 * themselves, as before.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { kv as vercelKv } from '@vercel/kv'
import { verifyGithubToken, type GithubClaims } from 'lib/githubOidc'
import { SCANS } from 'lib/poolScans'
import { claimSlot, recordPrices, type RecordResult } from 'lib/priceHistory'
import { POOL_SCANS_AUDIENCE, SCAN_NAMES, SCAN_PLAN, type ScanName } from 'lib/scanPlan'
import { stale, store } from 'lib/sharedCache'
import type { SitePools } from 'lib/sitePools'
import { advanceCursors } from 'lib/volumeScan'

// The scans together run to a few hundred kB; Vercel takes up to 4.5 MB.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } }, maxDuration: 30 }

const WORKFLOW_FILE = '.github/workflows/pool-scans.yml'
/** A hash: `at` and `run` of the last handover, and each scan's build time. */
const BEAT_KEY = 'atrium:pool-scans:beat:v1'
const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN

/** The build settings the scans read. All NEXT_PUBLIC_, so they are in every visitor's page already. */
const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_DEX_FACTORY: process.env.NEXT_PUBLIC_DEX_FACTORY,
  NEXT_PUBLIC_DEX_FACTORY_V2: process.env.NEXT_PUBLIC_DEX_FACTORY_V2,
  NEXT_PUBLIC_DEX_MODE: process.env.NEXT_PUBLIC_DEX_MODE,
  NEXT_PUBLIC_TERRA_SWAP_ROUTER: process.env.NEXT_PUBLIC_TERRA_SWAP_ROUTER,
  NEXT_PUBLIC_LCD: process.env.NEXT_PUBLIC_LCD,
  NEXT_PUBLIC_RPC: process.env.NEXT_PUBLIC_RPC,
}

function acceptedRepo(): string | null {
  const set = process.env.POOL_SCANS_REPO?.trim()
  if (set) return set.toLowerCase() === 'off' ? null : set
  const owner = process.env.VERCEL_GIT_REPO_OWNER, slug = process.env.VERCEL_GIT_REPO_SLUG
  return owner && slug ? `${owner}/${slug}` : null
}
const acceptedRef = () => `refs/heads/${process.env.POOL_SCANS_BRANCH?.trim() || 'main'}`

/** Null when the claims are the pool-scans workflow on the accepted repository and branch, else why not. */
function refuse(c: GithubClaims): string | null {
  const repo = acceptedRepo()
  if (!repo) return 'this site takes no pool scans'
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  if (!same(String(c.repository ?? ''), repo)) return 'not this site\'s repository'
  const id = process.env.VERCEL_GIT_REPO_ID
  if (id && !process.env.POOL_SCANS_REPO && String(c.repository_id) !== id) return 'not this site\'s repository'
  if (c.ref !== acceptedRef()) return 'not the accepted branch'
  if (!same(String(c.workflow_ref ?? ''), `${repo}/${WORKFLOW_FILE}@${acceptedRef()}`)) return 'not the pool-scans workflow'
  return null
}

type Beat = { at?: number; run?: string } & Partial<Record<ScanName, number>>

interface Handover {
  /** scans by name (lib/scanPlan) */
  entries?: Partial<Record<ScanName, { at: number }>>
  /** write this ten-minute slot of the price history, with the volume scanned from the cursors `want` answered up to `cursors` */
  record?: { vol?: Record<string, number>; cursors?: Record<string, number> }
  /** pool addresses whose volume cursors to answer */
  want?: string[]
}

export interface PoolScansStatus { accepting: string | null; branch: string; audience: string; env: Record<string, string>; plan: typeof SCAN_PLAN; beat: Beat | null }
export interface HandoverAnswer {
  stored: ScanName[]
  refused: Partial<Record<string, string>>
  record?: RecordResult | { recorded: false; reason: string }
  cursors?: Record<string, number>
}

const isAddr = (a: unknown): a is string => typeof a === 'string' && /^terra1[0-9a-z]{38,58}$/.test(a)
const numbers = (m: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) if (isAddr(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
  return out
}

async function handler(req: NextApiRequest, res: NextApiResponse<PoolScansStatus | HandoverAnswer | { error: string }>) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') {
    const env = Object.fromEntries(Object.entries(PUBLIC_ENV).filter((e): e is [string, string] => !!e[1]))
    const beat = HAS_KV ? await vercelKv.hgetall<Beat>(BEAT_KEY).catch(() => null) : null
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({ accepting: acceptedRepo(), branch: acceptedRef(), audience: POOL_SCANS_AUDIENCE, env, plan: SCAN_PLAN, beat })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'GET or POST' })
  }

  const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1]
  const claims = token ? await verifyGithubToken(token, POOL_SCANS_AUDIENCE) : null
  if (!claims) return res.status(401).json({ error: 'a GitHub Actions OIDC token for this audience is needed' })
  const why = refuse(claims)
  if (why) return res.status(403).json({ error: why })
  if (!HAS_KV) return res.status(503).json({ error: 'this host has no store' })

  const body = (req.body ?? {}) as Handover
  const now = Date.now()
  const stored: ScanName[] = []
  const refused: Partial<Record<string, string>> = {}
  for (const [name, value] of Object.entries(body.entries ?? {})) {
    if (!SCAN_NAMES.includes(name as ScanName)) { refused[name] = 'no such scan'; continue }
    const n = name as ScanName
    const plan = SCAN_PLAN[n]
    if (!value || typeof value !== 'object' || typeof value.at !== 'number' || now - value.at > plan.freshMs || value.at > now + 60_000) { refused[n] = 'not fresh'; continue }
    if (!(SCANS[n].keep as (v: unknown) => boolean)(value)) { refused[n] = 'not whole'; continue }
    await store(plan.key, plan, value)
    stored.push(n)
  }

  const answer: HandoverAnswer = { stored, refused }
  if (Array.isArray(body.want)) answer.cursors = await advanceCursors(body.want.filter(isAddr).slice(0, 100))
  if (body.record) {
    const site = (stored.includes('site') ? body.entries?.site : await stale(SCAN_PLAN.site.key)) as SitePools | null | undefined
    const busy = !site || site.pools.length === 0 || now - site.at > SCAN_PLAN.site.freshMs ? 'no fresh pools to write down' : await claimSlot(now)
    if (busy || !site) answer.record = { recorded: false, reason: busy ?? 'no fresh pools to write down' }
    else {
      answer.record = await recordPrices(site.px, site.pools, numbers(body.record.vol), now)
      const cursors = numbers(body.record.cursors)
      if (answer.record.recorded) answer.cursors = await advanceCursors(Object.keys(cursors), cursors)
    }
  }

  if (stored.length > 0) {
    const beat: Beat = { at: now, run: String(claims.run_id ?? '') }
    for (const n of stored) beat[n] = (body.entries?.[n] as { at: number }).at
    await vercelKv.hset(BEAT_KEY, beat).catch(() => {})
  }
  return res.status(200).json(answer)
}

export default withCpu('pool-scans', handler)
