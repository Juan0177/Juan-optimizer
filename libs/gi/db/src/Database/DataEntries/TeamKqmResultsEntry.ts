import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataEntry } from '../DataEntry'
import { validateTeamOpt } from '../DataManagers/TeamOpt'
import type { PackedKqmRun } from './packKqmRun'
import { isPackedKqmRun, packKqmRun, unpackKqmRun } from './packKqmRun'

/**
 * A team's last KQM theorycrafting run, kept across reloads. The run's shape belongs to KQM mode
 * (its result, gi/ui `KqmResult`, and what it ran with): it is only checked here to have a result
 * with builds, and settings that are still valid.
 */
export interface TeamKqmSavedRun {
  /** When it was found (ms since 1970) */
  savedAt: number
  /** The team's members when it ran: it is only shown again for the same members */
  members: string[]
  /** KQM mode's finished run, as that page keeps it */
  run: {
    result: { builds: Record<string, unknown> } & Record<string, unknown>
  } & Record<string, unknown>
}

/**
 * A team's last KQM run in brief, kept for every team (its full run may have made room for newer
 * ones): what KQM versions compare
 */
export interface TeamKqmRunSummary {
  savedAt: number
  /** The members it ran with */
  members: string[]
  /** The rotation's damage with the builds */
  total: number
  /** Per member, its own attacks' damage */
  memberTotals: Record<string, number>
  /** Per member, the Energy Recharge it needs (%, after energy weapons) */
  er?: Record<string, number>
  /** Per member, its time on the field per rotation (seconds) */
  field?: Record<string, number>
  /** The rotation's length (seconds); absent: damage only */
  rotationTime?: number
  /** Per member, its build's weapon and artifact sets (pieces) */
  gear: Record<
    string,
    { weapon: string; refinement: number; sets: Record<string, number> }
  >
  /** What it ran with: the settings a version shares with its original, and its own rotation */
  settings: string
  rotation: string
}

/** A team's saved run in the entry: when, and for which members (its run is under its own key) */
export interface TeamKqmRunIndex {
  savedAt: number
  members: string[]
}

/**
 * Per team (id), its last run's index, and every team's summary. (One field, replaced whole: `set`
 * merges top-level keys.) Each run itself is packed under its own storage key (`runStorageKey`),
 * so saving one writes only that one.
 */
export interface ITeamKqmResultsEntry {
  runs: Record<string, TeamKqmRunIndex>
  summaries?: Record<string, TeamKqmRunSummary>
}

/** As the browser's storage keeps the entry (older versions kept each run inside it, `run`) */
export interface ITeamKqmResultsStored {
  runs: Record<
    string,
    TeamKqmRunIndex & { run?: PackedKqmRun | TeamKqmSavedRun['run'] }
  >
  summaries?: Record<string, TeamKqmRunSummary>
}

/** The storage key of a team's packed run */
export const runStorageKey = (teamId: string) => `teamKqmRun_${teamId}`

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')
function validateSummary(v: unknown): TeamKqmRunSummary | undefined {
  if (!isObject(v)) return undefined
  const { savedAt, members, total, memberTotals, rotationTime, gear } = v
  const numbers = (r: unknown) =>
    isObject(r) && Object.values(r).every(isFiniteNumber)
      ? (r as Record<string, number>)
      : undefined
  const er = numbers(v['er'])
  const field = numbers(v['field'])
  const { settings, rotation } = v
  if (
    !isFiniteNumber(savedAt) ||
    !isStringArray(members) ||
    !isFiniteNumber(total) ||
    !isObject(memberTotals) ||
    !Object.values(memberTotals).every(isFiniteNumber) ||
    (rotationTime !== undefined && !isFiniteNumber(rotationTime)) ||
    !isObject(gear) ||
    typeof settings !== 'string' ||
    typeof rotation !== 'string'
  )
    return undefined
  const builds: TeamKqmRunSummary['gear'] = {}
  for (const [k, b] of Object.entries(gear)) {
    if (!isObject(b) || !isObject(b['sets'])) return undefined
    const { weapon, refinement, sets } = b
    if (typeof weapon !== 'string' || !isFiniteNumber(refinement))
      return undefined
    if (!Object.values(sets).every(isFiniteNumber)) return undefined
    builds[k] = { weapon, refinement, sets: sets as Record<string, number> }
  }
  return {
    savedAt,
    members,
    total,
    memberTotals: memberTotals as Record<string, number>,
    ...(er ? { er } : {}),
    ...(field ? { field } : {}),
    ...(rotationTime !== undefined ? { rotationTime } : {}),
    gear: builds,
    settings,
    rotation,
  }
}

/**
 * Runs kept: the most recent ones (~250–450 KB each, packed). Each is under its own key in the
 * browser's database (IndexedDB), so saving one writes only it.
 */
export const TEAM_KQM_RUNS_KEPT = 100

/** A run's settings checked (an older version's that no longer validate: none) */
function checkedRun(run: unknown): TeamKqmSavedRun['run'] | undefined {
  if (!isObject(run) || !isObject(run['result'])) return undefined
  if (!isObject(run['result']['builds'])) return undefined
  const settings: Record<string, unknown> = {}
  for (const key of ['teamOpt', 'runTeamOpt'] as const) {
    if (run[key] === undefined) continue
    const value = validateTeamOpt(run[key])
    if (!value) return undefined
    settings[key] = value
  }
  return { ...run, ...settings } as TeamKqmSavedRun['run']
}

export class TeamKqmResultsEntry extends DataEntry<
  'teamKqmResults',
  'teamKqmResults',
  ITeamKqmResultsEntry,
  ITeamKqmResultsStored
> {
  /**
   * Each kept run, packed, as the storage holds it under `runStorageKey` (the same strings): kept
   * here too so that a database moved to another storage (`saveStorage`) takes them along.
   * (Declared only: the base constructor fills it through `validate`.)
   */
  private declare packed?: Map<string, string>
  private get packedRuns() {
    this.packed ??= new Map()
    return this.packed
  }

  constructor(database: ArtCharDatabase) {
    super(database, 'teamKqmResults', () => ({ runs: {} }), 'teamKqmResults')
    // (runs an index no longer lists: one dropped while loading, or by an older version)
    const runs = this.get().runs
    this.database.storage.removeForKeys(
      (key) =>
        key.startsWith(runStorageKey('')) &&
        !(key.slice(runStorageKey('').length) in runs)
    )
  }
  /**
   * The index and summaries, checked. A run an older version kept inside the entry moves to its
   * own key (packed); a run whose key is gone leaves the index.
   */
  override validate(obj: unknown): ITeamKqmResultsStored | undefined {
    if (!isObject(obj)) return undefined
    const runs: ITeamKqmResultsEntry['runs'] = {}
    for (const [teamId, saved] of Object.entries(
      isObject(obj['runs']) ? obj['runs'] : {}
    )) {
      if (!isObject(saved)) continue
      const { savedAt, members } = saved
      if (!Array.isArray(members) || members.some((m) => typeof m !== 'string'))
        continue
      let packed: string | undefined
      if (saved['run'] !== undefined) {
        // (inside the entry, as older versions kept it: checked once, then under its own key)
        let run = saved['run']
        if (isPackedKqmRun(run))
          try {
            run = unpackKqmRun(run)
          } catch {
            continue
          }
        const checked = checkedRun(run)
        if (!checked) continue
        packed = JSON.stringify(packKqmRun(checked))
        if (!this.writePacked(teamId, packed)) continue
      } else
        packed =
          this.packedRuns.get(teamId) ??
          this.database.storage.getString(runStorageKey(teamId))
      if (!packed) continue
      this.packedRuns.set(teamId, packed)
      runs[teamId] = {
        savedAt: typeof savedAt === 'number' ? savedAt : 0,
        members: members as string[],
      }
    }
    const summaries: NonNullable<ITeamKqmResultsEntry['summaries']> = {}
    for (const [teamId, summary] of Object.entries(
      isObject(obj['summaries']) ? obj['summaries'] : {}
    )) {
      const valid = validateSummary(summary)
      if (valid) summaries[teamId] = valid
    }
    return Object.keys(summaries).length ? { runs, summaries } : { runs }
  }
  override toCache(stored: ITeamKqmResultsStored): ITeamKqmResultsEntry {
    // (`validate` has moved the runs to their keys: the index alone)
    return stored as ITeamKqmResultsEntry
  }
  override deCache(cached: ITeamKqmResultsEntry): ITeamKqmResultsStored {
    return cached
  }
  /** The entry and every kept run, written to the (new) storage */
  override saveStorage() {
    super.saveStorage()
    for (const [teamId, packed] of this.packedRuns)
      if (teamId in this.get().runs) this.writePacked(teamId, packed)
  }
  /** The entry and every kept run, out of the storage (kept here: `saveStorage` may follow) */
  override clearStorage() {
    super.clearStorage()
    for (const teamId of this.packedRuns.keys())
      this.database.storage.remove(runStorageKey(teamId))
  }
  override clear() {
    for (const teamId of [...this.packedRuns.keys()]) this.dropRun(teamId)
    super.clear()
  }
  /** A team's last run in brief */
  getSummary(teamId: string): TeamKqmRunSummary | undefined {
    return this.get().summaries?.[teamId]
  }
  /** Saves (or with `undefined`, forgets) a team's last run in brief */
  setSummary(teamId: string, summary: TeamKqmRunSummary | undefined): void {
    const summaries = { ...(this.get().summaries ?? {}) }
    if (summary) summaries[teamId] = summary
    else if (teamId in summaries) delete summaries[teamId]
    else return
    try {
      this.set({ summaries })
    } catch (e) {
      // (QuotaExceededError: the storage keeps what it had)
      if (!(e instanceof DOMException)) throw e
    }
  }
  /** A team's saved run (unpacked from its key: a copy of its own), if it still validates */
  getRun(teamId: string): TeamKqmSavedRun | undefined {
    const index = this.get().runs[teamId]
    const packed = index && this.packedRuns.get(teamId)
    if (!packed) return undefined
    let run: unknown
    try {
      run = JSON.parse(packed)
      if (isPackedKqmRun(run)) run = unpackKqmRun(run)
    } catch {
      return undefined
    }
    const checked = checkedRun(run)
    return (
      checked && {
        savedAt: index.savedAt,
        members: [...index.members],
        run: checked,
      }
    )
  }
  /**
   * Saves (or with `undefined`, forgets) a team's last run. Only the most recent runs are kept;
   * when the browser's storage is full, older runs make room, else this one is not saved.
   */
  setRun(teamId: string, run: TeamKqmSavedRun | undefined): void {
    const runs = { ...this.get().runs }
    if (!run) {
      if (!(teamId in runs)) return
      delete runs[teamId]
      this.dropRun(teamId)
      this.writeIndex(runs)
      return
    }
    const packed = JSON.stringify(packKqmRun(structuredClone(run.run)))
    // (the oldest make room while the storage is full)
    const others = Object.entries(runs)
      .filter(([id]) => id !== teamId)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .map(([id]) => id)
    while (!this.writePacked(teamId, packed)) {
      const oldest = others.pop()
      if (!oldest) return
      delete runs[oldest]
      this.dropRun(oldest)
    }
    this.packedRuns.set(teamId, packed)
    runs[teamId] = { savedAt: run.savedAt, members: [...run.members] }
    for (const id of others.slice(TEAM_KQM_RUNS_KEPT - 1)) {
      delete runs[id]
      this.dropRun(id)
    }
    this.writeIndex(runs)
  }
  /** A run's packed form under its key; false when the browser's storage is full */
  private writePacked(teamId: string, packed: string) {
    try {
      this.database.storage.setString(runStorageKey(teamId), packed)
      return true
    } catch (e) {
      // (QuotaExceededError: the storage keeps what it had)
      if (e instanceof DOMException) return false
      throw e
    }
  }
  private dropRun(teamId: string) {
    this.packedRuns.delete(teamId)
    this.database.storage.remove(runStorageKey(teamId))
  }
  private writeIndex(runs: ITeamKqmResultsEntry['runs']) {
    try {
      this.set({ runs })
    } catch (e) {
      if (!(e instanceof DOMException)) throw e
    }
  }
  // Runs are this browser's work for its teams (team ids that a GOOD import changes): never part
  // of a GOOD export or import
  override exportGOOD() {}
  override importGOOD() {}
}
