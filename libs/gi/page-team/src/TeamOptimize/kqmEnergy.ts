import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamOpt,
  TeamOptEnergyCalculator,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import type { RotationEnergy, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  kqmMemberConstellation,
  kqmWeapons,
  syncEnergyCalculator,
  withRotationEnergy,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { kqmEnergyEstimate } from './KqmEnergyCalculator'
import { kqmReplayOf } from './useKqmRun'

/**
 * The ER calculator's settings for the team as it is now: members added since get the starting
 * assumptions, at their KQM constellation (see `syncEnergyCalculator`)
 */
export function teamCalculator(
  members: TeamOptMember[],
  teamOpt: TeamOpt,
  saved: TeamOptEnergyCalculator | undefined,
  /** The written rotation's inputs, filled in where not set by hand */
  energy?: RotationEnergy
) {
  const keys = members.map((m) => m.characterKey)
  return withRotationEnergy(
    syncEnergyCalculator(
      keys,
      saved,
      teamOpt.rotationTime ?? 20,
      teamOpt.onField ?? keys[0],
      Object.fromEntries(
        keys.map((key) => [key, kqmMemberConstellation(key, teamOpt.kqm)])
      )
    ),
    keys,
    energy
  )
}

/**
 * The ER calculator's inputs as KQM plays the written rotation (at its constellations, each
 * member's KQM weapons as candidates, as a run plays them: an energy weapon's refunds count for the
 * weapon a build holds), and the rotation's length as played (s). Nothing written: none.
 */
export function kqmRotationEnergyOf(
  database: ArtCharDatabase,
  gender: GenderKey,
  i18n: i18n,
  teamId: string,
  teamOpt: TeamOpt,
  members: TeamOptMember[],
  /** Another rotation to play; absent: the team's written one */
  text?: string
): { energy?: RotationEnergy; rotationTime?: number } {
  try {
    const played = kqmReplayOf(
      database,
      gender,
      i18n,
      teamId,
      teamOpt,
      text
    )?.({
      constellations: Object.fromEntries(
        members.map((m) => [
          m.characterKey,
          kqmMemberConstellation(m.characterKey, teamOpt.kqm),
        ])
      ),
      gear: Object.fromEntries(
        members.map((m) => [
          m.characterKey,
          {
            candidates: {
              weapons: kqmWeapons(m.characterKey, teamOpt.kqm).map(
                (w) => w.key
              ),
            },
          },
        ])
      ),
      overrides: {},
    })
    return { energy: played?.energy, rotationTime: played?.rotationTime }
  } catch {
    return {}
  }
}

/**
 * How the KQM tab's Automatic ER targets follow its written rotation: they stay current when the
 * common rotation length or the rotation's inputs change, and apply by themselves once a rotation
 * is written (its energy worked out) for a team that never chose (Manual, chosen, stays Manual).
 * The settings to write, and for the calculator's a key that is the same for the same change
 * (none: nothing changes).
 */
export function kqmEnergyUpdate({
  members,
  teamOpt,
  written,
  ready,
  rotationEnergy,
  playedTime,
}: {
  members: TeamOptMember[]
  teamOpt: TeamOpt
  /** The written rotation as played (`playedRotationKey`); empty: none */
  written: string
  /** Its energy is worked out (`rotationEnergy`, for `written`) */
  ready: boolean
  rotationEnergy?: RotationEnergy
  playedTime?: number
}): { kqm: Partial<TeamOptKqm>; key?: string } | undefined {
  const kqm = teamOpt.kqm
  const source = kqm?.energySource
  if (source === 'manual') return undefined
  const newRotation = ready && kqm?.energyRotation !== written
  if (source !== 'calculator' && !(ready && !source)) return undefined
  const applied = kqm?.energyCalculator
  const rotationTime = (ready && playedTime) || (teamOpt.rotationTime ?? 20)
  const energyCalculator = {
    ...teamCalculator(
      members,
      teamOpt,
      applied,
      ready ? rotationEnergy : undefined
    ),
    rotationTime,
  }
  if (!written) {
    delete energyCalculator.opening
    delete energyCalculator.timeline
  }
  const json = JSON.stringify(energyCalculator)
  if (
    source === 'calculator' &&
    !newRotation &&
    json === JSON.stringify(applied)
  )
    return undefined
  const estimate = kqmEnergyEstimate(
    members.map((m) => m.characterKey),
    energyCalculator,
    kqm
  )
  return {
    key: `${json}|${ready ? written : ''}`,
    kqm: {
      energySource: 'calculator',
      energyCalculator,
      energyRecharge: estimate.targets,
      ...(ready ? { energyRotation: written } : {}),
    },
  }
}
