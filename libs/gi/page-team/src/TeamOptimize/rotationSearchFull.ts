import type {
  CharacterKey,
  GenderKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type {
  FrameData,
  KqmResult,
  RotationCandidate,
  RotationEditKinds,
  RotationMember,
  RotationScore,
  RotationSearchProgress,
  RotationSearchResult,
  RotationTimingSettings,
  RunAttackState,
} from '@genshin-optimizer/gi/ui'
import {
  energyFits,
  erCostOf,
  kqmErPrices,
  kqmRotationSearchSetup,
  mainMember,
  rotationGuard,
  rotationSearchPlayer,
  rotationWords,
  searchRotations,
  stepOrders,
  supportPart,
  swapRotationMembers,
  templatesForTeam,
  wordsRotationText,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { templateText } from './RotationTemplates'
import { kqmResultDps, kqmRotationRun } from './rotationConfirm'

/** The best rotations of a search that get their own KQM builds */
export const CONFIRMED = 3
/** Searches with the best rotation's own builds, at most */
const PASSES = 3
/** Starts besides the written rotation a pass climbs from (the best of the others it plays) */
const MORE_STARTS = 5

/**
 * The team's templates for its main DPS (`mainMember` of `seed`) as rotations for it: those of the
 * same team, then those whose other members are swapped for the team's (each playing its usual
 * support part, `supportPart`), at most `most`
 */
export function templateSeeds(
  seed: string,
  names: readonly RotationMember[],
  most = 4
): string[] {
  const keys = names.map((n) => n.characterKey)
  const main = mainMember(rotationWords(seed, names))
  const out: string[] = []
  for (const t of templatesForTeam(keys)) {
    if (out.length >= most) break
    if (t.characterKey !== main) continue
    const missing = t.members.filter((m) => !keys.includes(m))
    const free = keys.filter((k) => !t.members.includes(k))
    if (missing.length !== free.length) continue
    const text = missing.length
      ? swapRotationMembers(
          t.text,
          t.members.map((characterKey) => ({
            characterKey,
            name: characterKey,
          })),
          missing.map((from, i) => ({
            from,
            name: free[i],
            part: supportPart(free[i]),
          }))
        )
      : t.text
    const own = templateText(text, [...names])
    if (!out.includes(own)) out.push(own)
  }
  return out
}

/** Where a full search is */
export interface FullSearchStage {
  /** Its search with the builds of the best so far (1: the KQM run's) */
  pass: number
  phase: 'prices' | 'starts' | 'search' | 'builds'
  /** Of the starts climbed from, or of the builds being found */
  done?: number
  total?: number
}

/**
 * A full rotation search. Each pass plays the written rotation's steps in every other order and
 * the team's templates (`templateSeeds`), and climbs from the written rotation and the best of
 * those, each on its own (a start a change makes worse at first still gets its own climb), until
 * no change to the best is better and a round from more of them finds nothing either. The best few
 * of all then get their own KQM builds, and the best of them with its builds is searched again
 * (from it and the others with builds), until it stays the best. Rotations are ranked by their DPS
 * with their own builds (`confirmed`), against `result`'s for the written one.
 */
export async function fullRotationSearch({
  database,
  gender,
  i18n,
  teamId,
  names,
  teamOpt,
  result,
  saved,
  seed,
  kinds,
  attackStates,
  deadline,
  gains,
  pause,
  isCancelled,
  onStage,
  onProgress,
  onConfirmed,
  onThreads,
}: {
  database: ArtCharDatabase
  gender: GenderKey
  i18n: i18n
  teamId: string
  names: RotationMember[]
  /** The settings the KQM run was made with */
  teamOpt: TeamOpt
  /** The KQM run for the written rotation */
  result: KqmResult
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  seed: string
  kinds: RotationEditKinds
  attackStates?: readonly RunAttackState[]
  deadline: number
  /** What a roll adds for `result`'s builds, where known (`kqmErPrices`) */
  gains?: Partial<
    Record<CharacterKey, Partial<Record<SubstatKey, number | null>>>
  >
  pause?: () => Promise<void>
  isCancelled: () => boolean
  onStage?: (stage: FullSearchStage) => void
  onProgress?: (progress: RotationSearchProgress) => void
  onConfirmed?: (dps: Record<string, number | null>) => void
  onThreads?: (threads: number) => void
}): Promise<
  RotationSearchResult & {
    /** Each rotation's DPS with its own KQM builds (null: none found) */
    confirmed: Record<string, number | null>
    /** What the last pass's estimates are against (`best` without builds of their own) */
    from: RotationCandidate
  }
> {
  const runDps = kqmResultDps(result)
  const plan = rotationWords(seed, names)
  const written = wordsRotationText(plan)
  const guard = rotationGuard(plan)
  const confirmed: Record<string, number | null> = {}
  const runs = new Map<string, KqmResult>()
  const found = new Map<string, RotationCandidate>()
  const stop = () => isCancelled() || Date.now() > deadline
  let base = result
  let from = written
  let yours: RotationCandidate | undefined
  let last: RotationCandidate[] = []
  /** What the last pass's estimates are against: the rotation it searched from, with its builds */
  let lastFrom: RotationCandidate | undefined
  let played = 0
  let rounds = 0
  let ended: RotationSearchResult['ended'] = 'converged'
  for (let pass = 1; pass <= PASSES; pass++) {
    onStage?.({ pass, phase: 'prices' })
    const prices = await kqmErPrices(
      database,
      teamId,
      gender,
      teamOpt,
      base,
      pause,
      pass === 1 ? gains : {}
    ).catch(() => ({}))
    const erCost = erCostOf(prices)
    const funded = Object.fromEntries(
      Object.entries(base.energyRecharge).map(([k, er]) => [k, er?.value ?? 0])
    ) as Partial<Record<CharacterKey, number>>
    if (isCancelled()) {
      ended = 'cancelled'
      break
    }
    const player = rotationSearchPlayer(
      database,
      kqmRotationSearchSetup(
        database,
        teamId,
        gender,
        names,
        teamOpt,
        base,
        saved
      )
    )
    onThreads?.(player.threads())
    const pool = new Map<string, RotationCandidate>()
    try {
      // (what the pass measures from: the rotation it starts from, with its builds)
      onStage?.({ pass, phase: 'starts' })
      const [reference] = await player.score([from], undefined, stop)
      if (!reference) {
        ended = isCancelled() ? 'cancelled' : 'time'
        break
      }
      lastFrom = { text: from, ...reference, estimate: reference.dps }
      if (pass === 1) yours = lastFrom
      const fits = energyFits(reference, 20, funded)
      const estimate = (s: RotationScore) =>
        s.dps + erCost(reference) - erCost(s)
      // (every other order of its steps and the templates on the first pass; the others with
      // their own builds after)
      const others = [
        ...new Set(
          pass === 1
            ? [
                ...stepOrders(rotationWords(from, names))
                  .filter(guard)
                  .map(wordsRotationText),
                ...templateSeeds(seed, names),
              ]
            : Object.keys(confirmed).filter((t) => confirmed[t] !== null)
        ),
      ].filter((t) => t !== from)
      const scores = others.length
        ? await player.score(others, undefined, stop)
        : []
      played += 1 + scores.filter(Boolean).length
      const starts = [
        from,
        ...others
          .flatMap((text, i) => {
            const s = scores[i]
            return s && s.dps > 0 && fits(s)
              ? [{ text, worth: estimate(s) }]
              : []
          })
          .sort((a, b) => b.worth - a.worth)
          .slice(0, MORE_STARTS)
          .map((c) => c.text),
      ]
      for (const [i, start] of starts.entries()) {
        if (stop()) {
          ended = isCancelled() ? 'cancelled' : 'time'
          break
        }
        onStage?.({ pass, phase: 'search', done: i, total: starts.length })
        const search = await searchRotations({
          seed: start,
          plan: seed,
          reference,
          members: names,
          score: player.score,
          deadline,
          maxRounds: 40,
          keep: 6,
          widen: 24,
          funded,
          erCost,
          kinds,
          isCancelled,
          onProgress,
        })
        played += search.played
        rounds += search.rounds
        for (const c of search.best) {
          const had = pool.get(c.text)
          if (!had || had.estimate < c.estimate) pool.set(c.text, c)
        }
        if (search.ended === 'cancelled') {
          ended = 'cancelled'
          break
        }
        // (out of time: the best so far still get their own builds)
        if (search.ended === 'time') {
          ended = 'time'
          break
        }
      }
    } finally {
      player.release()
    }
    last = [...pool.values()].sort((a, b) => b.estimate - a.estimate)
    for (const c of last) found.set(c.text, c)
    if (isCancelled()) {
      ended = 'cancelled'
      break
    }
    // (the best few that have no builds of their own yet)
    const best = last
      .filter((c) => c.text !== written && !(c.text in confirmed))
      .slice(0, CONFIRMED)
    for (const [i, c] of best.entries()) {
      onStage?.({ pass, phase: 'builds', done: i, total: best.length })
      const run = await kqmRotationRun({
        database,
        gender,
        i18n,
        teamId,
        teamOpt,
        text: c.text,
        attackStates,
        isCancelled,
      }).catch(() => undefined)
      if (isCancelled()) break
      confirmed[c.text] = run ? kqmResultDps(run) : null
      if (run) runs.set(c.text, run)
      onConfirmed?.({ ...confirmed })
    }
    if (isCancelled()) {
      ended = 'cancelled'
      break
    }
    // (the best with its own builds: searched again with them, unless it is the one just searched
    // from, or none beats the written rotation)
    const [top] = Object.entries(confirmed)
      .flatMap(([text, dps]) => (dps === null ? [] : [{ text, dps }]))
      .sort((a, b) => b.dps - a.dps)
    if (!top || top.dps <= runDps * (1 + 1e-4) || top.text === from) break
    if (ended === 'time' || Date.now() > deadline) {
      ended = 'time'
      break
    }
    from = top.text
    base = runs.get(top.text)!
  }
  if (!yours) throw new Error('The rotation could not be played.')
  // (those with their own builds, then the last pass's best)
  const best = [
    ...[...found.values()].filter((c) => c.text in confirmed),
    ...last.filter((c) => !(c.text in confirmed)),
  ]
  return {
    seed: yours,
    best,
    played,
    rounds,
    ended,
    confirmed,
    from: lastFrom ?? yours,
  }
}
