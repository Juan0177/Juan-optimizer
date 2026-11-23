import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamKqmSavedRun } from '@genshin-optimizer/gi/db'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import {
  kqmRotationId,
  memberNamesOf,
  writtenRotationOf,
} from '../RotationWriter'
import { type SavedKqmRun, savedRunOf } from './savedRun'
import { type Side, sideOf } from './sides'
import { memberTurn } from './rotationTurns'

/*
 * juanlab: the comparison card of a team's versions: the original (A) against one of its versions
 * (B), each from the KQM result KQM Theorycrafting saved for it. Nothing is computed again and
 * nothing is written.
 */

/** A member of the original and who is in its slot in the version (the same one: other constellation) */
export interface SidePair {
  out: CharacterKey
  in: CharacterKey
}

export type VersionCompareError =
  /** The original has no finished KQM result for its members now */
  | 'noResultA'
  /** The version has none */
  | 'noResultB'

/** A team's saved KQM run: a finished one, for the team's members now (else undefined) */
export function savedRunFor(
  database: ArtCharDatabase,
  teamId: string
): TeamKqmSavedRun | undefined {
  const saved = database.teamKqmResults.getRun(teamId)
  if (!saved) return undefined
  const run = savedRunOf(saved)
  if (run.type !== 'done' || !run.result || !run.teamOpt) return undefined
  const members = teamOptMembers(database, teamId).map(
    (m) => m.characterKey as string
  )
  if (
    saved.members.length !== members.length ||
    !saved.members.every((k) => members.includes(k))
  )
    return undefined
  return saved
}

/**
 * The rotation a run played, as it recorded it ("text|opener and timing": its text); a run that
 * recorded none, the team's KQM rotation as written now
 */
const playedText = (database: ArtCharDatabase, teamId: string, run: SavedKqmRun) =>
  run.teamOpt?.kqm?.energyRotation?.split('|')[0]?.trim() ||
  writtenRotationOf(database, kqmRotationId(teamId)).text

/**
 * The original (`rootId`) against a version (`teamId`): both sides from their saved results, the
 * members compared slot by slot (a version keeps the original's slots): each slot with another
 * member, or the same one at another constellation, is a pair; each pair's turns marked in each
 * side's rotation.
 */
export function versionComparison(
  database: ArtCharDatabase,
  rootId: string,
  teamId: string,
  { i18n, gender }: { i18n: i18n; gender: GenderKey }
): { a: Side; b: Side; pairs: SidePair[] } | { error: VersionCompareError } {
  const savedA = savedRunFor(database, rootId)
  if (!savedA) return { error: 'noResultA' }
  const savedB = savedRunFor(database, teamId)
  if (!savedB) return { error: 'noResultB' }
  const runA = savedRunOf(savedA)
  const runB = savedRunOf(savedB)
  const keysA = teamOptMembers(database, rootId).map((m) => m.characterKey)
  const keysB = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const consA = runA.result.constellations ?? {}
  const consB = runB.result.constellations ?? {}
  const pairs: SidePair[] = keysA.flatMap((out, i) => {
    const into = keysB[i]
    if (!into) return []
    if (into !== out) return [{ out, in: into }]
    return (consA[out] ?? 0) !== (consB[out] ?? 0) ? [{ out, in: out }] : []
  })
  const fixed = keysA.filter(
    (k) => keysB.includes(k) && !pairs.some((p) => p.out === k)
  )
  const textA = playedText(database, rootId, runA)
  const textB = playedText(database, teamId, runB)
  const namesA = memberNamesOf(
    keysA.map((characterKey) => ({ characterKey })),
    i18n,
    gender
  )
  const namesB = memberNamesOf(
    keysB.map((characterKey) => ({ characterKey })),
    i18n,
    gender
  )
  const turns = (text: string, names: typeof namesA, keys: CharacterKey[]) =>
    [
      ...new Set(
        keys.flatMap((k) => {
          const turn = memberTurn(text, names, k)
          return turn === undefined ? [] : [turn]
        })
      ),
    ].sort((x, y) => x - y)
  const sideFor = (
    run: SavedKqmRun,
    text: string,
    keys: CharacterKey[],
    changed: CharacterKey[],
    names: typeof namesA
  ): Side => ({
    ...sideOf(
      run.result,
      text,
      fixed,
      run.runTeamOpt?.rotationTime ?? run.teamOpt?.rotationTime,
      run.teamOpt ?? run.runTeamOpt,
      keys
    ),
    turns: turns(text, names, changed),
  })
  return {
    a: sideFor(
      runA,
      textA,
      keysA,
      pairs.map((p) => p.out),
      namesA
    ),
    b: sideFor(
      runB,
      textB,
      keysB,
      pairs.map((p) => p.in),
      namesB
    ),
    pairs,
  }
}
