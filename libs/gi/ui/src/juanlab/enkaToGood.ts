// juanlab: vetrina di Enka.network (letta tramite il Worker di JuanLab) convertita nel formato GOOD,
// che poi passa dall'import GOOD gia presente in Genshin Optimizer.
import type {
  ArtifactSetKey,
  CharacterKey,
  ElementKey,
  MainStatKey,
  SubstatKey,
  TravelerKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
// Solo le tabelle ID -> chiave del datamine: sono oggetti TypeScript puri (l'index di gi/dm usa il filesystem).
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import * as artifactMap from '../../../dm/src/mapping/artifact'
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import { characterIdMap } from '../../../dm/src/mapping/character'
// biome-ignore lint/style/noRestrictedImports: juanlab, solo le tabelle ID del datamine (l'index di gi/dm usa il filesystem)
import { weaponIdMap } from '../../../dm/src/mapping/weapon'

// Elemento della vetrina -> Viaggiatore di quell'elemento (nella base di Stellar Optimizer non e in gi/consts)
const travelerEleMap: Partial<Record<ElementKey, TravelerKey>> = {
  anemo: 'TravelerAnemo',
  geo: 'TravelerGeo',
  electro: 'TravelerElectro',
  dendro: 'TravelerDendro',
  hydro: 'TravelerHydro',
  pyro: 'TravelerPyro',
  cryo: 'TravelerCryo',
}
const { artifactIdMap, artifactSlotMap } = artifactMap

// Worker di JuanLab (Cloudflare): inoltra la richiesta a Enka.network, che non permette chiamate dirette dal browser
export const ENKA_PROXY = 'https://juanlab-enka.gianni-nacu-4055.workers.dev/'
// Ordine dei talenti (attacco normale, abilita, tecnica suprema) e elemento del Viaggiatore, dai dati pubblici di Enka
const ENKA_AVATARS =
  'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/avatars.json'

export const PROP: Record<string, MainStatKey | SubstatKey> = {
  FIGHT_PROP_HP: 'hp',
  FIGHT_PROP_HP_PERCENT: 'hp_',
  FIGHT_PROP_ATTACK: 'atk',
  FIGHT_PROP_ATTACK_PERCENT: 'atk_',
  FIGHT_PROP_DEFENSE: 'def',
  FIGHT_PROP_DEFENSE_PERCENT: 'def_',
  FIGHT_PROP_ELEMENT_MASTERY: 'eleMas',
  FIGHT_PROP_CHARGE_EFFICIENCY: 'enerRech_',
  FIGHT_PROP_CRITICAL: 'critRate_',
  FIGHT_PROP_CRITICAL_HURT: 'critDMG_',
  FIGHT_PROP_HEAL_ADD: 'heal_',
  FIGHT_PROP_PHYSICAL_ADD_HURT: 'physical_dmg_',
  FIGHT_PROP_FIRE_ADD_HURT: 'pyro_dmg_',
  FIGHT_PROP_WATER_ADD_HURT: 'hydro_dmg_',
  FIGHT_PROP_GRASS_ADD_HURT: 'dendro_dmg_',
  FIGHT_PROP_ELEC_ADD_HURT: 'electro_dmg_',
  FIGHT_PROP_WIND_ADD_HURT: 'anemo_dmg_',
  FIGHT_PROP_ICE_ADD_HURT: 'cryo_dmg_',
  FIGHT_PROP_ROCK_ADD_HURT: 'geo_dmg_',
}
const ENKA_ELEMENT: Record<string, ElementKey> = {
  Fire: 'pyro',
  Water: 'hydro',
  Wind: 'anemo',
  Electric: 'electro',
  Grass: 'dendro',
  Ice: 'cryo',
  Rock: 'geo',
}
// Viaggiatore senza dati di Enka: l'ultima cifra dello skillDepotId (es. 504, 704) indica l'elemento
const DEPOT_ELEMENT: Record<string, ElementKey> = {
  '2': 'pyro',
  '3': 'hydro',
  '4': 'anemo',
  '5': 'cryo',
  '6': 'geo',
  '7': 'electro',
  '8': 'dendro',
}

export type EnkaAvatarStore = Record<
  string,
  { Element?: string; SkillOrder?: number[] } | undefined
>
type EnkaEquip = {
  itemId: number
  weapon?: {
    level?: number
    promoteLevel?: number
    affixMap?: Record<string, number>
  }
  reliquary?: { level?: number; appendPropIdList?: number[] }
  flat: {
    itemType: string
    icon?: string
    equipType?: string
    rankLevel?: number
    setId?: number
    reliquaryMainstat?: { mainPropId: string; statValue: number }
    reliquarySubstats?: { appendPropId: string; statValue: number }[]
  }
}
export type EnkaAvatar = {
  avatarId: number
  skillDepotId?: number
  propMap?: Record<string, { val?: string }>
  talentIdList?: number[]
  constellation?: number // juanlab: dal server privato (gc-web) arriva il numero, non gli ID
  skillLevelMap?: Record<string, number>
  equipList?: EnkaEquip[]
}
export type EnkaResponse = {
  playerInfo?: { nickname?: string }
  avatarInfoList?: EnkaAvatar[]
}

export type EnkaSkipped = { kind: 'char' | 'weapon' | 'artifact'; id: number }
export type EnkaImport = {
  good: {
    format: 'GOOD'
    source: string
    version: 2
    characters: unknown[]
    weapons: unknown[]
    artifacts: unknown[]
  }
  nickname: string
  imported: CharacterKey[]
  skipped: EnkaSkipped[]
}

// Errore di Enka con lo stato HTTP: il testo per l'utente sta nelle traduzioni (namespace juanlab, import.errors)
export class EnkaError extends Error {
  status: number
  constructor(status: number) {
    super(`Enka.network ${status}`)
    this.status = status
  }
}

export async function fetchEnka(uid: string): Promise<EnkaResponse> {
  const res = await fetch(ENKA_PROXY + uid)
  if (!res.ok) throw new EnkaError(res.status)
  return res.json()
}

export async function fetchAvatarStore(): Promise<EnkaAvatarStore> {
  try {
    const res = await fetch(ENKA_AVATARS)
    return res.ok ? res.json() : {}
  } catch {
    return {}
  }
}

export function characterKeyOf(
  a: EnkaAvatar,
  store: EnkaAvatarStore
): CharacterKey | undefined {
  const key = characterIdMap[String(a.avatarId)]
  if (!key) return undefined
  if (key !== 'TravelerM' && key !== 'TravelerF') return key
  const info = store[`${a.avatarId}-${a.skillDepotId}`]
  const ele =
    (info?.Element && ENKA_ELEMENT[info.Element]) ||
    DEPOT_ELEMENT[String(a.skillDepotId ?? '').slice(-1)]
  return ele ? travelerEleMap[ele] : undefined
}

function talentsOf(a: EnkaAvatar, store: EnkaAvatarStore) {
  const levels = a.skillLevelMap ?? {}
  const info =
    store[`${a.avatarId}-${a.skillDepotId}`] ?? store[String(a.avatarId)]
  // Senza i dati di Enka: ID in ordine crescente (vale per quasi tutti i personaggi)
  const order =
    info?.SkillOrder?.filter((id) => levels[id] !== undefined) ??
    Object.keys(levels)
      .map(Number)
      .sort((x, y) => x - y)
  const [auto, skill, burst] = order.map((id) => levels[id] ?? 1)
  return { auto: auto ?? 1, skill: skill ?? 1, burst: burst ?? 1 }
}

export function enkaToGood(
  data: EnkaResponse,
  store: EnkaAvatarStore
): EnkaImport {
  const characters: unknown[] = []
  const weapons: unknown[] = []
  const artifacts: unknown[] = []
  const imported: CharacterKey[] = []
  const skipped: EnkaSkipped[] = []
  for (const a of data.avatarInfoList ?? []) {
    const key = characterKeyOf(a, store)
    if (!key) {
      skipped.push({ kind: 'char', id: a.avatarId })
      continue
    }
    const location = charKeyToLocCharKey(key)
    imported.push(key)
    characters.push({
      key,
      level: Number(a.propMap?.['4001']?.val ?? 1),
      ascension: Number(a.propMap?.['1002']?.val ?? 0),
      constellation: a.constellation ?? a.talentIdList?.length ?? 0,
      talent: talentsOf(a, store),
    })
    for (const e of a.equipList ?? []) {
      if (e.flat.itemType === 'ITEM_WEAPON') {
        const wKey: WeaponKey | undefined = weaponIdMap[e.itemId]
        if (!wKey) {
          skipped.push({ kind: 'weapon', id: e.itemId })
          continue
        }
        const affix = Object.values(e.weapon?.affixMap ?? {})[0] ?? 0
        weapons.push({
          key: wKey,
          level: e.weapon?.level ?? 1,
          ascension: e.weapon?.promoteLevel ?? 0,
          refinement: affix + 1,
          location,
          lock: false,
        })
      } else if (e.flat.itemType === 'ITEM_RELIQUARY') {
        const setId = e.flat.setId ?? Number(e.flat.icon?.split('_')[2])
        const setKey: ArtifactSetKey | undefined = artifactIdMap[setId]
        const slotKey =
          artifactSlotMap[e.flat.equipType as keyof typeof artifactSlotMap]
        const main = e.flat.reliquaryMainstat
        const mainStatKey = main && PROP[main.mainPropId]
        if (!setKey || !slotKey || !mainStatKey) {
          skipped.push({ kind: 'artifact', id: setId })
          continue
        }
        artifacts.push({
          setKey,
          slotKey,
          level: Math.max(0, (e.reliquary?.level ?? 1) - 1),
          rarity: e.flat.rankLevel ?? 5,
          mainStatKey,
          location,
          lock: false,
          substats: (e.flat.reliquarySubstats ?? [])
            .filter((s) => PROP[s.appendPropId])
            .map((s) => ({ key: PROP[s.appendPropId], value: s.statValue })),
        })
      }
    }
  }
  return {
    good: {
      format: 'GOOD',
      source: 'Juan-optimizer (Enka.network)',
      version: 2,
      characters,
      weapons,
      artifacts,
    },
    nickname: data.playerInfo?.nickname ?? '',
    imported,
    skipped,
  }
}
