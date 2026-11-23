import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { KqmResult, RunAttackState } from '@genshin-optimizer/gi/ui'
import { optimizeTeamKqm, teamOptMembers } from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { kqmRotationEnergyOf, teamCalculator } from './kqmEnergy'
import { kqmReplayOf } from './useKqmRun'

/**
 * How a rotation a search found gets its own KQM builds (`kqmRotationRun`'s, unless given: KQM
 * Compare's team B searches only its entering member, as the comparison does)
 */
export type RotationConfirm = (
  text: string,
  options: {
    attackStates?: readonly RunAttackState[]
    isCancelled: () => boolean
  }
) => Promise<KqmResult | undefined>

/** A KQM result's team DPS, as the KQM tab shows it */
export const kqmResultDps = (result: KqmResult) => {
  const time = result.played?.rotationTime
  return time ? result.after.total / time : 0
}

/**
 * KQM builds for another rotation, as "Generate builds" would find them once it is written: a
 * KQM run with the settings of `teamOpt`'s, the rotation played instead of the written one and,
 * with ER from the calculator, the calculator filled from that rotation as played. Nothing is
 * saved.
 */
export async function kqmRotationRun({
  database,
  gender,
  i18n,
  teamId,
  teamOpt,
  text,
  attackStates,
  isCancelled,
}: {
  database: ArtCharDatabase
  gender: GenderKey
  i18n: i18n
  teamId: string
  teamOpt: TeamOpt
  text: string
  attackStates?: readonly RunAttackState[]
  isCancelled?: () => boolean
}): Promise<KqmResult | undefined> {
  let runTeamOpt = teamOpt
  const kqm = teamOpt.kqm
  if (kqm?.energySource === 'calculator') {
    const members = teamOptMembers(database, teamId)
    const { energy, rotationTime } = kqmRotationEnergyOf(
      database,
      gender,
      i18n,
      teamId,
      teamOpt,
      members,
      text
    )
    if (energy)
      runTeamOpt = {
        ...teamOpt,
        kqm: {
          ...kqm,
          energyCalculator: {
            ...teamCalculator(members, teamOpt, kqm.energyCalculator, energy),
            rotationTime:
              rotationTime ??
              kqm.energyCalculator?.rotationTime ??
              teamOpt.rotationTime ??
              20,
          },
        },
      }
  }
  return optimizeTeamKqm({
    database,
    teamId,
    gender,
    teamOpt: runTeamOpt,
    replay: kqmReplayOf(database, gender, i18n, teamId, runTeamOpt, text),
    attackStates,
    isCancelled,
  })
}
