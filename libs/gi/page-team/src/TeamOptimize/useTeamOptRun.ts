import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { OptProblemInput } from '@genshin-optimizer/gi/solver'
import {
  GOSolver,
  mergeBuilds,
  nextPaint,
  prewarmSolver,
} from '@genshin-optimizer/gi/solver'
import { compactArtifacts } from '@genshin-optimizer/gi/solver-tc'
import type {
  BonusStats,
  RunAttackState,
  RunEnemy,
  TeamOptResult,
  TeamOptSession,
  TeamOptSolver,
  TeamOptStep,
} from '@genshin-optimizer/gi/ui'
import {
  optimizeTeam,
  runEnemyOf,
  TEAM_GPU_MIN_TOTAL,
  TeamOptCancelled,
  TeamOptSetRulesUnmet,
  teamOptMembers,
  useNumWorkers,
} from '@genshin-optimizer/gi/ui'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { teamRunAttacks } from './RotationWriter'
import { sameBuildRoster, teamRoster, teamRunKey } from './runScope'
import { inventoryRequirementsKey } from './useTeamOpt'

export type TeamOptRunState =
  | { type: 'idle' }
  | { type: 'running'; step?: TeamOptStep; startTime: number }
  | {
      type: 'done'
      result: TeamOptResult
      roster?: string
      requirementsKey?: string
      seconds: number
      /** The settings it was found with (the rotation its damage is for) */
      teamOpt: TeamOpt
      /** The enemy it was found for (the team's then); absent: found before this was kept */
      enemy?: RunEnemy
      /** When it was found: which saved result it is (`database.teamOptResults`) */
      savedAt?: number
      /** Its members' other builds are being searched (`TeamOptResult.options`) */
      optionsRunning?: true
    }
  | {
      type: 'error'
      message: string
      /** The members no team build keeps to the allowed sets of (the run gave no result) */
      setRulesUnmet?: CharacterKey[]
    }

/** The live counters of the solver of the current step */
export type TeamOptStatus = {
  /**
   * The step being run. Kept here, read by the progress line on its own timer, not in the run's
   * state: a state change per step re-rendered the whole page about 30 times a run.
   */
  step?: TeamOptStep
  tested: number
  failed: number
  skipped: number
  total: number
  /** Every combination, set rules not applied (the GPU's sweep), until `total` is known */
  upper?: number
  testedPerSecond: number
  skippedPerSecond: number
}
export const initStatus = (): TeamOptStatus => ({
  tested: 0,
  failed: 0,
  skipped: 0,
  total: Number.NaN,
  testedPerSecond: 0,
  skippedPerSecond: 0,
})

/**
 * The last result per team, so that it is still there after visiting another page (one object
 * per result: views cache their work by it). Also saved in the database, for after a reload.
 */
const lastRuns: Record<string, TeamOptRunState> = {}

function inventoryResultFits(
  database: ArtCharDatabase,
  teamId: string,
  result: {
    builds: Record<string, Record<string, string | undefined>>
    weapons: Record<string, string>
  },
  roster: string | undefined
) {
  // (a run's builds: its members not on a theorycraft build, which it keeps as they are)
  const members = teamOptMembers(database, teamId)
    .filter((m) => !m.isTc)
    .map((m) => m.characterKey)
  return (
    sameBuildRoster(result.builds, members) &&
    (roster === undefined || roster === teamRoster(database, teamId)) &&
    Object.values(result.builds).every((build) =>
      Object.values(build).every((id) => !id || database.arts.get(id))
    ) &&
    Object.values(result.weapons).every((id) => !id || database.weapons.get(id))
  )
}

/**
 * A team's saved last result (see `database.teamOptResults`), when it still fits the team: the
 * same members, and every artifact and weapon still there. One that no longer fits is forgotten.
 */
function savedRun(
  database: ArtCharDatabase,
  teamId: string
): TeamOptRunState | undefined {
  const saved = database.teamOptResults.get().runs[teamId]
  if (!saved) return undefined
  if (!inventoryResultFits(database, teamId, saved.result, saved.roster)) {
    database.teamOptResults.setRun(teamId, undefined)
    return undefined
  }
  // (the database keeps its copy frozen)
  const { result, roster, requirementsKey, seconds, teamOpt, enemy, savedAt } =
    structuredClone(saved)
  return {
    type: 'done',
    result: result as unknown as TeamOptResult,
    seconds,
    teamOpt,
    ...(enemy ? { enemy } : {}),
    savedAt,
    roster,
    requirementsKey,
  }
}

/** The team's last result: of this visit, else the saved one */
function lastRun(database: ArtCharDatabase, teamId: string): TeamOptRunState {
  const key = teamRunKey(database, teamId)
  const cached = lastRuns[key]
  if (
    cached?.type === 'done' &&
    !inventoryResultFits(database, teamId, cached.result, cached.roster)
  )
    delete lastRuns[key]
  if (!lastRuns[key]) {
    const saved = savedRun(database, teamId)
    if (saved) lastRuns[key] = saved
  }
  return lastRuns[key] ?? { type: 'idle' }
}

/**
 * Team Optimize's solver for its runs: one solve per member and round, on the GPU when the browser
 * can, its live counters in `status`; `onSolver` gets what stops the solves running (undefined
 * between solves). A member's weapons can be solved at once: the first one running shows its
 * counters, the others count apart.
 */
export function teamOptSolver(
  status: TeamOptStatus,
  maxWorkers: number,
  onSolver: (stop: (() => void) | undefined) => void
): TeamOptSolver {
  const running = new Set<GOSolver>()
  const stopAll = () => {
    for (const solver of running) solver.cancel(new TeamOptCancelled())
  }
  return async ({
    arts,
    objective,
    constraints,
    exclusion,
    mainStatAssumptionLevel,
    topN = 1,
    onWork,
  }) => {
    const problem: OptProblemInput = {
      arts: compactArtifacts(arts, mainStatAssumptionLevel, false),
      optimizationTarget: objective,
      constraints,
      exclusion,
      topN,
    }
    const shown = !running.size
    const counters = shown ? Object.assign(status, initStatus()) : initStatus()
    // (Team Optimize always uses the GPU when the browser can: each step has a build to beat, which
    // the GPU's sweep prunes with; the Optimize tab's GPU setting is for single searches. A
    // team's formula is large: the CPU goes through ~2M builds a second, so the GPU takes even
    // small searches)
    const solver = new GOSolver(
      problem,
      counters,
      // (one running beside another shares the cores, should the CPU take it)
      shown ? maxWorkers : Math.max(1, Math.floor(maxWorkers / 2)),
      { gpu: true, gpuMinTotal: TEAM_GPU_MIN_TOTAL }
    )
    running.add(solver)
    onSolver(stopAll)
    const t0 = performance.now()
    try {
      const results = await solver.solve()
      onWork?.({
        tested: counters.tested,
        total: Number.isFinite(counters.total) ? counters.total : 0,
      })
      const [best, ...next] = mergeBuilds(
        results.map((r) => r.builds),
        topN
      )
      if (process.env['NODE_ENV'] === 'development')
        console.log('[TeamOpt] solve', {
          arts: arts.length,
          total: counters.total,
          tested: counters.tested,
          skipped: counters.skipped,
          ms: Math.round(performance.now() - t0),
          found: !!best,
        })
      return (
        best && {
          value: best.value,
          artifactIds: best.artifactIds,
          ...(next.length
            ? {
                more: next.map(({ value, artifactIds }) => ({
                  value,
                  artifactIds,
                })),
              }
            : {}),
        }
      )
    } finally {
      running.delete(solver)
      if (!running.size) onSolver(undefined)
      solver.cancel()
    }
  }
}

/**
 * The results' teams to try other equipment on (`TeamOptSession`), by when they were found: the
 * latest few (a run's, or rebuilt for a saved result)
 */
const sessions = new Map<number, Promise<TeamOptSession | undefined>>()
const SESSIONS_KEPT = 3
const keepSession = (
  savedAt: number,
  session: Promise<TeamOptSession | undefined>
) => {
  sessions.delete(savedAt)
  sessions.set(savedAt, session)
  if (sessions.size > SESSIONS_KEPT)
    sessions.delete(sessions.keys().next().value as number)
}

/** Runs Team Optimize for a team: one solver run per member and round (see `optimizeTeam`) */
export function useTeamOptRun(teamId: string) {
  const database = useDatabase()
  const key = teamRunKey(database, teamId)
  const { gender } = useDBMeta()
  const { i18n } = useTranslation('charNames_gen')
  const [maxWorkers] = useNumWorkers()
  const [state, setStateRaw] = useState<TeamOptRunState>(() =>
    lastRun(database, teamId)
  )
  const setState = useCallback(
    /** `save`: a result's update (its other builds) saved too */
    (state: TeamOptRunState, save = false) => {
      // (a new result: when it was found says which saved one it is)
      const next: TeamOptRunState =
        state.type === 'done' && state.savedAt === undefined
          ? { ...state, savedAt: Date.now() }
          : state
      // a run in progress is not worth keeping: leaving the page cancels it
      if (next.type !== 'running') lastRuns[key] = next
      // a new result replaces the saved one (an error keeps it; the saved one shown again after
      // a cancel stays as it is, with what was computed for it since)
      if (
        next.type === 'done' &&
        (save ||
          database.teamOptResults.get().runs[teamId]?.savedAt !== next.savedAt)
      )
        database.teamOptResults.setRun(teamId, {
          savedAt: next.savedAt!,
          seconds: next.seconds,
          roster: next.roster,
          requirementsKey: next.requirementsKey,
          teamOpt: next.teamOpt,
          ...(next.enemy ? { enemy: next.enemy } : {}),
          result: structuredClone(next.result) as never,
        })
      setStateRaw(next)
    },
    [database, teamId, key]
  )
  const activeRoster = teamRoster(database, teamId)
  const requirementsKey = useSyncExternalStore(
    useCallback(
      (onChange) => database.optConfigs.followAny(onChange),
      [database]
    ),
    () => inventoryRequirementsKey(database, teamId)
  )
  // A roster edit cancels the active job and rechecks the cached result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a roster change also invalidates the mounted result
  useEffect(
    () => setStateRaw(lastRun(database, teamId)),
    [database, teamId, activeRoster]
  )
  const status = useRef<TeamOptStatus>(initStatus())
  const cancelRef = useRef<() => void>(() => {})
  /** The latest run: an earlier one (its other builds stopped) leaves the state to it */
  const latestRun = useRef(0)
  useEffect(() => () => cancelRef.current(), [])
  // load a solver worker while the user sets things up
  useEffect(() => prewarmSolver(), [])

  const run = useCallback(
    async (
      /** States every attack gets (e.g. Wolf's Gravestone's uptime against the enemy) */
      attackStates?: readonly RunAttackState[],
      /** Bonus stats added while builds are ranked (the fight's averaged state buffs) */
      rankingBonusStats?: Partial<Record<CharacterKey, BonusStats>>
    ) => {
      // (a result's other builds still being searched stop: this run replaces it)
      cancelRef.current()
      const id = ++latestRun.current
      const mine = () => latestRun.current === id
      let cancelled = false
      const roster = teamRoster(database, teamId)
      let stopSolver: (() => void) | undefined
      cancelRef.current = () => {
        cancelled = true
        stopSolver?.()
      }
      const stopFollowing = database.teams.follow(teamId, () => {
        if (teamRoster(database, teamId) !== roster) cancelRef.current()
      })
      let shown: (TeamOptRunState & { type: 'done' }) | undefined
      // its other builds done or stopped: the result as it is, saved (not over a newer run's)
      const settle = (found: TeamOptRunState & { type: 'done' }) => {
        const { optionsRunning: _, ...done } = found
        if (mine()) setState(done, true)
        else {
          const last = lastRuns[key]
          if (last?.type === 'done' && last.savedAt === done.savedAt)
            lastRuns[key] = done
        }
      }
      const startTime = performance.now()
      let lastPaint = startTime
      status.current.step = undefined
      setState({ type: 'running', startTime })
      try {
        await nextPaint()
        const teamOpt = database.teams.get(teamId)?.teamOpt ?? initTeamOpt()
        // (the rotation played again with the sets and weapons the run may give each member, so
        // their effects count as the rotation triggers them, not by the members' switches)
        const attacks = teamRunAttacks(database, gender, i18n, teamId, teamOpt)
        const requirementsKey = inventoryRequirementsKey(database, teamId)
        // (the enemy its damage is for, as it is now)
        const team = database.teams.get(teamId)
        const enemy = team && runEnemyOf(team)
        const solve = teamOptSolver(status.current, maxWorkers, (stop) => {
          stopSolver = stop
        })
        const seconds = () => (performance.now() - startTime) / 1000
        // the result as soon as it is found, its members' other builds added as they come
        let session: TeamOptSession | undefined
        const show = (next: TeamOptRunState & { type: 'done' }) => {
          if (!mine() || cancelled || teamRoster(database, teamId) !== roster)
            return
          const first = !shown
          shown = { ...next, savedAt: shown?.savedAt ?? Date.now() }
          if (first && session)
            keepSession(shown.savedAt!, Promise.resolve(session))
          setState(shown, true)
        }
        const result = await optimizeTeam({
          database,
          teamId,
          gender,
          teamOpt: attacks ? { ...teamOpt, attacks } : teamOpt,
          onResult: (found) =>
            show({
              type: 'done',
              roster,
              requirementsKey,
              result: attacks ? { ...found, attacks } : found,
              seconds: seconds(),
              teamOpt,
              ...(enemy ? { enemy } : {}),
              optionsRunning: true,
            }),
          onSession: (s) => {
            session = s
          },
          onOptions: (ck, options) =>
            shown &&
            show({
              ...shown,
              result: {
                ...shown.result,
                options: { ...shown.result.options, [ck]: options },
              },
            }),
          solve,
          builds: teamOpt.topN ?? 1,
          attackStates,
          rankingBonusStats,
          isCancelled: () => cancelled,
          onStep: async (step) => {
            status.current.step = step
            // let the page show the step, at most every 100 ms: a step the memo answers takes no
            // time, and a paint after each (up to 50 ms) added up to seconds per run
            if (performance.now() - lastPaint < 100) return
            await nextPaint()
            lastPaint = performance.now()
          },
        })
        // (stopped while its other builds were searched: the result stays, with those found)
        if (shown) return settle(shown)
        if (!mine()) return
        if (cancelled || teamRoster(database, teamId) !== roster)
          throw new TeamOptCancelled()
        setState(
          result
            ? {
                type: 'done',
                roster,
                requirementsKey,
                result: attacks ? { ...result, attacks } : result,
                seconds: seconds(),
                teamOpt,
                ...(enemy ? { enemy } : {}),
              }
            : { type: 'error', message: 'The team could not be computed.' }
        )
      } catch (e) {
        if (shown) return settle(shown)
        if (!mine()) return
        if (cancelled || e instanceof TeamOptCancelled)
          setState(lastRun(database, teamId))
        else if (e instanceof TeamOptSetRulesUnmet)
          setState({
            type: 'error',
            message: e.message,
            setRulesUnmet: e.characterKeys,
          })
        else
          setState({ type: 'error', message: (e as Error)?.message ?? `${e}` })
      } finally {
        stopFollowing()
        if (mine()) cancelRef.current = () => {}
      }
    },
    [database, teamId, gender, i18n, maxWorkers, setState, key]
  )

  /**
   * A result's team to try other equipment on: the run's own, else rebuilt from the saved result
   * (its builds and weapons, no rounds)
   */
  const sessionOf = useCallback(
    (run: TeamOptRunState & { type: 'done' }) => {
      const savedAt = run.savedAt ?? 0
      let session = sessions.get(savedAt)
      if (!session) {
        let made: TeamOptSession | undefined
        session = optimizeTeam({
          database,
          teamId,
          gender,
          teamOpt: run.result.attacks
            ? { ...run.teamOpt, attacks: run.result.attacks }
            : run.teamOpt,
          solve: teamOptSolver(initStatus(), maxWorkers, () => {}),
          maxRounds: 0,
          from: run.result,
          attackStates: run.result.attackStates,
          onSession: (s) => {
            made = s
          },
        })
          .then(() => made)
          .catch(() => undefined)
        keepSession(savedAt, session)
      }
      return session
    },
    [database, teamId, gender, maxWorkers]
  )

  const cancel = useCallback(() => cancelRef.current(), [])
  const clear = useCallback(() => {
    database.teamOptResults.setRun(teamId, undefined)
    setState({ type: 'idle' })
  }, [database, teamId, setState])
  return {
    state,
    status: status.current,
    run,
    cancel,
    clear,
    requirementsKey,
    sessionOf,
  }
}
