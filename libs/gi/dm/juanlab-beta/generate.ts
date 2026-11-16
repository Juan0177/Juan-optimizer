// juanlab-beta: generates the data of the beta content listed in config.json, the same files GO's own pipeline
// writes for "Hakushin" (beta) keys: stats, asset paths and images, English texts.
//   npx vite-node -c libs/gi/dm/juanlab-beta/vite.config.mts libs/gi/dm/juanlab-beta/generate.ts [--fetch]
// --fetch downloads the data and icons again from Nanoka (gi.nanoka.cc) for the version in config.json; without it
// the saved data in data/ is used. GO's generators (gen-stats, gen-locale, gen-assets) need the whole datamine, so
// this script repeats their Hakushin branch for these keys only.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dumpFile, generateIndexFromObj } from '@genshin-optimizer/common/pipeline'
import {
  artifactSlotMap,
  propTypeMap,
  QualityTypeMap,
  weaponMap,
} from '../src/mapping'
import { parsingFunctions, preprocess } from '../../dm-localization/src/executors/gen-locale/lib/parseUtil'

const HERE = dirname(fileURLToPath(import.meta.url))
const GI = join(HERE, '../..')
const config = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))
const NANOKA = `https://static.nanoka.cc/gi/${config.nanokaVersion}/en`
const ICONS = 'https://static.nanoka.cc/assets/gi'
const fetchMode = process.argv.includes('--fetch')
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const dataPath = (kind: string, id: string) => join(HERE, 'data', kind, `${id}.json`)

/* ---------- Nanoka -> Hakushin (Nanoka keeps Hakushin's structure with snake_case keys) ---------- */
const SPECIAL: Record<string, string> = {
  base_hp: 'BaseHP', base_atk: 'BaseATK', base_def: 'BaseDEF', crit_rate: 'CritRate', crit_dmg: 'CritDMG',
  level_exp: 'LevelEXP', va: 'VA', hp: 'HP', atk: 'ATK', def: 'DEF', xp_requirements: 'XPRequirements',
}
const pascal = (k: string) => SPECIAL[k] ?? k.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
const camel = (k: string) => { const p = pascal(k); return p.charAt(0).toLowerCase() + p.slice(1) }
const prop = (k: string) => (k.toLowerCase().startsWith('fight_prop_') ? k.toUpperCase() : k)
// Hyperlink tooltips need the datamine's hyperlink table: keep the linked words, drop the link.
const unlink = (s: unknown): any =>
  typeof s === 'string' ? s.replace(/\{LINK#[A-Z]\d+\}/g, '').replace(/\{\/LINK\}/g, '')
  : Array.isArray(s) ? s.map(unlink)
  : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, unlink(v)]))
  : s
function generic(o: any): any {
  if (Array.isArray(o)) return o.map(generic)
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [/^\d+$/.test(k) ? k : pascal(k), generic(v)]))
  return o
}
function toHakushinChar(n: any) {
  const h = generic(n)
  const sm = n.stats_modifier
  h.StatsModifier = {
    HP: sm.hp, ATK: sm.atk, DEF: sm.def,
    Ascension: sm.ascension.map((a: any) => Object.fromEntries(Object.entries(a).map(([k, v]) => [prop(k), v]))),
    PropGrowCurves: sm.prop_grow_curves.map((c: any) => ({ type: c.type, growCurve: c.grow_curve })),
    RecommendedProps: sm.recommended_props ?? [],
  }
  h.Skills.forEach((s: any, i: number) => {
    s.Promote = Object.fromEntries(Object.entries(n.skills[i].promote).map(([k, p]: [string, any]) => [k, { Level: p.level, Icon: p.icon, Desc: p.desc, Param: p.param }]))
  })
  delete h.Attack
  delete h.Energy
  return h
}
function toHakushinWeapon(n: any) {
  const { weapon_prop, stats_modifier, ascension, ...rest } = n
  const h = generic(rest)
  h.WeaponProp = weapon_prop.map((p: any) => ({ type: p.type, propType: p.prop_type, initValue: p.init_value }))
  h.StatsModifier = Object.fromEntries(Object.entries(stats_modifier).map(([k, v]: [string, any]) => [k === 'atk' ? 'ATK' : prop(k), { Base: v.base, Levels: v.levels }]))
  h.Ascension = Object.fromEntries(Object.entries(ascension).map(([l, a]: [string, any]) => [l, Object.fromEntries(Object.entries(a).map(([k, v]) => [prop(k), v]))]))
  return h
}
function toHakushinArtifact(n: any) {
  return {
    Id: n.id, Icon: n.icon, Need: n.need, Rank: n.rank,
    Affix: n.affix.map((a: any) => Object.fromEntries(Object.entries(a).map(([k, v]: [string, any]) =>
      k === 'add_props' ? ['addProps', v.map((p: any) => Object.fromEntries(Object.entries(p).map(([pk, pv]) => [camel(pk), pk === 'prop_type' ? prop(pv as string) : pv])))]
      : k === 'name' || k === 'desc' ? [pascal(k), v]
      : [camel(k), v]))),
    Parts: Object.fromEntries(Object.entries(n.parts).map(([slot, part]) => [slot.toUpperCase(), generic(part)])),
  }
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}
async function loadAll() {
  const kinds = { character: [config.characters, toHakushinChar], weapon: [config.weapons, toHakushinWeapon], artifact: [config.artifacts, toHakushinArtifact] } as const
  const out: Record<string, Record<string, any>> = { character: {}, weapon: {}, artifact: {} }
  for (const [kind, [ids, convert]] of Object.entries(kinds)) {
    for (const [id, key] of Object.entries(ids as Record<string, string>)) {
      if (fetchMode || !existsSync(dataPath(kind, id))) {
        const data = unlink((convert as (n: any) => any)(await fetchJson(`${NANOKA}/${kind}/${id}.json`)))
        mkdirSync(dirname(dataPath(kind, id)), { recursive: true })
        writeFileSync(dataPath(kind, id), `${JSON.stringify(data, undefined, 2)}\n`)
      }
      out[kind][key] = readJson(dataPath(kind, id))
    }
  }
  return out
}

/* ---------- stats (gen-stats, Hakushin branch) ---------- */
const transpose = (rows: number[][]) => rows[0].map((_, i) => rows.map((r) => r[i]))
// With four passives the third is the region one ("Stellar Jubilee", "Moonsign") and the last the utility one:
// GO's datamine puts the region passive in `passive3` and the utility one in `passive` (Valeriy, Mitya, Ineffa).
const passive3Of = (d: any) => (d.Passives.length > 3 ? d.Passives[2] : d.Passives[d.Passives.length - 1])
const regionPassive = (d: any) => (d.Passives.length > 3 ? d.Passives[d.Passives.length - 1] : undefined)
function charStats(key: string, d: any) {
  const ascensionBonus: Record<string, number[]> = {}
  for (const asc of d.StatsModifier.Ascension)
    for (const [p, v] of Object.entries(asc)) (ascensionBonus[(propTypeMap as any)[p]] ??= [0]).push(v as number)
  const bases = [d.BaseHP, d.BaseATK, d.BaseDEF]
  const data = {
    key,
    ele: d.CharaInfo.Vision.toLowerCase(),
    weaponType: (weaponMap as any)[d.Weapon],
    birthday: { month: d.CharaInfo.Birth[0], day: d.CharaInfo.Birth[1] },
    rarity: (QualityTypeMap as any)[d.Rarity],
    lvlCurves: d.StatsModifier.PropGrowCurves.map((c: any, i: number) => ({ key: (propTypeMap as any)[c.type], base: bases[i], curve: c.growCurve })),
    ascensionBonus,
    baseStats: {},
  }
  const params = (s: any) => transpose(Object.values(s.Promote).map((l: any) => l.Param))
  const extra = regionPassive(d)
  const skillParam = {
    auto: params(d.Skills[0]),
    skill: params(d.Skills[1]),
    burst: params(d.Skills[d.Skills.length - 1]),
    passive1: d.Passives[0].ParamList.map((v: number) => [v]),
    passive2: d.Passives[1].ParamList.map((v: number) => [v]),
    passive3: passive3Of(d).ParamList.map((v: number) => [v]),
    ...(extra ? { passive: extra.ParamList.map((v: number) => [v]) } : {}),
    ...Object.fromEntries(d.Constellations.map((c: any, i: number) => [`constellation${i + 1}`, c.ParamList])),
    upgradeableSkills: [],
  }
  return { data, skillParam }
}
function weaponStats(d: any) {
  const lvl = d.WeaponProp.map((p: any) => ({ key: (propTypeMap as any)[p.propType], base: p.initValue, curve: p.type }))
  return {
    weaponType: (weaponMap as any)[d.WeaponType],
    rarity: d.Rarity,
    mainStat: { type: lvl[0].key, base: lvl[0].base, curve: lvl[0].curve },
    subStat: { type: lvl[1].key, base: lvl[1].base, curve: lvl[1].curve },
    lvlCurves: lvl,
    refinementBonus: {},
    ascensionBonus: { atk: [0, ...Object.values(d.Ascension).map((a: any) => a.FIGHT_PROP_BASE_ATTACK)] },
  }
}
const artifactStats = (d: any) => ({ setNum: d.Need, rarities: d.Rank, slots: Object.keys(d.Parts).map((p) => (artifactSlotMap as any)[p]) })

/* ---------- assets (gen-assets-data + gen-assets, Hakushin branch) ---------- */
function charAssets(d: any) {
  const extra = regionPassive(d)
  return {
    icon: d.Icon,
    iconSide: d.Icon.replace('AvatarIcon', 'AvatarIcon_Side'),
    banner: d.CharaInfo.Namecard.Icon,
    bar: d.CharaInfo.Namecard.Icon.replace(/_P$/, '_Alpha'),
    skill: d.Skills[1].Promote[0].Icon,
    burst: d.Skills[d.Skills.length - 1].Promote[0].Icon,
    passive1: d.Passives[0].Icon,
    passive2: d.Passives[1].Icon,
    passive3: passive3Of(d).Icon,
    ...(extra ? { passive: extra.Icon } : {}),
    ...Object.fromEntries(d.Constellations.map((c: any, i: number) => [`constellation${i + 1}`, c.Icon])),
  }
}
const weaponAssets = (d: any) => ({ icon: d.Icon, awakenIcon: `${d.Icon}_Awaken` })
const artifactAssets = (d: any) => Object.fromEntries(Object.entries(d.Parts).map(([slot, part]: [string, any]) => [(artifactSlotMap as any)[slot], part.Icon]))
async function saveIcon(name: string, dir: string) {
  const dest = join(dir, `${name}.png`)
  if (existsSync(dest) && !fetchMode) return
  mkdirSync(dir, { recursive: true })
  const res = await fetch(`${ICONS}/${name}.webp`)
  if (!res.ok) throw new Error(`icona ${name}: ${res.status}`)
  const webp = join(dir, `${name}.webp`)
  writeFileSync(webp, Buffer.from(await res.arrayBuffer()))
  // PNG like the rest of GO's assets.
  execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).save(sys.argv[2],optimize=True);import os;os.remove(sys.argv[1])', webp, dest])
}

/* ---------- materials (gen-mats) ---------- */
// GO's material keys are the English names without spaces and punctuation; '???' (not yet named in the beta) is left out.
const matKey = (name: string) => name.replace(/'s\b/g, 's').replace(/(^|\s)(\w)/g, (_m, sp, c) => sp + c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '')
const matLevel = (lv: any) => ({ items: lv.Mats.filter((m: any) => m.Name && m.Name !== '???').map((m: any) => ({ item: matKey(m.Name), amount: m.Count })), cost: lv.Cost })
const empty = { items: [], cost: 0 }
function charMats(materials: any) {
  const talent = (levels: any[]) => Object.fromEntries(Array.from({ length: 15 }, (_, i) => [String(i + 1), i >= 1 && i <= levels.length ? matLevel(levels[i - 1]) : empty]))
  return {
    talents: { normal: talent(materials.Talents[0]), skill: talent(materials.Talents[1]), burst: talent(materials.Talents[2]) },
    ascension: Object.fromEntries([['0', { cost: 0, items: [] }], ...materials.Ascensions.map((a: any, i: number) => [String(i + 1), { cost: a.Cost, items: matLevel(a).items }])]),
  }
}

/* ---------- character card ---------- */
// GO's cards come from the official drip marketing, which the beta does not have yet. The card is the gacha banner
// of Lunaris (lunaris.moe, 2048x1024 with transparency) cut to a vertical 292x700 around the character, on the colour
// of the element; config.json "cardCenterX" says where the character stands in the banner. Without the banner, a
// provisional card with the character's icon.
const LUNARIS_GACHA = 'https://api.lunaris.moe/data/assets/gachaimg'
const ELEMENT_COLOR: Record<string, string> = { electro: '#8f52c9', cryo: '#4fb3d1', pyro: '#d9573b', hydro: '#3d7fd9', anemo: '#3fbf9f', geo: '#c9a23b', dendro: '#6fae3a' }
const ELEMENT_DARK: Record<string, string> = { electro: '#2a1d45', cryo: '#1d3550', pyro: '#4a1f17', hydro: '#17284a', anemo: '#173f36', geo: '#43361a', dendro: '#243b17' }
async function makeCard(key: string, iconName: string, iconPng: string, dest: string, element: string) {
  const banner = iconName.replace('UI_AvatarIcon_', 'UI_Gacha_AvatarImg_')
  const res = await fetch(`${LUNARIS_GACHA}/${banner}.png`).catch(() => undefined)
  if (res?.ok) {
    const tmp = `${dest}.banner.png`
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
    execFileSync('python3', ['-c', `
import os, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
os.remove(sys.argv[1])
w = round(im.height * 292 / 700)
cx = int(sys.argv[3]) if sys.argv[3] else im.width // 2
x0 = max(0, min(im.width - w, cx - w // 2))
crop = im.crop((x0, 0, x0 + w, im.height))
card = Image.new('RGBA', crop.size, sys.argv[4])
fade = Image.new('RGBA', crop.size, (0, 0, 0, 0))
for y in range(crop.height):
    fade.paste((0, 0, 0, int(140 * y / crop.height)), (0, y, w, y + 1))
card = Image.alpha_composite(card, fade)
card.alpha_composite(crop)
card.convert('RGB').resize((292, 700), Image.LANCZOS).save(sys.argv[2], 'WEBP', quality=90)
`, tmp, dest, String(config.cardCenterX?.[key] ?? ''), ELEMENT_DARK[element] ?? '#222222'])
    return
  }
  console.warn(`banner ${banner} non trovato su Lunaris: cartoncino provvisorio con l'icona`)
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
icon = Image.open(sys.argv[1]).convert('RGBA')
card = Image.new('RGBA', (350, 700), sys.argv[3])
fade = Image.new('RGBA', (350, 700), (0, 0, 0, 0))
for y in range(700):
    for_alpha = int(150 * y / 700)
    fade.paste((0, 0, 0, for_alpha), (0, y, 350, y + 1))
card = Image.alpha_composite(card, fade)
icon = icon.resize((330, 330), Image.LANCZOS)
card.alpha_composite(icon, (10, 185))
card.convert('RGB').save(sys.argv[2], 'WEBP', quality=88)
`, iconPng, dest, ELEMENT_COLOR[element] ?? '#555555'])
}

/* ---------- English texts (gen-locale, Hakushin branch) ---------- */
function charLocale(key: string, d: any) {
  const ns = `char_${key}_gen`
  const parse = (type: string, s: string) => parsingFunctions[type]('en', preprocess(s, ns), ['char', key])
  const skillParams = (strs: string[], type: string) => Object.fromEntries(strs.map((p, i) => [i, parse(type, p)]))
  const talent = (s: any, withFields = false) => ({
    name: withFields ? parse('autoName', s.Name) : s.Name,
    ...(withFields ? { fields: parse('autoFields', s.Desc) } : { description: parse('paragraph', s.Desc) }),
    skillParams: skillParams(s.Promote[0].Desc, 'skillParam'),
    skillParamsEncoding: skillParams(s.Promote[0].Desc, 'skillParamEncoding'),
  })
  const text = (t: any) => ({ name: t.Name, description: parse('paragraph', t.Desc) })
  const extra = regionPassive(d)
  return {
    name: d.Name,
    title: d.CharaInfo.Title,
    description: d.CharaInfo.Detail,
    constellationName: d.CharaInfo.Constellation,
    auto: talent(d.Skills[0], true),
    skill: talent(d.Skills[1]),
    burst: talent(d.Skills[d.Skills.length - 1]),
    passive1: text(d.Passives[0]),
    passive2: text(d.Passives[1]),
    passive3: text(passive3Of(d)),
    ...(extra ? { passive: text(extra) } : {}),
    ...Object.fromEntries(d.Constellations.map((c: any, i: number) => [`constellation${i + 1}`, text(c)])),
  }
}
function weaponLocale(key: string, d: any) {
  const parse = (s: string) => parsingFunctions['paragraph']('en', preprocess(s, `weapon_${key}_gen`), ['weapon', key])
  return {
    name: d.Name,
    description: parse(d.Desc),
    passiveName: d.Refinement[1].Name,
    passiveDescription: Object.fromEntries(Object.values(d.Refinement).map((r: any, i) => [i, parse(r.Desc)])),
  }
}
function artifactLocale(d: any) {
  return {
    setName: d.Affix[0].Name,
    setEffects: Object.fromEntries(d.Need.map((n: number, i: number) => [n, d.Affix[i].Desc])),
    pieces: Object.fromEntries(Object.entries(d.Parts).map(([slot, p]: [string, any]) => [(artifactSlotMap as any)[slot], { name: p.Name, desc: p.Desc }])),
  }
}

/* ---------- write ---------- */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
async function main() {
  const all = await loadAll()
  const STATS = join(GI, 'stats')
  const allStat = readJson(join(STATS, 'src/allStat_gen.json'))
  const artSets = readJson(join(STATS, 'Data/Artifacts/artifact_set.json'))
  const assetsData = readJson(join(GI, 'assets-data/src/AssetsData_gen.json'))
  const LOC = join(GI, 'dm-localization/assets/locales/en')
  const names = { char: readJson(join(LOC, 'charNames_gen.json')), weapon: readJson(join(LOC, 'weaponNames_gen.json')), artifact: readJson(join(LOC, 'artifactNames_gen.json')) }
  const GEN = join(GI, 'assets/src/gen')
  const matsPath = join(GI, 'mats/src/allCharacterMats_gen.json')
  const mats = readJson(matsPath)
  const CARDS = join(GI, 'char-cards/src')

  for (const [key, d] of Object.entries(all.character)) {
    const { data, skillParam } = charStats(key, d)
    dumpFile(join(STATS, `Data/Characters/${key}/data.json`), data)
    dumpFile(join(STATS, `Data/Characters/${key}/skillParam.json`), skillParam)
    allStat.char.data[key] = data
    allStat.char.skillParam[key] = skillParam
    const assets = charAssets(d)
    assetsData.chars[key] = assets
    for (const icon of Object.values(assets)) await saveIcon(icon as string, join(GEN, 'chars', key))
    const loc = charLocale(key, d)
    dumpFile(join(LOC, `char_${key}_gen.json`), loc)
    names.char[key] = loc.name
    mats[key] = charMats(d.Materials)
    const card = join(CARDS, `Character_${key}_Card.webp`)
    if (fetchMode || !existsSync(card))
      await makeCard(key, assets.icon, join(GEN, 'chars', key, `${assets.icon}.png`), card, data.ele)
  }
  for (const [key, d] of Object.entries(all.weapon)) {
    const data = weaponStats(d)
    dumpFile(join(STATS, `Data/Weapons/${capital(data.weaponType)}/${key}/data.json`), data)
    allStat.weapon.data[key] = data
    const assets = weaponAssets(d)
    assetsData.weapons[key] = assets
    for (const icon of Object.values(assets)) await saveIcon(icon, join(GEN, 'weapons', key))
    const loc = weaponLocale(key, d)
    dumpFile(join(LOC, `weapon_${key}_gen.json`), loc)
    names.weapon[key] = loc.name
  }
  for (const [key, d] of Object.entries(all.artifact)) {
    const data = artifactStats(d)
    artSets[key] = data
    allStat.art.data[key] = data
    const assets = artifactAssets(d)
    assetsData.artifacts[key] = assets
    for (const icon of Object.values(assets)) await saveIcon(icon as string, join(GEN, 'artifacts', key))
    const loc = artifactLocale(d)
    dumpFile(join(LOC, `artifact_${key}_gen.json`), loc)
    names.artifact[key] = loc.setName
  }
  dumpFile(join(STATS, 'Data/Artifacts/artifact_set.json'), artSets)
  dumpFile(join(STATS, 'src/allStat_gen.json'), allStat)
  dumpFile(join(GI, 'assets-data/src/AssetsData_gen.json'), assetsData)
  dumpFile(matsPath, mats)
  dumpFile(join(LOC, 'charNames_gen.json'), names.char)
  dumpFile(join(LOC, 'weaponNames_gen.json'), names.weapon)
  dumpFile(join(LOC, 'artifactNames_gen.json'), names.artifact)
  await generateIndexFromObj(assetsData, GEN)
  console.log('Contenuti beta generati:', Object.keys(all.character), Object.keys(all.weapon), Object.keys(all.artifact))
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
