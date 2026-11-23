import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamDataOverrides } from './data'
import { teamOptMembers } from './data'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  withRotationEnergy,
} from './energyCalc'
import { rotationDamage } from './objective'
import type {
  FrameData,
  RotationMember,
  RotationTimingSettings,
  SimGear,
} from './rotation'
import { rotationCalculation } from './rotationCalculation'
import type { RotationScore } from './rotationSearch'
import { writtenKqmReplay } from './writtenRotation'

/**
 * What a rotation search plays its rotations with: the KQM tab's saved opener, timing and frame
 * data, and the builds shown (`kqmRotationSearchSetup`): their constellations, gear and
 * calculation data. Plain data, so a worker gets it as it is.
 */
export interface RotationSearchSetup {
  teamId: string
  gender: GenderKey
  names: RotationMember[]
  teamOpt: TeamOpt
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  constellations: Partial<Record<CharacterKey, number>>
  gear: Partial<Record<CharacterKey, SimGear>>
  /** The builds as team data (`kqmTeamOverrides`) */
  overrides: TeamDataOverrides
}

/**
 * How much of the stats and damage a player keeps before they start over, in characters of their
 * keys (a player of a full search, one of eight in the tab, would fill the tab's memory)
 */
const KEPT_CHARS = 40_000_000
/** What an attack's damage kept counts as, in characters: its hashed key and the entry */
const DAMAGE_ENTRY = 100

/** A 128-bit hash of a string (cyrb128) */
function hash128(text: string) {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  return `${(h1 >>> 0).toString(36)}.${((h2 ^ h1) >>> 0).toString(36)}.${((h3 ^ h1) >>> 0).toString(36)}.${((h4 ^ h1) >>> 0).toString(36)}`
}

/**
 * Damage by attack, kept by a hash of its key: the key has the attack's states, kilobytes with
 * many, and a search plays tens of thousands
 */
class DamageKept extends Map<string, number> {
  override get(key: string) {
    return super.get(hash128(key))
  }
  override has(key: string) {
    return super.has(hash128(key))
  }
  override set(key: string, value: number) {
    return super.set(hash128(key), value)
  }
}

/**
 * A rotation search's player: a written rotation played as the KQM tab plays it, with the
 * setup's builds, and its DPS, Energy Recharge needs and warnings. The stats the simulation reads
 * and each attack's damage are kept across the rotations it plays (`kept` characters of them).
 */
export function rotationScorer(
  database: ArtCharDatabase,
  setup: RotationSearchSetup,
  kept = KEPT_CHARS
) {
  const { teamId, gender, names, teamOpt, gear, overrides } = setup
  const members = teamOptMembers(database, teamId)
  const keys = members.map((m) => m.characterKey)
  const weapons = Object.fromEntries(
    Object.entries(gear).flatMap(([k, g]) => (g?.weapon ? [[k, g.weapon]] : []))
  )
  const refinements = Object.fromEntries(
    Object.entries(gear).map(([k, g]) => [k, g?.refinement])
  )
  const sets = Object.fromEntries(
    Object.entries(gear).map(([k, g]) => [k, g?.sets])
  )
  let calculate = rotationCalculation(database, teamId, gender, overrides)
  let damage = new DamageKept()
  return (text: string): RotationScore | undefined => {
    if (damage.size * DAMAGE_ENTRY + calculate.kept() > kept) {
      calculate = rotationCalculation(database, teamId, gender, overrides)
      damage = new DamageKept()
    }
    const warnings: string[] = []
    const played = writtenKqmReplay({
      database,
      teamId,
      members,
      gender,
      names,
      teamOpt,
      text,
      opener: setup.opener,
      timing: setup.timing,
      frameData: setup.frameData,
      warnings,
    })?.({
      constellations: setup.constellations,
      gear,
      overrides,
      calculate,
    })
    const time = played?.rotationTime
    if (!played || !time) return undefined
    const total =
      rotationDamage(
        database,
        teamId,
        gender,
        { ...overrides, arts: overrides.arts ?? {}, attacks: played.attacks },
        damage
      )?.total ?? 0
    const er = played.energy
      ? calculateEnergyRecharge(
          keys,
          withRotationEnergy(
            defaultEnergyCalculator(keys, time),
            keys,
            played.energy
          ),
          weapons as never,
          refinements as never,
          sets as never
        ).targets
      : {}
    return {
      dps: total / time,
      time,
      er: Object.fromEntries(
        Object.entries(er).map(([k, v]) => [k, Math.round(v as number)])
      ),
      warnings: [...new Set(warnings)],
      waits: played.stalls,
    }
  }
}
