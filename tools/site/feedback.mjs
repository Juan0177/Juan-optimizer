#!/usr/bin/env node
// The feedback sent from the site's Feedback button (tools/feedback-worker), read with your own
// wrangler login: only someone logged in to the Cloudflare account can read it.
//
//   node tools/site/feedback.mjs                 newest first, in the terminal
//   node tools/site/feedback.mjs --html          also as a page (opened in the browser)
//   node tools/site/feedback.mjs --since 2d      only the last 2 days (h, d or w)
//   node tools/site/feedback.mjs --local         the local `wrangler dev` store instead
//   node tools/site/feedback.mjs --delete <key>  remove one and its screenshots (its key is printed)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'feedback-worker'
)
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const where = flag('--local') ? '--local' : '--remote'
const wrangler = (...rest) =>
  execFileSync(
    'npx',
    ['--yes', 'wrangler@4', 'kv', ...rest, '--binding', 'FEEDBACK', where],
    {
      cwd: WORKER,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }
  )
const json = (out) => JSON.parse(out.slice(out.indexOf(out.match(/[[{]/)[0])))

const deleting = value('--delete')
if (deleting) {
  wrangler('key', 'delete', deleting)
  for (let n = 0; n < 4; n++)
    try {
      wrangler('key', 'delete', `img:${deleting.slice(3)}:${n}`)
    } catch {
      // (fewer screenshots)
    }
  console.log(`deleted ${deleting}`)
  process.exit(0)
}

const since = value('--since')
const cutoff = since
  ? Date.now() -
    Number.parseFloat(since) *
      { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[since.slice(-1)]
  : 0
const keys = json(wrangler('key', 'list', '--prefix', 'fb:'))
  .map((k) => k.name)
  .filter((k) => Date.parse(k.slice(3, 27)) >= cutoff)
  .sort()
  .reverse()
if (!keys.length) {
  console.log('No feedback yet.')
  process.exit(0)
}
const dir = mkdtempSync(join(tmpdir(), 'stellar-feedback-'))
writeFileSync(join(dir, 'keys.json'), JSON.stringify(keys))
const got = json(wrangler('bulk', 'get', join(dir, 'keys.json')))
const items = keys
  .map((key) => {
    // (wrangler wraps each value: { value })
    const raw = got[key]?.value ?? got[key]
    try {
      return { key, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }
    } catch {
      return { key, message: String(raw) }
    }
  })
  .filter((x) => x.message)
// their screenshots (data URLs), read only for the page
if (flag('--html')) {
  const imageKeys = items.flatMap((f) =>
    Array.from(
      { length: f.images ?? 0 },
      (_, n) => `img:${f.key.slice(3)}:${n}`
    )
  )
  if (imageKeys.length) {
    writeFileSync(join(dir, 'images.json'), JSON.stringify(imageKeys))
    const shots = json(wrangler('bulk', 'get', join(dir, 'images.json')))
    for (const f of items)
      f.shots = Array.from(
        { length: f.images ?? 0 },
        (_, n) => shots[`img:${f.key.slice(3)}:${n}`]?.value
      ).filter(Boolean)
  }
}

const when = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
for (const f of items) {
  console.log(
    `\n${(f.kind ?? '?').toUpperCase()}  ${when(f.at)}  ${f.site ?? ''} v${f.version ?? '?'}${f.page ? `  ${f.page}` : ''}${f.contact ? `  from ${f.contact}` : ''}`
  )
  console.log(`  ${f.message.replace(/\n/g, '\n  ')}`)
  if (f.images)
    console.log(
      `  [${f.images} screenshot${f.images > 1 ? 's' : ''}: see --html]`
    )
  console.log(`  (${f.key})`)
}
console.log(`\n${items.length} item(s)`)

if (flag('--html')) {
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    )
  const page = `<!doctype html><meta charset="utf-8"><title>Stellar Optimizer feedback</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#15161d;color:#ece5d8;max-width:860px;margin:40px auto;padding:0 20px}
h1{font-size:22px}article{background:#1f2029;border:1px solid #2c2d38;border-radius:12px;padding:14px 16px;margin:12px 0}
.meta{font-size:12.5px;color:#a8a294}.kind{font-weight:700;color:#d3bc8e;margin-right:8px}
p{white-space:pre-wrap;margin:8px 0 0}code{font-size:11.5px;color:#6f6b62}</style>
<h1>Feedback (${items.length})</h1>
${items
  .map(
    (
      f
    ) => `<article><div class="meta"><span class="kind">${esc(f.kind)}</span>${esc(when(f.at))} · ${esc(f.site)} v${esc(f.version)}${f.page ? ` · ${esc(f.page)}` : ''}${f.contact ? ` · from <b>${esc(f.contact)}</b>` : ''}</div>
<p>${esc(f.message)}</p>${(f.shots ?? []).map((src) => `<a href="${src}" target="_blank"><img src="${src}" alt="" style="max-width:100%;border-radius:8px;margin-top:10px;display:block"></a>`).join('')}<div class="meta">${esc(f.browser)}</div><code>${esc(f.key)}</code></article>`
  )
  .join('\n')}`
  const file = join(dir, 'feedback.html')
  writeFileSync(file, page)
  console.log(`\n${file}`)
  try {
    execFileSync('open', [file])
  } catch {
    // (no opener: the path above)
  }
}
