#!/usr/bin/env node
// A local page for the site's feedback (the stellar-feedback Worker's Workers KV), read with your own
// wrangler login: nothing is exposed beyond this machine (it listens on 127.0.0.1 only).
//
//   node tools/site/feedback-viewer.mjs            http://127.0.0.1:4320
//   PORT=5000 node tools/site/feedback-viewer.mjs
//   node tools/site/feedback-viewer.mjs --local    the local `wrangler dev` store instead
//
// It refreshes every 2 minutes (and on the Refresh button). Triage (new / seen / done) is kept on this
// machine in ~/.config/stellar-feedback/state.json; Delete removes a message and its screenshots for good.
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'feedback-worker'
)
const PORT = Number(process.env.PORT ?? 4320)
const WHERE = process.argv.includes('--local') ? '--local' : '--remote'
const STATE_DIR = join(homedir(), '.config', 'stellar-feedback')
const STATE_FILE = join(STATE_DIR, 'state.json')
const REFRESH_MS = 120_000

/** A wrangler KV command against the FEEDBACK binding (its JSON output) */
function kv(...args) {
  return new Promise((resolve, reject) =>
    execFile(
      'npx',
      ['--yes', 'wrangler@4', 'kv', ...args, '--binding', 'FEEDBACK', WHERE],
      { cwd: WORKER, maxBuffer: 256 * 1024 * 1024, env: process.env },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  )
}
const json = (out) => {
  const at = out.search(/[[{]/)
  return at < 0 ? undefined : JSON.parse(out.slice(at))
}

const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}
const writeState = (state) => {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
}

// the messages as last read, and their screenshots once asked for
let items = []
let updatedAt = 0
let loading
let lastError
const shots = new Map()

async function load() {
  if (loading) return loading
  loading = (async () => {
    try {
      const keys = (json(await kv('key', 'list', '--prefix', 'fb:')) ?? []).map(
        (k) => k.name
      )
      if (!keys.length) {
        items = []
      } else {
        const dir = mkdtempSync(join(tmpdir(), 'stellar-feedback-'))
        writeFileSync(join(dir, 'keys.json'), JSON.stringify(keys))
        const got = json(await kv('bulk', 'get', join(dir, 'keys.json'))) ?? {}
        items = keys
          .map((key) => {
            const raw = got[key]?.value ?? got[key]
            try {
              return {
                key,
                ...(typeof raw === 'string' ? JSON.parse(raw) : raw),
              }
            } catch {
              return { key, message: String(raw ?? '') }
            }
          })
          .filter((x) => x.message)
          .sort((a, b) => (a.key < b.key ? 1 : -1))
      }
      updatedAt = Date.now()
      lastError = undefined
    } catch (e) {
      lastError = String(e?.message ?? e).split('\n')[0]
    } finally {
      loading = undefined
    }
  })()
  return loading
}

async function screenshots(key) {
  const item = items.find((x) => x.key === key)
  const count = item?.images ?? 0
  if (!count) return []
  if (shots.has(key)) return shots.get(key)
  const names = Array.from(
    { length: count },
    (_, n) => `img:${key.slice(3)}:${n}`
  )
  const dir = mkdtempSync(join(tmpdir(), 'stellar-feedback-'))
  writeFileSync(join(dir, 'keys.json'), JSON.stringify(names))
  const got = json(await kv('bulk', 'get', join(dir, 'keys.json'))) ?? {}
  const urls = names
    .map((n) => got[n]?.value ?? got[n])
    .filter((x) => typeof x === 'string')
  shots.set(key, urls)
  return urls
}

async function remove(key) {
  const item = items.find((x) => x.key === key)
  await kv('key', 'delete', key)
  for (let n = 0; n < (item?.images ?? 0); n++)
    await kv('key', 'delete', `img:${key.slice(3)}:${n}`).catch(() => {})
  items = items.filter((x) => x.key !== key)
  shots.delete(key)
  const state = readState()
  delete state[key]
  writeState(state)
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}
const body = (req) =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
  })

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  // (this machine only: a page elsewhere cannot drive it)
  if (
    req.headers.origin &&
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)
  )
    return send(res, 403, { error: 'origin' })
  try {
    if (url.pathname === '/')
      return send(res, 200, PAGE, 'text/html; charset=utf-8')
    if (url.pathname === '/api/list') {
      if (url.searchParams.has('refresh') || !updatedAt) await load()
      return send(res, 200, {
        items,
        state: readState(),
        updatedAt,
        error: lastError,
        where: WHERE,
      })
    }
    if (url.pathname === '/api/shots')
      return send(res, 200, {
        urls: await screenshots(url.searchParams.get('key') ?? ''),
      })
    if (url.pathname === '/api/state' && req.method === 'POST') {
      const { key, status } = await body(req)
      const state = readState()
      if (status === 'new') delete state[key]
      else state[key] = { status, at: new Date().toISOString() }
      writeState(state)
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/api/delete' && req.method === 'POST') {
      const { key } = await body(req)
      if (!/^fb:/.test(key ?? '')) return send(res, 400, { error: 'key' })
      await remove(key)
      return send(res, 200, { ok: true })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e?.message ?? e).split('\n')[0] })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(
    `Feedback viewer: http://127.0.0.1:${PORT}  (${WHERE === '--local' ? 'local store' : 'Cloudflare'})`
  )
  load()
  setInterval(load, REFRESH_MS)
})

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedback · Stellar Optimizer</title>
<style>
:root{--ink:#121318;--panel:#191a21;--raised:#20212a;--line:rgba(236,229,216,.08);--line2:rgba(236,229,216,.16);
--text:#ece5d8;--muted:rgba(236,229,216,.62);--faint:rgba(236,229,216,.4);--gold:#d3bc8e;--gold2:#e6d5b1;
--bug:#e58a7a;--idea:#8fc0a0;--other:#8ea7c9;--r:12px}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--ink);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
.app{display:grid;grid-template-columns:232px minmax(0,1fr) minmax(0,1.15fr);height:100vh}
aside{border-right:1px solid var(--line);padding:22px 16px;display:flex;flex-direction:column;gap:22px;overflow:auto}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em}
.brand i{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--gold),#a99260);display:grid;place-items:center;
color:#17181f;font-style:normal;font-size:15px}
.group h4{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--faint)}
.f{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;cursor:pointer;
text-align:left;color:var(--muted)}
.f:hover{background:rgba(236,229,216,.04);color:var(--text)}
.f.on{background:rgba(211,188,142,.12);color:var(--text);box-shadow:inset 0 0 0 1px rgba(211,188,142,.35)}
.f .n{margin-left:auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.dot{width:8px;height:8px;border-radius:99px;flex:none}
.foot{margin-top:auto;font-size:12px;color:var(--faint);line-height:1.6}
.list{display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line)}
.bar{display:flex;gap:10px;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}
.search{flex:1;display:flex;align-items:center;gap:8px;background:var(--panel);border-radius:10px;padding:0 12px;
box-shadow:inset 0 0 0 1px var(--line)}
.search:focus-within{box-shadow:inset 0 0 0 1px rgba(211,188,142,.6),0 0 0 3px rgba(211,188,142,.12)}
.search input{flex:1;border:0;background:none;outline:none;height:38px}
.btn{height:38px;padding:0 14px;border-radius:10px;border:0;background:var(--panel);box-shadow:inset 0 0 0 1px var(--line2);
cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.btn:hover{box-shadow:inset 0 0 0 1px rgba(211,188,142,.5)}
.btn.gold{background:var(--gold);color:#17181f;box-shadow:none;font-weight:650}
.btn.gold:hover{background:var(--gold2)}
.btn.danger{color:var(--bug)}
.btn:focus-visible,.f:focus-visible,.card:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.spin{animation:spin 1s linear infinite;display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.cards{overflow:auto;padding:10px;display:flex;flex-direction:column;gap:6px}
.card{display:grid;gap:6px;padding:12px 14px;border-radius:var(--r);cursor:pointer;border:0;background:none;text-align:left;
box-shadow:inset 0 0 0 1px transparent}
.card:hover{background:rgba(236,229,216,.03)}
.card.sel{background:var(--raised);box-shadow:inset 0 0 0 1px var(--line2)}
.card .top{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--faint)}
.card .msg{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--text)}
.card.done .msg{color:var(--faint)}
.kind{display:inline-flex;align-items:center;gap:6px;font-weight:650;font-size:12px}
.new{width:7px;height:7px;border-radius:99px;background:var(--gold);box-shadow:0 0 0 3px rgba(211,188,142,.18)}
.chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:99px;font-size:11.5px;font-weight:600;
background:rgba(236,229,216,.06);color:var(--muted);white-space:nowrap}
.right{margin-left:auto}
.detail{overflow:auto;padding:28px 32px}
.empty{height:100%;display:grid;place-items:center;color:var(--faint);text-align:center}
.dh{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}
.dh h2{margin:0;font-size:20px;letter-spacing:-.01em}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 18px}
.body{font-size:15px;line-height:1.65;white-space:pre-wrap;word-break:break-word;background:var(--panel);border-radius:var(--r);
padding:18px 20px;box-shadow:inset 0 0 0 1px var(--line)}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:16px}
.shots img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;cursor:zoom-in;box-shadow:inset 0 0 0 1px var(--line2);
background:var(--panel)}
.facts{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 14px;margin-top:22px;font-size:13px}
.facts dt{color:var(--faint)}.facts dd{margin:0;color:var(--muted);word-break:break-word}
.facts a{color:var(--gold)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.lightbox{position:fixed;inset:0;background:rgba(8,8,12,.88);display:none;place-items:center;padding:32px;cursor:zoom-out;z-index:9}
.lightbox.on{display:grid}.lightbox img{max-width:100%;max-height:100%;border-radius:10px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--raised);padding:10px 16px;border-radius:10px;
box-shadow:0 10px 30px rgba(0,0,0,.4),inset 0 0 0 1px var(--line2);display:none}
.toast.on{display:block}
.err{margin:10px 18px 0;padding:10px 12px;border-radius:10px;background:rgba(229,138,122,.1);color:var(--bug);font-size:13px}
@media (max-width:1100px){.app{grid-template-columns:200px minmax(0,1fr)}.detail{display:none}.app.open .list{display:none}
.app.open .detail{display:block}}
</style></head><body>
<div class="app" id="app">
 <aside>
  <div class="brand"><i>✦</i>Feedback</div>
  <div class="group"><h4>Kind</h4><div id="kinds"></div></div>
  <div class="group"><h4>Status</h4><div id="statuses"></div></div>
  <div class="group"><h4>Site</h4><div id="sites"></div></div>
  <div class="foot" id="foot"></div>
 </aside>
 <section class="list">
  <div class="bar">
   <label class="search"><span style="color:var(--faint)">⌕</span><input id="q" placeholder="Search messages, pages, names…" autocomplete="off"></label>
   <button class="btn" id="refresh" title="Read Cloudflare again">↻ Refresh</button>
  </div>
  <div id="err"></div>
  <div class="cards" id="cards" role="listbox" aria-label="Feedback"></div>
 </section>
 <section class="detail" id="detail"><div class="empty">Select a message</div></section>
</div>
<div class="lightbox" id="lightbox"><img alt=""></div>
<div class="toast" id="toast"></div>
<script>
const KINDS={bug:{label:'Bug',color:'var(--bug)'},idea:{label:'Idea',color:'var(--idea)'},other:{label:'Other',color:'var(--other)'}}
const STATUS={new:'New',seen:'Seen',done:'Done'}
let data={items:[],state:{}},sel,filter={kind:'all',status:'open',site:'all',q:''}
const $=(id)=>document.getElementById(id)
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c])
const statusOf=(k)=>data.state[k]?.status??'new'
const ago=(iso)=>{const s=(Date.now()-Date.parse(iso))/1000;if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+' min ago';
 if(s<86400)return Math.floor(s/3600)+' h ago';if(s<604800)return Math.floor(s/86400)+' d ago';return new Date(iso).toLocaleDateString()}
const when=(iso)=>new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})
const siteName=(s)=>s?s.replace(/^www\./,''):'unknown'
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('on');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('on'),1800)}
function visible(){const q=filter.q.toLowerCase();return data.items.filter((x)=>{
 if(filter.kind!=='all'&&x.kind!==filter.kind)return false
 const st=statusOf(x.key);if(filter.status==='open'&&st==='done')return false;if(filter.status!=='open'&&filter.status!=='all'&&st!==filter.status)return false
 if(filter.site!=='all'&&siteName(x.site)!==filter.site)return false
 if(q&&![x.message,x.page,x.contact,x.version,x.site].join(' ').toLowerCase().includes(q))return false;return true})}
function facet(id,options,key){$(id).innerHTML=options.map(([v,label,n,color])=>'<button class="f'+(filter[key]===v?' on':'')+'" data-k="'+key+'" data-v="'+esc(v)+'">'+
 (color?'<span class="dot" style="background:'+color+'"></span>':'')+esc(label)+'<span class="n">'+n+'</span></button>').join('')}
function render(){
 const all=data.items,count=(f)=>all.filter(f).length
 facet('kinds',[['all','All',all.length],...Object.entries(KINDS).map(([k,v])=>[k,v.label,count((x)=>x.kind===k),v.color])],'kind')
 facet('statuses',[['open','Open',count((x)=>statusOf(x.key)!=='done')],['new','New',count((x)=>statusOf(x.key)==='new')],
  ['seen','Seen',count((x)=>statusOf(x.key)==='seen')],['done','Done',count((x)=>statusOf(x.key)==='done')],['all','All',all.length]],'status')
 const sites=[...new Set(all.map((x)=>siteName(x.site)))].sort()
 facet('sites',[['all','All sites',all.length],...sites.map((s)=>[s,s,count((x)=>siteName(x.site)===s)])],'site')
 const list=visible()
 $('cards').innerHTML=list.length?list.map((x)=>{const k=KINDS[x.kind]??KINDS.other,st=statusOf(x.key)
  return '<button class="card'+(x.key===sel?' sel':'')+(st==='done'?' done':'')+'" role="option" data-key="'+esc(x.key)+'">'+
  '<div class="top"><span class="kind" style="color:'+k.color+'">'+(st==='new'?'<span class="new"></span>':'')+k.label+'</span>'+
  '<span>'+ago(x.at)+'</span>'+(x.images?'<span class="chip">▣ '+x.images+'</span>':'')+(x.contact?'<span class="chip">@'+esc(x.contact)+'</span>':'')+
  '<span class="right">'+esc(siteName(x.site))+'</span></div><div class="msg">'+esc(x.message)+'</div></button>'}).join('')
  :'<div class="empty" style="padding:60px 0">'+(all.length?'Nothing matches these filters':'No feedback yet')+'</div>'
 $('foot').innerHTML=(data.updatedAt?'Updated '+ago(new Date(data.updatedAt).toISOString()):'Loading…')+'<br>'+all.length+' message'+(all.length===1?'':'s')+
  (data.where==='--local'?' · local store':' · Cloudflare')
 $('err').innerHTML=data.error?'<div class="err">Could not read Cloudflare: '+esc(data.error)+'</div>':''
 renderDetail()}
async function renderDetail(){const x=data.items.find((i)=>i.key===sel);const d=$('detail')
 if(!x){d.innerHTML='<div class="empty">Select a message</div>';return}
 const k=KINDS[x.kind]??KINDS.other,st=statusOf(x.key)
 const page=x.page&&x.site?'https://'+x.site+'/#'+x.page:''
 d.innerHTML='<div class="dh"><div style="flex:1"><div class="kind" style="color:'+k.color+';font-size:13px">'+k.label+'</div>'+
  '<h2>'+esc(when(x.at))+'</h2></div><span class="chip">'+STATUS[st]+'</span></div>'+
  '<div class="meta">'+(x.contact?'<span class="chip">Discord · '+esc(x.contact)+'</span>':'')+'<span class="chip">'+esc(siteName(x.site))+'</span>'+
  (x.version?'<span class="chip">v'+esc(x.version)+'</span>':'')+(x.page?'<span class="chip">'+esc(x.page)+'</span>':'')+'</div>'+
  '<div class="body">'+esc(x.message)+'</div><div class="shots" id="shots">'+(x.images?Array.from({length:x.images},()=>
  '<img alt="" style="opacity:.3">').join(''):'')+'</div>'+
  '<dl class="facts">'+(page?'<dt>Page</dt><dd><a href="'+esc(page)+'" target="_blank" rel="noreferrer">'+esc(page)+'</a></dd>':'')+
  (x.build?'<dt>Build</dt><dd>'+esc(x.build)+'</dd>':'')+(x.browser?'<dt>Browser</dt><dd>'+esc(x.browser)+'</dd>':'')+
  '<dt>Key</dt><dd>'+esc(x.key)+'</dd></dl>'+
  '<div class="actions">'+(st!=='done'?'<button class="btn gold" data-act="done">✓ Mark done</button>':'<button class="btn" data-act="new">Reopen</button>')+
  (st==='new'?'<button class="btn" data-act="seen">Mark seen</button>':'')+
  (x.contact?'<button class="btn" data-act="copy">Copy Discord name</button>':'')+'<button class="btn" data-act="copymsg">Copy message</button>'+
  '<button class="btn danger" data-act="delete" style="margin-left:auto">Delete</button></div>'
 if(st==='new')setStatus(x.key,'seen',true)
 if(x.images){const r=await fetch('/api/shots?key='+encodeURIComponent(x.key)).then((r)=>r.json());if(sel!==x.key)return
  $('shots').innerHTML=(r.urls??[]).map((u)=>'<img alt="Screenshot" src="'+u+'">').join('')}}
async function setStatus(key,status,quiet){data.state[key]={status};if(status==='new')delete data.state[key]
 await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,status})});if(!quiet)render();else renderList()}
function renderList(){const keep=sel;render();sel=keep}
async function load(refresh){$('refresh').innerHTML=refresh?'<span class="spin">↻</span> Refreshing':'↻ Refresh'
 const r=await fetch('/api/list'+(refresh?'?refresh=1':'')).then((r)=>r.json()).catch((e)=>({error:String(e)}))
 data={...data,...r};if(!sel&&data.items[0])sel=data.items[0].key;$('refresh').innerHTML='↻ Refresh';render()}
document.addEventListener('click',async(e)=>{const f=e.target.closest('.f');if(f){filter[f.dataset.k]=f.dataset.v;render();return}
 const c=e.target.closest('.card');if(c){sel=c.dataset.key;$('app').classList.add('open');render();return}
 const img=e.target.closest('.shots img');if(img&&img.src){const l=$('lightbox');l.querySelector('img').src=img.src;l.classList.add('on');return}
 if(e.target.closest('#lightbox')){$('lightbox').classList.remove('on');return}
 const a=e.target.closest('[data-act]');if(!a)return;const x=data.items.find((i)=>i.key===sel);if(!x)return
 if(a.dataset.act==='done'||a.dataset.act==='seen'||a.dataset.act==='new')return setStatus(x.key,a.dataset.act)
 if(a.dataset.act==='copy'){navigator.clipboard.writeText(x.contact);return toast('Copied '+x.contact)}
 if(a.dataset.act==='copymsg'){navigator.clipboard.writeText(x.message);return toast('Message copied')}
 if(a.dataset.act==='delete'){if(!confirm('Delete this message and its screenshots from Cloudflare for good?'))return
  a.textContent='Deleting…';const r=await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:x.key})}).then((r)=>r.json())
  if(r.error)return toast('Could not delete: '+r.error);data.items=data.items.filter((i)=>i.key!==x.key);const v=visible();sel=v[0]?.key;toast('Deleted');render()}})
$('refresh').onclick=()=>load(true)
$('q').oninput=(e)=>{filter.q=e.target.value;render()}
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){$('lightbox').classList.remove('on');$('app').classList.remove('open')}
 if(e.target.tagName==='INPUT')return;const v=visible(),i=v.findIndex((x)=>x.key===sel)
 if(e.key==='j'||e.key==='ArrowDown'){sel=v[Math.min(v.length-1,i+1)]?.key;render()}
 if(e.key==='k'||e.key==='ArrowUp'){sel=v[Math.max(0,i-1)]?.key;render()}
 if(e.key==='d'&&sel)setStatus(sel,'done')
 if(e.key==='/'){e.preventDefault();$('q').focus()}})
load(false);setInterval(()=>load(false),60000)
</script></body></html>`
