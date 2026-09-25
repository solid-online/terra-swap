/**
 * A request body read by hand, plain JSON or gzipped (Content-Encoding: gzip),
 * for API routes with Next's body parser turned off. The pool-scan handover
 * (pages/api/pool-scans) is sent gzipped: a sixth of the size, and Vercel's
 * Hobby plan counts what reaches a function.
 */

import type { IncomingMessage } from 'http'
import { gunzipSync } from 'zlib'

export class BadBody extends Error {}

export async function readJsonBody(req: IncomingMessage, maxBytes = 4_000_000, maxJson = 20_000_000): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array)
    size += b.length
    if (size > maxBytes) throw new BadBody('too large')
    chunks.push(b)
  }
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return null
  const gz = /\bgzip\b/i.test(String(req.headers['content-encoding'] ?? ''))
  let text: string
  try {
    text = (gz ? gunzipSync(raw, { maxOutputLength: maxJson }) : raw).toString('utf8')
  } catch {
    throw new BadBody('not gzip, or too large once unpacked')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new BadBody('not JSON')
  }
}
