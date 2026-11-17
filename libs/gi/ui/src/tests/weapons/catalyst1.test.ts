/**
 * Weapon audit batch catalyst1: the rotation opens each weapon's own conditional from its trigger
 * (kqmsim and the game's text) and closes it after its duration, on swap-out or on the next
 * Skill; outside its windows it is declared off.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import { simulateRotation } from '../../util/teamOpt/rotation/simulate'
import type { KitModel } from '../../util/teamOpt/rotation/types'

/**
 * A Catalyst user: Skill and Burst 60 frames (a hit at 10), a Normal Attack string a hit every
 * 20 frames from 10, a Charged Attack 60 frames (a hit at 10), a dash 20 frames
 */
const probe: KitModel = {
  characterKey: 'Klee',
  element: 'pyro',
  source: 'test',
  act(ctx, _state, action) {
    const hit = (
      delay: number,
      tag: 'normal' | 'charged' | 'skill' | 'burst'
    ) =>
      ctx.hit(delay, {
        path: [tag, 'dmg'],
        tag,
        element: 'pyro',
        label: tag,
      })
    if (action.kind === 'normal') {
      const n = action.count ?? 1
      for (let i = 0; i < n; i++) hit(10 + 20 * i, 'normal')
      return { frames: 20 * n + 10 }
    }
    if (action.kind === 'dash') return { frames: 20 }
    if (
      action.kind === 'skill' ||
      action.kind === 'burst' ||
      action.kind === 'charged'
    )
      hit(10, action.kind)
    return { frames: 60 }
  },
}
/** A teammate whose Skill triggers a reaction 5 frames in */
const reactor: KitModel = {
  characterKey: 'Bennett',
  element: 'pyro',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill')
      ctx.hit(5, {
        path: ['_reaction', 'vaporize'],
        tag: 'other',
        element: 'pyro',
        label: 'Vaporize',
      })
    return { frames: 60 }
  },
}

const play = (
  text: string,
  weapon: string,
  refinement = 1,
  kit: KitModel = probe
) => {
  const members: CharacterKey[] = ['Klee', 'Bennett']
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Klee: 'pyro', Bennett: 'pyro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    kits: { Klee: kit, Bennett: reactor },
    reactions: { onHit() {} },
    gear: { Klee: { weapon, refinement } },
  })
  const windows = (cond: string) =>
    sim.buffWindows
      .filter((w) => w.path[0] === weapon && w.path[1] === cond)
      // (on windows only: a timed buff's off state is a window with value '')
      .filter((w) => w.end > w.start && w.value !== '')
      .map((w) => [w.value, w.start, w.end] as [string, number, number])
      .sort((a, b) => a[1] - b[1])
  const declared = (cond: string) =>
    sim.buffWindows.some(
      (w) => w.path[0] === weapon && w.path[1] === cond && w.end === w.start
    )
  const hits = (tag: string) =>
    sim.hits
      .filter((h) => h.characterKey === 'Klee' && h.tag === tag)
      .map((h) => h.t)
  const actions = (kind: string) =>
    sim.actions
      .filter((a) => a.characterKey === 'Klee' && a.text.startsWith(kind))
      .map((a) => a.start)
  const swaps = (sim.swaps ?? []).map((s) => s.start + s.frames)
  return { sim, windows, declared, hits, actions, swaps }
}

describe('Lost Prayer to the Sacred Winds', () => {
  const cond = 'BoundlessBlessing'
  it('a stack per 4 s tick on the field, up to 4', () => {
    const r = play('Klee W20', 'LostPrayerToTheSacredWinds')
    expect(r.declared(cond)).toBe(true)
    const w = r.windows(cond)
    expect(w.slice(0, 3)).toEqual([
      ['1', 240, 480],
      ['2', 480, 720],
      ['3', 720, 960],
    ])
    expect(w[3][0]).toBe('4')
    expect(w[3][1]).toBe(960)
    expect(w).toHaveLength(4)
  })
  it('all lost on leaving the field; counted again from the next tick back on it', () => {
    const r = play(
      'Klee W10 -> Bennett W3 -> Klee W10',
      'LostPrayerToTheSacredWinds'
    )
    const [out, back] = r.swaps
    const w = r.windows(cond)
    expect(w.slice(0, 2)).toEqual([
      ['1', 240, 480],
      ['2', 480, out],
    ])
    // none off the field
    expect(w.every(([, s, e]) => e <= out || s >= back)).toBe(true)
    const first = (Math.floor(back / 240) + 1) * 240
    expect(w[2]).toEqual(['1', first, first + 240])
  })
})

describe("Tulaytullah's Remembrance", () => {
  const cond = 'timePassive'
  it('stacks from the 1 s timer and Normal Attack hits, up to 10, for 14 s', () => {
    const r = play('Klee E N4 W20', 'TulaytullahsRemembrance')
    expect(r.declared(cond)).toBe(true)
    expect(r.declared('hitPassive')).toBe(true)
    expect(r.windows('hitPassive')).toEqual([])
    const [s] = r.actions('E')
    const [h1, h2, h3, h4] = r.hits('normal')
    const w = r.windows(cond)
    expect(w.slice(0, 5)).toEqual([
      ['1', s + 60, h1 + 1],
      ['3', h1 + 1, h2 + 1],
      ['5', h2 + 1, h3 + 1],
      ['7', h3 + 1, s + 120],
      ['8', s + 120, h4 + 1],
    ])
    expect(w.slice(5).every(([v]) => v === '10')).toBe(true)
    expect(Math.max(...w.map(([, , e]) => e))).toBe(s + 840)
  })
  it('ends when the wielder leaves the field', () => {
    const r = play('Klee E N2 -> Bennett W5', 'TulaytullahsRemembrance')
    const w = r.windows(cond)
    expect(Math.max(...w.map(([, , e]) => e))).toBe(r.swaps[0])
  })
  it('the next Skill resets the stacks', () => {
    const r = play('Klee E N4 W2 E W20', 'TulaytullahsRemembrance')
    const [, again] = r.actions('E')
    const w = r.windows(cond)
    expect(w.some(([, s, e]) => s < again + 60 && e > again)).toBe(false)
    expect(w.find(([, s]) => s >= again)).toEqual([
      '1',
      again + 60,
      again + 120,
    ])
  })
})

/** The probe, its Normal Attack hit taking its stats when queued and landing 30 frames later */
const queued: KitModel = {
  ...probe,
  act(ctx, state, action) {
    if (action.kind !== 'normal') return probe.act(ctx, state, action)
    ctx.hit(30, {
      path: ['normal', 'dmg'],
      tag: 'normal',
      element: 'pyro',
      label: 'normal',
      snapshotDelay: 0,
    })
    return { frames: 40 }
  },
}

describe('custom states are set at once', () => {
  it("a hit that snapshots when queued sees Tulaytullah's stacks", () => {
    const r = play('Klee E W1.5 N1 W5', 'TulaytullahsRemembrance', 1, queued)
    const [h] = r.sim.hits.filter(
      (x) => x.characterKey === 'Klee' && x.tag === 'normal'
    )
    // (queued 150 frames after the Skill: two of the timer's stacks)
    expect(
      h.snapshotStates?.find(
        (x) => x.path.join('.') === 'TulaytullahsRemembrance.timePassive'
      )?.value
    ).toBe('2')
  })
})

describe('Starsealed Edict', () => {
  it('Crystal Compounding 20 s after the Skill; a stack per party reaction, up to 3', () => {
    const r = play('Klee E -> Bennett E E E E W25', 'StarsealedEdict')
    const [s] = r.actions('E')
    expect(r.windows('crystalCompounding')).toEqual([['on', s, s + 1200]])
    const reactions = r.sim.hits
      .filter((h) => h.path[0] === '_reaction')
      .map((h) => h.t)
    expect(reactions).toHaveLength(4)
    const [a, b, c] = reactions
    expect(r.windows('lawOfCombustion')).toEqual([
      ['1', a + 1, b + 1],
      ['2', b + 1, c + 1],
      ['3', c + 1, s + 1200],
    ])
  })
  it('no stacks without reactions; declared off', () => {
    const r = play('Klee E W25', 'StarsealedEdict')
    expect(r.declared('lawOfCombustion')).toBe(true)
    expect(r.windows('lawOfCombustion')).toEqual([])
    expect(r.windows('crystalCompounding')).toHaveLength(1)
  })
})

describe('Dodoco Tales', () => {
  it('Normal Attack hits give Charged Attack DMG, Charged Attack hits ATK, 6 s after each', () => {
    const r = play('Klee N1 W3 CA W10', 'DodocoTales')
    const [n] = r.hits('normal')
    const [c] = r.hits('charged')
    expect(r.windows('DodoventureNormal')).toEqual([['on', n + 1, n + 361]])
    expect(r.windows('DodoventureCharged')).toEqual([['on', c + 1, c + 361]])
  })
})

describe('Solar Pearl', () => {
  it('a Normal Attack hit gives Skill and Burst DMG, a Skill hit Normal Attack DMG, 6 s', () => {
    const r = play('Klee N1 W1 E W10', 'SolarPearl')
    const [n] = r.hits('normal')
    const [e] = r.hits('skill')
    expect(r.windows('solarShineNormal')).toEqual([['normal', n + 1, n + 361]])
    expect(r.windows('solarShineSkillBurst')).toEqual([
      ['skillBurst', e + 1, e + 361],
    ])
  })
})

describe('Ring of Yaxche', () => {
  it('10 s after each Skill', () => {
    const r = play('Klee E W12 E W12', 'RingOfYaxche')
    const [a, b] = r.actions('E')
    expect(r.windows('afterSkill')).toEqual([
      ['on', a, a + 600],
      ['on', b, b + 600],
    ])
  })
})

describe('Wine and Song', () => {
  it('ATK for 5 s after a dash, refreshed by the next', () => {
    const r = play('Klee D W1 D W10', 'WineAndSong')
    const [a, b] = r.actions('D')
    expect(r.windows('EverChanging')).toEqual([['on', a, b + 300]])
  })
  it('never without a dash', () => {
    const r = play('Klee N3 E W10', 'WineAndSong')
    expect(r.declared('EverChanging')).toBe(true)
    expect(r.windows('EverChanging')).toEqual([])
  })
})

describe('Quantum Cat-alyst', () => {
  it('its EM stacks are the wielder’s own: not shown as a team buff', () => {
    const sheet = getWeaponSheet('QuantumCatalyst') as unknown as {
      document: { path?: string[]; teamBuff?: boolean }[]
    }
    const stacks = sheet.document.find(
      (d) => d.path?.join('.') === 'QuantumCatalyst.stacks'
    )
    expect(stacks).toBeDefined()
    expect(stacks?.teamBuff).toBeFalsy()
  })
})
