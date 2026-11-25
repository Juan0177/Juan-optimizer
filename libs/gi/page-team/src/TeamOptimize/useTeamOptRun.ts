import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { nextPaint } from '@genshin-optimizer/gi/solver'
import type {
  BonusStats,
  RunAttackState,
  RunEnemy,
  TeamOptMemberOptions,
  TeamOptResult,
  TeamOptSession,
  TeamOptShortfall,
  TeamOptStatus,
  TeamOptStep,
} from '@genshin-optimizer/gi/ui'
import {
  initStatus,
  optimizeTeam,
  runEnemyOf,
  runTeamOpt,
  startTeamOptWorker,
  TeamOptCancelled,
  TeamOptRequirementsUnmet,
  TeamOptSetRulesUnmet,
  TeamOptWorkerUnavailable,
  teamOptMembers,
  teamOptRotationForRun,
  teamOptSolver,
  useNumWorkers,
} from '@genshin-optimizer/gi/ui'
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { teamRunRotation } from './RotationWriter'
import { sameBuildRoster, teamRoster, teamRunKey } from './runScope'
import { inventoryRequirementsKey } from './useTeamOpt'

export type { TeamOptStatus } from '@genshin-optimizer/gi/ui'
export { initStatus, teamOptSolver } from '@genshin-optimizer/gi/ui'

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
      /** Ranking-only buffs for the inspector of a freshly computed result. */
      rankingBonusStats?: Partial<Record<CharacterKey, BonusStats>>
    }
  | {
      type: 'error'
      message: string
      /** The members no team build keeps to the allowed sets of (the run gave no result) */
      setRulesUnmet?: CharacterKey[]
      /** The members no team build gets to their minimums: each one they miss, and how far */
      requirementsUnmet?: Partial<Record<CharacterKey, TeamOptShortfall[]>>
    }

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
      let stopWorker: (() => void) | undefined
      const stop = () => {
        cancelled = true
        stopWorker?.()
        stopSolver?.()
      }
      cancelRef.current = stop
      const stopFollowing = database.teams.follow(teamId, () => {
        if (teamRoster(database, teamId) !== roster) stop()
      })
      let shown: (TeamOptRunState & { type: 'done' }) | undefined
      // its other builds done or stopped: the result as it is, saved (not over a newer run's)
      const settle = (found: TeamOptRunState & { type: 'done' }) => {
        const { optionsRunning: _, ...done } = found
        if (mine()) startTransition(() => setState(done, true))
        else {
          const last = lastRuns[key]
          if (last?.type === 'done' && last.savedAt === done.savedAt)
            lastRuns[key] = done
        }
      }
      const startTime = performance.now()
      Object.assign(status.current, initStatus(), { step: undefined })
      setState({ type: 'running', startTime })
      try {
        await nextPaint()
        if (cancelled) throw new TeamOptCancelled()
        const team = database.teams.get(teamId)
        const teamOpt = team?.teamOpt ?? initTeamOpt()
        const requirementsKey = inventoryRequirementsKey(database, teamId)
        const enemy = team && runEnemyOf(team)
        const show = (next: TeamOptRunState & { type: 'done' }) => {
          if (!mine() || cancelled || teamRoster(database, teamId) !== roster)
            return
          const first = !shown
          const found = { ...next, savedAt: shown?.savedAt ?? Date.now() }
          shown = found
          // Save the team immediately, then save the rankings together when the worker stops.
          startTransition(() => setState(found, first))
        }
        const job = {
          teamId,
          gender,
          teamOpt,
          rotation: teamRunRotation(database, gender, i18n, teamId),
          attackStates,
          rankingBonusStats,
          maxWorkers,
          lowImpact: window.matchMedia?.('(pointer: coarse)').matches ?? false,
        }
        const updates = {
          onResult: (result: TeamOptResult) =>
            show({
              type: 'done',
              roster,
              requirementsKey,
              result,
              seconds: (performance.now() - startTime) / 1000,
              teamOpt,
              rankingBonusStats,
              ...(enemy ? { enemy } : {}),
              ...(result.optimized.length ? { optionsRunning: true } : {}),
            }),
          onOptions: (ck: CharacterKey, options: TeamOptMemberOptions) => {
            if (!shown) return
            show({
              ...shown,
              result: {
                ...shown.result,
                options: { ...shown.result.options, [ck]: options },
              },
            })
          },
        }
        try {
          const worker = startTeamOptWorker(database, job, {
            ...updates,
            onProgress: (next) => {
              if (!cancelled && mine()) Object.assign(status.current, next)
            },
          })
          stopWorker = worker.stop
          await worker.done
        } catch (error) {
          if (!(error instanceof TeamOptWorkerUnavailable) || cancelled)
            throw error
          await runTeamOpt(
            database,
            job,
            status.current,
            updates,
            () => cancelled,
            (next) => {
              stopSolver = next
            }
          )
        }
        if (shown?.optionsRunning) settle(shown)
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
        else if (e instanceof TeamOptRequirementsUnmet)
          setState({
            type: 'error',
            message: e.message,
            requirementsUnmet: e.shortfalls,
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
        const replay = teamOptRotationForRun(database, {
          teamId,
          gender,
          teamOpt: run.teamOpt,
          rotation: run.result.writtenRotation,
        })
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
          rotationForWeapons: replay?.forWeapons,
          rotationKey: replay?.key,
          rankingBonusStats: run.rankingBonusStats,
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
