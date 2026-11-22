import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamDataOverrides } from './data'
import { teamOptMembers } from './data'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  withRotationEnergy,
} from './energyCalc'
import type { RotationDamageCache } from './objective'
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
 * Rotations a player plays before the stats and damage it keeps start over: they grow with every
 * rotation, and a full search's hundred thousand would fill the tab's memory
 */
const PLAYS_KEPT = 4000

/**
 * A rotation search's player: a written rotation played as the KQM tab plays it, with the
 * setup's builds, and its DPS, Energy Recharge needs and warnings. The stats the simulation reads
 * and each attack's damage are kept across the rotations it plays (`PLAYS_KEPT` at a time).
 */
export function rotationScorer(
  database: ArtCharDatabase,
  setup: RotationSearchSetup
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
  let damage: RotationDamageCache = new Map()
  let plays = 0
  return (text: string): RotationScore | undefined => {
    if (++plays > PLAYS_KEPT) {
      plays = 1
      calculate = rotationCalculation(database, teamId, gender, overrides)
      damage = new Map()
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
