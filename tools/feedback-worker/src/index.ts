/**
 * Feedback from the site's Feedback button, kept where only the owner can read it: a POST of
 * `{ kind, message, contact?, page?, version?, build?, site?, images? }` from the site's own origins
 * is checked, limited per visitor and stored in Workers KV under `fb:<time>:<id>`, each screenshot
 * (a data URL, made small on the page) under `img:<time>:<id>:<n>`. There is no way to read it back
 * through the Worker.
 */
/** The Workers KV binding's calls used here (no @cloudflare/workers-types needed) */
interface KV {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>
}
interface Env {
  FEEDBACK: KV
}

const ORIGINS = [
  'https://stellaroptimizer.com',
  'https://www.stellaroptimizer.com',
  'https://gi-beta73.github.io',
]
/** Local development pages (any port) */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const KINDS = ['bug', 'idea', 'other'] as const
/** Screenshots per post, and each one's size (a data URL's characters: about 2.2 MB of image) */
const MAX_IMAGES = 4
const MAX_IMAGE = 3_000_000
const MAX_BODY = 16_000 + MAX_IMAGES * MAX_IMAGE
const IMAGE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/
/** Posts per visitor per hour */
const PER_HOUR = 8

const allowed = (origin: string | null) =>
  !!origin && (ORIGINS.includes(origin) || LOCAL.test(origin))

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': allowed(origin) ? origin! : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  })

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

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
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const { pathname } = new URL(request.url)
    // (stellaroptimizer.com/api/feedback; /feedback for a local `wrangler dev`)
    if (pathname !== '/api/feedback' && pathname !== '/feedback')
      return new Response('Not found', { status: 404 })
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors(origin) })
    if (request.method !== 'POST')
      return reply(405, { error: 'POST only' }, origin)
    if (!allowed(origin)) return reply(403, { error: 'Origin' }, origin)

    const raw = await request.text()
    if (raw.length > MAX_BODY) return reply(413, { error: 'Too long' }, origin)
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(400, { error: 'JSON' }, origin)
    }
    // (a field people never see: filled in, it is a bot; told it worked, kept nowhere)
    if (text(body.website, 200)) return reply(201, { ok: true }, origin)
    const kind = KINDS.find((k) => k === body.kind)
    const message = text(body.message, 4000)
    if (!kind || message.length < 3)
      return reply(400, { error: 'Message' }, origin)

    // (a few an hour per visitor: keyed by a hash of the address, which is never stored)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const limitKey = `rl:${(await sha256(`stellar-feedback:${ip}`)).slice(0, 32)}`
    const count = Number((await env.FEEDBACK.get(limitKey)) ?? 0)
    if (count >= PER_HOUR) return reply(429, { error: 'Later' }, origin)
    await env.FEEDBACK.put(limitKey, String(count + 1), { expirationTtl: 3600 })

    const images = (Array.isArray(body.images) ? body.images : [])
      .filter(
        (x): x is string =>
          typeof x === 'string' && x.length <= MAX_IMAGE && IMAGE.test(x)
      )
      .slice(0, MAX_IMAGES)
    const at = new Date().toISOString()
    const id = crypto.randomUUID().slice(0, 8)
    const record = {
      at,
      kind,
      message,
      contact: text(body.contact, 100) || undefined,
      page: text(body.page, 300) || undefined,
      version: text(body.version, 40) || undefined,
      build: text(body.build, 60) || undefined,
      site: text(body.site, 80) || undefined,
      browser: text(request.headers.get('User-Agent'), 200) || undefined,
      images: images.length || undefined,
    }
    await Promise.all(
      images.map((image, n) => env.FEEDBACK.put(`img:${at}:${id}:${n}`, image))
    )
    await env.FEEDBACK.put(`fb:${at}:${id}`, JSON.stringify(record))
    return reply(201, { ok: true }, origin)
  },
}
