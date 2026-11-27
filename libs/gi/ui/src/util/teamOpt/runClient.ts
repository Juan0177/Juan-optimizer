import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { databaseSnapshot } from './kqmBuildPool'
import type { TeamOptStatus } from './runSolver'
import type { TeamOptRunJob, TeamOptRunUpdates } from './runTeam'
import type {
  TeamOptGearComparison,
  TeamOptMemberOptions,
  TeamOptResult,
  TeamOptShortfall,
} from './solve'
import {
  TeamOptCancelled,
  TeamOptRequirementsUnmet,
  TeamOptSetRulesUnmet,
} from './solve'

export type TeamOptWorkerRequest = TeamOptRunJob & {
  dbIndex: ArtCharDatabase['dbIndex']
  entries: Record<string, string>
  visible?: boolean
}

export type TeamOptWorkerMessage =
  | TeamOptWorkerRequest
  | { type: 'visibility'; visible: boolean }

export type TeamOptWorkerReply =
  | { type: 'ready' }
  | { type: 'progress'; status: TeamOptStatus }
  | { type: 'result'; result: TeamOptResult }
  | {
      type: 'options' | 'setOptions'
      characterKey: CharacterKey
      options: TeamOptMemberOptions
    }
  | { type: 'gearComparisons'; comparisons: TeamOptGearComparison[] }
  | { type: 'done' }
  | { type: 'unavailable'; message: string }
  | {
      type: 'requirements'
      shortfalls: Partial<Record<CharacterKey, TeamOptShortfall[]>>
    }
  | { type: 'sets'; characterKeys: CharacterKey[] }
  | { type: 'error'; message: string }

export class TeamOptWorkerUnavailable extends Error {}

/** Keep one finished worker warm across consecutive runs (memo, GPU device, pipelines, solver pool). */
const IDLE_WORKER_MS = 120_000
let pooledWorker: Worker | undefined
let pooledTimer: ReturnType<typeof setTimeout> | undefined

function takeWorker(): Worker {
  clearTimeout(pooledTimer)
  pooledTimer = undefined
  if (pooledWorker) {
    const w = pooledWorker
    pooledWorker = undefined
    return w
  }
  // @ts-expect-error TS1470: the app's bundler loads this library as a module.
  return new Worker(new URL('./teamOptWorker.ts', import.meta.url), {
    type: 'module',
  })
}

function releaseWorker(worker: Worker) {
  worker.onmessage = null
  worker.onerror = null
  worker.onmessageerror = null
  if (pooledWorker) pooledWorker.terminate()
  pooledWorker = worker
  clearTimeout(pooledTimer)
  pooledTimer = setTimeout(() => {
    pooledWorker?.terminate()
    pooledWorker = undefined
    pooledTimer = undefined
  }, IDLE_WORKER_MS)
}

/** Drop any pooled worker immediately (used by tests and hot module replacement). */
export function disposeTeamOptWorkerPool() {
  clearTimeout(pooledTimer)
  pooledTimer = undefined
  pooledWorker?.terminate()
  pooledWorker = undefined
}
// @ts-expect-error TS1470: the app's bundler loads this library as a module.
;(import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot?.dispose(
  disposeTeamOptWorkerPool
)

/** One worker prepares, searches and ranks a run. Stopping it also stops its solver workers. */
export function startTeamOptWorker(
  database: ArtCharDatabase,
  job: TeamOptRunJob,
  {
    onResult,
    onOptions,
    onSetOptions,
    onGearComparisons,
    onProgress,
  }: TeamOptRunUpdates & { onProgress: (status: TeamOptStatus) => void }
) {
  let worker: Worker
  try {
    worker = takeWorker()
  } catch {
    throw new TeamOptWorkerUnavailable('Could not start Team Optimize worker')
  }
  let finish: (error?: Error, keepWarm?: boolean) => void
  const done = new Promise<void>((resolve, reject) => {
    let ready = false
    let finished = false
    const startup = setTimeout(
      () =>
        finish(
          new TeamOptWorkerUnavailable('Team Optimize worker did not start')
        ),
      30000
    )
    const onVisChange = () => {
      if (finished || typeof document === 'undefined') return
      try {
        worker.postMessage({
          type: 'visibility',
          visible: document.visibilityState === 'visible',
        } satisfies TeamOptWorkerMessage)
      } catch {}
    }
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', onVisChange)
    finish = (error, keepWarm = false) => {
      if (finished) return
      finished = true
      clearTimeout(startup)
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisChange)
      if (keepWarm) releaseWorker(worker)
      else worker.terminate()
      if (error) reject(error)
      else resolve()
    }
    worker.onerror = (event) => {
      event.preventDefault()
      const message = event.message || 'Team Optimize worker failed'
      finish(ready ? new Error(message) : new TeamOptWorkerUnavailable(message))
    }
    worker.onmessageerror = () =>
      finish(new Error('Could not read Team Optimize result'))
    worker.onmessage = ({ data }: MessageEvent<TeamOptWorkerReply>) => {
      if (finished) return
      switch (data.type) {
        case 'ready':
          ready = true
          clearTimeout(startup)
          break
        case 'progress':
          onProgress(data.status)
          break
        case 'result':
          onResult(data.result)
          break
        case 'options':
          onOptions(data.characterKey, data.options)
          break
        case 'setOptions':
          onSetOptions?.(data.characterKey, data.options)
          break
        case 'gearComparisons':
          onGearComparisons?.(data.comparisons)
          break
        case 'done':
          finish(undefined, true)
          break
        case 'unavailable':
          finish(new TeamOptWorkerUnavailable(data.message))
          break
        case 'requirements':
          finish(new TeamOptRequirementsUnmet(data.shortfalls), true)
          break
        case 'sets':
          finish(new TeamOptSetRulesUnmet(data.characterKeys), true)
          break
        case 'error':
          finish(new Error(data.message))
          break
      }
    }
    try {
      const { entries } = databaseSnapshot(database, {
        teamId: job.teamId,
        artifacts: 'all',
        allEquipment: true,
      })
      worker.postMessage({
        ...job,
        dbIndex: database.dbIndex,
        entries,
        visible:
          typeof document === 'undefined'
            ? true
            : document.visibilityState === 'visible',
      } satisfies TeamOptWorkerRequest)
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
  return { done, stop: () => finish(new TeamOptCancelled(), false) }
}
