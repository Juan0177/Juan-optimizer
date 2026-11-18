import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// i18next returns "key '…' returned an object instead of string" when a key used as text is a group
// of keys in the locale file (e.g. `teamOpt.kqm.share` used as the Damage share title while
// `teamOpt.kqm.share.button`, `.team`… live under it). This scans the t() keys of the team page and
// of the team/enemy UI in gi-ui and checks that none of them is a group in the English or Italian
// files.

const root = resolve(__dirname, '../../../..')
const localeDir = join(root, 'libs/gi/localization/assets/locales')
const scanned = [
  'libs/gi/page-team/src',
  'libs/gi/ui/src/components/enemy',
  'libs/gi/ui/src/components/team',
  'libs/gi/ui/src/components/EnemyEditor.tsx',
  'libs/gi/ui/src/util/teamOpt',
]
const langs = ['en', 'it']

function sourceFiles(path: string): string[] {
  const abs = join(root, path)
  if (statSync(abs).isFile()) return [abs]
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
    .map((f) => join(abs, f))
}

const locales = new Map<string, Record<string, unknown> | null>()
function locale(lang: string, ns: string) {
  const id = `${lang}/${ns}`
  if (!locales.has(id)) {
    try {
      locales.set(
        id,
        JSON.parse(readFileSync(join(localeDir, lang, `${ns}.json`), 'utf8'))
      )
    } catch {
      locales.set(id, null) // generated (_gen) namespaces are not in the repo
    }
  }
  return locales.get(id) ?? null
}

function lookup(obj: Record<string, unknown>, key: string): unknown {
  let cur: unknown = obj
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/**
 * Where each useTranslation of the file is and the namespace a bare t('key') reads from it (the
 * first one listed; 'ui' when none is).
 */
function translationHooks(src: string): { at: number; ns: string }[] {
  return [...src.matchAll(/useTranslation\(\s*([^)]*)\)/g)].map((m) => ({
    at: m.index ?? 0,
    ns: /['"]([\w-]+)['"]/.exec(m[1])?.[1] ?? 'ui',
  }))
}

/** A bare key reads the closest useTranslation above it; above them all, any of the file's. */
function namespacesAt(hooks: { at: number; ns: string }[], at: number) {
  const before = hooks.filter((h) => h.at < at)
  if (before.length) return [before[before.length - 1].ns]
  return [...new Set(hooks.map((h) => h.ns))]
}

type Use = { file: string; line: number; ns: string[]; key: string }

function keyUses(): Use[] {
  const uses: Use[] = []
  for (const file of scanned.flatMap(sourceFiles)) {
    const src = readFileSync(file, 'utf8')
    const hooks = translationHooks(src)
    const re = /(?:\bt\(\s*|i18nKey=\{?\s*)(['"`])([\w.:-]+)\1([^)]{0,120})/g
    for (const m of src.matchAll(re)) {
      if (m[3].includes('returnObjects')) continue
      const raw = m[2]
      const sep = raw.indexOf(':')
      const ns = sep >= 0 ? [raw.slice(0, sep)] : namespacesAt(hooks, m.index)
      const key = sep >= 0 ? raw.slice(sep + 1) : raw
      const line = src.slice(0, m.index).split('\n').length
      uses.push({ file: relative(root, file), line, ns, key })
    }
  }
  return uses
}

describe('locale keys used as text', () => {
  const uses = keyUses()

  it('finds the keys of the team page', () => {
    expect(uses.length).toBeGreaterThan(500)
    expect(
      uses.some(
        (u) =>
          u.file.endsWith('DamageShare.tsx') && u.key.startsWith('teamOpt.kqm.')
      )
    ).toBe(true)
  })

  it.each(langs)('no key is a group of keys in %s', (lang) => {
    const objects: string[] = []
    for (const u of uses) {
      const found = u.ns
        .map((ns) => {
          const data = locale(lang, ns)
          return data ? lookup(data, u.key) : undefined
        })
        .filter((v) => v !== undefined)
      // flag only when every namespace that has the key holds a group there
      if (
        found.length &&
        found.every((v) => v !== null && typeof v === 'object')
      )
        objects.push(`${u.file}:${u.line} ${u.ns.join('|')}:${u.key}`)
    }
    expect(objects).toEqual([])
  })
})
