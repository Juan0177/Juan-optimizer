import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { KqmSearchCancelled, yieldTask } from '@genshin-optimizer/gi/solver'
import type { KqmBuildSettings, KqmBuiltProblem } from './kqmBuild'
import { buildKqmProblem } from './kqmBuild'

/*
 * The KQM problems' builders: a problem (the team's damage as a function of one member's
 * artifacts, `buildKqmProblem`) takes ~0.1 s to build, and a run builds over a thousand. They are
 * built in a pool of workers, several at once, each with a copy of the page's database (sent
 * once per run, when it changed), so the page stays smooth and a run waits less. Without workers
 * (tests, or a worker that fails to load) the same problems are built here, one at a time.
 */

export type KqmBuildCommand =
  | {
      type: 'data'
      /** Which copy of the database it is (`snapshot`) */
      key: string
      dbIndex: 1 | 2 | 3 | 4
      entries: Record<string, string>
    }
  | {
      type: 'build'
      id: number
      key: string
      teamId: string
      gender: GenderKey
      settings: KqmBuildSettings
    }
export type KqmBuildReply =
  | { type: 'built'; id: number; built?: KqmBuiltProblem }
  | { type: 'missing'; id: number }
  | { type: 'error'; id: number; message: string }

/** A copy of the database for workers (`databaseSnapshot`) */
export interface Snapshot {
  key: string
  dbIndex: 1 | 2 | 3 | 4
  entries: Record<string, string>
}
interface Job {
  id: number
  database: ArtCharDatabase
  snapshot: Snapshot
  teamId: string
  gender: GenderKey
  settings: KqmBuildSettings
  isCancelled: () => boolean
  resolve: (built: KqmBuiltProblem | undefined) => void
  reject: (e: unknown) => void
}
interface Slot {
  worker: Worker
  /** The database copy it has */
  key?: string
  job?: Job
}

let slots: Slot[] = []
let failed = false
const queue: Job[] = []
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | undefined
let inlineRunning = false
/** The database's last copy (taken again when it changed) */
let last: { database: ArtCharDatabase; snapshot: Snapshot } | undefined

// Dev only: workers run the code they were started with, so drop them on hot replacement
// (this library is typed as CommonJS; the app's bundler and the tests load it as a module)
// @ts-expect-error TS1470
;(import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot?.dispose(
  () => dropBuilders()
)

const cores = () => globalThis.navigator?.hardwareConcurrency || 4
/** The most builders one can choose (the page and the searches need a core too) */
export const kqmBuildThreadsMax = () => Math.max(1, Math.min(cores() - 1, 8))
/**
 * The builders this device gets by default: the searches' workers run beside them, and each
 * builder holds the game data and a database copy (~190 MB at a run's peak), so fewer on a device
 * with less memory (in GB, as the browser rounds it)
 */
export function kqmBuildThreadsAuto() {
  const memory =
    (globalThis.navigator as { deviceMemory?: number } | undefined)
      ?.deviceMemory ?? 8
  const most = memory >= 8 ? 4 : memory >= 4 ? 2 : 1
  return Math.max(1, Math.min(cores() - 2, most))
}
const THREADS_KEY = 'kqm_build_threads'
/** The builders chosen on this device (undefined: `kqmBuildThreadsAuto`) */
export function kqmBuildThreads(): number | undefined {
  try {
    const n = Number(globalThis.localStorage?.getItem(THREADS_KEY))
    return Number.isInteger(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}
/** Chooses the builders on this device (undefined: automatic); the next run uses them */
export function setKqmBuildThreads(threads: number | undefined) {
  try {
    if (threads === undefined) globalThis.localStorage?.removeItem(THREADS_KEY)
    else globalThis.localStorage?.setItem(THREADS_KEY, String(threads))
  } catch {
    // (no storage: automatic)
  }
  // (idle ones are replaced at the next run; a run going on keeps its own)
  if (!queue.length && slots.every((s) => !s.job)) dropBuilders()
}
function poolSize() {
  return Math.min(
    kqmBuildThreadsMax(),
    kqmBuildThreads() ?? kqmBuildThreadsAuto()
  )
}
const workersUsable = () => !failed && typeof Worker !== 'undefined'

function dropBuilders() {
  for (const slot of slots) slot.worker.terminate()
  slots = []
}

/** Ends the builders once a run is over, after `afterMs` unused (what they hold is large) */
export function releaseKqmBuilders(afterMs = 0) {
  clearTimeout(idleTimer)
  if (queue.length || slots.some((s) => s.job))
    idleTimer = setTimeout(() => releaseKqmBuilders(afterMs), 1000)
  else if (afterMs > 0) idleTimer = setTimeout(dropBuilders, afterMs)
  else dropBuilders()
}

/** A string's FNV-1a hash, continued from `h` */
function hash(text: string, h: number) {
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The database as it is now, for workers (the last copy when nothing changed) */
export function databaseSnapshot(database: ArtCharDatabase): Snapshot {
  const entries = database.storage.entries
  let h = 2166136261
  let size = 0
  for (const [k, v] of entries) {
    h = hash(k, h)
    h = hash(v, h)
    size += k.length + v.length
  }
  const key = `${database.dbIndex}:${entries.length}:${size}:${h}`
  if (last?.database === database && last.snapshot.key === key)
    return last.snapshot
  const next: Snapshot = {
    key,
    dbIndex: database.dbIndex,
    entries: Object.fromEntries(entries),
  }
  last = { database, snapshot: next }
  return next
}

/**
 * A run's problem builder: `build` gives a problem as `buildKqmProblem` would here, built in a
 * worker. The database is copied when the first problem is asked for.
 */
export function kqmProblemBuilder(
  database: ArtCharDatabase,
  isCancelled: () => boolean
) {
  let copy: Snapshot | undefined
  return {
    build(
      teamId: string,
      gender: GenderKey,
      settings: KqmBuildSettings
    ): Promise<KqmBuiltProblem | undefined> {
      clearTimeout(idleTimer)
      if (!workersUsable())
        return inline(database, teamId, gender, settings, isCancelled)
      copy ??= databaseSnapshot(database)
      return new Promise((resolve, reject) => {
        queue.push({
          id: nextId++,
          database,
          snapshot: copy!,
          teamId,
          gender,
          settings,
          isCancelled,
          resolve,
          reject,
        })
        try {
          startBuilders()
        } catch {
          failed = true
        }
        if (workersUsable()) dispatch()
        else runInline()
      })
    },
  }
}

function startBuilders() {
  if (slots.length) return
  for (let i = 0; i < poolSize(); i++) {
    const slot: Slot = {
      // @ts-expect-error TS1470 (as above: loaded as a module)
      worker: new Worker(new URL('./kqmBuildWorker.ts', import.meta.url), {
        type: 'module',
      }),
    }
    slot.worker.onmessage = ({ data }: MessageEvent<KqmBuildReply>) =>
      onReply(slot, data)
    slot.worker.onerror = (e) => {
      e.preventDefault?.()
      buildersBroke()
    }
    slots.push(slot)
  }
}

/** A builder failed (did not load): the problems are built here */
function buildersBroke() {
  if (failed) return
  failed = true
  const running = slots.flatMap((s) => (s.job ? [s.job] : []))
  dropBuilders()
  queue.unshift(...running)
  runInline()
}

function nextJob(): Job | undefined {
  while (queue.length) {
    const job = queue.shift()!
    if (!job.isCancelled()) return job
    job.reject(new KqmSearchCancelled())
  }
  return undefined
}

function send(slot: Slot, job: Job) {
  slot.job = job
  if (slot.key !== job.snapshot.key) {
    const { key, dbIndex, entries } = job.snapshot
    slot.worker.postMessage({
      type: 'data',
      key,
      dbIndex,
      entries,
    } satisfies KqmBuildCommand)
    slot.key = key
  }
  slot.worker.postMessage({
    type: 'build',
    id: job.id,
    key: job.snapshot.key,
    teamId: job.teamId,
    gender: job.gender,
    settings: job.settings,
  } satisfies KqmBuildCommand)
}

/** Another tab or window in front: nothing is drawn, and a task queued to draw waits long */
const pageHidden = () => globalThis.document?.visibilityState === 'hidden'

function dispatch() {
  for (const slot of slots) {
    if (slot.job) continue
    const job = nextJob()
    if (!job) break
    try {
      send(slot, job)
    } catch {
      // (settings a worker cannot be sent: that problem is built here)
      slot.job = undefined
      inline(
        job.database,
        job.teamId,
        job.gender,
        job.settings,
        job.isCancelled
      ).then(job.resolve, job.reject)
    }
  }
}

function onReply(slot: Slot, reply: KqmBuildReply) {
  const job = slot.job
  slot.job = undefined
  if (!job || job.id !== reply.id) return dispatch()
  switch (reply.type) {
    case 'built':
      job.resolve(reply.built)
      break
    case 'missing':
      // (it lost its copy: sent again)
      slot.key = undefined
      queue.unshift(job)
      break
    case 'error':
      // (as built here: the same error, or the problem when only the worker failed)
      inline(
        job.database,
        job.teamId,
        job.gender,
        job.settings,
        () => false
      ).then(job.resolve, job.reject)
      break
  }
  dispatch()
}

/**
 * Builds a problem here, after letting the page draw (not when hidden: a hidden page's queued
 * tasks wait long, and nothing is drawn then)
 */
async function inline(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  settings: KqmBuildSettings,
  isCancelled: () => boolean
) {
  if (!pageHidden()) await yieldTask()
  if (isCancelled()) throw new KqmSearchCancelled()
  return buildKqmProblem(database, teamId, gender, settings)
}

/** The queue built here, one at a time (the workers failed) */
async function runInline() {
  if (inlineRunning) return
  inlineRunning = true
  try {
    for (let job = nextJob(); job; job = nextJob()) {
      const current = job
      await inline(
        current.database,
        current.teamId,
        current.gender,
        current.settings,
        current.isCancelled
      ).then(current.resolve, current.reject)
    }
  } finally {
    inlineRunning = false
  }
}
