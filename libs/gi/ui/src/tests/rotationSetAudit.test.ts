/**
 * The artifact set audit (2026-11-15), against gcsim: who triggers each set, on or off the field,
 * for how long, and that the simulation declares them off where nothing triggered them (so no
 * rule or saved switch keeps them on for the whole rotation).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type SimulationResult,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimGear, SimHit } from '../util/teamOpt/rotation/types'

type Mark = {
  t: number
  /** A real hit of this tag, or a reaction marker */
  tag?: SimHit['tag']
  reaction?: string
  element?: string
  /** A team buff this kit puts on (e.g. the Superconduct shred) */
  team?: [string, number]
  /** A hit's own path (default `[tag, 'dmg']`) */
  path?: string[]
}
/** A kit whose Skill lands `marks`; each action 60 frames (Burst: its own marks too) */
const kit = (
  characterKey: CharacterKey,
  marks: Mark[],
  burst: Mark[] = []
): KitModel => ({
  characterKey,
  element: 'pyro',
  source: 'test',
  act(ctx, _state, action) {
    const list =
      action.kind === 'skill' ? marks : action.kind === 'burst' ? burst : []
    for (const m of list) {
      if (m.team) {
        const [name, frames] = m.team
        ctx.at(m.t, (c) => c.buff('team', ['reaction', name], 'on', 0, frames))
        continue
      }
      ctx.hit(
        m.t,
        m.reaction
          ? {
              path: ['_reaction', m.reaction],
              tag: 'other',
              element: (m.element ?? 'pyro') as never,
              label: m.reaction,
            }
          : {
              path: m.path ?? [m.tag ?? 'skill', 'dmg'],
              tag: m.tag ?? 'skill',
              element: (m.element ?? 'pyro') as never,
              label: 'hit',
            }
      )
    }
    return { frames: 60 }
  },
})
const play = (
  members: [CharacterKey, CharacterKey],
  text: string,
  marks: [Mark[], Mark[]],
  gear: SimGear,
  burst: [Mark[], Mark[]] = [[], []]
) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { [members[0]]: 'pyro', [members[1]]: 'electro' } as never,
    repeats: 1,
    kits: {
      [members[0]]: kit(members[0], marks[0], burst[0]),
      [members[1]]: kit(members[1], marks[1], burst[1]),
    },
    reactions: { onHit() {} },
    gear: { [members[0]]: gear },
  })
  const start = sim.actions[0].start
  return { sim, start }
}
/** A buff's windows (start, length) from the first action; and whether it is declared */
const windowsOf = (sim: SimulationResult, start: number, path: string) => {
  const all = sim.buffWindows.filter((w) => w.path.join('.') === path)
  return {
    declared: all.some((w) => w.end === w.start),
    on: all
      .filter((w) => w.end > w.start)
      .map((w) => [w.start - start, w.end - w.start, w.value]),
  }
}
/** A buff's state on each hit of a tag (its time from the first action) */
const statesOf = (
  sim: SimulationResult,
  start: number,
  path: string,
  tag: SimHit['tag']
) =>
  sim.hits
    .filter((h) => h.tag === tag)
    .map((h) => [
      h.t - start,
      h.states?.find((s) => s.path.join('.') === path)?.value,
    ])

const sets = (set: string): SimGear => ({ sets: { [set]: 4 } })

describe('Shimenawa’s Reminiscence', () => {
  const path = 'ShimenawasReminiscence.usedEnergy'
  it('10 s after the wearer’s Skill on the field, not again while it lasts', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'HuTao E E',
      [[], []],
      sets('ShimenawasReminiscence')
    )
    expect(windowsOf(sim, start, path)).toEqual({
      declared: true,
      on: [[0, 600, 'used']],
    })
  })
  it('none from a Skill used off the field; declared off', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'Bennett E',
      [[], []],
      sets('ShimenawasReminiscence')
    )
    expect(windowsOf(sim, start, path)).toEqual({ declared: true, on: [] })
  })
})

describe('Gilded Dreams', () => {
  const path = 'GildedDreams.passive'
  it('8 s from the wearer’s own reaction, off the field too, once per 8 s', () => {
    // (the wearer leaves at 60 frames: its reactions at 100 and 300 come off the field)
    const { sim, start } = play(
      ['Nahida', 'Bennett'],
      'Nahida E -> Bennett E N1 N1 N1 N1 N1 N1 N1 N1 N1',
      [
        [
          { t: 100, reaction: 'spread' },
          { t: 300, reaction: 'bloom' },
          { t: 600, reaction: 'spread' },
        ],
        [],
      ],
      sets('GildedDreams')
    )
    expect(windowsOf(sim, start, path).on.map(([s, l]) => [s, l])).toEqual([
      [100, 480],
      [600, 480],
    ])
  })
  it('not from a teammate’s reaction; declared off', () => {
    const { sim, start } = play(
      ['Nahida', 'Bennett'],
      'Nahida E -> Bennett E',
      [[], [{ t: 10, reaction: 'vaporize' }]],
      sets('GildedDreams')
    )
    expect(windowsOf(sim, start, path)).toEqual({ declared: true, on: [] })
  })
})

describe('Disenchantment in Deep Shadow', () => {
  it('its CRIT Rate on the wearer’s hits while the enemy is under Superconduct', () => {
    const { sim, start } = play(
      ['Mitya', 'Bennett'],
      'Bennett E -> Mitya E W16',
      [
        [
          { t: 0, tag: 'skill' },
          { t: 900, tag: 'skill' },
        ],
        [{ t: 0, team: ['superconduct', 720] }],
      ],
      sets('DisenchantmentInDeepShadow')
    )
    const states = statesOf(
      sim,
      start,
      'DisenchantmentInDeepShadow.state',
      'skill'
    ).map(([, v]) => v)
    // (Mitya's first hit lands within the 12 s shred, the one 15 s later after it)
    expect(states).toEqual(['on', ''])
  })
})

describe('Finale of the Deep Galleries', () => {
  const normal = 'FinaleOfTheDeepGalleries.0EnergyNoBurst'
  const burst = 'FinaleOfTheDeepGalleries.0EnergyNoNormal'
  it('at 0 Energy: Normal Attack DMG unless Burst DMG in the last 6 s, and the other way', () => {
    const { sim, start } = play(
      ['Skirk', 'Bennett'],
      'Skirk E Q E',
      [
        [
          { t: 0, tag: 'normal' },
          { t: 30, tag: 'normal' },
        ],
        [],
      ],
      sets('FinaleOfTheDeepGalleries'),
      [[{ t: 0, tag: 'burst' }], []]
    )
    // Normal hits at 0 and 30 (no Burst before), at 120 and 150 (a Burst at 60: blocked)
    expect(statesOf(sim, start, normal, 'normal').map(([, v]) => v)).toEqual([
      'on',
      'on',
      '',
      '',
    ])
    // the Burst at 60, 30 frames after a Normal Attack: blocked
    expect(statesOf(sim, start, burst, 'burst').map(([, v]) => v)).toEqual([''])
  })
  it('never for a character with Energy', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'HuTao E',
      [[{ t: 0, tag: 'normal' }], []],
      sets('FinaleOfTheDeepGalleries')
    )
    expect(statesOf(sim, start, normal, 'normal').map(([, v]) => v)).toEqual([
      '',
    ])
  })
})

describe('A Day Carved From Rising Winds', () => {
  const path = 'ADayCarvedFromRisingWinds.set4'
  it('6 s from the wearer’s Normal, Charged, Skill or Burst hit, after its damage', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'HuTao E',
      [[{ t: 10, tag: 'normal' }], []],
      sets('ADayCarvedFromRisingWinds')
    )
    expect(windowsOf(sim, start, path).on).toEqual([[11, 360, 'on']])
  })
  it('not from a plunge; declared off', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'HuTao E',
      [[{ t: 10, tag: 'plunge' }], []],
      sets('ADayCarvedFromRisingWinds')
    )
    expect(windowsOf(sim, start, path)).toEqual({ declared: true, on: [] })
  })
})

describe('Crimson Witch of Flames', () => {
  it('a stack per Skill, all of them 10 s from the last', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'HuTao E N1 N1 N1 N1 E',
      [[], []],
      sets('CrimsonWitchOfFlames')
    )
    const on = windowsOf(sim, start, 'CrimsonWitchOfFlames.stack').on
    const second = sim.actions.filter((a) => a.characterKey === 'HuTao')[5]
    expect(on).toEqual([
      [0, second.start - start, '1'],
      [second.start - start, 600, '2'],
    ])
  })
})

describe('Deepwood Memories', () => {
  const path = 'DeepwoodMemories.set4'
  it('from the wearer’s Skill or Burst hits of any element, not its Dendro normal hits', () => {
    const skill = play(
      ['Nahida', 'Bennett'],
      'Nahida E',
      [[{ t: 5, tag: 'skill', element: 'electro' }], []],
      sets('DeepwoodMemories')
    )
    expect(windowsOf(skill.sim, skill.start, path).on).toEqual([[5, 480, 'on']])
    const normal = play(
      ['Nahida', 'Bennett'],
      'Nahida E',
      [[{ t: 5, tag: 'normal', element: 'dendro' }], []],
      sets('DeepwoodMemories')
    )
    expect(windowsOf(normal.sim, normal.start, path)).toEqual({
      declared: true,
      on: [],
    })
  })
})

describe('Instructor and Gilded Dreams: Hyperbloom and Burgeon count as reactions', () => {
  const hyper: Mark = { t: 5, tag: 'other', path: ['reaction', 'hyperbloom'] }
  it('a Hyperbloom the wearer triggers on the field', () => {
    const instructor = play(
      ['Fischl', 'Bennett'],
      'Fischl E',
      [[hyper], []],
      sets('Instructor')
    )
    expect(
      windowsOf(instructor.sim, instructor.start, 'Instructor.set4').on
    ).toEqual([[5, 480, 'on']])
    const gilded = play(
      ['Fischl', 'Bennett'],
      'Fischl E',
      [[hyper], []],
      sets('GildedDreams')
    )
    expect(
      windowsOf(gilded.sim, gilded.start, 'GildedDreams.passive').on
    ).toEqual([[5, 480, 'on']])
  })
})

describe('Scroll of the Hero of Cinder City', () => {
  const on = (sim: SimulationResult) =>
    [
      ...new Set(
        sim.buffWindows
          .filter(
            (w) =>
              w.path[0] === 'ScrollOfTheHeroOfCinderCity' && w.end > w.start
          )
          .map((w) => w.path[1])
      ),
    ].sort()
  it('a Spread the Dendro wearer triggers: Dendro only (gcsim)', () => {
    const { sim } = play(
      ['Nahida', 'Fischl'],
      'Nahida E',
      [[{ t: 5, reaction: 'spread', element: 'dendro' }], []],
      sets('ScrollOfTheHeroOfCinderCity')
    )
    expect(on(sim)).toEqual(['react_dendro'])
  })
  it('a Hyperbloom the Electro wearer triggers: Dendro and Electro', () => {
    const { sim } = play(
      ['Fischl', 'Nahida'],
      'Fischl E',
      [[{ t: 5, tag: 'other', path: ['reaction', 'hyperbloom'] }], []],
      sets('ScrollOfTheHeroOfCinderCity')
    )
    expect(on(sim)).toEqual(['react_dendro', 'react_electro'])
  })
})

describe('Nymph’s Dream', () => {
  it('a status per kind of the wearer’s on-field hits (8 s), each refreshed by its own kind', () => {
    const { sim, start } = play(
      ['KamisatoAyato', 'Bennett'],
      'KamisatoAyato E W10',
      [
        [
          { t: 10, tag: 'normal' },
          { t: 20, tag: 'charged' },
          { t: 400, tag: 'normal' },
        ],
        [],
      ],
      sets('NymphsDream')
    )
    expect(windowsOf(sim, start, 'NymphsDream.set4').on).toEqual([
      [11, 10, '1'],
      [21, 480, '2'],
      [501, 380, '1'],
    ])
  })
})

describe('Long Night’s Oath', () => {
  it('Plunging hits on the field: a 6 s stack each, once per second per kind', () => {
    const { sim, start } = play(
      ['Xiao', 'Bennett'],
      'Xiao E W10',
      [
        [
          { t: 0, tag: 'plunge' },
          { t: 30, tag: 'plunge' },
          { t: 70, tag: 'plunge' },
        ],
        [],
      ],
      sets('LongNightsOath')
    )
    expect(windowsOf(sim, start, 'LongNightsOath.stacks').on).toEqual([
      [1, 70, '1'],
      [71, 290, '2'],
      [361, 70, '1'],
    ])
  })
})

describe('Martial Artist', () => {
  it('8 s after the wearer’s Skill; declared off', () => {
    const { sim, start } = play(
      ['HuTao', 'Bennett'],
      'HuTao E',
      [[], []],
      sets('MartialArtist')
    )
    expect(windowsOf(sim, start, 'MartialArtist.state')).toEqual({
      declared: true,
      on: [[0, 480, 'on']],
    })
  })
})

describe('Lavawalker and Thundersoother: from the enemy’s aura at each hit', () => {
  it('the wearer’s hit on a Pyro-affected enemy, and not once the aura is gone', () => {
    const pyro = (characterKey: CharacterKey, marks: number[]): KitModel => ({
      characterKey,
      element: 'pyro',
      source: 'test',
      act(ctx, _state, action) {
        if (action.kind === 'skill')
          for (const t of marks)
            ctx.hit(t, {
              path: ['skill', 'dmg'],
              tag: 'skill',
              element: 'pyro',
              applies: true,
              durability: 25,
              label: 'hit',
            })
        return { frames: 60 }
      },
    })
    const physical = (
      characterKey: CharacterKey,
      marks: number[]
    ): KitModel => ({
      characterKey,
      element: 'electro',
      source: 'test',
      act(ctx, _state, action) {
        if (action.kind === 'skill')
          for (const t of marks)
            ctx.hit(t, {
              path: ['skill', 'dmg'],
              tag: 'skill',
              element: 'physical',
              label: 'hit',
            })
        return { frames: 60 }
      },
    })
    const sim = simulateRotation({
      rotation: parseRotation('Bennett E -> Razor E W20', [
        { characterKey: 'Bennett', name: 'Bennett' },
        { characterKey: 'Razor', name: 'Razor' },
      ]),
      members: ['Bennett', 'Razor'],
      constellations: {},
      elements: { Bennett: 'pyro', Razor: 'electro' },
      repeats: 1,
      kits: {
        Bennett: pyro('Bennett', [0]),
        Razor: physical('Razor', [0, 1100]),
      },
      gear: { Razor: { sets: { Lavawalker: 4 } } },
    })
    const states = sim.hits
      .filter((h) => h.characterKey === 'Razor')
      .map((h) => h.states?.find((x) => x.path[0] === 'Lavawalker')?.value)
    expect(states).toEqual(['on', ''])
  })
})

describe('rules, for attacks entered without a rotation', () => {
  const rule = (
    set: string,
    ctx: Parameters<typeof itemConditionals>[0]
  ): Record<string, string> | undefined =>
    itemConditionals(ctx, { sets: [set as never], weapons: [] }).conditional?.[
      set
    ]
  const base = { attacks: [] as never[], auras: ['pyro', 'electro'] }
  it('Shimenawa: only with a Skill', () => {
    expect(
      rule('ShimenawasReminiscence', { ...base, attacks: ['skill'] as never })
    ).toEqual({ usedEnergy: 'used' })
    expect(
      rule('ShimenawasReminiscence', { ...base, attacks: ['normal'] as never })
    ).toBeUndefined()
  })
  it('Gilded Dreams: with another element to react with', () => {
    expect(rule('GildedDreams', { ...base, otherElements: 2 })?.passive).toBe(
      'on'
    )
    expect(
      rule('GildedDreams', { ...base, otherElements: 0 })?.passive
    ).toBeUndefined()
  })
  it('Disenchantment: needs Cryo and Electro in the team', () => {
    expect(
      rule('DisenchantmentInDeepShadow', {
        ...base,
        auras: ['cryo', 'electro'],
      })
    ).toEqual({ state: 'on' })
    expect(rule('DisenchantmentInDeepShadow', base)).toBeUndefined()
  })
  it('Finale: only without Energy', () => {
    expect(
      rule('FinaleOfTheDeepGalleries', {
        ...base,
        attacks: ['normal'] as never,
        zeroEnergy: true,
      })
    ).toEqual({ '0EnergyNoBurst': 'on' })
    expect(
      rule('FinaleOfTheDeepGalleries', {
        ...base,
        attacks: ['normal'] as never,
        zeroEnergy: false,
      })
    ).toBeUndefined()
  })
  it('Nymph’s Dream: its attack kinds; Aubade: an off-field member; the unmodelled ones off', () => {
    expect(
      rule('NymphsDream', { ...base, attacks: ['normal', 'charged'] as never })
    ).toEqual({ set4: '2' })
    expect(rule('NymphsDream', base)).toBeUndefined()
    expect(
      rule('AubadeOfMorningstarAndMoon', {
        ...base,
        attacks: ['skill'] as never,
      })
    ).toEqual({ set4: 'on' })
    expect(
      rule('AubadeOfMorningstarAndMoon', {
        ...base,
        attacks: ['normal'] as never,
      })
    ).toBeUndefined()
    for (const set of ['Berserker', 'BraveHeart', 'TinyMiracle'])
      expect(
        rule(set, { ...base, attacks: ['normal'] as never })
      ).toBeUndefined()
  })
  it('A Day Carved: needs its own hits; Crimson Witch: about one stack', () => {
    expect(rule('ADayCarvedFromRisingWinds', base)).toBeUndefined()
    expect(
      rule('ADayCarvedFromRisingWinds', {
        ...base,
        attacks: ['skill'] as never,
      })
    ).toBeDefined()
    expect(
      rule('CrimsonWitchOfFlames', { ...base, attacks: ['skill'] as never })
    ).toEqual({ stack: '1' })
  })
})
