/**
 * A UID's Enka.Network Character Showcase for the site's Import from Enka: `GET /api/enka/{uid}`
 * answers `{ uid, ttl, playerInfo: { nickname, level, worldLevel }, avatarInfoList }`, or
 * `{ error }` with Enka's error code (`wrong_uid`, `not_found`, `profile_unavailable`,
 * `maintenance`, `busy`, `upstream_fail`). Each answer is kept in the Cloudflare cache for its `ttl`
 * (Enka's rule: no new request for a UID before then), and visitors are limited per minute. UIDs
 * are not logged.
 */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
interface Env {
  LIMITER?: RateLimit
}
interface Context {
  waitUntil(promise: Promise<unknown>): void
}

const ORIGINS = [
  'https://stellaroptimizer.com',
  'https://www.stellaroptimizer.com',
  'https://gi-beta73.github.io',
]
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const PATH = /^\/(?:api\/)?enka\/(\d+)\/?$/
const UID = /^[1-9]\d{8,9}$/
const USER_AGENT = 'StellarOptimizer/1.0 (+https://stellaroptimizer.com)'
const MIN_TTL = 60
const ERRORS: Record<number, string> = {
  400: 'wrong_uid',
  404: 'not_found',
  424: 'maintenance',
  429: 'busy',
}

const allowed = (origin: string | null) =>
  !!origin && (ORIGINS.includes(origin) || LOCAL.test(origin))
function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': allowed(origin) ? origin! : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
const reply = (
  status: number,
  body: string,
  origin: string | null,
  maxAge = 0
) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...cors(origin),
    },
  })
const fail = (status: number, error: string, origin: string | null) =>
  reply(status, JSON.stringify({ error }), origin)

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const origin = request.headers.get('Origin')
    const uid = PATH.exec(new URL(request.url).pathname)?.[1]
    if (uid === undefined) return new Response('Not found', { status: 404 })
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors(origin) })
    if (request.method !== 'GET') return fail(405, 'method', origin)
    if (!UID.test(uid)) return fail(400, 'wrong_uid', origin)

    const cache = (caches as unknown as { default: Cache }).default
    const key = new Request(`https://stellaroptimizer.com/api/enka/${uid}`)
    const hit = await cache.match(key)
    // (the zone's cache rewrites a stored answer's Cache-Control to hours: its own expiry counts)
    const left = Math.ceil(
      (Number(hit?.headers.get('X-Expires')) - Date.now()) / 1000
    )
    if (hit && left > 0) return reply(200, await hit.text(), origin, left)

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: await sha256(ip) })
      if (!success) return fail(429, 'busy', origin)
    }

    let response: Response
    try {
      response = await fetch(`https://enka.network/api/uid/${uid}/`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      return fail(504, 'upstream_fail', origin)
    }
    if (!response.ok) {
      const code = await response
        .json()
        .then((b) => (b as { code?: string }).code)
        .catch(() => undefined)
      const error =
        code === 'profile_unavailable'
          ? code
          : (ERRORS[response.status] ?? 'upstream_fail')
      return fail(
        response.status in ERRORS ? response.status : 502,
        error,
        origin
      )
    }
    const data = (await response.json()) as {
      ttl?: number
      playerInfo?: { nickname?: string; level?: number; worldLevel?: number }
      avatarInfoList?: unknown[]
    }
    const ttl = Math.max(MIN_TTL, Math.round(data.ttl ?? 0))
    const body = JSON.stringify({
      uid,
      ttl,
      playerInfo: {
        nickname: data.playerInfo?.nickname,
        level: data.playerInfo?.level,
        worldLevel: data.playerInfo?.worldLevel,
      },
      avatarInfoList: data.avatarInfoList ?? [],
    })
    ctx.waitUntil(
      cache.put(
        key,
        new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttl}`,
            'X-Expires': String(Date.now() + ttl * 1000),
          },
        })
      )
    )
    return reply(200, body, origin, ttl)
  },
}
