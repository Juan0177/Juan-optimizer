import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { KqmSearchCancelled, yieldTask } from '@genshin-optimizer/gi/solver'
import {
  type InvestJob,
  type InvestResult,
  runInvestmentJob,
} from './investmentWorker'
import type { KqmBuildSettings, KqmBuiltProblem } from './kqmBuild'
import { buildKqmProblem } from './kqmBuild'

/*
 * The KQM problems' builders (and parallel investment evaluators): a problem (`buildKqmProblem`)
 * or investment evaluation (`runInvestmentJob`) runs in a pool of workers, several at once, each
 * with a copy of the page's database (sent once per run, when it changed), so the page stays
 * smooth and runs use multiple CPU cores. Without workers (tests, or a worker that fails to load)
 * the same work runs here, one at a time.
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
  | {
      type: 'invest'
      id: number
      key: string
      job: InvestJob
    }
export type KqmBuildReply =
  | { type: 'built'; id: number; built?: KqmBuiltProblem }
  | { type: 'invested'; id: number; result?: InvestResult }
  | { type: 'missing'; id: number }
  | { type: 'error'; id: number; message: string }

/** A copy of the database for workers (`databaseSnapshot`) */
export interface Snapshot {
  key: string
  dbIndex: 1 | 2 | 3 | 4
  entries: Record<string, string>
}

/**
 * Scope for `databaseSnapshot`: trims unrelated teams, inventory artifacts, and cached run blobs
 * so workers stay compact and immune to volatile result writes.
 */
export interface SnapshotScope {
  /** Only include this team and the characters/loadouts/weapons/builds/optConfigs it references. */
  teamId?: string
  /**
   * Which artifacts to include when `teamId` is set:
   * - `'none'`: omit all `artifact_*`
   * - `'team'` (default): only artifacts equipped by `teamId` plus `extraArtifactIds`
   * - `'all'`: include every `artifact_*` in the database
   */
  artifacts?: 'none' | 'team' | 'all'
  /** Additional artifact IDs to include when `artifacts === 'team'` (e.g. saved run builds) */
  extraArtifactIds?: Iterable<string | undefined>
  /** Additional weapon IDs to include when `teamId` is set (e.g. saved run weapons) */
  extraWeaponIds?: Iterable<string | undefined>
  /** Include all characters, weapons, and builds (e.g. full Team Optimize with `useOtherChars`) */
  allEquipment?: boolean
}
interface BuildJob {
  kind: 'build'
  id: number
  database: ArtCharDatabase
  snapshot: Snapshot
  teamId: string
  gender: GenderKey
  settings: KqmBuildSettings
  isCancelled: () => boolean
  retried?: boolean
  resolve: (built: KqmBuiltProblem | undefined) => void
  reject: (e: unknown) => void
}
interface InvestPoolJob {
  kind: 'invest'
  id: number
  database: ArtCharDatabase
  snapshot: Snapshot
  job: InvestJob
  isCancelled: () => boolean
  retried?: boolean
  resolve: (result: InvestResult | undefined) => void
  reject: (e: unknown) => void
}
type PoolJob = BuildJob | InvestPoolJob

interface Slot {
  worker: Worker
  /** The database copy it has */
  key?: string
  job?: PoolJob
}

let slots: Slot[] = []
let failed = false
const queue: PoolJob[] = []
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | undefined
let inlineRunning = false
/** Recent snapshots per database keyed by content key (avoids cloning unchanged snapshots) */
const snapshotCache = new WeakMap<ArtCharDatabase, Map<string, Snapshot>>()
const SNAPSHOT_CACHE_MAX = 4

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
/**
 * Heavy investment evaluations run full rotation replays + KQM optimization inside each worker,
 * so cap concurrent investment workers to stay comfortably inside Chrome's shared 4 GB V8 cage
 * even when KQM build threads are manually raised to 6–8.
 */
function maxInvestWorkers() {
  const memory =
    (globalThis.navigator as { deviceMemory?: number } | undefined)
      ?.deviceMemory ?? 8
  return memory >= 8 ? 4 : memory >= 4 ? 2 : 1
}
function investPoolSize() {
  return Math.max(1, Math.min(poolSize(), maxInvestWorkers()))
}
const workersUsable = () => !failed && typeof Worker !== 'undefined'

/** How many investment evaluations can execute concurrently across the warm worker pool */
export function kqmInvestmentConcurrency() {
  return workersUsable() ? investPoolSize() : 1
}

function dropBuilders() {
  for (const slot of slots) slot.worker.terminate()
  slots = []
}

/** Terminate excess idle workers beyond `maxSlots` to immediately reclaim V8 cage memory. */
function trimIdleBuilders(maxSlots: number) {
  for (let i = slots.length - 1; i >= maxSlots; i--) {
    if (slots[i].job) continue
    slots[i].worker.terminate()
    slots.splice(i, 1)
  }
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

const EXCLUDED_SNAPSHOT_KEYS = new Set(['teamKqmResults', 'teamOptResults'])
const EXCLUDED_SNAPSHOT_PREFIXES = [
  'teamKqmRun_',
  'generatedBuildList_',
  'pandoGeneratedBuildList_',
  'pandoOptConfig_',
  'pandoTeam_',
  'display_',
]
function isExcludedSnapshotKey(key: string) {
  if (EXCLUDED_SNAPSHOT_KEYS.has(key)) return true
  for (const prefix of EXCLUDED_SNAPSHOT_PREFIXES)
    if (key.startsWith(prefix)) return true
  return false
}
/** Strip volatile `lastEdit` from `dbMeta` so saves to unrelated entries never bust worker DBs */
function normalizeSnapshotValue(key: string, value: string): string {
  if (key !== 'dbMeta') return value
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && 'lastEdit' in parsed)
      return JSON.stringify({ ...parsed, lastEdit: 0 })
  } catch {
    // keep raw value
  }
  return value
}
function isEquipmentKey(key: string) {
  return (
    key.startsWith('char_') ||
    key.startsWith('charMeta_') ||
    key.startsWith('weapon_') ||
    key.startsWith('build_') ||
    key.startsWith('buildTc_')
  )
}

function snapshotPairs(
  database: ArtCharDatabase,
  scope?: SnapshotScope
): [string, string][] {
  const teamId = scope?.teamId
  const team = teamId ? database.teams.get(teamId) : undefined
  if (!teamId || !team) {
    const out: [string, string][] = []
    for (const [k, v] of database.storage.entries) {
      if (isExcludedSnapshotKey(k)) continue
      out.push([k, normalizeSnapshotValue(k, v)])
    }
    return out
  }

  const artifacts = scope.artifacts ?? 'team'
  const needed = new Set<string>(['db_ver', 'dbIndex', 'dbMeta', teamId])
  const addId = (id: string | undefined) => {
    if (id) needed.add(id)
  }
  for (const loadoutDatum of team.loadoutData) {
    if (!loadoutDatum) continue
    addId(loadoutDatum.teamCharId)
    const teamChar = database.teamChars.get(loadoutDatum.teamCharId)
    if (teamChar) {
      addId(database.chars.toStorageKey(teamChar.key))
      addId(database.charMeta.toStorageKey(teamChar.key))
      addId(teamChar.optConfigId)
      const char = database.chars.get(teamChar.key)
      if (char) {
        addId(char.equippedWeapon)
        if (artifacts === 'team')
          for (const id of Object.values(char.equippedArtifacts)) addId(id)
      }
    }
    for (const buildId of [loadoutDatum.buildId, loadoutDatum.compareBuildId]) {
      if (!buildId) continue
      addId(buildId)
      const build = database.builds.get(buildId)
      if (build) {
        addId(build.weaponId)
        if (artifacts === 'team')
          for (const id of Object.values(build.artifactIds)) addId(id)
      }
    }
    addId(loadoutDatum.buildTcId)
    addId(loadoutDatum.compareBuildTcId)
    addId(database.teams.getLoadoutWeaponId(loadoutDatum))
    if (artifacts === 'team')
      for (const id of Object.values(
        database.teams.getLoadoutArtifactIds(loadoutDatum)
      ))
        addId(id)
  }
  if (scope.extraWeaponIds) for (const id of scope.extraWeaponIds) addId(id)
  if (artifacts === 'team' && scope.extraArtifactIds)
    for (const id of scope.extraArtifactIds) addId(id)

  const out: [string, string][] = []
  if (scope.allEquipment || artifacts === 'all') {
    for (const [k, v] of database.storage.entries) {
      if (isExcludedSnapshotKey(k)) continue
      if (
        needed.has(k) ||
        (scope.allEquipment && isEquipmentKey(k)) ||
        (artifacts === 'all' && k.startsWith('artifact_'))
      )
        out.push([k, normalizeSnapshotValue(k, v)])
    }
    return out
  }

  for (const k of [...needed].sort()) {
    const raw = database.storage.getString(k)
    if (raw !== undefined) out.push([k, normalizeSnapshotValue(k, raw)])
  }
  return out
}

/** The database as it is now, for workers (scoped and cached so unchanged snapshots are reused) */
export function databaseSnapshot(
  database: ArtCharDatabase,
  scope?: SnapshotScope
): Snapshot {
  const entries = snapshotPairs(database, scope)
  let h = 2166136261
  let size = 0
  for (const [k, v] of entries) {
    h = hash(k, h)
    h = hash(v, h)
    size += k.length + v.length
  }
  const key = `${database.dbIndex}:${scope?.teamId ?? '*'}:${entries.length}:${size}:${h}`
  let cache = snapshotCache.get(database)
  const hit = cache?.get(key)
  if (hit) return hit
  const next: Snapshot = {
    key,
    dbIndex: database.dbIndex,
    entries: Object.fromEntries(entries),
  }
  if (!cache) {
    cache = new Map()
    snapshotCache.set(database, cache)
  }
  cache.set(key, next)
  while (cache.size > SNAPSHOT_CACHE_MAX)
    cache.delete(cache.keys().next().value!)
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
  let copyTeamId: string | undefined
  return {
    build(
      teamId: string,
      gender: GenderKey,
      settings: KqmBuildSettings
    ): Promise<KqmBuiltProblem | undefined> {
      clearTimeout(idleTimer)
      if (!workersUsable())
        return inlineBuild(database, teamId, gender, settings, isCancelled)
      if (!copy || copyTeamId !== teamId) {
        copy = databaseSnapshot(database, { teamId, artifacts: 'team' })
        copyTeamId = teamId
      }
      const snapshot = copy
      return new Promise((resolve, reject) => {
        queue.push({
          kind: 'build',
          id: nextId++,
          database,
          snapshot,
          teamId,
          gender,
          settings,
          isCancelled,
          resolve,
          reject,
        })
        try {
          startBuilders(poolSize())
        } catch {
          failed = true
        }
        if (workersUsable()) dispatch()
        else void runInline()
      })
    },
  }
}

/**
 * Runs one KQM or Inventory investment evaluation on the warm worker pool (several in parallel
 * across CPU cores, 0ms main-thread blocking). Falls back inline in test environments.
 */
export function runInvestmentInPool(
  database: ArtCharDatabase,
  job: InvestJob,
  isCancelled: () => boolean = () => false
): Promise<InvestResult | undefined> {
  clearTimeout(idleTimer)
  if (!workersUsable()) return inlineInvest(database, job, isCancelled)
  const scope: SnapshotScope =
    job.mode === 'kqm'
      ? { teamId: job.teamId, artifacts: 'team' }
      : {
          teamId: job.teamId,
          artifacts: 'team',
          extraArtifactIds: Object.values(job.result.builds).flatMap((b) =>
            Object.values(b ?? {})
          ),
          extraWeaponIds: Object.values(job.result.weapons ?? {}),
        }
  const snapshot = databaseSnapshot(database, scope)
  return new Promise((resolve, reject) => {
    queue.push({
      kind: 'invest',
      id: nextId++,
      database,
      snapshot,
      job,
      isCancelled,
      resolve,
      reject,
    })
    try {
      const limit = investPoolSize()
      // Reclaim memory from excess idle KQM build workers (e.g. 8-thread KQM -> 4-thread invest)
      trimIdleBuilders(limit)
      startBuilders(limit)
    } catch {
      failed = true
    }
    if (workersUsable()) dispatch()
    else void runInline()
  })
}

function startBuilders(target = poolSize()) {
  while (slots.length < target) {
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

/** A builder failed (did not load): the work runs here */
function buildersBroke() {
  if (failed) return
  failed = true
  const running = slots.flatMap((s) => (s.job ? [s.job] : []))
  dropBuilders()
  queue.unshift(...running)
  void runInline()
}

function nextJob(allowInvest = true): PoolJob | undefined {
  for (let i = 0; i < queue.length; ) {
    const job = queue[i]
    if (job.isCancelled()) {
      queue.splice(i, 1)
      job.reject(new KqmSearchCancelled())
      continue
    }
    if (!allowInvest && job.kind === 'invest') {
      i++
      continue
    }
    queue.splice(i, 1)
    return job
  }
  return undefined
}

function send(slot: Slot, job: PoolJob) {
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
  if (job.kind === 'build') {
    slot.worker.postMessage({
      type: 'build',
      id: job.id,
      key: job.snapshot.key,
      teamId: job.teamId,
      gender: job.gender,
      settings: job.settings,
    } satisfies KqmBuildCommand)
  } else {
    slot.worker.postMessage({
      type: 'invest',
      id: job.id,
      key: job.snapshot.key,
      job: job.job,
    } satisfies KqmBuildCommand)
  }
}

/** Another tab or window in front: nothing is drawn, and a task queued to draw waits long */
const pageHidden = () => globalThis.document?.visibilityState === 'hidden'

function runJobInline(job: PoolJob) {
  if (job.kind === 'build') {
    return inlineBuild(
      job.database,
      job.teamId,
      job.gender,
      job.settings,
      job.isCancelled
    ).then(job.resolve, job.reject)
  }
  return inlineInvest(job.database, job.job, job.isCancelled).then(
    job.resolve,
    job.reject
  )
}

function dispatch() {
  const investCap = investPoolSize()
  let activeInvest = slots.filter((s) => s.job?.kind === 'invest').length
  for (const slot of slots) {
    if (slot.job) continue
    const job = nextJob(activeInvest < investCap)
    if (!job) break
    if (job.kind === 'invest') activeInvest++
    try {
      send(slot, job)
    } catch {
      // (settings a worker cannot be sent: that job runs here)
      slot.job = undefined
      if (job.kind === 'invest') activeInvest--
      void runJobInline(job)
    }
  }
  if (!queue.length && slots.every((s) => !s.job)) {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(dropBuilders, 30_000)
  }
}

function onReply(slot: Slot, reply: KqmBuildReply) {
  const job = slot.job
  slot.job = undefined
  if (!job || job.id !== reply.id) return dispatch()
  switch (reply.type) {
    case 'built':
      if (job.kind === 'build') job.resolve(reply.built)
      break
    case 'invested':
      if (job.kind === 'invest') job.resolve(reply.result)
      break
    case 'missing':
      // (it lost its copy: retry once, otherwise fall back inline to avoid an infinite IPC loop)
      slot.key = undefined
      if (!job.retried) {
        job.retried = true
        queue.unshift(job)
      } else {
        void runJobInline({ ...job, isCancelled: () => false })
      }
      break
    case 'error':
      // (as run here: the same error, or the result when only the worker failed)
      void runJobInline({ ...job, isCancelled: () => false })
      break
  }
  dispatch()
}

async function inlineBuild(
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

async function inlineInvest(
  database: ArtCharDatabase,
  job: InvestJob,
  isCancelled: () => boolean
) {
  if (!pageHidden()) await yieldTask()
  if (isCancelled()) throw new KqmSearchCancelled()
  return runInvestmentJob(database, job, isCancelled)
}

/** The queue run here, one at a time (the workers failed) */
async function runInline() {
  if (inlineRunning) return
  inlineRunning = true
  try {
    for (let job = nextJob(); job; job = nextJob()) {
      await runJobInline(job)
    }
  } finally {
    inlineRunning = false
  }
}
