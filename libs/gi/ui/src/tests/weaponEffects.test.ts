/**
 * The weapon effects engine (rotation/weaponEffects): timed buffs from the wielder's triggers
 * (refresh, internal cooldown, stacks, ending on swap-out) and damage procs (the weapon's own
 * node, a chance as the hit's weight), with stubbed simulation hooks.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import type { RotationAction } from '../util/teamOpt/rotation/parse'
import type { SimContext, SimHit } from '../util/teamOpt/rotation/types'
import {
  type WeaponModule,
  weaponEffects,
} from '../util/teamOpt/rotation/weaponEffects'

const members: CharacterKey[] = ['Xiangling', 'Bennett']
function setup(module: WeaponModule, refinement = 1, candidate = false) {
  const windows: { path: string; value: string; start: number; end: number }[] =
    []
  const states: { path: string; value: string; t: number }[] = []
  const buffs: {
    path: string
    value: string
    start: number
    end: number
    max?: number
  }[] = []
  const hits: { path: string[]; weight?: number; t: number }[] = []
  const icd = new Map<string, number>()
  // (a small scheduler for the tasks the effects queue on a member's clock)
  let tasks: { t: number; fn: (c: SimContext) => void }[] = []
  const fx = weaponEffects([module], {
    members,
    gear: {
      Xiangling: candidate
        ? { weapon: 'Other', candidates: { weapons: [module.weapon] } }
        : { weapon: module.weapon, refinement },
    },
    onField: 'Xiangling',
    window: (_o, path, value, start, end) =>
      windows.push({ path: path.join('.'), value, start, end }),
    stack: () => undefined,
    ready: (key, t, frames) => {
      if (t < (icd.get(key) ?? Number.NEGATIVE_INFINITY)) return false
      icd.set(key, t + frames)
      return true
    },
  })
  const ctx = (now: number): SimContext =>
    ({
      now,
      // (no hitlag here: every clock is the world's)
      characterFrame: () => now,
      state: (_o: string, path: string[], value: string) =>
        states.push({ path: path.join('.'), value, t: now }),
      atCharacter: (_k: string, delay: number, fn: (c: SimContext) => void) =>
        tasks.push({ t: now + delay, fn }),
      buff: (
        _o: string,
        path: string[],
        value: string,
        delay: number,
        duration: number,
        o?: { max?: number }
      ) =>
        buffs.push({
          path: path.join('.'),
          value,
          start: now + delay,
          end: now + delay + duration,
          max: o?.max,
        }),
      hit: (delay: number, h: Omit<SimHit, 't'>) =>
        hits.push({ path: h.path, weight: h.weight, t: now + delay }),
    }) as unknown as SimContext
  const runUntil = (t: number) => {
    for (;;) {
      const due = tasks.filter((x) => x.t <= t).sort((a, b) => a.t - b.t)[0]
      if (!due) return
      tasks = tasks.filter((x) => x !== due)
      due.fn(ctx(due.t))
    }
  }
  const hit = (t: number, h: Partial<SimHit>) => {
    runUntil(t)
    fx.onHit(ctx(t), {
      t,
      characterKey: 'Xiangling',
      onField: 'Xiangling',
      path: ['normal', '0'],
      tag: 'normal',
      element: 'pyro',
      label: 'hit',
      ...h,
    } as SimHit)
  }
  const act = (
    t: number,
    kind: RotationAction['kind'],
    actor: CharacterKey = 'Xiangling'
  ) => {
    runUntil(t)
    fx.onAction(ctx(t), actor, { kind, text: kind } as RotationAction)
  }
  const swap = (t: number, from: CharacterKey, to: CharacterKey) => {
    runUntil(t)
    fx.onSwap(t, from, to, ctx(t))
  }
  /** The state's spans with a value, from its changes (to `until`) */
  const spans = (path: string, until = 1e9) => {
    runUntil(until)
    const out: [number, number, string][] = []
    let open: [number, string] | undefined
    for (const c of states.filter((x) => x.path === path)) {
      if (open) out.push([open[0], c.t, open[1]])
      open = c.value ? [c.t, c.value] : undefined
    }
    if (open) out.push([open[0], until, open[1]])
    return out.filter(([a, b]) => b > a)
  }
  return { fx, windows, states, buffs, hits, hit, act, swap, spans }
}

describe('timed weapon buffs', () => {
  it('declares the conditional, turns it on at once on a trigger and refreshes it', () => {
    const s = setup({
      weapon: 'TestBlade',
      timed: [
        {
          cond: 'afterSkill',
          on: [{ kind: 'action', actions: ['skill'] }],
          duration: 600,
        },
      ],
    })
    s.fx.declare()
    expect(s.windows).toEqual([
      { path: 'TestBlade.afterSkill', value: 'on', start: 0, end: 0 },
    ])
    s.act(100, 'skill')
    // (on from the trigger itself: a hit that takes its stats when queued sees it)
    expect(s.states).toEqual([
      { path: 'TestBlade.afterSkill', value: 'on', t: 100 },
    ])
    s.act(400, 'skill') // refreshes: on 100 → 1000
    s.act(2000, 'normal')
    expect(s.spans('TestBlade.afterSkill', 3000)).toEqual([
      [100, 400, 'on'],
      [400, 1000, 'on'],
    ])
  })
  it('keeps to its internal cooldown and ignores teammates', () => {
    const s = setup({
      weapon: 'TestBlade',
      timed: [
        {
          cond: 'react',
          on: [{ kind: 'reaction' }],
          duration: 300,
          icd: [0, 900, 900, 900, 900, 600],
        },
      ],
    })
    s.hit(0, { path: ['_reaction', 'melt'] })
    s.hit(500, { path: ['_reaction', 'melt'] }) // in cooldown
    s.hit(950, { path: ['_reaction', 'vaporize'], characterKey: 'Bennett' }) // a teammate's
    s.hit(1000, { path: ['_reaction', 'melt'] })
    expect(s.spans('TestBlade.react', 5000)).toEqual([
      [0, 300, 'on'],
      [1000, 1300, 'on'],
    ])
  })
  it('counts the refinement for durations and cooldowns', () => {
    const s = setup(
      {
        weapon: 'TestBlade',
        timed: [
          {
            cond: 'x',
            on: [{ kind: 'hit', tags: ['skill'] }],
            duration: [0, 360, 390, 420, 450, 480],
          },
        ],
      },
      5
    )
    s.hit(0, { tag: 'skill', path: ['skill', 'dmg'] })
    expect(s.spans('TestBlade.x', 5000)).toEqual([[0, 480, 'on']])
  })
  it('stacks each on its own clock, or refreshing them all', () => {
    const each = setup({
      weapon: 'TestBlade',
      timed: [
        {
          cond: 'stacks',
          on: [{ kind: 'hit', tags: ['normal'] }],
          duration: 300,
          stacks: { max: 3, refresh: 'each' },
        },
      ],
    })
    each.hit(0, {})
    each.hit(60, {})
    expect(each.buffs).toEqual([
      { path: 'TestBlade.stacks', value: '1', start: 0, end: 300, max: 3 },
      { path: 'TestBlade.stacks', value: '1', start: 60, end: 360, max: 3 },
    ])
    const all = setup({
      weapon: 'TestBlade',
      timed: [
        {
          cond: 'stacks',
          on: [{ kind: 'hit', tags: ['normal'] }],
          duration: 300,
          stacks: { max: 3, refresh: 'all' },
        },
      ],
    })
    all.hit(0, {})
    all.hit(60, {})
    expect(all.spans('TestBlade.stacks', 1000)).toEqual([
      [0, 60, '1'],
      [60, 360, '2'],
    ])
  })
  it('ends on swap-out and only triggers on the field', () => {
    const s = setup({
      weapon: 'TestBlade',
      timed: [
        {
          cond: 'field',
          on: [{ kind: 'action', actions: ['skill'] }],
          duration: 600,
          endOnSwapOut: true,
        },
      ],
    })
    s.act(0, 'skill')
    s.swap(200, 'Xiangling', 'Bennett')
    s.act(300, 'skill') // off the field
    expect(s.spans('TestBlade.field', 5000)).toEqual([[0, 200, 'on']])
  })
  it('opens for a KQM candidate wielder too', () => {
    const s = setup(
      {
        weapon: 'TestBlade',
        timed: [
          {
            cond: 'x',
            on: [{ kind: 'action', actions: ['burst'] }],
            duration: 60,
          },
        ],
      },
      1,
      true
    )
    s.act(0, 'burst')
    expect(s.spans('TestBlade.x', 100)).toEqual([[0, 60, 'on']])
  })
})

describe('weapon damage procs', () => {
  it('hits the weapon’s own node: chance gathered as credit, its cooldown from a proc', () => {
    const s = setup({
      weapon: 'TestBow',
      procs: [
        {
          node: 'dmg',
          label: 'Proc',
          on: [{ kind: 'hit', tags: ['normal', 'charged'] }],
          icd: 240,
          chance: [0, 0.6, 0.7, 0.8, 0.9, 1],
        },
      ],
    })
    s.hit(0, {}) // credit 0.6
    s.hit(100, { tag: 'charged', path: ['charged', 'dmg'] }) // 1.2: a proc, cooldown to 340
    s.hit(200, {}) // in cooldown: no roll
    s.hit(300, { tag: 'skill', path: ['skill', 'dmg'] }) // not a trigger
    s.hit(400, {}) // 0.2 + 0.6
    s.hit(500, {}) // 1.4: a proc
    expect(s.hits).toEqual([
      { path: ['weapon:TestBow', 'dmg'], weight: undefined, t: 100 },
      { path: ['weapon:TestBow', 'dmg'], weight: undefined, t: 500 },
    ])
  })
  it('or the chance as each hit’s weight (no cooldown)', () => {
    const s = setup({
      weapon: 'TestBow',
      procs: [
        {
          node: 'dmg',
          label: 'Proc',
          on: [{ kind: 'hit', tags: ['normal'] }],
          chance: 0.5,
          chanceAsWeight: true,
        },
      ],
    })
    s.hit(0, {})
    s.hit(10, {})
    expect(s.hits.map((h) => h.weight)).toEqual([0.5, 0.5])
  })
  it('procs only for the weapon worn (not a KQM candidate)', () => {
    const s = setup(
      {
        weapon: 'TestBow',
        procs: [
          {
            node: 'dmg',
            label: 'Proc',
            on: [{ kind: 'hit', tags: ['normal'] }],
          },
        ],
      },
      1,
      true
    )
    s.hit(0, {})
    expect(s.hits).toEqual([])
  })
})
