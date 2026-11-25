import type {
  ArtifactSetKey,
  CharacterKey,
  GenderKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamOpt,
  TeamOptEnergyCalculator,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { nextPaint } from '@genshin-optimizer/gi/solver'
import { getWeaponStat } from '@genshin-optimizer/gi/stats'
import type {
  BonusStats,
  FrameData,
  KqmBuild,
  KqmResult,
  KqmStep,
  KqmWeapon,
  RotationMember,
  RotationScenario,
  RotationTimingSettings,
  RunAttackState,
  TeamOptMember,
  TeamOptResult,
  TeamOptStep,
} from '@genshin-optimizer/gi/ui'
import {
  calculateEnergyRecharge,
  isCalcEnergyWeapon,
  isFavonius,
  kqmMemberConstellation,
  optimizeTeam,
  optimizeTeamKqm,
  simTeamOf,
  simulateWritten,
  syncEnergyCalculator,
  teamCalculatorTargets,
  teamOptCurrentWeapons,
  teamOptMembers,
  teamOptRunGear,
  teamOptUIData,
  withRotationEnergy,
  withScenarioBurstEvery,
  writtenTeamReplay,
} from '@genshin-optimizer/gi/ui'
import { uiInput } from '@genshin-optimizer/gi/wr'
import type { i18n } from 'i18next'
import { kqmEnergyEstimate } from './KqmEnergyCalculator'
import { kqmRotationEnergyOf, teamCalculator } from './kqmEnergy'
import type { RotationSearchBase } from './RotationSearch'
import { applyWritten } from './RotationWriter'
import { kqmResultDps } from './rotationConfirm'
import { kqmReplayOf } from './useKqmRun'
import type { TeamOptUpdate } from './useTeamOpt'
import { initStatus, teamOptSolver } from './useTeamOptRun'

/** Fast pre-run preview of one scenario (rotation time + calculated ER needs, no build solve). */
export interface ScenarioPreview {
  scenarioId: string
  rotationTime?: number
  erTargets: Partial<Record<CharacterKey, number>>
  stalls: { label: string; seconds: number }[]
  warnings: string[]
  error?: string
}

/** Comparison optimization mode: fast refits from base builds, full searches every weapon/set anew. */
export type ScenarioCompareMode = 'fast' | 'full'

/** Live sub-step progress reported while optimizing a single scenario. */
export interface ScenarioLiveStep {
  /** Estimated progress within the current scenario (0 to 1) */
  fraction: number
  /** Concise human-readable status (e.g. "Round 1/4 · Zibai · weapon 2/3 · 64%") */
  detail: string
}

/** Full optimized result for one scenario, on either Team optimize or KQM Theorycrafting. */
export interface ScenarioRunResult {
  scenario: RotationScenario
  dps: number
  total: number
  rotationTime: number
  memberDps: Partial<Record<CharacterKey, number>>
  erTargets: Partial<Record<CharacterKey, number>>
  erAchieved: Partial<Record<CharacterKey, number>>
  weapons: Partial<Record<CharacterKey, { key: WeaponKey; refinement: number }>>
  sets: Partial<Record<CharacterKey, Partial<Record<ArtifactSetKey, number>>>>
  unmetCount: number
  stalls: { label: string; seconds: number }[]
  warnings: string[]
  /** Seconds spent optimizing this scenario */
  elapsedSeconds?: number
  /** True when reused directly from the current tab's already-optimized baseline run */
  reused?: boolean
  /** Winning Team optimize builds/weapons to warm-start subsequent scenarios */
  teamSeed?: Pick<TeamOptResult, 'builds' | 'weapons'>
  /** Winning KQM builds to warm-start subsequent scenarios (skips redundant warm-up passes) */
  kqmSeed?: Partial<Record<CharacterKey, KqmBuild>>
  error?: string
}

export interface ScenarioRunContext {
  tab: 'team' | 'kqm'
  database: ArtCharDatabase
  gender: GenderKey
  i18n: i18n
  teamId: string
  names: RotationMember[]
  teamOpt: TeamOpt
  /** Existing optimization result from the active tab (reused for baseline & warm-starting) */
  base?: RotationSearchBase
  /** True when settings/rotation changed since `base` was computed (still warm-starts, does not skip baseline solve) */
  baseStale?: boolean
  /** Baseline burst cadences per member (used to identify unchanged teammates for safe KQM pruning) */
  baselineBurstEvery?: Partial<Record<CharacterKey, number>>
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  attackStates?: readonly RunAttackState[]
  rankingBonusStats?: Partial<Record<CharacterKey, BonusStats>>
  maxWorkers: number
}

const nameOf = (names: readonly RotationMember[], ck: CharacterKey) =>
  names.find((n) => n.characterKey === ck)?.name ?? ck

/** Build a Team optimize `TeamOpt` with a scenario's burst cadence & ER calculator applied (single simulation). */
function teamScenarioSettings(
  ctx: ScenarioRunContext,
  scenario: RotationScenario,
  members: TeamOptMember[],
  baseCalc?: TeamOptEnergyCalculator
): {
  runTeamOpt: TeamOpt
  stalls: { label: string; seconds: number }[]
  warnings: string[]
} {
  const { database, gender, teamId, names, teamOpt, saved } = ctx
  const keys = members.map((m) => m.characterKey)
  const own = simTeamOf(members, database)
  const warnings: string[] = []

  // Seed calculator with the scenario's burstEvery so writtenTeamReplay uses everyNthBursts
  const seedCalc = withScenarioBurstEvery(
    syncEnergyCalculator(
      keys,
      baseCalc ?? teamOpt.energyCalculator,
      teamOpt.rotationTime ?? 20,
      teamOpt.onField ?? keys[0],
      own.constellations
    ),
    scenario.burstEvery,
    true
  )
  const seedTeamOpt: TeamOpt = {
    ...teamOpt,
    energySource: 'calculator',
    energyCalculator: seedCalc,
  }

  // writtenTeamReplay returns both attacks and energy in one simulation pass
  const played = writtenTeamReplay({
    database,
    teamId,
    members,
    gender,
    names,
    teamOpt: seedTeamOpt,
    text: scenario.text,
    ...saved,
    warnings,
  })?.({
    gear: teamOptRunGear(database, teamId, seedTeamOpt, own.gear),
    overrides: {},
  })

  if (!played?.rotationTime)
    throw new Error('Could not play this rotation scenario.')

  const synced = syncEnergyCalculator(
    keys,
    baseCalc ?? teamOpt.energyCalculator,
    played.rotationTime,
    teamOpt.onField ?? keys[0],
    own.constellations
  )
  const filled = withRotationEnergy(synced, keys, played.energy)
  const energyCalculator: TeamOptEnergyCalculator = {
    ...withScenarioBurstEvery(filled, scenario.burstEvery, true),
    rotationTime: played.rotationTime,
  }

  return {
    runTeamOpt: {
      ...teamOpt,
      attacks: played.attacks,
      rotationTime: played.rotationTime,
      // Only the best build per scenario is needed (skip topN alternative searches)
      topN: undefined,
      energySource: 'calculator',
      energyCalculator,
    },
    stalls: played.stalls ?? [],
    warnings: [...new Set(warnings)],
  }
}

/** Build a KQM `TeamOpt` with a scenario's burst cadence & ER calculator applied. */
function kqmScenarioSettings(
  ctx: ScenarioRunContext,
  scenario: RotationScenario,
  members: TeamOptMember[]
): {
  runTeamOpt: TeamOpt
  rotationTime?: number
} {
  const { database, gender, i18n, teamId, teamOpt } = ctx
  const keys = members.map((m) => m.characterKey)
  const baseKqm = teamOpt.kqm ?? defaultTeamOptKqm

  const seedCalc = withScenarioBurstEvery(
    syncEnergyCalculator(
      keys,
      baseKqm.energyCalculator,
      teamOpt.rotationTime ?? 20,
      teamOpt.onField ?? keys[0],
      Object.fromEntries(
        keys.map((k) => [k, kqmMemberConstellation(k, baseKqm)])
      )
    ),
    scenario.burstEvery,
    true
  )
  const seedTeamOpt: TeamOpt = {
    ...teamOpt,
    kqm: {
      ...baseKqm,
      energySource: 'calculator',
      energyCalculator: seedCalc,
    },
  }

  const { energy, rotationTime } = kqmRotationEnergyOf(
    database,
    gender,
    i18n,
    teamId,
    seedTeamOpt,
    members,
    scenario.text
  )

  const calc = teamCalculator(
    members,
    seedTeamOpt,
    baseKqm.energyCalculator,
    energy
  )
  const energyCalculator: TeamOptEnergyCalculator = {
    ...withScenarioBurstEvery(calc, scenario.burstEvery, true),
    rotationTime:
      rotationTime ??
      baseKqm.energyCalculator?.rotationTime ??
      teamOpt.rotationTime ??
      20,
  }

  return {
    runTeamOpt: {
      ...teamOpt,
      kqm: {
        ...baseKqm,
        energySource: 'calculator',
        energyCalculator,
      },
    },
    rotationTime,
  }
}

/**
 * Fast pre-run preview of a scenario: rotation length & auto-calculated ER targets per member.
 */
export function previewRotationScenario(
  ctx: ScenarioRunContext,
  scenario: RotationScenario
): ScenarioPreview {
  const members = teamOptMembers(ctx.database, ctx.teamId)
  const keys = members.map((m) => m.characterKey)
  try {
    if (ctx.tab === 'team') {
      const { runTeamOpt, stalls, warnings } = teamScenarioSettings(
        ctx,
        scenario,
        members
      )
      const weapons = teamOptCurrentWeapons(ctx.database, members)
      const erTargets = teamCalculatorTargets(keys, weapons, runTeamOpt) ?? {}
      return {
        scenarioId: scenario.id,
        rotationTime: runTeamOpt.rotationTime,
        erTargets,
        stalls,
        warnings,
      }
    }
    const { runTeamOpt, rotationTime } = kqmScenarioSettings(
      ctx,
      scenario,
      members
    )
    const calc = runTeamOpt.kqm?.energyCalculator
    const erTargets = calc
      ? kqmEnergyEstimate(keys, calc, runTeamOpt.kqm).targets
      : {}
    return {
      scenarioId: scenario.id,
      rotationTime,
      erTargets,
      stalls: [],
      warnings: [],
    }
  } catch (e) {
    return {
      scenarioId: scenario.id,
      erTargets: {},
      stalls: [],
      warnings: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Format a live `TeamOptStep` + solver counters into progress fraction & concise text. */
function teamLiveStep(
  names: readonly RotationMember[],
  step: TeamOptStep | undefined,
  done: number,
  total: number,
  upper?: number
): ScenarioLiveStep {
  if (!step) return { fraction: 0.04, detail: 'Preparing builds…' }
  const who = nameOf(names, step.characterKey)
  const denom =
    Number.isFinite(total) && total > 0
      ? total
      : upper && Number.isFinite(upper) && upper > 0
        ? upper
        : 0
  const solvePct = denom > 0 ? Math.min(1, Math.max(0, done / denom)) : 0

  if (step.exchange) {
    return {
      fraction: 0.88 + 0.08 * solvePct,
      detail: `Trading pieces · ${who}`,
    }
  }

  const rounds = Math.max(1, step.maxRounds)
  const steps = Math.max(1, step.steps)
  const weaponFrac =
    step.weapons && step.weapons > 1 && step.weapon
      ? (step.weapon - 1 + solvePct) / step.weapons
      : solvePct
  const roundFrac = (step.step - 1 + weaponFrac) / steps
  // Most runs converge by round 2–3, so weight early rounds higher for smoother perceived progress
  const fraction = Math.min(
    0.88,
    0.05 + ((step.round - 1 + roundFrac) / Math.min(rounds, 3)) * 0.83
  )

  const parts = [`Round ${step.round}`, who]
  if (step.energyFor) parts.push(`ER check ${nameOf(names, step.energyFor)}`)
  else if (step.weapons && step.weapons > 1 && step.weapon)
    parts.push(`weapon ${step.weapon}/${step.weapons}`)
  if (denom > 0) parts.push(`${Math.round(solvePct * 100)}%`)

  return { fraction, detail: parts.join(' · ') }
}

/** Format a live `KqmStep` into progress fraction & concise text. */
function kqmLiveStep(
  names: readonly RotationMember[],
  step: KqmStep
): ScenarioLiveStep {
  const who = nameOf(names, step.characterKey)
  const fraction = Math.min(0.97, Math.max(0.04, step.progress ?? 0.04))
  const counts =
    step.total && step.total > 0
      ? ` ${Math.min(step.done ?? 0, step.total)}/${step.total}`
      : ''
  const stage =
    step.stage === 'artifacts'
      ? `artifacts${counts}`
      : step.stage === 'weapons'
        ? `weapons${counts}`
        : undefined
  return {
    fraction,
    detail: stage
      ? `Round ${step.round} · ${who} (${stage})`
      : `Round ${step.round} · ${who}`,
  }
}

/** Extract set piece counts for a Team optimize result's equipped artifacts. */
function teamResultSets(
  database: ArtCharDatabase,
  members: TeamOptMember[],
  result: TeamOptResult
): Partial<Record<CharacterKey, Partial<Record<ArtifactSetKey, number>>>> {
  const out: Partial<
    Record<CharacterKey, Partial<Record<ArtifactSetKey, number>>>
  > = {}
  for (const m of members) {
    const counts: Partial<Record<ArtifactSetKey, number>> = {}
    if (m.isTc) {
      const tc = database.buildTcs.get(m.loadoutDatum.buildTcId)?.artifact.sets
      for (const [k, n] of Object.entries(tc ?? {}))
        if (n) counts[k as ArtifactSetKey] = n
    } else {
      const ids = result.builds[m.characterKey] ?? m.artifactIds
      for (const id of Object.values(ids)) {
        const setKey = id ? database.arts.get(id)?.setKey : undefined
        if (setKey) counts[setKey] = (counts[setKey] ?? 0) + 1
      }
    }
    out[m.characterKey] = counts
  }
  return out
}

/** Convert a finished `TeamOptResult` into a `ScenarioRunResult`. */
function toTeamScenarioResult(
  ctx: ScenarioRunContext,
  scenario: RotationScenario,
  members: TeamOptMember[],
  runTeamOpt: TeamOpt,
  result: TeamOptResult,
  stalls: { label: string; seconds: number }[],
  warnings: string[],
  elapsedSeconds: number,
  reused?: boolean
): ScenarioRunResult {
  const keys = members.map((m) => m.characterKey)
  const rotationTime = runTeamOpt.rotationTime ?? 20
  const total = result.after.total
  const dps = rotationTime > 0 ? total / rotationTime : 0
  const memberDps: Partial<Record<CharacterKey, number>> = {}
  for (const k of keys)
    memberDps[k] =
      rotationTime > 0 ? (result.after.members[k] ?? 0) / rotationTime : 0

  const winningWeapons = Object.fromEntries(
    members.flatMap((m) => {
      const wId = result.weapons[m.characterKey] ?? m.weaponId
      const w = wId ? ctx.database.weapons.get(wId) : undefined
      return w ? [[m.characterKey, w]] : []
    })
  )
  const erTargets =
    teamCalculatorTargets(keys, winningWeapons, runTeamOpt) ?? {}
  const uiData = teamOptUIData(
    ctx.database,
    ctx.teamId,
    ctx.gender,
    runTeamOpt,
    result
  )
  const erAchieved: Partial<Record<CharacterKey, number>> = {}
  for (const k of keys) {
    const val = uiData?.[k]?.get(uiInput.total.enerRech_).value
    if (typeof val === 'number') erAchieved[k] = Math.round(val * 100)
  }

  const weapons: ScenarioRunResult['weapons'] = {}
  for (const m of members) {
    const wId = result.weapons[m.characterKey] ?? m.weaponId
    const w = wId ? ctx.database.weapons.get(wId) : undefined
    if (w) weapons[m.characterKey] = { key: w.key, refinement: w.refinement }
  }

  const unmetCount = Object.values(result.after.unmet).reduce(
    (n, list) => n + (list?.length ?? 0),
    0
  )

  return {
    scenario,
    dps,
    total,
    rotationTime,
    memberDps,
    erTargets,
    erAchieved,
    weapons,
    sets: teamResultSets(ctx.database, members, result),
    unmetCount,
    stalls,
    warnings,
    elapsedSeconds,
    reused,
    teamSeed: { builds: result.builds, weapons: result.weapons },
  }
}

/** Convert a finished `KqmResult` into a `ScenarioRunResult`. */
function toKqmScenarioResult(
  scenario: RotationScenario,
  keys: CharacterKey[],
  runTeamOpt: TeamOpt,
  kqmResult: KqmResult,
  warnings: string[],
  elapsedSeconds: number,
  reused?: boolean
): ScenarioRunResult {
  const rotationTime =
    kqmResult.played?.rotationTime ??
    runTeamOpt.kqm?.energyCalculator?.rotationTime ??
    runTeamOpt.rotationTime ??
    20
  const total = kqmResult.after.total
  const dps =
    kqmResultDps(kqmResult) || (rotationTime > 0 ? total / rotationTime : 0)
  const memberDps: Partial<Record<CharacterKey, number>> = {}
  const erTargets: Partial<Record<CharacterKey, number>> = {}
  const erAchieved: Partial<Record<CharacterKey, number>> = {}
  const weapons: ScenarioRunResult['weapons'] = {}
  const sets: ScenarioRunResult['sets'] = {}

  for (const k of keys) {
    memberDps[k] =
      rotationTime > 0 ? (kqmResult.after.members[k] ?? 0) / rotationTime : 0
    const er = kqmResult.energyRecharge[k]
    if (er?.target !== undefined) erTargets[k] = Math.round(er.target)
    if (er?.value !== undefined) erAchieved[k] = Math.round(er.value)
    const build = kqmResult.builds[k]
    if (build) {
      weapons[k] = {
        key: build.weapon.key,
        refinement: build.weapon.refinement,
      }
      const s: Partial<Record<ArtifactSetKey, number>> = {}
      for (const [sk, n] of Object.entries(build.sets))
        if (n) s[sk as ArtifactSetKey] = n
      sets[k] = s
    }
  }

  const unmetCount = Object.values(kqmResult.after.unmet).reduce(
    (n, list) => n + (list?.length ?? 0),
    0
  )

  return {
    scenario,
    dps,
    total,
    rotationTime,
    memberDps,
    erTargets,
    erAchieved,
    weapons,
    sets,
    unmetCount,
    stalls: kqmResult.played?.stalls ?? [],
    warnings,
    elapsedSeconds,
    reused,
    kqmSeed: kqmResult.builds,
  }
}

/**
 * Reuse the active tab's already-computed optimization result for the baseline scenario
 * whenever it is fresh (0 ms, exact match with the main page).
 */
export function baselineScenarioResult(
  ctx: ScenarioRunContext,
  scenario: RotationScenario
): ScenarioRunResult | undefined {
  if (!scenario.isBaseline || ctx.baseStale || ctx.base?.tab !== ctx.tab)
    return undefined
  const members = teamOptMembers(ctx.database, ctx.teamId)
  const keys = members.map((m) => m.characterKey)
  if (ctx.base.tab === 'team') {
    return toTeamScenarioResult(
      ctx,
      scenario,
      members,
      ctx.base.teamOpt,
      ctx.base.result,
      [],
      [],
      0,
      true
    )
  }
  return toKqmScenarioResult(
    scenario,
    keys,
    ctx.base.teamOpt,
    ctx.base.result,
    [],
    0,
    true
  )
}

/**
 * Build a balanced fast per-member search plan for Team Optimize from the base run's builds, ER
 * achieved, and ranked weapon options:
 * - Unchanged teammates whose build already meets the new ER, doesn't free >=4% ER, and isn't
 *   involved in a Favonius/energy handoff are kept untouched (`keep`).
 * - Unchanged-cadence teammates with a small ER change (<=12%) keep their weapon (plus Favonius/
 *   energy weapons if a teammate's ER jumped) and refit artifacts.
 * - Changed-cadence, big-ER-swing (>12%), or Favonius-holding teammates when team ER shifted
 *   shortlist base + top 4 feasible + top 4 highest-value + all energy/ER-substat weapons.
 * - Allows 2 rounds (stops after 1 if settled) and 1 pairwise artifact-exchange pass.
 */
function fastTeamPlan(
  ctx: ScenarioRunContext,
  scenario: RotationScenario,
  members: TeamOptMember[],
  runTeamOpt: TeamOpt
): {
  keep: CharacterKey[]
  weaponFilter: Partial<Record<CharacterKey, ReadonlySet<string>>>
  maxRounds: number
  maxExchanges: number
} {
  const base = ctx.base?.tab === 'team' ? ctx.base : undefined
  if (!base)
    return {
      keep: [...runTeamOpt.keep],
      weaponFilter: {},
      maxRounds: 2,
      maxExchanges: 1,
    }

  const keys = members.map((m) => m.characterKey)
  const baseWeapons = Object.fromEntries(
    members.flatMap((m) => {
      const wId = base.result.weapons[m.characterKey] ?? m.weaponId
      const w = wId ? ctx.database.weapons.get(wId) : undefined
      return w ? [[m.characterKey, w]] : []
    })
  )
  const baseTargets =
    teamCalculatorTargets(keys, baseWeapons, base.teamOpt) ?? {}
  const nextTargets = teamCalculatorTargets(keys, baseWeapons, runTeamOpt) ?? {}
  const baseUi = teamOptUIData(
    ctx.database,
    ctx.teamId,
    ctx.gender,
    base.teamOpt,
    base.result
  )
  const baseAchieved: Partial<Record<CharacterKey, number>> = {}
  for (const k of keys) {
    const val = baseUi?.[k]?.get(uiInput.total.enerRech_).value
    if (typeof val === 'number') baseAchieved[k] = val * 100
  }

  let teamErRose = false
  let teamErDropped = false
  for (const k of keys) {
    const b = baseTargets[k]
    const n = nextTargets[k]
    if (b === undefined || n === undefined) continue
    if (n - b >= 10) teamErRose = true
    if (b - n >= 10) teamErDropped = true
  }
  const teamErShifted = teamErRose || teamErDropped

  const isEnergyWeaponId = (wId: string) => {
    const w = ctx.database.weapons.get(wId)
    return !!w && (isFavonius(w.key) || isCalcEnergyWeapon(w.key))
  }
  const isErWeaponId = (wId: string) => {
    const w = ctx.database.weapons.get(wId)
    return (
      !!w &&
      (isFavonius(w.key) ||
        isCalcEnergyWeapon(w.key) ||
        getWeaponStat(w.key)?.subStat?.type === 'enerRech_')
    )
  }

  const keep = new Set<CharacterKey>(runTeamOpt.keep)
  const weaponFilter: Partial<Record<CharacterKey, ReadonlySet<string>>> = {}
  let activeCount = 0

  for (const m of members) {
    if (m.isTc || keep.has(m.characterKey)) continue
    const k = m.characterKey
    const cadenceChanged =
      scenario.kind !== 'cadence' ||
      scenario.burstEvery[k] !== ctx.baselineBurstEvery?.[k]
    const baseEr = baseTargets[k]
    const nextEr = nextTargets[k]
    const gotEr = baseAchieved[k]
    const erDelta =
      baseEr !== undefined && nextEr !== undefined ? nextEr - baseEr : undefined
    const meetsNew =
      nextEr === undefined || (gotEr !== undefined && gotEr + 1 >= nextEr)
    const freedEr =
      baseEr !== undefined && nextEr !== undefined ? baseEr - nextEr : 0
    const baseWeaponId = base.result.weapons[k] ?? m.weaponId
    const holdsTeamEnergy = !!baseWeaponId && isEnergyWeaponId(baseWeaponId)

    // Tier 1: untouched teammate whose build already meets the new ER, didn't free a roll,
    // and isn't needed for a Favonius/energy handoff
    if (
      !cadenceChanged &&
      meetsNew &&
      freedEr < 4 &&
      !(holdsTeamEnergy && teamErShifted) &&
      !teamErRose
    ) {
      keep.add(k)
      continue
    }

    activeCount++
    const rankedWeapons = base.result.options?.[k]?.weapons

    // Tier 2: small ER shift on unchanged cadence (not holding Favonius when team ER shifted)
    // -> keep current weapon (+ allow Favonius/energy weapon pickup if a teammate's ER rose)
    if (
      !cadenceChanged &&
      erDelta !== undefined &&
      Math.abs(erDelta) <= 12 &&
      !(holdsTeamEnergy && teamErShifted) &&
      baseWeaponId
    ) {
      const ids = new Set<string>([baseWeaponId])
      if (teamErRose && rankedWeapons?.length) {
        for (const opt of rankedWeapons)
          if (isEnergyWeaponId(opt.weaponId)) ids.add(opt.weaponId)
      }
      weaponFilter[k] = ids
      continue
    }

    // Tier 3: changed cadence, big ER shift, or Favonius holder when team ER shifted ->
    // shortlist base + top 4 feasible + top 4 highest-value + all energy/ER weapons
    if (rankedWeapons?.length && baseWeaponId) {
      const ids = new Set<string>([baseWeaponId])
      for (const opt of rankedWeapons.filter((o) => !o.unmet).slice(0, 4))
        ids.add(opt.weaponId)
      for (const opt of [...rankedWeapons]
        .sort((a, b) => b.value - a.value)
        .slice(0, 4))
        ids.add(opt.weaponId)
      for (const opt of rankedWeapons)
        if (isErWeaponId(opt.weaponId)) ids.add(opt.weaponId)
      weaponFilter[k] = ids
    }
  }

  return {
    keep: [...keep],
    weaponFilter,
    maxRounds: activeCount === 0 ? 0 : 2,
    maxExchanges: activeCount >= 2 ? 1 : 0,
  }
}

/**
 * Build a balanced fast per-member search space for KQM Theorycrafting from the base run's builds &
 * rankings (catches Favonius/energy handoffs, ER weapons when ER rises, unlocked DPS weapons when
 * ER drops, and team-buffing 4pc sets, while still skipping ~75-85% of full-search work):
 * - Tier 1 (`'keep'`): unchanged cadence + ER moved <= 1% + already met + no Favonius handoff.
 * - Tier 2 (roll/main refit): unchanged cadence + ER moved <= 12% + not dropping Favonius
 *   (adds Favonius/team-energy weapons automatically if a teammate's ER jumped >= 10%).
 * - Tier 3 (ranked shortlist + energy/team gear): changed cadence, ER moved > 12%, or Favonius
 *   holder when team ER shifted -> top 5 feasible + top 5 highest-DPS + all Favonius/energy/team
 *   weapons (+ all ER-substat weapons if ER rose or cadence changed), top 4+4 sets + all team sets.
 */
function fastKqmSpaceLimits(
  ctx: ScenarioRunContext,
  scenario: RotationScenario,
  keys: CharacterKey[],
  runTeamOpt: TeamOpt
): Partial<
  Record<
    CharacterKey,
    | 'keep'
    | {
        weapons?: KqmWeapon[]
        four?: ArtifactSetKey[]
        two?: ArtifactSetKey[]
        keepTeamEnergyWeapons?: boolean
        keepErWeapons?: boolean
        keepTeamSets?: boolean
      }
  >
> {
  const base = ctx.base?.tab === 'kqm' ? ctx.base : undefined
  if (!base) return {}

  const calc = runTeamOpt.kqm?.energyCalculator
  const baseBuilds = base.result.builds
  const nextTargets = calc
    ? calculateEnergyRecharge(
        keys,
        calc,
        Object.fromEntries(
          keys.flatMap((k) =>
            baseBuilds[k] ? [[k, baseBuilds[k]!.weapon.key]] : []
          )
        ),
        Object.fromEntries(
          keys.flatMap((k) =>
            baseBuilds[k] ? [[k, baseBuilds[k]!.weapon.refinement]] : []
          )
        ),
        Object.fromEntries(
          keys.flatMap((k) => (baseBuilds[k] ? [[k, baseBuilds[k]!.sets]] : []))
        )
      ).targets
    : {}

  let teamErRose = false
  let teamErDropped = false
  for (const k of keys) {
    const b = base.result.energyRecharge[k]?.target
    const n = nextTargets[k]
    if (b === undefined || n === undefined) continue
    if (n - b >= 10) teamErRose = true
    if (b - n >= 10) teamErDropped = true
  }
  const teamErShifted = teamErRose || teamErDropped

  const limits: Partial<
    Record<
      CharacterKey,
      | 'keep'
      | {
          weapons?: KqmWeapon[]
          four?: ArtifactSetKey[]
          two?: ArtifactSetKey[]
          keepTeamEnergyWeapons?: boolean
          keepErWeapons?: boolean
          keepTeamSets?: boolean
        }
    >
  > = {}

  for (const k of keys) {
    const build = baseBuilds[k]
    if (!build) continue
    const cadenceChanged =
      scenario.kind !== 'cadence' ||
      scenario.burstEvery[k] !== ctx.baselineBurstEvery?.[k]
    const baseTarget = base.result.energyRecharge[k]?.target
    const baseAchieved = base.result.energyRecharge[k]?.value
    const nextTarget = nextTargets[k]
    const erDelta =
      baseTarget !== undefined && nextTarget !== undefined
        ? nextTarget - baseTarget
        : undefined
    const absDelta =
      erDelta !== undefined ? Math.abs(erDelta) : Number.POSITIVE_INFINITY
    const meetsNew =
      nextTarget === undefined ||
      (baseAchieved !== undefined && baseAchieved + 0.5 >= nextTarget)
    const holdsTeamEnergy =
      isFavonius(build.weapon.key) || isCalcEnergyWeapon(build.weapon.key)

    // Tier 1: truly untouched teammate (no ER move, no Favonius drop/pickup needed)
    if (
      !cadenceChanged &&
      absDelta <= 1 &&
      meetsNew &&
      !holdsTeamEnergy &&
      !teamErRose
    ) {
      limits[k] = 'keep'
      continue
    }

    const baseSetEntries = Object.entries(build.sets) as [
      ArtifactSetKey,
      number,
    ][]
    const baseFour = baseSetEntries.filter(([, n]) => n >= 4).map(([s]) => s)
    const baseTwo = baseSetEntries.filter(([, n]) => n === 2).map(([s]) => s)

    // Tier 2: small ER shift on unchanged cadence (not holding Favonius while team ER shifted)
    // -> refit main stats & rolls, plus allow Favonius/team-energy weapon pickup if team ER rose
    if (
      !cadenceChanged &&
      absDelta <= 12 &&
      !(holdsTeamEnergy && teamErShifted)
    ) {
      limits[k] = {
        weapons: [build.weapon],
        four: baseFour,
        two: baseTwo,
        keepTeamEnergyWeapons: teamErRose,
      }
      continue
    }

    // Tier 3: changed cadence, ER swing > 12%, or Favonius holder when team ER shifted ->
    // shortlist top ranked weapons & sets + always keep team/energy/ER gear so nothing common is missed
    const ranking = base.result.rankings?.[k]
    if (!ranking) continue

    const weapons: KqmWeapon[] = [build.weapon]
    const seenW = new Set<string>([
      `${build.weapon.key}@${build.weapon.refinement}`,
    ])
    const addWeapon = (w: KqmWeapon) => {
      const id = `${w.key}@${w.refinement}`
      if (seenW.has(id)) return
      seenW.add(id)
      weapons.push(w)
    }
    const ownRanked = ranking.weapons.filter((o) => !o.compare)
    // Top 5 feasible weapons from the base run
    for (const o of ownRanked.filter((o) => !o.unmet).slice(0, 5))
      addWeapon(o.weapon)
    // Top 5 highest-DPS weapons overall (captures DPS weapons unlocked when ER drops!)
    for (const o of [...ownRanked]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5))
      addWeapon(o.weapon)

    const four = new Set<ArtifactSetKey>(baseFour)
    const two = new Set<ArtifactSetKey>(baseTwo)
    const addSets = (sets: Partial<Record<ArtifactSetKey, number>>) => {
      for (const [sk, n] of Object.entries(sets) as [
        ArtifactSetKey,
        number | undefined,
      ][]) {
        if ((n ?? 0) >= 4) four.add(sk)
        else if ((n ?? 0) === 2) two.add(sk)
      }
    }
    for (const o of ranking.sets.filter((o) => !o.unmet).slice(0, 4))
      addSets(o.sets)
    for (const o of [...ranking.sets]
      .sort((a, b) => b.total - a.total)
      .slice(0, 4))
      addSets(o.sets)

    limits[k] = {
      weapons: weapons.length ? weapons : undefined,
      four: four.size ? [...four] : undefined,
      two: two.size ? [...two] : undefined,
      keepTeamEnergyWeapons: true,
      keepErWeapons: erDelta === undefined || erDelta > 10 || cadenceChanged,
      keepTeamSets: true,
    }
  }

  return limits
}

/**
 * Run build optimization for a single scenario using the active tab's real optimizer
 * (`optimizeTeam` for Team optimize, `optimizeTeamKqm` for KQM Theorycrafting),
 * streaming live sub-step progress via `onStep` and reusing the base run's builds & rankings.
 */
export async function runRotationScenario(
  ctx: ScenarioRunContext,
  scenario: RotationScenario,
  isCancelled: () => boolean,
  options?: {
    /** 'fast' (default) refits changed members using base builds/rankings; 'full' re-searches everything */
    mode?: ScenarioCompareMode
    onStep?: (step: ScenarioLiveStep) => void
    /** Warm-start builds/weapons from an earlier scenario in the same comparison */
    fromTeam?: Pick<TeamOptResult, 'builds' | 'weapons'>
    /** Warm-start KQM builds from an earlier scenario in the same comparison */
    fromKqm?: Partial<Record<CharacterKey, KqmBuild>>
    /** Keep KQM workers warm for subsequent scenarios */
    keepKqmWorkers?: boolean
  }
): Promise<ScenarioRunResult> {
  // Baseline scenario already matches the current fresh optimization run -> reuse instantly!
  const reused = baselineScenarioResult(ctx, scenario)
  if (reused) return reused

  const mode: ScenarioCompareMode = options?.mode ?? 'fast'
  const isFast = mode === 'fast' && ctx.base?.tab === ctx.tab
  const members = teamOptMembers(ctx.database, ctx.teamId)
  const keys = members.map((m) => m.characterKey)
  const startedAt = performance.now()
  const onStep = options?.onStep
  const fromTeam =
    options?.fromTeam ??
    (ctx.base?.tab === 'team'
      ? { builds: ctx.base.result.builds, weapons: ctx.base.result.weapons }
      : undefined)
  const fromKqm =
    options?.fromKqm ??
    (ctx.base?.tab === 'kqm' ? ctx.base.result.builds : undefined)

  try {
    if (ctx.tab === 'team') {
      onStep?.({ fraction: 0.02, detail: 'Simulating rotation & ER…' })
      await nextPaint()
      if (isCancelled())
        return {
          scenario,
          dps: 0,
          total: 0,
          rotationTime: 0,
          memberDps: {},
          erTargets: {},
          erAchieved: {},
          weapons: {},
          sets: {},
          unmetCount: 0,
          stalls: [],
          warnings: [],
          error: 'Cancelled',
        }

      const {
        runTeamOpt: baseRunTeamOpt,
        stalls,
        warnings,
      } = teamScenarioSettings(ctx, scenario, members)
      const teamPlan = isFast
        ? fastTeamPlan(ctx, scenario, members, baseRunTeamOpt)
        : undefined
      const runTeamOpt: TeamOpt = teamPlan
        ? { ...baseRunTeamOpt, keep: teamPlan.keep }
        : baseRunTeamOpt
      const status = initStatus()
      let stop: (() => void) | undefined
      const cancelled = () => {
        if (!isCancelled()) return false
        stop?.()
        return true
      }

      // Poll live solver progress every 160 ms so long artifact sweeps show steady movement
      const poll = onStep
        ? setInterval(() => {
            if (!isCancelled())
              onStep(
                teamLiveStep(
                  ctx.names,
                  status.step,
                  status.tested + status.skipped,
                  status.total,
                  status.upper
                )
              )
          }, 160)
        : undefined
      let lastPaint = performance.now()

      let result: TeamOptResult | undefined
      try {
        result = await optimizeTeam({
          database: ctx.database,
          teamId: ctx.teamId,
          gender: ctx.gender,
          teamOpt: runTeamOpt,
          builds: 1,
          from: fromTeam,
          ...(teamPlan && {
            maxRounds: teamPlan.maxRounds,
            skipProvisional: true,
            maxExchanges: teamPlan.maxExchanges,
            weaponFilter: teamPlan.weaponFilter,
          }),
          solve: teamOptSolver(status, ctx.maxWorkers, (s) => {
            stop = s
          }),
          attackStates: ctx.attackStates,
          rankingBonusStats: ctx.rankingBonusStats,
          isCancelled: cancelled,
          onStep: async (step) => {
            status.step = step
            onStep?.(
              teamLiveStep(
                ctx.names,
                step,
                status.tested + status.skipped,
                status.total,
                status.upper
              )
            )
            if (performance.now() - lastPaint < 100) return
            await nextPaint()
            lastPaint = performance.now()
          },
        })
      } finally {
        if (poll) clearInterval(poll)
      }

      const elapsedSeconds = (performance.now() - startedAt) / 1000
      const rotationTime = runTeamOpt.rotationTime ?? 20
      if (!result) {
        const currentWeapons = teamOptCurrentWeapons(ctx.database, members)
        return {
          scenario,
          dps: 0,
          total: 0,
          rotationTime,
          memberDps: {},
          erTargets:
            teamCalculatorTargets(keys, currentWeapons, runTeamOpt) ?? {},
          erAchieved: {},
          weapons: {},
          sets: {},
          unmetCount: 1,
          stalls,
          warnings,
          elapsedSeconds,
          error: isCancelled()
            ? 'Cancelled'
            : 'No team build met all requirements for this scenario.',
        }
      }
      return toTeamScenarioResult(
        ctx,
        scenario,
        members,
        runTeamOpt,
        result,
        stalls,
        warnings,
        elapsedSeconds
      )
    }

    // KQM Theorycrafting tab
    onStep?.({ fraction: 0.02, detail: 'Simulating rotation & ER…' })
    await nextPaint()
    if (isCancelled())
      return {
        scenario,
        dps: 0,
        total: 0,
        rotationTime: 0,
        memberDps: {},
        erTargets: {},
        erAchieved: {},
        weapons: {},
        sets: {},
        unmetCount: 0,
        stalls: [],
        warnings: [],
        error: 'Cancelled',
      }

    const { runTeamOpt } = kqmScenarioSettings(ctx, scenario, members)
    // In fast mode, build a surgical per-member space from the base run's builds & rankings
    // (0 problems for unchanged teammates, 1 problem for ER-only refits, ~4-6 for changed members).
    const spaceLimits =
      isFast && fromKqm
        ? fastKqmSpaceLimits(ctx, scenario, keys, runTeamOpt)
        : undefined

    // In full mode, still reuse screened-out weapons/sets for unchanged teammates when !fullSearch
    let seedScreenedOut: KqmResult['screenedOut'] | undefined
    if (
      !isFast &&
      scenario.kind === 'cadence' &&
      ctx.base?.tab === 'kqm' &&
      ctx.base.result.screenedOut &&
      !runTeamOpt.kqm?.fullSearch
    ) {
      const calc = runTeamOpt.kqm?.energyCalculator
      const nextTargets = calc
        ? kqmEnergyEstimate(keys, calc, runTeamOpt.kqm).targets
        : {}
      const reusedOut: NonNullable<KqmResult['screenedOut']> = {}
      for (const k of keys) {
        const out = ctx.base.result.screenedOut[k]
        if (!out) continue
        if (scenario.burstEvery[k] !== ctx.baselineBurstEvery?.[k]) continue
        const baseEr = ctx.base.result.energyRecharge[k]?.target
        const nextEr = nextTargets[k]
        if (
          baseEr !== undefined &&
          nextEr !== undefined &&
          Math.abs(nextEr - baseEr) <= 8
        ) {
          reusedOut[k] = out
        }
      }
      if (Object.keys(reusedOut).length > 0) seedScreenedOut = reusedOut
    }

    const warnings: string[] = []
    let lastReport = 0
    let lastMember: CharacterKey | undefined
    const kqmResult = await optimizeTeamKqm({
      database: ctx.database,
      teamId: ctx.teamId,
      gender: ctx.gender,
      teamOpt: runTeamOpt,
      from: fromKqm,
      maxRounds: isFast ? 2 : 3,
      spaceLimits,
      seedScreenedOut,
      replay: kqmReplayOf(
        ctx.database,
        ctx.gender,
        ctx.i18n,
        ctx.teamId,
        runTeamOpt,
        scenario.text
      ),
      attackStates: ctx.attackStates,
      skipRankings: true,
      keepWorkers: options?.keepKqmWorkers ?? true,
      isCancelled,
      onStep: (step) => {
        if (!onStep || isCancelled()) return
        const now = performance.now()
        if (step.characterKey === lastMember && now - lastReport < 100) return
        lastMember = step.characterKey
        lastReport = now
        onStep(kqmLiveStep(ctx.names, step))
      },
    })

    const elapsedSeconds = (performance.now() - startedAt) / 1000
    if (!kqmResult) {
      const calc = runTeamOpt.kqm?.energyCalculator
      return {
        scenario,
        dps: 0,
        total: 0,
        rotationTime:
          runTeamOpt.kqm?.energyCalculator?.rotationTime ??
          runTeamOpt.rotationTime ??
          20,
        memberDps: {},
        erTargets: calc
          ? kqmEnergyEstimate(keys, calc, runTeamOpt.kqm).targets
          : {},
        erAchieved: {},
        weapons: {},
        sets: {},
        unmetCount: 1,
        stalls: [],
        warnings,
        elapsedSeconds,
        error: isCancelled()
          ? 'Cancelled'
          : 'No KQM build met all requirements for this scenario.',
      }
    }

    return toKqmScenarioResult(
      scenario,
      keys,
      runTeamOpt,
      kqmResult,
      warnings,
      elapsedSeconds
    )
  } catch (e) {
    return {
      scenario,
      dps: 0,
      total: 0,
      rotationTime: 0,
      memberDps: {},
      erTargets: {},
      erAchieved: {},
      weapons: {},
      sets: {},
      unmetCount: 0,
      stalls: [],
      warnings: [],
      elapsedSeconds: (performance.now() - startedAt) / 1000,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Apply a chosen scenario to the active tab: updates the rotation text, attacks, rotation time,
 * and pins the scenario's Burst cadences in the tab's ER calculator.
 */
export function applyRotationScenario({
  ctx,
  scenario,
  setTeamOpt,
  onTextApplied,
}: {
  ctx: ScenarioRunContext
  scenario: RotationScenario
  setTeamOpt: (update: TeamOptUpdate) => void
  onTextApplied?: (text: string) => void
}): boolean {
  const { tab, database, gender, teamId, names, teamOpt, saved } = ctx
  const isKqm = tab === 'kqm'
  const members = teamOptMembers(database, teamId)
  const keys = members.map((m) => m.characterKey)
  const own = simTeamOf(members, database)
  const constellations = isKqm
    ? Object.fromEntries(
        keys.map((k) => [k, kqmMemberConstellation(k, teamOpt.kqm)])
      )
    : own.constellations

  const played = simulateWritten({
    kqm: isKqm,
    text: scenario.text,
    opener: saved.opener,
    timing: saved.timing,
    frameData: saved.frameData,
    team: isKqm
      ? {
          members: keys,
          constellations,
          elements: own.elements,
          gear: {},
        }
      : own,
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w) => w,
    burstEvery: scenario.burstEvery,
  })

  if (!played?.sim) return false

  // Update the tab's ER calculator burstEvery settings first
  setTeamOpt((o) => {
    if (isKqm) {
      const kqm = (o.kqm ??= { ...defaultTeamOptKqm })
      const base = syncEnergyCalculator(
        keys,
        kqm.energyCalculator,
        played.counted
          ? played.counted.sim.frames / 60 / played.counted.rotations
          : (o.rotationTime ?? 20),
        o.onField ?? keys[0],
        constellations
      )
      kqm.energySource = 'calculator'
      kqm.energyCalculator = withScenarioBurstEvery(
        base,
        scenario.burstEvery,
        false
      )
    } else {
      const base = syncEnergyCalculator(
        keys,
        o.energyCalculator,
        played.counted
          ? played.counted.sim.frames / 60 / played.counted.rotations
          : (o.rotationTime ?? 20),
        o.onField ?? keys[0],
        constellations
      )
      o.energySource = 'calculator'
      o.energyCalculator = withScenarioBurstEvery(
        base,
        scenario.burstEvery,
        false
      )
    }
  })

  applyWritten({
    database,
    teamId,
    members,
    setTeamOpt,
    result: played,
    text: scenario.text,
    opener: saved.opener,
    timing: saved.timing,
    frameData: saved.frameData,
    kqm: isKqm,
    constellations,
  })

  onTextApplied?.(scenario.text)
  return true
}
