import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { nextPaint } from '@genshin-optimizer/gi/solver'
import { type BonusStats, teamOptMembers } from './data'
import type { RunAttackState } from './lowHpUptime'
import type {
  FrameData,
  RotationMember,
  RotationTimingSettings,
} from './rotation'
import { writtenTeamReplay } from './rotationSearchTeam'
import { type TeamOptStatus, teamOptSolver } from './runSolver'
import {
  optimizeTeam,
  type TeamOptMemberOptions,
  type TeamOptResult,
  teamOptRunGear,
} from './solve'
import { simTeamOf } from './writtenRotation'

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

function runAttacks(
  database: ArtCharDatabase,
  { teamId, gender, teamOpt, rotation }: TeamOptRunJob
): TeamOpt['attacks'] | undefined {
  if (!rotation) return undefined
  try {
    const members = teamOptMembers(database, teamId)
    return writtenTeamReplay({
      database,
      teamId,
      members,
      gender,
      teamOpt,
      ...rotation,
    })?.({
      gear: teamOptRunGear(
        database,
        teamId,
        teamOpt,
        simTeamOf(members, database).gear
      ),
      overrides: {},
    }).attacks
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
  const attacks = runAttacks(database, job)
  let lastPaint = performance.now()
  const result = await optimizeTeam({
    database,
    teamId,
    gender,
    teamOpt: attacks ? { ...teamOpt, attacks } : teamOpt,
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
    onResult: (result) => onResult(attacks ? { ...result, attacks } : result),
    onOptions,
  })
  if (!result) throw new Error('The team could not be computed.')
}
