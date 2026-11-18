// juanlab: da una build (KQM o TC) a 5 manufatti che il server privato può avere, da mandare a gc-web.
// Ogni pezzo ha i tiri che il server gli dà (gc-web artifactRollLimits: 4 + livello/4, cioè 9 al +20 per un 5★,
// 8 al +16 per un 4★), 4 sottostatistiche diverse dalla principale, al massimo 1 + livello/4 tiri ciascuna, e ogni
// valore è una somma esatta di tier che gc-web rilegge con lo stesso numero di tiri (countsFor: la combinazione
// con meno tiri). Così il server non aggiunge tiri a caso e non arrotonda nulla.
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import { coreStats } from '@genshin-optimizer/gi/stats'

export interface GenSlot {
  slotKey: ArtifactSlotKey
  mainStatKey: MainStatKey
  rarity: 4 | 5
  level: number
  setKey: ArtifactSetKey
}
export interface GenInput {
  /** 5, flower..circlet */
  slots: GenSlot[]
  /** Total substat values as the game shows them (percent points / flat) */
  targets: Partial<Record<SubstatKey, number>>
  /** Substats that matter; the others are filler */
  used: SubstatKey[]
}
export interface GenPiece extends GenSlot {
  /** rolls: tier values as shown, strongest first (the order the server stores them); value: their shown sum */
  substats: { key: SubstatKey; rolls: number[]; value: number }[]
}
export interface GenResult {
  pieces: GenPiece[]
  totals: Partial<Record<SubstatKey, number>>
  /** generated − target, used substats only */
  gaps: Partial<Record<SubstatKey, number>>
  /**
   * Filler substats not at the lowest tier: with 4+ rolls all-lowest shows a value gc-web reads back
   * with fewer rolls, so a higher mix was needed (only when no placement kept every filler ≤ 3 rolls)
   */
  fillerRaised: { slotKey: ArtifactSlotKey; key: SubstatKey }[]
}

/* ---------- gc-web's read-back (public/commands.js substatMarks, public/juanlab.js countsFor) ---------- */

/** Rolls gc-web reads a substat value with (juanlab.js MAX_ROLLS: 6 per substat in the game) */
const MAX_ROLLS = 6
/** commands.js UNIT: values summed as integers so that 3 × 0.0389 does not drift */
const UNIT = 1e6
const isPercent = (key: SubstatKey) => key.endsWith('_')
/** The game's tiers, weakest first, as fractions for % stats (the same table as gc-web's catalog) */
const tiersOf = (key: SubstatKey, rarity: 4 | 5): readonly number[] =>
  coreStats.art.sub[rarity][key]

/** The float32 sum the client shows, the rolls added strongest tier first (commands.js shownRolls) */
function shownRolls(tiers: readonly number[], counts: readonly number[]) {
  let sum = 0
  for (let index = tiers.length - 1; index >= 0; index--)
    for (let count = 0; count < (counts[index] ?? 0); count++)
      sum = Math.fround(sum + Math.fround(tiers[index]))
  return sum
}
/** What the game shows, as an integer: tenths of a percent, or whole points */
const rollsKey = (
  key: SubstatKey,
  tiers: readonly number[],
  counts: readonly number[]
) => {
  const sum = shownRolls(tiers, counts)
  return Math.round(isPercent(key) ? sum * 1000 : sum)
}
/** commands.js strongerFirst: more rolls of the stronger tiers wins */
const strongerFirst = (a: readonly number[], b: readonly number[]) => {
  for (let index = a.length - 1; index >= 0; index--)
    if (a[index] !== b[index]) return a[index] - b[index]
  return 0
}

interface Mark {
  /** The shown value as an integer (tenths of a percent, or whole points) */
  key: number
  rolls: number
  /** Rolls per tier, weakest first */
  counts: number[]
}
const markCache = new Map<string, Mark[]>()
/**
 * Port of gc-web's substatMarks(prop, tiers, MAX_ROLLS): every value the game can show with 0..6 rolls,
 * ascending, each with the combination gc-web keeps for it (fewest rolls, then highest sum, then stronger
 * tiers). Up to 6 rolls gc-web keeps every combination (EXACT_UP_TO is 12), so only that branch is ported.
 */
function marksOf(key: SubstatKey, rarity: 4 | 5): Mark[] {
  const cacheKey = `${key}|${rarity}`
  const cached = markCache.get(cacheKey)
  if (cached) return cached
  const tiers = tiersOf(key, rarity)
  const units = tiers.map((value) => Math.round(value * UNIT))
  const zero = units.map(() => 0)
  const marks = new Map<number, Mark & { sum: number }>([
    [0, { key: 0, rolls: 0, counts: zero, sum: 0 }],
  ])
  let states = [{ sum: 0, counts: zero }]
  for (let rolls = 1; rolls <= MAX_ROLLS; rolls++) {
    const next = new Map<string, { sum: number; counts: number[] }>()
    for (const state of states) {
      units.forEach((unit, index) => {
        const sum = state.sum + unit
        const counts = state.counts.slice()
        counts[index]++
        const id = counts.join()
        const old = next.get(id)
        if (old && old.sum > sum) return
        if (!old || sum > old.sum || strongerFirst(counts, old.counts) > 0)
          next.set(id, { sum, counts })
      })
    }
    states = [...next.values()]
    for (const state of states) {
      const shown = rollsKey(key, tiers, state.counts)
      const old = marks.get(shown)
      if (
        !old ||
        (old.rolls === rolls &&
          (state.sum > old.sum ||
            (state.sum === old.sum &&
              strongerFirst(state.counts, old.counts) > 0)))
      )
        marks.set(shown, {
          key: shown,
          rolls,
          counts: state.counts,
          sum: state.sum,
        })
    }
  }
  const list = [...marks.values()]
    .sort((a, b) => a.key - b.key)
    .map(({ key, rolls, counts }) => ({ key, rolls, counts }))
  markCache.set(cacheKey, list)
  return list
}

/**
 * The roll count gc-web reads for a substat value (port of juanlab.js countsFor): the mark showing the
 * closest value, which has the fewest rolls that give it.
 */
export function gcwebReadBack(
  key: SubstatKey,
  rarity: 4 | 5,
  value: number
): number {
  const shown = isPercent(key)
    ? Math.round(Number(value) * 10)
    : Math.round(Number(value))
  const marks = marksOf(key, rarity)
  let best = marks[0]
  for (const mark of marks)
    if (Math.abs(mark.key - shown) < Math.abs(best.key - shown)) best = mark
  return best.rolls
}

const optionCache = new Map<string, Mark[]>()
/** The values `count` rolls can show that gc-web reads back as `count` rolls, ascending */
function options(key: SubstatKey, rarity: 4 | 5, count: number): Mark[] {
  const cacheKey = `${key}|${rarity}|${count}`
  let list = optionCache.get(cacheKey)
  if (!list) {
    list = marksOf(key, rarity).filter((mark) => mark.rolls === count)
    optionCache.set(cacheKey, list)
  }
  return list
}

/** A mark as a substat of the result: its rolls strongest first, in the units the game shows */
function substatOf(key: SubstatKey, rarity: 4 | 5, mark: Mark) {
  const scale = isPercent(key) ? 100 : 1
  const tiers = tiersOf(key, rarity)
  const rolls: number[] = []
  for (let index = tiers.length - 1; index >= 0; index--)
    for (let count = 0; count < mark.counts[index]; count++)
      rolls.push(Math.round(tiers[index] * scale * UNIT) / UNIT)
  return { key, rolls, value: isPercent(key) ? mark.key / 10 : mark.key }
}

/* ---------- placement: which substats each piece carries, with how many rolls ---------- */

/** gc-web artifactRollLimits(4, level): the server gives 4 starting substats + one roll per 4 levels */
const limitsOf = (level: number) => {
  const upgrades = Math.max(0, Math.floor(level / 4))
  return { stats: 4, upgrades, perStat: Math.min(MAX_ROLLS, 1 + upgrades) }
}
type Limits = ReturnType<typeof limitsOf>

/** Filler order: flat stats first, as junk rolls usually are */
const FILLER: readonly SubstatKey[] = [
  'hp',
  'atk',
  'def',
  'def_',
  'hp_',
  'atk_',
  'eleMas',
  'enerRech_',
  'critRate_',
  'critDMG_',
]
/** Assignments tried per slot-count configuration before giving up on it */
const LEAF_BUDGET = 200
/** Most rolls a filler substat can have all at the lowest tier and still read back as many in gc-web */
const LOW_FILLER_ROLLS = 3
/** All rolls at the lowest tier show a value gc-web reads back with this many rolls */
const lowestReadsBack = (key: SubstatKey, rarity: 4 | 5, count: number) =>
  options(key, rarity, count)[0]?.counts[0] === count

interface Placement {
  /** Per piece: substat and roll count */
  pieces: { key: SubstatKey; count: number }[][]
  /** No used substat had to fill a free slot */
  clean: boolean
  /** Filler substats whose rolls cannot all be at the lowest tier */
  raised: number
}

interface Context {
  slots: GenSlot[]
  limits: Limits[]
  /** Used substats, the largest target first */
  used: SubstatKey[]
  usedSet: Set<SubstatKey>
  /** Per used substat: the pieces it can be on (not their main stat) */
  eligible: number[][]
}

/** Smallest number of eligible pieces that can hold n rolls */
function minPieces(ctx: Context, i: number, n: number) {
  const caps = ctx.eligible[i]
    .map((p) => ctx.limits[p].perStat)
    .sort((a, b) => b - a)
  let sum = 0
  for (let m = 0; m < caps.length; m++) {
    if (sum >= n) return m
    sum += caps[m]
  }
  return sum >= n ? caps.length : Number.POSITIVE_INFINITY
}

/**
 * Upgrades (rolls beyond the first of each substat) per used substat and piece: a small max flow.
 * Supplies: each used substat's rolls minus its pieces, and the filler's leftover. Every piece takes
 * exactly its upgrades; a piece with no free slot takes them from its used substats only.
 */
function routeUpgrades(
  ctx: Context,
  active: number[],
  supply: number[],
  y: boolean[][],
  free: number[],
  /** Most filler upgrades per piece (with free slots) */
  fillerCap: number[]
): { flow: number[][]; filler: number[] } | null {
  const P = ctx.slots.length
  const total = ctx.limits.reduce((sum, l) => sum + l.upgrades, 0)
  const fillerSupply = total - active.reduce((sum, i) => sum + supply[i], 0)
  if (fillerSupply < 0) return null
  // Sources: the active used substats, then the filler (index active.length)
  const sources = active.length + 1
  const flow = Array.from({ length: sources }, () => new Array(P).fill(0))
  const left = [...active.map((i) => supply[i]), fillerSupply]
  const load = new Array(P).fill(0)
  const cap = (s: number, p: number) =>
    s < active.length
      ? y[p][active[s]]
        ? ctx.limits[p].upgrades
        : 0
      : free[p] > 0
        ? fillerCap[p]
        : 0
  // One unit from source s to a piece with room, through a path of reassignments (BFS).
  const push = (s: number) => {
    const prev = new Map<string, string | null>()
    const start = `s${s}`
    prev.set(start, null)
    const queue = [start]
    while (queue.length) {
      const node = queue.shift()!
      if (node.startsWith('s')) {
        const from = Number(node.slice(1))
        const pieces = [...Array(P).keys()]
          .filter((p) => flow[from][p] < cap(from, p) && !prev.has(`p${p}`))
          .sort(
            (a, b) =>
              flow[from][a] - flow[from][b] || load[a] - load[b] || a - b
          )
        for (const p of pieces) {
          prev.set(`p${p}`, node)
          if (load[p] < ctx.limits[p].upgrades) {
            // Apply the path back to the start
            let at = `p${p}`
            load[p]++
            while (prev.get(at)) {
              const before = prev.get(at)!
              if (at.startsWith('p'))
                flow[Number(before.slice(1))][Number(at.slice(1))]++
              else flow[Number(at.slice(1))][Number(before.slice(1))]--
              at = before
            }
            return true
          }
          queue.push(`p${p}`)
        }
      } else {
        const p = Number(node.slice(1))
        for (let other = 0; other < sources; other++)
          if (flow[other][p] > 0 && !prev.has(`s${other}`)) {
            prev.set(`s${other}`, node)
            queue.push(`s${other}`)
          }
      }
    }
    return false
  }
  // The used substats first, one unit at a time from the one with the most left; the filler last.
  for (;;) {
    let s = -1
    for (let k = 0; k < active.length; k++)
      if (left[k] > 0 && (s < 0 || left[k] > left[s])) s = k
    if (s < 0) break
    if (!push(s)) return null
    left[s]--
  }
  while (left[active.length] > 0) {
    if (!push(active.length)) return null
    left[active.length]--
  }
  return { flow, filler: flow[active.length] }
}

/** Placements in order of preference: clean first, then fewer filler substats above the lowest tier */
const rank = (placement: Placement) =>
  (placement.clean ? 0 : 1000) + placement.raised
const better = (a: Placement | null, b: Placement | null) =>
  a && (!b || rank(a) < rank(b)) ? a : b

/** A placement for these roll counts (index of ctx.used → rolls), or null when none was found */
function place(ctx: Context, n: number[]): Placement | null {
  const P = ctx.slots.length
  const active = ctx.used.map((_, i) => i).filter((i) => n[i] > 0)
  const mMin = new Array(ctx.used.length).fill(0)
  const mMax = new Array(ctx.used.length).fill(0)
  for (const i of active) {
    mMin[i] = minPieces(ctx, i, n[i])
    if (!Number.isFinite(mMin[i])) return null
    mMax[i] = Math.min(ctx.eligible[i].length, n[i])
  }
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
  const hard = sum(ctx.limits.map((l) => l.stats))
  // One free slot per piece when possible: the used substats spread, the filler takes the rest.
  const soft = hard - P
  const tMin = sum(mMin)
  const tMax = sum(mMax)
  if (tMin > hard) return null
  const counts: number[] = []
  for (let t = Math.min(tMax, soft); t >= tMin; t--) counts.push(t)
  for (let t = Math.max(soft + 1, tMin); t <= Math.min(tMax, hard); t++)
    counts.push(t)
  // Filler at the lowest tier needs ≤ 3 rolls per filler substat (4+ all-lowest reads back as fewer
  // rolls in gc-web): the slot counts that leave enough free slots for the filler's rolls go first.
  const fillerRolls =
    sum(ctx.limits.map((l) => l.stats + l.upgrades)) -
    sum(active.map((i) => n[i]))
  const lowFits = (t: number) => fillerRolls <= LOW_FILLER_ROLLS * (hard - t)
  const ordered = [
    ...counts.filter(lowFits),
    ...counts.filter((t) => !lowFits(t)),
  ]

  let best: Placement | null = null
  for (const t of ordered) {
    // Pieces per used substat: as spread as allowed, the most spread one gathered first.
    const m = mMax.slice()
    while (sum(m) > t) {
      let pick = -1
      for (const i of active)
        if (
          m[i] > mMin[i] &&
          (pick < 0 ||
            m[i] > m[pick] ||
            (m[i] === m[pick] &&
              (n[i] > n[pick] || (n[i] === n[pick] && i > pick))))
        )
          pick = i
      m[pick]--
    }
    best = better(best, assign(ctx, n, m, active, lowFits(t)))
    if (best && rank(best) === 0) return best
  }
  return best
}

/** Pieces for each used substat (y), then the upgrades and the filler; a small search over the pieces */
function assign(
  ctx: Context,
  n: number[],
  m: number[],
  active: number[],
  /** Look for a placement with every filler substat at the lowest tier */
  wantLow: boolean
): Placement | null {
  const P = ctx.slots.length
  const order = active
    .slice()
    .sort(
      (a, b) =>
        ctx.eligible[a].length - ctx.eligible[b].length || m[b] - m[a] || a - b
    )
  const y = Array.from({ length: P }, () =>
    new Array(ctx.used.length).fill(false)
  )
  const room = ctx.limits.map((l) => l.stats)
  let leaves = 0
  let best: Placement | null = null
  const done = (placement: Placement | null) =>
    !!placement && placement.clean && (!wantLow || placement.raised === 0)

  const finish = (): Placement | null => {
    const free = room.slice()
    const supply = n.map((count, i) => count - m[i])
    // First with ≤ 3 rolls per filler substat, then (if that cannot be routed) as many as fit.
    const upgrades = ctx.limits.map((l) => l.upgrades)
    const low = upgrades.map((u, p) =>
      Math.min(u, (LOW_FILLER_ROLLS - 1) * free[p])
    )
    const route =
      (wantLow ? routeUpgrades(ctx, active, supply, y, free, low) : null) ??
      routeUpgrades(ctx, active, supply, y, free, upgrades)
    if (!route) return null
    let clean = true
    let raised = 0
    const pieces = ctx.slots.map((slot, p) => {
      const list: { key: SubstatKey; count: number }[] = []
      active.forEach((i, s) => {
        if (y[p][i])
          list.push({ key: ctx.used[i], count: 1 + route.flow[s][p] })
      })
      if (free[p] > 0) {
        const taken = new Set(list.map((entry) => entry.key))
        const ok = (key: SubstatKey) =>
          key !== slot.mainStatKey && !taken.has(key)
        let keys = FILLER.filter((key) => ok(key) && !ctx.usedSet.has(key))
        if (keys.length < free[p]) {
          clean = false
          keys = [...keys, ...ctx.used.filter(ok)]
        }
        keys = keys.slice(0, free[p])
        // The leftover upgrades spread over the free slots (fewer rolls each: the lowest tier reads back)
        const extra = route.filler[p]
        keys.forEach((key, j) => {
          const count =
            1 + Math.floor(extra / free[p]) + (j < extra % free[p] ? 1 : 0)
          if (
            !ctx.usedSet.has(key) &&
            !lowestReadsBack(key, slot.rarity, count)
          )
            raised++
          list.push({ key, count })
        })
      }
      return list
    })
    return { pieces, clean, raised }
  }

  const search = (depth: number): Placement | null => {
    if (depth === order.length) {
      leaves++
      return finish()
    }
    const i = order[depth]
    const candidates = ctx.eligible[i]
      .filter((p) => room[p] > 0)
      .sort((a, b) => room[b] - room[a] || a - b)
    if (candidates.length < m[i]) return null
    // Combinations of m[i] candidates, in the order above (the first one is the greedy choice)
    const pick: number[] = []
    const choose = (from: number): Placement | null => {
      if (leaves >= LEAF_BUDGET) return null
      if (pick.length === m[i]) {
        for (const p of pick) {
          y[p][i] = true
          room[p]--
        }
        const found = search(depth + 1)
        for (const p of pick) {
          y[p][i] = false
          room[p]++
        }
        return found
      }
      for (let c = from; c <= candidates.length - (m[i] - pick.length); c++) {
        pick.push(candidates[c])
        const found = choose(c + 1)
        pick.pop()
        if (done(found)) return found
        best = better(best, found)
        if (leaves >= LEAF_BUDGET) return null
      }
      return null
    }
    return choose(0)
  }
  return better(search(0), best)
}

/* ---------- tiers: each used total closest to its target ---------- */

/**
 * One mark per slot of a substat so that the sum of the shown values is closest to the target
 * (ties: the higher sum). Exact DP over the integer shown values.
 */
function chooseTiers(
  key: SubstatKey,
  slots: { rarity: 4 | 5; count: number }[],
  target: number
): Mark[] {
  const lists = slots.map((slot) => options(key, slot.rarity, slot.count))
  const goal = target * (isPercent(key) ? 10 : 1)
  const maxSum = lists.reduce((sum, list) => sum + list[list.length - 1].key, 0)
  // layers[j][sum] = option index chosen at slot j to reach sum (−1: unreachable)
  const layers: Int16Array[] = []
  let reach = new Uint8Array(maxSum + 1)
  reach[0] = 1
  let top = 0
  for (const list of lists) {
    const next = new Uint8Array(maxSum + 1)
    const choice = new Int16Array(maxSum + 1).fill(-1)
    let nextTop = 0
    for (let sum = 0; sum <= top; sum++) {
      if (!reach[sum]) continue
      list.forEach((mark, index) => {
        const to = sum + mark.key
        if (!next[to]) {
          next[to] = 1
          choice[to] = index
          if (to > nextTop) nextTop = to
        }
      })
    }
    layers.push(choice)
    reach = next
    top = nextTop
  }
  let best = -1
  for (let sum = 0; sum <= top; sum++) {
    if (!reach[sum]) continue
    if (best < 0 || Math.abs(sum - goal) <= Math.abs(best - goal)) best = sum
  }
  const picked: Mark[] = []
  let at = best
  for (let j = lists.length - 1; j >= 0; j--) {
    const mark = lists[j][layers[j][at]]
    picked.unshift(mark)
    at -= mark.key
  }
  return picked
}

/* ---------- the generator ---------- */

const roundTo = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits

/**
 * Five pieces that could exist in the game, as close as possible to the build's substat totals.
 * Deterministic. When the pieces cannot hold the targets, the closest legal result: rolls are dropped
 * where the rest still covers the most of the target (ties: the smaller target), and the gap is reported.
 */
export function generateArtifacts(input: GenInput): GenResult {
  // The level gc-web gives the piece: it clamps to the piece's maximum (+16 for 4★, +20 for 5★)
  const slots = input.slots.map((slot) => ({
    ...slot,
    level: Math.max(0, Math.min(slot.level, slot.rarity === 5 ? 20 : 16)),
  }))
  const target = (key: SubstatKey) => Math.max(0, input.targets[key] ?? 0)
  const used = [
    ...new Set(input.used.filter((key) => allSubstatKeys.includes(key))),
  ]
    .map((key, index) => ({ key, index }))
    .sort((a, b) => target(b.key) - target(a.key) || a.index - b.index)
    .map(({ key }) => key)
  const ctx: Context = {
    slots,
    limits: slots.map((slot) => limitsOf(slot.level)),
    used,
    usedSet: new Set(used),
    eligible: used.map((key) =>
      slots.map((_, p) => p).filter((p) => slots[p].mainStatKey !== key)
    ),
  }

  // Average and best roll of each used substat, over the pieces that can carry it (as shown)
  const tierStat = (i: number, pick: (tiers: readonly number[]) => number) => {
    const pieces = ctx.eligible[i]
    const scale = isPercent(used[i]) ? 100 : 1
    return (
      pieces.reduce(
        (sum, p) => sum + pick(tiersOf(used[i], slots[p].rarity)) * scale,
        0
      ) / pieces.length
    )
  }
  const best = used.map((_, i) =>
    tierStat(i, (tiers) => tiers[tiers.length - 1])
  )
  // Rolls per used substat: the target over the average roll.
  const n = used.map((key, i) => {
    const pieces = ctx.eligible[i]
    if (!pieces.length) return 0
    const mean = tierStat(
      i,
      (tiers) => tiers.reduce((a, b) => a + b, 0) / tiers.length
    )
    const cap = pieces.reduce((sum, p) => sum + ctx.limits[p].perStat, 0)
    return Math.min(cap, Math.round(target(key) / mean))
  })

  // Too many rolls for the pieces: drop one at a time where the rolls left, at their best tier,
  // still cover the largest share of the target (the shortfall spreads over the substats).
  let placement = place(ctx, n)
  while (!placement) {
    let drop = -1
    let dropCover = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n.length; i++) {
      if (n[i] <= 0) continue
      const goal = target(used[i])
      const cover =
        goal > 0 ? ((n[i] - 1) * best[i]) / goal : Number.POSITIVE_INFINITY
      if (drop < 0 || cover >= dropCover) {
        drop = i
        dropCover = cover
      }
    }
    if (drop < 0) throw new Error('generateArtifacts: no placement') // (all-filler always fits)
    n[drop]--
    placement = place(ctx, n)
  }

  // Tiers: used substats by DP toward the target, filler at the lowest mix gc-web reads back.
  const marks = placement.pieces.map((list) =>
    list.map(() => undefined as Mark | undefined)
  )
  for (const key of used) {
    const at: [number, number][] = []
    placement.pieces.forEach((list, p) =>
      list.forEach((entry, j) => {
        if (entry.key === key) at.push([p, j])
      })
    )
    if (!at.length) continue
    const chosen = chooseTiers(
      key,
      at.map(([p, j]) => ({
        rarity: slots[p].rarity,
        count: placement.pieces[p][j].count,
      })),
      target(key)
    )
    at.forEach(([p, j], k) => {
      marks[p][j] = chosen[k]
    })
  }

  const pieces: GenPiece[] = slots.map((slot, p) => ({
    ...slot,
    substats: placement.pieces[p].map((entry, j) =>
      substatOf(
        entry.key,
        slot.rarity,
        marks[p][j] ?? options(entry.key, slot.rarity, entry.count)[0]
      )
    ),
  }))

  const totals: Partial<Record<SubstatKey, number>> = {}
  for (const piece of pieces)
    for (const sub of piece.substats)
      totals[sub.key] = roundTo((totals[sub.key] ?? 0) + sub.value, 1)
  const gaps: Partial<Record<SubstatKey, number>> = {}
  for (const key of used)
    gaps[key] = roundTo((totals[key] ?? 0) - target(key), 2)
  const usedSet = ctx.usedSet
  const fillerRaised = pieces.flatMap((piece) =>
    piece.substats
      .filter(
        (sub) =>
          !usedSet.has(sub.key) &&
          !lowestReadsBack(sub.key, piece.rarity, sub.rolls.length)
      )
      .map((sub) => ({ slotKey: piece.slotKey, key: sub.key }))
  )
  return { pieces, totals, gaps, fillerRaised }
}
