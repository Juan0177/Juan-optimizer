import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptAttack } from '@genshin-optimizer/gi/db'
import type { FightEstimate } from '../../components/enemy/stygianFights'

/** A conditional's state for an attack (its owner, path and value), as a run sets it */
export type RunAttackState = NonNullable<TeamOptAttack['states']>[number]

/**
 * Wolf's Gravestone: hits on an enemy under 30% HP give the party its ATK bonus for 12 s, once
 * every 30 s. Against an enemy with HP (a Stygian boss's, or HP set by hand) it is on for that
 * share of the fight, as an expected value: +ATK × uptime (damage grows with ATK in a straight line,
 * so that is the fight's average exactly).
 */
export const WOLFS_GRAVESTONE = {
  path: ['WolfsGravestone', 'WolfishTracker'],
  threshold: 0.3,
  duration: 12,
  cooldown: 30,
} as const

/**
 * When the enemy first falls under `threshold` of its Max HP (seconds into the fight). Its HP is
 * piecewise linear: a state can hold it flat (a ward) and an event take a step off at once.
 */
export function hpCrossing(
  estimate: Pick<FightEstimate, 'timeline'>,
  threshold: number
): number | undefined {
  const segments = [...estimate.timeline.segments].sort(
    (a, b) => a.start - b.start
  )
  for (const seg of segments) {
    if (seg.hpStart < threshold) return seg.start
    if (seg.hpEnd < threshold)
      return (
        seg.start +
        ((seg.hpStart - threshold) / (seg.hpStart - seg.hpEnd)) *
          (seg.end - seg.start)
      )
  }
  return undefined
}

export interface LowHpUptime {
  /** Its share of the fight, 0 to 1 */
  uptime: number
  /** The sheet's state for it: '' (off), '5' … '95' (percent), 'on' (all of it) */
  state: string
  /** Seconds the enemy is under the threshold, and the fight's length */
  below: number
  seconds: number
}

/** The sheet state for an uptime: the nearest 5%, '' at 0, 'on' at all of it */
export function uptimeState(uptime: number): string {
  const percent = Math.round(uptime * 20) * 5
  return percent >= 100 ? 'on' : percent <= 0 ? '' : `${percent}`
}

/**
 * Wolf's Gravestone's uptime over a fight: from when the enemy falls under 30% HP to its defeat,
 * 12 s of every 30 s. Undefined without a fight (no HP, or not defeated within the limit).
 */
export function wolfsGravestoneUptime(
  estimate: FightEstimate | undefined
): LowHpUptime | undefined {
  const seconds = estimate?.seconds
  if (!estimate || !seconds) return undefined
  const { threshold, duration, cooldown } = WOLFS_GRAVESTONE
  const at = hpCrossing(estimate, threshold)
  const below = at === undefined ? 0 : Math.max(0, seconds - at)
  let on = 0
  for (let t = 0; t < below; t += cooldown) on += Math.min(duration, below - t)
  const uptime = Math.min(1, on / seconds)
  return { uptime, state: uptimeState(uptime), below, seconds }
}

/** Each member's Wolf's Gravestone passive at this state, for every attack of a run */
export const wolfsGravestoneStates = (
  members: readonly CharacterKey[],
  state: string
): RunAttackState[] =>
  members.map((owner) => ({
    owner,
    path: [...WOLFS_GRAVESTONE.path],
    value: state,
  }))

/** The attacks with these states added to each (replacing its own at the same paths) */
export function withAttackStates(
  attacks: TeamOpt['attacks'],
  states: readonly RunAttackState[] | undefined
): TeamOpt['attacks'] {
  if (!states?.length) return attacks
  const same = (a: RunAttackState, b: RunAttackState) =>
    a.owner === b.owner && a.path.join('.') === b.path.join('.')
  return Object.fromEntries(
    Object.entries(attacks).map(([ck, list]) => [
      ck,
      list?.map((attack) => ({
        ...attack,
        states: [
          ...(attack.states ?? []).filter(
            (s) => !states.some((x) => same(s, x))
          ),
          ...states,
        ],
      })),
    ])
  ) as TeamOpt['attacks']
}

/**
 * The run states a result's played attacks carry (Wolf's Gravestone's uptime): what a run built on
 * that result (a gear pick, other constellations) plays with too
 */
export function playedAttackStates(
  played: { attacks: TeamOpt['attacks'] } | undefined
): RunAttackState[] | undefined {
  const found = new Map<string, RunAttackState>()
  const path = WOLFS_GRAVESTONE.path.join('.')
  for (const list of Object.values(played?.attacks ?? {}))
    for (const attack of list ?? [])
      for (const state of attack.states ?? [])
        if (state.path.join('.') === path) found.set(`${state.owner}`, state)
  return found.size ? [...found.values()] : undefined
}
