import { assertUnreachable } from '@genshin-optimizer/common/util'
import { countBuilds } from '../common.js'
import type { Setup, WorkerCommand, WorkerResult } from '../type.js'
import { solveLocal } from './local.js'
import { preprocess } from './preprocess.js'
import { SolverWorker } from './SolverWorker.js'
import { initialItems, plotConfigFor } from './schedule.js'

declare function postMessage(result: WorkerResult): void

/**
 * Pooled solver worker. Workers are reused across runs (see `GOSolver`), so compiled kernels
 * and the JIT stay warm; each `init` replaces the previous run's state.
 */
let worker: SolverWorker | undefined
let run = -1
/** Searches of at least this many builds with minimums have their artifacts' ranges pruned first */
const RANGE_PRUNE_FROM = 1e10
/** The lead's CPU work, prepared once the CPU is needed (see `LeadInit.waitForCPU`) */
let prepareCPU: (() => void) | undefined

function handle(data: WorkerCommand) {
  const { command } = data
  switch (command) {
    case 'init': {
      run = data.run
      worker = undefined
      prepareCPU = undefined
      // loaded and working: splitting a large problem can take a while
      if (data.lead) postMessage({ resultType: 'started', run })
      if (!data.lead) {
        worker = new SolverWorker(data.setup, data.setup.plot)
        postMessage({ resultType: 'ready', run })
        break
      }
      const { problem, localMax } = data
      // The GPU sweeps a large problem faster than its artifacts' ranges are pruned: they prune
      // nothing when only the damage has a floor. Minimums do prune them (most of a big search's
      // builds when an Energy Recharge one is high): not skipped then, for a search that big.
      const builds = countBuilds(problem.arts)
      const minimums = problem.constraints.some(
        (c) =>
          c.value !== problem.optimizationTarget &&
          c.min > Number.NEGATIVE_INFINITY
      )
      const gpuFirst =
        !!data.waitForCPU &&
        builds >= (data.gpuMinTotal ?? Number.POSITIVE_INFINITY) &&
        !(minimums && builds >= RANGE_PRUNE_FROM)
      const prepared = preprocess(problem, !gpuFirst)
      prepared.plot = plotConfigFor(prepared)
      postMessage({
        resultType: 'prepared',
        run,
        setup: prepared,
        plot: prepared.plot,
        fullTotal: countBuilds(prepared.arts),
      })
      const thisRun = run
      /**
       * The CPU's work: a small problem is solved right away, else its items are listed and
       * returned, to be packed and handed out (see `prepareCPU`)
       */
      const prepare = (setup: Setup) => {
        const { plot } = setup
        const { items, total } = initialItems(setup.arts, problem.exclusion)
        if (total <= localMax) {
          const local = solveLocal(setup, problem.exclusion)
          postMessage({
            resultType: 'ready',
            run: thisRun,
            lead: { items: [], total, plot, local },
          })
          return undefined
        }
        return () => {
          prepareCPU = undefined
          worker = new SolverWorker(setup, plot)
          // a few bounded, best-first packs instead of (possibly) millions of tiny items
          const packed = worker.packItems(items)
          setup.slotFilters = packed.slotFilters
          postMessage({
            resultType: 'ready',
            run: thisRun,
            lead: {
              items: packed.items,
              total,
              plot,
              setup,
              skipped: packed.skipped,
            },
          })
        }
      }
      if (gpuFirst)
        prepareCPU = () => {
          prepareCPU = undefined
          const setup = preprocess(problem)
          setup.plot = plotConfigFor(setup)
          prepare(setup)?.()
        }
      else {
        prepareCPU = prepare(prepared)
        if (!data.waitForCPU) prepareCPU?.()
      }
      break
    }
    case 'proceed':
      if (data.run === run) prepareCPU?.()
      break
    case 'threshold':
      if (data.run === run) worker?.setThreshold(data.threshold)
      break
    case 'work':
      if (data.run !== run || !worker) break
      postMessage({
        resultType: 'work',
        run,
        ...worker.work(data.items, data.chunkSize),
      })
      break
    case 'finalize':
      if (data.run !== run || !worker) break
      postMessage({ resultType: 'finalized', run, ...worker.finalize() })
      worker = undefined // free memory while pooled
      break
    default:
      assertUnreachable(command)
  }
}

onmessage = (e: MessageEvent<WorkerCommand>) => {
  try {
    handle(e.data)
  } catch (err) {
    postMessage({ resultType: 'err', run, message: (err as Error).message })
  }
}
