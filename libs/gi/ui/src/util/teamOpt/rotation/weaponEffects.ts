import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationAction, RotationActionKind } from './parse'
import type {
  HitElement,
  HitTag,
  SimBuffOwner,
  SimContext,
  SimGear,
  SimHit,
} from './types'

/**
 * Weapon effects the rotation simulation plays from a declarative description: timed buffs
 * (a conditional opened for a while by the wielder's actions, hits, reactions or heals, with an
 * internal cooldown and stacks) and damage procs (a hit on the weapon's own damage node). What
 * these forms can't express is a module's `custom` handler. The descriptions are adapted from
 * KQM's simulator (kqmsim, a gcsim fork, AGPL) and the game's text; see each module.
 */

/** A number, or one per refinement (index 1 to 5) */
export type ByRefinement = number | readonly number[]

/** What starts a timed buff or a proc (always the wielder's own) */
export type WeaponTrigger =
  /** The wielder starts one of these actions (on the field, unless `offField`) */
  | { kind: 'action'; actions: readonly RotationActionKind[] }
  /**
   * The wielder's damage hits with one of these tags (and elements). `field`: only while the
   * wielder is on the field ('on'), or off it ('off')
   */
  | {
      kind: 'hit'
      tags: readonly HitTag[]
      elements?: readonly HitElement[]
      field?: 'on' | 'off'
      /** A Skill hit only from a hold (`hold: true`) or a press (`false`) */
    }
  /** A reaction the wielder triggers (all reactions, or these: 'swirl', 'hyperbloom'…) */
  | { kind: 'reaction'; reactions?: readonly string[] }
  /** A heal reaches the wielder */
  | { kind: 'healed' }
  /** The wielder heals someone */
  | { kind: 'heals' }
  /** The wielder's HP changes (a tracked heal or drain) */
  | { kind: 'hpChange' }
  /** The wielder takes the field */
  | { kind: 'swapIn' }

export interface WeaponTimed {
  /** The sheet conditional's name: its path is [weapon, cond] */
  cond: string
  /** The state while it is up (default 'on'); stacks use the count */
  value?: string
  on: readonly WeaponTrigger[]
  /** Frames it lasts after each trigger (a trigger while up refreshes it) */
  duration: ByRefinement
  /** Frames before it can trigger again (from the trigger) */
  icd?: ByRefinement
  /**
   * Stacks: the state is the count. 'all': each gain refreshes every stack (one window per
   * count); 'each': each stack expires on its own
   */
  stacks?: { max: number; refresh: 'all' | 'each' }
  /** It ends when the wielder leaves the field */
  endOnSwapOut?: boolean
  /** Frames from the trigger to the buff (default 0) */
  delay?: number
}

export interface WeaponProc {
  /** The damage node in the weapon's display (`weapon:<key>`) */
  node: string
  on: readonly WeaponTrigger[]
  /** Frames between procs (from a proc: a failed roll starts none) */
  icd?: ByRefinement
  /**
   * Chance per trigger. By default each eligible trigger adds its chance as credit, and the proc
   * fires (and its cooldown starts) when the credit reaches 1: an expected-timing estimate, as
   * the game's failed rolls start no cooldown. `chanceAsWeight`: every trigger hits with the
   * chance as the hit's weight instead (for procs without a cooldown)
   */
  chance?: ByRefinement
  chanceAsWeight?: boolean
  /** Frames from the trigger to the hit (default 0) */
  delay?: number
  /** The proc's element, for reactions (default physical, no aura applied) */
  element?: HitElement
  /** Hits per proc (default 1) */
  count?: number
  label: string
}

/** What a module's custom handler gets */
export interface WeaponApi {
  members: readonly CharacterKey[]
  /** Worn, or one of the member's KQM candidates (enough for its own buff windows) */
  holds: (k: CharacterKey) => boolean
  /** Worn (for effects that change the play: procs, cooldowns, heals) */
  wears: (k: CharacterKey) => boolean
  refinement: (k: CharacterKey) => number
  window: (
    owner: SimBuffOwner,
    path: string[],
    value: string,
    start: number,
    end: number
  ) => void
  /** Stacks that each gain refreshes (see gearEffects' `stack`) */
  stack: (
    owner: CharacterKey,
    path: string[],
    t: number,
    duration: number,
    max: number
  ) => void
  /** Once per `frames` per key */
  ready: (key: string, t: number, frames: number) => boolean
  /** Who is on the field at `t` */
  onFieldAt: (t: number) => CharacterKey
}

export interface WeaponHandlers {
  /** Declare the conditionals it windows (they are off outside its windows) */
  declare?(): void
  onHit?(ctx: SimContext, hit: SimHit): void
  onAction?(ctx: SimContext, actor: CharacterKey, action: RotationAction): void
  onSwap?(
    t: number,
    from: CharacterKey,
    to: CharacterKey,
    ctx?: SimContext
  ): void
  end?(t: number): void
}

export interface WeaponModule {
  weapon: string
  timed?: readonly WeaponTimed[]
  procs?: readonly WeaponProc[]
  custom?: (api: WeaponApi) => WeaponHandlers
}

export const byRefinement = (v: ByRefinement | undefined, r: number) =>
  v === undefined
    ? 0
    : typeof v === 'number'
      ? v
      : (v[Math.min(5, Math.max(1, r))] ?? v[v.length - 1] ?? 0)

/** Reaction marks that are no reaction event (gcsim has none for them) */
const NOT_REACTIONS = new Set(['moondrift', 'moondriftHarmony'])
/**
 * A reaction event, once per reaction as gcsim fires them: its mark (`_reaction`), or for
 * Hyperbloom and Burgeon (no mark) their damage. A reaction's own damage hits (Overloaded's,
 * Swirl's) and Burning's ticks are not more of them
 */
export const isReactionEvent = (hit: SimHit) =>
  (hit.path[0] === '_reaction' && !NOT_REACTIONS.has(hit.path[1] ?? '')) ||
  (hit.path[0] === 'reaction' &&
    (hit.path[1] === 'hyperbloom' || hit.path[1] === 'burgeon'))

/** A damage hit (not a marker or a reaction's own damage) */
const isDamage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'

/** Who a `_heal` hit heals (as gearEffects counts it) */
export function healedBy(
  hit: SimHit,
  members: readonly CharacterKey[],
  onField: CharacterKey
): readonly CharacterKey[] {
  return (
    hit.healTargets ??
    ((hit.weight ?? 1) === members.length ? members : [hit.onField ?? onField])
  )
}

/** Whether `hit` is one of `trigger`'s events for wielder `k` */
export function hitTriggers(
  trigger: WeaponTrigger,
  k: CharacterKey,
  hit: SimHit,
  members: readonly CharacterKey[],
  onField: CharacterKey
) {
  switch (trigger.kind) {
    case 'hit':
      return (
        hit.characterKey === k &&
        isDamage(hit) &&
        trigger.tags.includes(hit.tag) &&
        (!trigger.elements || trigger.elements.includes(hit.element)) &&
        (!trigger.field ||
          (trigger.field === 'on' ? hit.onField === k : hit.onField !== k))
      )
    case 'reaction':
      return (
        hit.characterKey === k &&
        isReactionEvent(hit) &&
        (!trigger.reactions ||
          trigger.reactions.some(
            (r) => r.toLowerCase() === (hit.path[1] ?? '').toLowerCase()
          ))
      )
    case 'healed':
      return (
        hit.path[0] === '_heal' && healedBy(hit, members, onField).includes(k)
      )
    case 'heals':
      return hit.path[0] === '_heal' && hit.characterKey === k
    case 'hpChange':
      return (
        hit.path[0] === '_marker' &&
        hit.path[1] === 'hpChange' &&
        hit.characterKey === k
      )
    default:
      return false
  }
}

/**
 * The modules' effects for a team: one set of handlers gearEffects calls from its own. `gear` is
 * the members' sim gear (weapon, refinement, KQM candidates).
 */
export function weaponEffects(
  modules: readonly WeaponModule[],
  {
    members,
    gear,
    onField: start,
    window,
    stack,
    ready,
  }: {
    members: readonly CharacterKey[]
    gear: Partial<Record<CharacterKey, SimGear>>
    onField: CharacterKey
    window: WeaponApi['window']
    stack: WeaponApi['stack']
    ready: WeaponApi['ready']
  }
): Required<WeaponHandlers> {
  const fieldLog: [number, CharacterKey][] = [[0, start]]
  const onFieldAt = (t: number) => {
    let who = start
    for (const [from, k] of fieldLog) if (from <= t) who = k
    return who
  }
  const handlers: WeaponHandlers[] = []
  for (const module of modules) {
    const weapon = module.weapon
    const wears = (k: CharacterKey) => gear[k]?.weapon === weapon
    const holds = (k: CharacterKey) =>
      wears(k) || !!gear[k]?.candidates?.weapons?.includes(weapon)
    const refinement = (k: CharacterKey) =>
      Math.min(5, Math.max(1, gear[k]?.refinement ?? 1))
    const holders = members.filter(holds)
    if (!holders.length) continue
    if (module.custom)
      handlers.push(
        module.custom({
          members,
          holds,
          wears,
          refinement,
          window,
          stack,
          ready,
          onFieldAt,
        })
      )
    for (const timed of module.timed ?? [])
      handlers.push(
        timedHandlers(weapon, timed, holders, refinement, {
          members,
          window,
          ready,
          onFieldAt,
        })
      )
    for (const proc of module.procs ?? [])
      handlers.push(
        procHandlers(weapon, proc, members.filter(wears), refinement, {
          members,
          onFieldAt,
        })
      )
  }
  return {
    declare: () => handlers.forEach((h) => h.declare?.()),
    onHit: (ctx, hit) => handlers.forEach((h) => h.onHit?.(ctx, hit)),
    onAction: (ctx, actor, action) =>
      handlers.forEach((h) => h.onAction?.(ctx, actor, action)),
    onSwap: (t, from, to, ctx) => {
      fieldLog.push([t, to])
      handlers.forEach((h) => h.onSwap?.(t, from, to, ctx))
    },
    end: (t) => handlers.forEach((h) => h.end?.(t)),
  }
}

function timedHandlers(
  weapon: string,
  timed: WeaponTimed,
  holders: readonly CharacterKey[],
  refinement: (k: CharacterKey) => number,
  {
    members,
    window,
    ready,
    onFieldAt,
  }: Pick<WeaponApi, 'members' | 'window' | 'ready' | 'onFieldAt'>
): WeaponHandlers {
  const path = [weapon, timed.cond]
  const value = timed.value ?? 'on'
  const refreshAll = timed.stacks?.refresh === 'all'
  /**
   * Per wielder, its current buff (a plain one, or stacks all refreshed together): its count and
   * its generation, so that an expiry scheduled before a refresh does nothing. The state is set at
   * once (hits that take their stats when queued see it) and turned off by a task on the
   * wielder's clock (hitlag pauses it, as the game's and kqmsim's weapon statuses)
   */
  const live = new Map<CharacterKey, { count: number; gen: number }>()
  let gen = 0
  const off = (ctx: SimContext, k: CharacterKey) => {
    if (!live.has(k)) return
    live.delete(k)
    ctx.state(k, path, '')
  }
  const open = (ctx: SimContext, k: CharacterKey, duration: number) => {
    const before = live.get(k)
    const count = refreshAll
      ? Math.min(timed.stacks!.max, (before?.count ?? 0) + 1)
      : 1
    const mine = { count, gen: ++gen }
    live.set(k, mine)
    ctx.state(k, path, refreshAll ? String(count) : value)
    ctx.atCharacter(k, duration, (c) => {
      if (live.get(k)?.gen === mine.gen) off(c, k)
    })
  }
  const trigger = (ctx: SimContext, k: CharacterKey, t: number) => {
    if (timed.endOnSwapOut && onFieldAt(t) !== k) return
    const r = refinement(k)
    const icd = byRefinement(timed.icd, r)
    // (cooldowns on the wielder's clock, which its hitlag pauses: kqmsim's hitlag statuses)
    if (
      icd &&
      !ready(`${weapon}.${timed.cond}.${k}`, ctx.characterFrame(k), icd)
    )
      return
    const duration = byRefinement(timed.duration, r)
    const delay = timed.delay ?? 0
    if (timed.stacks && !refreshAll) {
      // (each stack its own window: their count, up to the most, is the state)
      ctx.buff(k, path, '1', delay, duration, { max: timed.stacks.max })
      return
    }
    if (delay > 0) ctx.atCharacter(k, delay, (c) => open(c, k, duration))
    else open(ctx, k, duration)
  }
  return {
    declare: () => {
      for (const k of holders) window(k, path, timed.stacks ? '1' : value, 0, 0)
    },
    onHit: (ctx, hit) => {
      for (const k of holders)
        if (
          timed.on.some((tr) =>
            hitTriggers(tr, k, hit, members, onFieldAt(hit.t))
          )
        )
          trigger(ctx, k, hit.t)
    },
    onAction: (ctx, actor, action) => {
      if (!holders.includes(actor)) return
      if (
        timed.on.some(
          (tr) => tr.kind === 'action' && tr.actions.includes(action.kind)
        )
      )
        trigger(ctx, actor, ctx.now)
    },
    onSwap: (t, from, to, ctx) => {
      if (!ctx) return
      if (timed.endOnSwapOut && holders.includes(from)) off(ctx, from)
      if (holders.includes(to) && timed.on.some((tr) => tr.kind === 'swapIn'))
        trigger(ctx, to, t)
    },
  }
}

function procHandlers(
  weapon: string,
  proc: WeaponProc,
  wielders: readonly CharacterKey[],
  refinement: (k: CharacterKey) => number,
  { members, onFieldAt }: Pick<WeaponApi, 'members' | 'onFieldAt'>
): WeaponHandlers {
  /** Per wielder: when its cooldown ends, and the chance credit gathered */
  const readyAt = new Map<CharacterKey, number>()
  const credit = new Map<CharacterKey, number>()
  const fire = (ctx: SimContext, k: CharacterKey) => {
    const r = refinement(k)
    // (the cooldown on the wielder's clock, which its hitlag pauses)
    const own = ctx.characterFrame(k)
    if (own < (readyAt.get(k) ?? Number.NEGATIVE_INFINITY)) return
    const chance = proc.chance === undefined ? 1 : byRefinement(proc.chance, r)
    if (chance <= 0) return
    let weight = 1
    if (chance < 1 && proc.chanceAsWeight) weight = chance
    else if (chance < 1) {
      const c = (credit.get(k) ?? 0) + chance
      if (c < 1 - 1e-9) {
        credit.set(k, c)
        return
      }
      credit.set(k, c - 1)
    }
    const icd = byRefinement(proc.icd, r)
    if (icd) readyAt.set(k, own + icd)
    for (let i = 0; i < (proc.count ?? 1); i++)
      ctx.hit(proc.delay ?? 0, {
        characterKey: k,
        path: [`weapon:${weapon}`, proc.node],
        tag: 'other',
        element: proc.element ?? 'physical',
        applies: false,
        label: proc.label,
        ...(weight < 1 && { weight }),
      })
  }
  return {
    onHit: (ctx, hit) => {
      for (const k of wielders)
        if (
          proc.on.some((tr) =>
            hitTriggers(tr, k, hit, members, onFieldAt(hit.t))
          )
        )
          fire(ctx, k)
    },
    onAction: (ctx, actor, action) => {
      if (!wielders.includes(actor)) return
      if (
        proc.on.some(
          (tr) => tr.kind === 'action' && tr.actions.includes(action.kind)
        )
      )
        fire(ctx, actor)
    },
  }
}
