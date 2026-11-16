// juanlab: build salvate su Akasha (akasha.cv) convertite in GOOD, con piu build per personaggio.
// Akasha conserva ogni build che un personaggio ha avuto in vetrina (anche quelle di personaggi non piu in vetrina):
// /api/builds/?uid= da personaggio, arma e talenti di ogni build, /api/artifacts/<uid>/<md5> i suoi 5 manufatti.
// Entrambi passano dal Worker di JuanLab (Akasha non permette chiamate dirette dal browser di altri siti).
//
// Ogni build di Akasha diventa una «Build» di Genshin Optimizer (arma + 5 manufatti), visibile nel menu delle build
// del personaggio nella pagina Squadre. La build «current» (quella in vetrina ora), o la piu recente, resta equipaggiata;
// le altre armi e gli altri manufatti entrano nell'inventario senza proprietario. Gli ID sono fissi (dall'md5 della build
// e dall'ID del manufatto su Akasha), cosi un nuovo import aggiorna le stesse build invece di duplicarle.
import type {
  ArtifactSetKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allArtifactSlotKeys,
  allWeaponKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import * as artifactMap from '../../../dm/src/mapping/artifact'
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import { weaponIdMap } from '../../../dm/src/mapping/weapon'
import type { EnkaAvatarStore, EnkaSkipped } from './enkaToGood'
import { characterKeyOf, ENKA_PROXY } from './enkaToGood'

const { artifactIdMap, artifactSlotMap } = artifactMap

export type AkashaBuild = {
  _id?: string
  characterId: number
  skillDepotId?: number
  type?: string
  name?: string
  md5: string
  constellation?: number
  lastBuildUpdate?: number
  propMap?: { level?: { val?: string }; ascension?: { val?: string } }
  talentsLevelMap?: Record<
    'normalAttacks' | 'elementalSkill' | 'elementalBurst',
    { rawLevel?: number; level?: number } | undefined
  >
  weapon?: {
    weaponId?: number
    name?: string
    weaponInfo?: {
      level?: number
      promoteLevel?: number
      refinementLevel?: { value?: number }
    }
  }
}
export type AkashaArtifact = {
  _id?: string
  setName?: string
  stars?: number
  mainStatKey?: string
  equipType?: string
  level?: number
  icon?: string
  substats?: Record<string, number>
}
export type AkashaData = {
  builds: AkashaBuild[]
  artifacts: Record<string, AkashaArtifact[]> // per md5 della build
}

// Errore di Akasha (o del Worker) con lo stato HTTP: il testo per l'utente sta nelle traduzioni (import.akashaErrors)
export class AkashaError extends Error {
  status: number
  constructor(status: number) {
    super(`Akasha ${status}`)
    this.status = status
  }
}

async function getJson(path: string) {
  const res = await fetch(ENKA_PROXY + path)
  if (!res.ok) throw new AkashaError(res.status)
  const body = await res.json()
  return body?.data ?? body
}

/** Tutte le build salvate dell'UID, con i manufatti di ognuna. onProgress: build lette finora, totale. */
export async function fetchAkasha(
  uid: string,
  onProgress?: (done: number, total: number) => void
): Promise<AkashaData> {
  const builds: AkashaBuild[] = []
  const seen = new Set<string>()
  let pageSize = 0
  for (let page = 1; page <= 20; page++) {
    const rows: AkashaBuild[] = await getJson(
      `akasha/builds/${uid}?page=${page}`
    )
    if (!Array.isArray(rows) || !rows.length) break
    pageSize ||= rows.length
    const fresh = rows.filter((row) => row?.md5 && !seen.has(row.md5))
    fresh.forEach((row) => seen.add(row.md5))
    builds.push(...fresh)
    // Una pagina corta e l'ultima; una pagina senza build nuove vuol dire che Akasha ha ignorato il numero di pagina.
    if (rows.length < pageSize || !fresh.length) break
  }
  const artifacts: Record<string, AkashaArtifact[]> = {}
  let done = 0
  onProgress?.(0, builds.length)
  // Poche alla volta: gentile con Akasha e comunque veloce per qualche decina di build.
  const queue = [...builds]
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let build = queue.shift(); build; build = queue.shift()) {
        const list = await getJson(`akasha/artifacts/${uid}/${build.md5}`)
        artifacts[build.md5] = Array.isArray(list) ? list : []
        onProgress?.(++done, builds.length)
      }
    })
  )
  return { builds, artifacts }
}

/* ---------- conversione ---------- */
const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
const ELEMENT_BONUS: Record<string, MainStatKey> = {
  pyro: 'pyro_dmg_',
  hydro: 'hydro_dmg_',
  dendro: 'dendro_dmg_',
  electro: 'electro_dmg_',
  anemo: 'anemo_dmg_',
  cryo: 'cryo_dmg_',
  geo: 'geo_dmg_',
  physical: 'physical_dmg_',
}
// Nomi delle statistiche di Akasha ("Flat ATK", "ATK%", "Crit RATE", "Pyro DMG Bonus"…), senza maiuscole e spazi.
const STAT: Record<string, MainStatKey | SubstatKey> = {
  flathp: 'hp',
  hp: 'hp_',
  flatatk: 'atk',
  atk: 'atk_',
  flatdef: 'def',
  def: 'def_',
  elementalmastery: 'eleMas',
  energyrecharge: 'enerRech_',
  critrate: 'critRate_',
  critdmg: 'critDMG_',
  healingbonus: 'heal_',
  ...Object.fromEntries(
    Object.entries(ELEMENT_BONUS).map(([element, key]) => [
      `${element}dmgbonus`,
      key,
    ])
  ),
}
const statKey = (name = '') =>
  STAT[fold(name.replace('%', ''))] ??
  (name.endsWith('%') ? undefined : STAT[`flat${fold(name)}`])
const SET_BY_NAME = Object.fromEntries(
  allArtifactSetKeys.map((key) => [fold(key), key])
) as Record<string, ArtifactSetKey>
const WEAPON_BY_NAME = Object.fromEntries(
  allWeaponKeys.map((key) => [fold(key), key])
) as Record<string, WeaponKey>

function setKeyOf(a: AkashaArtifact): ArtifactSetKey | undefined {
  const id = Number(a.icon?.match(/UI_RelicIcon_(\d+)_/)?.[1])
  return (
    (id && artifactIdMap[id as keyof typeof artifactIdMap]) ||
    SET_BY_NAME[fold(a.setName ?? '')]
  )
}

function substatsOf(substats: Record<string, number> = {}) {
  const list = Object.entries(substats)
    .map(([name, value]) => ({ key: statKey(name) as SubstatKey, value }))
    .filter((s) => s.key && Number.isFinite(s.value))
  // Akasha da le % in punti (10.5); se un profilo arrivasse in frazioni (0.105), ogni valore in % sarebbe sotto 1.
  const percents = list.filter((s) => s.key.endsWith('_'))
  const fractions = percents.length > 0 && percents.every((s) => s.value < 1)
  return list.map(({ key, value }) => {
    const shown = key.endsWith('_') && fractions ? value * 100 : value
    return {
      key,
      value: key.endsWith('_')
        ? Math.round(shown * 10) / 10
        : Math.round(shown),
    }
  })
}

const recency = (b: AkashaBuild) =>
  (b.type === 'current' ? 1e15 : 0) +
  // A volte Akasha mette qui un altro numero (per esempio 252.6): contano solo le date vere.
  ((b.lastBuildUpdate ?? 0) > 1e12 ? (b.lastBuildUpdate as number) : 0)

export type AkashaImport = {
  good: {
    format: 'GOOD'
    source: string
    version: 2
    characters: unknown[]
    weapons: unknown[]
    artifacts: unknown[]
    builds: unknown[]
  }
  imported: CharacterKey[]
  builds: number
  skipped: EnkaSkipped[]
}

export function akashaToGood(
  data: AkashaData,
  store: EnkaAvatarStore
): AkashaImport {
  const characters: unknown[] = []
  const weapons = new Map<string, Record<string, unknown>>()
  const artifacts = new Map<string, Record<string, unknown>>()
  const builds: unknown[] = []
  const skipped: EnkaSkipped[] = []
  const imported: CharacterKey[] = []

  const byCharacter = new Map<CharacterKey, AkashaBuild[]>()
  for (const build of data.builds) {
    const key = characterKeyOf(
      { avatarId: build.characterId, skillDepotId: build.skillDepotId },
      store
    )
    if (!key) {
      skipped.push({ kind: 'char', id: build.characterId })
      continue
    }
    byCharacter.set(key, [...(byCharacter.get(key) ?? []), build])
  }

  for (const [key, list] of byCharacter) {
    list.sort((a, b) => recency(b) - recency(a))
    const [main] = list
    const location = charKeyToLocCharKey(key)
    const talent = (t?: { rawLevel?: number; level?: number }) =>
      t?.rawLevel ?? t?.level ?? 1
    imported.push(key)
    characters.push({
      key,
      level: Number(main.propMap?.level?.val ?? 1),
      ascension: Number(main.propMap?.ascension?.val ?? 0),
      constellation: main.constellation ?? 0,
      talent: {
        auto: talent(main.talentsLevelMap?.normalAttacks),
        skill: talent(main.talentsLevelMap?.elementalSkill),
        burst: talent(main.talentsLevelMap?.elementalBurst),
      },
    })

    list.forEach((build, index) => {
      const equipped = index === 0
      // Arma: una per personaggio per ogni arma diversa (stessa arma, livello e raffinamento = stesso oggetto)
      let weaponId: string | undefined
      const w = build.weapon
      const weaponKey: WeaponKey | undefined =
        (w?.weaponId && weaponIdMap[w.weaponId as keyof typeof weaponIdMap]) ||
        WEAPON_BY_NAME[fold(w?.name ?? '')]
      if (weaponKey) {
        const level = w?.weaponInfo?.level ?? 1
        const ascension = w?.weaponInfo?.promoteLevel ?? 0
        const refinement = (w?.weaponInfo?.refinementLevel?.value ?? 0) + 1
        weaponId = `weapon_akasha_${key}_${weaponKey}_${level}_${ascension}_${refinement}`
        const known = weapons.get(weaponId)
        if (!known)
          weapons.set(weaponId, {
            id: weaponId,
            key: weaponKey,
            level,
            ascension,
            refinement,
            location: equipped ? location : '',
            lock: false,
          })
        else if (equipped) known['location'] = location
      } else if (w?.weaponId) skipped.push({ kind: 'weapon', id: w.weaponId })

      const artifactIds: Record<string, string | undefined> = {}
      for (const a of data.artifacts[build.md5] ?? []) {
        const setKey = setKeyOf(a)
        const slotKey =
          artifactSlotMap[a.equipType as keyof typeof artifactSlotMap]
        const mainStatKey = statKey(a.mainStatKey) as MainStatKey | undefined
        if (!setKey || !slotKey || !mainStatKey) {
          skipped.push({
            kind: 'artifact',
            id: Number(a.icon?.match(/UI_RelicIcon_(\d+)_/)?.[1]) || 0,
          })
          continue
        }
        const id = `artifact_akasha_${(a._id ?? `${build.md5}_${slotKey}`).replace(/[^A-Za-z0-9_]/g, '')}`
        artifactIds[slotKey] = id
        const known = artifacts.get(id)
        if (known) {
          if (equipped) known['location'] = location
          continue
        }
        artifacts.set(id, {
          id,
          setKey,
          slotKey,
          level: Math.max(0, (a.level ?? 1) - 1),
          rarity: a.stars ?? 5,
          mainStatKey,
          location: equipped ? location : '',
          lock: false,
          substats: substatsOf(a.substats),
        })
      }
      builds.push({
        id: `build_akasha_${build.md5}`,
        name:
          build.type && build.type !== 'current'
            ? build.type
            : `${build.name ?? key} (Akasha)`,
        description: `Akasha · ${build.md5}`,
        characterKey: key,
        weaponId,
        artifactIds: Object.fromEntries(
          allArtifactSlotKeys.map((slot) => [slot, artifactIds[slot]])
        ),
      })
    })
  }

  return {
    good: {
      format: 'GOOD',
      // La sorgente di Genshin Optimizer stesso: l'import mantiene gli ID, a cui puntano le build.
      source: 'Genshin Optimizer',
      version: 2,
      characters,
      weapons: [...weapons.values()],
      artifacts: [...artifacts.values()],
      builds,
    },
    imported,
    builds: builds.length,
    skipped,
  }
}
