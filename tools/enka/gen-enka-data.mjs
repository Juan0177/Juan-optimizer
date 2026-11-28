// Writes libs/gi/good/src/enka/enkaData_gen.json: what an Enka.Network showcase's game ids are in this
// app, keyed by the app's own keys (so the released build drops the beta items' entries):
//   characters:   key → [avatarId, skillDepotId, Normal Attack id, Skill id, Burst id]
//   travelers:    TravelerAnemo… → [[skillDepotId, Normal Attack id, Skill id, Burst id], …]
//   weapons:      key → weapon id
//   artifactSets: key → set id
// From the id maps in libs/gi/dm/src/mapping and the game dump's skill depots. Run it after a dump
// import adds characters, weapons or sets:
//   node tools/enka/gen-enka-data.mjs [path to YuanShenResources]
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DUMP = resolve(
  process.argv[2] ?? join(homedir(), 'Experiments/gens/YuanShenResources')
)
const OUT = join(ROOT, 'libs/gi/good/src/enka/enkaData_gen.json')

const excel = (name) =>
  JSON.parse(readFileSync(join(DUMP, 'ExcelBinOutput', `${name}.json`), 'utf8'))
/** `12345: 'Key',` entries of a mapping file (commented-out ones left out) */
function idMap(file) {
  const text = readFileSync(join(ROOT, 'libs/gi/dm/src/mapping', file), 'utf8')
  return [...text.matchAll(/^\s*(\d+):\s*'(\w+)'/gm)].map(([, id, key]) => [
    Number(id),
    key,
  ])
}
const sorted = (entries) =>
  Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))

const avatars = new Map(excel('AvatarExcelConfigData').map((a) => [a.id, a]))
const depots = new Map(
  excel('AvatarSkillDepotExcelConfigData').map((d) => [d.id, d])
)
const skills = new Map(
  excel('AvatarSkillExcelConfigData').map((s) => [s.id, s])
)
const ELEMENT = {
  Fire: 'Pyro',
  Water: 'Hydro',
  Wind: 'Anemo',
  Ice: 'Cryo',
  Rock: 'Geo',
  Electric: 'Electro',
  Grass: 'Dendro',
}
const talentIds = (depot) => [
  depot.skills[0],
  depot.skills[1],
  depot.energySkill,
]

const characters = []
const travelers = new Map()
const missing = []
for (const [id, key] of idMap('character.ts')) {
  const avatar = avatars.get(id)
  if (!avatar) {
    missing.push(key)
    continue
  }
  if (key === 'TravelerM' || key === 'TravelerF') {
    for (const depotId of avatar.candSkillDepotIds ?? []) {
      const depot = depots.get(depotId)
      const element =
        depot?.energySkill &&
        ELEMENT[skills.get(depot.energySkill)?.costElemType]
      if (!element) continue
      const list = travelers.get(`Traveler${element}`) ?? []
      list.push([depotId, ...talentIds(depot)])
      travelers.set(`Traveler${element}`, list)
    }
    continue
  }
  const depot = depots.get(avatar.skillDepotId)
  if (!depot?.energySkill) {
    missing.push(key)
    continue
  }
  characters.push([key, [id, depot.id, ...talentIds(depot)]])
}

const data = {
  characters: sorted(characters),
  travelers: sorted([...travelers]),
  weapons: sorted(idMap('weapon.ts').map(([id, key]) => [key, id])),
  artifactSets: sorted(idMap('artifact.ts').map(([id, key]) => [key, id])),
}
writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`)
console.log(
  `${OUT}: ${characters.length} characters, ${travelers.size} Traveler elements, ` +
    `${Object.keys(data.weapons).length} weapons, ${Object.keys(data.artifactSets).length} sets` +
    (missing.length ? `; not in the dump: ${missing.join(', ')}` : '')
)
