import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamDataOverrides, TeamOptMember } from './data'
import { teamOptMembers } from './data'
import type { RotationEnergy } from './energyCalc'
import { energyFromRotation } from './energyCalc'
import type { KqmPlayed, KqmReplayInput } from './kqm'
import type { RunAttackState } from './lowHpUptime'
import { isSacrificialWeapon } from './rotation/sacrificial'
import type {
  FrameData,
  RotationMember,
  RotationTimingSettings,
  SimGear,
} from './rotation'
import type { RotationSearchSetup } from './rotationSearchScore'
import type { SimTeam } from './writtenRotation'
import { simTeamOf, simulateWritten, teamBurstEvery } from './writtenRotation'

/**
 * Team optimize's own play of a written rotation with given builds, as "Use this rotation" plays
 * it: the members' own constellations and switches, the pace it keeps (or the first rotations
 * chosen), the builds' weapons, sets and stats. Its attacks per rotation (members the simulation
 * has no kit for keep the attacks entered), its time and its Energy as played.
 */
export function writtenTeamReplay({
  database,
  teamId,
  members,
  gender,
  names,
  teamOpt,
  text,
  opener,
  timing,
  frameData,
  warnings,
  includeEnergy = true,
}: {
  database: ArtCharDatabase
  teamId: string
  members: TeamOptMember[]
  gender: GenderKey
  names: RotationMember[]
  teamOpt: TeamOpt
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  /** Where each play adds its parser's and simulation's warnings */
  warnings?: string[]
  includeEnergy?: boolean
}):
  | ((
      input: Pick<KqmReplayInput, 'gear' | 'overrides' | 'calculate'>
    ) => KqmPlayed & { energy?: RotationEnergy })
  | undefined {
  if (!text.trim()) return undefined
  const own = simTeamOf(members, database)
  return ({ gear, overrides, calculate }) => {
    const playArgs = {
      text,
      opener,
      timing,
      frameData,
      team: { ...own, gear },
      names,
      members,
      database,
      teamId,
      gender,
      openerWarning: (w: string) => w,
      calculation: overrides,
      calculate,
      burstEvery: teamBurstEvery(teamOpt),
    }
    const played = simulateWritten(playArgs)
    if (!played?.sim || !played.attacks)
      throw new Error(
        'The written rotation has no actions to play. Check the rotation text.'
      )
    warnings?.push(...played.rotation.warnings, ...played.sim.warnings)
    const sim = played.counted?.sim ?? played.sim
    const rotations = played.counted?.rotations ?? 1
    const attacks = { ...teamOpt.attacks }
    for (const k of own.members)
      if (!sim.unsupported.includes(k)) attacks[k] = played.attacks[k] ?? []
    const stalls = Object.entries(sim.stalls ?? {})
      .map(([label, frames]) => ({ label, seconds: frames / 60 / rotations }))
      .filter((s) => s.seconds >= 0.3)
      .sort((a, b) => b.seconds - a.seconds)
    const energyPlay =
      includeEnergy &&
      own.members.some((key) => isSacrificialWeapon(gear[key]?.weapon))
        ? simulateWritten({
            ...playArgs,
            sacrificial: false,
            timelineOnly: true,
          })
        : undefined
    const energySim = energyPlay?.counted?.sim ?? energyPlay?.sim
    return {
      attacks,
      rotationTime: Math.round((sim.frames / 60 / rotations) * 10) / 10,
      stalls,
      ...(includeEnergy && {
        energy: energyFromRotation(
          energySim ?? sim,
          own.members,
          rotations,
          own.constellations
        ),
        ...(energySim && {
          energyRotationTime:
            Math.round((energySim.frames / 60 / rotations) * 10) / 10,
        }),
      }),
    }
  }
}

export type TeamReplayDocument = Pick<
  Parameters<typeof writtenTeamReplay>[0],
  'names' | 'text' | 'opener' | 'timing' | 'frameData'
>

/** Replay a saved rotation with the gear candidates supplied by its caller. */
export function replayTeamAttacks(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  teamOpt: TeamOpt,
  rotation: TeamReplayDocument,
  gearOf: (own: SimTeam['gear']) => SimTeam['gear']
) {
  const members = teamOptMembers(database, teamId)
  try {
    return writtenTeamReplay({
      database,
      teamId,
      members,
      gender,
      teamOpt,
      ...rotation,
      includeEnergy: false,
    })?.({
      gear: gearOf(simTeamOf(members, database).gear),
      overrides: {},
    }).attacks
  } catch {
    return undefined
  }
}

/**
 * A Team optimize rotation search's setup: the tab's own saved opener, timing and frame data, and
 * a team build (its artifacts and weapons as team data, `overrides`, and as the simulation sees
 * them, `gear`) counted as the tab counts the rotation: played with the members' own gear and
 * stats (as "Use this rotation" plays it), its damage with the build, the run's states on every
 * attack
 */
export function teamRotationSearchSetup(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  names: RotationMember[],
  teamOpt: TeamOpt,
  overrides: TeamDataOverrides,
  gear: Partial<Record<CharacterKey, SimGear>>,
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  },
  attackStates?: readonly RunAttackState[]
): RotationSearchSetup {
  const own = simTeamOf(teamOptMembers(database, teamId), database)
  return {
    play: 'team',
    teamId,
    gender,
    names,
    teamOpt,
    ...saved,
    constellations: own.constellations,
    gear,
    overrides,
    ...(attackStates?.length ? { attackStates: [...attackStates] } : {}),
    // (the build's sets and weapons as candidates: their effects timed as the run timed them)
    sim: {
      gear: Object.fromEntries(
        own.members.map((k) => [
          k,
          {
            ...own.gear[k],
            candidates: {
              sets: Object.keys(gear[k]?.sets ?? {}),
              weapons: gear[k]?.weapon ? [gear[k]!.weapon!] : [],
            },
          },
        ])
      ),
      overrides: {},
    },
  }
}
