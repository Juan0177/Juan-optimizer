import type {
  ArtifactSetKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'

/*
 * The KQM search kernel: a member's free rolls, main stats and sets for one compiled problem
 * (the team's damage as a function of that member's artifact stats). It has no database or
 * sheet code, so that it also runs in the KQM workers (`worker.ts`).
 */

/** Rolls placed freely on top of the fixed ones (KQMS) */
export const KQM_ROLLS = 20
/**
 * Distributed rolls a stat may get per piece whose main stat is not that stat: 2 at KQMS's 20,
 * one more per 10 rolls in a higher standard (rounded up), at most the game's 5 upgrades a piece
 */
export const kqmPieceCap = (rolls = KQM_ROLLS) =>
  Math.min(5, Math.max(1, Math.ceil(rolls / 10)))
/** A distributed-roll budget as set (absent or invalid: KQMS's 20) */
export const kqmRollBudget = (rolls?: number) =>
  rolls !== undefined && Number.isFinite(rolls) && rolls >= 0
    ? Math.round(rolls)
    : KQM_ROLLS
/** Fixed rolls of every substat (KQMS) */
export const KQM_FIXED_ROLLS = 2
/** Main stats kept after the screening of a set's main stats, then searched with refined rolls */
export const MAINS_SEARCHED = 6

/** Published five-star average-roll scalars (KQMS 3.0). Percent stats use fractions, as the calculation graph expects. */
export const KQM_SUBSTAT_ROLLS: Record<SubstatKey, number> = {
  hp_: 0.0496,
  hp: 253.94,
  atk_: 0.0496,
  atk: 16.54,
  def_: 0.062,
  def: 19.68,
  eleMas: 19.82,
  critRate_: 0.0331,
  critDMG_: 0.0662,
  enerRech_: 0.0551,
}
const subRoll = (key: SubstatKey) => KQM_SUBSTAT_ROLLS[key]

export interface KqmMains {
  sands: MainStatKey
  goblet: MainStatKey
  circlet: MainStatKey
  /**
   * With four 4★ pieces (a 4★ set's 4-piece bonus, or two 4★ 2-piece bonuses): the slot of the
   * one 5★ piece (default: the circlet). The flower and plume are 4★ first.
   */
  off?: 'sands' | 'goblet' | 'circlet'
}
/** Set piece counts: one set at 4, two at 2 (2+2), or none */
export type KqmSets = Partial<Record<ArtifactSetKey, number>>
/** The rolls placed freely, per substat (the fixed 2 of each are not in it) */
export type KqmRolls = Partial<Record<SubstatKey, number>>
/**
 * A 5★ +20 main stat's value, per main stat (`getMainStatValue(key, 5, 20)`); and for builds with
 * 4★ sets, which sets those are and a 4★ +16 main stat's values
 */
export type KqmMainValues = Partial<Record<MainStatKey, number>> & {
  fourStarSets?: readonly string[]
  fourStarMains?: Partial<Record<MainStatKey, number>>
}

/** KQMS: a 4★ artifact's stats count 0.8 of a 5★ one's */
export const KQM_FOUR_STAR_SCALE = 0.8
/** KQMS: each 4★ artifact has 2 fewer distributed rolls */
export const KQM_FOUR_STAR_ROLLS_LESS = 2
const OFF_SLOTS = ['sands', 'goblet', 'circlet'] as const

/** How many of a build's five artifacts are 4★: the pieces of its 4★ sets */
export function kqmFourStarPieces(
  sets: KqmSets,
  mainValues: KqmMainValues
): number {
  const four = mainValues.fourStarSets
  if (!four?.length) return 0
  let n = 0
  for (const [k, count] of Object.entries(sets))
    if (count && four.includes(k)) n += count
  return Math.min(4, n)
}
/**
 * KQMS for a build's artifact rarities: its substats' scale (the average of 1 a 5★ piece and 0.8
 * a 4★ one) and its distributed rolls (2 fewer a 4★ piece)
 */
export function kqmRarity(
  sets: KqmSets,
  mainValues: KqmMainValues,
  /** The standard's distributed rolls (KQMS: 20) */
  budget = KQM_ROLLS
) {
  const four = kqmFourStarPieces(sets, mainValues)
  return {
    four,
    subScale: (5 - four + KQM_FOUR_STAR_SCALE * four) / 5,
    rolls: Math.max(0, budget - KQM_FOUR_STAR_ROLLS_LESS * four),
  }
}

const slotMains = (m: KqmMains): MainStatKey[] => [
  'hp',
  'atk',
  m.sands,
  m.goblet,
  m.circlet,
]
/** How many free rolls a substat may get with these main stats */
export function kqmRollCaps(
  mains: KqmMains,
  /** The standard's distributed rolls (KQMS: 20), for its per-piece cap */
  budget = KQM_ROLLS
): Record<SubstatKey, number> {
  const all = slotMains(mains)
  return Object.fromEntries(
    allSubstatKeys.map((k) => [
      k,
      (5 - all.filter((s) => s === k).length) * kqmPieceCap(budget),
    ])
  ) as Record<SubstatKey, number>
}
export function cappedRolls(
  rolls: KqmRolls,
  mains: KqmMains,
  budget = KQM_ROLLS
): KqmRolls {
  const caps = kqmRollCaps(mains, budget)
  const out: KqmRolls = {}
  for (const [k, n] of Object.entries(rolls) as [SubstatKey, number][])
    if (n > 0) out[k] = Math.min(n, caps[k])
  return out
}

/** A build's artifact stats, as the solver reads them (`dyn`: fractions for % stats) */
export function kqmStatValues(
  build: { sets: KqmSets; mains: KqmMains; rolls: KqmRolls },
  mainValues: KqmMainValues
): Record<string, number> {
  const values: Record<string, number> = {}
  const { four, subScale } = kqmRarity(build.sets, mainValues)
  for (const k of allSubstatKeys)
    values[k] =
      (KQM_FIXED_ROLLS + (build.rolls[k] ?? 0)) * subRoll(k) * subScale
  // the 4★ pieces: the flower and plume first, then all but the 5★ off-piece
  const off = build.mains.off ?? 'circlet'
  const slots = slotMains(build.mains)
  const slotIsFour = [
    four >= 1,
    four >= 2,
    four >= 4 && off !== 'sands',
    four >= 4 && off !== 'goblet',
    four >= 4 && off !== 'circlet',
  ]
  slots.forEach((k, i) => {
    const main = slotIsFour[i]
      ? (mainValues.fourStarMains?.[k] ?? 0)
      : (mainValues[k] ?? 0)
    values[k] = (values[k] ?? 0) + main
  })
  for (const [k, n] of Object.entries(build.sets)) if (n) values[k] = n
  return values
}

/** A compiled problem as it is sent to a worker */
export interface KqmProblemSpec {
  id: string
  /** `precomputeSource` of the damage terms, then the requirements */
  source: string
  nTerms: number
  mins: number[]
  /** The stats the damage or a requirement reads */
  scales: string[]
  /** The artifact standard's distributed rolls (absent: KQMS's 20) */
  rolls?: number
}
/** The rotation's damage and a member's requirements as a function of its artifacts */
export interface KqmProblem {
  /** Team damage, and each requirement's value */
  run: (values: Record<string, number>) => { total: number; cons: number[] }
  /**
   * Every formula's value (the damage terms, then the requirements) in one array, the same one
   * each time: no garbage in the search's millions of calls
   */
  values: (values: Record<string, number>) => Float64Array
  /**
   * `values` from the stats as an array (`columns` order), the same one each time: what the
   * search's hot loop uses (stats read by name from an object cost several times the arithmetic)
   */
  valuesAt: (stats: Float64Array) => Float64Array
  /** The stats the formulas read, in the order of `valuesAt`'s array */
  columns: readonly string[]
  /** A stat's place in that array (-1: nothing reads it) */
  columnOf: (key: string) => number
  /** These stats as such an array (absent ones 0, as the formulas read them) */
  statsOf: (values: Record<string, number>) => Float64Array
  nTerms: number
  mins: number[]
  scales: Set<string>
  /** The artifact standard's distributed rolls (absent: KQMS's 20) */
  rolls?: number
}
/** `precompute`'s read of a stat (one artifact slot, no initial value), as KQM compiles it */
const STAT_READ = /\(b\[0\]\.values\["([^"]*)"\] \?\? 0\)/g
export function kqmProblem(spec: Omit<KqmProblemSpec, 'id'>): KqmProblem {
  // The optimizer's compiled formulas, as `precompute` makes them, but writing their values into
  // one array (`o`) instead of returning a new one each call
  const source = spec.source.replace(
    /return \[([^\]]*)\]\s*$/,
    (_, list: string) =>
      `${list
        .split(',')
        .map((name, i) => `o[${i}]=${name};`)
        .join('')}return o`
  )
  const { nTerms, mins } = spec
  const out = new Float64Array(nTerms + mins.length)
  // ...and reading the stats from an array, one entry per stat read (`V[j]`), instead of by name
  // from an object (`b[0].values["key"] ?? 0`): the search's stat objects hold a different set of
  // keys per set and main stat, and those reads cost several times the arithmetic. The same
  // values either way: `statsOf` keeps the `?? 0`, and the formulas read each stat once.
  const columns: string[] = []
  const index = new Map<string, number>()
  const arraySource = source.replace(STAT_READ, (_, key: string) => {
    let j = index.get(key)
    if (j === undefined) {
      j = columns.length
      index.set(key, j)
      columns.push(key)
    }
    return `V[${j}]`
  })
  const statsOf = (
    v: Record<string, number>,
    into = new Float64Array(columns.length)
  ) => {
    for (let j = 0; j < columns.length; j++) into[j] = v[columns[j]] ?? 0
    return into
  }
  let valuesAt: (stats: Float64Array) => Float64Array
  let values: (v: Record<string, number>) => Float64Array
  if (/\bb\[/.test(arraySource)) {
    // (a read in another form: by name, as `precompute` wrote them, the array's stats included)
    for (const key of spec.scales)
      if (!index.has(key)) index.set(key, columns.push(key) - 1)
    const compute = new Function('b', 'o', source) as (
      b: { values: Record<string, number> }[],
      o: Float64Array
    ) => Float64Array
    const arg = [{ values: {} as Record<string, number> }]
    values = (v) => {
      arg[0].values = v
      return compute(arg, out)
    }
    valuesAt = (stats) =>
      values(Object.fromEntries(columns.map((k, j) => [k, stats[j]])))
  } else {
    const compute = new Function('V', 'o', arraySource) as (
      V: Float64Array,
      o: Float64Array
    ) => Float64Array
    const scratch = new Float64Array(columns.length)
    valuesAt = (stats) => compute(stats, out)
    values = (v) => compute(statsOf(v, scratch), out)
  }
  return {
    run: (v) => {
      const o = values(v)
      let total = 0
      for (let i = 0; i < nTerms; i++) total += o[i] || 0
      return { total, cons: Array.from(o.subarray(nTerms)) }
    },
    values,
    valuesAt,
    columns,
    columnOf: (key) => index.get(key) ?? -1,
    statsOf: (v) => statsOf(v),
    nTerms,
    mins,
    scales: new Set(spec.scales),
    rolls: kqmRollBudget(spec.rolls),
  }
}

export interface KqmScore {
  total: number
  /** How far the requirements are from being met (0: met), relative */
  deficit: number
}
export const DEFICIT_TOL = 1e-9
/** Whether `a` is better than `b`: closer to the requirements, then more damage */
export const betterScore = (a: KqmScore, b: KqmScore) =>
  a.deficit < b.deficit - DEFICIT_TOL ||
  (a.deficit <= b.deficit + DEFICIT_TOL &&
    a.total > b.total + Math.abs(b.total) * 1e-12)
/** Best first (a stable order for ties) */
export const compareScores = (a: KqmScore, b: KqmScore) =>
  betterScore(a, b) ? -1 : betterScore(b, a) ? 1 : 0

export function scoreOf(
  problem: KqmProblem,
  values: Record<string, number>
): KqmScore {
  return scoreFrom(problem, problem.values(values))
}
/** `scoreOf` from the stats as an array (`problem.columns` order; see `KqmProblem.valuesAt`) */
export function scoreAt(problem: KqmProblem, stats: Float64Array): KqmScore {
  return scoreFrom(problem, problem.valuesAt(stats))
}
/** The score of the formulas' values: the damage terms' sum, and how far the requirements are */
function scoreFrom(problem: KqmProblem, o: Float64Array): KqmScore {
  const { nTerms, mins } = problem
  let total = 0
  for (let i = 0; i < nTerms; i++) total += o[i] || 0
  let deficit = 0
  for (let j = 0; j < mins.length; j++) {
    const v = o[nTerms + j]
    const min = mins[j]
    if (!(v >= min)) deficit += (min - (v || 0)) / Math.max(Math.abs(min), 1e-9)
  }
  return { total, deficit }
}

/**
 * The free rolls for these sets and main stats: greedily, the requirements first, then each
 * roll where it adds most; then single rolls moved while that helps.
 */
export function placeRolls(
  problem: KqmProblem,
  sets: KqmSets,
  given: KqmMains,
  mainValues: KqmMainValues,
  refine = true
): { rolls: KqmRolls; score: KqmScore; mains: KqmMains } {
  const rarity = kqmRarity(sets, mainValues, problem.rolls)
  // four 4★ pieces: each slot tried as the one 5★ off-piece, the best kept
  if (rarity.four >= 4 && !given.off) {
    let best: ReturnType<typeof placeRolls> | undefined
    for (const off of OFF_SLOTS) {
      const found = placeRolls(
        problem,
        sets,
        { ...given, off },
        mainValues,
        refine
      )
      if (!best || betterScore(found.score, best.score)) best = found
    }
    return best!
  }
  const mains = given
  const budget = rarity.rolls
  const subRoll = (key: SubstatKey) => KQM_SUBSTAT_ROLLS[key] * rarity.subScale
  const caps = kqmRollCaps(mains, problem.rolls)
  const subs = allSubstatKeys.filter(
    (k) => caps[k] > 0 && problem.scales.has(k)
  )
  const rolls: KqmRolls = {}
  // the stats as the formulas read them (an array, changed in place: see `KqmProblem.valuesAt`)
  const stats = problem.statsOf(
    kqmStatValues({ sets, mains, rolls }, mainValues)
  )
  const column: Partial<Record<SubstatKey, number>> = {}
  for (const k of allSubstatKeys) column[k] = problem.columnOf(k)
  let score = scoreAt(problem, stats)

  const add = (k: SubstatKey, n: number) => {
    // (a stat nothing reads changes nothing)
    const j = column[k]!
    if (j >= 0) stats[j] += n * subRoll(k)
    rolls[k] = (rolls[k] ?? 0) + n
  }
  for (let i = 0; i < budget; i++) {
    let best: SubstatKey | undefined
    let bestScore: KqmScore | undefined
    for (const k of subs) {
      if ((rolls[k] ?? 0) >= caps[k]) continue
      add(k, 1)
      const s = scoreAt(problem, stats)
      add(k, -1)
      if (!bestScore || betterScore(s, bestScore)) (best = k), (bestScore = s)
    }
    if (!best || !bestScore) break
    add(best, 1)
    score = bestScore
  }
  // a roll moved from one substat to another, while one helps
  for (let iter = 0; refine && iter < 40; iter++) {
    let move: [SubstatKey, SubstatKey] | undefined
    let moveScore = score
    for (const a of subs) {
      if (!(rolls[a] ?? 0)) continue
      for (const b of subs) {
        if (a === b || (rolls[b] ?? 0) >= caps[b]) continue
        add(a, -1)
        add(b, 1)
        const s = scoreAt(problem, stats)
        add(b, -1)
        add(a, 1)
        if (betterScore(s, moveScore)) (move = [a, b]), (moveScore = s)
      }
    }
    if (!move) break
    add(move[0], -1)
    add(move[1], 1)
    score = moveScore
  }
  // KQMS requires all the distributed rolls, including harmless filler when useful stats cap out.
  let remaining =
    budget - Object.values(rolls).reduce((sum, n) => sum + (n ?? 0), 0)
  for (const key of allSubstatKeys) {
    if (!remaining) break
    const count = Math.min(remaining, caps[key] - (rolls[key] ?? 0))
    if (count > 0) {
      add(key, count)
      remaining -= count
    }
  }
  score = scoreAt(problem, stats)
  for (const k of Object.keys(rolls) as SubstatKey[])
    if (!rolls[k]) delete rolls[k]
  return { rolls, score, mains }
}

/**
 * Main stat choices that score the same for this problem count once: a main stat nothing reads
 * (an HP% sands for an ATK scaler) is as good as any other unread one. The first of each kind is
 * kept (the one the full search would pick on a tie).
 */
export function distinctMains(
  problem: KqmProblem,
  mains: readonly KqmMains[]
): KqmMains[] {
  const seen = new Set<string>()
  return mains.filter((m) => {
    const id = [m.sands, m.goblet, m.circlet]
      .map((k) => (problem.scales.has(k) ? k : '-'))
      .sort()
      .join('+')
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export interface KqmSetSearch {
  mains: KqmMains
  rolls: KqmRolls
  score: KqmScore
  /** Builds tried (main stats screened and refined) */
  tried: number
}
/**
 * The best main stats and rolls with these sets: every main stat choice screened with greedy
 * rolls, the best few searched with rolls moved
 */
export function searchSet(
  problem: KqmProblem,
  sets: KqmSets,
  mains: readonly KqmMains[],
  mainValues: KqmMainValues,
  mainsSearched = MAINS_SEARCHED
): KqmSetSearch | undefined {
  const choices = distinctMains(problem, mains)
  const kept = choices
    // Allocate the roll budget before screening: an ATK sands can satisfy ER via substats.
    .map((m) => ({
      mains: m,
      score: placeRolls(problem, sets, m, mainValues, false).score,
    }))
    .sort((a, b) => compareScores(a.score, b.score))
    .slice(0, mainsSearched)
  let best: KqmSetSearch | undefined
  for (const { mains: m } of kept) {
    // (with four 4★ pieces, its main stats come back with the 5★ off-piece's slot)
    const {
      rolls,
      score,
      mains: placed,
    } = placeRolls(problem, sets, m, mainValues)
    if (!best || betterScore(score, best.score))
      best = { mains: placed, rolls, score, tried: 0 }
  }
  if (best) best.tried = choices.length + kept.length
  return best
}
