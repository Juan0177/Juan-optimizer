import type { OptProblemInput } from '@genshin-optimizer/gi/solver'
import { GOSolver, mergeBuilds } from '@genshin-optimizer/gi/solver'
import { compactArtifacts } from '@genshin-optimizer/gi/solver-tc'
import type { TeamOptSolver, TeamOptStep } from './solve'
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
  testedPerSecond: 0,
  skippedPerSecond: 0,
})

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
    // (Team Optimize always uses the GPU when the browser can: each step has a build to beat, which
    // the GPU's sweep prunes with; the Optimize tab's GPU setting is for single searches. A
    // team's formula is large: the CPU goes through ~2M builds a second, so the GPU takes even
    // small searches)
    const solver = new GOSolver(
      problem,
      counters,
      // (one running beside another shares the cores, should the CPU take it)
      background
        ? Math.min(maxWorkers, 2)
        : shown
          ? maxWorkers
          : Math.max(1, Math.floor(maxWorkers / 2)),
      { gpu: true, gpuMinTotal: TEAM_GPU_MIN_TOTAL, background }
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
