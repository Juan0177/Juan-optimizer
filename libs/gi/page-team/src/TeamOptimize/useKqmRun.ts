import type { GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamKqmRunSummary,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { nextPaint } from '@genshin-optimizer/gi/solver'
import type {
  KqmResult,
  KqmStep,
  RunAttackState,
  RunEnemy,
} from '@genshin-optimizer/gi/ui'
import {
  optimizeTeamKqm,
  runEnemyOf,
  TeamOptCancelled,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import {
  startTransition,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { RotationTimingSettings } from './RotationTiming'
import { kqmEnemyTeam } from '../Enemy/enemyScope'
import { keptTeammates, kqmSharedKey } from './kqmVersions'
import {
  kqmRotationId,
  kqmRotationReplay,
  savedPlayedRotationKey,
} from './RotationWriter'
import { sameBuildRoster, teamRoster, teamRunKey } from './runScope'
import { kqmRotationView, kqmRunKey } from './useTeamOpt'

export type KqmRunState =
  | { type: 'idle' }
  | {
      type: 'running'
      startTime: number
      /** The builds found so far, while the run looks for better ones (`onEarly`) */
      early?: KqmDoneRun
    }
  | KqmDoneRun
  | { type: 'error'; message: string }
/** A run's result */
export interface KqmDoneRun {
  type: 'done'
  result: KqmResult
  roster?: string
  seconds: number
  /** The settings it was run with, as set (what "changed since" compares with) */
  teamOpt: TeamOpt
  /** The enemy it was found for (the team's then); absent: found before this was kept */
  enemy?: RunEnemy
  /**
   * The settings its damage is for: the written rotation as KQM played it for these builds
   * (`played`: at the KQM constellations, with their weapons and sets, the last 2 of 4
   * rotations), or the attacks entered, nothing being written (`entered`)
   */
  runTeamOpt: TeamOpt
  rotation: 'played' | 'entered'
  /** What each rotation waited for to be ready (seconds), when played as KQM plays it */
  stalls?: { label: string; seconds: number }[]
  /** When it was found: which saved run it is (`database.teamKqmResults`) */
  savedAt?: number
  /** When its run started, in this visit (its early builds and its result are the same run's) */
  startTime?: number
}

/**
 * The last KQM result per team, so that it is still there after visiting another page (one object
 * per result: views cache their work by it). Also saved in the database, for after a reload.
 */
const lastRuns: Record<string, KqmRunState> = {}
type KqmDone = Extract<KqmRunState, { type: 'done' }>

const memberKeys = (database: ArtCharDatabase, teamId: string) =>
  teamOptMembers(database, teamId).map((m) => m.characterKey as string)

/**
 * The team's last result: of this visit, else the saved one (`database.teamKqmResults`) while the
 * team has the same members. One that no longer fits is forgotten.
 */
function lastRun(database: ArtCharDatabase, teamId: string): KqmRunState {
  const key = teamRunKey(database, teamId)
  const members = memberKeys(database, teamId)
  const fits = (run: KqmDone) =>
    sameBuildRoster(run.result.builds, members) &&
    (run.roster === undefined || run.roster === teamRoster(database, teamId))
  const cached = lastRuns[key]
  if (cached?.type === 'done' && !fits(cached)) delete lastRuns[key]
  if (!lastRuns[key]) {
    const saved = database.teamKqmResults.getRun(teamId)
    const run = saved?.run as unknown as Partial<KqmDone> | undefined
    if (
      saved &&
      run?.type === 'done' &&
      run.result &&
      run.teamOpt &&
      saved.members.length === members.length &&
      saved.members.every((member) => members.includes(member)) &&
      fits(run as KqmDone)
    )
      lastRuns[key] = {
        ...(run as KqmDone),
        runTeamOpt: run.runTeamOpt ?? run.teamOpt,
        rotation: run.rotation ?? 'entered',
        savedAt: saved.savedAt,
      }
    else if (saved) database.teamKqmResults.setRun(teamId, undefined)
  }
  return lastRuns[key] ?? { type: 'idle' }
}

/**
 * Per team, the team as KQM Theorycrafting's results show it with other equipment picked in the
 * inspector (in this visit): shown so again when the page comes back
 */
const shownViews: Record<string, { result: KqmResult; view: KqmResult }> = {}

/** The team as its results show it now: `result` with the picks (undefined: the run's own) */
export function setKqmShownView(
  teamId: string,
  result: KqmResult,
  view: KqmResult | undefined
) {
  if (view && view !== result) shownViews[teamId] = { result, view }
  else if (shownViews[teamId]?.result === result) delete shownViews[teamId]
}

/** The team as `result`'s results were last shown, with picks (undefined: the run's own) */
export function kqmShownFor(
  teamId: string,
  result: KqmResult
): KqmResult | undefined {
  const shown = shownViews[teamId]
  return shown?.result === result ? shown.view : undefined
}

/*
 * A run's progress, per team, outside React state: a run reports many times a second, and only
 * the progress line reads it (at most every `PROGRESS_MS`), not the whole page
 */
const PROGRESS_MS = 120
const progress = new Map<string, KqmStep | undefined>()
const listeners = new Map<string, Set<() => void>>()
const pending = new Set<string>()
function setProgress(teamId: string, step: KqmStep | undefined) {
  progress.set(teamId, step)
  if (pending.has(teamId)) return
  pending.add(teamId)
  setTimeout(() => {
    pending.delete(teamId)
    for (const l of listeners.get(teamId) ?? []) l()
  }, PROGRESS_MS)
}
/**
 * The team's KQM run progress (updated a few times a second). State, not an external store: a
 * store's update renders at once, and would restart the page's render of new results every time
 */
export function useKqmProgress(teamId: string) {
  const key = teamRunKey(useDatabase(), teamId)
  const [step, setStep] = useState(() => progress.get(key))
  useEffect(() => {
    const onChange = () => setStep(progress.get(key))
    onChange()
    const set = listeners.get(key) ?? new Set()
    listeners.set(key, set)
    set.add(onChange)
    return () => {
      set.delete(onChange)
    }
  }, [key])
  return step
}

/*
 * Runs in progress, per team, outside the page: one goes on when its tab, the page or the window
 * is left (only Cancel stops it), and the page shows it again when it comes back
 */
interface KqmJob {
  state: Extract<KqmRunState, { type: 'running' }>
  cancelled: boolean
}
const jobs = new Map<string, KqmJob>()
const runListeners = new Map<string, Set<() => void>>()
function notifyRun(teamId: string) {
  for (const l of runListeners.get(teamId) ?? []) l()
}
function subscribeRun(teamId: string, onChange: () => void) {
  const set = runListeners.get(teamId) ?? new Set()
  runListeners.set(teamId, set)
  set.add(onChange)
  return () => {
    set.delete(onChange)
  }
}
/** The team's run in progress, else its last result */
const runState = (database: ArtCharDatabase, teamId: string): KqmRunState =>
  jobs.get(teamRunKey(database, teamId))?.state ?? lastRun(database, teamId)

/** What a run started with: the settings a version shares with its original, and its rotation */
interface KqmRunStart {
  settings: string
  rotation: string
}
/** A finished run in brief, for KQM versions (`TeamKqmRunSummary`) */
function runSummary(
  database: ArtCharDatabase,
  teamId: string,
  run: KqmDoneRun,
  savedAt: number,
  start: KqmRunStart
): TeamKqmRunSummary {
  const { after, builds } = run.result
  const time = run.runTeamOpt.rotationTime
  const calculator = run.teamOpt.kqm?.energyCalculator
  return {
    savedAt,
    members: memberKeys(database, teamId),
    total: after.total,
    memberTotals: Object.fromEntries(
      Object.entries(after.members).flatMap(([k, v]) =>
        typeof v === 'number' && Number.isFinite(v) ? [[k, v]] : []
      )
    ),
    er: Object.fromEntries(
      Object.entries(run.result.energyRecharge).flatMap(([k, e]) =>
        e && Number.isFinite(e.minimum) ? [[k, e.minimum]] : []
      )
    ),
    // (the ER calculator's field time, of the rotation as played)
    ...(time !== undefined
      ? {
          field: Object.fromEntries(
            Object.entries(calculator?.members ?? {}).flatMap(([k, m]) =>
              m && Number.isFinite(m.fieldTime)
                ? [[k, (m.fieldTime / 100) * time]]
                : []
            )
          ),
          rotationTime: time,
        }
      : {}),
    gear: Object.fromEntries(
      Object.entries(builds).flatMap(([k, b]) =>
        b
          ? [
              [
                k,
                {
                  weapon: b.weapon.key,
                  refinement: b.weapon.refinement,
                  sets: Object.fromEntries(
                    Object.entries(b.sets).filter(([, n]) => !!n)
                  ) as Record<string, number>,
                },
              ],
            ]
          : []
      )
    ),
    ...start,
  }
}

/** Keeps a finished run's state: the last result (saved once the page shows it), or its error */
function keep(
  database: ArtCharDatabase,
  teamId: string,
  s: KqmRunState,
  start?: KqmRunStart
) {
  // (a new result: when it was found says which saved one it is)
  const next: KqmRunState =
    s.type === 'done' && s.savedAt === undefined
      ? { ...s, savedAt: Date.now() }
      : s
  const key = teamRunKey(database, teamId)
  lastRuns[key] = next
  // a new result replaces the saved one (an error keeps it), after the page shows it: saving
  // copies the whole result
  if (
    next.type === 'done' &&
    database.teamKqmResults.get().runs[teamId]?.savedAt !== next.savedAt
  )
    setTimeout(() => {
      // (discarded or replaced meanwhile: not saved)
      if (
        lastRuns[key] !== next ||
        !database.teams.get(teamId) ||
        next.roster !== teamRoster(database, teamId)
      )
        return
      const { savedAt, ...run } = next
      database.teamKqmResults.setRun(teamId, {
        savedAt: savedAt!,
        members: memberKeys(database, teamId),
        run: run as never,
      })
      if (start)
        database.teamKqmResults.setSummary(
          teamId,
          runSummary(database, teamId, next, savedAt!, start)
        )
    }, 0)
}

/**
 * A rotation played in place of the team's written one (KQM Compare's team B: its own, the
 * entering member's actions in it), every part given: nothing read from the team's storage
 */
export interface KqmRotation {
  text: string
  opener: string
  timing: RotationTimingSettings
}

/**
 * The written rotation, played by KQM theorycrafting itself (never with the members' own
 * constellations or gear): at the KQM constellations, with the builds' weapons and sets. For a run
 * and for the inspector's comparisons. Nothing written (or it can't be read): undefined.
 */
export function kqmReplayOf(
  database: ArtCharDatabase,
  gender: GenderKey,
  i18n: i18n,
  teamId: string,
  teamOpt: TeamOpt,
  /** Another rotation to play (one constellation's own); absent: the team's written one */
  text?: string,
  /** Another opener to play before it; absent: the team's written one */
  opener?: string,
  /** Other timing settings (frame edits, swap time); absent: the team's own */
  timing?: RotationTimingSettings
) {
  try {
    const members = teamOptMembers(database, teamId)
    return kqmRotationReplay({
      text,
      opener,
      timing,
      database,
      teamId,
      members,
      gender,
      names: members.map(({ characterKey }) => ({
        characterKey,
        name: i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        ),
      })),
      teamOpt,
    })
  } catch (e) {
    console.error(e)
    return undefined
  }
}

/** Runs KQM theorycrafting for a team, in the background of whichever page is shown */
export async function startKqmRun(
  database: ArtCharDatabase,
  gender: GenderKey,
  i18n: i18n,
  teamId: string,
  teamOpt: TeamOpt,
  /** States every played attack gets (e.g. Wolf's Gravestone's uptime against the enemy) */
  attackStates?: readonly RunAttackState[]
) {
  const key = teamRunKey(database, teamId)
  const roster = teamRoster(database, teamId)
  const start: KqmRunStart = {
    settings: kqmSharedKey(database, teamId),
    rotation: savedPlayedRotationKey(database, kqmRotationId(teamId)),
  }
  // (a run already going for the team is replaced)
  const previous = jobs.get(key)
  if (previous) previous.cancelled = true
  const job: KqmJob = {
    state: { type: 'running', startTime: performance.now() },
    cancelled: false,
  }
  jobs.set(key, job)
  setProgress(key, undefined)
  notifyRun(key)
  const isCancelled = () => job.cancelled
  const stopFollowing = database.teams.follow(teamId, () => {
    if (teamRoster(database, teamId) !== roster) job.cancelled = true
  })
  const end = (s?: KqmRunState) => {
    stopFollowing()
    if (jobs.get(key) !== job) return
    if (s) keep(database, teamId, s, start)
    jobs.delete(key)
    notifyRun(key)
  }
  // (the enemy its damage is for, as it is now)
  const team = database.teams.get(teamId)
  const enemy = team && runEnemyOf(kqmEnemyTeam(team))
  const doneOf = (result: KqmResult): KqmDoneRun => {
    const { played } = result
    return {
      type: 'done',
      roster,
      result,
      seconds: (performance.now() - job.state.startTime) / 1000,
      teamOpt,
      ...(enemy ? { enemy } : {}),
      runTeamOpt: played
        ? {
            ...teamOpt,
            attacks: played.attacks,
            rotationTime: played.rotationTime ?? teamOpt.rotationTime,
          }
        : teamOpt,
      rotation: played ? 'played' : 'entered',
      stalls: played?.stalls,
      startTime: job.state.startTime,
    }
  }
  // (the running state paints before the first problem is built; a hidden page goes on at once)
  await nextPaint()
  try {
    if (isCancelled()) return end()
    // (a version that keeps its teammates' gear: from its original's builds, the changed members
    // searched)
    const kept = keptTeammates(database, teamId)
    if (kept === 'noOriginalRun')
      return end({
        type: 'error',
        message: i18n.t('page_team:teamOpt.run.keepNeedsOriginal', {
          defaultValue:
            "Run the original first: this version keeps its teammates' gear from the original's result.",
        }),
      })
    const replay = kqmReplayOf(database, gender, i18n, teamId, teamOpt)
    const result = await optimizeTeamKqm({
      database,
      teamId,
      gender,
      teamOpt,
      replay,
      attackStates,
      ...(kept ? { ...kept, searchOnly: true } : {}),
      isCancelled,
      onStep: (step) => {
        if (jobs.get(key) === job && !isCancelled()) setProgress(key, step)
      },
      onEarly: (early) => {
        if (isCancelled() || jobs.get(key) !== job) return
        job.state = { ...job.state, early: doneOf(early) }
        notifyRun(key)
      },
    })
    if (isCancelled() || teamRoster(database, teamId) !== roster) return end()
    if (!result)
      return end({
        type: 'error',
        message: i18n.t('page_team:teamOpt.run.allMembersKept', {
          defaultValue: 'Every member is kept: nothing to optimize.',
        }),
      })
    end(doneOf(result))
  } catch (e) {
    if (e instanceof TeamOptCancelled) return end()
    console.error(e)
    end({ type: 'error', message: String((e as Error)?.message ?? e) })
  }
}

/**
 * A team's run in brief from its saved run (one found before runs were kept in brief), when it is
 * still for the team's KQM settings, rotation and members now; none otherwise
 */
export function savedRunSummary(
  database: ArtCharDatabase,
  teamId: string
): TeamKqmRunSummary | undefined {
  const saved = database.teamKqmResults.getRun(teamId)
  const run = saved?.run as unknown as KqmDoneRun | undefined
  const stored = database.teams.get(teamId)?.teamOpt
  if (!saved || run?.type !== 'done' || !run.result || !run.teamOpt || !stored)
    return undefined
  const now = kqmRotationView(
    stored.assumeMaxMain ? { ...stored, assumeMaxMain: false } : stored
  )
  const rotation = savedPlayedRotationKey(database, kqmRotationId(teamId))
  const members = memberKeys(database, teamId)
  if (
    kqmRunKey(run.teamOpt) !== kqmRunKey(now) ||
    (run.rotation === 'played') !== !!rotation ||
    saved.members.length !== members.length ||
    !saved.members.every((m) => members.includes(m))
  )
    return undefined
  return runSummary(
    database,
    teamId,
    { ...run, runTeamOpt: run.runTeamOpt ?? run.teamOpt },
    saved.savedAt,
    { settings: kqmSharedKey(database, teamId), rotation }
  )
}

/** Stops a team's KQM run in progress, from any page */
export function cancelKqmRun(database: ArtCharDatabase, teamId: string) {
  const job = jobs.get(teamRunKey(database, teamId))
  if (job) job.cancelled = true
}

/** Whether a KQM run of the team is in progress (also while another page is shown) */
export function useKqmRunning(teamId: string) {
  const key = teamRunKey(useDatabase(), teamId)
  const subscribe = useCallback(
    (onChange: () => void) => subscribeRun(key, onChange),
    [key]
  )
  return useSyncExternalStore(subscribe, () => jobs.has(key))
}

/** A KQM mode run of the team (`optimizeTeamKqm`): its state, start, cancel and discard */
export function useKqmRun(teamId: string) {
  const database = useDatabase()
  const key = teamRunKey(database, teamId)
  const { gender } = useDBMeta()
  const { i18n } = useTranslation('charNames_gen')
  const [state, setState] = useState<KqmRunState>(() =>
    runState(database, teamId)
  )
  const activeRoster = teamRoster(database, teamId)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a roster change also invalidates the mounted result
  useEffect(() => {
    setState(runState(database, teamId))
    return subscribeRun(key, () => {
      const next = runState(database, teamId)
      // (the results are a big render: interruptible, so the page does not freeze)
      if (next.type === 'done' || (next.type === 'running' && next.early))
        startTransition(() => setState(next))
      else setState(next)
    })
  }, [database, teamId, key, activeRoster])

  const run = useCallback(
    (teamOpt: TeamOpt, attackStates?: readonly RunAttackState[]) =>
      startKqmRun(database, gender, i18n, teamId, teamOpt, attackStates),
    [database, gender, i18n, teamId]
  )
  const cancel = useCallback(() => {
    const job = jobs.get(key)
    if (job) job.cancelled = true
  }, [key])
  const clear = useCallback(() => {
    delete lastRuns[key]
    database.teamKqmResults.setRun(teamId, undefined)
    database.teamKqmResults.setSummary(teamId, undefined)
    notifyRun(key)
  }, [database, teamId, key])
  const previous = lastRuns[key]
  const lastResult = previous?.type === 'done' ? previous : undefined
  return { state, run, cancel, clear, lastResult }
}
