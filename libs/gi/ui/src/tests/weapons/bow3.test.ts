import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import { constant, type Data, type NumNode } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitTag,
  KitModel,
  SimHit,
} from '../../util/teamOpt/rotation/types'

type Event = Partial<SimHit> & { t: number; label: string }
const probe = (t: number): Event => ({
  t,
  label: `Probe ${t}`,
  tag: 'other',
  path: ['probe', String(t)],
})
const attack = (t: number, tag: HitTag = 'normal'): Event => ({
  t,
  tag,
  path: [tag, 'dmg'],
  label: `${tag} ${t}`,
})
const marker = (t: number, kind: string): Event => ({
  t,
  tag: 'other',
  path: ['_marker', kind],
  label: `${kind} ${t}`,
})
const swirl = (t: number, kind = 'pyroSwirl'): Event => ({
  t,
  tag: 'other',
  path: ['_reaction', kind],
  label: kind,
})

function play(
  weapon: string,
  events: Event[],
  options: {
    frames?: number
    refinement?: number
    candidate?: boolean
    teammate?: CharacterKey
    rotation?: string
  } = {}
) {
  const members: CharacterKey[] = [
    'Fischl',
    ...(options.teammate ? [options.teammate] : []),
  ]
  const kit: KitModel = {
    characterKey: 'Fischl',
    element: 'electro',
    source: 'bow3 test',
    act(ctx) {
      for (const { t, ...event } of events)
        ctx.hit(t, {
          path: ['normal', 'dmg'],
          tag: 'normal',
          element: 'physical',
          ...event,
        })
      return { frames: options.frames ?? 2400 }
    },
  }
  return simulateRotation({
    rotation: parseRotation(
      options.rotation ?? 'Fischl E',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: {
      Fischl: 'electro',
      ...(options.teammate ? { [options.teammate]: 'pyro' as const } : {}),
    },
    constellations: {},
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
    kits: {
      Fischl: kit,
      ...(options.teammate
        ? {
            [options.teammate]: {
              ...kit,
              characterKey: options.teammate,
              act: () => ({ frames: 1 }),
            },
          }
        : {}),
    },
    gear: {
      Fischl: options.candidate
        ? { weapon: 'Slingshot', candidates: { weapons: [weapon] } }
        : { weapon, refinement: options.refinement ?? 1 },
    },
  })
}
function state(
  sim: ReturnType<typeof play>,
  label: string,
  weapon: string,
  conditional: string
) {
  const a = rotationAttacks(sim, () => '__saved__').Fischl?.find(
    (a) => a.description === label
  )
  expect(a, label).toBeDefined()
  return (
    a?.states?.find(
      (s) =>
        s.owner === 'Fischl' && s.path.join('.') === `${weapon}.${conditional}`
    )?.value ?? ''
  )
}
function sheetValue(
  weapon: string,
  stat: string,
  conditional: Record<string, string>,
  refinement = 1,
  owner = 'Fischl',
  active = owner
) {
  const premod = (getWeaponSheet(weapon as never) as unknown as { data: Data })
    .data.premod as Record<string, NumNode>
  return computeUIData([
    {
      charKey: constant(owner),
      activeCharKey: constant(active),
      weapon: { refinement: constant(refinement) },
      conditional: {
        [weapon]: Object.fromEntries(
          Object.entries(conditional).map(([k, v]) => [k, constant(v)])
        ),
      },
    } as Data,
  ]).get(premod[stat]).value
}

describe('bow3 sheets', () => {
  it('uses exactly 52.5% ATK at Polar Star R4 with three stacks', () => {
    expect(
      sheetValue('PolarStar', 'atk_', { GoldenMajesty: '3' }, 4)
    ).toBeCloseTo(0.525)
    expect(sheetValue('PolarStar', 'atk_', { GoldenMajesty: '' }, 4)).toBe(0)
  })
  it('keeps Daybreak Normal, Skill and Burst bonuses independent at every refinement', () => {
    for (const [r, bonus] of [0, 0.1, 0.125, 0.15, 0.175, 0.2].entries()) {
      if (!r) continue
      const conditions = {
        normalStacks: '6',
        skillStacks: '2',
        burstStacks: '',
      }
      expect(
        sheetValue('TheDaybreakChronicles', 'normal_dmg_', conditions, r)
      ).toBeCloseTo(6 * bonus)
      expect(
        sheetValue('TheDaybreakChronicles', 'skill_dmg_', conditions, r)
      ).toBeCloseTo(2 * bonus)
      expect(
        sheetValue('TheDaybreakChronicles', 'burst_dmg_', conditions, r)
      ).toBe(0)
    }
    expect(
      sheetValue('TheDaybreakChronicles', 'normal_dmg_', { passive: '6' })
    ).toBe(0)
  })
  it('grants Predator ATK only to an Aloy owner, including off field', () => {
    const stacks = { PressTheAdvantage: '2' }
    expect(sheetValue('Predator', 'atk', stacks, 1, 'Aloy', 'Fischl')).toBe(66)
    expect(sheetValue('Predator', 'atk', stacks, 1, 'Fischl', 'Aloy')).toBe(0)
    for (const stat of ['normal_dmg_', 'charged_dmg_']) {
      expect(sheetValue('Predator', stat, stacks)).toBeCloseTo(0.2)
      expect(sheetValue('Predator', stat, {})).toBe(0)
    }
  })
})

describe('Astral Vulture’s Crimson Plumage', () => {
  it('opens on owned Swirl, refreshes on Stellar Swirl and expires on the owner hitlag clock', () => {
    const sim = play('AstralVulturesCrimsonPlumage', [
      probe(0),
      attack(10),
      swirl(10),
      probe(11),
      swirl(700, 'stellarSwirl'),
      { ...marker(1000, 'hitlag'), animationPause: 20 },
      probe(1439),
      probe(1440),
    ])
    const value = (label: string) =>
      state(sim, label, 'AstralVulturesCrimsonPlumage', 'passive')
    expect(value('Probe 0')).toBe('')
    expect(value('normal 10')).toBe('')
    expect(value('Probe 11')).toBe('on')
    expect(value('Probe 1439')).toBe('on')
    expect(value('Probe 1440')).toBe('')
  })
  it('does not open from an off-field reaction or another reaction type', () => {
    const sim = play(
      'AstralVulturesCrimsonPlumage',
      [swirl(0, 'melt'), swirl(100), probe(101)],
      { teammate: 'Amber', frames: 1, rotation: 'Fischl E -> Amber W15' }
    )
    expect(
      state(sim, 'Probe 101', 'AstralVulturesCrimsonPlumage', 'passive')
    ).toBe('')
  })
  it('opens only its own stat window for a candidate weapon', () => {
    const sim = play(
      'AstralVulturesCrimsonPlumage',
      [swirl(0), probe(1), probe(721)],
      { candidate: true }
    )
    expect(
      state(sim, 'Probe 1', 'AstralVulturesCrimsonPlumage', 'passive')
    ).toBe('on')
    expect(
      state(sim, 'Probe 721', 'AstralVulturesCrimsonPlumage', 'passive')
    ).toBe('')
  })
})

describe('Polar Star', () => {
  it('acquires four distinct categories, refreshes just one, and expires the others independently', () => {
    const sim = play('PolarStar', [
      attack(0),
      probe(1),
      attack(60, 'charged'),
      probe(61),
      attack(120, 'skill'),
      probe(121),
      attack(180, 'burst'),
      probe(181),
      attack(600),
      probe(721),
      probe(781),
      probe(841),
      probe(901),
      probe(1320),
    ])
    expect(
      [1, 61, 121, 181, 721, 781, 841, 901, 1320].map((t) =>
        state(sim, `Probe ${t}`, 'PolarStar', 'GoldenMajesty')
      )
    ).toEqual(['1', '2', '3', '4', '4', '3', '2', '1', ''])
    expect(state(sim, 'normal 0', 'PolarStar', 'GoldenMajesty')).toBe('')
    expect(state(sim, 'burst 180', 'PolarStar', 'GoldenMajesty')).toBe('3')
  })
  it('preserves stacks on swap but never acquires them from off-field damage or plunge', () => {
    const sim = play(
      'PolarStar',
      [
        attack(0),
        attack(100, 'skill'),
        attack(110, 'plunge'),
        probe(120),
        probe(721),
      ],
      { teammate: 'Amber', frames: 1, rotation: 'Fischl E -> Amber W15' }
    )
    expect(state(sim, 'Probe 120', 'PolarStar', 'GoldenMajesty')).toBe('1')
    expect(state(sim, 'Probe 721', 'PolarStar', 'GoldenMajesty')).toBe('')
  })
})

describe('The Daybreak Chronicles', () => {
  it('preloads six, decays independently, and respects the separate six-frame recovery cooldowns', () => {
    const sim = play('TheDaybreakChronicles', [
      probe(0),
      attack(121),
      attack(123),
      attack(127),
      attack(127, 'skill'),
      probe(128),
      probe(188),
      probe(488),
    ])
    const counts = (label: string) =>
      ['normal', 'skill', 'burst'].map((kind) =>
        state(sim, label, 'TheDaybreakChronicles', `${kind}Stacks`)
      )
    expect(counts('Probe 0')).toEqual(['6', '6', '6'])
    // (each hit counts its own recovery, as kqmsim's OnEnemyHit; the ICD blocks 123)
    expect(counts('normal 121')).toEqual(['5', '4', '4'])
    expect(counts('normal 123')).toEqual(['5', '4', '4'])
    expect(counts('normal 127')).toEqual(['6', '4', '4'])
    expect(counts('skill 127')).toEqual(['6', '5', '4'])
    expect(counts('Probe 128')).toEqual(['6', '5', '4'])
    expect(counts('Probe 188')).toEqual(['5', '4', '3'])
    expect(counts('Probe 488')).toEqual(['', '', ''])
  })
  it('Secret Rite recovers two of every type even off field, with an independent ICD for each triggering tag', () => {
    const sim = play(
      'TheDaybreakChronicles',
      [attack(361), attack(364), attack(364, 'skill'), probe(365), probe(665)],
      { teammate: 'Klee', frames: 1, rotation: 'Fischl E -> Klee W15' }
    )
    for (const kind of ['normal', 'skill', 'burst']) {
      expect(
        state(sim, 'normal 361', 'TheDaybreakChronicles', `${kind}Stacks`)
      ).toBe('2')
      expect(
        state(sim, 'Probe 365', 'TheDaybreakChronicles', `${kind}Stacks`)
      ).toBe('4')
      expect(
        state(sim, 'Probe 665', 'TheDaybreakChronicles', `${kind}Stacks`)
      ).toBe('')
    }
  })
  it('counts a leading wait as combat decay instead of postponing preload until the first attack', () => {
    const sim = play('TheDaybreakChronicles', [probe(0)], {
      rotation: 'Fischl W2 E',
    })
    expect(state(sim, 'Probe 0', 'TheDaybreakChronicles', 'normalStacks')).toBe(
      '4'
    )
    expect(sim.notes.some((n) => n.includes('3 s out of combat'))).toBe(true)
  })
})

describe('Blackcliff Warbow', () => {
  it('requires explicit credited deaths, cycles three slots, and expires each slot independently', () => {
    const sim = play('BlackcliffWarbow', [
      probe(0),
      attack(1),
      marker(10, 'targetDied'),
      probe(11),
      marker(100, 'targetDied'),
      probe(101),
      marker(200, 'targetDied'),
      probe(201),
      marker(400, 'targetDied'),
      probe(1811),
      probe(1900),
      probe(2000),
      probe(2200),
    ])
    expect(
      [0, 11, 101, 201, 1811, 1900, 2000, 2200].map((t) =>
        state(sim, `Probe ${t}`, 'BlackcliffWarbow', 'PressTheAdvantage')
      )
    ).toEqual(['', '1', '2', '3', '3', '2', '1', ''])
  })
  it('ignores off-field deaths and deaths credited to teammates', () => {
    const sim = play(
      'BlackcliffWarbow',
      [
        { ...marker(0, 'targetDied'), characterKey: 'Amber' },
        marker(100, 'targetDied'),
        probe(101),
      ],
      { teammate: 'Amber', frames: 1, rotation: 'Fischl E -> Amber W15' }
    )
    expect(
      state(sim, 'Probe 101', 'BlackcliffWarbow', 'PressTheAdvantage')
    ).toBe('')
  })
})

describe('Compound Bow', () => {
  it('ramps with an 18-frame gain ICD, refreshes all four stacks at cap and expires after hitlag', () => {
    const sim = play('CompoundBow', [
      attack(0),
      attack(10),
      attack(18),
      attack(36),
      attack(54),
      attack(100),
      { ...marker(200, 'hitlag'), animationPause: 20 },
      probe(479),
      probe(480),
      attack(481),
      probe(482),
    ])
    expect(
      [0, 10, 18, 36, 54, 100].map((t) =>
        state(sim, `normal ${t}`, 'CompoundBow', 'InfusionArrow')
      )
    ).toEqual(['', '1', '1', '2', '3', '4'])
    expect(
      [479, 480, 482].map((t) =>
        state(sim, `Probe ${t}`, 'CompoundBow', 'InfusionArrow')
      )
    ).toEqual(['4', '', '1'])
  })
  it('retains stacks on swap without refreshing them from off-field hits', () => {
    const sim = play(
      'CompoundBow',
      [attack(0), attack(100), probe(101), probe(360)],
      { teammate: 'Amber', frames: 1, rotation: 'Fischl E -> Amber W15' }
    )
    expect(state(sim, 'Probe 101', 'CompoundBow', 'InfusionArrow')).toBe('1')
    expect(state(sim, 'Probe 360', 'CompoundBow', 'InfusionArrow')).toBe('')
  })
  it('speeds up played Normals only when worn; a candidate keeps the original timeline', () => {
    const run = (weapon: string, candidate = false) =>
      simulateRotation({
        rotation: parseRotation('Fischl N5 N5 C N5', [
          { characterKey: 'Fischl', name: 'Fischl' },
        ]),
        members: ['Fischl'],
        elements: { Fischl: 'electro' },
        constellations: {},
        repeats: 1,
        gear: {
          Fischl: {
            weapon,
            refinement: 5,
            ...(candidate ? { candidates: { weapons: ['CompoundBow'] } } : {}),
          },
        },
      })
    const base = run('Slingshot'),
      worn = run('CompoundBow'),
      candidate = run('Slingshot', true)
    expect(worn.actions[1].frames).toBeLessThan(base.actions[1].frames)
    expect(worn.actions[2].frames).toBe(base.actions[2].frames)
    expect(candidate.actions).toEqual(base.actions)
    expect(
      candidate.buffWindows.some(
        (w) => w.path[0] === 'CompoundBow' && w.value === '4'
      )
    ).toBe(true)
  })
})

describe('bow3 damage procs', () => {
  it('Sequence of Solitude uses a 15-second owner-clock cooldown, triggers at +1 frame and snapshots at activation', () => {
    const sim = play(
      'SequenceOfSolitude',
      [
        attack(0),
        attack(10),
        { ...marker(500, 'hitlag'), animationPause: 10 },
        attack(900),
        attack(910),
      ],
      { frames: 1000 }
    )
    const procs = sim.hits.filter(
      (h) => h.path[0] === 'weapon:SequenceOfSolitude'
    )
    expect(procs.map((h) => h.t)).toEqual([1, 911])
    expect(procs.map((h) => h.snapshotT)).toEqual([0, 910])
    expect(
      procs.every(
        (h) =>
          h.tag === 'other' && h.element === 'physical' && h.applies === false
      )
    ).toBe(true)
  })
  it.each([
    1, 5,
  ])('Viridescent R%i uses chance credit and emits nine half-second ticks per activation', (r) => {
    const ready = 10 + 900 - 60 * r
    const sim = play(
      'TheViridescentHunt',
      [
        attack(0),
        attack(10),
        attack(100),
        attack(ready - 1),
        attack(ready),
        attack(ready + 10, 'charged'),
      ],
      { refinement: r }
    )
    const procs = sim.hits.filter(
      (h) => h.path[0] === 'weapon:TheViridescentHunt'
    )
    expect(procs.map((h) => h.t)).toEqual([
      ...Array.from({ length: 9 }, (_, i) => 11 + 30 * i),
      ...Array.from({ length: 9 }, (_, i) => ready + 11 + 30 * i),
    ])
    expect(
      procs
        .slice(0, 9)
        .every(
          (h) =>
            h.snapshotT === 10 &&
            h.tag === 'other' &&
            h.element === 'physical' &&
            !h.applies
        )
    ).toBe(true)
    expect(sim.notes.some((n) => n.includes('expected timing'))).toBe(true)
  })
  it('keeps queued cyclone ticks after swapping, but off-field attacks never activate either proc', () => {
    const cyclone = play('TheViridescentHunt', [attack(0), attack(10)], {
      teammate: 'Amber',
      frames: 20,
      rotation: 'Fischl E -> Amber W10',
    })
    const ticks = cyclone.hits.filter(
      (h) => h.path[0] === 'weapon:TheViridescentHunt'
    )
    expect(ticks).toHaveLength(9)
    expect(ticks.some((h) => h.onField === 'Amber')).toBe(true)
    for (const weapon of ['SequenceOfSolitude', 'TheViridescentHunt']) {
      const sim = play(weapon, [attack(100), attack(110)], {
        teammate: 'Amber',
        frames: 1,
        rotation: 'Fischl E -> Amber W15',
      })
      expect(sim.hits.some((h) => h.path[0] === `weapon:${weapon}`)).toBe(false)
    }
  })
  it('does not inject procs from candidate weapons into another weapon’s timeline', () => {
    for (const weapon of ['SequenceOfSolitude', 'TheViridescentHunt']) {
      const sim = play(weapon, [attack(0), attack(10)], { candidate: true })
      expect(sim.hits.some((h) => h.path[0].startsWith('weapon:'))).toBe(false)
    }
  })
  it.each([
    'SequenceOfSolitude',
    'TheViridescentHunt',
  ])('%s damage evaluates only for the equipped bow and doubles its coefficient from R1 to R5', (weapon) => {
    const damageFor = (equipped: string, refinement: number) => {
      const db = new ArtCharDatabase(1, new SandboxStorage({}))
      const character = {
        level: 90,
        ascension: 6,
        constellation: 0,
        talent: { auto: 9, skill: 9, burst: 9 },
      }
      db.chars.set('Fischl', { key: 'Fischl', ...character })
      const teamCharId = db.teamChars.new('Fischl', {})
      const buildTcId = db.buildTcs.new({
        characterKey: 'Fischl',
        character,
        weapon: { key: equipped, level: 90, ascension: 6, refinement },
        artifact: {
          slots: {},
          substats: { type: 'max', stats: {}, rarity: 5 },
          sets: {},
        },
      } as never)
      const teamId = db.teams.new({
        loadoutData: [
          { teamCharId, buildType: 'tc', buildTcId },
        ] as LoadoutDatum[],
      } as never)
      return (
        evaluateTeamRotation(db, teamId, 'F', {
          arts: {},
          attacks: {
            Fischl: [
              { path: [`weapon:${weapon}`, 'dmg'], hits: 1, hitMode: 'avgHit' },
            ],
          },
        })?.total ?? 0
      )
    }
    const r1 = damageFor(weapon, 1)
    expect(r1).toBeGreaterThan(0)
    expect(damageFor(weapon, 5)).toBeCloseTo(2 * r1, 6)
    expect(damageFor('Slingshot', 1)).toBe(0)
  })
})
