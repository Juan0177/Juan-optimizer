import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import { yieldTask } from '@genshin-optimizer/gi/solver'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import { precompute } from '@genshin-optimizer/gi/wr'

/** One member's search, as the pre-filter reads it */
export interface PrefilterProblem {
  arts: readonly ICachedArtifact[]
  objective: OptNode
  /** The requirements a build must meet (not floors on the objective) */
  constraints: readonly { value: OptNode; min: number }[]
  /** An artifact's stats as the solver sees them */
  values: (art: ICachedArtifact) => Record<string, number>
  /** Whether a build keeps to the member's set rules */
  allowed: (arts: readonly ICachedArtifact[]) => boolean
}

/** A build found by climbing: one artifact per slot that has any */
export interface SeedBuild {
  arts: ICachedArtifact[]
  value: number
  /** Meets every requirement and the set rules */
  feasible: boolean
}

/**
 * Per slot, artifacts kept: the best by their stats in the best build found, the best by what they
 * add to it as they are (their set too), and for each requirement close to its minimum, the best
 * trade-offs between the two
 */
const KEEP_BY_STATS = 24
const KEEP_AS_IS = 8
const KEEP_PER_REQUIREMENT = 8
/** Each main stat that counts: its best pieces per slot (and trade-offs per requirement) */
const KEEP_PER_MAIN = 4
const KEEP_PER_MAIN_REQUIREMENT = 3
/** Each set whose bonuses are worth this share of the build: its best pieces per slot */
const KEEP_PER_SET = 6
const KEEP_PER_SET_REQUIREMENT = 5
const SET_WORTH = 0.003
/** Sets climbed from (their pieces in every slot first) */
const SET_STARTS = 3
/** Around the other builds climbed to, this share of each count */
const OTHER_BUILDS_SHARE = 0.4
const MAX_PASSES = 4
/** The page thread is given back after this long (ms) */
const SLICE_MS = 12

type Values = Record<string, number>
interface Scored {
  value: number
  /** How far the build is from its requirements and set rules (0: meets them) */
  miss: number
  outs: number[]
}

/** Gives the page thread back once a slice of work has run */
function pacer() {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < SLICE_MS) return
    await yieldTask()
    since = performance.now()
  }
}
type Pace = ReturnType<typeof pacer>

const better = (a: Scored, b: Scored) =>
  a.miss < b.miss - 1e-12 || (a.miss <= b.miss + 1e-12 && a.value > b.value)

function addInto(target: Values, values: Values) {
  for (const key in values) target[key] = (target[key] ?? 0) + values[key]
}

/** Evaluates builds of `problem` (a slot's candidate against the rest of a build) */
function evaluator(problem: PrefilterProblem) {
  const compute = precompute(
    [problem.objective, ...problem.constraints.map((c) => c.value)],
    {},
    (r) => r.path[1],
    2
  )
  const cache = new Map<ICachedArtifact, Values>()
  const valuesOf = (art: ICachedArtifact | undefined): Values => {
    if (!art) return {}
    let v = cache.get(art)
    if (!v) cache.set(art, (v = problem.values(art)))
    return v
  }
  const rest = (build: (ICachedArtifact | undefined)[], skip: number) => {
    const sum: Values = {}
    build.forEach((art, i) => {
      if (i !== skip && art) addInto(sum, valuesOf(art))
    })
    return sum
  }
  const score = (
    restValues: Values,
    art: ICachedArtifact | undefined,
    build: (ICachedArtifact | undefined)[]
  ): Scored => {
    const outs = compute([{ values: restValues }, { values: valuesOf(art) }])
    let miss = 0
    problem.constraints.forEach(({ min }, i) => {
      const reached = outs[i + 1]
      if (!(reached >= min))
        miss += (min - reached) / Math.max(Math.abs(min), 1)
    })
    if (!problem.allowed(build.filter((a): a is ICachedArtifact => !!a)))
      miss += 1000
    return { value: outs[0], miss, outs }
  }
  const outs = (restValues: Values, values: Values) =>
    compute([{ values: restValues }, { values }])
  return { rest, score, outs, valuesOf }
}

/**
 * The best build reached by changing one slot at a time from `start`, the change that helps most
 * first, until none helps (or `MAX_PASSES` rounds)
 */
async function climb(
  bySlot: ICachedArtifact[][],
  start: (ICachedArtifact | undefined)[],
  ev: ReturnType<typeof evaluator>,
  pace: Pace
) {
  const build = [...start]
  let current = ev.score(ev.rest(build, -1), undefined, build)
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false
    for (const [s, candidates] of bySlot.entries()) {
      await pace()
      if (!candidates.length) continue
      const restValues = ev.rest(build, s)
      const kept = build[s]
      let chosen = kept
      for (const [i, art] of candidates.entries()) {
        if (i && i % 32 === 0) await pace()
        if (art === kept) continue
        build[s] = art
        const scored = ev.score(restValues, art, build)
        if (better(scored, current)) {
          current = scored
          chosen = art
          moved = true
        }
      }
      build[s] = chosen
    }
    if (!moved) break
  }
  return { build, scored: current }
}

/** Climbs from a greedy start and from the best sets' pieces; the best builds reached */
async function climbs(
  problem: PrefilterProblem,
  ev: ReturnType<typeof evaluator>,
  pace: Pace
) {
  const bySlot = allArtifactSlotKeys.map((slot) =>
    problem.arts.filter((a) => a.slotKey === slot)
  )
  const greedy: (ICachedArtifact | undefined)[] = bySlot.map(() => undefined)
  for (const [s, candidates] of bySlot.entries()) {
    await pace()
    const restValues = ev.rest(greedy, s)
    let best: { art: ICachedArtifact; scored: Scored } | undefined
    for (const [i, art] of candidates.entries()) {
      if (i && i % 32 === 0) await pace()
      greedy[s] = art
      const scored = ev.score(restValues, art, greedy)
      if (!best || better(scored, best.scored)) best = { art, scored }
    }
    greedy[s] = best?.art
  }
  const general = await climb(bySlot, greedy, ev, pace)

  // each set with pieces in at least 4 slots: its best piece per slot, in the general build
  const sets = new Set(problem.arts.map((a) => a.setKey))
  const starts: {
    setKey: string
    start: (ICachedArtifact | undefined)[]
    scored: Scored
  }[] = []
  for (const setKey of sets) {
    const start = [...general.build]
    let slots = 0
    for (const [s, candidates] of bySlot.entries()) {
      await pace()
      const pieces = candidates.filter((a) => a.setKey === setKey)
      if (!pieces.length) continue
      slots++
      const restValues = ev.rest(start, s)
      let best: { art: ICachedArtifact; scored: Scored } | undefined
      for (const [i, art] of pieces.entries()) {
        if (i && i % 32 === 0) await pace()
        start[s] = art
        const scored = ev.score(restValues, art, start)
        if (!best || better(scored, best.scored)) best = { art, scored }
      }
      start[s] = best!.art
    }
    if (slots < 4) continue
    starts.push({
      setKey,
      start,
      scored: ev.score(ev.rest(start, -1), undefined, start),
    })
  }
  starts.sort((a, b) => (better(a.scored, b.scored) ? -1 : 1))
  const perSet: ({ setKey: string } & Awaited<ReturnType<typeof climb>>)[] = []
  for (const { setKey, start } of starts.slice(0, SET_STARTS))
    perSet.push({ setKey, ...(await climb(bySlot, start, ev, pace)) })
  return { bySlot, general, perSet }
}

function toSeed({
  build,
  scored,
}: {
  build: (ICachedArtifact | undefined)[]
  scored: Scored
}): SeedBuild {
  return {
    arts: build.filter((a): a is ICachedArtifact => !!a),
    value: scored.value,
    feasible: scored.miss === 0,
  }
}

/**
 * What `problem` reaches from `start` (a build in slot order) by changing one slot at a time: a
 * quick estimate of what it is worth near a known build
 */
export async function climbFrom(
  problem: PrefilterProblem,
  start: readonly (ICachedArtifact | undefined)[]
): Promise<SeedBuild> {
  const bySlot = allArtifactSlotKeys.map((slot) =>
    problem.arts.filter((a) => a.slotKey === slot)
  )
  return toSeed(await climb(bySlot, [...start], evaluator(problem), pacer()))
}

/** The artifacts with the highest `score`, `count` of them (all when there are no more) */
function topBy<T>(items: readonly T[], count: number, score: (t: T) => number) {
  if (items.length <= count) return items
  return items
    .map((item) => ({ item, s: score(item) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map(({ item }) => item)
}

/**
 * A good build of `problem` found fast: climbs from a greedy start and from the best sets. Its
 * value is a floor an exact search can start from (`feasible`: it meets every requirement).
 */
export async function seedBuild(
  problem: PrefilterProblem
): Promise<SeedBuild | undefined> {
  if (!problem.arts.length) return undefined
  const ev = evaluator(problem)
  const { general, perSet } = await climbs(problem, ev, pacer())
  const best = [general, ...perSet].reduce((a, b) =>
    better(b.scored, a.scored) ? b : a
  )
  return toSeed(best)
}

/**
 * `count` of `items` by two scores: the non-dominated ones first, layer by layer (in a layer
 * larger than what is left, the highest by the first score)
 */
function paretoLayers<T>(
  items: readonly T[],
  count: number,
  scores: (t: T) => [number, number]
) {
  if (items.length <= count) return items
  // by the first score, then the second: an item is dominated by one before it
  let left = items
    .map((item) => ({ item, s: scores(item) }))
    .sort((a, b) => b.s[0] - a.s[0] || b.s[1] - a.s[1])
  const taken: T[] = []
  while (taken.length < count && left.length) {
    const front: typeof left = []
    const rest: typeof left = []
    let bestSecond = Number.NEGATIVE_INFINITY
    for (const entry of left)
      if (entry.s[1] > bestSecond) {
        front.push(entry)
        bestSecond = entry.s[1]
      } else rest.push(entry)
    taken.push(...front.slice(0, count - taken.length).map(({ item }) => item))
    left = rest
  }
  return taken
}

/**
 * Quick search: the artifacts that can matter, per slot, around each build climbed to (the best
 * one counts most). The best by their stats (their set held as the build's), the best as they
 * are, the best pieces of each set whose bonuses are worth something, and for each requirement the
 * best trade-offs between it and damage. A slot with few artifacts keeps all. The exact search
 * over them rarely misses the best build of the whole pool, and then by little.
 */
export async function quickPool(problem: PrefilterProblem): Promise<{
  arts: ICachedArtifact[]
  seed: SeedBuild | undefined
  /** The pool with the artifacts that can matter around `build` too, if that adds any */
  refine: (
    build: readonly ICachedArtifact[]
  ) => Promise<ICachedArtifact[] | undefined>
}> {
  if (!problem.arts.length)
    return { arts: [], seed: undefined, refine: async () => undefined }
  const ev = evaluator(problem)
  const pace = pacer()
  const { bySlot, general, perSet } = await climbs(problem, ev, pace)
  const best = [general, ...perSet].reduce((a, b) =>
    better(b.scored, a.scored) ? b : a
  )
  const others = [general, ...perSet].filter(
    (c, i, all) =>
      c !== best &&
      all.findIndex((d) => d.build.every((a, s) => a === c.build[s])) === i
  )
  const keep = new Set<ICachedArtifact>()
  for (const { build } of [best, ...others])
    for (const art of build) if (art) keep.add(art)

  // what each set's 2- or 4-piece bonus is worth, on the best build's stats without any set
  const statsOnly: Values = {}
  const setKeys = new Set(problem.arts.map((a) => a.setKey as string))
  for (const [key, value] of Object.entries(ev.rest(best.build, -1)))
    if (!setKeys.has(key)) statsOnly[key] = value
  const base = ev.outs(statsOnly, {})[0]
  const worthSets = [...setKeys].filter((setKey) =>
    [2, 4].some(
      (n) =>
        ev.outs(statsOnly, { [setKey]: n })[0] - base >
        Math.abs(base) * SET_WORTH
    )
  )
  const requirements = problem.constraints.map((_, i) => i + 1)
  const around = async (
    build: (ICachedArtifact | undefined)[],
    share: number
  ) => {
    const count = (n: number) => Math.max(1, Math.round(n * share))
    for (const [s, candidates] of bySlot.entries()) {
      await pace()
      const restValues = ev.rest(build, s)
      const heldSet = build[s]?.setKey
      const byStats = new Map<ICachedArtifact, number[]>()
      const statsScore = (art: ICachedArtifact) => {
        let outs = byStats.get(art)
        if (!outs) {
          const values = { ...ev.valuesOf(art) }
          delete values[art.setKey]
          if (heldSet) values[heldSet] = (values[heldSet] ?? 0) + 1
          byStats.set(art, (outs = ev.outs(restValues, values)))
        }
        return outs
      }
      const take = (arts: readonly ICachedArtifact[]) =>
        arts.forEach((a) => keep.add(a))
      const asIs = new Map<ICachedArtifact, number>()
      for (const [i, art] of candidates.entries()) {
        if (i && i % 32 === 0) await pace()
        statsScore(art)
        asIs.set(art, ev.outs(restValues, ev.valuesOf(art))[0])
      }
      take(topBy(candidates, count(KEEP_BY_STATS), (a) => statsScore(a)[0]))
      take(topBy(candidates, count(KEEP_AS_IS), (a) => asIs.get(a)!))
      const tradeOffs = (arts: readonly ICachedArtifact[], n: number) => {
        for (const i of requirements)
          take(
            paretoLayers(arts, count(n), (a) => [
              statsScore(a)[0],
              statsScore(a)[i],
            ])
          )
      }
      tradeOffs(candidates, KEEP_PER_REQUIREMENT)
      const mains = new Map<string, ICachedArtifact[]>()
      for (const art of candidates)
        mains.set(art.mainStatKey, [...(mains.get(art.mainStatKey) ?? []), art])
      const plain = ev.outs(restValues, heldSet ? { [heldSet]: 1 } : {})
      for (const [main, pieces] of mains) {
        const alone = ev.outs(restValues, {
          ...(heldSet ? { [heldSet]: 1 } : {}),
          [main]: ev.valuesOf(pieces[0])[main] ?? 0,
        })
        if (alone.every((v, k) => v === plain[k])) continue
        take(topBy(pieces, count(KEEP_PER_MAIN), (a) => statsScore(a)[0]))
        tradeOffs(pieces, KEEP_PER_MAIN_REQUIREMENT)
      }
      for (const setKey of worthSets) {
        const pieces = candidates.filter((a) => a.setKey === setKey)
        take(topBy(pieces, count(KEEP_PER_SET), (a) => statsScore(a)[0]))
        tradeOffs(pieces, KEEP_PER_SET_REQUIREMENT)
      }
    }
  }
  await around(best.build, 1)
  for (const { build } of others) await around(build, OTHER_BUILDS_SHARE)
  return {
    arts: problem.arts.filter((a) => keep.has(a)),
    seed: toSeed(best),
    refine: async (found) => {
      const size = keep.size
      await around(
        bySlot.map((_, s) =>
          found.find((a) => a.slotKey === allArtifactSlotKeys[s])
        ),
        1
      )
      return keep.size > size
        ? problem.arts.filter((a) => keep.has(a))
        : undefined
    },
  }
}
