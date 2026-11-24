import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimHit, SimulationResult } from '@genshin-optimizer/gi/ui'

/** The reactions a damaging hit carries itself (`SimHit.reaction`); the others are hits of their own */
const ON_THE_HIT = new Set(['vaporize', 'melt', 'aggravate', 'spread'])
/** The simulation's own bookkeeping, not a reaction a player sees */
const HIDDEN = new Set(['moondrift'])

/** One reaction in the rotation: who triggered it, when, with which hit */
export interface ReactionEvent {
  /** Frame */
  t: number
  /** The simulation's name: melt, vaporize, overloaded, pyroSwirl, stellarConduct… */
  reaction: string
  /** Who triggered it */
  characterKey: CharacterKey
  /** Who was on the field */
  onField?: CharacterKey
  /** The triggering hit's label and path, when the simulation names it */
  label?: string
  path?: string[]
  /** The triggering hit's element */
  element?: string
  /**
   * Melt and Vaporize: forward (×2: Pyro on Cryo, Hydro on Pyro) or reverse (×1.5: Cryo on Pyro,
   * Pyro on Hydro)
   */
  direction?: 'forward' | 'reverse'
}

const FORWARD: Record<string, string> = { melt: 'pyro', vaporize: 'hydro' }
const REVERSE: Record<string, string> = { melt: 'cryo', vaporize: 'pyro' }
const direction = (reaction: string, element?: string) =>
  element && FORWARD[reaction] === element
    ? ('forward' as const)
    : element && REVERSE[reaction] === element
      ? ('reverse' as const)
      : undefined

/**
 * The reactions in the kept rotation, in order, from the simulation's reaction marks
 * (['_reaction', <name>] at the trigger's frame). Melt, Vaporize, Aggravate and Spread take their
 * hit's label and element from the damaging hit that carries them. `onFieldOnly`: only the ones
 * the on-field member triggers.
 */
export function reactionEvents(
  sim: Pick<SimulationResult, 'hits' | 'start' | 'frames'>,
  { onFieldOnly = false }: { onFieldOnly?: boolean } = {}
): ReactionEvent[] {
  const from = sim.start
  const to = sim.start + sim.frames
  // the damaging hits that carry a reaction, each matched to one mark at most
  const carriers = new Map<string, SimHit[]>()
  const key = (t: number, who: string, reaction: string) =>
    `${t}|${who}|${reaction}`
  /** Any hit of a member at a frame: the trigger of a reaction its mark doesn't name */
  const atFrame = new Map<string, SimHit>()
  for (const h of sim.hits) {
    if (h.path[0] === '_reaction' || h.path[0] === '_marker') continue
    if (h.path[0] !== 'reaction' && !atFrame.has(`${h.t}|${h.characterKey}`))
      atFrame.set(`${h.t}|${h.characterKey}`, h)
    if (h.reaction) {
      const k = key(h.t, h.characterKey, h.reaction)
      carriers.set(k, [...(carriers.get(k) ?? []), h])
    }
  }
  const events: ReactionEvent[] = []
  for (const h of sim.hits) {
    if (h.path[0] !== '_reaction' || h.t < from || h.t >= to) continue
    const reaction = h.path[1]
    if (!reaction || HIDDEN.has(reaction)) continue
    if (onFieldOnly && h.onField && h.onField !== h.characterKey) continue
    const source = ON_THE_HIT.has(reaction)
      ? carriers.get(key(h.t, h.characterKey, reaction))?.shift()
      : h.reactionSource
        ? undefined
        : atFrame.get(`${h.t}|${h.characterKey}`)
    const element = source?.element
    events.push({
      t: h.t,
      reaction,
      characterKey: h.characterKey,
      ...(h.onField ? { onField: h.onField } : {}),
      ...(source
        ? { label: source.label, path: source.path }
        : h.reactionSource
          ? { label: h.reactionSource.label, path: h.reactionSource.path }
          : {}),
      ...(element ? { element } : {}),
      ...(direction(reaction, element)
        ? { direction: direction(reaction, element) }
        : {}),
    })
  }
  return events.sort((a, b) => a.t - b.t)
}

/** A reaction's name key (`teamOpt.timeline.reactions.<key>`) and palette colour */
export function reactionKind(reaction: string): {
  key: string
  palette: string
} {
  const swirl = reaction.match(/^(pyro|hydro|electro|cryo)Swirl$/)
  if (swirl) return { key: 'swirl', palette: 'swirl' }
  const key = reaction
  const palette =
    {
      electroCharged: 'electrocharged',
      lunarCharged: 'lunarcharged',
      lunarBloom: 'lunarbloom',
      lunarCrystallize: 'lunarcrystallize',
      moondriftHarmony: 'lunarcrystallize',
      stellarConduct: 'stellarconduct',
      stellarSwirl: 'stellarswirl',
      frozen: 'cryo',
      quicken: 'dendro',
    }[reaction] ?? reaction.toLowerCase()
  return { key, palette }
}

/** Per member, how many of each reaction (forward and reverse Melt or Vaporize apart) */
export function reactionCounts(events: ReactionEvent[]) {
  const out = new Map<CharacterKey, Map<string, number>>()
  for (const e of events) {
    const k = e.direction ? `${e.reaction}.${e.direction}` : e.reaction
    const m = out.get(e.characterKey) ?? new Map<string, number>()
    m.set(k, (m.get(k) ?? 0) + 1)
    out.set(e.characterKey, m)
  }
  return out
}
