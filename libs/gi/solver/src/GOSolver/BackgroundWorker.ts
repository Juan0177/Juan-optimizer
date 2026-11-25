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
      // Before a huge GPU sweep (>= 500M builds), prune artifacts against cheap non-target
      // minimums (like ER/CR): takes <1 ms instead of hundreds of ms evaluating a huge
      // team-damage floor per artifact, while still eliminating ER-impossible artifacts.
      // Smaller GPU sweeps run faster without range pruning at all.
      const builds = countBuilds(problem.arts)
      const gpuFirst =
        !!data.waitForCPU &&
        builds >= (data.gpuMinTotal ?? Number.POSITIVE_INFINITY)
      const prepared = preprocess(
        problem,
        gpuFirst ? (builds >= 5e8 ? 'minimums' : false) : true
      )
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
      else if (data.waitForCPU)
        // Defer enumerating set combinations (`initialItems`) until `proceed`: if the GPU takes
        // the problem, enumerating hundreds of thousands of CPU items would waste seconds on the
        // lead worker for work that is never used.
        prepareCPU = () => {
          prepareCPU = undefined
          prepare(prepared)?.()
        }
      else {
        prepare(prepared)?.()
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
