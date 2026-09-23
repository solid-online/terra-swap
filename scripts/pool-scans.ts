/**
 * The pool scans, built on GitHub's machines instead of Vercel's (lib/scanPlan).
 * Run by .github/workflows/pool-scans.yml for close to the six hours a job may
 * last; the workflow then starts the next run.
 *
 * It first asks the site for its public build settings (GET /api/pool-scans),
 * so it builds exactly what the site would. Then every few seconds it asks each
 * scan for its value (lib/poolScans): with no KV here, a scan builds again once
 * its `everyMs` has passed. New values go to the site together, with a GitHub
 * OIDC token that the site checks against its own repository and this
 * workflow. As each ten-minute slot begins it also writes that slot of the
 * price history, with the volume traded since the one before.
 *
 * It prints counts and times only: a public repository's run logs are public.
 *
 *   npx tsx scripts/pool-scans.ts            (in the workflow)
 *   DRY_RUN=1 WATCH_MINUTES=3 npx tsx scripts/pool-scans.ts   (builds and prints, sends nothing)
 */

import type { HandoverAnswer, PoolScansStatus } from 'pages/api/pool-scans'

const SITE = (process.env.POOL_SCANS_SITE || 'https://swap.openfields.app').replace(/\/+$/, '')
const WATCH_MS = Number(process.env.WATCH_MINUTES || 340) * 60_000
const DRY_RUN = process.env.DRY_RUN === '1'
const TICK_MS = 5_000
/** A scan is asked again at most this often, so one that keeps failing does not hammer the chain. */
const RETRY_MS = 30_000
/**
 * Pending scans ride along with the next home scan (once a minute), or go on
 * their own after this long. Hobby counts every request to the site.
 */
const BATCH_MS = 75_000
const SLOT_MS = 600_000
/** Into a slot before writing it, so the new slot's first blocks are in. */
const SLOT_SETTLE_MS = 5_000

// This process builds; it must not read or write the site's store itself.
delete process.env.KV_REST_API_URL
delete process.env.KV_REST_API_TOKEN

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

class Refused extends Error {}

let token: { value: string; at: number } | null = null
async function oidcToken(audience: string): Promise<string> {
  if (token && Date.now() - token.at < 120_000) return token.value
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !bearer) throw new Refused('no OIDC token here: the workflow needs `permissions: id-token: write`')
  const r = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `bearer ${bearer}` }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`GitHub gave no OIDC token (${r.status})`)
  token = { value: String((await r.json())?.value ?? ''), at: Date.now() }
  return token.value
}

async function post(audience: string, body: object): Promise<HandoverAnswer> {
  const payload = JSON.stringify(body)
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${SITE}/api/pool-scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await oidcToken(audience)}` },
      body: payload,
      signal: AbortSignal.timeout(30_000),
    })
    if (r.ok) return (await r.json()) as HandoverAnswer
    const why = String((await r.json().catch(() => null))?.error ?? r.status)
    // An expired token is fetched again once; a refusal is the site's settings and ends the run.
    if (r.status === 401 && attempt === 0) { token = null; continue }
    if (r.status === 401 || r.status === 403) throw new Refused(`the site refused the handover: ${why}`)
    throw new Error(`the site did not take the handover: ${why}`)
  }
}

async function siteStatus(): Promise<PoolScansStatus> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${SITE}/api/pool-scans`, { signal: AbortSignal.timeout(20_000) })
      if (r.ok) return (await r.json()) as PoolScansStatus
      throw new Error(String(r.status))
    } catch (e) {
      if (attempt >= (DRY_RUN ? 1 : 5)) throw e
      await sleep(15_000 * attempt)
    }
  }
}

async function main() {
  let status: PoolScansStatus | null = null
  try {
    status = await siteStatus()
  } catch (e) {
    if (!DRY_RUN) throw e
    log('the site gave no settings; using this shell\'s')
  }
  const repo = process.env.GITHUB_REPOSITORY
  if (!DRY_RUN && (!status?.accepting || (repo && status.accepting.toLowerCase() !== repo.toLowerCase()))) {
    throw new Refused(`${SITE} takes pool scans from ${status?.accepting ?? 'nobody'}, not from ${repo ?? 'here'}`)
  }
  for (const [k, v] of Object.entries(status?.env ?? {})) if (k.startsWith('NEXT_PUBLIC_')) process.env[k] = v

  // The site's modules read those settings when first loaded, so they load only now.
  const { SCANS } = await import('lib/poolScans')
  const { SCAN_NAMES, SCAN_PLAN, POOL_SCANS_AUDIENCE } = await import('lib/scanPlan')
  const { keepSitePools, sitePools } = await import('lib/sitePools')
  const { memCursors, scanVolumes, setCursors, volumePools } = await import('lib/volumeScan')
  type Name = (typeof SCAN_NAMES)[number]
  const audience = status?.audience || POOL_SCANS_AUDIENCE

  const asked: Partial<Record<Name, number>> = {}
  const sent: Partial<Record<Name, number>> = {}
  const building = new Set<Name>()
  const pending: Partial<Record<Name, { at: number }>> = {}
  let pendingSince = 0
  const count = { builds: 0, failed: 0, posts: 0, postFailed: 0, stored: 0, slots: 0 }
  const took: Partial<Record<Name, number>> = {}

  function ask(n: Name) {
    if (building.has(n)) return
    building.add(n)
    asked[n] = Date.now()
    const t0 = Date.now()
    SCANS[n].run()
      .then(v => {
        if (v.at === sent[n] || v.at === pending[n]?.at) return
        count.builds++
        took[n] = Date.now() - t0
        if (!(SCANS[n].keep as (v: unknown) => boolean)(v)) { count.failed++; return }
        if (DRY_RUN) { sent[n] = v.at; log(`${n}: built in ${took[n]} ms, ${JSON.stringify(v).length} bytes`); return }
        if (!pendingSince) pendingSince = Date.now()
        pending[n] = v
      })
      .catch(() => { count.failed++ })
      .finally(() => building.delete(n))
  }

  let posting = false
  async function flush() {
    const names = Object.keys(pending) as Name[]
    if (posting || names.length === 0) return
    if (!pending.home && Date.now() - pendingSince < BATCH_MS) return
    posting = true
    const entries = { ...pending }
    for (const n of names) delete pending[n]
    pendingSince = 0
    try {
      const a = await post(audience, { entries })
      count.posts++
      for (const n of a.stored) { sent[n] = entries[n]!.at; count.stored++ }
      const refused = Object.entries(a.refused)
      if (refused.length > 0) log('refused:', refused.map(([n, why]) => `${n} (${why})`).join(', '))
    } catch (e) {
      if (e instanceof Refused) throw e
      count.postFailed++
      // Back in line unless a newer one has arrived meanwhile.
      for (const n of names) if (!pending[n]) { pending[n] = entries[n]; pendingSince ||= Date.now() }
    } finally {
      posting = false
    }
  }

  let slotDone = -1
  let slotTried = 0
  /** Pools whose volume cursors here are the site's: after a slot this run wrote, the site answers the cursors it kept. */
  let inStep = new Set<string>()
  async function writeSlot(slot: number) {
    slotTried = Date.now()
    const site = await sitePools()
    if (!keepSitePools(site) || Date.now() - site.at > 2 * SCAN_PLAN.site.everyMs) return
    const addrs = volumePools(site.pools).map(p => p.contract_addr)
    if (DRY_RUN) { log(`slot ${slot}: would scan volume on ${addrs.length} pools`); slotDone = slot; return }
    if (addrs.some(a => !inStep.has(a))) {
      const want = await post(audience, { want: addrs })
      setCursors(addrs, want.cursors ?? {})
    }
    const vol = await scanVolumes(site.pools).catch(() => ({} as Record<string, number>))
    const a = await post(audience, { record: { vol, cursors: memCursors(addrs) } })
    const r = a.record
    if (r && (r.recorded || 'reason' in r)) {
      slotDone = slot
      count.slots++
      log(r.recorded ? `slot written: ${r.tokens} tokens, ${r.pools} pool hours, volume on ${Object.keys(vol).length} pools` : `slot not written here: ${'reason' in r ? r.reason : ''}`)
    }
    // After a slot written here the site answers the cursors it kept. A slot written elsewhere had its trades
    // counted there, so the next slot starts from the site's cursors again.
    if (r?.recorded && a.cursors) { setCursors(addrs, a.cursors); inStep = new Set(addrs) } else inStep = new Set()
  }

  log(`scanning for ${SITE} for ${WATCH_MS / 60_000} min${DRY_RUN ? ', dry run' : ''}`)
  const end = Date.now() + WATCH_MS
  let lastReport = Date.now()
  while (Date.now() < end) {
    const now = Date.now()
    for (const n of SCAN_NAMES) if (now - (asked[n] ?? 0) >= Math.min(SCAN_PLAN[n].everyMs, RETRY_MS)) ask(n)
    await flush()
    const slot = Math.floor(now / SLOT_MS)
    if (slot !== slotDone && now - slot * SLOT_MS >= SLOT_SETTLE_MS && now - slotTried >= RETRY_MS) {
      await writeSlot(slot).catch(e => { if (e instanceof Refused) throw e })
    }
    if (now - lastReport >= SLOT_MS) {
      lastReport = now
      const times = (Object.entries(took) as [Name, number][]).map(([n, ms]) => `${n} ${(ms / 1000).toFixed(1)}s`).join(', ')
      log(`builds ${count.builds} (${count.failed} not whole), handovers ${count.posts} (${count.postFailed} failed), scans stored ${count.stored}, slots ${count.slots}; last build ${times}`)
    }
    await sleep(TICK_MS - (Date.now() % TICK_MS))
  }
  log('watch over, handing over to the next run')
}

main().then(() => process.exit(0), e => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
