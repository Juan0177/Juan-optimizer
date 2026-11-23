import type {
  ArtifactSetKey,
  KqmStandardKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allKqmStandardKeys,
  allSubstatKeys,
  kqmCustomRollRange,
} from '@genshin-optimizer/gi/consts'

/*
 * The KQM search kernel: a member's free rolls, main stats and sets for one compiled problem
 * (the team's damage as a function of that member's artifact stats). It has no database or
 * sheet code, so that it also runs in the KQM workers (`worker.ts`).
 */

/** Rolls placed freely on top of the fixed ones (KQMS) */
export const KQM_ROLLS = 20
/** KQMS: distributed rolls a stat may get per piece whose main stat is not that stat */
export const KQM_PIECE_CAP = 2
/** Fixed rolls of every substat (KQMS) */
export const KQM_FIXED_ROLLS = 2

export const KQM_STANDARDS = allKqmStandardKeys
/** A named standard, or Custom: how many of the set's 45 rolls land on wanted stats */
export type KqmStandard = KqmStandardKey | number
/** Custom's range of wanted rolls */
export const KQM_CUSTOM_ROLLS = kqmCustomRollRange
/**
 * A tier's five artifacts, each modelled as the game makes them: 4 lines (substats other than its
 * main stat, each 1 roll) and upgrades (5 at +20; 4 when it started with 3 lines). Of each
 * piece's lines, `lines` are on stats the build wants and the rest random (spread evenly over the
 * substats it can still have, as KQMS's fixed rolls are); of its upgrades, `ups` land on those
 * wanted lines and the rest on any of its 4 lines at even odds (the game's rule). `highest`: every
 * roll at its highest value instead of the average.
 */
export interface KqmTier {
  /** A piece's rolls: its 4 lines and its upgrades */
  pieceRolls: number
  lines: number
  ups: number
  highest?: boolean
  /** Custom: each piece's own wanted lines and upgrades (flower to circlet) */
  pieces?: readonly { lines: number; ups: number }[]
}
export const KQM_TIERS: Record<Exclude<KqmStandardKey, 'kqms'>, KqmTier> = {
  good: { pieceRolls: 8, lines: 2, ups: 3 },
  great: { pieceRolls: 9, lines: 3, ups: 4 },
  top: { pieceRolls: 9, lines: 4, ups: 5 },
  perfect: { pieceRolls: 9, lines: 4, ups: 5, highest: true },
}
const customTiers = new Map<number, KqmTier>()
/**
 * Custom: `wanted` of the set's 45 rolls (9 a piece) on wanted stats, an even share a piece (the
 * flower's first for what does not divide by 5), each piece's share its wanted lines first, then
 * upgrades on them (as the tiers split theirs: 5 is 2 lines and 3 upgrades, 7 is 3 and 4, 9 is 4
 * and 5); the rest random
 */
export function kqmCustomTier(wanted: number): KqmTier {
  let tier = customTiers.get(wanted)
  if (!tier) {
    const pieces = [0, 1, 2, 3, 4].map((i) => {
      const w = Math.floor(wanted / 5) + (i < wanted % 5 ? 1 : 0)
      const lines =
        w > 0 ? Math.max(1, Math.min(4, Math.round((w * 4) / 9))) : 0
      return { lines, ups: w - lines }
    })
    tier = {
      pieceRolls: 9,
      lines: Math.max(...pieces.map((p) => p.lines)),
      ups: Math.max(...pieces.map((p) => p.ups)),
      pieces,
    }
    customTiers.set(wanted, tier)
  }
  return tier
}
/** A standard's tier (undefined: KQMS) */
export const kqmTier = (standard?: KqmStandard): KqmTier | undefined =>
  typeof standard === 'number'
    ? kqmCustomTier(standard)
    : standard && standard !== 'kqms'
      ? KQM_TIERS[standard]
      : undefined
/** A standard as set (absent or unknown: KQMS; Custom's rolls within its range) */
export const kqmStandardOf = (standard?: unknown): KqmStandard =>
  typeof standard === 'number' && Number.isFinite(standard)
    ? Math.min(
        KQM_CUSTOM_ROLLS.max,
        Math.max(KQM_CUSTOM_ROLLS.min, Math.round(standard))
      )
    : (KQM_STANDARDS as readonly unknown[]).includes(standard)
      ? (standard as KqmStandardKey)
      : 'kqms'
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
/** A five-star roll's highest value (the game's top tier) */
export const KQM_SUBSTAT_MAX: Record<SubstatKey, number> = {
  hp_: 0.0583,
  hp: 298.75,
  atk_: 0.0583,
  atk: 19.45,
  def_: 0.0729,
  def: 23.15,
  eleMas: 23.31,
  critRate_: 0.0389,
  critDMG_: 0.0777,
  enerRech_: 0.0648,
}
/** A roll's value in a standard (a 5★ one: a tier's rolls count 4★ pieces' at 0.8 already) */
export const kqmRollValue = (key: SubstatKey, standard?: KqmStandard) =>
  (kqmTier(standard)?.highest ? KQM_SUBSTAT_MAX : KQM_SUBSTAT_ROLLS)[key]

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
/**
 * The rolls placed freely, per substat: in KQMS on top of the fixed 2 of each; in a tier every
 * roll the set has, its random lines' and upgrades' expected share included, a 4★ piece's counted
 * at 0.8 (so fractional)
 */
export type KqmRolls = Partial<Record<SubstatKey, number>>
/** A tier's piece (flower, plume, sands, goblet, circlet): its wanted lines and their upgrades */
export interface KqmPiece {
  lines: SubstatKey[]
  ups: KqmRolls
}
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
export function kqmRarity(sets: KqmSets, mainValues: KqmMainValues) {
  const four = kqmFourStarPieces(sets, mainValues)
  return {
    four,
    subScale: (5 - four + KQM_FOUR_STAR_SCALE * four) / 5,
    rolls: Math.max(0, KQM_ROLLS - KQM_FOUR_STAR_ROLLS_LESS * four),
  }
}
/** Which of the five pieces are 4★: the flower and plume first, then all but the 5★ off-piece */
const fourStarSlots = (four: number, mains: KqmMains) => {
  const off = mains.off ?? 'circlet'
  return [
    four >= 1,
    four >= 2,
    four >= 4 && off !== 'sands',
    four >= 4 && off !== 'goblet',
    four >= 4 && off !== 'circlet',
  ]
}

const slotMains = (m: KqmMains): MainStatKey[] => [
  'hp',
  'atk',
  m.sands,
  m.goblet,
  m.circlet,
]
/**
 * How many free rolls a substat may get with these main stats: KQMS's 2 a piece; in a tier what a
 * piece can hold of one stat (its line and every upgrade)
 */
export function kqmRollCaps(
  mains: KqmMains,
  standard?: KqmStandard
): Record<SubstatKey, number> {
  const all = slotMains(mains)
  const tier = kqmTier(standard)
  const perPiece = tier ? tier.pieceRolls - 3 : KQM_PIECE_CAP
  return Object.fromEntries(
    allSubstatKeys.map((k) => [
      k,
      (5 - all.filter((s) => s === k).length) * perPiece,
    ])
  ) as Record<SubstatKey, number>
}
export function cappedRolls(
  rolls: KqmRolls,
  mains: KqmMains,
  standard?: KqmStandard
): KqmRolls {
  const caps = kqmRollCaps(mains, standard)
  const out: KqmRolls = {}
  for (const [k, n] of Object.entries(rolls) as [SubstatKey, number][])
    if (n > 0) out[k] = Math.min(n, caps[k])
  return out
}

/** A build's artifact stats, as the solver reads them (`dyn`: fractions for % stats) */
export function kqmStatValues(
  build: {
    sets: KqmSets
    mains: KqmMains
    rolls: KqmRolls
    standard?: KqmStandard
  },
  mainValues: KqmMainValues
): Record<string, number> {
  const values: Record<string, number> = {}
  const { four, subScale } = kqmRarity(build.sets, mainValues)
  if (kqmTier(build.standard))
    for (const k of allSubstatKeys)
      values[k] = (build.rolls[k] ?? 0) * kqmRollValue(k, build.standard)
  else
    for (const k of allSubstatKeys)
      values[k] =
        (KQM_FIXED_ROLLS + (build.rolls[k] ?? 0)) * subRoll(k) * subScale
  const slots = slotMains(build.mains)
  const slotIsFour = fourStarSlots(four, build.mains)
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
  /** The artifact standard (absent: KQMS) */
  standard?: KqmStandard
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
  /** The artifact standard */
  standard: KqmStandard
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
    standard: kqmStandardOf(spec.standard),
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
): {
  rolls: KqmRolls
  score: KqmScore
  mains: KqmMains
  layout?: KqmPiece[]
} {
  const rarity = kqmRarity(sets, mainValues)
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
  const tier = kqmTier(problem.standard)
  if (tier)
    return placeTierRolls(problem, sets, given, mainValues, tier, refine)
  const mains = given
  const budget = rarity.rolls
  const subRoll = (key: SubstatKey) => KQM_SUBSTAT_ROLLS[key] * rarity.subScale
  const caps = kqmRollCaps(mains)
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

/** A tier's piece as the search sees it: what it can roll, how many upgrades, its scale */
interface PieceSpec {
  /** The substats it can have (not its main stat), in `allSubstatKeys` order */
  eligible: SubstatKey[]
  /** Upgrades landing on its wanted lines, and on any line at even odds */
  /** Its lines on wanted stats */
  lines: number
  wantedUps: number
  randomUps: number
  /** 0.8 for a 4★ piece */
  scale: number
  /** Pieces with the same `kind` and the same lines are interchangeable */
  kind: string
}
function pieceSpecs(
  sets: KqmSets,
  mains: KqmMains,
  mainValues: KqmMainValues,
  tier: KqmTier
): PieceSpec[] {
  const four = fourStarSlots(kqmFourStarPieces(sets, mainValues), mains)
  return slotMains(mains).map((main, i) => {
    // a 4★ piece: 2 fewer upgrades (the random ones first), its rolls 0.8 of a 5★ one's
    const ups = tier.pieceRolls - 4 - (four[i] ? KQM_FOUR_STAR_ROLLS_LESS : 0)
    const wantedUps = Math.min(tier.pieces?.[i].ups ?? tier.ups, ups)
    const eligible = allSubstatKeys.filter((k) => k !== main)
    return {
      eligible,
      lines: tier.pieces?.[i].lines ?? tier.lines,
      wantedUps,
      randomUps: ups - wantedUps,
      scale: four[i] ? KQM_FOUR_STAR_SCALE : 1,
      kind: `${eligible.length < allSubstatKeys.length ? main : '-'}|${four[i]}`,
    }
  })
}
/**
 * A piece's rolls per substat (`allSubstatKeys` order, its scale applied): its wanted lines with
 * their upgrades, its random lines spread evenly over the substats it can still have, and its
 * random upgrades a quarter on each line. `settled`: wanted lines or upgrades left unplaced are
 * random too (as the finished build has them); while searching they count nothing yet.
 */
function pieceRolls(
  piece: KqmPiece,
  spec: PieceSpec,
  into: Float64Array,
  settled = false
) {
  into.fill(0)
  const placedUps = Object.values(piece.ups).reduce((a, n) => a + (n ?? 0), 0)
  const randomLines = settled ? 4 - piece.lines.length : 4 - spec.lines
  const randomUps = spec.randomUps + (settled ? spec.wantedUps - placedUps : 0)
  const perLine = 1 + randomUps / 4
  const others = spec.eligible.length - piece.lines.length
  const share = others > 0 ? (randomLines / others) * perLine : 0
  for (const k of spec.eligible) {
    const j = SUBSTAT_INDEX[k]
    into[j] = piece.lines.includes(k)
      ? (perLine + (piece.ups[k] ?? 0)) * spec.scale
      : share * spec.scale
  }
  return into
}
const SUBSTAT_INDEX = Object.fromEntries(
  allSubstatKeys.map((k, i) => [k, i])
) as Record<SubstatKey, number>
/** A tier's rolls per substat, from its pieces (see `KqmRolls`) */
export function kqmTierRolls(
  layout: readonly KqmPiece[],
  sets: KqmSets,
  mains: KqmMains,
  mainValues: KqmMainValues,
  standard: KqmStandard
): KqmRolls {
  const tier = kqmTier(standard)
  if (!tier) return {}
  const specs = pieceSpecs(sets, mains, mainValues, tier)
  const sum = new Float64Array(allSubstatKeys.length)
  const one = new Float64Array(allSubstatKeys.length)
  layout.forEach((piece, i) => {
    pieceRolls(piece, specs[i], one, true)
    for (let j = 0; j < sum.length; j++) sum[j] += one[j]
  })
  const rolls: KqmRolls = {}
  allSubstatKeys.forEach((k, j) => {
    if (sum[j] > 1e-12) rolls[k] = sum[j]
  })
  return rolls
}

/**
 * Of a tier's rolls, those it chose: each wanted line's roll and the upgrades placed on it (a 4★
 * piece's at 0.8). The rest are its random lines' and random upgrades'.
 */
export function kqmWantedRolls(
  layout: readonly KqmPiece[],
  sets: KqmSets,
  mains: KqmMains,
  mainValues: KqmMainValues,
  standard: KqmStandard
): KqmRolls {
  const tier = kqmTier(standard)
  if (!tier) return {}
  const specs = pieceSpecs(sets, mains, mainValues, tier)
  const rolls: KqmRolls = {}
  layout.forEach((piece, i) => {
    for (const k of piece.lines)
      rolls[k] = (rolls[k] ?? 0) + (1 + (piece.ups[k] ?? 0)) * specs[i].scale
  })
  return rolls
}

/**
 * A tier's rolls for these sets and main stats, piece by piece so that every piece is one the
 * game can make: greedily the wanted line or upgrade (on a piece's wanted line) that helps most,
 * the requirements first; then a wanted line swapped for another stat or an upgrade moved between
 * a piece's lines, while that helps. Only stats the formulas read are wanted.
 */
function placeTierRolls(
  problem: KqmProblem,
  sets: KqmSets,
  mains: KqmMains,
  mainValues: KqmMainValues,
  tier: KqmTier,
  refine: boolean
): {
  rolls: KqmRolls
  score: KqmScore
  mains: KqmMains
  layout: KqmPiece[]
} {
  const specs = pieceSpecs(sets, mains, mainValues, tier)
  const layout: KqmPiece[] = specs.map(() => ({ lines: [], ups: {} }))
  const n = allSubstatKeys.length
  const value = allSubstatKeys.map((k) => kqmRollValue(k, problem.standard))
  const column = allSubstatKeys.map((k) => problem.columnOf(k))
  const wanted = allSubstatKeys.map(
    (k) => column[SUBSTAT_INDEX[k]] >= 0 && problem.scales.has(k)
  )
  const current = specs.map((spec, i) =>
    pieceRolls(layout[i], spec, new Float64Array(n))
  )
  const stats = problem.statsOf(
    kqmStatValues(
      { sets, mains, rolls: {}, standard: problem.standard },
      mainValues
    )
  )
  const shift = (from: Float64Array, to: Float64Array) => {
    for (let j = 0; j < n; j++) {
      const c = column[j]
      if (c >= 0 && to[j] !== from[j]) stats[c] += (to[j] - from[j]) * value[j]
    }
  }
  for (const piece of current) shift(new Float64Array(n), piece)
  let score = scoreAt(problem, stats)
  const trial = new Float64Array(n)
  /**
   * The score with piece `i` changed to `piece` (the stats left as they were). A change whose
   * stats were scored already in this step (`scored`: the same stat changes on another piece)
   * reuses that score.
   */
  const tryPiece = (
    i: number,
    piece: KqmPiece,
    scored: Map<string, KqmScore>
  ) => {
    pieceRolls(piece, specs[i], trial)
    let key = ''
    for (let j = 0; j < n; j++)
      if (column[j] >= 0)
        key += `${Math.round((trial[j] - current[i][j]) * 1e9)},`
    const known = scored.get(key)
    if (known) return known
    shift(current[i], trial)
    const s = scoreAt(problem, stats)
    shift(trial, current[i])
    scored.set(key, s)
    return s
  }
  const setPiece = (i: number, piece: KqmPiece, settled = false) => {
    pieceRolls(piece, specs[i], trial, settled)
    shift(current[i], trial)
    current[i].set(trial)
    layout[i] = piece
  }
  const upsOf = (piece: KqmPiece) =>
    Object.values(piece.ups).reduce((a, x) => a + (x ?? 0), 0)
  const signature = (i: number, withUps: boolean) =>
    `${specs[i].kind}|${layout[i].lines.join(',')}|${
      withUps ? JSON.stringify(layout[i].ups) : upsOf(layout[i])
    }`
  // greedily: a wanted line, or an upgrade on one. Each try changes the stats in place and back
  // (no new pieces: millions of tries a run); a change already scored in this step, the same one
  // on another piece, is not scored again.
  const readCols = allSubstatKeys.map((_, j) => wanted[j])
  const upsUsed = layout.map(() => 0)
  const randomLines = specs.map((spec) => 4 - spec.lines)
  const perLine = specs.map((spec) => 1 + spec.randomUps / 4)
  const eligibleIdx = specs.map((spec) =>
    spec.eligible.map((k) => SUBSTAT_INDEX[k])
  )
  const hasLine = layout.map(() => new Uint8Array(n))
  /** The random share of each line a piece's random lines can be, with `lines` wanted lines */
  const shareOf = (i: number, lines: number) => {
    const others = specs[i].eligible.length - lines
    return others > 0 ? (randomLines[i] / others) * perLine[i] : 0
  }
  /** Adds (`sign` 1) or takes back (-1) a wanted line of stat `j` on piece `i` */
  const moveLine = (i: number, j: number, sign: number) => {
    const lines = layout[i].lines.length
    const before = shareOf(i, lines)
    const after = shareOf(i, lines + 1)
    const scale = specs[i].scale
    for (const e of eligibleIdx[i]) {
      if (!readCols[e] || hasLine[i][e]) continue
      const c = column[e]
      if (e === j) stats[c] += sign * (perLine[i] - before) * scale * value[e]
      else if (after !== before)
        stats[c] += sign * (after - before) * scale * value[e]
    }
  }
  /** A line try's key: the stat, and what decides its other stats' share on that piece */
  const lineKey = (i: number, j: number) => {
    let mask = 0
    if (randomLines[i] > 0)
      for (const e of eligibleIdx[i])
        if (readCols[e] && !hasLine[i][e] && e !== j) mask |= 1 << e
    const m = specs[i].eligible.length - layout[i].lines.length
    return (
      (((((mask * 16 + j) * 16 + m) * 8 + specs[i].randomUps) * 8 +
        randomLines[i]) *
        2 +
        (specs[i].scale === 1 ? 0 : 1)) *
      2
    )
  }
  const upKey = (i: number, j: number) =>
    (j * 2 + (specs[i].scale === 1 ? 0 : 1)) * 2 + 1
  for (;;) {
    let best: { i: number; j: number; up: boolean; score: KqmScore } | undefined
    const scored = new Map<number, KqmScore>()
    const consider = (i: number, j: number, up: boolean) => {
      const key = up ? upKey(i, j) : lineKey(i, j)
      let s = scored.get(key)
      if (!s) {
        const c = column[j]
        if (up) stats[c] += specs[i].scale * value[j]
        else moveLine(i, j, 1)
        s = scoreAt(problem, stats)
        if (up) stats[c] -= specs[i].scale * value[j]
        else moveLine(i, j, -1)
        scored.set(key, s)
      }
      if (!best || betterScore(s, best.score)) best = { i, j, up, score: s }
    }
    // (the wanted lines first, then their upgrades)
    for (let i = 0; i < layout.length; i++)
      if (layout[i].lines.length < specs[i].lines)
        for (const j of eligibleIdx[i])
          if (readCols[j] && !hasLine[i][j]) consider(i, j, false)
    if (!best)
      for (let i = 0; i < layout.length; i++)
        if (upsUsed[i] < specs[i].wantedUps)
          for (const k of layout[i].lines) consider(i, SUBSTAT_INDEX[k], true)
    if (!best) break
    const { i, j, up } = best
    const k = allSubstatKeys[j]
    const piece = layout[i]
    if (up)
      setPiece(i, {
        lines: piece.lines,
        ups: { ...piece.ups, [k]: (piece.ups[k] ?? 0) + 1 },
      })
    else setPiece(i, { lines: [...piece.lines, k], ups: piece.ups })
    if (up) upsUsed[i]++
    else hasLine[i][j] = 1
    score = best.score
  }
  // a wanted line swapped for another stat (its upgrades with it), or an upgrade moved
  for (let iter = 0; refine && iter < 40; iter++) {
    let best: { i: number; piece: KqmPiece; score: KqmScore } | undefined
    const seen = new Set<string>()
    const scored = new Map<string, KqmScore>()
    for (let i = 0; i < layout.length; i++) {
      const sig = signature(i, true)
      if (seen.has(sig)) continue
      seen.add(sig)
      const piece = layout[i]
      for (const a of piece.lines) {
        for (const b of specs[i].eligible) {
          if (!wanted[SUBSTAT_INDEX[b]] || piece.lines.includes(b)) continue
          const ups = { ...piece.ups }
          const moved = ups[a] ?? 0
          delete ups[a]
          if (moved) ups[b] = moved
          const c = { lines: piece.lines.map((k) => (k === a ? b : k)), ups }
          const s = tryPiece(i, c, scored)
          if (betterScore(s, best?.score ?? score))
            best = { i, piece: c, score: s }
        }
        if (!piece.ups[a]) continue
        for (const b of piece.lines) {
          if (b === a) continue
          const ups = { ...piece.ups, [a]: piece.ups[a]! - 1 }
          ups[b] = (ups[b] ?? 0) + 1
          if (!ups[a]) delete ups[a]
          const c = { lines: piece.lines, ups }
          const s = tryPiece(i, c, scored)
          if (betterScore(s, best?.score ?? score))
            best = { i, piece: c, score: s }
        }
      }
    }
    if (!best) break
    setPiece(best.i, best.piece)
    score = best.score
  }
  // what stayed unplaced (nothing more the build reads) is random, as the finished build has it
  for (let i = 0; i < layout.length; i++) setPiece(i, layout[i], true)
  score = scoreAt(problem, stats)
  const rolls: KqmRolls = {}
  allSubstatKeys.forEach((k, j) => {
    const total = current.reduce((a, piece) => a + piece[j], 0)
    if (total > 1e-12) rolls[k] = total
  })
  return { rolls, score, mains, layout }
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
  /** A tier's pieces */
  layout?: KqmPiece[]
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
      layout,
    } = placeRolls(problem, sets, m, mainValues)
    if (!best || betterScore(score, best.score))
      best = {
        mains: placed,
        rolls,
        ...(layout && { layout }),
        score,
        tried: 0,
      }
  }
  if (best) best.tried = choices.length + kept.length
  return best
}
