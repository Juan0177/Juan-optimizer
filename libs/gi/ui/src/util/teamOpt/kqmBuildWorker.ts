import './kqmBuildWorkerEnv'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { buildKqmProblem } from './kqmBuild'
import type { KqmBuildCommand, KqmBuildReply } from './kqmBuildPool'

/*
 * A KQM problem builder (see `kqmBuildPool`): the page's database, copied once per run (`data`),
 * and each problem built from it as the page would build it (`buildKqmProblem`)
 */
let database: ArtCharDatabase | undefined
let key: string | undefined

const post = (reply: KqmBuildReply) => self.postMessage(reply)

self.onmessage = ({ data }: MessageEvent<KqmBuildCommand>) => {
  switch (data.type) {
    case 'data':
      key = undefined
      database = new ArtCharDatabase(
        data.dbIndex,
        new SandboxStorage(data.entries)
      )
      key = data.key
      return
    case 'build': {
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
  }
}
