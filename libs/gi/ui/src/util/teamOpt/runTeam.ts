import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedWeapon,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { nextPaint } from '@genshin-optimizer/gi/solver'
import { type BonusStats, teamOptMembers } from './data'
import type { RunAttackState } from './lowHpUptime'
import type {
  FrameData,
  RotationMember,
  RotationTimingSettings,
} from './rotation'
import { isSacrificialWeapon } from './rotation'
import { rotationWeaponKey } from './rotation/gearEffects'
import { rotationCalculation } from './rotationCalculation'
import { writtenTeamReplay } from './rotationSearchTeam'
import { type TeamOptStatus, teamOptSolver } from './runSolver'
import {
  optimizeTeam,
  type TeamOptMemberOptions,
  type TeamOptResult,
  teamOptRunGear,
} from './solve'
import { simTeamOf } from './writtenRotation'

const ROTATION_CALCULATION_CACHE_CHARS = 4_000_000

export interface TeamOptRunRotation {
  names: RotationMember[]
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
}

export interface TeamOptRunJob {
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  rotation?: TeamOptRunRotation
  attackStates?: readonly RunAttackState[]
  rankingBonusStats?: Partial<Record<CharacterKey, BonusStats>>
  maxWorkers: number
  lowImpact: boolean
}

export interface TeamOptRunUpdates {
  onResult: (result: TeamOptResult) => void
  onOptions: (characterKey: CharacterKey, options: TeamOptMemberOptions) => void
}

export function teamOptRotationForRun(
  database: ArtCharDatabase,
  {
    teamId,
    gender,
    teamOpt,
    rotation,
  }: Pick<TeamOptRunJob, 'teamId' | 'gender' | 'teamOpt' | 'rotation'>
) {
  if (!rotation) return undefined
  try {
    const members = teamOptMembers(database, teamId)
    const replay = writtenTeamReplay({
      database,
      teamId,
      members,
      gender,
      teamOpt,
      ...rotation,
      includeEnergy: false,
    })
    if (!replay) return undefined
    const gear = teamOptRunGear(
      database,
      teamId,
      teamOpt,
      simTeamOf(members, database).gear
    )
    // These replays use the same saved builds. Keep stat reads keyed by their exact
    // buff state and active member across candidate timelines.
    let calculate = rotationCalculation(database, teamId, gender)
    const play = (equipped: typeof gear) => {
      if (calculate.kept() > ROTATION_CALCULATION_CACHE_CHARS)
        calculate = rotationCalculation(database, teamId, gender)
      return replay({ gear: equipped, overrides: {}, calculate })
    }
    const base = play(gear)
    const wearers = members
      .map((m) => m.characterKey)
      .filter(
        (key) =>
          isSacrificialWeapon(gear[key]?.weapon) ||
          gear[key]?.candidates?.weapons?.some(isSacrificialWeapon)
      )
    if (!teamOpt.optimizeWeapons || !wearers.length) return { base }
    const cache = new Map<string, typeof base>()
    const signature = (weapons: typeof gear) =>
      JSON.stringify(wearers.map((key) => rotationWeaponKey(weapons[key])))
    cache.set(signature(gear), base)
    return {
      base,
      key: JSON.stringify([rotation, gear]),
      forWeapons(weapons: Partial<Record<CharacterKey, ICachedWeapon>>) {
        const next = { ...gear }
        for (const key of wearers) {
          const weapon = weapons[key]
          if (!weapon) continue
          next[key] = {
            ...next[key],
            weapon: weapon.key,
            refinement: weapon.refinement,
          }
        }
        const key = signature(next)
        const found = cache.get(key)
        if (found) {
          cache.delete(key)
          cache.set(key, found)
          return found
        }
        try {
          const played = play(next)
          cache.set(key, played)
          if (cache.size > 32) cache.delete(cache.keys().next().value!)
          return played
        } catch {
          return undefined
        }
      },
    }
  } catch {
    // Match the rotation writer: if the saved rotation cannot play, use its saved attacks.
    return undefined
  }
}

/** Run and rank from the same inventory snapshot and rotation. */
export async function runTeamOpt(
  database: ArtCharDatabase,
  job: TeamOptRunJob,
  status: TeamOptStatus,
  { onResult, onOptions }: TeamOptRunUpdates,
  isCancelled?: () => boolean,
  onSolver: (stop: (() => void) | undefined) => void = () => {}
) {
  const {
    teamId,
    gender,
    teamOpt,
    attackStates,
    rankingBonusStats,
    maxWorkers,
    lowImpact,
  } = job
  const rotation = teamOptRotationForRun(database, job)
  const attacks = rotation?.base.attacks
  let lastPaint = performance.now()
  const result = await optimizeTeam({
    database,
    teamId,
    gender,
    teamOpt: attacks ? { ...teamOpt, attacks } : teamOpt,
    rotationForWeapons: rotation?.forWeapons,
    rotationKey: rotation?.key,
    attackStates,
    rankingBonusStats,
    parallelWeaponSolves: lowImpact ? 1 : 3,
    solve: teamOptSolver(status, maxWorkers, onSolver, {
      responsive: true,
      lowImpact,
    }),
    isCancelled,
    onStep: async (step) => {
      status.step = step
      // Let the progress line paint between steps when the run falls back to the page.
      if (
        typeof document === 'undefined' ||
        performance.now() - lastPaint < 100
      )
        return
      await nextPaint()
      lastPaint = performance.now()
    },
    onResult: (result) =>
      onResult(
        attacks
          ? {
              ...result,
              attacks: result.attacks ?? attacks,
              ...(rotation?.forWeapons && { writtenRotation: job.rotation }),
            }
          : result
      ),
    onOptions,
  })
  if (!result) throw new Error('The team could not be computed.')
}
