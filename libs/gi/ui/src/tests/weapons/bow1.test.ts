/**
 * Weapon audit batch bow1 (rotation/weapons/bow1.ts): the rotation simulation gives Amos' Bow its
 * stacks per arrow, times Golden Frostbound Oath, Silvershower Heartstrings, Thundering Pulse,
 * Hamayumi and Mitternachts Waltz from the wielder's own triggers, sets Chain Breaker's count from
 * the party, and plays End of the Line's Flowrider hits, with small test kits (and Fischl's kit).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitTag,
  KitModel,
  SimContext,
  SimHit,
} from '../../util/teamOpt/rotation/types'

type Play = {
  at: number
  tag?: HitTag
  path?: string[]
  travel?: number
  healTargets?: CharacterKey[]
}
type Plays = Partial<Record<'normal' | 'charged' | 'skill' | 'burst', Play[]>>

/** A test kit: each action is 60 frames, and lands `plays` of its kind (by default one hit 10 in) */
function bow(
  plays: Plays = {},
  characterKey: CharacterKey = 'Fischl'
): KitModel {
  return {
    characterKey,
    element: 'electro',
    source: 'test',
    act(c, _s, action) {
      const kind = action.kind as keyof Plays
      const list = plays[kind] ?? [{ at: 10 }]
      for (const { at, tag = kind, path = [kind, 'dmg'], ...rest } of list)
        c.hit(at, {
          path,
          tag: tag as HitTag,
          element: 'electro',
          label: action.text,
          ...rest,
        } as Parameters<SimContext['hit']>[1])
      return { frames: 60 }
    },
  }
}
const idle = (characterKey: CharacterKey): KitModel => ({
  characterKey,
  element: 'pyro',
  source: 'test',
  act: () => ({ frames: 60 }),
})

function play(
  text: string,
  weapon: string,
  {
    kit = bow(),
    members = ['Fischl', 'Bennett'],
    refinement = 1,
  }: { kit?: KitModel; members?: CharacterKey[]; refinement?: number } = {}
) {
  const wielder = kit.characterKey
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    kits: Object.fromEntries(
      members.map((m) => [m, m === wielder ? kit : idle(m)])
    ) as Partial<Record<CharacterKey, KitModel>>,
    gear: { [wielder]: { weapon, refinement } } as Partial<
      Record<CharacterKey, { weapon: string; refinement: number }>
    >,
    repeats: 1,
    keep: 'all',
  })
}

/**
 * The wielder's windows of a conditional while on, in order (without the declaration at 0 and the
 * off state's '' windows)
 */
const windowsOf = (sim: SimulationResult, path: string, who = 'Fischl') =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === who &&
        w.path.join('.') === path &&
        w.end > w.start &&
        w.value !== ''
    )
    .map(({ value, start, end }) => ({ value, start, end }))
    .sort((a, b) => a.start - b.start)
/** Whether a conditional is on at frame `t` (any of its windows) */
const onAt = (sim: SimulationResult, path: string, t: number) =>
  windowsOf(sim, path).some((w) => w.start <= t && t < w.end)
const starts = (sim: SimulationResult, text: string, who = 'Fischl') =>
  sim.actions
    .filter((a) => a.characterKey === who && a.text === text)
    .map((a) => a.start)
const hitTimes = (sim: SimulationResult, tag: HitTag, who = 'Fischl') =>
  sim.hits
    .filter((h) => h.characterKey === who && h.tag === tag)
    .map((h) => h.t)

describe("Amos' Bow", () => {
  const amos = (h: SimHit) =>
    h.states?.find((s) => s.path.join('.') === 'AmosBow.StrongWilled')?.value
  it('gives each Normal and Charged hit a stack per 0.1 s of its travel, up to 5', () => {
    const sim = play('Fischl N1 CA E', 'AmosBow', {
      kit: bow({
        charged: [
          { at: 10, travel: 28 },
          { at: 12, travel: 3 },
          { at: 14, travel: 60 },
          { at: 16 },
        ],
      }),
    })
    const own = sim.hits.filter(
      (h) => h.characterKey === 'Fischl' && !h.path[0].startsWith('_')
    )
    // (no travel given: gcsim's default 10 frames, 1 stack)
    expect(own.filter((h) => h.tag === 'normal').map(amos)).toEqual(['1'])
    expect(own.filter((h) => h.tag === 'charged').map(amos)).toEqual([
      '4',
      '',
      '5',
      '1',
    ])
    expect(own.filter((h) => h.tag === 'skill').map(amos)).toEqual([undefined])
    // (declared: no window opens it, whatever the rule or a saved state says)
    expect(windowsOf(sim, 'AmosBow.StrongWilled')).toEqual([])
  })
})

describe('Golden Frostbound Oath', () => {
  it('opens Frost Fae’s Favor for 6 s after the wielder’s Skill or Lunar-Crystallize hits', () => {
    const sim = play('Fischl E W1 N1 W10', 'GoldenFrostboundOath', {
      kit: bow({ normal: [{ at: 10, tag: 'directLunarCrystallize' }] }),
    })
    const [skill] = hitTimes(sim, 'skill')
    const [lc] = hitTimes(sim, 'directLunarCrystallize')
    const path = 'GoldenFrostboundOath.skillOrLc'
    expect(onAt(sim, path, skill)).toBe(false)
    expect(onAt(sim, path, skill + 1)).toBe(true)
    expect(lc).toBeLessThan(skill + 361)
    expect(onAt(sim, path, lc + 360)).toBe(true)
    expect(onAt(sim, path, lc + 361)).toBe(false)
    // (no Moondrift in this run: Frost Fae's Mischief stays off)
    expect(windowsOf(sim, 'GoldenFrostboundOath.moondrift')).toEqual([])
  })
  it('is not opened by other attacks', () => {
    const sim = play('Fischl N1 CA Q W10', 'GoldenFrostboundOath')
    expect(windowsOf(sim, 'GoldenFrostboundOath.skillOrLc')).toEqual([])
  })
})

describe('Silvershower Heartstrings', () => {
  it('counts its Skill (25 s), heal (20 s) and Bond of Life (25 s) stacks separately', () => {
    const sim = play('Fischl E W9 N1 W4 CA W40', 'SilvershowerHeartstrings', {
      kit: bow({
        normal: [
          {
            at: 0,
            tag: 'other',
            path: ['_heal', 'normal', 'heal'],
            healTargets: ['Bennett'],
          },
        ],
        charged: [{ at: 0, tag: 'other', path: ['_marker', 'bondOfLife'] }],
      }),
    })
    const [e] = starts(sim, 'E')
    const [heal] = starts(sim, 'N1')
    const [bond] = starts(sim, 'CA')
    expect(windowsOf(sim, 'SilvershowerHeartstrings.blessingStacks')).toEqual([
      { value: '1', start: e, end: heal },
      { value: '2', start: heal, end: bond },
      { value: '3', start: bond, end: e + 1500 },
      { value: '2', start: e + 1500, end: heal + 1200 },
      { value: '1', start: heal + 1200, end: bond + 1500 },
    ])
  })
  it('restarts a source’s stack instead of adding one', () => {
    const sim = play('Fischl E W5 E W30', 'SilvershowerHeartstrings')
    const [e1, e2] = starts(sim, 'E')
    expect(windowsOf(sim, 'SilvershowerHeartstrings.blessingStacks')).toEqual([
      { value: '1', start: e1, end: e2 + 1500 },
    ])
  })
})

describe('Thundering Pulse', () => {
  it('counts its Normal (5 s), Skill (10 s) and Energy (after the first Burst) stacks', () => {
    const sim = play('Fischl E N1 W3 Q N1 W20', 'ThunderingPulse')
    const [e] = starts(sim, 'E')
    const [q] = starts(sim, 'Q')
    const [n1, n2] = hitTimes(sim, 'normal')
    const w = windowsOf(sim, 'ThunderingPulse.RuleByThunder')
    expect(n2 + 1).toBeLessThanOrEqual(n1 + 301)
    expect(w.slice(0, 4)).toEqual([
      { value: '1', start: e, end: n1 + 1 },
      { value: '2', start: n1 + 1, end: q },
      { value: '3', start: q, end: e + 600 },
      { value: '2', start: e + 600, end: n2 + 301 },
    ])
    expect(w[4]).toMatchObject({ value: '1', start: n2 + 301 })
  })
})

describe('Chain Breaker', () => {
  const count = (members: CharacterKey[]) => {
    const kit = bow({}, members[0])
    return windowsOf(
      play(`${members[0]} N1 W2`, 'ChainBreaker', { kit, members }),
      'ChainBreaker.natlanOrNonEle',
      members[0]
    ).map((w) => [w.start, w.value])
  }
  it('counts each member of another element, and Natlan members (the wielder too)', () => {
    // Chasca (Anemo, Natlan) with Bennett, Xiangling (Pyro) and Furina (Hydro): 4
    expect(count(['Chasca', 'Bennett', 'Xiangling', 'Furina'])).toEqual([
      [0, '4'],
    ])
    // two Pyro members count twice: 3
    expect(count(['Fischl', 'Xiangling', 'Bennett', 'Xingqiu'])).toEqual([
      [0, '3'],
    ])
    // the same element, not from Natlan: none
    expect(count(['Fischl', 'RaidenShogun'])).toEqual([])
  })
})

describe('End of the Line', () => {
  const skill = bow({
    skill: [10, 70, 130, 190, 250, 310, 370].map((at) => ({ at })),
  })
  const procs = (sim: SimulationResult) =>
    sim.hits.filter((h) => h.path[0] === 'weapon:EndOfTheLine').map((h) => h.t)
  it('deals 3 hits per Flowrider, 2 s apart, and Flowrider again after 12 s', () => {
    const sim = play('Fischl E W20 E W5', 'EndOfTheLine', { kit: skill })
    const [e1, e2] = starts(sim, 'E')
    expect(procs(sim)).toEqual(
      [e1, e2].flatMap((e) => [e + 11, e + 131, e + 251])
    )
    const hit = sim.hits.find((h) => h.path[0] === 'weapon:EndOfTheLine')!
    expect(hit.path).toEqual(['weapon:EndOfTheLine', 'dmg'])
    expect(hit.element).toBe('physical')
  })
  it('gives no new Flowrider within 12 s, and no hits off the field', () => {
    expect(
      procs(play('Fischl E W5 E W2', 'EndOfTheLine', { kit: skill }))
    ).toHaveLength(3)
    const swapped = play('Fischl E -> Bennett W10', 'EndOfTheLine', {
      kit: skill,
    })
    expect(procs(swapped)).toEqual([11])
  })
  it('procs from Fischl’s own kit', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Fischl E N5 N5 N5', [
        { characterKey: 'Fischl', name: 'Fischl' },
      ]),
      members: ['Fischl'],
      constellations: {},
      elements: { Fischl: 'electro' },
      gear: { Fischl: { weapon: 'EndOfTheLine', refinement: 1 } },
      repeats: 1,
      keep: 'all',
    })
    const p = procs(sim)
    expect(p).toHaveLength(3)
    for (let i = 1; i < p.length; i++)
      expect(p[i] - p[i - 1]).toBeGreaterThanOrEqual(120)
    expect(procs(play('Fischl E N1', 'Slingshot', { kit: skill }))).toEqual([])
  })
})

describe('Hamayumi', () => {
  it('counts full Energy from the start until the wielder’s first Burst', () => {
    const sim = play('Fischl N1 W2 Q N1 W2', 'Hamayumi')
    const [q] = starts(sim, 'Q')
    expect(windowsOf(sim, 'Hamayumi.FullDraw')).toEqual([
      { value: 'on', start: 0, end: q },
    ])
  })
  it('stays full while the wielder never Bursts', () => {
    const sim = play('Fischl N1 W2 N1', 'Hamayumi')
    const w = windowsOf(sim, 'Hamayumi.FullDraw')
    expect(w).toHaveLength(1)
    expect(w[0].start).toBe(0)
    expect(w[0].end).toBeGreaterThan(Math.max(...hitTimes(sim, 'normal')))
  })
})

describe('Mitternachts Waltz', () => {
  const kit = bow({ skill: [{ at: 10 }, { at: 500 }] })
  it('gives Skill DMG for 5 s after a Normal hit, Normal DMG for 5 s after a Skill hit', () => {
    const sim = play('Fischl N1 E W10', 'MitternachtsWaltz', { kit })
    const [n] = hitTimes(sim, 'normal')
    const [s1, s2] = hitTimes(sim, 'skill')
    expect(windowsOf(sim, 'MitternachtsWaltz.EvernightDuetSkill')).toEqual([
      { value: 'on', start: n + 1, end: n + 301 },
    ])
    expect(windowsOf(sim, 'MitternachtsWaltz.EvernightDuetNormal')).toEqual([
      { value: 'on', start: s1 + 1, end: s1 + 301 },
      { value: 'on', start: s2 + 1, end: s2 + 301 },
    ])
  })
  it('is not triggered by hits while the wielder is off the field', () => {
    const sim = play('Fischl E -> Bennett W10', 'MitternachtsWaltz', { kit })
    const [s1] = hitTimes(sim, 'skill')
    expect(windowsOf(sim, 'MitternachtsWaltz.EvernightDuetNormal')).toEqual([
      { value: 'on', start: s1 + 1, end: s1 + 301 },
    ])
  })
})
