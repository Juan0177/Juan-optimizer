import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys, allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamOpt,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { enemyFreezeImmune } from '../../components/enemy/stygianBosses'
import type { TeamDataOverrides, TeamOptMember } from './data'
import type { RotationEnergy } from './energyCalc'
import { energyFromRotation } from './energyCalc'
import type { KqmPlayed, KqmReplayInput } from './kqm'
import {
  everyNthBursts,
  type FrameData,
  firstRotations,
  frameOverrides,
  kitModels,
  lastRotation,
  needsRotationCalculation,
  openerCounted as openerIsCounted,
  parseRotation,
  type RotationCalculation,
  type RotationMember,
  type RotationTimingSettings,
  rotationAttacks,
  rotationSamples,
  type SimBuffOwner,
  type SimGear,
  STEADY_COUNTED,
  STEADY_REPEATS,
  simulateRotationSamples,
} from './rotation'
import { rotationCalculation } from './rotationCalculation'

/*
 * A written rotation played as the writer, Team optimize and KQM play it (from its text and
 * saved settings): nothing here reads the page or its storage, so a worker plays it the same way
 */

/**
 * The ER calculator's "Burst: Every 2nd": that member's Burst in one of every 2 rotations (KQM's
 * runs, its timeline); none unless the ER comes from the calculator
 */
export function kqmBurstEvery(kqm: TeamOptKqm | undefined) {
  const calculator =
    kqm?.energySource === 'calculator' ? kqm.energyCalculator : undefined
  if (!calculator) return undefined
  const every = Object.fromEntries(
    Object.entries(calculator.members).map(([k, m]) => [k, m?.burstEvery ?? 1])
  ) as Partial<Record<CharacterKey, number>>
  return Object.values(every).some((n) => n !== 1) ? every : undefined
}

/** A rotation's saved timing (none: no edits) */
export const parseTiming = (raw: string | null): RotationTimingSettings => {
  try {
    const v = JSON.parse(raw ?? '')
    if (v && typeof v === 'object' && v.edits) return v
  } catch {
    // (none saved)
  }
  return { edits: {} }
}
/** The saved frame data (none: the defaults) */
export const parseFrameData = (raw: string | null): FrameData => {
  try {
    const v = JSON.parse(raw ?? '')
    if (v && typeof v === 'object') return v
  } catch {
    // (none saved)
  }
  return {}
}

/** The team as its members' own builds play it: constellations, elements, weapons and sets */
export function simTeamOf(members: TeamOptMember[], database: ArtCharDatabase) {
  const keys = members.map((m) => m.characterKey)
  return {
    members: keys,
    constellations: Object.fromEntries(
      members.map((m) => [
        m.characterKey,
        (m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.character
              ?.constellation
          : database.chars.get(m.characterKey)?.constellation) ?? 0,
      ])
    ),
    elements: Object.fromEntries(keys.map((k) => [k, getCharEle(k)])) as never,
    // the members' current sets (for set effects the simulation plays: Thundering Fury)
    gear: Object.fromEntries(
      members.map((m) => {
        const sets: Record<string, number> = {}
        if (m.isTc) {
          const tcSets =
            database.buildTcs.get(m.loadoutDatum.buildTcId)?.artifact.sets ?? {}
          for (const [k, n] of Object.entries(tcSets)) sets[k] = n ?? 0
        } else
          for (const id of Object.values(m.artifactIds)) {
            const setKey = id ? database.arts.get(id)?.setKey : undefined
            if (setKey) sets[setKey] = (sets[setKey] ?? 0) + 1
          }
        const weapon = m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.weapon
          : database.weapons.get(m.weaponId)
        return [
          m.characterKey,
          { sets, weapon: weapon?.key, refinement: weapon?.refinement },
        ]
      })
    ),
  }
}
/** The team as a simulation plays it: the members' own (`simTeamOf`), or KQM's (`kqmRotationReplay`) */
export type SimTeam = {
  members: CharacterKey[]
  constellations: Partial<Record<CharacterKey, number>>
  elements: ReturnType<typeof simTeamOf>['elements']
  gear: Partial<Record<CharacterKey, SimGear>>
}

/**
 * Whether the enemy a tab's damage is for can't be frozen: the team's, or on the KQM tab its own
 * (`teamOpt.kqm.enemy`, else the team's). `teamOpt`: the settings a KQM run was made with.
 */
export function tabEnemyFreezeImmune(
  database: ArtCharDatabase,
  teamId: string,
  kqm?: boolean,
  teamOpt?: Pick<TeamOpt, 'kqm'>
): boolean {
  const team = database.teams.get(teamId)
  const enemy = kqm ? ((teamOpt ?? team?.teamOpt)?.kqm?.enemy ?? team) : team
  return enemyFreezeImmune(enemy)
}

/**
 * The written rotation played frame by frame: its steps, the simulation and each member's attacks
 * (only the buff states that differ from the members' own settings go on the attacks)
 */
export function simulateWritten({
  text,
  opener,
  timing,
  frameData,
  team,
  names,
  members,
  database,
  teamId,
  gender,
  openerWarning,
  repeats,
  keep,
  samples,
  calculation,
  calculate,
  current,
  kqm,
  auraTimeline,
  freezeImmune,
  burstEvery,
  withoutBursts,
}: {
  /** The KQM tab's: its own switches are the states where no attack sets one (`current` absent) */
  kqm?: boolean
  /** Its Bursts left out (a fight that starts with no energy: its first rotation) */
  withoutBursts?: boolean
  /** Record the enemy's auras over time (the writer's timeline; never KQM's many replays) */
  auraTimeline?: boolean
  /** The enemy can't be frozen (default: as the tab's enemy is, `tabEnemyFreezeImmune`) */
  freezeImmune?: boolean
  /**
   * Members that use their Burst only every Nth rotation (KQM's ER calculator): the written
   * rotation is played N in a row with their Burst in one of them (`loops` in the result)
   */
  burstEvery?: Partial<Record<CharacterKey, number>>
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  team: SimTeam
  names: RotationMember[]
  members: TeamOptMember[]
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  openerWarning: (warning: string) => string
  /**
   * How many times it is played, and which of them count. Default: as KQM counts it, 4 in a row
   * with the last 2 averaged (the pace it keeps: an action not ready again in time waits), the
   * result's `sim` then the last of them (what a timeline shows) and `counted` the 2.
   */
  repeats?: number
  keep?: 'middle' | 'all' | 'last2'
  /** Seeded samples of members with random effects (default 64) */
  samples?: number
  /** The builds the simulation's stats and heals are read from (default: the members' own) */
  calculation?: TeamDataOverrides
  /** Those stats already read for these builds (`KqmReplayInput.calculate`) */
  calculate?: RotationCalculation
  /**
   * A conditional's state where no attack sets it (default: the member's or team's own): the
   * buff states an attack carries are the ones that differ from it
   */
  current?: (owner: SimBuffOwner, path: string[]) => string | undefined
}) {
  if (!text.trim()) return undefined
  const rotation = parseRotation(text, names)
  // the opener: the first rotation (counted from the start; else a setup before the loop)
  if (opener.trim()) {
    const parsed = parseRotation(opener, names)
    rotation.opener = parsed.steps
    rotation.warnings.push(...parsed.warnings.map(openerWarning))
  }
  if (withoutBursts) {
    // (a step that was only a Burst is left out: the member is not swapped in for nothing; a
    // Burst's alternative, "Q/N1", is played instead. What is not ready without the Bursts, a
    // Skill their Burst would have reset, is left out rather than waited for, as a player would)
    const strip = (steps: typeof rotation.steps) =>
      steps.flatMap((step) => {
        if (!step.actions.length) return [step]
        const actions = step.actions
          .flatMap((a) => (a.kind === 'burst' ? (a.otherwise ?? []) : [a]))
          .map((a) => ({ ...a, optional: true }))
        return actions.length ? [{ ...step, actions }] : []
      })
    rotation.steps = strip(rotation.steps)
    if (rotation.opener) rotation.opener = strip(rotation.opener)
  }
  if (!rotation.steps.length) return { rotation }
  // (a Burst every Nth rotation: N written rotations played as one, timing edits kept per copy)
  const nth = burstEvery ? everyNthBursts(rotation, burstEvery) : undefined
  const edits = frameOverrides(rotation, timing.edits)
  const loops = nth?.loops ?? 1
  // (the writer's and Team optimize's own play: the pace it keeps, as KQM counts it, or the first
  // few rotations from the start when chosen)
  const steady = repeats === undefined
  const first = firstRotations(timing)
  // (counted from the start, the opener is the first rotation, the rotation's copies after it,
  // unless it is a setup before the start)
  const openerCounted = !!rotation.opener?.length && openerIsCounted(timing)
  /** The written rotations counted from the start (each played copy is `loops` of them) */
  const fromStart =
    first === undefined
      ? undefined
      : openerCounted
        ? 1 + (first - 1) * loops
        : first * loops
  const sampled = team.members.some((m) => kitModels[m]?.sampled)
  const sim = simulateRotationSamples(
    {
      ...team,
      calculate: needsRotationCalculation(team.members, team.gear)
        ? (calculate ??
          rotationCalculation(database, teamId, gender, calculation))
        : undefined,
      rotation: nth?.rotation ?? rotation,
      frameOverrides: nth
        ? Object.fromEntries(
            nth.index.flatMap((written, played) =>
              edits[written] === undefined ? [] : [[played, edits[written]]]
            )
          )
        : edits,
      swapFrames: timing.swapFrames,
      frameData,
      repeats: first ?? (steady ? STEADY_REPEATS : repeats),
      keep: first ? 'all' : steady ? 'last2' : keep,
      openerCounted,
      auraTimeline,
      freezeImmune: freezeImmune ?? tabEnemyFreezeImmune(database, teamId, kqm),
    },
    // (two rotations kept: half the samples each, as much as one rotation of 64)
    // (no more than the members' kits need: a small randomness, few plays)
    sampled
      ? rotationSamples(
          team.members,
          kitModels,
          samples ?? (steady ? 32 : undefined)
        )
      : undefined
  )
  const own =
    current ??
    ((owner: SimBuffOwner, path: string[]) =>
      (kqm ? kqmConditional : ownConditional)(
        database,
        teamId,
        members,
        owner,
        path
      ))
  if (!steady)
    return {
      rotation,
      sim,
      own,
      attacks: rotationAttacks(sim, own),
      counted: undefined,
      loops,
      fromStart,
    }
  const counted = fromStart ?? STEADY_COUNTED
  return {
    rotation,
    // (what the timeline shows: the last of the two counted; the first few, all of them)
    sim: first ? sim : lastRotation(sim),
    own,
    // per rotation: the hits of those counted, averaged
    attacks: perRotation(rotationAttacks(sim, own), counted),
    counted: { sim, rotations: counted, openerCounted },
    loops,
    fromStart,
  }
}

/** Attacks of `rotations` rotations, per rotation */
export function perRotation(
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>,
  rotations: number
) {
  return Object.fromEntries(
    Object.entries(attacks).map(([k, list]) => [
      k,
      (list ?? []).map((a) => ({ ...a, hits: (a.hits ?? 1) / rotations })),
    ])
  ) as Partial<Record<CharacterKey, TeamOptAttack[]>>
}
/** A played rotation's time per rotation, seconds (as counted: the steady pace) */
export const writtenSeconds = (result: WrittenRotation) =>
  result.counted
    ? result.counted.sim.frames / 60 / result.counted.rotations
    : result.sim
      ? result.sim.frames / 60
      : undefined
/**
 * When the rotation cannot keep its pace: its first time through (nothing waited for), seconds,
 * and what waits per rotation since (seconds each, the longest first); undefined when it keeps it
 */
export function writtenWaits(result: WrittenRotation) {
  const counted = result.counted
  // (the opener counted as the first rotation is another rotation: not its first time through)
  if (!counted || counted.openerCounted) return undefined
  const first = (counted.sim.rotationFrames?.[0] ?? 0) / 60
  const per = writtenSeconds(result) ?? 0
  const waits = Object.entries(counted.sim.stalls ?? {})
    .map(([label, frames]) => ({
      label,
      seconds: frames / 60 / counted.rotations,
    }))
    .filter((w) => w.seconds >= 0.1)
    .sort((a, b) => b.seconds - a.seconds)
  if (!first || per - first < 0.2) return undefined
  return { first, waits }
}
/** A conditional's state as the member (or the team) has it set */
export function ownConditional(
  database: ArtCharDatabase,
  teamId: string,
  members: TeamOptMember[],
  owner: SimBuffOwner,
  path: string[]
) {
  const member = members.find((m) => m.characterKey === owner)
  const conditional = (
    owner === 'team'
      ? database.teams.get(teamId)?.conditional
      : member
        ? database.teamChars.get(member.teamCharId)?.conditional
        : undefined
  ) as Record<string, Record<string, string>> | undefined
  return conditional?.[path[0]]?.[path[1]]
}
/**
 * A conditional's state as the KQM tab has it: its own team switches and members' switches
 * (`TeamOptKqm.teamConditional`, `passives`), never the members' own. Not set up yet: the team's.
 */
export function kqmConditional(
  database: ArtCharDatabase,
  teamId: string,
  members: TeamOptMember[],
  owner: SimBuffOwner,
  path: string[]
) {
  const kqm = database.teams.get(teamId)?.teamOpt?.kqm
  if (!kqm?.teamConditional)
    return ownConditional(database, teamId, members, owner, path)
  if (owner === 'team')
    return (
      (kqm.teamConditional as Record<string, Record<string, string>>)[
        path[0]
      ]?.[path[1]] || undefined
    )
  return kqm.passives?.[owner]?.[path[0]]?.[path[1]] || undefined
}
export type WrittenRotation = NonNullable<ReturnType<typeof simulateWritten>>

/** Weapons and artifact sets: KQM never takes a member's own switches for them */
export const GEAR_KEYS = new Set<string>([
  ...allWeaponKeys,
  ...allArtifactSetKeys,
])
/** Rotations played for KQM builds, and the last ones counted (the steady pace, past the start) */
export const KQM_REPEATS = 4
export const KQM_COUNTED = 2

/**
 * KQM theorycrafting's own play of the written rotation (`KqmRunArgs.replay`), apart from Team
 * optimize's (which plays it with the members' own constellations and gear): at the KQM
 * constellations, with the KQM builds' weapons and sets and their stats, 4 rotations in a row with
 * the last 2 averaged. Past the start, an action that is not ready again in time makes every
 * rotation wait (the second rotation alone can still have it from the start), and two in a row
 * even out a cooldown about a rotation long (one rotation can be a lucky one). Its time is the
 * rotation's time. Nothing written: undefined (the attacks entered are used as they are). The
 * rotation's saved settings (opener, timing, frame data) are given: a worker plays it too.
 */
export function writtenKqmReplay({
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
}):
  | ((input: KqmReplayInput) => KqmPlayed & { energy?: RotationEnergy })
  | undefined {
  if (!text.trim()) return undefined
  const common = {
    text,
    opener,
    timing,
    frameData,
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w: string) => w,
  }
  const keys = members.map((m) => m.characterKey)
  const elements = simTeamOf(members, database).elements
  const burstEvery = kqmBurstEvery(teamOpt.kqm)
  // (the run's own enemy, as its settings have it)
  const freezeImmune = tabEnemyFreezeImmune(database, teamId, true, teamOpt)
  return ({ constellations, gear, overrides, calculate }) => {
    // the state where no attack sets one, as KQM counts it: KQM's own switches ('' off), else
    // the rule's (never the members' or the team's own, once KQM has its own: `kqmOwnSettings`)
    const current = (owner: SimBuffOwner, path: string[]) => {
      if (owner === 'team') {
        const switches = overrides.teamConditional as
          | Record<string, Record<string, string>>
          | undefined
        return switches
          ? switches[path[0]]?.[path[1]] || undefined
          : ownConditional(database, teamId, members, owner, path)
      }
      const kqm = overrides.conditionalOverrides?.[owner]?.[path[0]]?.[path[1]]
      if (kqm !== undefined) return kqm || undefined
      if (
        overrides.ownKit !== false &&
        !(overrides.ownBuild === false && GEAR_KEYS.has(path[0]))
      ) {
        const own = ownConditional(database, teamId, members, owner, path)
        if (own !== undefined) return own
      }
      const rule = (
        overrides.extraConditionals?.[owner] as
          | Record<string, Record<string, string>>
          | undefined
      )?.[path[0]]?.[path[1]]
      return rule
    }
    const played = simulateWritten({
      ...common,
      team: { members: keys, constellations, elements, gear },
      calculation: overrides,
      calculate,
      current,
      repeats: KQM_REPEATS,
      keep: 'last2',
      burstEvery,
      freezeImmune,
      // (two rotations kept: fewer samples, as much as the writer's one rotation of 64)
      samples: 32,
    })
    // (written but nothing to play: an error, not the attacks Team optimize played)
    if (!played?.sim || !played.attacks)
      throw new Error(
        'The written rotation has no actions to play. Check the rotation text.'
      )
    warnings?.push(...played.rotation.warnings, ...played.sim.warnings)
    // (per rotation: the hits and time of the 2 counted, averaged, each of them `loops` written
    // rotations, or of those counted from the start; members the simulation has no kit for keep
    // the attacks entered for them)
    const counted = played.fromStart ?? KQM_COUNTED * (played.loops ?? 1)
    const attacks = { ...teamOpt.attacks }
    for (const k of keys)
      if (!played.sim.unsupported.includes(k))
        attacks[k] = (played.attacks[k] ?? []).map((a) => ({
          ...a,
          hits: a.hits / counted,
        }))
    const stalls = Object.entries(played.sim.stalls ?? {})
      .map(([label, frames]) => ({ label, seconds: frames / 60 / counted }))
      .filter((s) => s.seconds >= 0.3)
      .sort((a, b) => b.seconds - a.seconds)
    return {
      attacks,
      rotationTime: Math.round((played.sim.frames / 60 / counted) * 10) / 10,
      stalls,
      // (the ER calculator's inputs as this rotation plays them)
      energy: energyFromRotation(played.sim, keys, counted, constellations),
    }
  }
}
