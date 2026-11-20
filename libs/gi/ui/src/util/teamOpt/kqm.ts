import type {
  ArtifactSetKey,
  CharacterKey,
  ElementKey,
  GenderKey,
  MainStatKey,
  SubstatKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allMainStatKeys,
  allSubstatKeys,
  allWeaponKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedWeapon,
  StatFilters,
  TeamOpt,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import type { IConditionalValues } from '@genshin-optimizer/gi/sheets'
import { getArtSheet, getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import type {
  KqmMains,
  KqmMainValues,
  KqmProblem,
  KqmProblemSpec,
  KqmRolls,
  KqmScore,
  KqmSetSearch,
  KqmSets,
  KqmSetTask,
} from '@genshin-optimizer/gi/solver'
import {
  betterScore,
  cappedRolls,
  compareScores,
  DEFICIT_TOL,
  KQM_FIXED_ROLLS,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  KqmSearchCancelled,
  kqmProblem,
  kqmRarity,
  kqmRollBudget,
  kqmRollCaps,
  kqmStatValues,
  queueKqmSetTasks,
  releaseKqmWorkers,
  scoreOf,
  yieldTask,
} from '@genshin-optimizer/gi/solver'
import {
  getArtSetStat,
  getCharEle,
  getCharStat,
  getCharWeaponType,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import type { Data } from '@genshin-optimizer/gi/wr'
import { constant, percent } from '@genshin-optimizer/gi/wr'
import type { TeamDataOverrides, TeamOptMember } from './data'
import { teamOptBonusStats, teamOptMembers } from './data'
import {
  calculateEnergyRecharge,
  energyCalcData,
  isCalcEnergyWeapon,
  isFavonius,
  syncEnergyCalculator,
} from './energyCalc'
import type { ItemConditionalCtx } from './itemConditionals'
import { isStellarAttackPath, itemConditionals } from './itemConditionals'
import type { KqmBuiltProblem } from './kqmBuild'
import { kqmProblemBuilder, releaseKqmBuilders } from './kqmBuildPool'
import {
  KQM_ONE_COPY,
  KQM_THREE_STARS,
  kqmWeaponSource,
} from './kqmWeaponSources'
import {
  playedAttackStates,
  type RunAttackState,
  withAttackStates,
} from './lowHpUptime'
import { constValue, teamRotationNodes } from './objective'
import { HEXEREI_CHARACTERS } from './rotation/gearEffects'
import type { SimGear } from './rotation/types'
import type { TeamOptEvaluation } from './solve'
import { evaluateTeamNodes, TeamOptCancelled } from './solve'
import { withEnergyRelief } from './weapons'

/*
 * KQM mode: every optimized member gets KQM Standards artifacts instead of the inventory's, and
 * any weapon of its type (at the refinement set for its rarity), all chosen for the team's
 * rotation damage. KQM Standards (KQMS): five 5★ artifacts at +20 (HP flower, ATK plume), 2
 * rolls of every substat (average roll value), and 20 more rolls placed freely, at most 2 per
 * piece whose main stat is not that stat (10 for a stat no main stat has).
 */

export type { KqmMains, KqmRolls, KqmSets } from '@genshin-optimizer/gi/solver'
export {
  KQM_FIXED_ROLLS,
  KQM_FOUR_STAR_ROLLS_LESS,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  kqmRollCaps,
} from '@genshin-optimizer/gi/solver'

/**
 * The standard (Wanderlust Invocation) 5★ characters: most players have a few of their
 * constellations, from lost 50/50s and the free constellation event
 */
const STANDARD_FIVE_STARS: ReadonlySet<CharacterKey> = new Set([
  'Jean',
  'Diluc',
  'Mona',
  'Keqing',
  'Qiqi',
  'Tighnari',
  'Dehya',
  'YumemizukiMizuki',
])
/**
 * The limited 5★ characters of the free constellation event ("To Temper Thyself and Journey Far",
 * its Season 5 roster from Version 7.0): one constellation of one of them is free
 */
const FREE_CONSTELLATION_FIVE_STARS: ReadonlySet<CharacterKey> = new Set([
  'Klee',
  'Albedo',
  'Nilou',
  'Baizhu',
  'HuTao',
  'YaeMiko',
  'Xiao',
  'KamisatoAyaka',
  'Shenhe',
  'Ganyu',
  'Wanderer',
  'Cyno',
  'AratakiItto',
  'SangonomiyaKokomi',
  'KamisatoAyato',
  'Yoimiya',
  'Tartaglia',
  'Eula',
  'Lyney',
  'Wriothesley',
  'Navia',
  'Xianyun',
  'Chiori',
  'Sigewinne',
  'Clorinde',
  'Emilie',
])
/**
 * The constellation a KQM build uses unless the team sets one, independent of the saved
 * character: 4★ C6; standard 5★ C2; the free constellation event's limited 5★ C1; other 5★ C0
 */
export const kqmConstellation = (key: CharacterKey): 0 | 1 | 2 | 6 =>
  getCharStat(key).rarity === 4
    ? 6
    : STANDARD_FIVE_STARS.has(key)
      ? 2
      : FREE_CONSTELLATION_FIVE_STARS.has(key)
        ? 1
        : 0
/** The constellation a KQM build uses: the team's own choice, else the KQM standard */
export const kqmMemberConstellation = (
  key: CharacterKey,
  kqm: Pick<TeamOptKqm, 'constellations'> | undefined
): number => kqm?.constellations?.[key] ?? kqmConstellation(key)

/** The members' talent levels: as set, else 10/10/10 (KQM Standards since 2026-11; 9 is the other choice) */
export const KQM_TALENT_DEFAULT = 10
export const kqmTalentLevel = (
  kqm: Pick<TeamOptKqm, 'talents'> | undefined
): 9 | 10 => kqm?.talents ?? KQM_TALENT_DEFAULT

/** A member's artifact standard: its own distributed rolls when set per member, else the team's */
export const kqmMemberRolls = (
  key: CharacterKey,
  kqm: Pick<TeamOptKqm, 'rolls' | 'memberRolls'> | undefined
): number => kqmRollBudget(kqm?.memberRolls?.[key] ?? kqm?.rolls)

/** A valid total ER target: finite and at least 100%. */
export const kqmHasEnergyRequirement = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 100

/** A member's total ER target until one is set in KQM Setup: 100%, i.e. no requirement */
export const KQM_ER_DEFAULT = 100
/** A member's total ER target: the one set in KQM Setup, else `KQM_ER_DEFAULT` */
export const kqmEnergyRequirement = (
  kqm: Pick<TeamOptKqm, 'energyRecharge'> | undefined,
  characterKey: CharacterKey
): number => {
  const value = kqm?.energyRecharge?.[characterKey]
  return kqmHasEnergyRequirement(value) ? value : KQM_ER_DEFAULT
}

export const kqmSandsKeys = [
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'enerRech_',
] as const satisfies readonly MainStatKey[]
export const kqmCircletKeys = [
  'critRate_',
  'critDMG_',
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'heal_',
] as const satisfies readonly MainStatKey[]
const gobletBaseKeys = [
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'physical_dmg_',
] as const satisfies readonly MainStatKey[]
export const kqmGobletKeys = (element: ElementKey): MainStatKey[] => [
  `${element}_dmg_` as MainStatKey,
  ...gobletBaseKeys,
]

export interface KqmWeapon {
  key: WeaponKey
  refinement: number
}
export interface KqmBuild {
  weapon: KqmWeapon
  sets: KqmSets
  mains: KqmMains
  rolls: KqmRolls
}
/** Another build for one member (the others at their best), and the team's damage with it */
export interface KqmCatchUp {
  status: 'matched' | 'tied' | 'limit'
  /** Extra average rolls beyond the standard 20-roll budget; the original build is unchanged. */
  rolls: KqmRolls
  count: number
  total: number
  target: number
}
export interface KqmOption extends KqmBuild {
  total: number
  /** Its requirements are not met */
  unmet: boolean
  /**
   * Estimated extra rolls to match the ranking's best (feasible) option: how far behind it this
   * one is, in substat rolls (absent for the best, and for options that miss a requirement)
   */
  behind?: KqmCatchUp
  /** The requirements it misses: their stat's path, what it reaches, what it needs */
  shortfalls?: { path: string[]; value: number; min: number }[]
  /**
   * Teammates' builds searched again for it: its weapon changes their Energy Recharge
   * requirement (Favonius particles, a weapon's energy), so their artifacts use the ER it frees or
   * make up what it no longer gives. Its `total` is the team's with them.
   */
  team?: Partial<Record<CharacterKey, KqmBuild>>
  /**
   * Ranked for comparison only: its weapon at another refinement ticked for its group
   * (`TeamOptKqm.compareRefinements`), never one the builds may take
   */
  compare?: true
}
export interface KqmRanking {
  /** The best build with each set (or 2+2), the weapon the best one's */
  sets: KqmOption[]
  /** The best build with each weapon, the sets the best one's */
  weapons: KqmOption[]
}
export interface KqmResult {
  builds: Partial<Record<CharacterKey, KqmBuild>>
  /** Snapshot of the constellations actually used, including kept members. */
  constellations: Partial<Record<CharacterKey, number>>
  /** Total ER percentages: user target, minimum after weapon energy adjustments, and actual. */
  energyRecharge: Partial<
    Record<CharacterKey, { target: number; minimum: number; value: number }>
  >
  /** The team with the builds (kept members: their own) */
  after: TeamOptEvaluation
  rankings: Partial<Record<CharacterKey, KqmRanking>>
  /**
   * Per member: the weapon and set effects counted as on by rule (`itemConditionals`) because
   * the user never set them, for the member's weapon and sets
   */
  assumed: Partial<Record<CharacterKey, { path: string[]; value: string }[]>>
  optimized: CharacterKey[]
  rounds: number
  /**
   * The written rotation as it was played for these builds (`KqmRunArgs.replay`); absent: the
   * team's attacks were used as they are (nothing written)
   */
  played?: KqmPlayed
  /**
   * A quick search's (not `TeamOptKqm.fullSearch`) per member: the weapons and sets left out after the first
   * round, as far behind its best (not ranked)
   */
  screenedOut?: Partial<
    Record<CharacterKey, { weapons: KqmWeapon[]; sets: ArtifactSetKey[] }>
  >
}
/** The written rotation played for KQM builds: each member's attacks per rotation */
export interface KqmPlayed {
  attacks: TeamOpt['attacks']
  /** Seconds per rotation (absent: the team's rotation time) */
  rotationTime?: number
  /** What each rotation waits for to be ready, seconds */
  stalls?: { label: string; seconds: number }[]
}
/**
 * What a KQM replay plays the rotation with: the KQM constellations, the builds' weapons and sets
 * (none before any build is found), and the builds' calculation data (for stats and heals the
 * simulation reads)
 */
export interface KqmReplayInput {
  constellations: Partial<Record<CharacterKey, number>>
  gear: Partial<Record<CharacterKey, SimGear>>
  overrides: TeamDataOverrides
}
/** A KQM run's progress */
export interface KqmStep {
  phase: 'search' | 'ranking'
  round: number
  maxRounds: number
  /** Search: the member's place in the round; ranking: members ranked so far */
  step: number
  steps: number
  /** The member being searched (ranking: the first one not ranked yet) */
  characterKey: CharacterKey
  /** A member's search: its weapons tried with its current artifacts, then the best few searched */
  stage?: 'weapons' | 'artifacts'
  /**
   * Search: a round after the rankings found a better build than the rounds had (it is taken, and
   * the others' builds are searched again around it)
   */
  improving?: boolean
  /** The stage's progress (weapons tried, or searches done) */
  done?: number
  total?: number
  /** The whole run's estimated progress (0 to 1; it never goes back) */
  progress?: number
  /** Builds tried so far (main stats and rolls placed for a weapon and sets) */
  tried?: number
}

const mainValue = (key: MainStatKey) => getMainStatValue(key, 5, 20)
const slotMains = (m: KqmMains): MainStatKey[] => [
  'hp',
  'atk',
  m.sands,
  m.goblet,
  m.circlet,
]
/**
 * The 4★ sets KQM builds may use (KQMS: their pieces are 4★ artifacts: 0.8 of the substats, 2
 * fewer distributed rolls each, 4★ +16 main stats; a 4-piece bonus leaves one 5★ off-piece)
 */
export const KQM_FOUR_STAR_SETS: readonly ArtifactSetKey[] = [
  'Instructor',
  'TheExile',
]
/**
 * Every 5★ +20 main stat's value (for the search kernel, which has no stat data), with the 4★
 * sets and a 4★ +16 main stat's values
 */
let mainValuesTable: KqmMainValues | undefined
const kqmMainValues = () =>
  (mainValuesTable ??= {
    ...(Object.fromEntries(
      allMainStatKeys.map((k) => [k, mainValue(k)])
    ) as KqmMainValues),
    fourStarSets: KQM_FOUR_STAR_SETS,
    fourStarMains: Object.fromEntries(
      allMainStatKeys.map((k) => [k, getMainStatValue(k, 4, 16)])
    ),
  })
/** KQMS for a build's artifact rarities (see `kqmRarity`): its substat scale and its rolls */
export const kqmBuildRarity = (
  build: Pick<KqmBuild, 'sets'>,
  /** The artifact standard's distributed rolls (`TeamOptKqm.rolls`; KQMS: 20) */
  rolls?: number
) => kqmRarity(build.sets, kqmMainValues(), kqmRollBudget(rolls))

/** A build's artifact stats, as the solver reads them (`dyn`: fractions for % stats) */
export function kqmValues(
  build: Pick<KqmBuild, 'sets' | 'mains' | 'rolls'>
): Record<string, number> {
  return kqmStatValues(build, kqmMainValues())
}

export interface KqmArtifactStat {
  key: MainStatKey | SubstatKey
  main: number
  fixed: number
  distributed: number
  total: number
  rolls: number
}

/** Artifact contributions only, without character base stats, weapons or set bonuses. */
export function kqmArtifactStats(
  build: Pick<KqmBuild, 'mains' | 'rolls'> & Partial<Pick<KqmBuild, 'sets'>>
): KqmArtifactStat[] {
  // (4★ sets: their pieces' main stats and the substats' scale, as the search counts them)
  const sets = build.sets ?? {}
  const { subScale } = kqmBuildRarity({ sets })
  const asBuilt = kqmStatValues(
    { sets, mains: build.mains, rolls: {} },
    kqmMainValues()
  )
  const keys = [
    ...new Set<MainStatKey | SubstatKey>([
      ...allSubstatKeys,
      ...slotMains(build.mains),
    ]),
  ]
  return keys
    .map((key) => {
      const mainCount = slotMains(build.mains).filter((k) => k === key).length
      const rollValue = (KQM_SUBSTAT_ROLLS[key as SubstatKey] ?? 0) * subScale
      // (its main stats: what the build has of it beyond its two fixed rolls)
      const main = mainCount
        ? (asBuilt[key] ?? 0) - KQM_FIXED_ROLLS * rollValue
        : 0
      const fixed = KQM_FIXED_ROLLS * rollValue
      const rolls = build.rolls[key as SubstatKey] ?? 0
      const distributed = rolls * rollValue
      return {
        key,
        main,
        fixed,
        distributed,
        total: main + fixed + distributed,
        rolls,
      }
    })
    .filter((stat) => stat.total > 0)
}

/**
 * Greedy damage-equivalent estimate, re-evaluated for each added roll and a fractional last roll.
 * It adds up to 20 hypothetical rolls beyond the artifact standard while respecting its per-stat
 * placement caps. The build, equipment, main stats, teammates and ER constraints remain fixed.
 */
export function estimateKqmCatchUp(
  build: KqmBuild,
  target: number,
  evaluate: (values: Record<string, number>) => {
    total: number
    valid: boolean
  },
  /** The artifact standard's distributed rolls (KQMS: 20), for its caps */
  budget = KQM_ROLLS
): KqmCatchUp {
  const values = kqmValues(build)
  const rolls: KqmRolls = {}
  const caps = kqmRollCaps(build.mains, budget)
  // (a roll is worth what this build's rolls are: less with 4★ pieces)
  const { subScale } = kqmBuildRarity(build)
  const subRoll = (key: SubstatKey) => KQM_SUBSTAT_ROLLS[key] * subScale
  let { total, valid } = evaluate(values)
  const tolerance = Math.max(1e-6, Math.abs(target) * 1e-9)
  const result = (status: KqmCatchUp['status']): KqmCatchUp => ({
    status,
    rolls: { ...rolls },
    count: Object.values(rolls).reduce((sum, n) => sum + (n ?? 0), 0),
    total,
    target,
  })
  if (!valid) return result('limit')
  if (total + tolerance >= target) return result('tied')
  for (let i = 0; i < KQM_ROLLS; i++) {
    let chosen: SubstatKey | undefined
    let chosenTotal = total
    for (const key of allSubstatKeys) {
      if ((build.rolls[key] ?? 0) + (rolls[key] ?? 0) + 1 > caps[key]) continue
      values[key] += subRoll(key)
      const candidate = evaluate(values)
      values[key] -= subRoll(key)
      if (candidate.valid && candidate.total > chosenTotal + tolerance * 0.01) {
        chosen = key
        chosenTotal = candidate.total
      }
    }
    if (!chosen) return result('limit')
    let added = 1
    if (chosenTotal + tolerance >= target) {
      let lo = 0
      let hi = 1
      for (let j = 0; j < 24; j++) {
        const mid = (lo + hi) / 2
        values[chosen] += mid * subRoll(chosen)
        const candidate = evaluate(values)
        values[chosen] -= mid * subRoll(chosen)
        if (candidate.valid && candidate.total + tolerance >= target) hi = mid
        else lo = mid
      }
      added = hi
    }
    rolls[chosen] = (rolls[chosen] ?? 0) + added
    values[chosen] += added * subRoll(chosen)
    ;({ total, valid } = evaluate(values))
    if (valid && total + tolerance >= target) return result('matched')
  }
  return result('limit')
}

/** A build's artifacts as calculation data (what `getTeamDataWith` takes for a member) */
export function kqmArtData(
  build: Pick<KqmBuild, 'sets' | 'mains' | 'rolls'>
): Data {
  const values = kqmValues(build)
  const art: Record<string, ReturnType<typeof constant>> = {}
  const artSet: Record<string, ReturnType<typeof constant>> = {}
  for (const [k, v] of Object.entries(values)) {
    if (k in build.sets) artSet[k] = constant(v)
    else art[k] = k.endsWith('_') ? percent(v) : constant(v)
  }
  return { art, artSet } as Data
}

export function kqmWeaponData(
  weapon: KqmWeapon,
  characterKey: CharacterKey
): ICachedWeapon {
  return {
    id: `kqm:${weapon.key}`,
    key: weapon.key,
    level: 90,
    ascension: 6,
    refinement: weapon.refinement as ICachedWeapon['refinement'],
    location: characterKey as ICachedWeapon['location'],
    lock: false,
  }
}

/** Weapons that are not in the game (Genshin Optimizer's April Fools catalyst): never offered */
export const KQM_NOT_IN_GAME: readonly WeaponKey[] = ['QuantumCatalyst']

const kqmOfType = (characterKey: CharacterKey) => {
  const type = getCharWeaponType(characterKey)
  return (allWeaponKeys as readonly WeaponKey[]).filter((key) => {
    const stat = getWeaponStat(key)
    return (
      stat?.weaponType === type &&
      !KQM_NOT_IN_GAME.includes(key) &&
      ((stat?.rarity ?? 0) >= 4 || KQM_THREE_STARS.includes(key))
    )
  })
}

/** The weapon a member's builds are locked to (`TeamOptKqm.lockedWeapons`), if one of its type */
export function kqmLockedWeapon(
  characterKey: CharacterKey,
  kqm: TeamOptKqm = defaultTeamOptKqm
): KqmWeapon | undefined {
  const key = kqm.lockedWeapons?.[characterKey]
  if (!key || !kqmOfType(characterKey).includes(key)) return undefined
  return { key, refinement: kqmRefinement(key, kqm) }
}

/**
 * The weapons a member may get: every 4★ and 5★ of its type, plus the 3★ Harbinger of Dawn,
 * Slingshot and Thrilling Tales of Dragon Slayers (`KQM_THREE_STARS`), at the settings' refinement;
 * a locked member only its locked one. `all`: every weapon of its type, locked or not.
 */
export function kqmWeapons(
  characterKey: CharacterKey,
  kqm: TeamOptKqm = defaultTeamOptKqm,
  { all = false }: { all?: boolean } = {}
): KqmWeapon[] {
  const locked = !all && kqmLockedWeapon(characterKey, kqm)
  if (locked) return [locked]
  const ofType = kqmOfType(characterKey)
  const excluded = kqmExcludedWeapons(kqm)
  const allowed = ofType.filter((key) => !excluded.has(key))
  return (
    (all ? ofType : allowed)
      // free weapons (and the 3★) first, then 4★ wish and shop ones, then 5★ standard, then 5★
      // event wish
      .sort((a, b) => weaponOrder(a) - weaponOrder(b))
      .map((key) => ({ key, refinement: kqmRefinement(key, kqm) }))
  )
}

const weaponOrder = (key: WeaponKey) => {
  const group = kqmWeaponGroup(key)
  return group === 'wish5'
    ? 3
    : group === 'standard5'
      ? 2
      : group === 'wish4'
        ? 1
        : 0
}

/**
 * The weapons KQM mode turns on and off together, each with its refinement setting: Battle Pass,
 * 4★ event wish (and Starglitter shop), 5★ standard wish, 5★ event wish. (The standard wish pool's
 * 4★, like the other free ones, are no group: on at R5.)
 */
export type KqmWeaponGroup =
  | 'bp'
  | 'wish4'
  | 'standard4'
  | 'standard5'
  | 'wish5'
export function kqmWeaponGroup(key: WeaponKey): KqmWeaponGroup | undefined {
  const source = kqmWeaponSource(key)
  const five = getWeaponStat(key)?.rarity === 5
  if (source === 'bp') return 'bp'
  if (source === 'standard') return five ? 'standard5' : 'standard4'
  if (source === 'gacha' || source === 'starglitter')
    return five ? 'wish5' : 'wish4'
  return undefined
}
/** The setting a group's refinement is */
export const kqmGroupRefinementKey = {
  bp: 'refinementBp',
  wish4: 'refinement4',
  standard4: 'refinementStandard4',
  standard5: 'refinementStandard5',
  wish5: 'refinement5',
} as const satisfies Record<KqmWeaponGroup, keyof TeamOptKqm>
/** A group's refinement setting (absent: the group's default) */
function groupSetting(group: KqmWeaponGroup, kqm: TeamOptKqm): number {
  switch (group) {
    case 'bp':
      return kqm.refinementBp ?? 1
    case 'wish4':
      return kqm.refinement4
    case 'standard4':
      return kqm.refinementStandard4 ?? 5
    case 'standard5':
      return kqm.refinementStandard5 ?? 1
    case 'wish5':
      return kqm.refinement5
  }
}
/**
 * The refinement a group's weapons are built at among several ticked (one at least): the group's
 * default one if ticked (Battle Pass R1 with R5: R5 is compared, never built), else the highest
 */
export function kqmBuiltRefinement(
  group: KqmWeaponGroup,
  ticked: readonly number[]
): number {
  const usual = groupSetting(group, defaultTeamOptKqm)
  return ticked.includes(usual) ? usual : Math.max(...ticked)
}
/**
 * The refinement a group's weapons are built at: its setting, else the group's default; with
 * several ticked, the default one when ticked (a setting saved as the highest ticked included)
 */
export function kqmGroupRefinement(
  group: KqmWeaponGroup,
  kqm: TeamOptKqm = defaultTeamOptKqm
): number {
  const setting = groupSetting(group, kqm)
  const ticked = kqm.compareRefinements?.[group]
  return ticked?.length
    ? kqmBuiltRefinement(group, [...ticked, setting])
    : setting
}
/**
 * The refinements ticked for a group: the one its builds use (its default one when ticked), and
 * any others its weapons are ranked at too for comparison (`TeamOptKqm.compareRefinements`), lowest first
 */
export function kqmGroupRefinements(
  group: KqmWeaponGroup,
  kqm: TeamOptKqm = defaultTeamOptKqm
): number[] {
  return [
    ...new Set([
      ...(kqm.compareRefinements?.[group] ?? []),
      kqmGroupRefinement(group, kqm),
    ]),
  ].sort((a, b) => a - b)
}
/**
 * The refinements a weapon is ranked at besides the one it is built at: the others ticked for its
 * group (none when the weapon has a refinement of its own)
 */
export function kqmCompareRefinements(
  key: WeaponKey,
  kqm: TeamOptKqm = defaultTeamOptKqm
): number[] {
  const group = kqmWeaponGroup(key)
  if (!group || kqm.refinements?.[key]) return []
  const built = kqmRefinement(key, kqm)
  return kqmGroupRefinements(group, kqm).filter((r) => r !== built)
}

/**
 * The refinement a weapon is counted at: as set for it, else by where it comes from (forged,
 * event and fishing weapons R5; one-copy rewards R1), else its group's (Battle Pass, 4★ and 5★
 * standard-wish ones by default R1, R5, R1; event-wish ones the settings' 5★ / 4★ refinement)
 */
export function kqmRefinement(
  key: WeaponKey,
  kqm: TeamOptKqm = defaultTeamOptKqm
): number {
  const own = kqm.refinements?.[key]
  if (own) return own
  switch (kqmWeaponSource(key)) {
    case 'craft':
    case 'event':
    case 'fishing':
      return 5
    case 'quest':
    case 'console':
      return 1
  }
  const group = kqmWeaponGroup(key)
  if (group) return kqmGroupRefinement(group, kqm)
  return getWeaponStat(key)?.rarity === 5 ? kqm.refinement5 : kqm.refinement4
}

/**
 * The weapons KQM mode leaves out: as set, else the default: the event-wish and Starglitter-shop
 * ones, 4★ and 5★, and the standard wish pool's 5★ (in: forged, event, Battle Pass, fishing,
 * quests, Exaiphanes Blade, and the standard wish pool's 4★). A list saved before the standard wish pool was its own
 * (`weaponList` absent) had them off with the wish ones: they are on again (`onSinceList2`).
 */
export function kqmExcludedWeapons(kqm: TeamOptKqm = defaultTeamOptKqm) {
  const saved = kqm.excludedWeapons
  if (!saved) return new Set<WeaponKey>(kqmDefaultExcludedWeapons())
  return new Set<WeaponKey>(
    (kqm.weaponList ?? 1) >= KQM_WEAPON_LIST
      ? saved
      : saved.filter((key) => !onSinceList2(key))
  )
}
/** What a saved weapon list is written for (see `TeamOptKqm.weaponList`) */
export const KQM_WEAPON_LIST = 2
/**
 * On by default since list 2, off before with the wish weapons: the standard wish pool's 4★, and
 * Moonweaver's Dawn (a free copy from a world quest)
 */
const onSinceList2 = (key: WeaponKey) =>
  (kqmWeaponSource(key) === 'standard' && getWeaponStat(key)?.rarity === 4) ||
  key === 'MoonweaversDawn'
/** The groups left out by default (the Battle Pass's is in) */
const offByDefault: readonly KqmWeaponGroup[] = ['wish4', 'standard5', 'wish5']
export const kqmDefaultExcludedWeapons = () =>
  (allWeaponKeys as readonly WeaponKey[]).filter((key) => {
    const group = kqmWeaponGroup(key)
    return (
      (getWeaponStat(key)?.rarity ?? 0) >= 4 &&
      !!group &&
      offByDefault.includes(group)
    )
  })

/** The artifact sets KQM builds are made of: every 5★ one, and the 4★ ones KQM guides use */
export const kqmSets = (): ArtifactSetKey[] => [
  ...fiveStarSets(),
  ...KQM_FOUR_STAR_SETS.filter((k) =>
    (allArtifactSetKeys as readonly string[]).includes(k)
  ),
]

const fiveStarSets = () =>
  (allArtifactSetKeys as readonly ArtifactSetKey[]).filter((k) =>
    (getArtSetStat(k)?.rarities as readonly number[] | undefined)?.includes(5)
  )

/** Sets whose 2-piece is a plain, well-known stat: preferred as the name of a 2-piece bonus */
const WELL_KNOWN_2PC: readonly string[] = [
  'GladiatorsFinale',
  'ShimenawasReminiscence',
  'EmblemOfSeveredFate',
  'NoblesseOblige',
  'WanderersTroupe',
  'GildedDreams',
  'TenacityOfTheMillelith',
  'VermillionHereafter',
  'HuskOfOpulentDreams',
  'HeartOfDepth',
  'CrimsonWitchOfFlames',
  'ThunderingFury',
  'BlizzardStrayer',
  'ViridescentVenerer',
  'ArchaicPetra',
  'DeepwoodMemories',
  'MaidenBeloved',
  'BloodstainedChivalry',
  'PaleFlame',
]
const pref = (k: string) => {
  const i = WELL_KNOWN_2PC.indexOf(k)
  return i < 0 ? WELL_KNOWN_2PC.length : i
}

const mainsId = (m: KqmMains) => [m.sands, m.goblet, m.circlet].sort().join('+')
export const kqmSetsId = (sets: KqmSets) =>
  Object.entries(sets)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k}:${n}`)
    .sort()
    .join('+')
const buildId = (b: KqmBuild) =>
  `${b.weapon.key}@${b.weapon.refinement}|${kqmSetsId(b.sets)}|${b.mains.sands},${b.mains.goblet},${b.mains.circlet},${b.mains.off ?? ''}|${JSON.stringify(Object.entries(b.rolls).sort())}`

/** A member's compiled problem: for searches here, and as sent to the workers */
interface Problem extends KqmProblem {
  spec: KqmProblemSpec
  /** Each requirement's stat path */
  paths: string[][]
}
type Score = KqmScore
const better = betterScore

let problemCount = 0
/** A built problem, compiled here and given its id (it goes to the search workers) */
function compile(built: KqmBuiltProblem, rolls: number): Problem {
  const { paths, ...rest } = built
  // (the artifact standard's distributed rolls go with the spec to the search workers)
  const spec: KqmProblemSpec = { id: `kqm${++problemCount}`, ...rest, rolls }
  return { ...kqmProblem(spec), spec, paths }
}

/** Yields to the page now and then, so a long search keeps it responsive */
function ticker(isCancelled: () => boolean) {
  let last = performance.now()
  return async () => {
    if (isCancelled()) throw new TeamOptCancelled()
    if (performance.now() - last < 30) return
    // (not a timer: a run left in a background tab goes on at full speed; a hidden page draws
    // nothing, and its queued tasks wait long: no yield then)
    if (globalThis.document?.visibilityState === 'hidden') {
      last = performance.now()
      return
    }
    await yieldTask()
    last = performance.now()
    if (isCancelled()) throw new TeamOptCancelled()
  }
}

interface MemberSpace {
  member: TeamOptMember
  weapons: KqmWeapon[]
  /** Sets allowed as 4 pieces */
  four: ArtifactSetKey[]
  /** Sets allowed as 2 pieces */
  two: ArtifactSetKey[]
  mains: KqmMains[]
}

/**
 * What KQM may give a member: KQM's weapons, KQM's artifact sets (its "artifact sets" chooser) and
 * every main stat KQM builds use. The member's own Optimize tab (its main stats, set exclusions and
 * stat filters) plays no part: none of it is on the KQM tab.
 */
function memberSpace(member: TeamOptMember, kqm: TeamOptKqm): MemberSpace {
  const { characterKey } = member
  const sets = kqmSets().filter((k) => !kqm.excludedSets?.includes(k))
  const goblet = kqmGobletKeys(getCharEle(characterKey))
  const all: KqmMains[] = kqmSandsKeys.flatMap((s) =>
    goblet.flatMap((g) =>
      kqmCircletKeys.map((c) => ({ sands: s, goblet: g, circlet: c }))
    )
  )
  return {
    member,
    weapons: kqmWeapons(characterKey, kqm),
    four: sets,
    two: sets,
    mains: all.filter(
      (m, i) => all.findIndex((o) => mainsId(o) === mainsId(m)) === i
    ),
  }
}

/** The rule-based conditionals for a member (what it does in the rotation, its team's elements) */
function memberCtx(
  database: ArtCharDatabase,
  teamId: string,
  characterKey: CharacterKey,
  teamOpt: Pick<TeamOpt, 'attacks'>
): ItemConditionalCtx {
  const members = teamOptMembers(database, teamId)
  const attacks = new Set<ItemConditionalCtx['attacks'][number]>()
  const kinds = ['normal', 'charged', 'plunging', 'skill', 'burst'] as const
  let ownStellar = false
  let ownLunar = false
  for (const attack of teamOpt.attacks[characterKey] ?? []) {
    const text = attack.path.join('.').toLowerCase()
    for (const kind of kinds) if (text.includes(kind)) attacks.add(kind)
    if (isStellarAttackPath(attack.path)) ownStellar = true
    if (text.includes('lunar')) ownLunar = true
  }
  const elements = members.map((m) => getCharEle(m.characterKey))
  const auras = new Set<string>(
    elements.filter((e) => e !== 'anemo' && e !== 'geo')
  )
  for (const attacks of Object.values(teamOpt.attacks))
    for (const attack of attacks ?? [])
      if (isStellarAttackPath(attack.path)) auras.add('stellar')
  const own = getCharEle(characterKey)
  return {
    attacks: [...attacks],
    auras: [...auras],
    otherElements: new Set(elements.filter((e) => e !== own)).size,
    element: own,
    ownStellar,
    zeroEnergy: energyCalcData[characterKey]?.burstCost === 0,
    burstCost: energyCalcData[characterKey]?.burstCost,
    elements: [...new Set(elements)],
    ownLunar,
    lowHp: characterKey === 'HuTao',
    chainBreaker: members.filter(
      (m) =>
        getCharEle(m.characterKey) !== own ||
        getCharStat(m.characterKey).region === 'natlan'
    ).length,
    teamEnergy: members.reduce(
      (n, m) => n + (energyCalcData[m.characterKey]?.burstCost ?? 0),
      0
    ),
  }
}

/**
 * Per member, how much less Energy Recharge it needs with the team's weapons: what KQM mode's
 * weapon window sets for each weapon (`TeamOptKqm.weaponEnergy`), added up over the team's
 * weapons. (Team optimize's settings for the user's own weapons play no part.)
 */
export function kqmEnergyRelief(
  weaponKeys: readonly WeaponKey[],
  teamOpt: Pick<TeamOpt, 'kqm'>
): Partial<Record<CharacterKey, number>> {
  const relief: Partial<Record<CharacterKey, number>> = {}
  for (const key of new Set(weaponKeys))
    for (const [ck, v] of Object.entries(
      teamOpt.kqm?.weaponEnergy?.[key] ?? {}
    ) as [CharacterKey, number][])
      relief[ck] = (relief[ck] ?? 0) + v
  return relief
}

/**
 * What a KQM calculation takes instead of the team's own: none of the members' gear switches or
 * bonus stats (their builds' settings), and once KQM has its own (set up from the team's), its own
 * kit and team switches and enemy instead of the members' and the team's
 */
export const kqmOwnSettings = (kqm: TeamOptKqm | undefined) => ({
  ownBuild: false,
  ...(kqm?.teamConditional
    ? { ownKit: false, teamConditional: kqm.teamConditional }
    : {}),
  ...(kqm?.enemy ? { enemy: kqm.enemy.enemyOverride } : {}),
})

/**
 * Per optimized member, the weapon and set effects counted by rule where nobody set them (see
 * `itemConditionals`): from what it does in the rotation and the team's elements
 */
export function kqmRuleConditionals(
  database: ArtCharDatabase,
  teamId: string,
  teamOpt: Pick<TeamOpt, 'attacks'>
): Partial<Record<CharacterKey, ReturnType<typeof itemConditionals>>> {
  return Object.fromEntries(
    teamOptMembers(database, teamId).map((m) => {
      const rules = itemConditionals(
        memberCtx(database, teamId, m.characterKey, teamOpt),
        {
          weapons: kqmWeapons(m.characterKey, undefined, { all: true }).map(
            (w) => w.key
          ),
        }
      )
      // a Hexerei member has done its Witch's Homework (kqmsim's default): its bonuses apply even
      // alone, the Secret Rite effects with two or more (the sheets' tally)
      if (HEXEREI_CHARACTERS.includes(m.characterKey))
        rules.conditional[m.characterKey] = {
          ...rules.conditional[m.characterKey],
          lockHomework: 'on',
        }
      return [m.characterKey, rules]
    })
  )
}

/**
 * The calculation overrides of a KQM result's builds, as its run counts them: their weapons and
 * artifacts, level 90 at the result's constellations and the KQM talents, the gear effects on by
 * rule for the rotation it played, KQM mode's own passive switches and the extra buffs. What a
 * page reads one of its builds' attacks or stats with (never the members' own builds).
 */
export function kqmTeamOverrides(
  database: ArtCharDatabase,
  teamId: string,
  teamOpt: TeamOpt,
  result: Pick<KqmResult, 'builds' | 'constellations' | 'played'>
): TeamDataOverrides {
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const talent = kqmTalentLevel(kqm)
  const arts: NonNullable<TeamDataOverrides['arts']> = {}
  const weapons: NonNullable<TeamDataOverrides['weapons']> = {}
  const characters: NonNullable<TeamDataOverrides['characters']> = {}
  for (const [ck, build] of Object.entries(result.builds) as [
    CharacterKey,
    KqmBuild,
  ][]) {
    arts[ck] = kqmArtData(build)
    weapons[ck] = kqmWeaponData(build.weapon, ck)
    characters[ck] = {
      level: 90,
      ascension: 6,
      constellation:
        result.constellations[ck] ?? kqmMemberConstellation(ck, kqm),
      talent: { auto: talent, skill: talent, burst: talent },
    }
  }
  const rules = kqmRuleConditionals(database, teamId, {
    attacks: result.played?.attacks ?? teamOpt.attacks,
  })
  return {
    arts,
    weapons,
    characters,
    extraConditionals: Object.fromEntries(
      Object.entries(rules).map(([ck, rule]) => [ck, rule!.conditional])
    ) as NonNullable<TeamDataOverrides['extraConditionals']>,
    conditionalOverrides: kqm.passives,
    bonusStats: teamOptBonusStats(teamOpt, keys),
    ...kqmOwnSettings(kqm),
  }
}

/**
 * Where a member's search starts: the first allowed weapon, set and main stats, no placed rolls.
 * Only the KQM settings decide it (never the member's own gear), so a run's builds are the same
 * whatever the user has equipped.
 */
function startBuild(space: MemberSpace): KqmBuild {
  return {
    weapon: space.weapons[0],
    sets: space.four[0] ? { [space.four[0]]: 4 } : {},
    mains: { ...space.mains[0] },
    rolls: {},
  }
}

type TeamOptBuffState = NonNullable<TeamOptAttack['states']>[number]
const SET_KEYS: ReadonlySet<string> = new Set(allArtifactSetKeys)
const WEAPON_KEYS: ReadonlySet<string> = new Set(allWeaponKeys)

/**
 * A problem's attacks, where only `dyn`'s artifacts vary: a buff state or limit of a set or weapon
 * that no build in it can have (another member's set or weapon not on it, a weapon `dyn` does not
 * hold) counts nothing there (its sheet needs the pieces or the weapon), so it is dropped, and the
 * attacks it split are merged again. (A replay's candidate windows split them for every option.)
 * `dynSets`: the sets `dyn` may have in it (absent: any). An attack with a limit on some of its
 * hits is not merged: the limit would cover fewer of them.
 */
export function kqmProblemAttacks(
  attacks: TeamOpt['attacks'],
  dyn: CharacterKey,
  state: Partial<Record<CharacterKey, KqmBuild>>,
  dynSets?: ReadonlySet<string>
): TeamOpt['attacks'] {
  const keep = (s: Pick<TeamOptBuffState, 'owner' | 'path'>) => {
    if (s.owner === 'team') return true
    const build = state[s.owner as CharacterKey]
    const key = s.path[0]
    if (!build || !key) return true
    if (WEAPON_KEYS.has(key)) return build.weapon.key === key
    if (SET_KEYS.has(key))
      return s.owner === dyn
        ? !dynSets || dynSets.has(key)
        : !!build.sets[key as ArtifactSetKey]
    return true
  }
  const prune = <T extends Pick<TeamOptBuffState, 'owner' | 'path'>>(
    list: T[]
  ) => list.filter(keep)
  const out: TeamOpt['attacks'] = {}
  for (const [ck, list] of Object.entries(attacks) as [
    CharacterKey,
    TeamOptAttack[] | undefined,
  ][]) {
    if (!list) continue
    const merged = new Map<string, TeamOptAttack>()
    for (const a of list) {
      const next: TeamOptAttack = { ...a }
      if (a.states) next.states = prune(a.states)
      if (a.limits) next.limits = prune(a.limits)
      if (a.reactionContributorStates)
        next.reactionContributorStates = Object.fromEntries(
          Object.entries(a.reactionContributorStates).map(([k, v]) => [
            k,
            v && prune(v),
          ])
        )
      if (a.statSnapshots)
        next.statSnapshots = a.statSnapshots.map((snap) => ({
          ...snap,
          states: prune(snap.states),
        }))
      const partial = next.limits?.some((l) => l.hits > 0 && l.hits < a.hits)
      const id = partial
        ? `#${merged.size}`
        : JSON.stringify({ ...next, hits: 0 })
      const same = merged.get(id)
      if (same) same.hits += a.hits
      else merged.set(id, next)
    }
    out[ck] = [...merged.values()]
  }
  return out
}

/** A team's equipment at a glance: one of `kqmTopTeams` */
export interface KqmTeamOption {
  /** The member whose weapon or sets differ from the run's (absent: the run's own builds) */
  changed?: CharacterKey
  /** Every optimized member's weapon and sets */
  builds: Partial<Record<CharacterKey, Pick<KqmBuild, 'weapon' | 'sets'>>>
  /** The team's damage per rotation */
  total: number
}

/**
 * The run's team, then the best teams that change one member's weapon or sets (the others at
 * their best), by team damage: from the members' rankings, each a whole team's score. Options
 * that miss a requirement, or would give a one-copy weapon to a second member, are left out.
 */
export function kqmTopTeams(result: KqmResult, count = 10): KqmTeamOption[] {
  const own = Object.fromEntries(
    result.optimized.flatMap((ck) => {
      const b = result.builds[ck]
      return b ? [[ck, { weapon: b.weapon, sets: b.sets }]] : []
    })
  ) as KqmTeamOption['builds']
  const id = (b: Pick<KqmBuild, 'weapon' | 'sets'>) =>
    `${b.weapon.key}@${b.weapon.refinement}|${kqmSetsId(b.sets)}`
  const best = new Map<string, KqmTeamOption>()
  for (const ck of result.optimized) {
    const ranking = result.rankings[ck]
    const current = own[ck]
    if (!ranking || !current) continue
    const taken = new Set(
      Object.entries(own)
        .filter(([k]) => k !== ck)
        .map(([, b]) => b!.weapon.key)
        .filter((key) => KQM_ONE_COPY.includes(key))
    )
    for (const option of [...ranking.sets, ...ranking.weapons]) {
      if (option.unmet || option.compare || taken.has(option.weapon.key))
        continue
      if (id(option) === id(current)) continue
      const key = `${ck}|${id(option)}`
      const seen = best.get(key)
      if (seen && seen.total >= option.total) continue
      best.set(key, {
        changed: ck,
        builds: {
          ...own,
          [ck]: { weapon: option.weapon, sets: option.sets },
        },
        total: option.total,
      })
    }
  }
  return [
    { builds: own, total: result.after.total },
    ...[...best.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, Math.max(0, count - 1)),
  ]
}

/** A build's weapon and sets as the rotation simulation plays them (set and weapon effects) */
export const kqmSimGear = (build: KqmBuild): SimGear => ({
  sets: { ...build.sets },
  weapon: build.weapon.key,
  refinement: build.weapon.refinement,
})

/**
 * A quick search's contenders per member after the first round (not `TeamOptKqm.fullSearch`): its best
 * screened weapons, 4-piece sets and 2-piece bonuses, besides what its build holds
 */
const QUICK_WEAPONS = 8
const QUICK_FOUR = 8
const QUICK_TWO_CLASSES = 7
/** …and any other within this share of the best screened total, up to `QUICK_MOST` */
const QUICK_MARGIN = 0.06
const QUICK_MOST = 12
/**
 * Sets and weapons whose effects reach the team (their sheets' team buffs): worth little to a
 * member while a teammate's gives the same, so a quick search never leaves them out (a later round
 * may hand one over)
 */
const givesTeam = (sheet: unknown) =>
  !!(sheet as { data?: { teamBuff?: object } } | undefined)?.data?.teamBuff
const teamSet = (k: string) => givesTeam(getArtSheet(k as ArtifactSetKey))
const teamWeapon = (k: string) => givesTeam(getWeaponSheet(k as WeaponKey))
/** The best `few`, and any other within `QUICK_MARGIN` of the best's total, up to `QUICK_MOST` */
function contendersOf<T>(sorted: { item: T; score: KqmScore }[], few: number) {
  const best = sorted[0]?.score.total ?? 0
  return sorted
    .filter(
      ({ score }, i) =>
        i < few || (i < QUICK_MOST && score.total >= best * (1 - QUICK_MARGIN))
    )
    .map(({ item }) => item)
}

/** Members' builds per team step (search breadth) */
const WEAPONS_SEARCHED = 4
const SETS_SEARCHED = 6
const TWO_PIECE_CLASSES = 5
/** Problems a run keeps compiled (the rounds' and rankings' for every weapon of the team fit) */
const PROBLEMS_KEPT = 200
/** Times a ranked option better than its member's build is taken, and the rounds go on */
const ADOPT_PASSES = 2
/**
 * A member's best ranked weapons and sets searched as pairs at the end (the rankings hold each
 * weapon with the build's sets and each set with the build's weapon: a pair that only wins
 * together is in neither)
 */
const PAIR_WEAPONS = 5
const PAIR_SETS = 5
/** A Favonius holder's best other ranked weapons tried when its Favonius goes to a teammate */
const HANDOFF_WEAPONS = 2
/** Rounds after a ranked option is taken, at most */
const ADOPT_ROUNDS = 2
/**
 * A ranked weapon's option in a ranking's progress, as many sets' (its search, its teammates
 * searched again, its problem built on the page: a set's is one search in the workers)
 */
const WEAPON_OPTION = 10

interface KqmRunArgs {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  onStep?: (step: KqmStep) => void | Promise<void>
  isCancelled?: () => boolean
  maxRounds?: number
  /**
   * The written rotation played for KQM builds (at the KQM constellations, with the builds' own
   * weapons and sets; never the members' own gear): before the search with no gear, then again
   * with the builds found, which are searched again while what it plays changes. Without it, or
   * when it gives nothing, the team's attacks are used as they are.
   */
  replay?: (input: KqmReplayInput) => KqmPlayed | undefined
  /**
   * States every attack of the played rotation gets in this run (not saved with the rotation): e.g.
   * Wolf's Gravestone's passive at its uptime against the team's enemy
   */
  attackStates?: readonly RunAttackState[]
  /**
   * The builds found so far, with their rankings, when a ranking finds a better build and the run
   * goes on to take it: shown while the run improves on them (its result replaces them)
   */
  onEarly?: (result: KqmResult) => void
  /**
   * Another run's builds to start from (the same team at another constellation): its members'
   * rounds only, from them (no warm-up, no rankings, no passes after them), a quick neighbour of
   * that run. Its result has no rankings.
   */
  from?: Partial<Record<CharacterKey, KqmBuild>>
  /**
   * With `from`: the members searched again (one, or several), their weapons and sets kept (main
   * stats and rolls refitted); the others keep their builds. Members at other constellations, for
   * about one ranking row's work each.
   */
  only?: CharacterKey | readonly CharacterKey[]
}
/** Times the rotation is played again for the builds found (each time they change it) */
const REPLAYS = 2
export const optimizeTeamKqm = (args: KqmRunArgs) => runKqm(args)

/** A run's problems and finished set searches, for one way of playing the rotation */
interface KqmWork {
  problems: Map<string, Promise<Problem | undefined>>
  searches: Map<string, KqmSetSearch | undefined>
}
/**
 * The latest run's work, for its inspector's comparisons (only one run's: problems are large): a
 * pick that plays the rotation as the run did builds none of the run's problems again, and
 * searches no set the run searched. By the members' setup and the way the rotation was played
 * (`workKey`), the two latest at most.
 */
let lastWork: { root: KqmResult; byPlayed: Map<string, KqmWork> } | undefined
/** A comparison's result: the run it compares in */
const rootOf = new WeakMap<KqmResult, KqmResult>()
const WORK_PLAYS_KEPT = 2
const playedKey = (p: KqmPlayed | undefined) =>
  p ? JSON.stringify([p.attacks, p.rotationTime]) : ''
/** Workers are kept this long after a comparison (the next pick needs them again) */
const COMPARE_WORKERS_KEPT_MS = 30_000
/** Finished set searches kept for comparisons, per way of playing (small: a build and score) */
const SEARCHES_KEPT = 6000

/** Re-rank one member for a chosen weapon/set pair, keeping every teammate's build fixed. */
export async function compareTeamKqm({
  result,
  characterKey,
  weapon,
  sets,
  onPreview,
  ...args
}: Omit<KqmRunArgs, 'maxRounds'> & {
  result: KqmResult
  characterKey: CharacterKey
  weapon: KqmWeapon
  sets: KqmSets
  /**
   * The team with the pick, as soon as its build is found (its rankings not yet: `rankings` has
   * none); the result follows with this member's rankings
   */
  onPreview?: (preview: KqmResult) => void
}): Promise<KqmResult | undefined> {
  return runKqm({
    ...args,
    maxRounds: 0,
    comparison: { result, characterKey, weapon, sets, onPreview },
  })
}

async function runKqm({
  database,
  teamId,
  gender,
  teamOpt,
  onStep,
  isCancelled = () => false,
  maxRounds = 3,
  replay: replayRaw,
  attackStates,
  onEarly,
  from,
  only,
  comparison,
}: KqmRunArgs & {
  comparison?: {
    result: KqmResult
    characterKey: CharacterKey
    weapon: KqmWeapon
    sets: KqmSets
    onPreview?: (preview: KqmResult) => void
  }
}): Promise<KqmResult | undefined> {
  // (the played attacks carry the run's own states, and so does its result; a gear pick plays with
  // its result's)
  const states = attackStates ?? playedAttackStates(comparison?.result.played)
  const replay: KqmRunArgs['replay'] =
    replayRaw &&
    ((input) => {
      const played = replayRaw(input)
      return played && states?.length
        ? { ...played, attacks: withAttackStates(played.attacks, states) }
        : played
    })
  const tick = ticker(isCancelled)
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  /** A member's artifact standard: its distributed rolls (KQMS: 20) */
  const rollsOf = (ck: CharacterKey) => kqmMemberRolls(ck, kqm)
  const members = teamOptMembers(database, teamId)
  const keys = members.map((m) => m.characterKey)
  // The rotation the builds are for: as played for them (`replay`), else the team's attacks. A
  // comparison keeps its run's (its `teamOpt` has them).
  let played: KqmPlayed | undefined = comparison?.result.played
  const attacksNow = () => played?.attacks ?? teamOpt.attacks
  const rotationTimeNow = () => played?.rotationTime ?? teamOpt.rotationTime
  // the calculator's settings as they fit the team now (members, rotation time, constellations
  // may have changed since they were saved)
  const calculatorFor = (rotationTime: number | undefined) =>
    kqm.energySource === 'calculator' && kqm.energyCalculator
      ? {
          ...syncEnergyCalculator(
            keys,
            kqm.energyCalculator,
            rotationTime ?? kqm.energyCalculator.rotationTime,
            teamOpt.onField ?? keys[0],
            Object.fromEntries(
              keys.map((k) => [k, kqmMemberConstellation(k, kqm)])
            )
          ),
          rotationTime: rotationTime ?? kqm.energyCalculator.rotationTime,
        }
      : undefined
  let calculator = calculatorFor(rotationTimeNow())
  if (kqm.energySource === 'calculator') {
    if (!calculator)
      throw new Error(
        'Configure the ER calculator before generating KQM builds.'
      )
    const estimate = calculateEnergyRecharge(keys, calculator)
    if (estimate.errors.length) throw new Error(estimate.errors.join(' '))
  }
  // KQM Theorycrafting is the KQM standard for the whole team: every member gets a KQM build
  // (Team optimize's kept members are a setting of that tab only)
  const optimized = members
  if (!optimized.length) return undefined
  for (const m of optimized)
    if (!kqmWeapons(m.characterKey, kqm).length)
      throw new Error(
        `Select at least one weapon for ${m.characterKey} in KQM settings.`
      )
  // (a one-copy weapon locked for a member is no one else's)
  const lockedOnce = new Map<WeaponKey, CharacterKey>()
  for (const { characterKey: ck } of optimized) {
    const key = kqmLockedWeapon(ck, kqm)?.key
    if (!key || !KQM_ONE_COPY.includes(key)) continue
    const other = lockedOnce.get(key)
    if (other)
      throw new Error(
        `${key} is locked for both ${other} and ${ck}, but there is only one.`
      )
    lockedOnce.set(key, ck)
  }
  const characters = Object.fromEntries(
    optimized.map(({ characterKey }) => [
      characterKey,
      {
        level: 90,
        ascension: 6,
        constellation: kqmMemberConstellation(characterKey, kqm),
        talent: {
          auto: kqmTalentLevel(kqm),
          skill: kqmTalentLevel(kqm),
          burst: kqmTalentLevel(kqm),
        },
      },
    ])
  )
  const constellations = Object.fromEntries(
    optimized.map(({ characterKey }) => [
      characterKey,
      characters[characterKey]!.constellation,
    ])
  )
  // a member's requirement is KQM's ER target only (its Optimize tab's stat filters are not KQM's)
  const baseFilters = Object.fromEntries(
    members.map(({ characterKey }) => [
      characterKey,
      {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: kqmEnergyRequirement(kqm, characterKey), disabled: false },
        ],
      },
    ])
  ) as Partial<Record<CharacterKey, StatFilters>>
  const bonusStats = teamOptBonusStats(teamOpt, keys)
  const spaces = new Map(
    optimized.map((m) => {
      const space = memberSpace(m, kqm)
      const weapons = space.weapons.filter(
        (w) => (lockedOnce.get(w.key) ?? m.characterKey) === m.characterKey
      )
      return [m.characterKey, { ...space, weapons }]
    })
  )
  for (const [ck, { weapons }] of spaces)
    if (!weapons.length)
      throw new Error(
        `Select another weapon for ${ck} in KQM settings: its only one is locked for another member.`
      )
  // (members refitted: their weapons and sets as they were, their main stats free; the others
  // keep their builds)
  const refitted =
    from && only !== undefined
      ? new Set<CharacterKey>(typeof only === 'string' ? [only] : only)
      : undefined
  for (const k of refitted ?? []) {
    const build = from?.[k]
    const space = spaces.get(k)
    if (!build || !space) continue
    const sets = Object.entries(build.sets) as [ArtifactSetKey, number][]
    spaces.set(k, {
      ...space,
      weapons: space.weapons.filter(
        (w) =>
          w.key === build.weapon.key && w.refinement === build.weapon.refinement
      ),
      four: sets.filter(([, n]) => n >= 4).map(([k]) => k),
      two: sets.filter(([, n]) => n === 2).map(([k]) => k),
    })
  }
  // (a pick after a quick run searches that run's contenders, and the picked weapon and sets)
  const rootOut = kqm.fullSearch ? undefined : comparison?.result.screenedOut
  for (const [k, out] of Object.entries(rootOut ?? {}) as [
    CharacterKey,
    { weapons: KqmWeapon[]; sets: ArtifactSetKey[] },
  ][]) {
    const space = spaces.get(k)
    if (!space) continue
    const pick = k === comparison?.characterKey ? comparison : undefined
    const out1 = new Set(
      out.weapons
        .filter(
          (w) =>
            w.key !== pick?.weapon.key ||
            w.refinement !== pick?.weapon.refinement
        )
        .map((w) => `${w.key}@${w.refinement}`)
    )
    const outSets = new Set(out.sets.filter((set) => !pick?.sets[set]))
    spaces.set(k, {
      ...space,
      weapons: space.weapons.filter(
        (w) => !out1.has(`${w.key}@${w.refinement}`)
      ),
      four: space.four.filter((set) => !outSets.has(set)),
      two: space.two.filter((set) => !outSets.has(set)),
    })
  }
  /**
   * The weapons a member may take with the others' builds in `state`: not a one-copy weapon
   * (`KQM_ONE_COPY`: a quest reward like Exaiphanes' Blade) another member already has
   */
  const weaponsFor = (
    ck: CharacterKey,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ) => {
    const all = spaces.get(ck)?.weapons ?? []
    const taken = new Set(
      Object.entries(state)
        .filter(
          ([k, b]) => k !== ck && b && KQM_ONE_COPY.includes(b.weapon.key)
        )
        .map(([, b]) => b!.weapon.key)
    )
    return taken.size ? all.filter((w) => !taken.has(w.key)) : all
  }
  /** The sets and weapons a member's search may give it (see `SimGear.candidates`) */
  const candidatesOf = (ck: CharacterKey) => {
    const space = spaces.get(ck)
    return {
      sets: [...new Set([...(space?.four ?? []), ...(space?.two ?? [])])],
      weapons: [...new Set((space?.weapons ?? []).map((w) => w.key))],
    }
  }
  // the weapon and set effects nobody set up, by rule; KQM mode's own (`conditionalOverrides`)
  // over them (the members' own switches for their gear play no part: `ownBuild`)
  // (from what the members do in the rotation: again when it is played differently)
  const ruleConditionals = () => {
    const ctx = kqmRuleConditionals(database, teamId, { attacks: attacksNow() })
    return {
      ctx,
      extra: Object.fromEntries(
        Object.entries(ctx).map(([k, v]) => [k, v!.conditional])
      ) as Partial<Record<CharacterKey, IConditionalValues>>,
    }
  }
  let { ctx: ctxConditionals, extra: extraConditionals } = ruleConditionals()
  const conditionalOverrides = kqm.passives

  const builds: Partial<Record<CharacterKey, KqmBuild>> = comparison
    ? structuredClone(comparison.result.builds)
    : {}
  if (!comparison)
    for (const m of optimized) {
      const space = spaces.get(m.characterKey)!
      const start = from?.[m.characterKey]
      // (another run's build, while its weapon is allowed here)
      builds[m.characterKey] =
        start &&
        space.weapons.some(
          (w) =>
            w.key === start.weapon.key &&
            w.refinement === start.weapon.refinement
        )
          ? structuredClone(start)
          : startBuild(space)
    }

  const gearOf = (state: Partial<Record<CharacterKey, KqmBuild>>) => {
    const arts: Partial<Record<CharacterKey, Data>> = {}
    const weapons: Partial<Record<CharacterKey, ICachedWeapon>> = {}
    for (const [ck, b] of Object.entries(state) as [CharacterKey, KqmBuild][]) {
      arts[ck] = kqmArtData(b)
      weapons[ck] = kqmWeaponData(b.weapon, ck)
    }
    return { arts, weapons }
  }
  // (every member has a KQM build in `state`: its weapon is the one counted)
  const filtersFor = (state: Partial<Record<CharacterKey, KqmBuild>>) => {
    const relief = kqmEnergyRelief(
      Object.values(state).map((b) => b!.weapon.key),
      teamOpt
    )
    const calculated = calculator
      ? calculateEnergyRecharge(
          keys,
          calculator,
          Object.fromEntries(
            Object.entries(state).map(([ck, b]) => [ck, b!.weapon.key])
          ),
          Object.fromEntries(
            Object.entries(state).map(([ck, b]) => [ck, b!.weapon.refinement])
          ),
          Object.fromEntries(
            Object.entries(state).map(([ck, b]) => [ck, b!.sets])
          )
        )
      : undefined
    if (calculated?.errors.length) throw new Error(calculated.errors.join(' '))
    return Object.fromEntries(
      Object.entries(baseFilters).map(([ck, f]) => [
        ck,
        calculated
          ? {
              ...f,
              [JSON.stringify(['basic', 'enerRech_'])]: [
                {
                  value: calculated.targets[ck as CharacterKey]!,
                  disabled: false,
                },
              ],
            }
          : withEnergyRelief(f ?? {}, relief[ck as CharacterKey] ?? 0),
      ])
    ) as Partial<Record<CharacterKey, StatFilters>>
  }

  /**
   * The teammates whose requirements change when `ck` holds `weapon` instead of its weapon in
   * `state` (an energy weapon: Favonius particles, a weapon's energy in the ER calculator or in
   * KQM's weapon window)
   */
  const affectedBy = (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ) => {
    const own = state[ck]
    if (!own || own.weapon.key === weapon.key) return []
    const before = filtersFor(state)
    const after = filtersFor({ ...state, [ck]: { ...own, weapon } })
    return optimized
      .map((m) => m.characterKey)
      .filter(
        (j) =>
          j !== ck && JSON.stringify(before[j]) !== JSON.stringify(after[j])
      )
  }

  /**
   * `build` for `ck` in `state`, with the teammates whose requirements its weapon changes searched
   * again (their weapons and sets kept): their artifacts then use the ER it frees, or make up
   * what it no longer gives. Their new builds, and the team's score with them; undefined when its
   * weapon changes nobody's requirement.
   */
  const settleTeammates = async (
    ck: CharacterKey,
    build: KqmBuild,
    state: Partial<Record<CharacterKey, KqmBuild>>,
    counter?: Counter
  ): Promise<
    { team: Partial<Record<CharacterKey, KqmBuild>>; score: Score } | undefined
  > => {
    const affected = affectedBy(ck, build.weapon, state)
    if (!affected.length) return undefined
    const next = { ...state, [ck]: build }
    const team: Partial<Record<CharacterKey, KqmBuild>> = {}
    let score: Score | undefined
    for (const j of affected) {
      const own = next[j]!
      const problem = await problemFor(j, own.weapon, next)
      if (!problem) continue
      const current = scoreOf(problem, kqmValues(own))
      const [top] = await searchArtifacts(j, own.weapon, next, {
        setsList: [own.sets],
        setsKept: 1,
        counter,
      })
      if (top && better(top.score, current)) {
        next[j] = top.build
        team[j] = top.build
        score = top.score
      } else score = current
    }
    return score ? { team, score } : undefined
  }

  // a comparison takes its run's work (see `lastWork`), as the rotation plays now
  const root = comparison
    ? (rootOf.get(comparison.result) ?? comparison.result)
    : undefined
  const workFor = (key: string): KqmWork => {
    const fresh = () => ({ problems: new Map(), searches: new Map() })
    if (!root) return fresh()
    if (lastWork?.root !== root) lastWork = { root, byPlayed: new Map() }
    const { byPlayed } = lastWork
    const found = byPlayed.get(key)
    if (found) {
      // (the latest used last)
      byPlayed.delete(key)
      byPlayed.set(key, found)
      return found
    }
    const work = fresh()
    byPlayed.set(key, work)
    while (byPlayed.size > WORK_PLAYS_KEPT)
      byPlayed.delete(byPlayed.keys().next().value!)
    return work
  }
  // (a new run drops the last one's: problems are large)
  if (!comparison) lastWork = undefined
  // the work is for the members as they are set up (a member's settings changed since the run:
  // none of it), and for the rotation as played
  const teamStamp = JSON.stringify(
    members.map((m) => [m.teamChar, m.loadoutDatum])
  )
  const workKey = (p: KqmPlayed | undefined) => `${teamStamp}\n${playedKey(p)}`
  let work = workFor(workKey(played))

  // (the sets a member's problem holds the effects of: its space's, fewer once narrowed)
  const spaceSets = new WeakMap<
    MemberSpace,
    { sets: Set<string>; id: string }
  >()
  const setsOf = (ck: CharacterKey) => {
    const space = spaces.get(ck)
    if (!space) return undefined
    let found = spaceSets.get(space)
    if (!found) {
      const sets = new Set<string>([...space.four, ...space.two])
      found = { sets, id: [...sets].sort().join(',') }
      spaceSets.set(space, found)
    }
    return found
  }
  /** The team's damage as a function of `ck`'s artifacts, with `weapon` on it, the others as in `state` */
  const problemKey = (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ) =>
    `${ck}|${weapon.key}@${weapon.refinement}|${Object.entries(state)
      .filter(([k]) => k !== ck)
      .map(([k, b]) => `${k}=${buildId(b!)}`)
      .sort()
      .join(';')}|${setsOf(ck)?.id ?? ''}`
  // (built in the builders' workers, several at once: see `kqmBuildPool`)
  const builder = kqmProblemBuilder(database, isCancelled)
  const problemFor = (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ): Promise<Problem | undefined> => {
    const cacheKey = problemKey(ck, weapon, state)
    const problemCache = work.problems
    const kept = problemCache.get(cacheKey)
    if (kept) {
      // (the latest used are the last dropped)
      problemCache.delete(cacheKey)
      problemCache.set(cacheKey, kept)
      return kept
    }
    const withWeapon = { ...state, [ck]: { ...state[ck]!, weapon } }
    const { arts, weapons } = gearOf(withWeapon)
    delete arts[ck]
    const built = builder.build(teamId, gender, {
      dyn: ck,
      arts,
      attacks: kqmProblemAttacks(
        attacksNow(),
        ck,
        withWeapon,
        setsOf(ck)?.sets
      ),
      statFilters: calculator
        ? filtersFor(withWeapon)
        : { [ck]: filtersFor(withWeapon)[ck] ?? {} },
      weapons,
      extraConditionals,
      conditionalOverrides,
      ...kqmOwnSettings(kqm),
      characters,
      onField: teamOpt.onField,
      bonusStats,
    })
    const problem = built.then((b) => b && compile(b, rollsOf(ck)))
    // (one that failed is built again when asked for again; a wait that was cancelled is no error)
    problem.catch(() => {
      if (problemCache.get(cacheKey) === problem) problemCache.delete(cacheKey)
    })
    // (the oldest go first: a problem is large compiled code)
    while (problemCache.size >= PROBLEMS_KEPT)
      problemCache.delete(problemCache.keys().next().value!)
    problemCache.set(cacheKey, problem)
    return problem
  }

  // Progress: a member's search is a unit, a member's rankings 2.5 (every weapon and every set
  // tried, the teammates searched again for the energy weapons); two rounds are expected (one to
  // find the builds, one to confirm them), a third is added when the second changes one
  const steps = optimized.length
  const rankedMembers = comparison
    ? optimized.filter((m) => m.characterKey === comparison.characterKey)
    : from
      ? []
      : optimized
  const RANK_UNITS = 2.5
  // The rankings may find a better build, then more rounds and rankings follow (`ADOPT_PASSES`):
  // the line stops short of the end until they are known (`CEILINGS`, by pass), and the room left
  // is what they fill. With none, the run ends there.
  const CEILINGS = [0.7, 0.88]
  const ceilingOf = (pass: number) =>
    comparison || from || maxRounds === 0 || pass >= ADOPT_PASSES
      ? 1
      : (CEILINGS[pass] ?? 1)
  let ceiling = ceilingOf(0)
  let improving = false
  let plannedRounds = Math.min(maxRounds, 2)
  let tried = 0
  let shown = 0
  // when more work is planned (another round), the rest of the line is shared out from where
  // it is, so that it keeps moving instead of waiting for the estimate to catch up
  let rebase = { shown: 0, units: 0, total: 0, ceiling }
  const emit = (
    step: Omit<KqmStep, 'maxRounds' | 'progress' | 'tried'>,
    units: number
  ) => {
    const total = plannedRounds * steps + RANK_UNITS * rankedMembers.length
    if (total !== rebase.total || ceiling !== rebase.ceiling)
      rebase = { shown, units, total, ceiling }
    const left = total - rebase.units
    const progress =
      left > 0
        ? rebase.shown +
          ((ceiling - rebase.shown) * (units - rebase.units)) / left
        : ceiling
    shown = Math.max(shown, Math.min(ceiling, progress))
    return onStep?.({
      ...step,
      ...(improving && step.phase === 'search' && { improving: true }),
      maxRounds,
      progress: shown,
      tried,
    })
  }
  const cancelled = (e: unknown) =>
    e instanceof KqmSearchCancelled ? new TeamOptCancelled() : e

  /** A set's search (main stats and rolls), in a worker; each one once per run */
  const setSearches = new Map<string, Promise<KqmSetSearch | undefined>>()
  interface Counter {
    done: number
    total: number
    onDone?: () => void
  }
  const setSearch = (
    ck: CharacterKey,
    problem: Problem,
    sets: KqmSets,
    counter?: Counter
  ) => {
    const key = `${problem.spec.id}|${kqmSetsId(sets)}`
    let search = setSearches.get(key)
    // (searched before, in the run or an earlier comparison)
    if (!search && work.searches.has(key)) {
      search = Promise.resolve(work.searches.get(key))
      setSearches.set(key, search)
    }
    if (!search) {
      const task: KqmSetTask = {
        problem: problem.spec,
        local: problem,
        sets,
        mains: spaces.get(ck)!.mains,
      }
      const { searches } = work
      search = queueKqmSetTasks([task], kqmMainValues(), isCancelled)[0].then(
        (r) => {
          tried += r?.tried ?? 0
          // (kept for the comparisons after; the oldest go first)
          searches.set(key, r)
          if (searches.size > SEARCHES_KEPT)
            searches.delete(searches.keys().next().value!)
          return r
        }
      )
      // (a search nobody waits for any more, after a cancel, is no error)
      search.catch(() => undefined)
      setSearches.set(key, search)
    }
    if (counter) {
      counter.total++
      search.then(
        () => {
          counter.done++
          counter.onDone?.()
        },
        () => undefined
      )
    }
    return search
  }

  /**
   * The best sets, main stats and rolls for `ck` with `weapon` (sets limited to `setsList` if
   * given): the sets screened here, each one's main stats and rolls searched in the workers
   */
  const searchArtifacts = async (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>,
    {
      setsList,
      setsKept = SETS_SEARCHED,
      counter,
    }: { setsList?: KqmSets[]; setsKept?: number; counter?: Counter } = {}
  ): Promise<{ build: KqmBuild; score: Score }[]> => {
    const problem = await problemFor(ck, weapon, state)
    return problem
      ? searchWith(ck, weapon, state, problem, { setsList, setsKept, counter })
      : []
  }
  /** `searchArtifacts` with the problem at hand (its searches queued now) */
  const searchWith = (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>,
    problem: Problem,
    {
      setsList,
      setsKept = SETS_SEARCHED,
      counter,
    }: { setsList?: KqmSets[]; setsKept?: number; counter?: Counter } = {}
  ): Promise<{ build: KqmBuild; score: Score }[]> => {
    const space = spaces.get(ck)!
    const current = state[ck]!
    const evalPick = (sets: KqmSets, mains: KqmMains) =>
      scoreOf(
        problem,
        kqmValues({
          sets,
          mains,
          rolls: cappedRolls(current.rolls, mains, rollsOf(ck)),
        })
      )
    const combos = setsList ?? setCombos(problem, space, current)
    // sets screened with the current main stats and rolls
    const screened = combos
      .map((sets) => ({ sets, score: evalPick(sets, current.mains) }))
      .sort((a, b) => compareScores(a.score, b.score))
      .slice(0, setsKept)
    return Promise.all(
      screened.map(({ sets }) => setSearch(ck, problem, sets, counter))
    ).then((found) =>
      found
        .flatMap((r, i) =>
          r
            ? [
                {
                  build: {
                    weapon,
                    sets: screened[i].sets,
                    mains: r.mains,
                    rolls: r.rolls,
                  },
                  score: r.score,
                },
              ]
            : []
        )
        .sort((a, b) => compareScores(a.score, b.score))
    )
  }

  /**
   * 4-piece sets, and 2+2 of the best 2-piece bonuses: sets with the same bonus are one class
   * (named by the best-known set), paired with another class or with a second set of its own (two
   * 2-piece ATK sets stack: Gladiator's Finale + Shimenawa's Reminiscence)
   */
  const setCombos = (
    problem: Problem,
    space: MemberSpace,
    current: KqmBuild
  ): KqmSets[] => {
    const rolls = current.rolls
    const value = (sets: KqmSets) =>
      scoreOf(problem, kqmValues({ sets, mains: current.mains, rolls })).total
    const none = value({})
    const scored = space.two
      .map((k) => ({ k, v: value({ [k]: 2 }) }))
      .sort((a, b) => b.v - a.v || pref(a.k) - pref(b.k))
    const classes: { v: number; sets: ArtifactSetKey[] }[] = []
    for (const x of scored) {
      const same = classes.find(
        (c) => Math.abs(c.v - x.v) <= 1e-9 * Math.abs(x.v)
      )
      if (same) same.sets.push(x.k)
      else classes.push({ v: x.v, sets: [x.k] })
    }
    const kept = classes.slice(0, TWO_PIECE_CLASSES)
    return [
      ...space.four.map((k) => ({ [k]: 4 }) as KqmSets),
      ...kept.flatMap((a, i) => [
        // (a bonus worth nothing to the member is not doubled)
        ...(a.sets.length > 1 && a.v > none + 1e-9 * Math.abs(none)
          ? [{ [a.sets[0]]: 2, [a.sets[1]]: 2 } as KqmSets]
          : []),
        ...kept
          .slice(i + 1)
          .map((b) => ({ [a.sets[0]]: 2, [b.sets[0]]: 2 }) as KqmSets),
      ]),
    ]
  }

  /**
   * One member's step: weapons screened with its current artifacts, then the best few searched
   * (all at once, in the workers; its current weapon's search starts first, while the others are
   * screened)
   */
  const memberStep = async (
    ck: CharacterKey,
    state: Partial<Record<CharacterKey, KqmBuild>>,
    report: (
      stage: 'weapons' | 'artifacts',
      done: number,
      total: number
    ) => void,
    /** Work for this thread while the workers search (it stops once they are done) */
    whileSearching?: (done: () => boolean) => Promise<void>
  ) => {
    const space = spaces.get(ck)!
    const current = state[ck]!
    const counter: Counter = { done: 0, total: 0 }
    const searches = new Map<string, ReturnType<typeof searchArtifacts>>()
    // (the weapons' problems, as they come: their searches are then queued at once)
    const built = new Map<string, Problem>()
    const search = (weapon: KqmWeapon) => {
      const id = `${weapon.key}@${weapon.refinement}`
      let found = searches.get(id)
      if (!found) {
        const problem = built.get(id)
        found = problem
          ? searchWith(ck, weapon, state, problem, { counter })
          : searchArtifacts(ck, weapon, state, { counter })
        searches.set(id, found)
      }
      return found
    }
    if (weaponsFor(ck, state).some((w) => w.key === current.weapon.key))
      search(current.weapon).catch(() => undefined)
    // The workers are free while the weapons are tried here: each weapon's search with the current
    // sets starts as soon as it is tried (so that at the end no weapon in the member's ranking,
    // each weapon with the chosen sets, beats the chosen build), and a weapon's full search as
    // soon as it is among the best few so far (most of them stay)
    const withCurrentSets: ReturnType<typeof searchArtifacts>[] = []
    const screened: { weapon: KqmWeapon; score: Score }[] = []
    const allowed = weaponsFor(ck, state)
    // (all of them asked for now: the builders build several at once)
    const problems = allowed.map((weapon) => problemFor(ck, weapon, state))
    for (const p of problems) p.catch(() => undefined)
    for (const [i, weapon] of allowed.entries()) {
      await tick()
      report('weapons', i, allowed.length)
      const problem = await problems[i]
      if (!problem) continue
      built.set(`${weapon.key}@${weapon.refinement}`, problem)
      const score = scoreOf(problem, kqmValues(current))
      screened.push({ weapon, score })
      const found = searchWith(ck, weapon, state, problem, {
        setsList: [current.sets],
        setsKept: 1,
        counter,
      })
      found.catch(() => undefined)
      withCurrentSets.push(found)
      if (
        screened.filter((s) => better(s.score, score)).length < WEAPONS_SEARCHED
      )
        search(weapon).catch(() => undefined)
    }
    tried += allowed.length
    screened.sort((a, b) => compareScores(a.score, b.score))
    weaponScreens.set(ck, screened)
    const weapons = screened.slice(0, WEAPONS_SEARCHED).map((s) => s.weapon)
    if (
      allowed.some((w) => w.key === current.weapon.key) &&
      !weapons.some((w) => w.key === current.weapon.key)
    )
      weapons.push(current.weapon)
    const found = weapons.map(search)
    counter.onDone = () => report('artifacts', counter.done, counter.total)
    report('artifacts', counter.done, counter.total)
    const all = Promise.all([...found, ...withCurrentSets])
    let finished = false
    all.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      }
    )
    await whileSearching?.(() => finished)
    let best: { build: KqmBuild; score: Score } | undefined
    for (const [top] of await all)
      if (top && (!best || better(top.score, best.score))) best = top
    return best
  }

  /**
   * While a member's artifacts are searched (in the workers), this thread builds the next
   * member's problems as if this member's build stays: it usually does once the builds have
   * settled, and then the next step finds them built
   */
  const prebuild =
    (ck: CharacterKey, state: Partial<Record<CharacterKey, KqmBuild>>) =>
    async (done: () => boolean) => {
      const space = spaces.get(ck)
      if (!space) return
      for (const weapon of space.weapons) {
        await yieldTask()
        if (done() || isCancelled()) return
        await problemFor(ck, weapon, state).catch(() => undefined)
      }
    }

  const rankings: Partial<Record<CharacterKey, KqmRanking>> = {}

  // A quick search (not `TeamOptKqm.fullSearch`): after the first round each member keeps its contenders,
  // the weapons and sets near its best besides its build's and the ones that give the team
  // something; the later rounds, the replays' candidates and the rankings use only them (a
  // comparison or a refit searches what its run allows)
  const quick = !kqm.fullSearch && !comparison && !from
  let narrowed = false
  const weaponScreens = new Map<
    CharacterKey,
    { weapon: KqmWeapon; score: Score }[]
  >()
  const screenedOut: NonNullable<KqmResult['screenedOut']> = {}
  const narrowToContenders = async () => {
    narrowed = true
    const weaponId = (w: KqmWeapon) => `${w.key}@${w.refinement}`
    for (const { characterKey: ck } of optimized) {
      const space = spaces.get(ck)
      const build = builds[ck]
      if (!space || !build) continue
      const problem = await problemFor(ck, build.weapon, builds)
      if (!problem) continue
      const value = (sets: KqmSets) =>
        scoreOf(problem, kqmValues({ ...build, sets }))
      // (a weapon or set that gives the team Energy stays: what it frees teammates is found when
      // they are searched again)
      const screen = weaponScreens.get(ck) ?? []
      const keptWeapons = new Set(
        screen.length
          ? [
              ...contendersOf(
                screen.map((s) => ({
                  item: weaponId(s.weapon),
                  score: s.score,
                })),
                QUICK_WEAPONS
              ),
              weaponId(build.weapon),
              ...space.weapons
                .filter(
                  (w) =>
                    isFavonius(w.key) ||
                    isCalcEnergyWeapon(w.key) ||
                    teamWeapon(w.key)
                )
                .map(weaponId),
            ]
          : space.weapons.map(weaponId)
      )
      const four = space.four
        .map((k) => ({ item: k, score: value({ [k]: 4 }) }))
        .sort(
          (a, b) =>
            compareScores(a.score, b.score) || pref(a.item) - pref(b.item)
        )
      // (2-piece bonuses alike count once, as in `setCombos`: two sets of each kept, for its 2+2)
      const classes: { v: number; sets: ArtifactSetKey[] }[] = []
      for (const x of space.two
        .map((k) => ({ k, v: value({ [k]: 2 }).total }))
        .sort((a, b) => b.v - a.v || pref(a.k) - pref(b.k))) {
        const same = classes.find(
          (c) => Math.abs(c.v - x.v) <= 1e-9 * Math.abs(x.v)
        )
        if (same) same.sets.push(x.k)
        else classes.push({ v: x.v, sets: [x.k] })
      }
      // (the team's sets too: one may be handed over to this member later)
      const held = optimized.flatMap(
        ({ characterKey: k }) =>
          Object.keys(builds[k]?.sets ?? {}) as ArtifactSetKey[]
      )
      const shared = [...space.four, ...space.two].filter(teamSet)
      const keptFour = new Set<ArtifactSetKey>([
        ...contendersOf(four, QUICK_FOUR),
        ...held,
        ...shared,
        ...space.four.filter((k) => k === 'TheExile'),
      ])
      const keptTwo = new Set([
        ...classes
          .slice(0, QUICK_TWO_CLASSES)
          .flatMap((c) => c.sets.slice(0, 2)),
        ...held,
        ...shared,
      ])
      spaces.set(ck, {
        ...space,
        weapons: space.weapons.filter((w) => keptWeapons.has(weaponId(w))),
        four: space.four.filter((k) => keptFour.has(k)),
        two: space.two.filter((k) => keptTwo.has(k)),
      })
      screenedOut[ck] = {
        weapons: space.weapons.filter((w) => !keptWeapons.has(weaponId(w))),
        sets: [...new Set([...space.four, ...space.two])].filter(
          (k) => !keptFour.has(k) && !keptTwo.has(k)
        ),
      }
    }
  }

  // Rounds of member steps (each member's search with the others' builds fixed), until no
  // build changes. A step is skipped when its result is known: its last one changed nothing and
  // no other build changed since.
  let rounds = 0
  let changes = 0
  const lastChange: Partial<Record<CharacterKey, number>> = {}
  const settled: Partial<Record<CharacterKey, number>> = {}
  /** Rounds `first` to `last` at most, until one changes no build */
  const descend = async (first: number, last: number) => {
    for (let round = first; round <= last; round++) {
      rounds = round
      let changed = false
      for (const [i, m] of optimized.entries()) {
        const ck = m.characterKey
        // (members refitted: the others keep their builds)
        if (refitted && !refitted.has(ck)) continue
        const base = (round - 1) * steps + i
        await emit(
          { phase: 'search', round, step: i + 1, steps, characterKey: ck },
          base
        )
        if (isCancelled()) throw new TeamOptCancelled()
        const known =
          settled[ck] !== undefined &&
          optimized.every(
            ({ characterKey: other }) =>
              other === ck || (lastChange[other] ?? 0) <= settled[ck]!
          )
        if (
          known &&
          weaponsFor(ck, builds).some((w) => w.key === builds[ck]!.weapon.key)
        )
          continue
        const before = builds[ck]!
        const problem = await problemFor(ck, before.weapon, builds)
        // (a one-copy weapon another member has: any allowed build replaces it)
        const conflict = !weaponsFor(ck, builds).some(
          (w) => w.key === before.weapon.key
        )
        const beforeScore =
          problem && !conflict ? scoreOf(problem, kqmValues(before)) : undefined
        // (from the second round, when builds mostly stay: see `prebuild`)
        const next = optimized[(i + 1) % steps].characterKey
        const best = await memberStep(
          ck,
          builds,
          (stage, done, total) =>
            emit(
              {
                phase: 'search',
                round,
                step: i + 1,
                steps,
                characterKey: ck,
                stage,
                done,
                total,
              },
              base +
                // (trying the weapons builds a problem for each: most of a step's time)
                (stage === 'weapons'
                  ? 0.75 * (total ? done / total : 0)
                  : 0.75 + 0.25 * (total ? done / total : 0))
            ),
          round > 1 && next !== ck ? prebuild(next, builds) : undefined
        )
        if (
          best &&
          (!beforeScore || better(best.score, beforeScore)) &&
          buildId(best.build) !== buildId(before)
        ) {
          changed = true
          builds[ck] = best.build
          lastChange[ck] = ++changes
          delete settled[ck]
        } else {
          if (best && (!beforeScore || better(best.score, beforeScore)))
            builds[ck] = best.build
          settled[ck] = changes
        }
      }
      if (quick && !narrowed) await narrowToContenders()
      if (!changed) break
      if (round === plannedRounds && round < last) plannedRounds++
    }
    plannedRounds = rounds
  }

  /** Each ranked member's rankings: each list varies one item, the rest of the team fixed */
  const rankAll = async () => {
    // Each list varies one item; the selected weapon/set and every teammate stay fixed. The
    // members are ranked together, their searches in the workers.
    const rankBase = rounds * steps
    // The options ranked (every set with the member's weapon, every weapon with its sets), all
    // known before any is searched: the count's total stays. A weapon's weighs more in the
    // progress (`WEAPON_OPTION`).
    const count = { done: 0, total: 0, weighed: 0, weight: 0 }
    const rankedDone = new Set<CharacterKey>()
    const reportRanking = () =>
      emit(
        {
          phase: 'ranking',
          round: rounds,
          step: rankedDone.size,
          steps: rankedMembers.length,
          characterKey: (
            rankedMembers.find((m) => !rankedDone.has(m.characterKey)) ??
            rankedMembers[rankedMembers.length - 1]
          ).characterKey,
          done: count.done,
          total: count.total,
        },
        rankBase +
          RANK_UNITS *
            rankedMembers.length *
            (count.weight ? count.weighed / count.weight : 0)
      )
    const optionDone = (weight: number) => {
      count.done++
      count.weighed += weight
      return reportRanking()
    }
    const plans = new Map<
      CharacterKey,
      {
        problem: Problem
        allSets: KqmSets[]
        weapons: KqmWeapon[]
        /** where `weapons`' comparison-only ones start */
        compareFrom: number
      }
    >()
    const chosen = await Promise.all(
      rankedMembers.map(({ characterKey: ck }) =>
        problemFor(ck, builds[ck]!.weapon, builds)
      )
    )
    for (const [i, { characterKey: ck }] of rankedMembers.entries()) {
      await tick()
      const best = builds[ck]!
      const problem = chosen[i]
      if (!problem) continue
      const allSets = setCombos(problem, spaces.get(ck)!, best)
      if (!allSets.some((sets) => kqmSetsId(sets) === kqmSetsId(best.sets)))
        allSets.push(best.sets)
      const own = weaponsFor(ck, builds)
      // (then each weapon at the other refinements ticked for its group: compared, never built)
      const compared = own.flatMap((w) =>
        kqmCompareRefinements(w.key, kqm).map((refinement) => ({
          key: w.key,
          refinement,
        }))
      )
      const weapons = [...own, ...compared]
      plans.set(ck, { problem, allSets, weapons, compareFrom: own.length })
      count.total += allSets.length + weapons.length
      count.weight += allSets.length + WEAPON_OPTION * weapons.length
    }
    await reportRanking()
    const rankMember = async (
      ck: CharacterKey
    ): Promise<KqmRanking | undefined> => {
      const best = builds[ck]!
      const plan = plans.get(ck)
      if (!plan) return undefined
      const { problem, allSets, weapons, compareFrom } = plan
      // An option misses its requirements when it misses one the chosen build meets: one nobody
      // meets (another member's that no build of this one reaches) marks none of them
      const chosen = scoreOf(problem, kqmValues(best))
      const chosenCons = problem.run(kqmValues(best)).cons
      const chosenMeets = problem.mins.map((min, j) => chosenCons[j] >= min)
      const meetsAsChosen = (score: Score) =>
        score.deficit <= chosen.deficit + DEFICIT_TOL
      const option = (
        r: {
          build: KqmBuild
          score: Score
          team?: Partial<Record<CharacterKey, KqmBuild>>
        },
        /** Its problem (with the teammates searched again for it, when it has some) */
        own: Problem | undefined
      ): KqmOption => {
        const cons = own?.run(kqmValues(r.build)).cons ?? []
        const shortfalls = (own?.mins ?? []).flatMap((min, j) =>
          cons[j] >= min || !chosenMeets[j]
            ? []
            : [{ path: own!.paths[j], value: cons[j], min }]
        )
        const unmet = !meetsAsChosen(r.score) || shortfalls.length > 0
        const team = r.team && Object.keys(r.team).length ? r.team : undefined
        return {
          ...r.build,
          total: r.score.total,
          unmet,
          ...(unmet && { shortfalls }),
          ...(team && { team }),
        }
      }
      // (a set's option is done when its search is)
      const setsSearched: Counter = {
        done: 0,
        total: 0,
        onDone: () => void optionDone(1),
      }
      const bySetsFound = searchArtifacts(ck, best.weapon, builds, {
        setsList: allSets,
        setsKept: allSets.length,
        counter: setsSearched,
      })
      bySetsFound.catch(() => undefined)
      const byWeaponFound: Promise<
        | {
            build: KqmBuild
            score: Score
            team?: Partial<Record<CharacterKey, KqmBuild>>
          }
        | undefined
      >[] = []
      for (const weapon of weapons) {
        await tick()
        const found = searchArtifacts(ck, weapon, builds, {
          setsList: [best.sets],
          setsKept: 1,
        }).then(async ([top]) => {
          if (!top) return top
          // (a weapon that changes a teammate's ER requirement: with that teammate's artifacts
          // searched again)
          const withTeam = await settleTeammates(ck, top.build, builds)
          return withTeam ? { ...top, ...withTeam } : top
        })
        found.catch(() => undefined)
        byWeaponFound.push(found)
      }
      // (an option with teammates searched again builds its own problem: one at a time, the
      // page drawn between them; a weapon's option is done once built)
      const optionsOf = async (
        found: readonly (Parameters<typeof option>[0] | undefined)[],
        weapons = false
      ) => {
        // (their problems asked for at once: built several at a time)
        const problems = found.map((top) =>
          top
            ? problemFor(ck, top.build.weapon, { ...builds, ...top.team })
            : undefined
        )
        for (const p of problems) p?.catch(() => undefined)
        const options: KqmOption[] = []
        for (const [i, top] of found.entries()) {
          if (top) {
            const own = await problems[i]
            await tick()
            const made = option(top, own)
            if (weapons && i >= compareFrom) made.compare = true
            options.push(made)
          }
          if (weapons) await optionDone(WEAPON_OPTION)
        }
        return options
      }
      const bySets = await optionsOf(await bySetsFound)
      // (sets with no search to wait for: done too)
      for (let n = setsSearched.done; n < allSets.length; n++) optionDone(1)
      const byWeapon = await optionsOf(await Promise.all(byWeaponFound), true)
      const order = (a: KqmOption, b: KqmOption) =>
        Number(a.unmet) - Number(b.unmet) || b.total - a.total
      const withCatchUp = async (options: KqmOption[]) => {
        options.sort(order)
        // (every option against the ranking's best: one measure that reads the same on every row)
        const best = options[0]
        for (let i = 1; i < options.length; i++) {
          await tick()
          const current = options[i]
          if (!best || current.unmet || best.unmet) continue
          const own = await problemFor(ck, current.weapon, {
            ...builds,
            ...current.team,
          })
          if (!own) continue
          current.behind = estimateKqmCatchUp(
            current,
            best.total,
            (values) => {
              const score = scoreOf(own, values)
              return { total: score.total, valid: meetsAsChosen(score) }
            },
            rollsOf(ck)
          )
        }
        return options
      }
      const ranking = {
        sets: await withCatchUp(bySets),
        weapons: await withCatchUp(byWeapon),
      }
      rankedDone.add(ck)
      await reportRanking()
      return ranking
    }
    const ranked = await Promise.all(
      rankedMembers.map((m) => rankMember(m.characterKey))
    )
    for (const [i, m] of rankedMembers.entries())
      if (ranked[i]) rankings[m.characterKey] = ranked[i]
  }

  /**
   * A ranked option better than its member's build (its member's search missed it: the sets it
   * screened left it out), the best such one over the team
   */
  const missedBest = async () => {
    let found:
      | {
          ck: CharacterKey
          build: KqmBuild
          gain: number
          team?: Partial<Record<CharacterKey, KqmBuild>>
        }
      | undefined
    for (const { characterKey: ck } of rankedMembers) {
      const own = builds[ck]!
      const problem = await problemFor(ck, own.weapon, builds)
      const ranking = rankings[ck]
      if (!problem || !ranking) continue
      const score = scoreOf(problem, kqmValues(own))
      const allowed = weaponsFor(ck, builds)
      for (const option of [...ranking.sets, ...ranking.weapons]) {
        // (unmet: it misses a requirement this build meets; compared only: not one to build)
        if (option.unmet || option.compare) continue
        if (!allowed.some((w) => w.key === option.weapon.key)) continue
        const gain = option.total / score.total - 1
        if (gain > 1e-9 && (!found || gain > found.gain)) {
          const { weapon, sets, mains, rolls, team } = option
          found = { ck, build: { weapon, sets, mains, rolls }, gain, team }
        }
      }
    }
    return found
  }

  /**
   * A weapon and sets that only win together (see `PAIR_WEAPONS`): each member's best few ranked
   * weapons with its best few ranked sets, the pairs not ranked yet, searched in the workers; the
   * best one over the team that beats its member's build
   */
  const missedPair = async () => {
    let found:
      | {
          ck: CharacterKey
          build: KqmBuild
          gain: number
          team?: Partial<Record<CharacterKey, KqmBuild>>
        }
      | undefined
    const searches: Promise<void>[] = []
    for (const { characterKey: ck } of rankedMembers) {
      const own = builds[ck]!
      const problem = await problemFor(ck, own.weapon, builds)
      const ranking = rankings[ck]
      if (!problem || !ranking) continue
      const score = scoreOf(problem, kqmValues(own))
      const allowed = weaponsFor(ck, builds)
      const weapons = [
        ...new Map(
          ranking.weapons
            .filter(
              (o) =>
                !o.unmet &&
                !o.compare &&
                allowed.some((w) => w.key === o.weapon.key)
            )
            .map((o) => [`${o.weapon.key}@${o.weapon.refinement}`, o.weapon])
        ).values(),
      ].slice(0, PAIR_WEAPONS)
      const setsList = [
        ...new Map(
          ranking.sets
            .filter((o) => !o.unmet)
            .map((o) => [kqmSetsId(o.sets), o.sets])
        ).values(),
      ].slice(0, PAIR_SETS)
      for (const weapon of weapons) {
        // (the build's weapon with any set, and any weapon with the build's sets: ranked already)
        if (weapon.key === own.weapon.key) continue
        const pairs = setsList.filter(
          (sets) => kqmSetsId(sets) !== kqmSetsId(own.sets)
        )
        if (!pairs.length) continue
        const search = searchArtifacts(ck, weapon, builds, {
          setsList: pairs,
          setsKept: pairs.length,
        }).then(async (results) => {
          for (const { build, score: found1 } of results) {
            // (with the teammates whose ER requirement its weapon changes searched again)
            const withTeam = await settleTeammates(ck, build, builds)
            const s = withTeam?.score ?? found1
            if (!better(s, score)) continue
            const gain = s.total / score.total - 1
            if (gain > 1e-9 && (!found || gain > found.gain))
              found = { ck, build, gain, team: withTeam?.team }
          }
        })
        search.catch(() => undefined)
        searches.push(search)
      }
    }
    await Promise.all(searches)
    return found
  }

  /**
   * A 4-piece set handed to a teammate: the teammate wears it (its weapon kept,
   * its artifacts searched with it), then the member who wore it searches its own sets again
   * (its weapon kept). A set whose effect the team shares and does not stack (Heart of the
   * Furnace's) is worth most on whoever keeps it up, but one member's step never moves it: taking
   * it alone doubles it, giving it up alone loses it. The best such pair over the team that beats
   * the team's builds.
   */
  const missedHandoff = async () => {
    let found:
      | {
          ck: CharacterKey
          build: KqmBuild
          gain: number
          team?: Partial<Record<CharacterKey, KqmBuild>>
        }
      | undefined
    const searches: Promise<void>[] = []
    for (const { characterKey: from } of optimized) {
      const own = builds[from]!
      const [[set, count] = []] = Object.entries(own.sets)
      if (count !== 4) continue
      const problem = await problemFor(from, own.weapon, builds)
      if (!problem) continue
      const score = scoreOf(problem, kqmValues(own))
      for (const { characterKey: to } of optimized) {
        if (to === from) continue
        const theirs = builds[to]!
        if (theirs.sets[set as ArtifactSetKey] === 4) continue
        if (!spaces.get(to)?.four.includes(set as ArtifactSetKey)) continue
        const search = searchArtifacts(to, theirs.weapon, builds, {
          setsList: [own.sets],
          setsKept: 1,
        }).then(async ([taken]) => {
          if (!taken) return
          const next = { ...builds, [to]: taken.build }
          const [top] = await searchArtifacts(from, own.weapon, next)
          if (!top || !better(top.score, score)) return
          const gain = top.score.total / score.total - 1
          if (gain > 1e-9 && (!found || gain > found.gain))
            found = {
              ck: from,
              build: top.build,
              gain,
              team: { [to]: taken.build },
            }
        })
        search.catch(() => undefined)
        searches.push(search)
      }
    }
    await Promise.all(searches)
    return found
  }

  /**
   * The whole team's score in `state`: every member's requirements (their deficits added up),
   * then the team's damage
   */
  const teamScore = async (
    state: Partial<Record<CharacterKey, KqmBuild>>
  ): Promise<Score | undefined> => {
    let total = 0
    let deficit = 0
    for (const { characterKey: j } of optimized) {
      const build = state[j]
      const problem = build && (await problemFor(j, build.weapon, state))
      if (!build || !problem) return undefined
      const s = scoreOf(problem, kqmValues(build))
      deficit += s.deficit
      total = Math.max(total, s.total)
    }
    return { total, deficit }
  }

  /**
   * A Favonius handed to a teammate: the teammate takes its own Favonius, the member who held one
   * takes one of its best other weapons, and everyone's artifacts are searched again for the
   * Energy Recharge that moves. The particles of a Favonius lower every teammate's requirement,
   * so one member's step keeps it where it is even when it belongs on a support: a carry holding
   * it alone meets the team's requirements, giving it up alone misses them. The best such move
   * over the team that beats the team's builds (requirements first, then damage).
   */
  const missedFavonius = async () => {
    const current = await teamScore(builds)
    if (!current) return undefined
    let found:
      | {
          ck: CharacterKey
          build: KqmBuild
          gain: number
          team?: Partial<Record<CharacterKey, KqmBuild>>
        }
      | undefined
    for (const { characterKey: from } of optimized) {
      const own = builds[from]!
      if (!isFavonius(own.weapon.key)) continue
      const allowed = weaponsFor(from, builds)
      const others = [
        ...new Map(
          [...(rankings[from]?.weapons ?? [])]
            .sort((a, b) => b.total - a.total)
            .filter(
              (o) =>
                !o.compare &&
                !isFavonius(o.weapon.key) &&
                allowed.some((w) => w.key === o.weapon.key)
            )
            .map((o) => [`${o.weapon.key}@${o.weapon.refinement}`, o.weapon])
        ).values(),
      ].slice(0, HANDOFF_WEAPONS)
      if (!others.length) continue
      for (const { characterKey: to } of optimized) {
        if (to === from || isFavonius(builds[to]!.weapon.key)) continue
        const favonius = weaponsFor(to, builds).find((w) => isFavonius(w.key))
        if (!favonius) continue
        const [given] = await searchArtifacts(to, favonius, builds)
        if (!given) continue
        for (const weapon of others) {
          const next = { ...builds, [to]: given.build }
          const [mine] = await searchArtifacts(from, weapon, next)
          if (!mine) continue
          next[from] = mine.build
          // (the others' artifacts for the Energy Recharge the move frees or takes away)
          const team: Partial<Record<CharacterKey, KqmBuild>> = {}
          for (const { characterKey: j } of optimized) {
            if (j === from) continue
            const theirs = next[j]!
            const problem = await problemFor(j, theirs.weapon, next)
            if (!problem) continue
            const [top] = await searchArtifacts(j, theirs.weapon, next, {
              setsList: [theirs.sets],
              setsKept: 1,
            })
            if (top && better(top.score, scoreOf(problem, kqmValues(theirs))))
              next[j] = top.build
            team[j] = next[j]!
          }
          const score = await teamScore(next)
          if (!score || !better(score, current)) continue
          const gain =
            current.deficit - score.deficit + score.total / current.total - 1
          if (!found || gain > found.gain)
            found = { ck: from, build: mine.build, gain, team }
        }
      }
    }
    return found
  }

  /**
   * Before the rounds: each member's artifacts for its starting weapon, so that the first round's
   * weapons are tried against the others' fitting artifacts, not their starting ones (one problem
   * per member; it saves a round of all the weapons' problems). Members in `order`, from `from`:
   * the team's builds after, and the team's score with them (the last member's search).
   */
  const warmUp = async (
    from: Partial<Record<CharacterKey, KqmBuild>>,
    order: CharacterKey[],
    pass: number
  ) => {
    const state = { ...from }
    let score: Score | undefined
    for (const [i, ck] of order.entries()) {
      await emit(
        {
          phase: 'search',
          round: 1,
          step: i + 1,
          steps,
          characterKey: ck,
          stage: 'artifacts',
        },
        (0.25 * (pass * steps + i)) / (2 * steps)
      )
      const start = state[ck]!
      const problem = await problemFor(ck, start.weapon, state)
      if (!problem) continue
      score = scoreOf(problem, kqmValues(start))
      const [top] = await searchArtifacts(ck, start.weapon, state)
      if (top && better(top.score, score)) {
        state[ck] = top.build
        score = top.score
      }
    }
    return { state, score }
  }

  /**
   * The rotation played for `state` (with its weapons and sets when `withGear`): when it plays
   * differently from before, the run counts it from now on (its time, the ER calculator's targets
   * and the rule effects follow) and true is returned
   */
  const replayFor = (
    state: Partial<Record<CharacterKey, KqmBuild>>,
    withGear: boolean
  ) => {
    if (!replay) return false
    const { arts, weapons } = gearOf(state)
    const next = replay({
      constellations,
      // (every member's allowed sets and weapons as candidates: the effects that only open their
      // own buff windows are played for each of them, so the search judges every option with
      // its effects in the rotation, not only the ones already worn)
      gear: Object.fromEntries(
        optimized.map(({ characterKey: ck }) => [
          ck,
          {
            ...(withGear && state[ck] ? kqmSimGear(state[ck]!) : {}),
            candidates: candidatesOf(ck),
          },
        ])
      ),
      overrides: {
        arts,
        weapons,
        characters,
        extraConditionals,
        conditionalOverrides,
        bonusStats,
        ...kqmOwnSettings(kqm),
      },
    })
    if (!next) return false
    const playedId = (p: KqmPlayed) =>
      JSON.stringify([p.attacks, p.rotationTime])
    const changed = !played || playedId(next) !== playedId(played)
    played = next
    if (!changed) return false
    calculator = calculatorFor(rotationTimeNow())
    ;({ ctx: ctxConditionals, extra: extraConditionals } = ruleConditionals())
    // (problems and searches were for the attacks before: a comparison takes its run's for
    // these, if any)
    work = workFor(workKey(played))
    setSearches.clear()
    return true
  }

  /** The team with its builds now: its figures, ER and what was assumed (with `rankings`) */
  const finish = (): KqmResult | undefined => {
    const { arts, weapons } = gearOf(builds)
    const finalSettings = {
      arts,
      attacks: attacksNow(),
      statFilters: filtersFor(builds),
      weapons,
      extraConditionals,
      conditionalOverrides,
      ...kqmOwnSettings(kqm),
      characters,
      onField: teamOpt.onField,
      bonusStats,
    }
    // (the team's formulas built once: its figures and its ER from them)
    const finalNodes = teamRotationNodes(
      database,
      teamId,
      gender,
      finalSettings
    )
    if (!finalNodes) return undefined
    const after = evaluateTeamNodes(
      database,
      teamId,
      finalSettings.attacks,
      finalNodes
    )
    const energyRecharge: KqmResult['energyRecharge'] = {}
    for (const { characterKey, path, value, min } of finalNodes.constraints ??
      [])
      if (path.at(-1) === 'enerRech_')
        energyRecharge[characterKey] = {
          target: calculator
            ? min * 100
            : kqmEnergyRequirement(kqm, characterKey),
          minimum: min * 100,
          value: constValue(value) * 100,
        }

    // what was counted by rule for each member's own weapon and sets (not set by the user)
    const assumed: KqmResult['assumed'] = {}
    for (const m of optimized) {
      const ck = m.characterKey
      const b = builds[ck]!
      const items = new Set<string>([b.weapon.key, ...Object.keys(b.sets)])
      assumed[ck] = (ctxConditionals[ck]?.picked ?? []).filter(
        ({ path }) =>
          items.has(path[0]) &&
          kqm.passives?.[ck]?.[path[0]]?.[path[path.length - 1]] === undefined
      )
    }

    return {
      builds: { ...builds },
      constellations,
      energyRecharge,
      after,
      rankings,
      assumed,
      optimized: optimized.map((m) => m.characterKey),
      rounds,
      played,
      ...(narrowed ? { screenedOut } : rootOut ? { screenedOut: rootOut } : {}),
    }
  }

  let preview: KqmResult | undefined
  try {
    // the rotation at the KQM constellations, with no weapon or set effects yet (its builds are
    // not found yet)
    if (!comparison) replayFor(builds, false)
    // The first builds, warmed up in the team's order and in reverse (the last ones choose with
    // the first ones' sets on: a team-wide set goes to whoever chooses first), the better kept:
    // which way the rounds settle depends on it, and only the KQM settings decide it
    if (!comparison && !from && maxRounds > 0) {
      const order = optimized.map((m) => m.characterKey)
      const forward = await warmUp(builds, order, 0)
      const reverse =
        order.length > 1
          ? await warmUp(builds, [...order].reverse(), 1)
          : undefined
      const start =
        reverse?.score &&
        (!forward.score || better(reverse.score, forward.score))
          ? reverse
          : forward
      Object.assign(builds, start.state)
    }
    await descend(1, maxRounds)
    // Played again with the builds found (their weapons' and sets' effects in it): while that
    // changes what it plays, the builds are searched again from where they are
    for (
      let r = 0;
      !comparison && maxRounds > 0 && r < REPLAYS && replayFor(builds, true);
      r++
    ) {
      for (const ck of Object.keys(settled) as CharacterKey[])
        delete settled[ck]
      plannedRounds = rounds + 1
      await descend(rounds + 1, rounds + maxRounds)
    }
    if (comparison) {
      const { characterKey, weapon, sets } = comparison
      const space = spaces.get(characterKey)
      if (!space || !builds[characterKey])
        throw new Error('This member has no KQM build to compare.')
      if (
        !space.weapons.some(
          (w) => w.key === weapon.key && w.refinement === weapon.refinement
        )
      )
        throw new Error('This weapon is not allowed by the run settings.')
      const counts = Object.entries(sets)
      if (
        counts.length > 2 ||
        counts.some(([key, n]) =>
          n === 4
            ? counts.length !== 1 || !space.four.includes(key as ArtifactSetKey)
            : n !== 2 || !space.two.includes(key as ArtifactSetKey)
        )
      )
        throw new Error('This artifact set is not allowed by the run settings.')
      // the rotation played again with the picked weapon and sets on (their effects, and what
      // they change for the team: a set's debuff, a weapon's buff for the next member)
      replayFor(
        {
          ...builds,
          [characterKey]: { ...builds[characterKey]!, weapon, sets },
        },
        true
      )
      const [selected] = await searchArtifacts(characterKey, weapon, builds, {
        setsList: [sets],
        setsKept: 1,
      })
      if (!selected)
        throw new Error('Could not evaluate this equipment combination.')
      // the teammates whose ER requirement the picked weapon changes: their artifacts searched
      // again (the ER it frees, or what it no longer gives)
      const teammates = await settleTeammates(
        characterKey,
        selected.build,
        builds
      )
      builds[characterKey] = selected.build
      Object.assign(builds, teammates?.team)
      // the team's figures with the pick first, its rankings after
      preview = finish()
      if (preview && comparison.onPreview) {
        const shown = { ...preview, rankings: {} }
        rootOf.set(shown, root!)
        comparison.onPreview(shown)
      }
    }
    // (from another run's builds: its rounds only)
    for (let pass = 0; !from; pass++) {
      await rankAll()
      if (comparison || pass >= ADOPT_PASSES) break
      // (the builds so far, with these rankings, while a better one is looked for: later
      // rankings replace these, not change them)
      if (onEarly) {
        const early = finish()
        if (early) onEarly({ ...early, rankings: { ...rankings } })
      }
      const missed =
        (await missedFavonius()) ??
        (await missedBest()) ??
        (await missedPair()) ??
        (await missedHandoff())
      if (!missed) break
      // taken, and the rounds go on from there (the others' best builds may change with it)
      builds[missed.ck] = missed.build
      lastChange[missed.ck] = ++changes
      delete settled[missed.ck]
      for (const [j, build] of Object.entries(missed.team ?? {}) as [
        CharacterKey,
        KqmBuild,
      ][]) {
        builds[j] = build
        lastChange[j] = ++changes
        delete settled[j]
      }
      plannedRounds = rounds + ADOPT_ROUNDS
      ceiling = ceilingOf(pass + 1)
      improving = true
      await descend(rounds + 1, rounds + ADOPT_ROUNDS)
    }
  } catch (e) {
    throw cancelled(e)
  } finally {
    // (a comparison's workers are kept a while: the next pick needs them again)
    releaseKqmWorkers(comparison ? COMPARE_WORKERS_KEPT_MS : 0)
    // (the builders a while longer: a pick in the inspector builds with them)
    releaseKqmBuilders(COMPARE_WORKERS_KEPT_MS)
  }

  // (a comparison's builds do not change after its preview: only its rankings are added)
  const out = preview ? { ...preview, rankings } : finish()
  if (!out) return undefined
  rootOf.set(out, root ?? out)
  // (the run's work, for its comparisons)
  if (!comparison)
    lastWork = { root: out, byPlayed: new Map([[workKey(played), work]]) }
  return out
}
