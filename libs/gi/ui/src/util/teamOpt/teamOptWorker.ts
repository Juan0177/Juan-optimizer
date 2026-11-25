import './kqmBuildWorkerEnv'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { prewarmSolver } from '@genshin-optimizer/gi/solver'
import type { TeamOptWorkerReply, TeamOptWorkerRequest } from './runClient'
import { initStatus } from './runSolver'
import { runTeamOpt } from './runTeam'
import { TeamOptRequirementsUnmet, TeamOptSetRulesUnmet } from './solve'

const post = (reply: TeamOptWorkerReply) => self.postMessage(reply)

self.onmessage = async ({ data }: MessageEvent<TeamOptWorkerRequest>) => {
  try {
    if (typeof Worker === 'undefined')
      throw new Error('Nested workers unavailable')
    prewarmSolver()
  } catch (error) {
    post({
      type: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    })
    return
  }
  const status = initStatus()
  const timer = setInterval(() => post({ type: 'progress', status }), 300)
  try {
    post({ type: 'ready' })
    const { dbIndex, entries, ...job } = data
    const database = new ArtCharDatabase(dbIndex, new SandboxStorage(entries))
    await runTeamOpt(database, job, status, {
      onResult: (result) => {
        clearInterval(timer)
        post({ type: 'result', result })
      },
      onOptions: (characterKey, options) =>
        post({ type: 'options', characterKey, options }),
    })
    post({ type: 'done' })
  } catch (error) {
    if (error instanceof TeamOptRequirementsUnmet)
      post({ type: 'requirements', shortfalls: error.shortfalls })
    else if (error instanceof TeamOptSetRulesUnmet)
      post({ type: 'sets', characterKeys: error.characterKeys })
    else
      post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
  } finally {
    clearInterval(timer)
  }
}
