/**
 * /api/dex-arcade — the shared board for "Deploying Capital".
 *
 * GET  → top scores, how many burritos have been accounted for, total plays.
 * POST → { name, score, burrito } from the game's end screen.
 *
 * Points here buy nothing, so there is nothing worth cheating for and no
 * anti-cheat beyond sanity bounds. Names are a short wallet address or an
 * anonymous "lunatic-1234" handle the browser made up; nothing else about the
 * player is stored. Namespaced by factory like the ledger, so a local run can
 * never write into production's board.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { kv as vercelKv } from '@vercel/kv'
import { DEX_FACTORY } from 'lib/dex'

const HAS_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const KEY = `atrium:dex:arcade:v1:${DEX_FACTORY}`
const TOP_N = 50

export interface ArcadeEntry { name: string; score: number; burrito: boolean; at: number }
export interface ArcadeState { top: ArcadeEntry[]; burritos: number; plays: number }
export interface ArcadeResponse extends ArcadeState { live: boolean }

const mem = (() => {
  const g = globalThis as unknown as { __atriumArcade?: ArcadeState }
  g.__atriumArcade ??= { top: [], burritos: 0, plays: 0 }
  return g.__atriumArcade
})()

async function load(): Promise<ArcadeState> {
  if (!HAS_KV) return mem
  return (await vercelKv.get<ArcadeState>(KEY)) ?? { top: [], burritos: 0, plays: 0 }
}
async function save(s: ArcadeState) {
  if (!HAS_KV) { Object.assign(mem, s); return }
  await vercelKv.set(KEY, s)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ArcadeResponse | { error: string }>) {
  if (!DEX_FACTORY) return res.status(200).json({ live: false, top: [], burritos: 0, plays: 0 })

  if (req.method === 'POST') {
    const b = (req.body ?? {}) as { name?: unknown; score?: unknown; burrito?: unknown }
    const score = Math.floor(Number(b.score))
    const name = String(b.name ?? '').replace(/[^\w.\-…]/g, '').slice(0, 24)
    if (!Number.isFinite(score) || score < 0 || score > 5000 || !name) return res.status(400).json({ error: 'bad entry' })
    const s = await load()
    s.plays += 1
    if (b.burrito === true) s.burritos += 1
    s.top.push({ name, score, burrito: b.burrito === true, at: Date.now() })
    s.top.sort((x, y) => y.score - x.score || x.at - y.at)
    s.top = s.top.slice(0, TOP_N)
    await save(s)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ live: true, ...s })
  }

  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60')
  const s = await load()
  return res.status(200).json({ live: true, ...s })
}
