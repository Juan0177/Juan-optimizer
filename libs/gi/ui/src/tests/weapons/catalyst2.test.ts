/**
 * Weapon audit batch catalyst2: the rotation opens each weapon's own conditionals from the
 * wielder's triggers (kqmsim and the game's text) and closes them after their duration, on their
 * cooldown or when used up; outside their windows they are declared off. Also the sheet fixes
 * (Reliquary of Truth's shown duration, self-only conditionals not listed as team buffs).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { describe, expect, it } from 'vitest'
import type { RotationActionKind } from '../../util/teamOpt/rotation/parse'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import { simulateRotation } from '../../util/teamOpt/rotation/simulate'
import type {
  HitTag,
  KitModel,
  SimContext,
} from '../../util/teamOpt/rotation/types'

type HitInput = Parameters<SimContext['hit']>[1]
type Emits = Partial<Record<RotationActionKind, [number, HitInput][]>>

/** A test kit: each action emits `emits[kind]` (delay, hit); dash and jump 20 frames, others 60 */
const kit = (characterKey: CharacterKey, emits: Emits = {}): KitModel => ({
  characterKey,
  element: 'pyro',
  source: 'test',
  act(ctx, _state, action) {
    for (const [delay, hit] of emits[action.kind] ?? []) ctx.hit(delay, hit)
    return {
      frames: action.kind === 'dash' || action.kind === 'jump' ? 20 : 60,
    }
  },
})
const dmg = (tag: HitTag, label: string = tag): HitInput => ({
  path: [tag, 'dmg'],
  tag,
  element: 'pyro',
  label,
})
const mark = (reaction: string): HitInput => ({
  path: ['_reaction', reaction],
  tag: 'other',
  element: 'pyro',
  label: reaction,
})
const heal = (targets: CharacterKey[]): HitInput => ({
  path: ['_heal', 'skill', 'heal'],
  tag: 'other',
  element: 'physical',
  label: 'Heal',
  healTargets: targets,
})

const members: CharacterKey[] = ['Klee', 'Bennett']
const play = (
  text: string,
  weapon: string,
  emits: { Klee?: Emits; Bennett?: Emits },
  refinement = 1
) => {
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
    kits: {
      Klee: kit('Klee', emits.Klee),
      Bennett: kit('Bennett', emits.Bennett),
    },
    reactions: { onHit() {} },
    gear: { Klee: { weapon, refinement } },
  })
  const start = sim.actions[0].start
  const of = (cond: string) =>
    sim.buffWindows.filter((w) => w.path.join('.') === `${weapon}.${cond}`)
  return {
    sim,
    /** The frames (from the start) of the hits on `path` */
    times: (path: string) =>
      sim.hits.filter((h) => h.path.join('.') === path).map((h) => h.t - start),
    /** Its windows up: [state, from, to] (from the start) */
    on: (cond: string) =>
      of(cond)
        .filter((w) => w.end > w.start && w.value !== '')
        .map((w) => [w.value, w.start - start, w.end - start]),
    declared: (cond: string) => of(cond).some((w) => w.end === w.start),
  }
}

describe('Hymn of the Maelstrom', () => {
  it('a stack per heal the wielder performs, 10 s from the last, up to 3', () => {
    const r = play('Klee E W1 E W1 E W1 E W12', 'HymnOfTheMaelstrom', {
      Klee: { skill: [[0, heal(['Klee'])]] },
    })
    const [h0, h1, h2, h3] = r.times('_heal.skill.heal')
    expect(r.declared('stacks')).toBe(true)
    expect(r.on('stacks')).toEqual([
      ['1', h0, h1],
      ['2', h1, h2],
      ['3', h2, h3],
      ['3', h3, h3 + 600],
    ])
  })
  it('no heal of its own: no stacks; +75% for 5 s after a party Frozen', () => {
    const r = play('Klee E -> Bennett E W6', 'HymnOfTheMaelstrom', {
      Bennett: {
        skill: [
          [0, heal(['Klee', 'Bennett'])],
          [5, mark('frozen')],
        ],
      },
    })
    const [frozen] = r.times('_reaction.frozen')
    expect(r.on('stacks')).toEqual([])
    expect(r.on('frozenSwirl')).toEqual([['on', frozen, frozen + 300]])
  })
})

describe('Reliquary of Truth', () => {
  it('Secret of Lies 12 s after the Skill; Moon of Truth 4 s after Lunar-Bloom DMG', () => {
    const r = play('Klee E W2 CA N1 W8', 'ReliquaryOfTruth', {
      Klee: {
        charged: [[10, dmg('charged', 'CA (Lunar-Bloom)')]],
        normal: [[10, dmg('normal')]],
      },
    })
    const lb = r.sim.hits.find((h) => h.label === 'CA (Lunar-Bloom)')!.t
    expect(r.declared('afterSkill')).toBe(true)
    expect(r.on('afterSkill')).toEqual([['on', 0, 720]])
    // (from the frame after the hit, not from the Normal Attack's)
    const start = r.sim.actions[0].start
    expect(r.on('afterLunarBloom')).toEqual([
      ['on', lb - start + 1, lb - start + 241],
    ])
  })
  it('Moon of Truth’s shown duration is 4 s', () => {
    const doc = getWeaponSheet('ReliquaryOfTruth').document as unknown as {
      path?: string[]
      states?: Record<string, { fields: { value?: number }[] }>
    }[]
    const moon = doc.find((s) => s.path?.at(-1) === 'afterLunarBloom')!
    expect(moon.states!['on'].fields[1].value).toBe(4)
  })
})

describe('Sunny Morning Sleep-In', () => {
  it('EM after the wielder’s Swirl (6 s), Skill hits (9 s) and Burst hits (30 s) on the field', () => {
    const r = play('Klee J E Q W31', 'SunnyMorningSleepIn', {
      Klee: {
        jump: [[5, mark('pyroSwirl')]],
        skill: [[10, dmg('skill')]],
        burst: [[10, dmg('burst')]],
      },
    })
    const [swirl] = r.times('_reaction.pyroSwirl')
    const [skill] = r.times('skill.dmg')
    const [burst] = r.times('burst.dmg')
    expect(r.on('swirl')).toEqual([['on', swirl, swirl + 360]])
    expect(r.on('afterSkill')).toEqual([['on', skill + 1, skill + 541]])
    expect(r.on('afterBurst')).toEqual([['on', burst + 1, burst + 1801]])
  })
  it('not from a Swirl that lands after the wielder left the field', () => {
    const r = play('Klee J -> Bennett W5', 'SunnyMorningSleepIn', {
      Klee: { jump: [[200, mark('cryoSwirl')]] },
    })
    expect(r.sim.hits.find((h) => h.path[1] === 'cryoSwirl')?.onField).toBe(
      'Bennett'
    )
    expect(r.declared('swirl')).toBe(true)
    expect(r.on('swirl')).toEqual([])
  })
  it('lists none of its conditionals as team buffs (they are the wielder’s own)', () => {
    for (const weapon of ['SunnyMorningSleepIn', 'TheWidsith'] as const)
      expect(
        (getWeaponSheet(weapon).document as { teamBuff?: boolean }[]).some(
          (s) => s.teamBuff
        )
      ).toBe(false)
  })
})

describe('Vivid Notions', () => {
  const plunge: [number, HitInput][] = [
    [5, { ...dmg('plunge', 'Collision'), applies: false, durability: 0 }],
    [20, { ...dmg('plunge', 'Impact'), applies: true }],
  ]
  it('Twilight from the Skill and Dawn from the plunge, used up 0.1 s after its impact', () => {
    const r = play('Klee E W1 P W1 P W1', 'VividNotions', {
      Klee: { plunge },
    })
    const impacts = r.sim.hits
      .filter((h) => h.label === 'Impact')
      .map((h) => h.t - r.sim.actions[0].start)
    const plunges = r.sim.actions
      .filter((a) => a.text === 'P')
      .map((a) => a.start - r.sim.actions[0].start)
    expect(r.declared('twilight')).toBe(true)
    // (the second plunge gets Dawn only: no Skill or Burst since the first impact)
    expect(r.on('twilight')).toEqual([['on', 0, impacts[0] + 6]])
    expect(r.on('dawn')).toEqual([
      ['on', plunges[0], impacts[0] + 6],
      ['on', plunges[1], impacts[1] + 6],
    ])
  })
  it('Twilight lasts 15 s without a plunge', () => {
    const r = play('Klee Q W16 P', 'VividNotions', { Klee: { plunge } })
    expect(r.on('twilight')).toEqual([['on', 0, 900]])
  })
})

describe('Echoes of the Heart', () => {
  it('EM 12 s after the wielder’s reactions (off the field too), not a teammate’s', () => {
    const r = play('Klee D W1 D -> Bennett D W13', 'EchoesOfTheHeart', {
      Klee: { dash: [[5, mark('melt')]] },
      Bennett: { dash: [[5, mark('vaporize')]] },
    })
    const [m0, m1] = r.times('_reaction.melt')
    expect(r.declared('react')).toBe(true)
    expect(r.on('react')).toEqual([['on', m0 + 1, m1 + 721]])
    expect(r.on('stellar')).toEqual([])
  })
  it('a reaction’s own damage (Burning’s ticks) is no new reaction; Stellar Glimmer DMG after Stellar Conduct', () => {
    const burning: HitInput = {
      path: ['reaction', 'burning'],
      tag: 'other',
      element: 'pyro',
      label: 'Burning',
    }
    const r = play('Klee D W1 J W13', 'EchoesOfTheHeart', {
      Klee: {
        dash: [[5, burning]],
        jump: [[5, mark('stellarConduct')]],
      },
    })
    const [sc] = r.times('_reaction.stellarConduct')
    expect(r.on('react')).toEqual([['on', sc + 1, sc + 721]])
    expect(r.on('stellar')).toEqual([['on', sc + 1, sc + 721]])
  })
})

describe('Flowing Purity', () => {
  it('the Skill: 15 s, once per 10 s; the Bond cleared by a heal: 15 s more', () => {
    const r = play('Klee E W1 E -> Bennett E W16', 'FlowingPurity', {
      Bennett: { skill: [[0, heal(['Klee', 'Bennett'])]] },
    })
    const [h] = r.times('_heal.skill.heal')
    expect(r.declared('afterSkill')).toBe(true)
    expect(r.on('afterSkill')).toEqual([['on', 0, 900]])
    expect(r.on('bond')).toEqual([['on', h, h + 900]])
    // (its Bond of Life changes: given by the Skill, cleared by the heal)
    expect(r.times('_marker.bondOfLife')).toEqual([0, h])
  })
  it('no healer: the Bond is never cleared', () => {
    const r = play('Klee E W16', 'FlowingPurity', {})
    expect(r.declared('bond')).toBe(true)
    expect(r.on('bond')).toEqual([])
  })
})

describe('Mappa Mare', () => {
  it('a stack per reaction of the wielder’s on the field, up to 2, 10 s from the last', () => {
    const r = play('Klee D D D W11', 'MappaMare', {
      Klee: { dash: [[5, mark('overloaded')]] },
    })
    const [a, b, c] = r.times('_reaction.overloaded')
    expect(r.declared('InfusionScroll')).toBe(true)
    expect(r.on('InfusionScroll')).toEqual([
      ['1', a + 1, b + 1],
      ['2', b + 1, c + 1],
      ['2', c + 1, c + 601],
    ])
  })
  it('none from a reaction off the field', () => {
    const r = play('Klee D -> Bennett W5', 'MappaMare', {
      Klee: { dash: [[200, mark('overloaded')]] },
    })
    expect(r.on('InfusionScroll')).toEqual([])
  })
})
