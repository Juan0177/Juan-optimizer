import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  startTeamOptWorker,
  type TeamOptWorkerReply,
  TeamOptWorkerUnavailable,
} from '../util/teamOpt/runClient'
import { initStatus } from '../util/teamOpt/runSolver'
import {
  TeamOptCancelled,
  TeamOptRequirementsUnmet,
  TeamOptSetRulesUnmet,
} from '../util/teamOpt/solve'

class StubWorker {
  static current: StubWorker
  onmessage?: (event: { data: TeamOptWorkerReply }) => void
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    StubWorker.current = this
  }

  reply(data: TeamOptWorkerReply) {
    this.onmessage?.({ data })
  }
}

function start() {
  vi.stubGlobal('Worker', StubWorker)
  const database = new ArtCharDatabase(1, new SandboxStorage())
  const updates = { onResult: vi.fn(), onOptions: vi.fn(), onProgress: vi.fn() }
  const run = startTeamOptWorker(
    database,
    {
      teamId: 'team_0',
      gender: 'F',
      teamOpt: initTeamOpt(),
      maxWorkers: 4,
      lowImpact: true,
    },
    updates
  )
  return { run, worker: StubWorker.current, updates }
}

afterEach(() => vi.unstubAllGlobals())

describe('Team Optimize worker', () => {
  it('reports progress, the team and its rankings before releasing the worker', async () => {
    const { run, worker, updates } = start()
    const status = { ...initStatus(), tested: 10, total: 20 }
    const evaluation = { total: 1, members: {}, attacks: {}, unmet: {} }
    const result = {
      builds: {},
      weapons: {},
      rounds: 1,
      optimized: [],
      before: evaluation,
      after: evaluation,
    }
    const options = { best: 1, sets: [], weapons: [] }
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team_0', dbIndex: 1 })
    )
    worker.reply({ type: 'ready' })
    worker.reply({ type: 'progress', status })
    worker.reply({ type: 'result', result })
    worker.reply({ type: 'options', characterKey: 'Sucrose', options })
    worker.reply({ type: 'done' })
    await run.done
    expect(updates.onProgress).toHaveBeenCalledWith(status)
    expect(updates.onResult).toHaveBeenCalledWith(result)
    expect(updates.onOptions).toHaveBeenCalledWith('Sucrose', options)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('stops an active run and ignores late progress', async () => {
    const { run, worker, updates } = start()
    worker.reply({ type: 'ready' })
    run.stop()
    worker.reply({ type: 'progress', status: initStatus() })
    run.stop()
    await expect(run.done).rejects.toBeInstanceOf(TeamOptCancelled)
    expect(updates.onProgress).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      { type: 'unavailable', message: 'Nested workers unavailable' },
      TeamOptWorkerUnavailable,
    ],
    [{ type: 'requirements', shortfalls: {} }, TeamOptRequirementsUnmet],
    [{ type: 'sets', characterKeys: ['Sucrose'] }, TeamOptSetRulesUnmet],
  ] satisfies [
    TeamOptWorkerReply,
    abstract new (...args: never[]) => Error,
  ][])('preserves structured errors from the worker', async (reply, error) => {
    const { run, worker } = start()
    worker.reply(reply)
    await expect(run.done).rejects.toBeInstanceOf(error)
  })
})
