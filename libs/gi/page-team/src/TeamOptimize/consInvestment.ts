import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type {
  InvestRotationMeta,
  KqmBuild,
  KqmResult,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  kqmInvestmentConcurrency,
  playedAttackStates,
  runInvestmentInPool,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { kqmRunRotation } from './RotationWriter'

/**
 * Team investment comparison: for each pull budget (1 extra constellation or 1 R1 signature weapon
 * costs 1 pull), finds both the single best upgrade path and top runner-up paths above the run's
 * baseline.
 *
 * Phase 1 evaluates independent single-member upgrades in parallel across the warm worker pool.
 * Phase 2 ranks allocations with a subset-anchored synergy estimator and evaluates only the top
 * surviving candidates per pull budget in parallel mini-waves with live branch-and-bound pruning.
 */

/** A team played at hypothetical constellations/signatures */
export interface ConsPoint {
  /** the team's damage per rotation */
  team: number
  /** each member's own damage per rotation */
  members: Partial<Record<CharacterKey, number>>
  /** the rotation's length (s): a constellation or alt rotation can change it */
  seconds?: number
  /** the KQM builds it was played with (the raised members' refitted) */
  builds: Partial<Record<CharacterKey, KqmBuild>>
  /** whether any member missed an ER/stat requirement with these upgrades */
  unmet?: boolean
}

/** Damage per second, or per rotation when its length is unknown */
export const dpsOf = (p: { team: number; seconds?: number }) =>
  p.seconds ? p.team / p.seconds : p.team

/** The highest constellation */
const MAX_CONS = 6

/** Every way to add `cost` constellations to members that can take `room[i]` more each */
export function spreads(room: readonly number[], cost: number): number[][] {
  const out: number[][] = []
  const go = (i: number, left: number, acc: number[]) => {
    if (i === room.length) {
      if (!left) out.push(acc)
      return
    }
    for (let d = 0; d <= Math.min(room[i], left); d++)
      go(i + 1, left - d, [...acc, d])
  }
  go(0, cost, [])
  return out
}

/** A cost's best: the team's constellations (by member, in team order) and its DPS */
export interface Investment {
  cost: number
  cons: number[]
  dps: number
}

/**
 * For each cost from 0 (the run's) to every member at C6, the constellations with the most team
 * DPS. `single(i, c)`: the team's DPS with member i at c alone (known for every c above the
 * run's); `evaluate`: the team's DPS played at those constellations (several members raised).
 * `margin`: how far under the best played an estimate may be and still be played; `most`: at most
 * this many played per cost.
 */
export async function bestInvestments({
  base,
  baseDps,
  single,
  evaluate,
  margin = 0.02,
  most = 6,
  isCancelled = () => false,
  onCost,
}: {
  base: readonly number[]
  baseDps: number
  single: (i: number, cons: number) => number | undefined
  evaluate: (cons: number[]) => Promise<number | undefined>
  margin?: number
  most?: number
  isCancelled?: () => boolean
  onCost?: (cost: number, costs: number) => void
}): Promise<Investment[] | undefined> {
  const room = base.map((c) => Math.max(0, MAX_CONS - c))
  const costs = room.reduce((a, b) => a + b, 0)
  // the team's DPS at constellations played: the run's, each member alone, combinations played
  const known: { cons: number[]; cost: number; dps: number }[] = [
    { cons: [...base], cost: 0, dps: baseDps },
  ]
  base.forEach((c0, i) => {
    for (let c = c0 + 1; c <= MAX_CONS; c++) {
      const dps = single(i, c)
      if (dps !== undefined)
        known.push({
          cons: base.map((b, k) => (k === i ? c : b)),
          cost: c - c0,
          dps,
        })
    }
  })
  const aloneAt = (i: number, c: number) =>
    c === base[i] ? baseDps : single(i, c)
  /**
   * Constellations' DPS estimated from the most constellations of them played (their members'
   * interplay as played), and each further one's gain alone; several as informed: their mean
   */
  const estimate = (cons: number[]) => {
    let from = -1
    let sum = 0
    let n = 0
    for (const k of known) {
      if (k.cost < from || k.cons.some((c, i) => c > cons[i])) continue
      let value = k.dps
      for (let i = 0; i < cons.length && Number.isFinite(value); i++) {
        if (cons[i] === k.cons[i]) continue
        const to = aloneAt(i, cons[i])
        const at = aloneAt(i, k.cons[i])
        value = to !== undefined && at ? (value * to) / at : Number.NaN
      }
      if (!Number.isFinite(value)) continue
      if (k.cost > from) {
        from = k.cost
        sum = 0
        n = 0
      }
      sum += value
      n++
    }
    return n ? sum / n : undefined
  }
  const out: Investment[] = [{ cost: 0, cons: [...base], dps: baseDps }]
  for (let cost = 1; cost <= costs; cost++) {
    onCost?.(cost, costs)
    const options = spreads(room, cost).flatMap((spread) => {
      const cons = base.map((c, i) => c + spread[i])
      const key = cons.join()
      const exact = known.find((k) => k.cons.join() === key)?.dps
      const guess = exact ?? estimate(cons)
      return guess === undefined ? [] : [{ cons, guess, exact }]
    })
    options.sort((a, b) => b.guess - a.guess)
    let best: Investment | undefined
    for (const o of options)
      if (o.exact !== undefined && (!best || o.exact > best.dps))
        best = { cost, cons: o.cons, dps: o.exact }
    let tried = 0
    for (const o of options) {
      if (o.exact !== undefined) continue
      if (tried >= most) break
      if (best && o.guess < best.dps * (1 - margin)) break
      if (isCancelled()) return undefined
      tried++
      const dps = await evaluate(o.cons)
      if (dps === undefined) continue
      known.push({ cons: o.cons, cost, dps })
      if (!best || dps > best.dps) best = { cost, cons: o.cons, dps }
    }
    if (best) out.push(best)
  }
  return out
}

/** A hypothetical investment state across team members */
export interface InvestmentState {
  /** Target constellation per member (in team order) */
  cons: number[]
  /** Whether each member adds their R1 signature weapon (false: keep baseline weapon) */
  sig: boolean[]
}

export const investmentStateKey = ({ cons, sig }: InvestmentState) =>
  `${cons.join(',')}|${sig.map((s) => (s ? '1' : '0')).join('')}`

/** Result of evaluating one hypothetical investment state */
export interface InvestmentEval {
  dps: number
  seconds?: number
  rotationLabel?: string
  unmet?: boolean
  point?: ConsPoint
}

/** A ranked investment path at a specific pull budget */
export interface InvestmentPath extends InvestmentState {
  cost: number
  dps: number
  /** Relative gain vs baseline DPS (e.g. 0.25 = +25%) */
  gainPct: number
  /** Absolute DPS gain vs baseline */
  dpsGain: number
  /** Relative gain per extra pull (gainPct / cost; 0 for cost 0) */
  gainPerPull: number
  seconds?: number
  rotationLabel?: string
  unmet?: boolean
  point?: ConsPoint
}

export interface InvestmentAllocation {
  consDelta: number[]
  sigDelta: boolean[]
}

/**
 * Every way to spend `cost` pulls across member constellations (`consRoom[i]`) and optional R1
 * signature upgrades (`canAddSig[i]`).
 */
export function investmentAllocations(
  consRoom: readonly number[],
  canAddSig: readonly boolean[],
  cost: number
): InvestmentAllocation[] {
  const n = consRoom.length
  const out: InvestmentAllocation[] = []
  const suffixMax = new Array<number>(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--)
    suffixMax[i] = suffixMax[i + 1] + consRoom[i] + (canAddSig[i] ? 1 : 0)
  const consDelta = new Array<number>(n).fill(0)
  const sigDelta = new Array<boolean>(n).fill(false)
  const go = (i: number, left: number) => {
    if (left > suffixMax[i]) return
    if (i === n) {
      if (left === 0)
        out.push({ consDelta: [...consDelta], sigDelta: [...sigDelta] })
      return
    }
    const maxSig = canAddSig[i] && left >= 1 ? 1 : 0
    for (let s = 0; s <= maxSig; s++) {
      sigDelta[i] = s === 1
      const rem = left - s
      const maxC = Math.min(consRoom[i], rem)
      for (let d = 0; d <= maxC; d++) {
        consDelta[i] = d
        go(i + 1, rem - d)
      }
    }
    consDelta[i] = 0
    sigDelta[i] = false
  }
  go(0, cost)
  return out
}

export interface InvestmentPlanProgress {
  phase: 'singles' | 'paths'
  done: number
  total: number
  memberIndex?: number
  targetCons?: number
  isSig?: boolean
  cost?: number
  maxBudget?: number
}

export interface InvestmentPlan {
  base: InvestmentPath
  /** Top ranked evaluated paths for every pull budget `1..maxBudget` */
  byBudget: Record<number, InvestmentPath[]>
  /** Single highest-DPS path for every pull budget `0..maxBudget` */
  bestByCost: InvestmentPath[]
  /** Single-member evaluations: constellations above base and R1 signature */
  singles: {
    cons: Record<number, Record<number, InvestmentEval>>
    sig: Record<number, InvestmentEval>
  }
  maxBudget: number
}

/**
 * Generalized budget-aware investment planner with parallel worker execution and branch-and-bound
 * pruning:
 * - Phase 1 evaluates single-upgrade building blocks up to `maxBudget` concurrently (`concurrency`).
 * - Phase 2 ranks allocations with subset-anchored synergy estimates and evaluates surviving
 *   candidates in parallel mini-waves with live top-K threshold pruning.
 */
export async function planInvestments({
  baseCons,
  maxCons,
  canAddSig,
  baseDps,
  baseSeconds,
  basePoint,
  maxBudget,
  topK = 5,
  margin = 0.015,
  most = 6,
  concurrency = 1,
  evaluate,
  cache = new Map<string, InvestmentEval>(),
  isCancelled = () => false,
  onProgress,
  onPartial,
}: {
  baseCons: readonly number[]
  maxCons: readonly number[]
  canAddSig: readonly boolean[]
  baseDps: number
  baseSeconds?: number
  basePoint?: ConsPoint
  maxBudget: number
  topK?: number
  margin?: number
  most?: number
  /** How many evaluations to run in parallel (typically `kqmInvestmentConcurrency()`) */
  concurrency?: number
  evaluate: (state: InvestmentState) => Promise<InvestmentEval | undefined>
  /** Reusable evaluation cache keyed by `investmentStateKey(state)` */
  cache?: Map<string, InvestmentEval>
  isCancelled?: () => boolean
  onProgress?: (progress: InvestmentPlanProgress) => void
  /** Fires after each budget level completes so UI can stream partial results immediately */
  onPartial?: (partial: InvestmentPlan) => void
}): Promise<InvestmentPlan | undefined> {
  const workers = Math.max(1, Math.floor(concurrency))
  const n = baseCons.length
  const baseSig = new Array<boolean>(n).fill(false)
  const rawRoom = baseCons.map((c, i) =>
    Math.max(0, Math.min(MAX_CONS, maxCons[i] ?? c) - c)
  )
  const totalRoom =
    rawRoom.reduce((a, b) => a + b, 0) + canAddSig.filter(Boolean).length
  const budget = Math.max(0, Math.min(maxBudget, totalRoom))
  const consRoom = rawRoom.map((r) => Math.min(r, budget))

  const toPath = (
    state: InvestmentState,
    cost: number,
    ev: InvestmentEval
  ): InvestmentPath => {
    const dpsGain = ev.dps - baseDps
    const gainPct = baseDps > 0 ? dpsGain / baseDps : 0
    return {
      ...state,
      cost,
      dps: ev.dps,
      dpsGain,
      gainPct,
      gainPerPull: cost > 0 ? gainPct / cost : 0,
      seconds: ev.seconds,
      rotationLabel: ev.rotationLabel,
      unmet: ev.unmet,
      point: ev.point,
    }
  }

  const baseEval: InvestmentEval = {
    dps: baseDps,
    seconds: baseSeconds,
    point: basePoint,
  }
  const basePath = toPath(
    { cons: [...baseCons], sig: [...baseSig] },
    0,
    baseEval
  )

  const known = new Map<
    string,
    { state: InvestmentState; cost: number; ev: InvestmentEval }
  >()
  const remember = (
    state: InvestmentState,
    cost: number,
    ev: InvestmentEval
  ) => {
    const key = investmentStateKey(state)
    known.set(key, { state, cost, ev })
    cache.set(key, ev)
  }
  remember({ cons: [...baseCons], sig: [...baseSig] }, 0, baseEval)

  const singleCons: Record<number, Record<number, InvestmentEval>> = {}
  const singleSig: Record<number, InvestmentEval> = {}

  // Phase 1: evaluate single-member building blocks up to `budget` (cost 1 first, then 2, 3...)
  const singleTasks: {
    memberIndex: number
    targetCons?: number
    isSig?: boolean
    cost: number
    state: InvestmentState
  }[] = []
  for (let i = 0; i < n; i++) {
    if (canAddSig[i] && budget >= 1) {
      const sig = [...baseSig]
      sig[i] = true
      singleTasks.push({
        memberIndex: i,
        isSig: true,
        cost: 1,
        state: { cons: [...baseCons], sig },
      })
    }
    for (let d = 1; d <= consRoom[i]; d++) {
      const cons = [...baseCons]
      cons[i] = baseCons[i] + d
      singleTasks.push({
        memberIndex: i,
        targetCons: cons[i],
        cost: d,
        state: { cons, sig: [...baseSig] },
      })
    }
  }
  singleTasks.sort((a, b) => a.cost - b.cost || a.memberIndex - b.memberIndex)

  let singleDone = 0
  const uncachedTasks: typeof singleTasks = []
  for (const task of singleTasks) {
    const ev = cache.get(investmentStateKey(task.state))
    if (ev) {
      singleDone++
      remember(task.state, task.cost, ev)
      if (task.isSig) singleSig[task.memberIndex] = ev
      else if (task.targetCons !== undefined) {
        singleCons[task.memberIndex] ??= {}
        singleCons[task.memberIndex][task.targetCons] = ev
      }
    } else {
      uncachedTasks.push(task)
    }
  }

  if (uncachedTasks.length) {
    let cursor = 0
    const runSingleWorker = async () => {
      while (cursor < uncachedTasks.length) {
        if (isCancelled()) return
        const task = uncachedTasks[cursor++]
        onProgress?.({
          phase: 'singles',
          done: singleDone,
          total: singleTasks.length,
          memberIndex: task.memberIndex,
          targetCons: task.targetCons,
          isSig: task.isSig,
        })
        const ev = await evaluate(task.state)
        if (isCancelled()) return
        singleDone++
        onProgress?.({
          phase: 'singles',
          done: singleDone,
          total: singleTasks.length,
          memberIndex: task.memberIndex,
          targetCons: task.targetCons,
          isSig: task.isSig,
        })
        if (!ev) continue
        remember(task.state, task.cost, ev)
        if (task.isSig) singleSig[task.memberIndex] = ev
        else if (task.targetCons !== undefined) {
          singleCons[task.memberIndex] ??= {}
          singleCons[task.memberIndex][task.targetCons] = ev
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(workers, uncachedTasks.length) },
        runSingleWorker
      )
    )
    if (isCancelled()) return undefined
  }

  const aloneConsDps = (i: number, c: number) =>
    c === baseCons[i] ? baseDps : singleCons[i]?.[c]?.dps
  const aloneSigDps = (i: number) => singleSig[i]?.dps

  /**
   * Estimate a candidate state's DPS from the highest-cost already-evaluated subset(s) of it,
   * scaled by each remaining upgrade's standalone multiplier.
   */
  const estimate = (state: InvestmentState) => {
    let from = -1
    let sum = 0
    let count = 0
    for (const k of known.values()) {
      if (k.cost < from) continue
      let isSubset = true
      for (let i = 0; i < n; i++) {
        if (
          k.state.cons[i] > state.cons[i] ||
          (k.state.sig[i] && !state.sig[i])
        ) {
          isSubset = false
          break
        }
      }
      if (!isSubset) continue
      let value = k.ev.dps
      for (let i = 0; i < n && Number.isFinite(value); i++) {
        if (state.cons[i] > k.state.cons[i]) {
          const to = aloneConsDps(i, state.cons[i])
          const at = aloneConsDps(i, k.state.cons[i])
          value = to !== undefined && at ? (value * to) / at : Number.NaN
        }
        if (state.sig[i] && !k.state.sig[i]) {
          const to = aloneSigDps(i)
          value =
            to !== undefined && baseDps > 0
              ? (value * to) / baseDps
              : Number.NaN
        }
      }
      if (!Number.isFinite(value)) continue
      if (k.cost > from) {
        from = k.cost
        sum = 0
        count = 0
      }
      sum += value
      count++
    }
    return count ? sum / count : undefined
  }

  // Phase 2: find top-K evaluated paths at each budget `1..budget` in parallel waves with pruning
  const byBudget: Record<number, InvestmentPath[]> = {}
  const bestByCost: InvestmentPath[] = [basePath]

  for (let cost = 1; cost <= budget; cost++) {
    if (isCancelled()) return undefined
    onProgress?.({
      phase: 'paths',
      done: cost - 1,
      total: budget,
      cost,
      maxBudget: budget,
    })
    const candidates = investmentAllocations(consRoom, canAddSig, cost).flatMap(
      ({ consDelta, sigDelta }) => {
        const state: InvestmentState = {
          cons: baseCons.map((c, i) => c + consDelta[i]),
          sig: sigDelta,
        }
        const key = investmentStateKey(state)
        const cached = known.get(key)?.ev ?? cache.get(key)
        if (cached && !known.has(key)) remember(state, cost, cached)
        const guess = cached?.dps ?? estimate(state)
        return guess === undefined ? [] : [{ state, guess, exact: cached }]
      }
    )
    candidates.sort(
      (a, b) => (b.exact?.dps ?? b.guess) - (a.exact?.dps ?? a.guess)
    )

    const evaluated: InvestmentPath[] = []
    const pending: typeof candidates = []
    for (const c of candidates) {
      if (c.exact) evaluated.push(toPath(c.state, cost, c.exact))
      else pending.push(c)
    }
    evaluated.sort((a, b) => b.dps - a.dps)

    let tried = 0
    let pendingIdx = 0
    while (tried < most && pendingIdx < pending.length) {
      if (isCancelled()) return undefined
      const threshold =
        evaluated.length >= topK ? evaluated[topK - 1]?.dps : undefined
      // Collect up to `workers` surviving candidates for one parallel wave
      const wave: typeof candidates = []
      while (
        wave.length < workers &&
        tried + wave.length < most &&
        pendingIdx < pending.length
      ) {
        const c = pending[pendingIdx]
        if (threshold !== undefined && c.guess < threshold * (1 - margin)) break
        wave.push(c)
        pendingIdx++
      }
      if (!wave.length) break
      tried += wave.length
      const results = await Promise.all(
        wave.map(async (c) => ({ state: c.state, ev: await evaluate(c.state) }))
      )
      if (isCancelled()) return undefined
      for (const { state, ev } of results) {
        if (!ev) continue
        remember(state, cost, ev)
        evaluated.push(toPath(state, cost, ev))
      }
      evaluated.sort((a, b) => b.dps - a.dps)
    }

    const top = evaluated.slice(0, topK)
    byBudget[cost] = top
    if (top[0]) bestByCost.push(top[0])
    if (onPartial && cost < budget && !isCancelled()) {
      onPartial({
        base: basePath,
        byBudget: { ...byBudget },
        bestByCost: [...bestByCost],
        singles: {
          cons: { ...singleCons },
          sig: { ...singleSig },
        },
        maxBudget: cost,
      })
    }
  }

  return {
    base: basePath,
    byBudget,
    bestByCost,
    singles: { cons: singleCons, sig: singleSig },
    maxBudget: budget,
  }
}

/**
 * The team played at other constellations (`cons`: the members raised) and/or R1 signature
 * weapons (`signatures`), executed on the warm parallel worker pool with single-pass replay
 * and optional fast `summaryOnly` finish.
 */
export async function refitConstellations({
  database,
  teamId,
  gender,
  i18n,
  setup,
  result,
  cons,
  signatures,
  start,
  text,
  summaryOnly = false,
  isCancelled,
}: {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  i18n: i18n
  setup: TeamOpt
  result: KqmResult
  cons: Partial<Record<CharacterKey, number>>
  /** Optional signature weapon refinement overrides (e.g. `{ Sandrone: 1 }` for R1) */
  signatures?: Partial<Record<CharacterKey, number>>
  start?: Partial<Record<CharacterKey, KqmBuild>>
  text?: string
  /** Skip full `finish()` when caller only needs team DPS, builds, and unmet flag */
  summaryOnly?: boolean
  isCancelled?: () => boolean
  onProgress?: (progress: number) => void
}): Promise<ConsPoint | undefined> {
  const rotation = kqmRunRotation(database, gender, i18n, teamId)
  const baseEr = Object.fromEntries(
    Object.entries(result.energyRecharge).flatMap(([ck, er]) =>
      er ? [[ck, er.minimum]] : []
    )
  ) as Partial<Record<CharacterKey, number>>
  // Avoid structured-cloning huge attack arrays 3x over worker IPC (`setup.attacks`,
  // `setup.kqm.attacks`, and `result.played.attacks`) when `result.played` already carries them.
  const slimSetup: TeamOpt = result.played
    ? {
        ...setup,
        attacks: {},
        ...(setup.kqm ? { kqm: { ...setup.kqm, attacks: undefined } } : {}),
      }
    : setup
  return runInvestmentInPool(
    database,
    {
      mode: 'kqm',
      teamId,
      gender,
      setup: slimSetup,
      from: { ...result.builds, ...start },
      played: result.played,
      attackStates: playedAttackStates(result.played),
      cons,
      signatures,
      rotation,
      text,
      baseEr,
      summaryOnly,
    },
    isCancelled
  )
}

/**
 * Evaluate a Team Optimize (real inventory) result at hypothetical constellations and/or R1
 * signature weapons on the warm parallel worker pool.
 */
export async function evaluateInventoryInvestment({
  database,
  teamId,
  gender,
  teamOpt,
  result,
  cons,
  signatures,
  text,
  rotation,
  isCancelled,
}: {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  members?: TeamOptMember[]
  teamOpt: TeamOpt
  result: TeamOptResult
  cons: Partial<Record<CharacterKey, number>>
  signatures?: Partial<Record<CharacterKey, number>>
  /** Alternative rotation text for this constellation state (overrides team's written rotation) */
  text?: string
  /** Team Optimize's saved written rotation metadata (for replaying written or alt rotations) */
  rotation?: InvestRotationMeta
  isCancelled?: () => boolean
}): Promise<ConsPoint | undefined> {
  return runInvestmentInPool(
    database,
    {
      mode: 'inventory',
      teamId,
      gender,
      teamOpt,
      result: {
        builds: result.builds,
        weapons: result.weapons,
        attackStates: result.attackStates,
        rotationTime: result.rotationTime,
      },
      cons,
      signatures,
      rotation,
      text,
    },
    isCancelled
  )
}

export { kqmInvestmentConcurrency }
