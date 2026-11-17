import type { TeamKqmSavedRun } from '@genshin-optimizer/gi/db'
import type { KqmDoneRun } from '../useKqmRun'

/**
 * A run KQM Theorycrafting saved (`database.teamKqmResults`), as `useKqmRun` keeps it: its result,
 * the settings it ran with and those its damage is for. Runs saved by older versions may lack some
 * of it.
 */
export type SavedKqmRun = Pick<KqmDoneRun, 'result'> &
  Partial<Omit<KqmDoneRun, 'result'>>

/** The saved run's KQM Theorycrafting part (the database only checks it has builds) */
export const savedRunOf = (saved: TeamKqmSavedRun): SavedKqmRun =>
  saved.run as unknown as SavedKqmRun
