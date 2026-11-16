/**
 * Weapon audit batch polearm2 (rotation/weapons/polearm2.ts), as kqmsim: Calamity Queller's
 * Consummation ramp, Engulfing Lightning's ER after the Burst, Primordial Jade Winged-Spear's and
 * Staff of the Scarlet Sands' stacks, Dragonspine Spear's Everfrost Icicle, Missive Windspear's
 * on-field reactions, Prospector's Drill's Symbols and Struggle, Song of the Vigil's Stellar ATK.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import {
  parseRotation,
  type RotationAction,
} from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitElement,
  KitModel,
  SimGear,
  SimHit,
} from '../../util/teamOpt/rotation/types'

type KitHit = Omit<SimHit, 't' | 'characterKey' | 'onField'>
type Plan = { frames: number; hits?: [number, KitHit][] }

/** A kit that plays each action as `plan` says: its frames and the hits it lands (delays) */
const testKit = (
  characterKey: CharacterKey,
  element: HitElement,
  plan: (action: RotationAction, index: number) => Plan
): KitModel => {
  let index = 0
  return {
    characterKey,
    element,
    source: 'test',
    act(ctx, _state, action) {
      const p = plan(action, index++)
      for (const [t, h] of p.hits ?? []) ctx.hit(t, h)
      return { frames: p.frames }
    },
  }
}

function play(
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  gear: Partial<Record<CharacterKey, SimGear>>,
  reactions = false
) {
  const members = Object.keys(kits) as CharacterKey[]
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: Object.fromEntries(members.map((m) => [m, kits[m]!.element])),
    repeats: 1,
    kits,
    gear,
    ...(reactions ? {} : { reactions: { onHit() {} } }),
  })
}

/** The windows a conditional is on: [start, end, value] */
const on = (
  sim: ReturnType<typeof simulateRotation>,
  path: string,
  owner?: CharacterKey
) =>
  sim.buffWindows
    .filter(
      (w) =>
        w.path.join('.') === path &&
        w.end > w.start &&
        w.value !== '' &&
        (!owner || w.owner === owner)
    )
    .map((w) => [w.start, w.end, w.value])

const normal = (element: HitElement = 'physical', applies = false): KitHit => ({
  path: ['normal', '0'],
  tag: 'normal',
  element,
  label: 'Normal',
  ...(applies && { applies: true, durability: 25 }),
})
const skillHit: KitHit = {
  path: ['skill', 'press'],
  tag: 'skill',
  element: 'electro',
  label: 'Skill',
}
const mark = (reaction: string): KitHit => ({
  path: ['_reaction', reaction],
  tag: 'other',
  element: 'physical',
  label: reaction,
})
const heal = (healTargets: CharacterKey[]): KitHit => ({
  path: ['_heal', 'skill', 'heal'],
  tag: 'other',
  element: 'physical',
  label: 'Heal',
  healTargets,
})

describe('Calamity Queller: Consummation', () => {
  const gear = { Shenhe: { weapon: 'CalamityQueller', refinement: 1 } }
  it('a stack each second from 1 s after the Skill, up to 6; reset 20 s after it', () => {
    const sim = play(
      'Shenhe E',
      { Shenhe: testKit('Shenhe', 'cryo', () => ({ frames: 1500 })) },
      gear
    )
    expect(on(sim, 'CalamityQueller.stack')).toEqual([
      [60, 120, '1'],
      [120, 180, '2'],
      [180, 240, '3'],
      [240, 300, '4'],
      [300, 360, '5'],
      [360, 1200, '6'],
    ])
  })
  it('a new Skill within 20 s keeps the stacks and moves the reset', () => {
    const sim = play(
      'Shenhe E E',
      {
        Shenhe: testKit('Shenhe', 'cryo', (_a, i) => ({
          frames: i ? 1500 : 900,
        })),
      },
      gear
    )
    expect(on(sim, 'CalamityQueller.stack').at(-1)).toEqual([360, 2100, '6'])
  })
  it('after the reset, the next Skill ramps from 0 again', () => {
    const sim = play(
      'Shenhe E E',
      {
        Shenhe: testKit('Shenhe', 'cryo', (_a, i) => ({
          frames: i ? 600 : 1300,
        })),
      },
      gear
    )
    const w = on(sim, 'CalamityQueller.stack')
    expect(w).toContainEqual([360, 1200, '6'])
    expect(w).toContainEqual([1360, 1420, '1'])
  })
})

describe('Engulfing Lightning: ER after the Burst', () => {
  it('12 s from the Burst', () => {
    const sim = play(
      'RaidenShogun Q',
      {
        RaidenShogun: testKit('RaidenShogun', 'electro', () => ({
          frames: 1000,
        })),
      },
      { RaidenShogun: { weapon: 'EngulfingLightning', refinement: 1 } }
    )
    expect(on(sim, 'EngulfingLightning.TimelessDream')).toEqual([
      [0, 720, 'on'],
    ])
  })
})

describe('Primordial Jade Winged-Spear: stacks', () => {
  const gear = { Xiao: { weapon: 'PrimordialJadeWingedSpear', refinement: 1 } }
  it('a stack per on-field hit once per 0.3 s, after the hit; all refreshed; 6 s', () => {
    const times = [0, 10, 20, 40, 60, 80, 100, 120, 140, 900]
    const sim = play(
      'Xiao N1',
      {
        Xiao: testKit('Xiao', 'anemo', () => ({
          frames: 1200,
          hits: times.map((t) => [t, normal('anemo')]),
        })),
      },
      gear
    )
    const w = on(sim, 'PrimordialJadeWingedSpear.stack')
    // (the hit at 10 is within the 0.3 s cooldown; 7 at most; lapsed at 501, from 1 at 900)
    expect(w.slice(0, 8)).toEqual([
      [1, 21, '1'],
      [21, 41, '2'],
      [41, 61, '3'],
      [61, 81, '4'],
      [81, 101, '5'],
      [101, 121, '6'],
      [121, 141, '7'],
      [141, 501, '7'],
    ])
    expect(w[8].slice(0, 1)).toEqual([901])
    expect(w[8][2]).toBe('1')
  })
  it('no stack from the wielder’s hits off the field', () => {
    const sim = play(
      'Xiao N1 Bennett E',
      {
        Xiao: testKit('Xiao', 'anemo', () => ({
          frames: 100,
          hits: [
            [0, normal('anemo')],
            [300, normal('anemo')],
          ],
        })),
        Bennett: testKit('Bennett', 'pyro', () => ({ frames: 600 })),
      },
      gear
    )
    expect(on(sim, 'PrimordialJadeWingedSpear.stack')).toEqual([[1, 361, '1']])
  })
})

describe('Staff of the Scarlet Sands: Skill stacks', () => {
  it('a stack per on-field Skill hit, 3 gains per 0.3 s at most, all refreshed for 10 s', () => {
    const sim = play(
      'Cyno E',
      {
        Cyno: testKit('Cyno', 'electro', () => ({
          frames: 1000,
          hits: [
            [0, skillHit],
            [2, skillHit],
            [4, skillHit],
            [6, skillHit], // (a 4th gain within 0.3 s: none)
            [100, normal('electro')], // (not a Skill hit)
            [300, skillHit],
          ],
        })),
      },
      { Cyno: { weapon: 'StaffOfTheScarletSands', refinement: 1 } }
    )
    expect(on(sim, 'StaffOfTheScarletSands.stacks')).toEqual([
      [1, 3, '1'],
      [3, 5, '2'],
      [5, 301, '3'],
      [301, 901, '3'],
    ])
  })
})

describe('Dragonspine Spear: Everfrost Icicle', () => {
  const hits = (element: HitElement, applies: boolean) =>
    Array.from({ length: 50 }, (_, i): [number, KitHit] => [
      i * 30,
      normal(element, applies),
    ])
  const icicles = (sim: ReturnType<typeof simulateRotation>) =>
    sim.hits
      .filter((h) => h.path[0] === 'weapon:DragonspineSpear')
      .map((h) => [h.t, h.path[1]])
  it('60% credit per Normal hit on the field, 10 s from a proc, 1 frame later', () => {
    const sim = play(
      'Rosaria N1',
      {
        Rosaria: testKit('Rosaria', 'cryo', () => ({
          frames: 1500,
          hits: hits('physical', false),
        })),
      },
      { Rosaria: { weapon: 'DragonspineSpear', refinement: 1 } }
    )
    expect(icicles(sim)).toEqual([
      [31, 'dmgAoe'],
      [661, 'dmgAoe'],
      [1261, 'dmgAoe'],
    ])
  })
  it('its Cryo multiplier on an enemy affected by Cryo', () => {
    const sim = play(
      'Rosaria N1',
      {
        Rosaria: testKit('Rosaria', 'cryo', () => ({
          frames: 1500,
          hits: hits('cryo', true),
        })),
      },
      { Rosaria: { weapon: 'DragonspineSpear', refinement: 1 } },
      true
    )
    const procs = icicles(sim)
    expect(procs.length).toBe(3)
    for (const [, node] of procs) expect(node).toBe('dmgOnCryoOp')
  })
  it('is an attack Team optimize counts, for the build holding it only', () => {
    const sim = play(
      'Rosaria N1',
      {
        Rosaria: testKit('Rosaria', 'cryo', () => ({
          frames: 1500,
          hits: hits('physical', false),
        })),
      },
      { Rosaria: { weapon: 'DragonspineSpear', refinement: 1 } }
    )
    const attack = rotationAttacks(sim, () => undefined).Rosaria!.find(
      (a) => a.path[0] === 'weapon:DragonspineSpear'
    )!
    expect(attack.path).toEqual(['weapon:DragonspineSpear', 'dmgAoe'])
    expect(attack.hits).toBe(3)
    const total = (weapon: string) => {
      const { db, teamId } = rosaria(weapon)
      return (
        evaluateTeamRotation(db, teamId, 'F', {
          arts: {},
          attacks: { Rosaria: [attack] },
        })?.total ?? 0
      )
    }
    expect(total('DragonspineSpear')).toBeGreaterThan(0)
    expect(total('WhiteTassel')).toBe(0)
  })
  it('procs only for the spear worn', () => {
    const sim = play(
      'Rosaria N1',
      {
        Rosaria: testKit('Rosaria', 'cryo', () => ({
          frames: 1500,
          hits: hits('physical', false),
        })),
      },
      { Rosaria: { weapon: 'WhiteTassel', refinement: 1 } }
    )
    expect(icicles(sim)).toEqual([])
  })
})

function rosaria(weapon: string) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Rosaria', {
    key: 'Rosaria',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Rosaria', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Rosaria',
    character: {
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    },
    weapon: { key: weapon, level: 90, ascension: 6, refinement: 1 },
    artifact: {
      slots: {},
      substats: { type: 'max', stats: {}, rarity: 5 },
      sets: {},
    },
  } as never)
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId, buildType: 'tc', buildTcId }] as LoadoutDatum[],
  } as never)
  return { db, teamId }
}

describe('Missive Windspear: after the wielder’s reactions on the field', () => {
  const gear = { Cyno: { weapon: 'MissiveWindspear', refinement: 1 } }
  it('10 s from the next hit; not off the field, nor a teammate’s reaction', () => {
    const sim = play(
      'Cyno E Bennett E',
      {
        Cyno: testKit('Cyno', 'electro', () => ({
          frames: 100,
          hits: [
            [0, mark('aggravate')],
            [300, mark('aggravate')], // (Bennett is on the field)
          ],
        })),
        Bennett: testKit('Bennett', 'pyro', () => ({
          frames: 900,
          hits: [[0, mark('overloaded')]],
        })),
      },
      gear
    )
    expect(on(sim, 'MissiveWindspear.passive')).toEqual([[1, 601, 'on']])
  })
  it('Hyperbloom from its damage; no Moondrift', () => {
    const sim = play(
      'Cyno E',
      {
        Cyno: testKit('Cyno', 'electro', () => ({
          frames: 900,
          hits: [
            [0, mark('moondrift')],
            [
              50,
              {
                path: ['reaction', 'hyperbloom'],
                tag: 'other',
                element: 'dendro',
                label: 'Hyperbloom',
              },
            ],
          ],
        })),
      },
      gear
    )
    expect(on(sim, 'MissiveWindspear.passive')).toEqual([[51, 651, 'on']])
  })
})

describe('Prospector’s Drill: Symbols and Struggle', () => {
  const gear = { Xiangling: { weapon: 'ProspectorsDrill', refinement: 1 } }
  it('3 Symbols from heals, consumed by the Skill for 10 s; once per 15 s', () => {
    const sim = play(
      'Xiangling N1 Xiangling E Xiangling N1 Xiangling Q',
      {
        Xiangling: testKit('Xiangling', 'pyro', (action) => ({
          frames: 100,
          hits:
            action.kind === 'normal'
              ? [0, 5, 10].map((t) => [t, heal(['Xiangling'])])
              : [],
        })),
      },
      gear
    )
    expect(on(sim, 'ProspectorsDrill.marksConsumed')).toEqual([[100, 700, '3']])
  })
  it('a teammate’s party heal: one Symbol; none without a heal', () => {
    const healed = play(
      'Bennett E Xiangling E',
      {
        Bennett: testKit('Bennett', 'pyro', () => ({
          frames: 100,
          hits: [[0, heal(['Bennett', 'Xiangling'])]],
        })),
        Xiangling: testKit('Xiangling', 'pyro', () => ({ frames: 900 })),
      },
      gear
    )
    const w = on(healed, 'ProspectorsDrill.marksConsumed')
    expect(w).toHaveLength(1)
    expect(w[0][2]).toBe('1')
    expect(Number(w[0][1]) - Number(w[0][0])).toBe(600)
    const dry = play(
      'Xiangling E',
      { Xiangling: testKit('Xiangling', 'pyro', () => ({ frames: 900 })) },
      gear
    )
    expect(on(dry, 'ProspectorsDrill.marksConsumed')).toEqual([])
  })
})

describe('Song of the Vigil: Stellar ATK', () => {
  it('12 s after the wielder’s Stellar-Conduct or Stellar Swirl, from the next hit', () => {
    const sim = play(
      'Ineffa E',
      {
        Ineffa: testKit('Ineffa', 'electro', () => ({
          frames: 1800,
          hits: [
            [0, mark('stellarConduct')],
            [100, mark('melt')],
            [1000, mark('stellarSwirl')],
          ],
        })),
      },
      { Ineffa: { weapon: 'SongOfTheVigil', refinement: 1 } }
    )
    expect(on(sim, 'SongOfTheVigil.stellar')).toEqual([
      [1, 721, 'on'],
      [1001, 1721, 'on'],
    ])
  })
})
