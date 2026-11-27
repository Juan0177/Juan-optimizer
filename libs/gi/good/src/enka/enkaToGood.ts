import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import type {
  IArtifact,
  ICharacter,
  IWeapon,
} from '@genshin-optimizer/gi/schema'
import type { IGOOD } from '../schemas/good-format'
import * as enkaData from './enkaData_gen.json'

/** The parts of an Enka.Network showcase (`/api/uid/{uid}/`) read here */
export interface EnkaShowcase {
  uid?: string
  ttl?: number
  playerInfo?: { nickname?: string; level?: number; worldLevel?: number }
  avatarInfoList?: EnkaAvatar[]
}
export interface EnkaAvatar {
  avatarId: number
  skillDepotId?: number
  propMap?: Record<string, { val?: string }>
  talentIdList?: number[]
  skillLevelMap?: Record<string, number>
  equipList?: EnkaEquip[]
}
interface EnkaEquip {
  itemId: number
  weapon?: {
    level?: number
    promoteLevel?: number
    affixMap?: Record<string, number>
  }
  reliquary?: { level?: number }
  flat?: {
    rankLevel?: number
    setId?: number
    equipType?: string
    reliquaryMainstat?: { mainPropId?: string }
    reliquarySubstats?: { appendPropId?: string; statValue?: number }[]
  }
}

export interface EnkaImport {
  good: IGOOD
  /** The showcase's characters this app has, in showcase order */
  characters: CharacterKey[]
  /** Showcase entries left out: characters, weapons or sets this app doesn't have yet */
  skipped: { avatarId: number; item: 'character' | 'weapon' | 'artifact' }[]
  /** The Traveler's, when one is shown */
  gender?: 'F' | 'M'
}

type Ids = {
  characters: Record<string, number[]>
  travelers: Record<string, number[][]>
  weapons: Record<string, number>
  artifactSets: Record<string, number>
}
const ids = enkaData as unknown as Ids
const invert = <K extends string>(map: Record<string, number>) =>
  new Map(Object.entries(map).map(([key, id]) => [id, key as K]))

let lookups:
  | {
      characters: Map<number, CharacterKey>
      travelers: Map<number, CharacterKey>
      talents: Map<number, number[]>
      weapons: Map<number, WeaponKey>
      sets: Map<number, ArtifactSetKey>
    }
  | undefined
function tables() {
  if (lookups) return lookups
  const characters = new Map<number, CharacterKey>()
  const travelers = new Map<number, CharacterKey>()
  const talents = new Map<number, number[]>()
  for (const [key, [avatarId, depotId, ...skills]] of Object.entries(
    ids.characters
  )) {
    characters.set(avatarId, key as CharacterKey)
    talents.set(depotId, skills)
  }
  for (const [key, list] of Object.entries(ids.travelers))
    for (const [depotId, ...skills] of list) {
      travelers.set(depotId, key as CharacterKey)
      talents.set(depotId, skills)
    }
  lookups = {
    characters,
    travelers,
    talents,
    weapons: invert<WeaponKey>(ids.weapons),
    sets: invert<ArtifactSetKey>(ids.artifactSets),
  }
  return lookups
}

const TRAVELER_GENDER: Record<number, 'F' | 'M'> = {
  10000005: 'M',
  10000007: 'F',
}
const SLOT: Record<string, ArtifactSlotKey> = {
  EQUIP_BRACER: 'flower',
  EQUIP_NECKLACE: 'plume',
  EQUIP_SHOES: 'sands',
  EQUIP_RING: 'goblet',
  EQUIP_DRESS: 'circlet',
}
const STAT: Record<string, MainStatKey | SubstatKey> = {
  FIGHT_PROP_HP: 'hp',
  FIGHT_PROP_HP_PERCENT: 'hp_',
  FIGHT_PROP_ATTACK: 'atk',
  FIGHT_PROP_ATTACK_PERCENT: 'atk_',
  FIGHT_PROP_DEFENSE: 'def',
  FIGHT_PROP_DEFENSE_PERCENT: 'def_',
  FIGHT_PROP_ELEMENT_MASTERY: 'eleMas',
  FIGHT_PROP_CHARGE_EFFICIENCY: 'enerRech_',
  FIGHT_PROP_HEAL_ADD: 'heal_',
  FIGHT_PROP_CRITICAL: 'critRate_',
  FIGHT_PROP_CRITICAL_HURT: 'critDMG_',
  FIGHT_PROP_PHYSICAL_ADD_HURT: 'physical_dmg_',
  FIGHT_PROP_FIRE_ADD_HURT: 'pyro_dmg_',
  FIGHT_PROP_ELEC_ADD_HURT: 'electro_dmg_',
  FIGHT_PROP_WATER_ADD_HURT: 'hydro_dmg_',
  FIGHT_PROP_WIND_ADD_HURT: 'anemo_dmg_',
  FIGHT_PROP_ICE_ADD_HURT: 'cryo_dmg_',
  FIGHT_PROP_ROCK_ADD_HURT: 'geo_dmg_',
  FIGHT_PROP_GRASS_ADD_HURT: 'dendro_dmg_',
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * An Enka.Network showcase as a GOOD import: each shown character this app has (level, ascension,
 * constellation, talent levels without constellation bonuses) with the weapon and artifacts it
 * wears. Locks are unknown, so everything comes unlocked (an import keeps a matching item's lock).
 */
export function enkaToGood(showcase: EnkaShowcase): EnkaImport {
  const t = tables()
  const characters: ICharacter[] = []
  const weapons: IWeapon[] = []
  const artifacts: IArtifact[] = []
  const skipped: EnkaImport['skipped'] = []
  let gender: EnkaImport['gender']
  for (const avatar of showcase.avatarInfoList ?? []) {
    const travelerGender = TRAVELER_GENDER[avatar.avatarId]
    const key = travelerGender
      ? t.travelers.get(avatar.skillDepotId ?? 0)
      : t.characters.get(avatar.avatarId)
    if (!key) {
      skipped.push({ avatarId: avatar.avatarId, item: 'character' })
      continue
    }
    if (travelerGender) gender = travelerGender
    const [normal, skill, burst] = t.talents.get(avatar.skillDepotId ?? 0) ?? []
    const talent = (id: number | undefined) =>
      (id !== undefined && avatar.skillLevelMap?.[id]) || 1
    characters.push({
      key,
      level: num(avatar.propMap?.['4001']?.val, 1),
      ascension: num(
        avatar.propMap?.['1002']?.val,
        0
      ) as ICharacter['ascension'],
      constellation: avatar.talentIdList?.length ?? 0,
      talent: {
        auto: talent(normal),
        skill: talent(skill),
        burst: talent(burst),
      },
    })
    const location = charKeyToLocCharKey(key)
    for (const equip of avatar.equipList ?? []) {
      if (equip.weapon) {
        const weaponKey = t.weapons.get(equip.itemId)
        if (!weaponKey) {
          skipped.push({ avatarId: avatar.avatarId, item: 'weapon' })
          continue
        }
        const affix = Object.values(equip.weapon.affixMap ?? {})[0] ?? 0
        weapons.push({
          key: weaponKey,
          level: equip.weapon.level ?? 1,
          ascension: (equip.weapon.promoteLevel ?? 0) as IWeapon['ascension'],
          refinement: (affix + 1) as IWeapon['refinement'],
          location,
          lock: false,
        })
        continue
      }
      if (!equip.reliquary || !equip.flat) continue
      const { flat } = equip
      const setKey = t.sets.get(flat.setId ?? 0)
      const slotKey = SLOT[flat.equipType ?? '']
      const mainStatKey = STAT[flat.reliquaryMainstat?.mainPropId ?? '']
      if (!setKey || !slotKey || !mainStatKey) {
        skipped.push({ avatarId: avatar.avatarId, item: 'artifact' })
        continue
      }
      artifacts.push({
        setKey,
        slotKey,
        level: Math.max(0, (equip.reliquary.level ?? 1) - 1),
        rarity: (flat.rankLevel ?? 5) as IArtifact['rarity'],
        mainStatKey: mainStatKey as MainStatKey,
        location,
        lock: false,
        substats: (flat.reliquarySubstats ?? []).flatMap(
          ({ appendPropId, statValue }) => {
            const statKey = STAT[appendPropId ?? '']
            return statKey && statValue !== undefined
              ? [{ key: statKey as SubstatKey, value: statValue }]
              : []
          }
        ),
      })
    }
  }
  return {
    good: {
      format: 'GOOD',
      source: 'Enka.Network',
      version: 3,
      characters,
      weapons,
      artifacts,
    },
    characters: characters.map((c) => c.key),
    skipped,
    ...(gender ? { gender } : {}),
  }
}
