import './kqmBuildWorkerEnv'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { TeamOptRankingReply, TeamOptRankingRequest } from './ranking'
import { initStatus, teamOptSolver } from './runSolver'
import { optimizeTeam } from './solve'

const post = (reply: TeamOptRankingReply) => self.postMessage(reply)

self.onmessage = async ({ data }: MessageEvent<TeamOptRankingRequest>) => {
  try {
    const { dbIndex, entries, maxWorkers, result, ...settings } = data
    const database = new ArtCharDatabase(dbIndex, new SandboxStorage(entries))
    post({ type: 'ready' })
    const ranked = await optimizeTeam({
      ...settings,
      database,
      from: result,
      maxRounds: 0,
      solve: teamOptSolver(initStatus(), maxWorkers, () => {}),
      onResult: () => {},
      onOptions: (characterKey, options) =>
        post({ type: 'options', characterKey, options }),
    })
    if (!ranked) throw new Error('Could not restore the team for ranking')
    post({ type: 'done' })
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
