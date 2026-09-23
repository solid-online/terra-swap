/**
 * TEMPORARY (2026-09-23): CPU time per API route and server-rendered page,
 * one log line per request, to find what uses Active CPU before the move to
 * Vercel's Hobby plan (4 CPU-hours a month). Remove once measured.
 *
 * process.cpuUsage is per process, so requests that overlap on one instance
 * each count some of the others' CPU: good for ranking routes, not exact.
 */

import type { GetServerSideProps, NextApiHandler } from 'next'

function log(route: string, c0: NodeJS.CpuUsage, t0: number) {
  const c = process.cpuUsage(c0)
  console.log(`CPU ${JSON.stringify({ r: route, ms: Math.round((c.user + c.system) / 1000), wall: Date.now() - t0 })}`)
}

export function withCpu(route: string, handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const c0 = process.cpuUsage(), t0 = Date.now()
    try { return await handler(req, res) } finally { log(route, c0, t0) }
  }
}

export function withCpuSsr<P extends Record<string, any>>(route: string, fn: GetServerSideProps<P>): GetServerSideProps<P> {
  return async ctx => {
    const c0 = process.cpuUsage(), t0 = Date.now()
    try { return await fn(ctx) } finally { log(route, c0, t0) }
  }
}
