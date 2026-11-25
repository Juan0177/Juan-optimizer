import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { BonusStats } from './data'
import type { RunAttackState } from './lowHpUptime'
import type { TeamOptMemberOptions, TeamOptResult } from './solve'

export interface TeamOptRankingJob {
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  result: Pick<TeamOptResult, 'builds' | 'weapons' | 'optimized'>
  attackStates?: readonly RunAttackState[]
  rankingBonusStats?: Partial<Record<CharacterKey, BonusStats>>
  maxWorkers: number
}

export type TeamOptRankingRequest = TeamOptRankingJob & {
  dbIndex: ArtCharDatabase['dbIndex']
  entries: Record<string, string>
}

export type TeamOptRankingReply =
  | { type: 'ready' }
  | {
      type: 'options'
      characterKey: CharacterKey
      options: TeamOptMemberOptions
    }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** One short-lived worker per run, including its database and solver workers. */
export function startTeamOptRankings(
  database: ArtCharDatabase,
  job: TeamOptRankingJob,
  onOptions: (characterKey: CharacterKey, options: TeamOptMemberOptions) => void
) {
  // @ts-expect-error TS1470: the app's bundler loads this library as a module.
  const worker = new Worker(new URL('./rankingWorker.ts', import.meta.url), {
    type: 'module',
  })
  let finish: (error?: Error) => void
  const done = new Promise<void>((resolve, reject) => {
    const startup = setTimeout(
      () => finish(new Error('Team Optimize ranking worker did not start')),
      20000
    )
    finish = (error) => {
      clearTimeout(startup)
      worker.terminate()
      if (error) reject(error)
      else resolve()
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish(new Error(event.message || 'Team Optimize ranking worker failed'))
    }
    worker.onmessageerror = () =>
      finish(new Error('Could not read Team Optimize rankings'))
    worker.onmessage = ({ data }: MessageEvent<TeamOptRankingReply>) => {
      switch (data.type) {
        case 'ready':
          clearTimeout(startup)
          break
        case 'options':
          onOptions(data.characterKey, data.options)
          break
        case 'done':
          finish()
          break
        case 'error':
          finish(new Error(data.message))
          break
      }
    }
    try {
      const entries = Object.fromEntries(database.storage.entries)
      // Completed runs are display caches. The worker rebuilds the current team from the input.
      delete entries['teamOptResults']
      delete entries['teamKqmResults']
      worker.postMessage({
        ...job,
        dbIndex: database.dbIndex,
        entries,
      } satisfies TeamOptRankingRequest)
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
  return { done, stop: () => finish() }
}
