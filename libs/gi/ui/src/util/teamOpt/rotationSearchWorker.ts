import './kqmBuildWorkerEnv'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { RotationScore } from './rotationSearch'
import type {
  RotationSearchCommand,
  RotationSearchReply,
} from './rotationSearchPool'
import { rotationScorer } from './rotationSearchScore'

/*
 * A rotation search's player (see `rotationSearchPool`): the page's database, copied once
 * (`data`), the search's builds (`setup`), and the rotations it is sent played with them
 */
let database: ArtCharDatabase | undefined
let dataKey: string | undefined
let setupKey: string | undefined
let play: ((text: string) => RotationScore | undefined) | undefined
let failed: string | undefined

const post = (reply: RotationSearchReply) => self.postMessage(reply)

self.onmessage = ({ data }: MessageEvent<RotationSearchCommand>) => {
  switch (data.type) {
    case 'data':
      database = new ArtCharDatabase(
        data.dbIndex,
        new SandboxStorage(data.entries)
      )
      dataKey = data.key
      setupKey = undefined
      play = undefined
      return
    case 'setup':
      if (!database) return
      setupKey = data.key
      try {
        failed = undefined
        play = rotationScorer(database, data.setup)
      } catch (e) {
        failed = String((e as Error)?.message ?? e)
        play = undefined
      }
      return
    case 'play': {
      if (setupKey === data.key && failed)
        return post({ type: 'error', id: data.id, message: failed })
      if (!play || setupKey !== data.key || dataKey !== data.dataKey)
        return post({ type: 'missing', id: data.id })
      const player = play
      post({
        type: 'played',
        id: data.id,
        scores: data.texts.map((text) => {
          try {
            return player(text)
          } catch {
            return undefined
          }
        }),
      })
      return
    }
  }
}
