/**
 * GET /api/token-check?token=LUNA — who controls a listed token, read from the
 * chain (lib/tokenCheck). Kept six hours per token: reading a cw20's holders
 * takes a page of contract state per thousand accounts.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { withCpu } from 'lib/cpuLog'
import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY } from 'lib/dex'
import { checkToken, findToken, type TokenCheck } from 'lib/tokenCheck'
import { sitePools } from 'lib/sitePools'

export const config = { maxDuration: 60 }

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const FRESH_MS = 6 * 3600_000
const key = (k: string) => `atrium:dex:tokencheck:v1:${DEX_FACTORY}:${k}`
const mem = new Map<string, TokenCheck>()
const inflight = new Map<string, Promise<TokenCheck>>()

async function handler(req: NextApiRequest, res: NextApiResponse<TokenCheck | { error: string }>) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const token = findToken(req.query.token)
  if (!token) return res.status(400).json({ error: 'token must be a listed ticker, for example LUNA' })
  try {
    const kept = mem.get(token.key) ?? (HAS_KV ? await vercelKv.get<TokenCheck>(key(token.key)) : null)
    if (kept && Date.now() - kept.at < FRESH_MS) {
      mem.set(token.key, kept)
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=21600')
      return res.status(200).json(kept)
    }
    let job = inflight.get(token.key)
    if (!job) {
      job = sitePools().then(({ pools }) => checkToken(token, pools)).finally(() => { inflight.delete(token.key) })
      inflight.set(token.key, job)
    }
    const body = await job
    mem.set(token.key, body)
    if (HAS_KV) await vercelKv.set(key(token.key), body, { ex: 24 * 3600 })
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=21600')
    return res.status(200).json(body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({ error: 'the chain did not answer, try again in a moment' })
  }
}

export default withCpu('token-check', handler)
