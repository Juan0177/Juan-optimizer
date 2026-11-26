import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import type {
  RotationCandidate,
  TeamOptWorkerReply,
} from '@genshin-optimizer/gi/ui'
import {
  disposeTeamOptWorkerPool,
  parseFrameData,
  parseTiming,
  teamRotationSearchSetup,
} from '@genshin-optimizer/gi/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { betterRotationCandidates, confirmReserveMs } from './RotationSearch'
import { fullRotationSearch } from './rotationSearchFull'
import {
  type RotationSearchSource,
  teamRotationRun,
} from './rotationSearchSource'

const candidate = (
  text: string,
  dps: number,
  estimate = dps,
  robustEstimate?: number
): RotationCandidate => ({
  text,
  dps,
  estimate,
  ...(robustEstimate !== undefined ? { robustEstimate } : {}),
  time: 20,
  er: {},
  warnings: [],
})

describe('betterRotationCandidates', () => {
  const seed = candidate('seed', 690_000)

  it('drops failed confirmations (null) and confirmed rotations below runDps in quick mode', () => {
    const top = [
      candidate('failed-er', 710_000),
      candidate('confirmed-lower', 705_000),
      candidate('confirmed-higher', 700_000),
      candidate('unconfirmed-better', 698_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: seed,
      confirmed: {
        'failed-er': null,
        'confirmed-lower': 687_424,
        'confirmed-higher': 702_000,
      },
      fullDone: false,
      runDps: 693_779,
    })

    expect(shown.map((c) => c.text)).toEqual([
      'confirmed-higher',
      'unconfirmed-better',
    ])
  })

  it('drops failed confirmations (null) even when a full search stops early', () => {
    const top = [
      candidate('failed-er', 715_000),
      candidate('confirmed-winner', 700_000),
      candidate('unconfirmed-next', 699_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: seed,
      from: seed,
      confirmed: {
        'failed-er': null,
        'confirmed-winner': 701_000,
      },
      fullDone: true,
      ended: 'time',
      runDps: 693_779,
    })

    expect(shown.map((c) => c.text)).toEqual([
      'confirmed-winner',
      'unconfirmed-next',
    ])
  })

  it('keeps only confirmed winners when a full search converges', () => {
    const top = [
      candidate('confirmed-winner-b', 700_000),
      candidate('confirmed-winner-a', 699_000),
      candidate('unconfirmed-high', 720_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: seed,
      from: seed,
      confirmed: {
        'confirmed-winner-b': 698_000,
        'confirmed-winner-a': 705_000,
      },
      fullDone: true,
      ended: 'converged',
      runDps: 693_779,
    })

    expect(shown.map((c) => c.text)).toEqual([
      'confirmed-winner-a',
      'confirmed-winner-b',
    ])
  })

  it('drops unconfirmed candidates whose robustEstimate fails to beat the seed', () => {
    const robustSeed = candidate('seed', 700_000, 700_000, 700_000)
    const top = [
      candidate('cliff-artifact', 715_000, 715_000, 695_000),
      candidate('real-gain', 708_000, 708_000, 707_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: robustSeed,
      confirmed: undefined,
      fullDone: false,
      runDps: 700_000,
    })
    expect(shown.map((c) => c.text)).toEqual(['real-gain'])
  })
})

describe('Quick search confirmation time reserve', () => {
  it('reserves a bounded slice of the budget so confirmation finishes within the time limit', () => {
    expect(confirmReserveMs(30)).toBe(10_000)
    expect(confirmReserveMs(120)).toBe(30_000)
    expect(confirmReserveMs(300)).toBe(45_000)
  })
})

describe('fullRotationSearch deadline, threads, and abort handling', () => {
  const makeTeam = () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const [key, weapon] of [
      ['KamisatoAyaka', 'AmenomaKageuchi'],
      ['Shenhe', 'Deathmatch'],
    ] as const) {
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
      database.weapons.new({
        key: weapon,
        level: 90,
        ascension: 6,
        refinement: 1,
        location: key,
        lock: false,
      })
    }
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId: database.teamChars.new('KamisatoAyaka') },
        { teamCharId: database.teamChars.new('Shenhe') },
      ] as LoadoutDatum[],
    })
    const names = [
      { characterKey: 'KamisatoAyaka' as const, name: 'Ayaka' },
      { characterKey: 'Shenhe' as const, name: 'Shenhe' },
    ]
    const saved = {
      opener: '',
      timing: parseTiming(null),
      frameData: parseFrameData(null),
    }
    return { database, teamId, names, saved }
  }

  it('clears thread count before builds, invokes onAbort on timeout, and does not mark timed-out builds as failed', async () => {
    const { database, teamId, names, saved } = makeTeam()
    const setup = teamRotationSearchSetup(
      database,
      teamId,
      'F',
      names,
      initTeamOpt(),
      { arts: {}, weapons: {} },
      {},
      saved
    )
    const threadHistory: number[] = []
    let threadsDuringConfirm: number | undefined
    let abortCalled = false
    let latestThreads = 0
    const source: RotationSearchSource = {
      tab: 'team',
      setup,
      funded: { KamisatoAyaka: 200, Shenhe: 200 },
      dps: 1,
      prices: async () => ({}),
      confirm: async (_text, isCancelled, onAbort) =>
        new Promise((resolve) => {
          threadsDuringConfirm = latestThreads
          const timer = setTimeout(() => resolve(undefined), 10_000)
          onAbort?.(() => {
            abortCalled = true
            clearTimeout(timer)
            resolve(undefined)
          })
          if (isCancelled()) {
            clearTimeout(timer)
            resolve(undefined)
          }
        }),
    }
    // Order-only search on 2 members converges quickly, then enters confirm and hits the deadline
    const res = await fullRotationSearch({
      database,
      names,
      source,
      seed: 'Ayaka E Q N2 CA -> Shenhe E Q',
      kinds: { order: true, visits: false, attacks: false, actions: false },
      deadline: Date.now() + 2_000,
      isCancelled: () => false,
      onThreads: (n) => {
        latestThreads = n
        threadHistory.push(n)
      },
    })
    // Threads must be cleared to 0 once rotation-search workers are released
    expect(threadHistory.at(-1)).toBe(0)
    if (threadsDuringConfirm !== undefined) {
      expect(threadsDuringConfirm).toBe(0)
      expect(abortCalled).toBe(true)
      expect(res.ended).toBe('time')
    }
    // No timed-out confirmation should be recorded as `null` (failed requirements)
    expect(Object.values(res.confirmed)).not.toContain(null)
  })

  it('teamRotationRun falls back cleanly without Worker and respects immediate cancellation', async () => {
    const { database, teamId, names, saved } = makeTeam()
    // Cancelled before starting returns undefined immediately
    const skipped = await teamRotationRun({
      database,
      gender: 'F',
      teamId,
      names,
      teamOpt: initTeamOpt(),
      text: 'Shenhe E Q -> Ayaka E Q N2 CA',
      saved,
      attackStates: () => undefined,
      rankingBonusStats: () => undefined,
      maxWorkers: 1,
      isCancelled: () => true,
    })
    expect(skipped).toBeUndefined()

    // Non-cancelled fallback run (kept members so no GOSolver worker is needed in Node) completes
    // cleanly and clears onAbort on exit
    const aborts: ((() => void) | undefined)[] = []
    const run = await teamRotationRun({
      database,
      gender: 'F',
      teamId,
      names,
      teamOpt: {
        ...initTeamOpt(),
        energySource: 'manual',
        keep: ['KamisatoAyaka', 'Shenhe'],
      },
      text: 'Shenhe E Q -> Ayaka E Q N2 CA',
      saved,
      attackStates: () => undefined,
      rankingBonusStats: () => undefined,
      maxWorkers: 1,
      isCancelled: () => false,
      onAbort: (fn) => aborts.push(fn),
    })
    expect(run?.result.after.total).toBeGreaterThan(0)
    expect(run?.teamOpt.rotationTime).toBeGreaterThan(0)
    expect(typeof aborts[0]).toBe('function')
    expect(aborts.at(-1)).toBeUndefined()
  })

  afterEach(() => {
    disposeTeamOptWorkerPool()
    vi.unstubAllGlobals()
  })

  it('teamRotationRun uses the warm worker pool with warmStart/ranking:false and terminates immediately on abort', async () => {
    class StubWorker {
      static current: StubWorker
      onmessage?: (event: { data: TeamOptWorkerReply }) => void
      postMessage = vi.fn()
      terminate = vi.fn()
      constructor() {
        StubWorker.current = this
      }
    }
    vi.stubGlobal('Worker', StubWorker)
    const { database, teamId, names, saved } = makeTeam()
    const warmStart = { builds: {}, weapons: {} }
    let abortFn: (() => void) | undefined
    const pending = teamRotationRun({
      database,
      gender: 'F',
      teamId,
      names,
      teamOpt: { ...initTeamOpt(), energySource: 'manual' },
      text: 'Shenhe E Q -> Ayaka E Q N2 CA',
      saved,
      attackStates: () => undefined,
      rankingBonusStats: () => undefined,
      maxWorkers: 4,
      warmStart,
      isCancelled: () => false,
      onAbort: (fn) => {
        abortFn = fn
      },
    })
    const worker = StubWorker.current
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ranking: false,
        warmStart,
        skipProvisional: true,
      })
    )
    expect(typeof abortFn).toBe('function')
    abortFn?.()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(await pending).toBeUndefined()
  })
})
