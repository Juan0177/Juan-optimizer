import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import type { KqmBuild, KqmResult } from '@genshin-optimizer/gi/ui'
import { optimizeTeamKqm, playedAttackStates } from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { kqmReplayOf } from './useKqmRun'

/**
 * Constellation investment: for each cost (one constellation of any member costs 1), the team's
 * constellations above the run's that give it the most DPS.
 *
 * Every way to spend a cost is ranked first by an estimate: the constellations played so far that
 * it includes the most of (the run's, a member alone, a combination played at a lower cost: the
 * members' interplay as played), times each further constellation's gain alone; then the best few
 * are played for real (their members refitted together, `refitConstellations`) until the next
 * one's estimate is clearly under the best played. A member raised alone is its own chart's
 * figure, played already.
 */

/** A member raised alone (the others at the run's constellations): what it plays */
export interface ConsPoint {
  /** the team's damage per rotation */
  team: number
  /** each member's own damage per rotation */
  members: Partial<Record<CharacterKey, number>>
  /** the rotation's length (s): a constellation can change it */
  seconds?: number
  /** the builds it was played with (the raised members' refitted) */
  builds: Partial<Record<CharacterKey, KqmBuild>>
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

/**
 * The team played at other constellations (`cons`: the members raised), from a run's builds: the
 * raised members refitted together (their weapons and sets kept, main stats and rolls found
 * again), from their builds at those constellations alone when known (`start`); the others keep
 * the run's. `text`: another rotation to play (absent: the team's written one).
 */
export async function refitConstellations({
  database,
  teamId,
  gender,
  i18n,
  setup,
  result,
  cons,
  start,
  text,
  isCancelled,
  onProgress,
}: {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  i18n: i18n
  setup: TeamOpt
  result: KqmResult
  cons: Partial<Record<CharacterKey, number>>
  start?: Partial<Record<CharacterKey, KqmBuild>>
  text?: string
  isCancelled?: () => boolean
  onProgress?: (progress: number) => void
}): Promise<ConsPoint | undefined> {
  const kqm = setup.kqm ?? defaultTeamOptKqm
  const teamOpt: TeamOpt = {
    ...setup,
    kqm: {
      ...kqm,
      constellations: { ...kqm.constellations, ...cons },
    },
  }
  const raised = Object.keys(cons) as CharacterKey[]
  const found = await optimizeTeamKqm({
    database,
    teamId,
    gender,
    teamOpt,
    replay: kqmReplayOf(database, gender, i18n, teamId, teamOpt, text),
    // (as its result was played: Wolf's Gravestone's uptime against the enemy)
    attackStates: playedAttackStates(result.played),
    from: { ...result.builds, ...start },
    only: raised,
    maxRounds: 1,
    isCancelled,
    onStep: (step) => onProgress?.(step.progress ?? 0),
  })
  if (!found) return undefined
  return {
    team: found.after.total,
    members: found.after.members,
    seconds:
      found.played?.rotationTime ?? teamOpt.rotationTime ?? setup.rotationTime,
    builds: found.builds,
  }
}
