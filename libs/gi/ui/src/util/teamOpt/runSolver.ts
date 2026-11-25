import {
  type ArtifactSetKey,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion, ICachedArtifact } from '@genshin-optimizer/gi/db'
import type {
  ArtifactBuildData,
  ArtifactsBySlot,
  OptProblemInput,
} from '@genshin-optimizer/gi/solver'
import {
  exclusionMasks,
  GOSolver,
  type GPUSetRulesOverride,
  GPUSolver,
  mergeBuilds,
  optimizerGpuSupported,
  preprocess,
} from '@genshin-optimizer/gi/solver'
import { compactArtifacts } from '@genshin-optimizer/gi/solver-tc'
import type { TeamOptSetRanker, TeamOptSolver, TeamOptStep } from './solve'
import { TEAM_GPU_MIN_TOTAL, TeamOptCancelled } from './solve'

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
  upper: undefined,
  testedPerSecond: 0,
  skippedPerSecond: 0,
})

const ALL_COUNTS = 0x3f // 0..5 pieces

/**
 * Build a reusable GPU set ranker for one `(member, weapon)` problem: compiles one shader and
 * evaluates every 4pc set and 2pc+2pc pair by updating only the tiny set-rule masks and slot rows.
 */
async function buildGpuSetRanker(
  input: {
    arts: ICachedArtifact[]
    objective: OptProblemInput['optimizationTarget']
    constraints: OptProblemInput['constraints']
    exclusion: ArtSetExclusion
    mainStatAssumptionLevel: number
    background?: boolean
  },
  activeGpu: Set<GPUSolver>
): Promise<TeamOptSetRanker | undefined> {
  if (!optimizerGpuSupported()) return undefined
  const problem: OptProblemInput = {
    arts: compactArtifacts(input.arts, input.mainStatAssumptionLevel, false),
    optimizationTarget: input.objective,
    constraints: input.constraints,
    exclusion: input.exclusion,
    topN: 1,
  }
  // Keep every artifact (pruneOrder = false) so cross-set dominance never drops pieces needed
  // when ranking an individual 4pc set or 2pc+2pc pair.
  const setup = preprocess(problem, false, false)
  const baseMasks = exclusionMasks(input.exclusion)
  const gpu = await GPUSolver.create(setup, undefined, baseMasks, {
    forceRules: true,
  })
  if (!gpu) return undefined
  activeGpu.add(gpu)

  const mins = setup.constraints
    .filter((c) => c.min > Number.NEGATIVE_INFINITY)
    .map((c) => c.min)
  const bySlotId = Object.fromEntries(
    allArtifactSlotKeys.map((slot) => {
      const m = new Map<string, ArtifactBuildData>()
      for (const a of setup.arts.values[slot]) m.set(a.id, a)
      return [slot, m]
    })
  ) as Record<
    (typeof allArtifactSlotKeys)[number],
    Map<string, ArtifactBuildData>
  >

  const subsetOf = (arts: readonly ICachedArtifact[]): ArtifactsBySlot => {
    const ids = new Set(arts.map((a) => a.id))
    return {
      base: setup.arts.base,
      values: Object.fromEntries(
        allArtifactSlotKeys.map((slot) => {
          const matched: ArtifactBuildData[] = []
          for (const a of setup.arts.values[slot]) {
            if (a.id && ids.has(a.id)) matched.push(a)
          }
          if (!matched.length) {
            const empty = bySlotId[slot].get('')
            if (empty) matched.push(empty)
          }
          return [slot, matched]
        })
      ) as ArtifactsBySlot['values'],
    }
  }

  const allSets = new Set<string>()
  for (const slot of allArtifactSlotKeys)
    for (const a of setup.arts.values[slot]) if (a.set) allSets.add(a.set)

  const runSubset = async (
    subset: ArtifactsBySlot,
    rules: GPUSetRulesOverride,
    floor = Number.NEGATIVE_INFINITY,
    collect = false
  ): Promise<
    { value: number; artifactIds: string[] } | undefined | 'fallback'
  > => {
    try {
      const res = await gpu.run(
        subset,
        Number.NEGATIVE_INFINITY,
        undefined,
        collect,
        input.background ?? true,
        { floor, rules }
      )
      if (!res.ok) return 'fallback'
      let bestValue = Number.NEGATIVE_INFINITY
      let bestIds: string[] | undefined
      for (const { arts: picked, values } of res.candidates) {
        if (!mins.every((m, i) => m <= values[1 + i])) continue
        if (values[0] > bestValue) {
          bestValue = values[0]
          bestIds = picked.map((a) => a.id).filter((id) => id)
        }
      }
      return bestIds ? { value: bestValue, artifactIds: bestIds } : undefined
    } catch {
      return 'fallback'
    }
  }

  return {
    solveSet: async (arts, required, minCount) => {
      const sets: Partial<Record<string, number>> = {}
      const keepMask =
        minCount === 4 ? (1 << 4) | (1 << 5) : (1 << 2) | (1 << 3)
      const otherMask = (1 << 0) | (1 << 1)
      for (const s of allSets) {
        const base = baseMasks.sets[s as ArtifactSetKey] ?? ALL_COUNTS
        sets[s] = required.includes(s as ArtifactSetKey)
          ? base & keepMask
          : base & otherMask
      }
      const rules: GPUSetRulesOverride = {
        sets,
        defaultMask: otherMask,
        rainbow: baseMasks.rainbow & otherMask,
        noFour: minCount === 4 ? 0 : baseMasks.noFour & otherMask,
        req: required.map((s) => [s, minCount] as const),
      }
      const fullSubset = subsetOf(arts)
      // Exact disjoint 5-way off-piece partition for both 4-piece S and 2pc A + 2pc B:
      // every valid build has >= 4 pieces inside `required` and at most 1 piece outside it.
      // - off = 0: slot 0 has all pieces (covers 5-in-required + off-piece in slot 0), slots 1..4 in `required`
      // - off = 1..4: slot `off` has pieces outside `required` only, other 4 slots in `required`
      // Shrinks search space 50x-500x and carries the running best floor across sub-sweeps so
      // sub-sweeps 1..4 skip Pass 1 almost every time.
      const reqSet = new Set<string>(required)
      let best: { value: number; artifactIds: string[] } | undefined
      for (let off = 0; off < allArtifactSlotKeys.length; off++) {
        const values = {} as ArtifactsBySlot['values']
        let empty = false
        for (let s = 0; s < allArtifactSlotKeys.length; s++) {
          const slot = allArtifactSlotKeys[s]
          const list = fullSubset.values[slot]
          const picked =
            s === off
              ? off === 0
                ? list
                : list.filter((a) => !a.set || !reqSet.has(a.set))
              : list.filter((a) => !!a.set && reqSet.has(a.set))
          if (!picked.length) {
            empty = true
            break
          }
          values[slot] = picked
        }
        if (empty) continue
        const floor = best ? best.value : Number.NEGATIVE_INFINITY
        const found = await runSubset(
          { base: fullSubset.base, values },
          rules,
          floor,
          Number.isFinite(floor)
        )
        if (found === 'fallback') return 'fallback'
        if (found && (!best || found.value > best.value)) best = found
      }
      return best
    },
    solveMixed: (arts, forbidPairs) => {
      const sets: Partial<Record<string, number>> = {}
      const noFourPiece = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3)
      for (const s of allSets) {
        const base = baseMasks.sets[s as ArtifactSetKey] ?? ALL_COUNTS
        sets[s] = base & noFourPiece
      }
      const rb = (1 << 0) | (1 << 1)
      return runSubset(subsetOf(arts), {
        sets,
        defaultMask: rb,
        rainbow: 0,
        noFour: baseMasks.noFour & rb,
        forbidPairs,
      })
    },
    destroy: () => {
      activeGpu.delete(gpu)
      gpu.destroy()
    },
  }
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
  onSolver: (stop: (() => void) | undefined) => void,
  { responsive = false, lowImpact = false } = {}
): TeamOptSolver {
  const running = new Set<GOSolver>()
  const activeGpu = new Set<GPUSolver>()
  const stopAll = () => {
    for (const solver of running) solver.cancel(new TeamOptCancelled())
    for (const gpu of activeGpu) gpu.destroy()
    activeGpu.clear()
  }
  const inWorker = typeof document === 'undefined'
  const cores = globalThis.navigator?.hardwareConcurrency || 8
  const solverFn: TeamOptSolver = async ({
    arts,
    objective,
    constraints,
    exclusion,
    mainStatAssumptionLevel,
    topN = 1,
    onWork,
    background,
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
    // When running off the page thread in a worker, foreground solves can use full CPU workers
    // (leaving 2 cores for the browser compositor/GPU process) and double-buffered GPU slices.
    // On the page thread (fallback) or during post-result background rankings, stay gentle.
    const fgThreads = lowImpact
      ? 1
      : inWorker
        ? Math.min(maxWorkers, Math.max(1, cores - 2))
        : responsive
          ? Math.min(maxWorkers, 4)
          : maxWorkers
    const bgThreads = lowImpact
      ? 1
      : inWorker
        ? Math.min(fgThreads, 4)
        : Math.min(fgThreads, 2)
    const solver = new GOSolver(
      problem,
      counters,
      // (one running beside another shares the cores, should the CPU take it)
      background
        ? bgThreads
        : shown
          ? fgThreads
          : Math.max(1, Math.floor(fgThreads / 2)),
      {
        gpu: true,
        gpuMinTotal: TEAM_GPU_MIN_TOTAL,
        background: inWorker ? !!background : responsive || !!background,
      }
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
      if (!running.size && !activeGpu.size) onSolver(undefined)
      solver.cancel()
    }
  }
  solverFn.createSetRanker = (input) => buildGpuSetRanker(input, activeGpu)
  return solverFn
}
