import type {
  CharacterKey,
  GenderKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type {
  BonusStats,
  ErPrice,
  FrameData,
  KqmResult,
  RotationMember,
  RotationSearchSetup,
  RotationTimingSettings,
  RunAttackState,
  SimGear,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  kqmErPrices,
  kqmRotationSearchSetup,
  runTeamOpt,
  simTeamOf,
  startTeamOptWorker,
  syncEnergyCalculator,
  TeamOptCancelled,
  TeamOptRequirementsUnmet,
  TeamOptSetRulesUnmet,
  TeamOptWorkerUnavailable,
  teamBurstEvery,
  teamErPrices,
  teamOptBonusStats,
  teamOptMembers,
  teamOptResultGear,
  teamOptRunGear,
  teamOptUIData,
  teamRotationSearchSetup,
  withRotationEnergy,
  writtenTeamReplay,
} from '@genshin-optimizer/gi/ui'
import { uiInput } from '@genshin-optimizer/gi/wr'
import type { i18n } from 'i18next'
import { teamRotationEnergy } from './RotationWriter'
import { kqmResultDps, kqmRotationRun } from './rotationConfirm'
import { initStatus } from './useTeamOptRun'

/**
 * What a rotation search plays rotations with, and how a tab finds builds of its own for one: the
 * KQM tab's (KQM builds) or Team optimize's (builds from the inventory)
 */
export interface RotationSearchSource {
  tab: 'kqm' | 'team'
  /** The builds the search plays every rotation with */
  setup: RotationSearchSetup
  /** Each member's Energy Recharge with them (%) */
  funded: Partial<Record<CharacterKey, number>>
  /** The tab's DPS with them, for the rotation they were found for */
  dps: number
  /** What Energy Recharge costs them, per member (`kqmErPrices`; none: not priced) */
  prices: (
    pause: () => Promise<void>
  ) => Promise<Partial<Record<CharacterKey, ErPrice>>>
  /**
   * The tab's own builds for another rotation, as its run would find them once the rotation is
   * used (nothing saved): their DPS, and a source with them. Undefined: none found.
   */
  confirm: (
    text: string,
    isCancelled: () => boolean,
    onAbort?: (abort: (() => void) | undefined) => void
  ) => Promise<{ dps: number; next: RotationSearchSource } | undefined>
}

/** Each KQM result's Energy Recharge prices, worked out once */
const kqmPrices = new WeakMap<
  KqmResult,
  Promise<Partial<Record<CharacterKey, ErPrice>>>
>()
/** Each Team Optimize result's Energy Recharge prices, worked out once */
const teamPrices = new WeakMap<
  Pick<TeamOptResult, 'builds' | 'weapons' | 'after' | 'attackStates'>,
  Promise<Partial<Record<CharacterKey, ErPrice>>>
>()

/** A KQM result's builds, as the KQM tab plays the rotation with them */
export function kqmSearchSource(args: {
  database: ArtCharDatabase
  gender: GenderKey
  i18n: i18n
  teamId: string
  names: RotationMember[]
  /** The settings the result was run with */
  teamOpt: TeamOpt
  result: KqmResult
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  /** The states a KQM run gives every attack now */
  attackStates: () => readonly RunAttackState[] | undefined
  /** What a roll adds for `result`'s builds, where known */
  gains?: Partial<
    Record<CharacterKey, Partial<Record<SubstatKey, number | null>>>
  >
}): RotationSearchSource {
  const { database, gender, i18n, teamId, names, teamOpt, result, saved } = args
  return {
    tab: 'kqm',
    setup: kqmRotationSearchSetup(
      database,
      teamId,
      gender,
      names,
      teamOpt,
      result,
      saved
    ),
    funded: Object.fromEntries(
      Object.entries(result.energyRecharge).map(([k, er]) => [
        k,
        er?.value ?? 0,
      ])
    ),
    dps: kqmResultDps(result),
    prices: (pause) => {
      let prices = kqmPrices.get(result)
      if (!prices) {
        prices = kqmErPrices(
          database,
          teamId,
          gender,
          teamOpt,
          result,
          pause,
          args.gains
        ).catch(() => ({}))
        kqmPrices.set(result, prices)
      }
      return prices
    },
    confirm: async (text, isCancelled) => {
      const run = await kqmRotationRun({
        database,
        gender,
        i18n,
        teamId,
        teamOpt,
        text,
        attackStates: args.attackStates(),
        isCancelled,
      }).catch(() => undefined)
      return run
        ? {
            dps: kqmResultDps(run),
            next: kqmSearchSource({ ...args, result: run, gains: undefined }),
          }
        : undefined
    },
  }
}

/** A Team optimize result's team build, as the tab plays the rotation with it */
export function teamSearchSource(args: {
  database: ArtCharDatabase
  gender: GenderKey
  teamId: string
  names: RotationMember[]
  /** The settings the result was run with (its rotation's attacks and time) */
  teamOpt: TeamOpt
  /** Current tab settings for ER calculation and build confirmation (defaults to `teamOpt`) */
  liveTeamOpt?: TeamOpt
  /** The team build (the result, or one of its next best) */
  result: Pick<TeamOptResult, 'builds' | 'weapons' | 'after' | 'attackStates'>
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  /** What a run adds now: the states every attack gets, and the bonus stats builds are ranked with */
  attackStates: () => readonly RunAttackState[] | undefined
  rankingBonusStats: () => Partial<Record<CharacterKey, BonusStats>> | undefined
  maxWorkers: number
}): RotationSearchSource {
  const { database, gender, teamId, names, teamOpt, result, saved } = args
  const confirmTeamOpt = args.liveTeamOpt ?? teamOpt
  const setupTeamOpt: TeamOpt =
    confirmTeamOpt === teamOpt
      ? teamOpt
      : {
          ...teamOpt,
          energySource: confirmTeamOpt.energySource,
          energyCalculator: confirmTeamOpt.energyCalculator,
        }
  const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const builds = teamOptResultGear(database, teamId, result)
  const gear: Partial<Record<CharacterKey, SimGear>> = {}
  for (const [ck, arts] of Object.entries(builds.arts)) {
    const sets: Record<string, number> = {}
    for (const art of arts ?? []) sets[art.setKey] = (sets[art.setKey] ?? 0) + 1
    const weapon = builds.weapons[ck as CharacterKey]
    gear[ck as CharacterKey] = {
      sets,
      weapon: weapon?.key,
      refinement: weapon?.refinement,
    }
  }
  const uiData = teamOptUIData(database, teamId, gender, teamOpt, result)
  const time = teamOpt.rotationTime ?? 0
  return {
    tab: 'team',
    setup: teamRotationSearchSetup(
      database,
      teamId,
      gender,
      names,
      setupTeamOpt,
      {
        ...builds,
        mainStatAssumptionLevel: teamOpt.assumeMaxMain ? 20 : 0,
        bonusStats: teamOptBonusStats(teamOpt, keys),
      },
      gear,
      saved,
      result.attackStates
    ),
    funded: Object.fromEntries(
      keys.map((k) => [
        k,
        ((uiData?.[k]?.get(uiInput.total.enerRech_).value as number) ?? 0) *
          100,
      ])
    ),
    dps: time > 0 ? result.after.total / time : 0,
    prices: (pause) => {
      let prices = teamPrices.get(result)
      if (!prices) {
        prices = teamErPrices(
          database,
          teamId,
          gender,
          teamOpt,
          result,
          pause
        ).catch(() => ({}))
        teamPrices.set(result, prices)
      }
      return prices
    },
    confirm: async (text, isCancelled, onAbort) => {
      const run = await teamRotationRun({
        ...args,
        teamOpt: confirmTeamOpt,
        text,
        warmStart: { builds: result.builds, weapons: result.weapons },
        isCancelled,
        onAbort,
      }).catch(() => undefined)
      if (!run) return undefined
      const runTime = run.teamOpt.rotationTime ?? 0
      return {
        dps: runTime > 0 ? run.result.after.total / runTime : 0,
        next: teamSearchSource({
          ...args,
          teamOpt: run.teamOpt,
          liveTeamOpt: run.teamOpt,
          result: run.result,
        }),
      }
    },
  }
}

/**
 * Team optimize's builds for another rotation, as "Generate builds" would find them once it is
 * used: the rotation played as "Use this rotation" plays it (the members' own constellations and
 * gear) for its attacks and time, the ER calculator, when the requirements come from it, filled
 * from that rotation, and a run on the inventory with the same settings (off the main thread in
 * the pooled worker when available, warm-started from the base result). Nothing is saved.
 */
export async function teamRotationRun({
  database,
  gender,
  teamId,
  names,
  teamOpt,
  text,
  saved,
  attackStates,
  rankingBonusStats,
  maxWorkers,
  warmStart,
  isCancelled,
  onAbort,
}: {
  database: ArtCharDatabase
  gender: GenderKey
  teamId: string
  names: RotationMember[]
  teamOpt: TeamOpt
  text: string
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  attackStates: () => readonly RunAttackState[] | undefined
  rankingBonusStats: () => Partial<Record<CharacterKey, BonusStats>> | undefined
  maxWorkers: number
  warmStart?: Pick<TeamOptResult, 'builds' | 'weapons'>
  isCancelled: () => boolean
  onAbort?: (abort: (() => void) | undefined) => void
}): Promise<{ result: TeamOptResult; teamOpt: TeamOpt } | undefined> {
  if (isCancelled()) return undefined
  const members = teamOptMembers(database, teamId)
  const keys = members.map((m) => m.characterKey)
  const own = simTeamOf(members, database)
  const played = writtenTeamReplay({
    database,
    teamId,
    members,
    gender,
    names,
    teamOpt,
    text,
    ...saved,
  })?.({
    gear: teamOptRunGear(database, teamId, teamOpt, own.gear),
    overrides: {},
  })
  if (!played?.rotationTime || isCancelled()) return undefined
  const nextTeamOpt: TeamOpt = {
    ...teamOpt,
    attacks: played.attacks,
    rotationTime: played.rotationTime,
  }
  if (teamOpt.energySource !== 'manual') {
    const worked = teamRotationEnergy({
      database,
      teamId,
      members,
      gender,
      names,
      team: own,
      text,
      burstEvery: teamBurstEvery(teamOpt),
      saved,
    })
    if (worked) {
      nextTeamOpt.energySource = 'calculator'
      nextTeamOpt.energyCalculator = {
        ...withRotationEnergy(
          syncEnergyCalculator(
            keys,
            teamOpt.energyCalculator,
            played.rotationTime,
            teamOpt.onField ?? keys[0],
            own.constellations
          ),
          keys,
          worked.energy
        ),
        rotationTime: worked.rotationTime || played.rotationTime,
      }
    }
  }
  if (isCancelled()) return undefined
  let found: TeamOptResult | undefined
  let stopWorker: (() => void) | undefined
  let stopSolver: (() => void) | undefined
  const abort = () => {
    stopWorker?.()
    stopSolver?.()
  }
  onAbort?.(abort)
  const job = {
    teamId,
    gender,
    teamOpt: nextTeamOpt,
    ...(nextTeamOpt.optimizeWeapons
      ? { rotation: { names, text, ...saved } }
      : {}),
    attackStates: attackStates(),
    rankingBonusStats: rankingBonusStats(),
    maxWorkers,
    lowImpact:
      typeof window !== 'undefined'
        ? (window.matchMedia?.('(pointer: coarse)').matches ?? false)
        : false,
    ranking: false,
    ...(warmStart ? { warmStart, skipProvisional: true } : {}),
  }
  const updates = {
    onProgress: () => {},
    onResult: (r: TeamOptResult) => {
      found = r
    },
    onOptions: () => {},
  }
  try {
    try {
      const worker = startTeamOptWorker(database, job, updates)
      stopWorker = worker.stop
      if (isCancelled()) {
        worker.stop()
        return undefined
      }
      await worker.done
    } catch (error) {
      if (!(error instanceof TeamOptWorkerUnavailable) || isCancelled())
        throw error
      stopWorker = undefined
      await runTeamOpt(
        database,
        job,
        initStatus(),
        updates,
        isCancelled,
        (next) => {
          stopSolver = next
          if (isCancelled()) next?.()
        }
      )
    }
  } catch (error) {
    if (
      error instanceof TeamOptCancelled ||
      error instanceof TeamOptRequirementsUnmet ||
      error instanceof TeamOptSetRulesUnmet
    )
      return undefined
    throw error
  } finally {
    onAbort?.(undefined)
  }
  return found && !isCancelled()
    ? { result: found, teamOpt: nextTeamOpt }
    : undefined
}
