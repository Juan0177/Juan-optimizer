import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { yieldTask } from '@genshin-optimizer/gi/solver'
import type { KqmResult } from './kqm'
import { kqmSimGear, kqmTeamOverrides } from './kqm'
import type { Snapshot } from './kqmBuildPool'
import { databaseSnapshot } from './kqmBuildPool'
import type {
  FrameData,
  RotationMember,
  RotationTimingSettings,
} from './rotation'
import type { RotationScore, RotationScorer } from './rotationSearch'
import type { RotationSearchSetup } from './rotationSearchScore'
import { rotationScorer } from './rotationSearchScore'

/*
 * A rotation search plays thousands of rotations (~40 ms each), so they are played in a pool of
 * workers, each with a copy of the page's database and its own player (`rotationScorer`, whose
 * kept stats and damage then serve the rotations it plays). Rotations go out in runs of a few in
 * a row: the edits of one rotation are alike, so a worker's kept work serves them best. Without
 * workers (tests, or one that fails to load) they are played here, one at a time.
 */

export type RotationSearchCommand =
  | ({ type: 'data' } & Snapshot)
  | { type: 'setup'; key: string; setup: RotationSearchSetup }
  | { type: 'play'; id: number; key: string; dataKey: string; texts: string[] }
export type RotationSearchReply =
  | { type: 'played'; id: number; scores: (RotationScore | undefined)[] }
  | { type: 'missing'; id: number }
  | { type: 'error'; id: number; message: string }

/** The builds a KQM rotation search plays with: a KQM result's, as they played the rotation */
export type RotationSearchBase = Pick<
  KqmResult,
  'builds' | 'constellations' | 'played'
>

/**
 * A KQM rotation search's setup: the KQM tab's saved opener, timing and frame data, and `base`'s
 * builds as the KQM tab plays the rotation with them
 */
export function kqmRotationSearchSetup(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  names: RotationMember[],
  teamOpt: TeamOpt,
  base: RotationSearchBase,
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
): RotationSearchSetup {
  return {
    teamId,
    gender,
    names,
    teamOpt,
    ...saved,
    constellations: base.constellations,
    gear: Object.fromEntries(
      Object.entries(base.builds).map(([k, b]) => [k, kqmSimGear(b!)])
    ) as Partial<Record<CharacterKey, ReturnType<typeof kqmSimGear>>>,
    overrides: kqmTeamOverrides(database, teamId, teamOpt, base),
  }
}

/** Rotations sent to a worker at once */
const RUN = 6

const cores = () => globalThis.navigator?.hardwareConcurrency || 4
/**
 * Workers for a search: every core but the page's, fewer on a device with less memory (each
 * holds the game data and a database copy; in GB, as the browser rounds it)
 */
export function rotationSearchThreads() {
  const memory =
    (globalThis.navigator as { deviceMemory?: number } | undefined)
      ?.deviceMemory ?? 8
  const most = memory >= 8 ? 8 : memory >= 4 ? 3 : 1
  return Math.max(1, Math.min(cores() - 1, most))
}

interface Slot {
  worker: Worker
  dataKey?: string
  setupKey?: string
  run?: Run
}
interface Run {
  id: number
  texts: string[]
  done: (scores: (RotationScore | undefined)[]) => void
}

let nextId = 1

/**
 * The player of one search: `score` plays rotations with `setup`'s builds in workers (the
 * database copied once); `release` ends them. One search at a time per player.
 */
export function rotationSearchPlayer(
  database: ArtCharDatabase,
  setup: RotationSearchSetup,
  threads = rotationSearchThreads()
): {
  score: RotationScorer
  /** The threads playing: the workers', or 1 when they could not start */
  threads: () => number
  release: () => void
} {
  const setupKey = `${Date.now()}:${nextId++}`
  let slots: Slot[] = []
  let broken = typeof Worker === 'undefined'
  let snapshot: Snapshot | undefined
  let here: ((text: string) => RotationScore | undefined) | undefined
  const queue: Run[] = []

  const playHere = async (texts: string[]) => {
    here ??= rotationScorer(database, setup)
    const scores: (RotationScore | undefined)[] = []
    for (const text of texts) {
      await yieldTask()
      try {
        scores.push(here(text))
      } catch {
        scores.push(undefined)
      }
    }
    return scores
  }
  // (a worker that fails gets one replacement: the dev server, loading thousands of modules for
  // several workers at once, can fail one now and then)
  let replacements = threads
  const spawn = () => {
    try {
      const worker = new Worker(
        // @ts-expect-error TS1470 (this library is typed as CommonJS; the bundler loads it as a module)
        new URL('./rotationSearchWorker.ts', import.meta.url),
        { type: 'module' }
      )
      const slot: Slot = { worker }
      worker.onmessage = ({ data }: MessageEvent<RotationSearchReply>) =>
        onReply(slot, data)
      worker.onerror = (e) => {
        e.preventDefault?.()
        lost(slot)
      }
      slots.push(slot)
    } catch {
      // (no worker: played without it)
    }
  }
  const start = () => {
    if (slots.length || broken) return
    for (let i = 0; i < threads; i++) spawn()
    if (!slots.length) playAllHere()
  }
  /** A worker failed: its rotations go to the others (here when none is left) */
  const lost = (slot: Slot) => {
    slot.worker.terminate()
    slots = slots.filter((s) => s !== slot)
    if (slot.run) queue.unshift(slot.run)
    if (replacements-- > 0) spawn()
    if (!slots.length) playAllHere()
    else dispatch()
  }
  const playAllHere = () => {
    broken = true
    for (const run of queue.splice(0)) playHere(run.texts).then(run.done)
  }
  const send = (slot: Slot, run: Run) => {
    slot.run = run
    snapshot ??= databaseSnapshot(database)
    if (slot.dataKey !== snapshot.key) {
      slot.worker.postMessage({
        type: 'data',
        ...snapshot,
      } satisfies RotationSearchCommand)
      slot.dataKey = snapshot.key
      slot.setupKey = undefined
    }
    if (slot.setupKey !== setupKey) {
      slot.worker.postMessage({
        type: 'setup',
        key: setupKey,
        setup,
      } satisfies RotationSearchCommand)
      slot.setupKey = setupKey
    }
    slot.worker.postMessage({
      type: 'play',
      id: run.id,
      key: setupKey,
      dataKey: snapshot.key,
      texts: run.texts,
    } satisfies RotationSearchCommand)
  }
  const dispatch = () => {
    for (const slot of slots) {
      if (slot.run) continue
      const run = queue.shift()
      if (!run) return
      send(slot, run)
    }
  }
  const onReply = (slot: Slot, reply: RotationSearchReply) => {
    const run = slot.run
    slot.run = undefined
    if (!run || run.id !== reply.id) return dispatch()
    if (reply.type === 'played') run.done(reply.scores)
    else if (reply.type === 'missing') {
      slot.dataKey = undefined
      queue.unshift(run)
    } else playHere(run.texts).then(run.done)
    dispatch()
  }

  const score: RotationScorer = async (texts, progress, stop) => {
    const scores: (RotationScore | undefined)[] = texts.map(() => undefined)
    let played = 0
    start()
    const runs: Promise<void>[] = []
    for (let at = 0; at < texts.length; at += RUN) {
      const part = texts.slice(at, at + RUN)
      runs.push(
        new Promise<void>((resolve) => {
          const done = (got: (RotationScore | undefined)[]) => {
            got.forEach((s, i) => {
              scores[at + i] = s
            })
            played += part.length
            progress?.(played)
            resolve()
          }
          const run: Run = {
            id: nextId++,
            texts: part,
            done: (got) => {
              // (asked to stop: what is left is not played)
              if (stop?.())
                queue
                  .splice(0)
                  .forEach((r) => r.done(r.texts.map(() => undefined)))
              done(got)
            },
          }
          if (broken)
            (stop?.()
              ? Promise.resolve(part.map(() => undefined))
              : playHere(part)
            ).then(done)
          else queue.push(run)
        })
      )
    }
    dispatch()
    await Promise.all(runs)
    return scores
  }
  return {
    score,
    threads: () => (broken ? 1 : slots.length || threads),
    release: () => {
      const running = slots.flatMap((s) => (s.run ? [s.run] : []))
      for (const slot of slots) slot.worker.terminate()
      slots = []
      for (const run of [...running, ...queue.splice(0)])
        run.done(run.texts.map(() => undefined))
    },
  }
}
