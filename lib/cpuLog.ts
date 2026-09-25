/**
 * TEMPORARY (2026-09-25): CPU time per API route and server-rendered page, one
 * log line per request, to see what still uses Active CPU before the move to
 * Vercel's Hobby plan (4 CPU-hours a month). Remove once measured.
 *
 * The first request on an instance also logs `init`: the CPU the process had
 * used before that request began (runtime start and loading the bundle), which
 * is what a cold start costs.
 *
 * process.cpuUsage is per process, so requests that overlap on one instance
 * each count some of the others' CPU: good for ranking routes, not exact.
 */

import type { GetServerSideProps, NextApiHandler } from 'next'

let first = true

function log(route: string, c0: NodeJS.CpuUsage, t0: number) {
  const c = process.cpuUsage(c0)
  const init = first ? { init: Math.round((c0.user + c0.system) / 1000) } : {}
  first = false
  console.log(`CPU ${JSON.stringify({ r: route, ms: Math.round((c.user + c.system) / 1000), wall: Date.now() - t0, ...init })}`)
}

export function withCpu(route: string, handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const c0 = process.cpuUsage(), t0 = Date.now()
    try { return await handler(req, res) } finally { log(route, c0, t0) }
  }
}

/** Counts until the response has been sent, so the page's own render is included. */
export function withCpuSsr(route: string, fn: GetServerSideProps): GetServerSideProps {
  return async ctx => {
    const c0 = process.cpuUsage(), t0 = Date.now()
    ctx.res.once('finish', () => log(route, c0, t0))
    return fn(ctx)
  }
}
