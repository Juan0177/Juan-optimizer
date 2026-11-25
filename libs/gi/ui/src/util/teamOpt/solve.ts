import { notEmpty, objKeyMap } from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  GenderKey,
  SetNum,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allArtifactSlotKeys,
  allWeaponKeys,
  artMaxLevel,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ArtSetExclusion,
  ICachedArtifact,
  ICachedWeapon,
  OptConfig,
  StatFilters,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { withForcedSet } from '@genshin-optimizer/gi/db'
import {
  getArtSheet,
  type IConditionalValues,
} from '@genshin-optimizer/gi/sheets'
import type { DynMinMax } from '@genshin-optimizer/gi/solver'
import {
  nodeRangeEvaluator,
  optimizerGpuSupported,
  yieldTask,
} from '@genshin-optimizer/gi/solver'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import type { Data, OptNode } from '@genshin-optimizer/gi/wr'
import {
  constant,
  dynRead,
  greaterEq,
  optimize,
  precompute,
  sum,
} from '@genshin-optimizer/gi/wr'
import type { BonusStats, CharacterOverride, TeamOptMember } from './data'
import { addBonusStats, teamOptBonusStats, teamOptMembers } from './data'
import { type RunAttackState, withAttackStates } from './lowHpUptime'
import { constValue, teamRotationNodes } from './objective'
import {
  climbFrom,
  fastSeedBuild,
  type PrefilterProblem,
  quickPool,
  seedBuild,
} from './prefilter'
import type { SimGear } from './rotation'
import type { TeamOptRunRotation } from './runTeam'
import {
  canWield,
  hasEnergyRequirement,
  isErFilter,
  isWeaponExcludedFor,
  teamEnergyNeeds,
  teamOptUntickedWeapons,
  teamOptWeaponCandidates,
  teamStatFilters,
} from './weapons'

/** What the optimizer of one member is given: the rest of the team is fixed */
export interface TeamOptSolveInput {
  /** Alternative builds are searched while the user can interact with the result. */
  background?: boolean
  characterKey: CharacterKey
  arts: ICachedArtifact[]
  /** The team's rotation damage, as a function of the member's artifacts */
  objective: OptNode
  constraints: { value: OptNode; min: number }[]
  exclusion: ArtSetExclusion
  mainStatAssumptionLevel: number
  /** How many builds to find, best first (default 1): the next ones come in `more` */
  topN?: number
  /** Told, after the search, how much of the space it went through */
  onWork?: (work: { tested: number; total: number }) => void
}
/** Reusable GPU set ranker for one `(member, weapon)`: evaluates 4pc sets and 2pc+2pc pairs on one compiled pipeline. */
export interface TeamOptSetRanker {
  solveSet: (
    arts: readonly ICachedArtifact[],
    required: readonly string[],
    minCount: 2 | 4
  ) => Promise<
    { value: number; artifactIds: string[] } | undefined | 'fallback'
  >
  solveMixed: (
    arts: readonly ICachedArtifact[],
    forbidPairs: readonly (readonly [string, string])[]
  ) => Promise<
    { value: number; artifactIds: string[] } | undefined | 'fallback'
  >
  destroy: () => void
}

/** The best build for `input` (with `topN`, the next ones in `more`), if any meets its constraints */
export type TeamOptSolver = ((input: TeamOptSolveInput) => Promise<
  | {
      value: number
      artifactIds: string[]
      more?: { value: number; artifactIds: string[] }[]
    }
  | undefined
>) & {
  createSetRanker?: (input: {
    arts: ICachedArtifact[]
    objective: OptNode
    constraints: { value: OptNode; min: number }[]
    exclusion: ArtSetExclusion
    mainStatAssumptionLevel: number
    background?: boolean
  }) => Promise<TeamOptSetRanker | undefined>
}

export interface TeamOptStep {
  round: number
  maxRounds: number
  /** Position of `characterKey` among the members being optimized */
  step: number
  steps: number
  characterKey: CharacterKey
  /** The weapon being tried, when weapons are optimized too (1-based, of `weapons`) */
  weapon?: number
  weapons?: number
  /**
   * While weighing an energy weapon: the member re-optimized with the Energy Recharge
   * requirement the weapon gives it
   */
  energyFor?: CharacterKey
  /** Trying exchanges with the other members (see `optimizeTeam`) */
  exchange?: boolean
  /** Finding the next best team builds (`TeamOpt.topN`), once the best one is found */
  alternatives?: boolean
}

export type TeamOptBuilds = Partial<
  Record<CharacterKey, Record<ArtifactSlotKey, string | undefined>>
>

export interface TeamOptEvaluation {
  /** The rotation's damage */
  total: number
  /** Per member, the damage of its own attacks */
  members: Partial<Record<CharacterKey, number>>
  /** Per member, each attack's damage per rotation */
  attacks: Partial<Record<CharacterKey, number[]>>
  /** Per member, the indices of its constraints that are not met */
  unmet: Partial<Record<CharacterKey, number[]>>
  /** Per member, its requirements that are not met: what they need, and what the build reaches */
  shortfalls?: Partial<Record<CharacterKey, TeamOptShortfall[]>>
}

/** A requirement a build does not meet (in the stat's own unit: a fraction for percentages) */
export interface TeamOptShortfall {
  /** Its stat's path in the member's data (as in its Optimize tab's requirements) */
  path: string[]
  /** What the build reaches */
  value: number
  /** What it needs */
  min: number
}

/** Another team build: the best one with one member's artifacts changed */
export interface TeamOptAlternative {
  builds: TeamOptBuilds
  after: TeamOptEvaluation
  /** The member whose artifacts differ from the best build's */
  changed: CharacterKey
}

export interface TeamOptResult {
  builds: TeamOptBuilds
  /** Each member's weapon (its current one unless weapons are optimized) */
  weapons: Partial<Record<CharacterKey, string>>
  before: TeamOptEvaluation
  after: TeamOptEvaluation
  /** Rounds run (each round optimizes every member once) */
  rounds: number
  /** The members that were optimized, in order */
  optimized: CharacterKey[]
  /**
   * Per member with an Energy Recharge requirement: how much the team's energy weapons lower it
   * (percent points), and which weapons
   */
  energy?: Partial<
    Record<CharacterKey, { relief: number; weaponIds: string[] }>
  >
  /**
   * Optimized members left with a weapon that is not ticked in the weapon chooser: none of the
   * ticked ones was free for them, so they kept theirs
   */
  untickedWeapons?: CharacterKey[]
  /**
   * Optimized members whose own build (before the run) breaks their set rules: they could not keep
   * it, which can leave the team below where it started
   */
  startBreaksSetRules?: CharacterKey[]
  /**
   * Optimized members whose own weapon (before the run) is not ticked in the weapon chooser while
   * a ticked one was free for them: they could not keep it, which can leave the team below where it
   * started
   */
  startUntickedWeapons?: CharacterKey[]
  /**
   * The next best team builds (`TeamOpt.topN` − 1 at most), best first: each one is this build
   * with one member's artifacts changed (its next best ones, the others as they are), the
   * weapons the same
   */
  alternatives?: TeamOptAlternative[]
  /** The states every attack got in the run (`optimizeTeam`'s `attackStates`): its damage has them */
  attackStates?: RunAttackState[]
  /**
   * The attacks the run played, when it played the written rotation itself (`teamOptRunGear`: the
   * sets and weapons it tried timed in it); its damage is per these. Absent: the team's own.
   */
  attacks?: TeamOpt['attacks']
  /** The written rotation's average length with the result's weapons. */
  rotationTime?: number
  /** Saved with weapon-dependent rotations so the equipment inspector can replay them. */
  writtenRotation?: TeamOptRunRotation
  /** Each optimized member's other builds: with each weapon it may take, in each set it may wear */
  options?: Partial<Record<CharacterKey, TeamOptMemberOptions>>
}

type TeamOptSetPair = readonly [ArtifactSetKey, ArtifactSetKey]

export interface TeamOptSetChoice {
  /** Four or more pieces of one set. */
  set?: string
  /** Two distinct 2-piece bonuses. */
  setPair?: TeamOptSetPair
}

export const teamOptSetKey = ({ set, setPair }: TeamOptSetChoice) =>
  setPair?.join('+') ?? set ?? ''

/** A member's best build with another weapon or in another set, the rest of the team as found */
export interface TeamOptOption extends TeamOptSetChoice {
  weaponId: string
  /** None: no build with this weapon meets the member's requirements */
  artifactIds?: Record<ArtifactSlotKey, string | undefined>
  /** The team's damage as the run ranks builds (`TeamOptMemberOptions.best`: the result's) */
  value: number
  /** It leaves another member's requirement unmet */
  unmet?: true
}
export interface TeamOptMemberOptions {
  /** The result's own value, as the options are ranked */
  best: number
  /** Best first */
  weapons: TeamOptOption[]
  /** Best first */
  sets: TeamOptOption[]
}

/** A member's equipment picked by hand: a weapon and an optional set combination. */
export interface TeamOptPick extends TeamOptSetChoice {
  weaponId: string
}
export type TeamOptPicks = Partial<Record<CharacterKey, TeamOptPick>>
/** The team with picks: its builds, weapons and damage as shown */
export interface TeamOptPickView {
  builds: TeamOptBuilds
  weapons: Partial<Record<CharacterKey, string>>
  after: TeamOptEvaluation
  attacks?: TeamOpt['attacks']
  rotationTime?: number
  /**
   * The members whose Energy Recharge requirement the picks change (an energy weapon picked or
   * taken away): the run's, and now; their artifacts were searched again for it
   */
  teammatesEr?: { characterKey: CharacterKey; from: number; to: number }[]
}
/** A run's team to try other equipment on (`optimizeTeam`'s `onSession`) */
export interface TeamOptSession {
  /** The run's team value, as options are ranked */
  best: number
  /**
   * The team with `picks` (each made in turn on the one before: every member not picked as the
   * run found it, its artifacts searched again for a pick); its figures given to `onFigures` as
   * soon as known, then `characterKey`'s rankings under its pick
   */
  pick(
    picks: TeamOptPicks,
    characterKey: CharacterKey,
    options?: {
      onFigures?: (view: TeamOptPickView) => void
      isCancelled?: () => boolean
    }
  ): Promise<(TeamOptPickView & { rankings: TeamOptMemberOptions }) | undefined>
  /** A member's rankings in `s` under `pick`: each weapon (with the pick's set), each set (with its weapon) */
  rankings(
    s: {
      builds: TeamOptBuilds
      weaponIds: Partial<Record<CharacterKey, string>>
    },
    characterKey: CharacterKey,
    pick: TeamOptPick,
    isCancelled?: () => boolean
  ): Promise<TeamOptMemberOptions | undefined>
}

export class TeamOptCancelled extends Error {
  constructor() {
    super('Team optimization cancelled')
  }
}

/**
 * No team build meets every optimized member's minimums (their Optimize tab's requirements, the ER
 * calculator's): per member, each one it misses, with the most a build of the artifacts and weapons
 * it may use can reach (`value`)
 */
export class TeamOptRequirementsUnmet extends Error {
  constructor(
    readonly shortfalls: Partial<Record<CharacterKey, TeamOptShortfall[]>>
  ) {
    super(
      `No build of the artifacts they may use meets the minimums of ${Object.keys(shortfalls).join(', ')}`
    )
  }
}

/**
 * No team build keeps every optimized member's set rules (their Optimize tab's set exclusions):
 * `characterKeys` are the members left outside them, even with the pieces the others hold
 */
export class TeamOptSetRulesUnmet extends Error {
  constructor(readonly characterKeys: CharacterKey[]) {
    super(
      `No build of the artifacts they may use keeps to the allowed sets of ${characterKeys.join(', ')}`
    )
  }
}

/** An artifact's stats as the solver sees them (see `compactArtifacts`) */
export function teamOptArtValues(
  art: ICachedArtifact,
  mainStatAssumptionLevel: number
): Record<string, number> {
  const values: Record<string, number> = {
    [art.setKey]: 1,
    [art.mainStatKey]: getMainStatValue(
      art.mainStatKey,
      art.rarity,
      Math.max(
        Math.min(mainStatAssumptionLevel, artMaxLevel[art.rarity]),
        art.level
      )
    ),
  }
  for (const { key, accurateValue } of art.substats)
    if (key)
      values[key] = key.endsWith('_') ? accurateValue / 100 : accurateValue
  return values
}

function evaluateNodes(
  nodes: OptNode[],
  arts: ICachedArtifact[],
  mainStatAssumptionLevel: number
) {
  const compute = precompute(nodes, {}, (r) => r.path[1], arts.length)
  return compute(
    arts.map((art) => ({
      values: teamOptArtValues(art, mainStatAssumptionLevel),
    })) as never
  )
}

/** The rotation's damage with the given builds (missing members: their loadout's build) */
export function evaluateTeamRotation(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  {
    arts,
    attacks,
    mainStatAssumptionLevel = 0,
    statFilters = {},
    weapons,
    extraConditionals,
    onField,
    bonusStats,
    characters,
    conditionalOverrides,
    enemyOverride,
  }: {
    /** Builds of the members: real artifacts or data (missing: their loadout's) */
    arts: Partial<Record<CharacterKey, ICachedArtifact[] | Data>>
    attacks: TeamOpt['attacks']
    mainStatAssumptionLevel?: number
    statFilters?: Partial<Record<CharacterKey, StatFilters>>
    weapons?: Partial<Record<CharacterKey, ICachedWeapon>>
    extraConditionals?: Partial<Record<CharacterKey, IConditionalValues>>
    /** Who is on the field, unless an attack says otherwise (default: the first member) */
    onField?: CharacterKey
    /** Extra bonus stats per member (`teamOptBonusStats`) */
    bonusStats?: Partial<Record<CharacterKey, BonusStats>>
    /** Members with another level, ascension or talent levels */
    characters?: Partial<Record<CharacterKey, CharacterOverride>>
    /** Conditionals over the members' own (`TeamDataOverrides.conditionalOverrides`) */
    conditionalOverrides?: Partial<
      Record<CharacterKey, Record<string, Record<string, string>>>
    >
    /** The enemy's stats over the team's own (another RES, as a boss's fight changes it) */
    enemyOverride?: Partial<Record<string, number>>
  }
): TeamOptEvaluation | undefined {
  const nodes = teamRotationNodes(database, teamId, gender, {
    conditionalOverrides,
    arts,
    attacks,
    mainStatAssumptionLevel,
    statFilters,
    weapons,
    extraConditionals,
    onField,
    bonusStats,
    characters,
    enemyOverride,
  })
  if (!nodes) return undefined
  return evaluateTeamNodes(database, teamId, attacks, nodes)
}

/** `evaluateTeamRotation` from the team's formulas already built (`teamRotationNodes`) */
export function evaluateTeamNodes(
  database: ArtCharDatabase,
  teamId: string,
  attacks: TeamOpt['attacks'],
  nodes: NonNullable<ReturnType<typeof teamRotationNodes>>
): TeamOptEvaluation {
  const result: TeamOptEvaluation = {
    total: 0,
    members: {},
    attacks: {},
    unmet: {},
  }
  for (const { characterKey } of teamOptMembers(database, teamId)) {
    result.members[characterKey] = 0
    result.attacks[characterKey] = (attacks[characterKey] ?? []).map(() => 0)
  }
  for (const { characterKey, attack, node } of nodes.terms) {
    const value = constValue(node) || 0
    result.total += value
    result.members[characterKey] = (result.members[characterKey] ?? 0) + value
    const perAttack = (result.attacks[characterKey] ??= [])
    perAttack[attack] = (perAttack[attack] ?? 0) + value
  }
  for (const { characterKey, index, path, value, min } of nodes.constraints) {
    const reached = constValue(value)
    if (reached >= min) continue
    ;(result.unmet[characterKey] ??= []).push(index)
    ;((result.shortfalls ??= {})[characterKey] ??= []).push({
      path,
      value: reached,
      min,
    })
  }
  return result
}

/** The piece counts set exclusion `rule` allows (as the solver reads it: 2 = 2–3 pieces, 4 = 4–5) */
export const allowedCounts = (rule: readonly number[] | undefined) =>
  rule?.includes(2)
    ? rule.includes(4)
      ? [0, 1]
      : [0, 1, 4, 5]
    : rule?.includes(4)
      ? [0, 1, 2, 3]
      : [0, 1, 2, 3, 4, 5]

/**
 * Whether a build keeps to a member's set rules (its Optimize tab's set exclusions), as the solver
 * reads them: each set's piece count, and "rainbow" for the number of pieces whose set has one
 */
export function meetsSetRules(
  arts: readonly Pick<ICachedArtifact, 'setKey'>[],
  exclusion: ArtSetExclusion | undefined
): boolean {
  if (!exclusion || !Object.keys(exclusion).length) return true
  const counts = new Map<string, number>()
  for (const { setKey } of arts)
    counts.set(setKey, (counts.get(setKey) ?? 0) + 1)
  for (const [setKey, n] of counts)
    if (!allowedCounts(exclusion[setKey as keyof ArtSetExclusion]).includes(n))
      return false
  const singles = [...counts.values()].filter((n) => n === 1).length
  // (two 2-piece bonuses turned off: a full build with no 4 pieces of a set needs 2+ mixed pieces)
  if (
    exclusion.twoTwo?.length &&
    arts.length === 5 &&
    Math.max(...counts.values()) < 4 &&
    singles < 2
  )
    return false
  return allowedCounts(exclusion.rainbow).includes(singles)
}

/**
 * The artifacts a member may use: the team's settings and the member's own optimizer filters
 * (main stats, excluded artifacts), without the ones `taken` by other members.
 */
export function teamOptPool(
  arts: readonly ICachedArtifact[],
  member: TeamOptMember,
  optConfig: OptConfig,
  teamOpt: TeamOpt,
  teamLocations: ReadonlySet<string>,
  taken: ReadonlySet<string>
): ICachedArtifact[] {
  // (characters outside the team whose artifacts are not taken)
  const notFrom = new Set<string>(teamOpt.excludedLocations ?? [])
  return arts.filter((art) => {
    if (taken.has(art.id)) return false
    if (art.level < teamOpt.levelLow || art.level > teamOpt.levelHigh)
      return false
    const mainStats = (
      optConfig.mainStatKeys as Partial<Record<ArtifactSlotKey, string[]>>
    )[art.slotKey]
    if (mainStats?.length && !mainStats.includes(art.mainStatKey)) return false
    if (teamOpt.excludedArts?.includes(art.id)) return false
    if (!teamOpt.useExcludedArts && optConfig.artExclusion.includes(art.id))
      return false
    if (
      art.location &&
      art.location !== member.location &&
      !teamLocations.has(art.location) &&
      (!teamOpt.useOtherChars || notFrom.has(art.location))
    )
      return false
    return true
  })
}

const SET_KEYS = new Set<string>(allArtifactSetKeys)
const WEAPON_KEYS = new Set<string>(allWeaponKeys)

/** Whether a set's `count`-piece effect has a state of its own (a switch) */
const hasSetConditional = (setKey: string, count: SetNum) =>
  !!getArtSheet(setKey as ArtifactSetKey)
    ?.setEffectDocument(count)
    ?.some((doc) => 'states' in doc)

/**
 * The sets `arts` have pieces of in four slots, their 4-piece allowed by `exclusion`; with `two`,
 * also those in two slots whose 2-piece effect has a switch
 */
function wearableSets(
  arts: readonly ICachedArtifact[],
  exclusion: ArtSetExclusion,
  two = false
): string[] {
  const slots = new Map<string, Set<ArtifactSlotKey>>()
  for (const art of arts) {
    const has = slots.get(art.setKey) ?? new Set()
    slots.set(art.setKey, has.add(art.slotKey))
  }
  return [...slots]
    .filter(([setKey, has]) => {
      const allowed = allowedCounts(exclusion[setKey as keyof ArtSetExclusion])
      return (
        (has.size >= 4 && allowed.includes(4)) ||
        (two &&
          has.size >= 2 &&
          allowed.includes(2) &&
          hasSetConditional(setKey, 2))
      )
    })
    .map(([setKey]) => setKey)
}

/** The two distinct bonuses these pieces can fit into four different slots. */
function wearablePairs(
  arts: readonly ICachedArtifact[],
  exclusion: ArtSetExclusion
): TeamOptSetPair[] {
  const slotsBySet = new Map<ArtifactSetKey, Set<ArtifactSlotKey>>()
  for (const { setKey, slotKey } of arts) {
    const slots = slotsBySet.get(setKey) ?? new Set<ArtifactSlotKey>()
    slotsBySet.set(setKey, slots.add(slotKey))
  }
  const sets = [...slotsBySet.keys()]
    .filter(
      (key) =>
        slotsBySet.get(key)!.size >= 2 &&
        allowedCounts(exclusion[key]).includes(2) &&
        !!getArtSheet(key)?.setEffects[2]
    )
    .sort()
  const pairs: TeamOptSetPair[] = []
  for (const [i, a] of sets.entries())
    for (const b of sets.slice(i + 1))
      if (new Set([...slotsBySet.get(a)!, ...slotsBySet.get(b)!]).size >= 4)
        pairs.push([a, b])
  return pairs
}

/**
 * The members' sim gear for a run's play of the rotation: with, for each member it optimizes, the
 * sets its pool can wear four of (or two, for a 2-piece effect with a switch) within its set rules,
 * and the weapons it may take when weapons are optimized, as candidates (`SimGear.candidates`).
 * Their effects are then timed by the rotation for every build tried, as on the KQM tab, instead of
 * following the member's switches.
 */
export function teamOptRunGear(
  database: ArtCharDatabase,
  teamId: string,
  teamOpt: TeamOpt,
  gear: Partial<Record<CharacterKey, SimGear>>
): Partial<Record<CharacterKey, SimGear>> {
  const members = teamOptMembers(database, teamId)
  const teamLocations = new Set(members.map((m) => m.location as string))
  const arts = database.arts.values
  const next = { ...gear }
  for (const member of members) {
    const ck = member.characterKey
    const optConfig = database.optConfigs.get(member.teamChar.optConfigId)
    if (member.isTc || teamOpt.keep.includes(ck) || !optConfig) continue
    const sets = wearableSets(
      teamOptPool(arts, member, optConfig, teamOpt, teamLocations, new Set()),
      optConfig.artSetExclusion,
      true
    )
    const weapons = teamOpt.optimizeWeapons
      ? [
          ...new Set(
            teamOptWeaponCandidates(
              database,
              member,
              member.weaponId,
              teamOpt,
              teamLocations,
              new Set()
            ).map((w) => w.key)
          ),
        ]
      : []
    next[ck] = { ...gear[ck], candidates: { sets, weapons } }
  }
  return next
}

const bySlot = (
  database: ArtCharDatabase,
  artifactIds: readonly string[]
): Record<ArtifactSlotKey, string | undefined> =>
  objKeyMap(allArtifactSlotKeys, (slotKey) =>
    artifactIds.find((id) => database.arts.get(id)?.slotKey === slotKey)
  )

/** How many builds `arts` make (one piece per slot that has any) */
const buildsOf = (arts: readonly ICachedArtifact[]) => {
  const perSlot = new Map<string, number>()
  for (const art of arts)
    perSlot.set(art.slotKey, (perSlot.get(art.slotKey) ?? 0) + 1)
  return [...perSlot.values()].reduce((a, b) => a * b, 1)
}

/** A better build must beat the current one by more than this (relative) */
const MIN_GAIN = 1e-6
const beatOf = (floor: number) =>
  Number.isFinite(floor)
    ? floor + Math.abs(floor) * MIN_GAIN
    : Number.NEGATIVE_INFINITY

/** The team's builds and weapons, at some point of the search */
interface TeamState {
  builds: TeamOptBuilds
  weaponIds: Partial<Record<CharacterKey, string>>
  lockedPairs?: Partial<Record<CharacterKey, TeamOptSetPair>>
}
const copyState = ({
  builds,
  weaponIds,
  lockedPairs,
}: TeamState): TeamState => ({
  builds: Object.fromEntries(
    Object.entries(builds).map(([key, build]) => [key, { ...build }])
  ) as TeamOptBuilds,
  weaponIds: { ...weaponIds },
  lockedPairs,
})

/**
 * Builds for the whole team at once: the rotation's damage (every member's attacks, with every
 * buff the members give each other) is maximized, and no artifact goes to two members.
 *
 * Members are optimized one at a time, the others staying fixed (the biggest damage dealer
 * first), with the team's damage as the target: a support whose set or stats buff the others
 * picks what helps the team most, not what makes its own hits biggest. Rounds repeat until no
 * member's build changes (or `maxRounds`), as a member's best build depends on the others'.
 *
 * Once the members' own steps settle, exchanges between members are tried too (a member's step
 * does not take what a settled member holds): a member re-optimized with the others' pieces, and
 * two members swapping the pieces of a slot or their weapons, kept when the team gains.
 *
 * An energy weapon (`TeamOpt.weaponEnergy`) lowers the whole team's Energy Recharge requirements:
 * when a member's weapon would change another member's requirement, that member is re-optimized
 * with it before the weapon is judged, so the weapon is worth what the team gains (or loses).
 */
/** A 53-bit string hash (cyrb53): fingerprints of formulas and artifact pools */
function hash53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
const nodePrints = new WeakMap<OptNode, string>()
/** A formula's fingerprint: equal formulas (same operations, constants and reads) print the same */
function nodePrint(node: OptNode): string {
  let print = nodePrints.get(node)
  if (print) return print
  switch (node.operation) {
    case 'const':
      print = `c${node.value}`
      break
    case 'read':
      print = `r${node.path.join('.')}`
      break
    default:
      print = hash53(
        `${node.operation}(${(node.operands as OptNode[]).map(nodePrint).join(',')})`
      )
  }
  nodePrints.set(node, print)
  return print
}
/**
 * Solves already done: the best build of a problem (its top 1, whatever floor it was searched
 * with), or a value its best is proven to be below (a search that found nothing above a floor).
 * Kept across runs: re-running after a small change, most members' problems are the same.
 */
const solveMemo = new Map<
  string,
  { best?: { value: number; artifactIds: string[] }; below?: number }
>()
const SOLVE_MEMO_SIZE = 400
/**
 * Quick narrows a member's search only above this many builds: smaller ones are fast as they
 * are on the GPU (a few billion builds a second), slow on the CPU (a team's formula: ~2 million)
 */
const QUICK_FROM_BUILDS = 5e9
const QUICK_FROM_BUILDS_BG = 5e8
const QUICK_FROM_BUILDS_CPU = 1e8
/** Team Optimize's searches go to the GPU from this many builds (`GOSolver`'s `gpuMinTotal`) */
export const TEAM_GPU_MIN_TOTAL = 2_000_000
/**
 * On huge GPU searches (e.g. Full search with 200M-20B+ builds), run a ~5-15 ms greedy climb
 * (`seedBuild`) first to establish a tight floor near the optimum: this lets GPU prefix pruning
 * skip >90% of prefixes and prevents Pass 0 candidate overflows that trigger a full Pass 1 sweep.
 */
const GPU_SEED_FROM_BUILDS = 2e8
/**
 * A member's weapons solved at once, on the GPU: each solve mostly waits (its worker preparing the
 * problem, the browser compiling its shader), so the next ones overlap that instead of queuing
 */
const PARALLEL_SOLVES = 3
/**
 * Quick searches a member's weapon in full when a climb with it from the member's build (one slot
 * changed at a time) reaches within this share of the best weapon's climb, or ranks among the
 * first `SCREEN_KEEP`; only for pools of at least this many builds (smaller searches are quick as
 * they are)
 */
const SCREEN_SHARE = 0.05
const SCREEN_KEEP = 3
/** Rank this many distinct mixed pairs without searching every pair separately. */
const MIXED_SET_RANKS = 3
export const teamOptScreen = { fromBuilds: 1e8, fromBuildsCpu: 1e5 }
/** Let other tasks run between heavy steps on the page thread (workers are already off-thread). */
let lastTurn = 0
async function yieldBetweenSteps() {
  if (typeof document === 'undefined') return
  if (performance.now() - lastTurn < 40) return
  await yieldTask()
  lastTurn = performance.now()
}

const PROBLEM_MEMO_SIZE = 1024
const problemMemo = new Map<
  string,
  | {
      objective: OptNode
      constraints: { value: OptNode; min: number; path: string[] }[]
      unmetOthers: Set<CharacterKey>
    }
  | undefined
>()

/** Forgets every solve and compiled problem cached across runs (tests; or clean benchmarks). */
export function clearTeamOptSolveMemo() {
  solveMemo.clear()
  problemMemo.clear()
}
/**
 * `input` without its floors (constraints on the objective itself, `objective ≥ x`): what a
 * problem is, whatever it must beat. And the highest of those floors.
 */
function solveKey(input: TeamOptSolveInput): { key: string; floor: number } {
  let floor = Number.NEGATIVE_INFINITY
  const constraints: string[] = []
  for (const { value, min } of input.constraints)
    if (value === input.objective) floor = Math.max(floor, min)
    else constraints.push(`${nodePrint(value)}>=${min}`)
  const arts = input.arts
    .map((a) =>
      [
        a.id,
        a.setKey,
        a.slotKey,
        a.rarity,
        a.level,
        a.mainStatKey,
        ...a.substats.map((sub) => `${sub.key}:${sub.value}`),
      ].join('|')
    )
    .sort()
    .join(';')
  const key = [
    input.characterKey,
    nodePrint(input.objective),
    constraints.sort().join(','),
    hash53(arts),
    JSON.stringify(input.exclusion),
    input.mainStatAssumptionLevel,
  ].join('#')
  return { key, floor }
}

export async function optimizeTeam({
  database,
  teamId,
  gender,
  teamOpt,
  solve: solveRaw,
  onStep,
  isCancelled = () => false,
  maxRounds = 4,
  parallelWeaponSolves = PARALLEL_SOLVES,
  builds = 1,
  attackStates,
  rankingBonusStats,
  onResult,
  onOptions,
  onSession,
  from,
  skipProvisional,
  maxExchanges = 2,
  weaponFilter,
  rotationForWeapons,
  rotationKey,
}: {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  solve: TeamOptSolver
  onStep?: (step: TeamOptStep) => void | Promise<void>
  isCancelled?: () => boolean
  maxRounds?: number
  /** Limit concurrent GPU searches for different weapons. */
  parallelWeaponSolves?: number
  /** Team builds to find (the best, and `builds` − 1 alternatives) */
  builds?: number
  /**
   * States every attack gets in this run (not saved with the rotation): e.g. Wolf's Gravestone's
   * passive at its uptime against the team's enemy
   */
  attackStates?: readonly RunAttackState[]
  /**
   * Bonus stats per member added only while builds are ranked (the fight's state buffs averaged
   * over it, `fightBuffShare`): the damage the result shows is without them
   */
  rankingBonusStats?: Partial<Record<CharacterKey, BonusStats>>
  /**
   * Given the result as soon as it is found: each optimized member's other builds (`options`)
   * are then searched, and given to `onOptions` one member at a time, before the promise resolves
   */
  onResult?: (result: TeamOptResult) => void
  onOptions?: (
    characterKey: CharacterKey,
    options: TeamOptMemberOptions
  ) => void
  /** Given the team found, to try other equipment on (`TeamOptSession`) */
  onSession?: (session: TeamOptSession) => void
  /** Start from these builds and weapons (a saved result's: with `maxRounds` 0, its session) */
  from?: Pick<TeamOptResult, 'builds' | 'weapons'> &
    Partial<Pick<TeamOptResult, 'optimized'>>
  /** Skip provisional piece-taking in round 1 (faster when warm-starting from already-optimal builds) */
  skipProvisional?: boolean
  /** Max pairwise piece-exchange passes after member rounds (defaults to 2; 0 skips exchanges) */
  maxExchanges?: number
  /** Restrict candidate weapon IDs considered per member (current weapon is always allowed) */
  weaponFilter?: Partial<Record<CharacterKey, ReadonlySet<string>>>
  rotationForWeapons?: (
    weapons: Partial<Record<CharacterKey, ICachedWeapon>>
  ) => { attacks: TeamOpt['attacks']; rotationTime?: number } | undefined
  rotationKey?: string
}): Promise<TeamOptResult | undefined> {
  // where a run spends its time (logged in development): compiling problems, solving, evaluating
  const profile = {
    memoHits: 0,
    problemHits: 0,
    /** Builds the solves actually went through */
    tested: 0,
    /** Builds the solves covered (the product of each slot's candidates) */
    space: 0,
    problems: 0,
    problemMs: 0,
    solves: 0,
    solveMs: 0,
    prefilterMs: 0,
    found: 0,
    evals: 0,
    evalMs: 0,
    /** Weapons Quick did not search in full */
    screened: 0,
    t0: performance.now(),
  }
  /**
   * The search `solveRaw` is given: Quick narrows each slot to the artifacts that can matter
   * (`quickPool`); both start above a good build found fast, when it meets every requirement and
   * beats `floor` (a floor cuts the next best builds: only for a top 1)
   */
  const prepare = async (
    input: TeamOptSolveInput,
    floor: number,
    quick = !teamOpt.fullSearch
  ) => {
    const t0 = performance.now()
    const problem: PrefilterProblem = {
      arts: input.arts,
      objective: input.objective,
      constraints: input.constraints.filter((c) => c.value !== input.objective),
      values: (art) => teamOptArtValues(art, input.mainStatAssumptionLevel),
      allowed: (arts) => meetsSetRules(arts, input.exclusion),
    }
    const space = buildsOf(input.arts)
    const quickLimit = optimizerGpuSupported()
      ? input.background
        ? QUICK_FROM_BUILDS_BG
        : QUICK_FROM_BUILDS
      : QUICK_FROM_BUILDS_CPU
    // (a search this small is fast as it is: narrowing it would cost more than it saves)
    const { arts, seed, refine } =
      quick && space > quickLimit
        ? await quickPool(problem)
        : {
            arts: input.arts,
            // A fast single-start climb speeds up very large GPU searches (>= 200M builds)
            // by establishing a tight floor that prunes >90% of prefixes and skips Pass 1.
            seed: input.background
              ? undefined
              : optimizerGpuSupported() && space >= TEAM_GPU_MIN_TOTAL
                ? space >= GPU_SEED_FROM_BUILDS
                  ? await fastSeedBuild(problem)
                  : undefined
                : await seedBuild(problem),
            refine: undefined,
          }
    profile.prefilterMs += performance.now() - t0
    const seeded =
      (input.topN ?? 1) === 1 && seed?.feasible && seed.value >= floor
        ? seed
        : undefined
    return {
      input: {
        ...input,
        arts: [...arts],
        constraints: seeded
          ? [
              ...input.constraints,
              {
                value: input.objective,
                min: seeded.value - Math.abs(seeded.value) * 1e-9,
              },
            ]
          : input.constraints,
      },
      seed: seeded,
      refine,
    }
  }
  /** `quick`: Quick or not, whatever the run's search (a preview's own search) */
  const solve = async (
    input: TeamOptSolveInput,
    quick = !teamOpt.fullSearch
  ): ReturnType<TeamOptSolver> => {
    const t0 = performance.now()
    // several builds: not in the memo (it keeps a problem's top 1)
    if ((input.topN ?? 1) > 1) {
      const result = await solveRaw(
        (await prepare(input, Number.NEGATIVE_INFINITY, quick)).input
      )
      profile.solves++
      profile.solveMs += performance.now() - t0
      if (result) profile.found++
      return result
    }
    // the same problem solved before (this run or an earlier one): its answer is known.
    // An exact (full) memo entry is also valid for a quick lookup.
    const { key: problemKey, floor } = solveKey(input)
    const key = quick ? `${problemKey}|quick` : problemKey
    const known =
      solveMemo.get(key) ?? (quick ? solveMemo.get(problemKey) : undefined)
    if (known?.best) {
      profile.memoHits++
      return known.best.value >= floor ? known.best : undefined
    }
    if (known?.below !== undefined && known.below <= floor) {
      profile.memoHits++
      return undefined
    }
    const prepared = await prepare(input, floor, quick)
    profile.space += buildsOf(prepared.input.arts)
    // the solver picks CPU or GPU itself: measured on Apple Silicon, starting members on the
    // CPU's branch and bound was slower than the GPU's sweep, even where the floor pruned it well
    const found = await solveRaw({
      ...prepared.input,
      onWork: ({ tested }) => {
        profile.tested += tested
      },
    })
    // (nothing above the seed's floor: the seed is the best, as its value was computed apart)
    let result =
      found ??
      (prepared.seed && {
        value: prepared.seed.value,
        artifactIds: prepared.seed.arts.map((a) => a.id),
      })
    // Quick: once more with the artifacts that can matter around the build found, if any were left
    // out (a piece can count only next to others: crit rate from them for a crit damage circlet)
    const wider =
      result &&
      (await prepared.refine?.(
        result.artifactIds
          .map((id) => input.arts.find((a) => a.id === id))
          .filter((a): a is ICachedArtifact => !!a)
      ))
    if (result && wider) {
      const again = await solveRaw({
        ...prepared.input,
        arts: wider,
        constraints: [
          ...input.constraints,
          {
            value: input.objective,
            min: result.value + Math.abs(result.value) * 1e-9,
          },
        ],
      })
      if (again && again.value > result.value) result = again
    }
    profile.solves++
    profile.solveMs += performance.now() - t0
    if (result) profile.found++
    // a build found is the problem's best (floors only cut what is below it)
    const entry = result
      ? { best: result }
      : { ...known, below: Math.min(known?.below ?? floor, floor) }
    solveMemo.delete(key)
    solveMemo.set(key, entry)
    if (solveMemo.size > SOLVE_MEMO_SIZE)
      solveMemo.delete(solveMemo.keys().next().value as string)
    return result
  }
  const members = teamOptMembers(database, teamId)
  // (one set left on among the sets the inventory has pieces of: its 4 pieces in every build)
  const owned = new Set<string>(database.arts.values.map((a) => a.setKey))
  const optConfigs = Object.fromEntries(
    members.map((m) => {
      const optConfig = database.optConfigs.get(m.teamChar.optConfigId)
      return [
        m.characterKey,
        optConfig && {
          ...optConfig,
          artSetExclusion: withForcedSet(optConfig.artSetExclusion, owned),
        },
      ]
    })
  ) as Partial<Record<CharacterKey, OptConfig>>
  const statFilters = Object.fromEntries(
    members.map((m) => [
      m.characterKey,
      optConfigs[m.characterKey]?.statFilters ?? {},
    ])
  ) as Partial<Record<CharacterKey, StatFilters>>
  const mainStatAssumptionLevel = teamOpt.assumeMaxMain ? 20 : 0
  const attacks = withAttackStates(teamOpt.attacks, attackStates)
  // the extra buffs (food, an Abyss blessing...) of each member
  const shownBonusStats = teamOptBonusStats(
    teamOpt,
    members.map((m) => m.characterKey)
  )
  // (ranking: with the fight's averaged state buffs too)
  const bonusStats = rankingBonusStats
    ? Object.fromEntries(
        members.map(({ characterKey }) => [
          characterKey,
          addBonusStats(
            shownBonusStats[characterKey],
            rankingBonusStats[characterKey]
          ),
        ])
      )
    : shownBonusStats

  // The starting state: the members' current builds (an artifact in two of them stays with the
  // first) and weapons. An optimized member's excluded artifacts (the team's list, and its own
  // Optimize-tab list unless the team uses those) are left out: kept, they would stay whenever
  // nothing without them beats the current build. Kept members' builds stay whole.
  const excludedFrom = (member: TeamOptMember, id: string) =>
    !teamOpt.keep.includes(member.characterKey) &&
    (!!teamOpt.excludedArts?.includes(id) ||
      (!teamOpt.useExcludedArts &&
        !!optConfigs[member.characterKey]?.artExclusion.includes(id)))
  const state: TeamState = { builds: {}, weaponIds: {} }
  const claimed = new Set<string>()
  for (const member of members) {
    if (member.isTc) continue
    state.builds[member.characterKey] = objKeyMap(
      allArtifactSlotKeys,
      (slotKey) => {
        const id = member.artifactIds[slotKey]
        if (!id || claimed.has(id) || !database.arts.get(id)) return undefined
        if (excludedFrom(member, id)) return undefined
        claimed.add(id)
        return id
      }
    )
    if (database.weapons.get(member.weaponId))
      state.weaponIds[member.characterKey] = member.weaponId
  }
  if (from) {
    for (const [ck, build] of Object.entries(from.builds) as [
      CharacterKey,
      TeamOptBuilds[CharacterKey],
    ][])
      if (build) state.builds[ck] = { ...build }
    for (const [ck, id] of Object.entries(from.weapons) as [
      CharacterKey,
      string | undefined,
    ][])
      if (id && database.weapons.get(id)) state.weaponIds[ck] = id
  }
  const artsIn = (s: TeamState, characterKey: CharacterKey) =>
    Object.values(s.builds[characterKey] ?? {})
      .map((id) => id && database.arts.get(id))
      .filter(notEmpty)
  const fixedArtsIn = (s: TeamState, except?: CharacterKey) =>
    Object.fromEntries(
      members
        .filter((m) => !m.isTc && m.characterKey !== except)
        .map((m) => [m.characterKey, artsIn(s, m.characterKey)])
    ) as Partial<Record<CharacterKey, ICachedArtifact[]>>
  /**
   * Every member's weapon in `s`. With `own`, `wielder` gets it instead, and a member holding it
   * gets `wielder`'s (equipping swaps them).
   */
  const weaponsIn = (
    s: TeamState,
    wielder?: CharacterKey,
    own?: ICachedWeapon
  ) => {
    const result: Partial<Record<CharacterKey, ICachedWeapon>> = {}
    for (const m of members) {
      if (m.isTc) continue
      let id = s.weaponIds[m.characterKey]
      if (wielder && own) {
        if (m.characterKey === wielder) id = own.id
        else if (id === own.id) id = s.weaponIds[wielder]
      }
      const weapon = id ? database.weapons.get(id) : undefined
      if (weapon) result[m.characterKey] = weapon
    }
    return result
  }
  // The states of sets and weapons that `s` gives nobody (the run's candidates, `teamOptRunGear`)
  // count nowhere: dropped, so the hits they split share buff contexts again. `dyn`'s sets stay
  // (its artifacts are the variables).
  const heldAttacksIn = (
    s: TeamState,
    weapons: Partial<Record<CharacterKey, ICachedWeapon>>,
    dyn?: CharacterKey
  ): TeamOpt['attacks'] => {
    const sets = new Map<string, Set<string>>()
    for (const [ck, arts] of Object.entries(fixedArtsIn(s, dyn))) {
      const counts = new Map<string, number>()
      for (const { setKey } of arts ?? [])
        counts.set(setKey, (counts.get(setKey) ?? 0) + 1)
      sets.set(
        ck,
        new Set([...counts].filter(([, n]) => n >= 2).map(([k]) => k))
      )
    }
    const held = ({
      owner,
      path: [key = ''],
    }: {
      owner: string
      path: readonly string[]
    }) => {
      if (SET_KEYS.has(key))
        return owner === dyn || (sets.get(owner)?.has(key) ?? true)
      const weapon = weapons[owner as CharacterKey]
      return !WEAPON_KEYS.has(key) || !weapon || weapon.key === key
    }
    const played = rotationForWeapons?.(weapons)
    const current = played
      ? withAttackStates(played.attacks, attackStates)
      : attacks
    return Object.fromEntries(
      Object.entries(current).map(([ck, list]) => [
        ck,
        list?.map((a) => ({
          ...a,
          ...(a.states && { states: a.states.filter(held) }),
          ...(a.limits && { limits: a.limits.filter(held) }),
          ...(a.statSnapshots && {
            statSnapshots: a.statSnapshots.map((snap) => ({
              ...snap,
              states: snap.states.filter(held),
            })),
          }),
          ...(a.reactionContributorStates && {
            reactionContributorStates: Object.fromEntries(
              Object.entries(a.reactionContributorStates).map(([k, v]) => [
                k,
                v?.filter(held),
              ])
            ),
          }),
        })),
      ])
    ) as TeamOpt['attacks']
  }
  // (a state is evaluated once: several steps ask for the same one)
  const evaluations = new Map<string, ReturnType<typeof evaluateInRaw>>()
  const evaluateIn = (s: TeamState) => {
    const key = JSON.stringify([s.builds, s.weaponIds])
    if (evaluations.has(key)) return evaluations.get(key)
    const t0 = performance.now()
    const result = evaluateInRaw(s)
    profile.evals++
    profile.evalMs += performance.now() - t0
    evaluations.set(key, result)
    return result
  }
  const evaluateInRaw = (s: TeamState, shown = false) => {
    const weapons = weaponsIn(s)
    return evaluateTeamRotation(database, teamId, gender, {
      arts: fixedArtsIn(s),
      attacks: heldAttacksIn(s, weapons),
      mainStatAssumptionLevel,
      statFilters: teamStatFilters(statFilters, weapons, teamOpt),
      weapons,
      onField: teamOpt.onField,
      bonusStats: shown ? shownBonusStats : bonusStats,
    })
  }
  /** `s`'s damage as the result shows it (without the ranking's bonus stats) */
  const shownIn = (s: TeamState, ranked: TeamOptEvaluation) =>
    rankingBonusStats ? (evaluateInRaw(s, true) ?? ranked) : ranked

  const before = evaluateIn(state)
  if (!before) return undefined
  const start = copyState(state)
  const savedOrder = new Map(
    (maxRounds === 0 ? from?.optimized : undefined)?.map((key, i) => [key, i])
  )
  const order = members
    .filter((m) => !m.isTc && !teamOpt.keep.includes(m.characterKey))
    .sort(
      (a, b) =>
        (savedOrder.get(a.characterKey) ?? members.length) -
          (savedOrder.get(b.characterKey) ?? members.length) ||
        (before.members[b.characterKey] ?? 0) -
          (before.members[a.characterKey] ?? 0)
    )
  const teamLocations = new Set(members.map((m) => m.location as string))
  const allArts = database.arts.values
  const shouldFold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'

  /**
   * A member's problem in `s`, with `weapon` (else its weapon in `s`): the team's damage as a
   * function of its artifacts, its constraints, and the other members whose (fixed) builds do not
   * meet theirs
   */
  // Problems compiled in this run and cached across runs in a pooled worker. Everything outside
  // the per-step weapon/build state is hashed into `problemRunKey` so any inventory, character,
  // enemy, conditional or rotation change cleanly misses the cache.
  const teamEntry = database.teams.get(teamId)
  const problemRunKey = hash53(
    JSON.stringify({
      teamId,
      gender,
      mainStatAssumptionLevel,
      onField: teamOpt.onField,
      energySource: teamOpt.energySource,
      energyCalculator: teamOpt.energyCalculator,
      rotationTime: teamOpt.rotationTime,
      weaponEnergy: teamOpt.weaponEnergy,
      attacks,
      rotationKey,
      bonusStats,
      statFilters,
      teamCond: teamEntry?.conditional,
      enemyOverride: teamEntry?.enemyOverride,
      members: members.map((m) => ({
        ck: m.characterKey,
        char: database.chars.get(m.characterKey),
        tc: m.teamChar,
        buildTc: m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)
          : undefined,
      })),
    })
  )
  const artSig = (id: string | undefined) => {
    const a = id ? database.arts.get(id) : undefined
    if (!a) return ''
    return `${a.setKey}:${a.slotKey}:${a.rarity}:${a.level}:${a.mainStatKey}:${a.substats.map((x) => `${x.key}=${x.value}`).join(',')}`
  }
  const wepSig = (w: ICachedWeapon | undefined) =>
    w ? `${w.id}:${w.key}:${w.level}:${w.ascension}:${w.refinement}` : ''
  const problems = new Map<string, ReturnType<typeof problemInRaw>>()
  const problemIn = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const weapons = weaponsIn(s, characterKey, weapon)
    const key = members
      .map(
        (m) =>
          `${m.characterKey}:${weapons[m.characterKey]?.id ?? ''}:${
            m.characterKey === characterKey
              ? '*'
              : Object.values(s.builds[m.characterKey] ?? {}).join(',')
          }`
      )
      .join('|')
    const id = `${characterKey}>${key}`
    if (problems.has(id)) {
      profile.problemHits++
      return problems.get(id)
    }
    const crossKey = `${problemRunKey}|${characterKey}|${hash53(
      members
        .map(
          (m) =>
            `${m.characterKey}:${wepSig(weapons[m.characterKey])}:${
              m.characterKey === characterKey
                ? '*'
                : allArtifactSlotKeys
                    .map((slot) => artSig(s.builds[m.characterKey]?.[slot]))
                    .join(';')
            }`
        )
        .join('|')
    )}`
    if (problemMemo.has(crossKey)) {
      const cached = problemMemo.get(crossKey)
      problemMemo.delete(crossKey)
      problemMemo.set(crossKey, cached)
      profile.problemHits++
      problems.set(id, cached)
      return cached
    }
    const t0 = performance.now()
    const result = problemInRaw(s, characterKey, weapon)
    profile.problems++
    profile.problemMs += performance.now() - t0
    problems.set(id, result)
    problemMemo.set(crossKey, result)
    if (problemMemo.size > PROBLEM_MEMO_SIZE)
      problemMemo.delete(problemMemo.keys().next().value as string)
    return result
  }
  const problemInRaw = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const weapons = weaponsIn(s, characterKey, weapon)
    const nodes = teamRotationNodes(database, teamId, gender, {
      dyn: characterKey,
      arts: fixedArtsIn(s, characterKey),
      attacks: heldAttacksIn(s, weapons, characterKey),
      mainStatAssumptionLevel,
      // the team's energy weapons lower the members' Energy Recharge requirements
      statFilters: teamStatFilters(statFilters, weapons, teamOpt),
      weapons,
      onField: teamOpt.onField,
      bonusStats,
    })
    if (!nodes) return undefined
    const [objective] = optimize(
      [
        nodes.terms.length
          ? sum(...nodes.terms.map((t) => t.node))
          : constant(0),
      ],
      {},
      shouldFold
    )
    // constraints that do not depend on this member are what they are: nothing to optimize
    const constraints = nodes.constraints
      .filter(({ value }) => value.operation !== 'const')
      .map(({ value, min, path }) => ({ value, min, path }))
    const unmetOthers = new Set(
      nodes.constraints
        .filter(
          (c) =>
            c.characterKey !== characterKey &&
            c.value.operation === 'const' &&
            !(constValue(c.value) >= c.min)
        )
        .map((c) => c.characterKey)
    )
    return { objective, constraints, unmetOthers }
  }
  type Problem = NonNullable<ReturnType<typeof problemIn>>
  /** A member's build in `s`: its value (the team's damage) and whether it meets its constraints */
  const currentIn = (
    s: TeamState,
    characterKey: CharacterKey,
    {
      objective,
      constraints,
    }: Pick<TeamOptSolveInput, 'objective' | 'constraints'>
  ) => {
    const arts = artsIn(s, characterKey)
    const [value, ...values] = evaluateNodes(
      [objective, ...constraints.map(({ value }) => value)],
      arts,
      mainStatAssumptionLevel
    )
    return {
      value,
      // (its set rules too: a current build outside them is no floor, whatever it is worth)
      ok:
        constraints.every(({ min }, j) => values[j] >= min) &&
        keepsSetRules(characterKey, arts),
    }
  }
  /** Whether `arts` keep to `characterKey`'s set rules */
  const keepsSetRules = (
    characterKey: CharacterKey,
    arts: readonly ICachedArtifact[]
  ) => meetsSetRules(arts, optConfigs[characterKey]?.artSetExclusion)
  /**
   * Whether `after` breaks an optimized member's set rules that `before` kept (a piece swapped
   * away, or in)
   */
  const breaksSetRules = (before: TeamState, after: TeamState) =>
    order.some(
      ({ characterKey }) =>
        !keepsSetRules(characterKey, artsIn(after, characterKey)) &&
        keepsSetRules(characterKey, artsIn(before, characterKey))
    )
  /**
   * Each stat's range over the builds of `arts`: its lowest and highest in each slot, added up (a
   * stat a piece lacks counts as 0)
   */
  const poolRanges = new WeakMap<readonly ICachedArtifact[], DynMinMax>()
  const rangeOf = (arts: readonly ICachedArtifact[]) => {
    let ranges = poolRanges.get(arts)
    if (ranges) return ranges
    ranges = {}
    for (const slotKey of allArtifactSlotKeys) {
      const pieces = arts
        .filter((art) => art.slotKey === slotKey)
        .map((art) => teamOptArtValues(art, mainStatAssumptionLevel))
      for (const key of new Set(pieces.flatMap((v) => Object.keys(v)))) {
        let min = Number.POSITIVE_INFINITY,
          max = Number.NEGATIVE_INFINITY
        for (const values of pieces) {
          const v = values[key] ?? 0
          if (v < min) min = v
          if (v > max) max = v
        }
        const total = (ranges[key] ??= { min: 0, max: 0 })
        total.min += min
        total.max += max
      }
    }
    poolRanges.set(arts, ranges)
    return ranges
  }
  const rangeEvaluators = new WeakMap<
    OptNode,
    ReturnType<typeof nodeRangeEvaluator>
  >()
  /**
   * Minimums against the pieces of `arts`: the most each can reach (at most: every stat at its best
   * in each slot at once, as one formula of them), and whether every one can reach what it needs.
   * One that cannot is out of reach for any build of them: there is nothing to search.
   */
  const ceilingsIn = (
    constraints: readonly { value: OptNode; min: number }[],
    arts: readonly ICachedArtifact[]
  ) => {
    const reads = rangeOf(arts)
    const most = constraints.map(({ value }) => {
      let evaluate = rangeEvaluators.get(value)
      if (!evaluate)
        rangeEvaluators.set(value, (evaluate = nodeRangeEvaluator([value])))
      return evaluate(reads)[0].max
    })
    return {
      most,
      reachable: constraints.every(
        ({ min }, j) => !(most[j] < min - Math.abs(min) * MIN_GAIN)
      ),
    }
  }
  /** Per member, its minimums at its last step: for each, the weapon that got closest to it */
  const minimumNotes = new Map<CharacterKey, Map<string, TeamOptShortfall>>()
  /** `notes` with `constraints`' ceilings (`most`) where they come closer to what they need */
  const noteMinimums = (
    notes: Map<string, TeamOptShortfall>,
    constraints: readonly { min: number; path?: string[] }[],
    most: readonly number[]
  ) =>
    constraints.forEach(({ min, path }, j) => {
      if (!path) return
      const key = path.join('.')
      const was = notes.get(key)
      if (!was || most[j] - min > was.value - was.min)
        notes.set(key, { path, min, value: most[j] })
    })
  /** Whether the team's energy weapons may lower `characterKey`'s Energy Recharge minimum */
  const erMayDrop = (characterKey: CharacterKey) =>
    teamOpt.energySource === 'calculator' ||
    Object.values(teamOpt.weaponEnergy).some(
      (byMember) => (byMember?.[characterKey] ?? 0) > 0
    )
  /**
   * A member's minimums with `weapon` (else its own), compiled alone: no damage, a fraction of a
   * problem's work
   */
  const minimumsIn = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const weapons = weaponsIn(s, characterKey, weapon)
    const nodes = teamRotationNodes(database, teamId, gender, {
      dyn: characterKey,
      arts: fixedArtsIn(s, characterKey),
      attacks: {},
      mainStatAssumptionLevel,
      statFilters: teamStatFilters(statFilters, weapons, teamOpt),
      weapons,
      onField: teamOpt.onField,
      bonusStats,
    })
    return (nodes?.constraints ?? [])
      .filter(
        (c) => c.characterKey === characterKey && c.value.operation !== 'const'
      )
      .map(({ value, min, path }) => ({ value, min, path }))
  }
  const isFull = (s: TeamState, characterKey: CharacterKey) =>
    allArtifactSlotKeys.every((slotKey) => s.builds[characterKey]?.[slotKey])
  /** The member's build in `s`, in slot order */
  const slotsIn = (s: TeamState, characterKey: CharacterKey) =>
    allArtifactSlotKeys.map((slotKey) => {
      const id = s.builds[characterKey]?.[slotKey]
      return id ? database.arts.get(id) : undefined
    })
  const prefilterProblem = (
    characterKey: CharacterKey,
    pool: readonly ICachedArtifact[],
    { objective, constraints }: Problem
  ): PrefilterProblem => ({
    arts: pool,
    objective,
    constraints,
    values: (art) => teamOptArtValues(art, mainStatAssumptionLevel),
    allowed: (build) =>
      meetsSetRules(build, optConfigs[characterKey]?.artSetExclusion),
  })
  /**
   * The best a climb (`climbFrom`) reaches from the member's build in `s` and from each of `starts`
   * (a build in slot order); not `feasible` when none meets the requirements
   */
  const climbIn = async (
    s: TeamState,
    characterKey: CharacterKey,
    pool: readonly ICachedArtifact[],
    problem: Problem,
    starts: readonly (ICachedArtifact | undefined)[][] = []
  ) => {
    const climbed = await Promise.all(
      [slotsIn(s, characterKey), ...starts].map((start) =>
        climbFrom(prefilterProblem(characterKey, pool, problem), start)
      )
    )
    return climbed.reduce((a, b) =>
      b.feasible && (!a.feasible || b.value > a.value) ? b : a
    )
  }
  /**
   * What `member` is worth to the team in `s` with `weapon` by a climb from its build, plus what
   * each of `lowered` (teammates whose Energy Recharge requirement the weapon lowers) gains by a
   * climb from its own. `Infinity` when a climb meets no requirement: no estimate.
   */
  const estimateIn = async (
    s: TeamState,
    member: TeamOptMember,
    weapon: ICachedWeapon,
    problem: Problem,
    pool: readonly ICachedArtifact[],
    lowered: readonly TeamOptMember[],
    starts: readonly (ICachedArtifact | undefined)[][]
  ) => {
    const own = await climbIn(s, member.characterKey, pool, problem, starts)
    if (!own.feasible) return Number.POSITIVE_INFINITY
    let estimate = own.value
    if (!lowered.length) return estimate
    const next = copyState(s)
    assign(next, member, undefined, weapon.id)
    for (const other of lowered) {
      const ck = other.characterKey
      const optConfig = optConfigs[ck]
      const theirs = problemIn(next, ck)
      if (!optConfig || !theirs) return Number.POSITIVE_INFINITY
      const taken = new Set(
        members
          .filter((m) => m.characterKey !== ck)
          .flatMap((m) => Object.values(next.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const climbed = await climbIn(
        next,
        ck,
        teamOptPool(allArts, other, optConfig, teamOpt, teamLocations, taken),
        theirs
      )
      if (!climbed.feasible) return Number.POSITIVE_INFINITY
      estimate += Math.max(0, climbed.value - currentIn(next, ck, theirs).value)
    }
    return estimate
  }
  /**
   * Gives `member` a build and/or a weapon in `s`. A piece it takes from another member is
   * swapped, as equipping does: that member gets this one's previous piece of the slot (if it may
   * use it), so that a member whose artifacts barely matter keeps a full build and changes
   * little. The same for the weapon (a member holding it wields the same type).
   */
  const assign = (
    s: TeamState,
    member: TeamOptMember,
    artifactIds: string[] | undefined,
    weaponId?: string
  ) => {
    const { characterKey } = member
    if (artifactIds) {
      const previous: Partial<Record<ArtifactSlotKey, string>> =
        s.builds[characterKey] ?? {}
      const build = bySlot(database, artifactIds)
      s.builds[characterKey] = build
      for (const other of members) {
        const otherBuild = s.builds[other.characterKey]
        if (other.characterKey === characterKey || !otherBuild) continue
        for (const slotKey of allArtifactSlotKeys) {
          const id = otherBuild[slotKey]
          if (!id || build[slotKey] !== id) continue
          const swap =
            previous[slotKey] && database.arts.get(previous[slotKey]!)
          const otherConfig = optConfigs[other.characterKey]
          otherBuild[slotKey] =
            swap &&
            otherConfig &&
            teamOptPool(
              [swap],
              other,
              otherConfig,
              teamOpt,
              teamLocations,
              new Set()
            ).length
              ? swap.id
              : undefined
        }
      }
    }
    const currentWeaponId = s.weaponIds[characterKey] ?? member.weaponId
    if (weaponId && weaponId !== currentWeaponId) {
      for (const other of members)
        if (
          other.characterKey !== characterKey &&
          s.weaponIds[other.characterKey] === weaponId
        )
          s.weaponIds[other.characterKey] = currentWeaponId
      s.weaponIds[characterKey] = weaponId
    }
  }
  /**
   * Re-optimizes `group` in `s` (artifacts only), in the order members are optimized: like in a
   * first round, each one may take pieces from the members after it, and from `takeable`'s
   * (swapped). `undefined` if one of them can no longer meet its requirements (and could before:
   * not in `unmetBefore`).
   */
  const reoptimizeIn = async (
    s: TeamState,
    group: TeamOptMember[],
    takeable: readonly TeamOptMember[],
    unmetBefore: ReadonlySet<CharacterKey>,
    report: (member: TeamOptMember) => void | Promise<void>,
    background = false
  ) => {
    for (const [j, member] of group.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await report(member)
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(s, characterKey)
      if (!problem) return undefined
      const pair = s.lockedPairs?.[characterKey]
      const constraints = pair
        ? [
            ...problem.constraints,
            ...pair.map((key) => ({ value: dynRead(key), min: 2 })),
          ]
        : problem.constraints
      const current = currentIn(s, characterKey, {
        objective: problem.objective,
        constraints,
      })
      const full = isFull(s, characterKey)
      const beat = beatOf(
        current.ok && full ? current.value : Number.NEGATIVE_INFINITY
      )
      const open = [
        ...takeable,
        ...group.slice(j + 1).filter((m) => !s.lockedPairs?.[m.characterKey]),
      ]
      const taken = new Set(
        members
          .filter((m) => m.characterKey !== characterKey && !open.includes(m))
          .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const input = {
        characterKey,
        background,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          taken
        ),
        objective: problem.objective,
        constraints: Number.isFinite(beat)
          ? [...constraints, { value: problem.objective, min: beat }]
          : constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      }
      // (a minimum none of these pieces can reach: nothing to search)
      const result = ceilingsIn(constraints, input.arts).reachable
        ? await solve(input)
        : undefined
      if (isCancelled()) throw new TeamOptCancelled()
      if (result && result.value >= beat) assign(s, member, result.artifactIds)
      else if (!current.ok && !unmetBefore.has(characterKey)) return undefined
    }
    return s
  }

  /**
   * A member's problem in `s` (with `weapon`, else its own), compiled: the team's damage and
   * whether the member's constraints are met, for any build of it (the others fixed)
   */
  const compileIn = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const problem = problemIn(s, characterKey, weapon)
    if (!problem) return undefined
    const compute = precompute(
      [problem.objective, ...problem.constraints.map(({ value }) => value)],
      {},
      (r) => r.path[1],
      allArtifactSlotKeys.length
    )
    return (build: Partial<Record<ArtifactSlotKey, string | undefined>>) => {
      const [value, ...values] = compute(
        allArtifactSlotKeys.map((slotKey) => {
          const id = build[slotKey]
          const art = id ? database.arts.get(id) : undefined
          return {
            values: art ? teamOptArtValues(art, mainStatAssumptionLevel) : {},
          }
        }) as never
      )
      return {
        value,
        ok: problem.constraints.every(({ min }, j) => values[j] >= min),
      }
    }
  }
  /**
   * Whether `after` leaves a requirement further from what it needs than `before`: one that was met
   * is not, or one that was not (no build of its member meets it: it has the closest) drops further
   */
  const worsened = (before: TeamOptEvaluation, after: TeamOptEvaluation) =>
    members.some(({ characterKey }) => {
      const unmetAfter = after.unmet[characterKey] ?? []
      const unmetBefore = before.unmet[characterKey] ?? []
      return unmetAfter.some((index, j) => {
        const at = unmetBefore.indexOf(index)
        if (at < 0) return true
        const was = before.shortfalls?.[characterKey]?.[at]
        const now = after.shortfalls?.[characterKey]?.[j]
        return (
          !!was &&
          !!now &&
          now.min - now.value >
            was.min - was.value + Math.abs(was.min) * MIN_GAIN
        )
      })
    })
  const mayUse = (member: TeamOptMember, art: ICachedArtifact) => {
    const optConfig = optConfigs[member.characterKey]
    return (
      !!optConfig &&
      !!teamOptPool([art], member, optConfig, teamOpt, teamLocations, new Set())
        .length
    )
  }
  /** The optimized members whose build in `s` breaks their set rules */
  const outsideSetRules = (s: TeamState) =>
    order.filter(
      ({ characterKey }) =>
        !keepsSetRules(characterKey, artsIn(s, characterKey))
    )
  /** The optimized members whose build in `s` misses one of their minimums */
  const belowMinimumsIn = (s: TeamState) => {
    const unmet = evaluateIn(s)?.unmet ?? {}
    return order.filter(({ characterKey }) => unmet[characterKey]?.length)
  }
  /**
   * Set rules and minimums come before damage. A member left outside its set rules (no build of the
   * free pieces keeps to them, say another member holds the only pieces of its set), or below its
   * minimums (another member holds the pieces that reach them), takes, among everything but the
   * kept members' pieces, its best build that keeps to them; the others get its previous pieces, as
   * equipping does, and settle again in the next round. A repair stands when no other member's set
   * rules break, so each one leaves fewer members outside them (and, for minimums, no more outside
   * their set rules).
   */
  const repairIn = async (s: TeamState, round: number) => {
    let repaired = false
    const kept = new Set<string>(
      members
        .filter((m) => !order.includes(m))
        .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
        .filter(notEmpty)
    )
    for (const [i, member] of order.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig) continue
      const outside = !keepsSetRules(characterKey, artsIn(s, characterKey))
      if (!outside && !belowMinimumsIn(s).includes(member)) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await onStep?.({
        round,
        maxRounds,
        step: i + 1,
        steps: order.length,
        characterKey,
        exchange: true,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(s, characterKey)
      if (!problem) continue
      const input = {
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          kept
        ),
        objective: problem.objective,
        constraints: problem.constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      }
      // its minimums too if a build reaches them (none of these pieces can: nothing to search),
      // else its set rules alone (the run then stops below its minimums)
      const reaches = ceilingsIn(problem.constraints, input.arts).reachable
      const result =
        (reaches ? await solve(input) : undefined) ??
        (outside ? await solve({ ...input, constraints: [] }) : undefined)
      if (isCancelled()) throw new TeamOptCancelled()
      if (!result) continue
      const next = copyState(s)
      assign(next, member, result.artifactIds)
      if (breaksSetRules(s, next)) continue
      if (
        outside
          ? outsideSetRules(next).length >= outsideSetRules(s).length
          : outsideSetRules(next).length > outsideSetRules(s).length ||
            belowMinimumsIn(next).length >= belowMinimumsIn(s).length
      )
        continue
      s.builds = next.builds
      s.weaponIds = next.weaponIds
      repaired = true
    }
    return repaired
  }
  /**
   * Exchanges a member's own step cannot make, as it does not take what a settled member holds:
   * a member re-optimized with the others' pieces too (they get its previous ones, as equipping
   * does), then two members swapping the pieces (or weapons) of a slot. Each is kept only if the
   * team's damage grows, and no requirement that was met is broken.
   */
  const exchangeIn = async (s: TeamState, round: number) => {
    let current = evaluateIn(s)
    if (!current) return false
    let improved = false
    const accept = (next: TeamState) => {
      const evaluation = evaluateIn(next)
      if (
        !evaluation ||
        !(evaluation.total >= beatOf(current!.total)) ||
        worsened(current!, evaluation) ||
        breaksSetRules(s, next)
      )
        return false
      s.builds = next.builds
      s.weaponIds = next.weaponIds
      current = evaluation
      improved = true
      return true
    }
    // Takes: a member's best build among everything but the kept members' pieces
    const kept = new Set<string>(
      members
        .filter((m) => !order.includes(m))
        .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
        .filter(notEmpty)
    )
    for (const [i, member] of order.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig || !isFull(s, characterKey)) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await onStep?.({
        round,
        maxRounds,
        step: i + 1,
        steps: order.length,
        characterKey,
        exchange: true,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(s, characterKey)
      if (!problem) continue
      const own = currentIn(s, characterKey, problem)
      if (!own.ok) continue
      const others = new Set<string>(
        order
          .filter((m) => m !== member)
          .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const result = await solve({
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          kept
        ),
        objective: problem.objective,
        constraints: [
          ...problem.constraints,
          { value: problem.objective, min: beatOf(own.value) },
        ],
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      // (a build of free pieces only: its own step would have found it)
      if (!result?.artifactIds.some((id) => others.has(id))) continue
      const next = copyState(s)
      assign(next, member, result.artifactIds)
      accept(next)
    }
    // Swaps: two members trade the pieces of a slot, or their weapons
    for (let pass = 0; pass < 3; pass++) {
      let swapped = false
      const fns = new Map<CharacterKey, ReturnType<typeof compileIn>>()
      for (const m of order) {
        await yieldBetweenSteps()
        fns.set(m.characterKey, compileIn(s, m.characterKey))
      }
      const gain = (
        member: TeamOptMember,
        slotKey: ArtifactSlotKey,
        id: string
      ) => {
        const fn = fns.get(member.characterKey)
        const build = s.builds[member.characterKey]
        if (!fn || !build) return Number.NEGATIVE_INFINITY
        const now = fn(build)
        const then = fn({ ...build, [slotKey]: id })
        return now.ok && !then.ok
          ? Number.NEGATIVE_INFINITY
          : then.value - now.value
      }
      for (const slotKey of allArtifactSlotKeys)
        for (const [i, a] of order.entries())
          for (const b of order.slice(i + 1)) {
            const idA = s.builds[a.characterKey]?.[slotKey]
            const idB = s.builds[b.characterKey]?.[slotKey]
            if (!idA || !idB || idA === idB) continue
            const artA = database.arts.get(idA)
            const artB = database.arts.get(idB)
            if (!artA || !artB || !mayUse(a, artB) || !mayUse(b, artA)) continue
            // estimated with each member's compiled problem, then checked with the whole team
            if (!(gain(a, slotKey, idB) + gain(b, slotKey, idA) > 0)) continue
            const next = copyState(s)
            next.builds[a.characterKey]![slotKey] = idB
            next.builds[b.characterKey]![slotKey] = idA
            if (accept(next)) {
              swapped = true
              await yieldBetweenSteps()
              fns.set(a.characterKey, compileIn(s, a.characterKey))
              await yieldBetweenSteps()
              fns.set(b.characterKey, compileIn(s, b.characterKey))
            }
          }
      if (teamOpt.optimizeWeapons) {
        for (const [i, a] of order.entries())
          for (const b of order.slice(i + 1)) {
            const weaponA = database.weapons.get(
              s.weaponIds[a.characterKey] ?? ''
            )
            const weaponB = database.weapons.get(
              s.weaponIds[b.characterKey] ?? ''
            )
            if (!weaponA || !weaponB || weaponA.id === weaponB.id) continue
            if (
              isWeaponExcludedFor(a.characterKey, weaponB, teamOpt) ||
              isWeaponExcludedFor(b.characterKey, weaponA, teamOpt)
            )
              continue
            if (
              !canWield(a.characterKey, weaponB) ||
              !canWield(b.characterKey, weaponA)
            )
              continue
            const buildA = s.builds[a.characterKey] ?? {}
            const buildB = s.builds[b.characterKey] ?? {}
            const nowA = fns.get(a.characterKey)?.(buildA)
            const nowB = fns.get(b.characterKey)?.(buildB)
            await yieldBetweenSteps()
            const thenA = compileIn(s, a.characterKey, weaponB)?.(buildA)
            await yieldBetweenSteps()
            const thenB = compileIn(s, b.characterKey, weaponA)?.(buildB)
            if (!nowA || !nowB || !thenA || !thenB) continue
            if (thenA.value - nowA.value + (thenB.value - nowB.value) <= 0)
              continue
            const next = copyState(s)
            next.weaponIds[a.characterKey] = weaponB.id
            next.weaponIds[b.characterKey] = weaponA.id
            if (accept(next)) {
              swapped = true
              await yieldBetweenSteps()
              fns.set(a.characterKey, compileIn(s, a.characterKey))
              await yieldBetweenSteps()
              fns.set(b.characterKey, compileIn(s, b.characterKey))
            }
          }
      }
      if (!swapped) break
    }
    return improved
  }

  let rounds = 0
  let exchanges = 0
  /**
   * In the first round, the members not optimized yet hold their builds and weapons only
   * provisionally (`provisional`): the bigger damage dealers before them may take any of those.
   * Without it, every member keeps what it has until its turn, and each step only adds damage.
   */
  let provisional = !skipProvisional
  const runRounds = async () => {
    const optimizedOnce = new Set<CharacterKey>()
    let repairRoundTried = false
    for (let round = 1; round <= maxRounds && order.length; round++) {
      rounds = round
      let changed = false
      // When a member still misses a requirement after everyone has had a turn, run the repair
      // round lowest-DPS first so supports take energy weapons before the main carry does.
      const repairing = round > 1 && belowMinimumsIn(state).length > 0
      const roundOrder = repairing ? [...order].reverse() : order
      for (const [i, member] of roundOrder.entries()) {
        const { characterKey } = member
        const step: TeamOptStep = {
          round,
          maxRounds,
          step: i + 1,
          steps: order.length,
          characterKey,
        }
        if (isCancelled()) throw new TeamOptCancelled()
        // (the caller may let the page show the step before the work starts)
        await onStep?.(step)
        if (isCancelled()) throw new TeamOptCancelled()
        const optConfig = optConfigs[characterKey]
        if (!optConfig) continue
        // In the first round, the members not optimized yet only hold their current builds (and
        // weapons) provisionally: the bigger damage dealers before them may take any of those
        // (they are optimized right after, with what is left). Afterwards, everything is kept
        // until its member's turn.
        const settled = members.filter(
          (m) =>
            m.characterKey !== characterKey &&
            (round > 1 || !provisional || !order.slice(i).includes(m))
        )
        const taken = new Set(
          settled
            .flatMap((m) => Object.values(state.builds[m.characterKey] ?? {}))
            .filter(notEmpty)
        )
        const arts = teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          taken
        )
        const currentWeaponId = state.weaponIds[characterKey] ?? member.weaponId
        const currentWeapon = database.weapons.get(currentWeaponId)
        const allowedWeapons = weaponFilter?.[characterKey]
        const rawWeapons = teamOpt.optimizeWeapons
          ? teamOptWeaponCandidates(
              database,
              member,
              currentWeaponId,
              teamOpt,
              teamLocations,
              new Set(
                settled
                  .map((m) => state.weaponIds[m.characterKey])
                  .filter(notEmpty)
              )
            )
          : []
        const weaponChoices = allowedWeapons
          ? rawWeapons.filter(
              (w) => w.id === currentWeaponId || allowedWeapons.has(w.id)
            )
          : rawWeapons
        if (!weaponChoices.length && currentWeapon)
          weaponChoices.push(currentWeapon)
        // A build with an empty slot (a piece went to a member optimized before) takes any full one
        const full = isFull(state, characterKey)
        // what the team's energy weapons lower each member's Energy Recharge requirement by, now
        const need = teamEnergyNeeds(statFilters, weaponsIn(state), teamOpt)
        let unmetNow: ReadonlySet<CharacterKey> | undefined
        const unmetBefore = () =>
          (unmetNow ??= new Set(
            Object.entries(evaluateIn(state)?.unmet ?? {})
              .filter(([, unmet]) => unmet?.length)
              .map(([key]) => key as CharacterKey)
          ))
        /** What a new build must beat: the current one, then the best found so far */
        let floor = Number.NEGATIVE_INFINITY
        let bestRepairCount = 0
        let best:
          | {
              value: number
              artifactIds?: string[]
              weaponId: string
              /** The team once the members its energy weapon affects are re-optimized */
              next?: TeamState
            }
          | undefined
        // Every candidate weapon's problem, compiled once (cheap next to a solve), and what the
        // member's current build is worth with it, when that team is one it can have as it is (its
        // own and the others' requirements met). The best of those is a floor for every weapon's
        // solve, so each solve only looks above the best team known; a weapon change alone is a
        // result too. The strongest weapons go first; on a tie the current one stays.
        const candidates: {
          weapon: ICachedWeapon
          problem: ReturnType<typeof problemIn>
          current: number | undefined
          /** Its minimums are within reach of these pieces (else there is nothing to search) */
          reachable: boolean
        }[] = []
        const notes = new Map<string, TeamOptShortfall>()
        const hasMemberFilters = Object.values(
          statFilters[characterKey] ?? {}
        ).some((list) => list?.some((f) => !f.disabled))
        const ownArts = artsIn(state, characterKey)
        const fastCeilPool = ownArts.some((a) => !arts.includes(a))
          ? [...arts, ...ownArts]
          : arts
        for (const weapon of weaponChoices) {
          // (one problem at a time: several in a row froze a phone for a second)
          await yieldBetweenSteps()
          // Fast-reject weapons that cannot reach the member's minimums (e.g. ER) without
          // compiling the full multi-hundred-attack damage objective.
          if (hasMemberFilters && weaponChoices.length > 1) {
            const mins = minimumsIn(state, characterKey, weapon)
            const fastCeil = ceilingsIn(mins, fastCeilPool)
            if (!fastCeil.reachable) {
              noteMinimums(notes, mins, fastCeil.most)
              candidates.push({
                weapon,
                problem: undefined,
                current: undefined,
                reachable: false,
              })
              continue
            }
          }
          const problem = problemIn(state, characterKey, weapon)
          let current: number | undefined
          if (problem && full) {
            const own = currentIn(state, characterKey, problem)
            if (
              own.ok &&
              ![...problem.unmetOthers].some((key) => !unmetBefore().has(key))
            )
              current = own.value
          }
          const ceilings = problem && ceilingsIn(problem.constraints, arts)
          if (problem && ceilings)
            noteMinimums(notes, problem.constraints, ceilings.most)
          candidates.push({
            weapon,
            problem,
            current,
            reachable: !!ceilings?.reachable,
          })
        }
        minimumNotes.set(characterKey, notes)
        const currentOf = (c: (typeof candidates)[number]) =>
          c.current ?? Number.NEGATIVE_INFINITY
        candidates.sort(
          (a, b) =>
            currentOf(b) - currentOf(a) ||
            Number(b.weapon.id === currentWeaponId) -
              Number(a.weapon.id === currentWeaponId)
        )
        const ownValue = candidates.find(
          (c) => c.weapon.id === currentWeaponId
        )?.current
        const top = candidates[0]
        if (top?.current !== undefined) {
          floor = top.current
          // another weapon with the same build: worth it only for a real gain over keeping its own
          if (
            top.weapon.id !== currentWeaponId &&
            (ownValue === undefined || top.current >= beatOf(ownValue))
          )
            best = { value: top.current, weaponId: top.weapon.id }
        }
        /**
         * A candidate weapon's place in the loop: none (it breaks a requirement), solved with the
         * members whose Energy Recharge requirement it changes (`affected`), or solved on its own
         */
        const plan = (c: (typeof candidates)[number]) => {
          const { weapon, problem } = c
          if (!problem || !c.reachable) return undefined
          // The other members whose Energy Recharge requirement this weapon changes (it is an
          // energy weapon, or it replaces one)
          const needWith = teamEnergyNeeds(
            statFilters,
            weaponsIn(state, characterKey, weapon),
            teamOpt
          )
          const changes = members.filter(
            (m) =>
              !m.isTc &&
              m.characterKey !== characterKey &&
              needWith[m.characterKey] !== need[m.characterKey]
          )
          // a kept member's build stays as it is: the weapon must not break its requirement
          if (
            changes.some(
              (m) =>
                !order.includes(m) &&
                problem.unmetOthers.has(m.characterKey) &&
                !unmetBefore().has(m.characterKey)
            )
          )
            return undefined
          const affected = order.filter((m) => changes.includes(m))
          // a weapon that leaves another member's requirement unmet (one it met) is not one, unless
          // that member is re-optimized with it below (the energy it gives changes the requirement)
          if (
            [...problem.unmetOthers].some(
              (key) =>
                !unmetBefore().has(key) &&
                !affected.some((m) => m.characterKey === key)
            )
          )
            return undefined
          return { problem, needWith, affected }
        }
        const plans = candidates.map(plan)
        /** Whether a weapon only raises teammates' Energy Recharge requirements */
        const raisesOthers = ({
          affected,
          needWith,
        }: NonNullable<(typeof plans)[number]>) =>
          affected.length > 0 &&
          !affected.some(
            (m) => (needWith[m.characterKey] ?? 0) < (need[m.characterKey] ?? 0)
          )
        // Quick: only the weapons worth it are searched in full (`SCREEN_SHARE`); an energy weapon
        // counts what the teammates whose requirement it lowers gain too
        if (
          !teamOpt.fullSearch &&
          plans.filter(notEmpty).length > SCREEN_KEEP &&
          buildsOf(arts) >=
            (optimizerGpuSupported()
              ? teamOptScreen.fromBuilds
              : teamOptScreen.fromBuildsCpu)
        ) {
          // (a good build found fast for the first weapon: the climbs start from it too, as the
          // member's own build may be far from its best)
          const first = plans.find(notEmpty)
          const seed =
            first &&
            (await seedBuild(
              prefilterProblem(characterKey, arts, first.problem)
            ))
          const starts = seed
            ? [
                allArtifactSlotKeys.map((slotKey) =>
                  seed.arts.find((art) => art.slotKey === slotKey)
                ),
              ]
            : []
          const estimates: number[] = []
          for (const [w, p] of plans.entries()) {
            if (!p) continue
            if (isCancelled()) throw new TeamOptCancelled()
            await yieldBetweenSteps()
            const lowered = p.affected.filter(
              (m) =>
                (p.needWith[m.characterKey] ?? 0) < (need[m.characterKey] ?? 0)
            )
            estimates[w] = await estimateIn(
              state,
              member,
              candidates[w].weapon,
              p.problem,
              arts,
              lowered,
              starts
            )
          }
          const ranked = (raising: boolean) =>
            plans
              .flatMap((p, w) =>
                p &&
                Number.isFinite(estimates[w]) &&
                raisesOthers(p) === raising
                  ? [w]
                  : []
              )
              .sort((a, b) => estimates[b] - estimates[a])
          const below = (w: number, top: number) =>
            estimates[w] < top - Math.abs(top) * SCREEN_SHARE
          const drop = (w: number) => {
            plans[w] = undefined
            profile.screened++
          }
          const comparable = ranked(false)
          const top = comparable.length ? estimates[comparable[0]] : Number.NaN
          for (const [rank, w] of comparable.entries())
            if (
              rank >= SCREEN_KEEP &&
              candidates[w].weapon.id !== currentWeaponId &&
              !plans[w]?.affected.some(
                ({ characterKey: key }) =>
                  unmetBefore().has(key) &&
                  (plans[w]?.needWith[key] ?? 0) < (need[key] ?? 0)
              ) &&
              below(w, top)
            )
              drop(w)
          // (one that raises teammates' requirements counts them as met: held to the others' best
          // too, and ranked among its kind)
          const raising = ranked(true)
          const topRaising = raising.length ? estimates[raising[0]] : Number.NaN
          for (const [rank, w] of raising.entries())
            if (below(w, top) || (rank >= SCREEN_KEEP && below(w, topRaising)))
              drop(w)
        }
        // only a build that beats the floor is of interest: it also prunes the search
        const inputFor = (
          { objective, constraints }: Problem,
          beat: number
        ): TeamOptSolveInput => ({
          characterKey,
          arts,
          objective,
          constraints: Number.isFinite(beat)
            ? [...constraints, { value: objective, min: beat }]
            : constraints,
          exclusion: optConfig.artSetExclusion,
          mainStatAssumptionLevel,
        })
        // The next weapons solved on their own start early, above the floor known then: a floor
        // only prunes, so each finds what it would have found later, and is then held to the
        // floor reached by its turn (as when solved one after another). Scan past screened-out
        // weapons so Quick mode actually keeps `parallel` solves overlapped.
        const parallel = optimizerGpuSupported() ? parallelWeaponSolves : 1
        const early = new Map<number, ReturnType<TeamOptSolver>>()
        const startEarly = (from: number) => {
          for (
            let j = from + 1;
            j < candidates.length && early.size < parallel - 1;
            j++
          ) {
            const p = plans[j]
            if (!p || p.affected.length || early.has(j)) continue
            const solving = solve(inputFor(p.problem, beatOf(floor)))
            // (a run cancelled meanwhile stops it: nobody waits for it then)
            solving.catch(() => {})
            early.set(j, solving)
          }
        }
        // (progress counts the weapons searched)
        const searched = plans.filter(notEmpty).length
        let searching = 0
        for (const [w, { weapon }] of candidates.entries()) {
          if (isCancelled()) throw new TeamOptCancelled()
          const p = plans[w]
          if (!p) continue
          searching++
          const weaponStep: TeamOptStep =
            searched > 1
              ? { ...step, weapon: searching, weapons: searched }
              : step
          if (searched > 1) await onStep?.(weaponStep)
          const { problem, needWith, affected } = p
          const beat = beatOf(floor)
          const input = inputFor(problem, beat)
          if (affected.length) {
            // What the weapon is worth to the team is known once the members whose requirement it
            // changes are re-optimized with it, along with this one (in order, each taking what it
            // needs first). When they only lose, this member must first beat the floor on its own.
            const gains = affected.some(
              (m) =>
                (needWith[m.characterKey] ?? 0) < (need[m.characterKey] ?? 0)
            )
            if (!gains && Number.isFinite(beat) && !(await solve(input)))
              continue
            if (isCancelled()) throw new TeamOptCancelled()
            const next = copyState(state)
            assign(next, member, undefined, weapon.id)
            const reoptimized = await reoptimizeIn(
              next,
              order.filter((m) => m === member || affected.includes(m)),
              round === 1 && provisional
                ? order.slice(i + 1).filter((m) => !affected.includes(m))
                : [],
              unmetBefore(),
              (other) =>
                onStep?.(
                  other === member
                    ? weaponStep
                    : { ...weaponStep, energyFor: other.characterKey }
                )
            )
            const evaluation = reoptimized && evaluateIn(reoptimized)
            if (
              !evaluation ||
              members.some(
                (m) =>
                  evaluation.unmet[m.characterKey]?.length &&
                  !unmetBefore().has(m.characterKey)
              )
            )
              continue
            // An energy weapon can make a teammate's build viable even when the
            // team deals less damage. Keep that repair ahead of damage gains,
            // but only for teammates that already had a turn to meet their own
            // requirements (so an unoptimized starting build never forces the
            // main carry onto an energy weapon in round 1).
            const repaired = order.filter(
              (m) =>
                m !== member &&
                optimizedOnce.has(m.characterKey) &&
                unmetBefore().has(m.characterKey) &&
                !evaluation.unmet[m.characterKey]?.length
            ).length
            if (repaired && breaksSetRules(state, next)) continue
            if (
              (repaired === bestRepairCount && evaluation.total >= beat) ||
              repaired > bestRepairCount
            ) {
              bestRepairCount = repaired
              best = { value: evaluation.total, weaponId: weapon.id, next }
              floor = evaluation.total
            }
            continue
          }
          if (bestRepairCount) continue
          startEarly(w)
          const result = await (early.get(w) ?? solve(input))
          early.delete(w)
          if (isCancelled()) throw new TeamOptCancelled()
          if (result && result.value >= beat) {
            best = { ...result, weaponId: weapon.id }
            floor = Math.max(floor, result.value)
          }
        }
        // (no build reaches its minimums, whatever the weapon: it keeps what it has; a repair may
        // free the pieces that do, else the run stops below them)
        if (best) {
          if (best.next) {
            state.builds = best.next.builds
            state.weaponIds = best.next.weaponIds
          } else assign(state, member, best.artifactIds, best.weaponId)
          changed = true
        }
        optimizedOnce.add(characterKey)
      }
      // a member left outside its set rules takes the pieces it needs from the others
      if (order.length > 1 && (await repairIn(state, round))) changed = true
      // once the members' own steps settle: the exchanges between members (up to maxExchanges)
      if (!changed && exchanges < maxExchanges && order.length > 1) {
        exchanges++
        changed = await exchangeIn(state, round)
      }
      if (!changed) {
        if (belowMinimumsIn(state).length && !repairRoundTried) {
          repairRoundTried = true
          continue
        }
        break
      }
    }
  }
  // Minimums come first. An Energy Recharge minimum no build can reach, whatever the weapon (every
  // stat at its best in each slot, among every piece the member may use), stops the run before any
  // search, unless the team's energy weapons may lower it (the ER calculator's, or a weapon's Energy
  // for the member): the run sees those.
  const outOfReach: Partial<Record<CharacterKey, TeamOptShortfall[]>> = {}
  for (const member of order) {
    const { characterKey } = member
    const optConfig = optConfigs[characterKey]
    if (
      !optConfig ||
      erMayDrop(characterKey) ||
      !hasEnergyRequirement(statFilters[characterKey])
    )
      continue
    const pool = teamOptPool(
      allArts,
      member,
      optConfig,
      teamOpt,
      teamLocations,
      new Set()
    )
    const own = start.weaponIds[characterKey] ?? member.weaponId
    const weapons = teamOpt.optimizeWeapons
      ? teamOptWeaponCandidates(
          database,
          member,
          own,
          teamOpt,
          teamLocations,
          new Set()
        )
      : []
    const notes = new Map<string, TeamOptShortfall>()
    for (const weapon of weapons.length ? weapons : [undefined]) {
      if (isCancelled()) throw new TeamOptCancelled()
      await yieldBetweenSteps()
      const minimums = minimumsIn(start, characterKey, weapon).filter(
        ({ path }) => isErFilter(JSON.stringify(path))
      )
      noteMinimums(notes, minimums, ceilingsIn(minimums, pool).most)
    }
    const missed = [...notes.values()].filter(
      ({ value, min }) => value < min - Math.abs(min) * MIN_GAIN
    )
    if (missed.length) outOfReach[characterKey] = missed
  }
  if (Object.keys(outOfReach).length)
    throw new TeamOptRequirementsUnmet(outOfReach)

  await runRounds()
  // The provisional takes can leave the team below where it started: a bigger damage dealer's
  // step counts the later members' builds as they were, and those then lose what it took (say
  // its weapon, which another member keeps once settled). The result is never worse than the
  // members' own builds (when those keep every requirement and set rule): run again from them
  // without provisional takes (each step then only adds), else keep them as they are.
  const notBelowStart = () => {
    const now = evaluateIn(state)
    return (
      !now ||
      now.total >= before.total - Math.abs(before.total) * MIN_GAIN ||
      worsened(now, before) ||
      breaksSetRules(state, start)
    )
  }
  // A weapon left out in the weapon chooser (globally or for this member) is one a member only
  // keeps when none of the ticked ones is free for it: the members' own builds are no result to
  // fall back on when one of them holds such a weapon and the run found it a ticked one.
  const weaponOf = (s: TeamState, member: TeamOptMember) =>
    s.weaponIds[member.characterKey] ?? member.weaponId
  const weaponLeftOut = (member: TeamOptMember, weaponId: string) => {
    if (!teamOpt.optimizeWeapons) return false
    const weapon = database.weapons.get(weaponId)
    return !!weapon && isWeaponExcludedFor(member.characterKey, weapon, teamOpt)
  }
  /** The members whose weapon in `s` is not ticked for them while `than` gives them a ticked one */
  const untickedAgainst = (s: TeamState, than: TeamState) =>
    order
      .filter(
        (m) =>
          weaponLeftOut(m, weaponOf(s, m)) &&
          !weaponLeftOut(m, weaponOf(than, m))
      )
      .map((m) => m.characterKey)
  if (!notBelowStart()) {
    const first = copyState(state)
    const firstTotal = evaluateIn(state)?.total ?? Number.NEGATIVE_INFINITY
    state.builds = copyState(start).builds
    state.weaponIds = { ...start.weaponIds }
    provisional = false
    exchanges = 0
    await runRounds()
    const again = evaluateIn(state)
    // (the first run, if the second did no better)
    if (!again || again.total < firstTotal) {
      state.builds = first.builds
      state.weaponIds = first.weaponIds
    }
    if (!notBelowStart() && !untickedAgainst(start, state).length) {
      state.builds = copyState(start).builds
      state.weaponIds = { ...start.weaponIds }
    }
  }
  const after = evaluateIn(state)
  if (!after) return undefined
  // A member below its minimums is no result: the run stops, saying how far each one is (the most
  // a build of its pieces reaches, when that falls short too; else what the run left it with)
  const belowMinimums = order.filter((m) => after.unmet[m.characterKey]?.length)
  if (belowMinimums.length)
    throw new TeamOptRequirementsUnmet(
      Object.fromEntries(
        belowMinimums.map(({ characterKey }) => [
          characterKey,
          (after.shortfalls?.[characterKey] ?? []).map((shortfall) => {
            const note = minimumNotes
              .get(characterKey)
              ?.get(shortfall.path.join('.'))
            return note && note.value < note.min ? note : shortfall
          }),
        ])
      )
    )

  // The next best team builds: each optimized member's next best builds (the others as they are,
  // their pieces out of reach), by the team's damage. One member changes at a time; one that
  // would leave another member's requirements unmet is passed over.
  const alternatives: (TeamOptAlternative & { state: TeamState })[] = []
  if (builds > 1) {
    const candidates: {
      member: TeamOptMember
      value: number
      artifactIds: string[]
    }[] = []
    const idsOf = (build: TeamOptBuilds[CharacterKey]) =>
      Object.values(build ?? {})
        .filter(notEmpty)
        .sort()
        .join()
    for (const [i, member] of order.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await onStep?.({
        round: rounds,
        maxRounds,
        step: i + 1,
        steps: order.length,
        characterKey,
        alternatives: true,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(state, characterKey)
      if (!problem) continue
      const taken = new Set(
        members
          .filter((m) => m.characterKey !== characterKey)
          .flatMap((m) => Object.values(state.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const result = await solve({
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          taken
        ),
        objective: problem.objective,
        constraints: problem.constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
        topN: builds,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const current = idsOf(state.builds[characterKey])
      for (const found of result ? [result, ...(result.more ?? [])] : [])
        if ([...found.artifactIds].sort().join() !== current)
          candidates.push({ member, ...found })
    }
    candidates.sort((a, b) => b.value - a.value)
    const seen = new Set<string>()
    for (const { member, artifactIds } of candidates) {
      if (alternatives.length >= builds - 1) break
      const next = copyState(state)
      assign(next, member, artifactIds)
      const key = JSON.stringify(next.builds)
      if (seen.has(key)) continue
      seen.add(key)
      const evaluation = evaluateIn(next)
      if (
        !evaluation ||
        worsened(after, evaluation) ||
        breaksSetRules(state, next)
      )
        continue
      alternatives.push({
        builds: next.builds,
        after: evaluation,
        changed: member.characterKey,
        state: next,
      })
    }
    alternatives.sort((a, b) => b.after.total - a.after.total)
  }
  // the damage shown: without the ranking's bonus stats
  for (const alternative of alternatives)
    alternative.after = shownIn(alternative.state, alternative.after)

  if (process.env['NODE_ENV'] === 'development')
    console.log('[TeamOpt] profile', {
      ...profile,
      totalMs: Math.round(performance.now() - profile.t0),
      problemMs: Math.round(profile.problemMs),
      solveMs: Math.round(profile.solveMs),
      evalMs: Math.round(profile.evalMs),
      rounds,
    })
  const teamWeaponIds = [
    ...new Set(Object.values(weaponsIn(state)).map((weapon) => weapon!.id)),
  ]
  const energy: NonNullable<TeamOptResult['energy']> = {}
  for (const { characterKey, isTc } of members) {
    if (
      isTc ||
      teamOpt.energySource === 'calculator' ||
      !hasEnergyRequirement(statFilters[characterKey])
    )
      continue
    const weaponIds = teamWeaponIds.filter(
      (id) => (teamOpt.weaponEnergy[id]?.[characterKey] ?? 0) > 0
    )
    const relief = weaponIds.reduce(
      (total, id) => total + (teamOpt.weaponEnergy[id]?.[characterKey] ?? 0),
      0
    )
    if (relief > 0) energy[characterKey] = { relief, weaponIds }
  }
  const untickedWeapons = teamOptUntickedWeapons(
    database,
    order,
    state.weaponIds,
    teamOpt
  )
  // no team build keeps every member's set rules: no result (a partial one would break them)
  const setRulesUnmet = outsideSetRules(state).map((m) => m.characterKey)
  if (setRulesUnmet.length) throw new TeamOptSetRulesUnmet(setRulesUnmet)
  const startBreaksSetRules = order
    .filter(({ characterKey }) => isFull(start, characterKey))
    .filter(
      ({ characterKey }) =>
        !keepsSetRules(characterKey, artsIn(start, characterKey))
    )
    .map((m) => m.characterKey)
  const startUntickedWeapons = untickedAgainst(start, state)
  const played = rotationForWeapons?.(weaponsIn(state))
  const result: TeamOptResult = {
    builds: state.builds,
    weapons: { ...state.weaponIds },
    before: shownIn(start, before),
    after: shownIn(state, after),
    rounds,
    optimized: order.map((m) => m.characterKey),
    ...(played && {
      attacks: played.attacks,
      rotationTime: played.rotationTime,
    }),
    energy,
    ...(untickedWeapons.length ? { untickedWeapons } : {}),
    ...(startBreaksSetRules.length ? { startBreaksSetRules } : {}),
    ...(startUntickedWeapons.length ? { startUntickedWeapons } : {}),
    ...(alternatives.length
      ? { alternatives: alternatives.map(({ state: _, ...a }) => a) }
      : {}),
    ...(attackStates?.length ? { attackStates: [...attackStates] } : {}),
  }
  const session = sessionOf(state)
  onSession?.(session)
  if (!onResult) return result
  onResult(result)
  // each optimized member's other builds with its weapon and sets as found: its first rankings
  const options: NonNullable<TeamOptResult['options']> = {}
  for (const member of order) {
    if (isCancelled()) break
    const ck = member.characterKey
    const weaponId = state.weaponIds[ck] ?? member.weaponId
    const ranked = await session.rankings(state, ck, { weaponId }, isCancelled)
    if (!ranked || isCancelled()) break
    options[ck] = ranked
    onOptions?.(ck, ranked)
  }
  if (Object.keys(options).length) result.options = options
  return result

  /**
   * The team found, to try other equipment on (`TeamOptSession`): what a member's pick (a weapon,
   * a set) makes of its build, the others as they are, and its rankings under it
   */
  function sessionOf(found: TeamState): TeamOptSession {
    const ranked = evaluateIn(found)
    const best = ranked?.total ?? Number.NaN
    const keyOf = (s: TeamState) =>
      JSON.stringify([s.builds, s.weaponIds, s.lockedPairs])
    const memberOf = (ck: CharacterKey) =>
      members.find((m) => m.characterKey === ck)
    const othersIn = (ck: CharacterKey) =>
      members.filter((m) => m.characterKey !== ck && !m.isTc)
    // (the page between steps: a pick's work never holds it up; workers are already off-thread)
    const breathe =
      typeof document === 'undefined' ? () => Promise.resolve() : yieldTask
    const needsIn = (s: TeamState) =>
      teamEnergyNeeds(statFilters, weaponsIn(s), teamOpt)
    /**
     * `team` (`ck`'s equipment changed from `before` by `pick`) with the teammates whose Energy
     * Recharge requirement that changes searched again, as a run does (Favonius' particles free
     * theirs, a weapon taken away raises it): each in turn, free to take `ck`'s pieces (swapped, as
     * equipping does), then `ck` again for its pick with what they left it
     */
    const settle = async (
      team: TeamState,
      before: TeamState,
      ck: CharacterKey,
      pick: TeamOptPick,
      cancelled: () => boolean,
      background = false
    ) => {
      const was = needsIn(before)
      const now = needsIn(team)
      const changed = order.filter(
        (m) =>
          m.characterKey !== ck && was[m.characterKey] !== now[m.characterKey]
      )
      if (!changed.length || cancelled()) return team
      const unmetBefore = new Set(
        [...unmetIn(before)].map((key) => key as CharacterKey)
      )
      const member = memberOf(ck)
      try {
        const settled = await reoptimizeIn(
          copyState(team),
          changed,
          member ? [member] : [],
          unmetBefore,
          () => breathe(),
          background
        )
        if (!settled || !member) return team
        const weapon = database.weapons.get(settled.weaponIds[ck] ?? '')
        const again =
          weapon && (await search(settled, member, weapon, pick, background))
        if (again?.found) assign(settled, member, again.found.artifactIds)
        else if (pick.setPair) return team
        return settled
      } catch (e) {
        if (e instanceof TeamOptCancelled) return team
        throw e
      }
    }
    /** The teammates' Energy Recharge requirements in `team` that differ from the run's */
    const teammatesEr = (team: TeamState) => {
      const was = needsIn(found)
      const now = needsIn(team)
      return members.flatMap(({ characterKey: ck }) =>
        was[ck] !== undefined && now[ck] !== undefined && was[ck] !== now[ck]
          ? [{ characterKey: ck, from: was[ck]!, to: now[ck]! }]
          : []
      )
    }
    /** The artifacts the member may use in `s`: not its teammates' */
    const poolIn = (s: TeamState, member: TeamOptMember) =>
      teamOptPool(
        allArts,
        member,
        optConfigs[member.characterKey]!,
        teamOpt,
        teamLocations,
        new Set(
          othersIn(member.characterKey)
            .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
            .filter(notEmpty)
        )
      )
    /** The weapons the member may take in `s` (its own, unless weapons are optimized) */
    const weaponsIn_ = (s: TeamState, member: TeamOptMember) => {
      const own = database.weapons.get(
        s.weaponIds[member.characterKey] ?? member.weaponId
      )
      return teamOpt.optimizeWeapons
        ? teamOptWeaponCandidates(
            database,
            member,
            own?.id ?? member.weaponId,
            teamOpt,
            teamLocations,
            new Set(
              othersIn(member.characterKey)
                .map((m) => s.weaponIds[m.characterKey])
                .filter(notEmpty)
            )
          )
        : own
          ? [own]
          : []
    }
    const equippedIds = (s: TeamState, ck: CharacterKey) =>
      new Set<string | undefined>(Object.values(s.builds[ck] ?? {}))
    // (per state, member and weapon: the pieces Quick keeps for its build, any set)
    const kept = new Map<string, Promise<ICachedArtifact[]>>()
    const searchInput = (
      s: TeamState,
      member: TeamOptMember,
      weapon: ICachedWeapon,
      background: boolean
    ) => {
      const ck = member.characterKey
      const optConfig = optConfigs[ck]
      const problem = problemIn(s, ck, weapon)
      if (!problem || !optConfig) return undefined
      const pool = poolIn(s, member)
      const input: TeamOptSolveInput = {
        characterKey: ck,
        background,
        arts: pool,
        objective: problem.objective,
        constraints: problem.constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      }
      return { problem, input }
    }
    const shortlist = (key: string, input: TeamOptSolveInput) => {
      const { arts, objective, constraints, exclusion } = input
      let keeping = kept.get(key)
      if (!keeping) {
        keeping = quickPool({
          arts,
          objective,
          constraints,
          values: (art) => teamOptArtValues(art, mainStatAssumptionLevel),
          allowed: (build) => meetsSetRules(build, exclusion),
        }).then((q) => q.arts)
        kept.set(key, keeping)
      }
      return keeping
    }
    /** Quick keeps some pieces for the remaining slots; search every piece of a picked set. */
    const search = async (
      s: TeamState,
      member: TeamOptMember,
      weapon: ICachedWeapon,
      { set, setPair }: TeamOptSetChoice,
      background = false,
      ranker?: TeamOptSetRanker
    ) => {
      const base = searchInput(s, member, weapon, background)
      if (!base) return undefined
      const { problem, input } = base
      if (!set && !setPair) return { problem, found: await solve(input, true) }
      const required = setPair ?? [set!]
      const min = setPair ? 2 : 4
      const setArts = input.arts.filter((art) => required.includes(art.setKey))
      const slots = required.map(
        (key) =>
          new Set(setArts.filter((a) => a.setKey === key).map((a) => a.slotKey))
      )
      if (
        slots.some((s) => s.size < min) ||
        new Set(slots.flatMap((s) => [...s])).size < 4
      )
        return { problem, found: undefined }
      const ck = member.characterKey
      const key = `${keyOf(s)}#${ck}#${weapon.id}`
      const equipped = setPair ? equippedIds(s, ck) : undefined
      // If a set has exactly as many slots as it needs, reserve each of them.
      const arts = [
        ...new Set([
          ...(await shortlist(key, input)),
          ...setArts,
          ...input.arts.filter((art) => equipped?.has(art.id)),
        ]),
      ].filter((art) =>
        slots.every(
          (s, i) =>
            s.size > min || !s.has(art.slotKey) || art.setKey === required[i]
        )
      )
      if (ranker) {
        const fast = await ranker.solveSet(arts, required, min)
        if (fast !== 'fallback') return { problem, found: fast }
      }
      // (the pool narrowed already: searched as it is)
      const found = await solve(
        {
          ...input,
          arts,
          constraints: [
            ...problem.constraints,
            ...required.map((key) => ({ value: dynRead(key), min })),
          ],
        },
        false
      )
      return { problem, found }
    }
    const unmetIn = (s: TeamState) =>
      new Set(
        Object.entries(evaluateIn(s)?.unmet ?? {})
          .filter(([, unmet]) => unmet?.length)
          .map(([key]) => key)
      )
    const optionOf = (
      unmetNow: ReadonlySet<string>,
      weapon: ICachedWeapon,
      searched: Awaited<ReturnType<typeof search>>,
      choice: TeamOptSetChoice = {}
    ): TeamOptOption | undefined =>
      searched && {
        weaponId: weapon.id,
        ...(searched.found && {
          artifactIds: bySlot(database, searched.found.artifactIds),
        }),
        value: searched.found?.value ?? Number.NaN,
        ...choice,
        ...([...searched.problem.unmetOthers].some(
          (key) => !unmetNow.has(key)
        ) && { unmet: true as const }),
      }
    const byValue = (a: TeamOptOption, b: TeamOptOption) =>
      (Number.isNaN(b.value) ? Number.NEGATIVE_INFINITY : b.value) -
      (Number.isNaN(a.value) ? Number.NEGATIVE_INFINITY : a.value)
    const rankMixedSets = async (
      s: TeamState,
      member: TeamOptMember,
      weapon: ICachedWeapon,
      unmetNow: ReadonlySet<string>,
      cancelled: () => boolean,
      ranker?: TeamOptSetRanker
    ): Promise<TeamOptOption[]> => {
      const base = searchInput(s, member, weapon, true)
      if (!base || base.input.exclusion.twoTwo?.length || cancelled()) return []
      const { input } = base
      const ranked: TeamOptOption[] = []
      const rankPair = async (setPair: TeamOptSetPair) => {
        const choice = { setPair }
        const searched = await search(s, member, weapon, choice, true, ranker)
        const option = optionOf(unmetNow, weapon, searched, choice)
        if (option?.artifactIds) ranked.push(option)
      }
      const allPairs = wearablePairs(input.arts, input.exclusion)
      if (allPairs.length <= MIXED_SET_RANKS) {
        for (const pair of allPairs) {
          await breathe()
          if (cancelled()) break
          await rankPair(pair)
        }
        return ranked
      }

      const ck = member.characterKey
      const key = `${keyOf(s)}#${ck}#${weapon.id}`
      const equipped = equippedIds(s, ck)
      const arts = [
        ...new Set([
          ...(await shortlist(key, input)),
          ...input.arts.filter((art) => equipped.has(art.id)),
        ]),
      ]
      const shortlistedPairs = wearablePairs(arts, input.exclusion)
      const useShortlist = shortlistedPairs.length > 0
      const pairs = useShortlist ? shortlistedPairs : allPairs
      const keys = [...new Set(pairs.flat())]
      const hasBonus = (key: ArtifactSetKey) =>
        greaterEq(dynRead(key), constant(2), constant(1))
      const constraints = [
        ...input.constraints,
        { value: sum(...keys.map(hasBonus)), min: 2 },
      ]
      const forbidPairs: TeamOptSetPair[] = []
      // Discover several pairs in the shortlist without running a solve for each pair.
      for (let i = 0; i < MIXED_SET_RANKS; i++) {
        await breathe()
        if (cancelled()) break
        let found: { value: number; artifactIds: string[] } | undefined
        let usedRanker = false
        if (ranker && forbidPairs.length <= 2) {
          const fast = await ranker.solveMixed(
            useShortlist ? arts : input.arts,
            forbidPairs
          )
          if (fast !== 'fallback') {
            found = fast
            usedRanker = true
          }
        }
        if (!usedRanker) {
          found = await solve(
            {
              ...input,
              arts: useShortlist ? arts : input.arts,
              constraints: [...constraints],
            },
            !useShortlist
          )
        }
        if (!found || cancelled()) break
        const counts = new Map<ArtifactSetKey, number>()
        for (const id of found.artifactIds) {
          const setKey = database.arts.get(id)!.setKey
          counts.set(setKey, (counts.get(setKey) ?? 0) + 1)
        }
        const pair = pairs.find(
          ([a, b]) => (counts.get(a) ?? 0) >= 2 && (counts.get(b) ?? 0) >= 2
        )
        if (!pair) break
        await rankPair(pair)
        forbidPairs.push(pair)
        constraints.push({
          value: greaterEq(
            constant(1),
            sum(...pair.map(hasBonus)),
            constant(1)
          ),
          min: 1,
        })
      }
      return ranked
    }
    const rankings: TeamOptSession['rankings'] = async (
      s,
      ck,
      pick,
      cancelled = () => false
    ) => {
      const member = memberOf(ck)
      const optConfig = optConfigs[ck]
      const weapon = database.weapons.get(pick.weaponId)
      if (!member || !optConfig || !weapon) return undefined
      const unmetNow = unmetIn(s)
      const baseNeeds = needsIn(s)
      const weaponCandidates = weaponsIn_(s, member)
      const changesTeamEr = (w: ICachedWeapon) => {
        const nextNeeds = teamEnergyNeeds(
          statFilters,
          weaponsIn(s, ck, w),
          teamOpt
        )
        return order.some(
          (m) =>
            m.characterKey !== ck &&
            baseNeeds[m.characterKey] !== nextNeeds[m.characterKey]
        )
      }
      const rankWeapon = async (
        w: ICachedWeapon,
        needsSettle: boolean
      ): Promise<TeamOptOption | undefined> => {
        if (cancelled()) return undefined
        const searched = await search(s, member, w, pick, true)
        const option = optionOf(unmetNow, w, searched)
        if (!option) return undefined
        // (a weapon that changes a teammate's ER requirement: worth the team with that teammate's
        // artifacts searched again, as the run and the KQM tab count it)
        if (needsSettle && searched?.found) {
          const team = copyState(s)
          team.builds[ck] = bySlot(database, searched.found.artifactIds)
          team.weaponIds[ck] = w.id
          const settled = await settle(
            team,
            s,
            ck,
            { ...pick, weaponId: w.id },
            cancelled,
            true
          )
          if (settled !== team) {
            const ev = evaluateIn(settled)
            if (ev) {
              option.value = ev.total
              const unmet = Object.entries(ev.unmet).some(
                ([key, list]) => list?.length && !unmetNow.has(key)
              )
              if (unmet) option.unmet = true
              else delete option.unmet
            }
          }
        }
        return option
      }
      const weapons: TeamOptOption[] = []
      const plainWeapons: ICachedWeapon[] = []
      const erWeapons: ICachedWeapon[] = []
      for (const w of weaponCandidates)
        (changesTeamEr(w) ? erWeapons : plainWeapons).push(w)
      const rankConcurrency = optimizerGpuSupported()
        ? Math.max(1, parallelWeaponSolves)
        : 1
      for (let i = 0; i < plainWeapons.length; i += rankConcurrency) {
        await breathe()
        if (cancelled()) return undefined
        const batch = plainWeapons.slice(i, i + rankConcurrency)
        const opts = await Promise.all(batch.map((w) => rankWeapon(w, false)))
        for (const option of opts) if (option) weapons.push(option)
      }
      for (const w of erWeapons) {
        await breathe()
        if (cancelled()) return undefined
        const option = await rankWeapon(w, true)
        if (option) weapons.push(option)
      }
      const sets: TeamOptOption[] = []
      const wearable = wearableSets(
        poolIn(s, member),
        optConfig.artSetExclusion
      )
      const baseSetSearch = searchInput(s, member, weapon, true)
      const ranker =
        baseSetSearch &&
        solveRaw.createSetRanker &&
        (wearable.length > 0 || !optConfig.artSetExclusion.twoTwo?.length)
          ? await solveRaw.createSetRanker(baseSetSearch.input)
          : undefined
      try {
        for (const set of wearable) {
          await breathe()
          if (cancelled()) return undefined
          const choice = { set }
          const searched = await search(s, member, weapon, choice, true, ranker)
          // Keep an eligible set visible even if its builds miss a requirement.
          const option = optionOf(unmetNow, weapon, searched, choice)
          if (option) sets.push(option)
        }
        sets.push(
          ...(await rankMixedSets(
            s,
            member,
            weapon,
            unmetNow,
            cancelled,
            ranker
          ))
        )
      } finally {
        ranker?.destroy()
      }
      if (cancelled()) return undefined
      return { best, weapons: weapons.sort(byValue), sets: sets.sort(byValue) }
    }
    // (a pick on a team: the team with it, per team and pick)
    const picked = new Map<string, Promise<TeamState | undefined>>()
    const withPick = (s: TeamState, ck: CharacterKey, pick: TeamOptPick) => {
      const key = `${keyOf(s)}#${ck}#${pick.weaponId}#${teamOptSetKey(pick)}`
      let next = picked.get(key)
      if (!next) {
        next = (async () => {
          const member = memberOf(ck)
          const weapon = database.weapons.get(pick.weaponId)
          if (!member || !weapon) return undefined
          const searched = await search(s, member, weapon, pick)
          if (!searched?.found) return undefined
          const team = copyState(s)
          team.builds[ck] = bySlot(database, searched.found.artifactIds)
          team.weaponIds[ck] = weapon.id
          if (pick.setPair)
            team.lockedPairs = { ...s.lockedPairs, [ck]: pick.setPair }
          // (its teammates whose ER requirement the pick changes: searched again)
          return settle(team, s, ck, pick, () => false)
        })()
        picked.set(key, next)
      }
      return next
    }
    return {
      best,
      rankings,
      async pick(
        picks,
        ck,
        { onFigures, isCancelled: cancelled = () => false } = {}
      ) {
        let s: TeamState | undefined = copyState(found)
        for (const [m, pick] of Object.entries(picks) as [
          CharacterKey,
          TeamOptPick,
        ][]) {
          if (!pick || !s) continue
          s = await withPick(s, m, pick)
          if (cancelled()) return undefined
        }
        if (!s) return undefined
        await breathe()
        const ev = evaluateIn(s)
        if (!ev) return undefined
        const er = teammatesEr(s)
        const played = rotationForWeapons?.(weaponsIn(s))
        const view: TeamOptPickView = {
          builds: s.builds,
          weapons: { ...s.weaponIds },
          after: shownIn(s, ev),
          ...(played && {
            attacks: played.attacks,
            rotationTime: played.rotationTime,
          }),
          ...(er.length && { teammatesEr: er }),
        }
        onFigures?.(view)
        const own = picks[ck] ?? {
          weaponId: s.weaponIds[ck] ?? memberOf(ck)?.weaponId ?? '',
        }
        const ranked = await rankings(s, ck, own, cancelled)
        return ranked && { ...view, rankings: ranked }
      },
    }
  }
}
