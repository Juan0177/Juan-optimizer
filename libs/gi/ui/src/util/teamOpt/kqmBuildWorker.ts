import './kqmBuildWorkerEnv'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  clearInvestmentReplayCache,
  runInvestmentJob,
} from './investmentWorker'
import { buildKqmProblem } from './kqmBuild'
import type { KqmBuildCommand, KqmBuildReply } from './kqmBuildPool'

/*
 * A KQM problem builder & investment evaluator (see `kqmBuildPool`): the page's database, copied
 * once per run (`data`), then builds KQM problems (`buildKqmProblem`) or runs full investment
 * evaluations (`runInvestmentJob`) across parallel worker threads.
 */
let database: ArtCharDatabase | undefined
let key: string | undefined
let dataError: string | undefined

const post = (reply: KqmBuildReply) => self.postMessage(reply)

self.onmessage = ({ data }: MessageEvent<KqmBuildCommand>) => {
  switch (data.type) {
    case 'data':
      // Release old DB & replay cache references before allocating the new database
      database = undefined
      key = undefined
      dataError = undefined
      clearInvestmentReplayCache()
      try {
        database = new ArtCharDatabase(
          data.dbIndex,
          new SandboxStorage(data.entries)
        )
        key = data.key
      } catch (e) {
        dataError = String((e as Error)?.message ?? e)
      }
      return
    case 'build': {
      if (dataError)
        return post({ type: 'error', id: data.id, message: dataError })
      if (!database || key !== data.key)
        return post({ type: 'missing', id: data.id })
      try {
        const built = buildKqmProblem(
          database,
          data.teamId,
          data.gender,
          data.settings
        )
        post({ type: 'built', id: data.id, built })
      } catch (e) {
        post({
          type: 'error',
          id: data.id,
          message: String((e as Error)?.message ?? e),
        })
      }
      return
    }
    case 'invest': {
      if (dataError)
        return post({ type: 'error', id: data.id, message: dataError })
      if (!database || key !== data.key)
        return post({ type: 'missing', id: data.id })
      void runInvestmentJob(database, data.job)
        .then((result) => post({ type: 'invested', id: data.id, result }))
        .catch((e) =>
          post({
            type: 'error',
            id: data.id,
            message: String((e as Error)?.message ?? e),
          })
        )
      return
    }
  }
}
