/**
 * Weapon audit batch claymore3 (rotation/weapons/claymore3.ts and its sheet fixes), as kqmsim:
 * Blade of Atonement's reaction EM and Stellar ATK, Forged by the Golden Melody's Harmonic
 * Movements and Contrapuntal, Prototype Archaic's Crush, Makhaira Aquamarine's team ATK.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptBuffState } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import { attackHitData } from '../../util/teamOpt/objective'
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
  gear: Partial<Record<CharacterKey, SimGear>>
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
    reactions: { onHit() {} },
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

const mark = (reaction: string): KitHit => ({
  path: ['_reaction', reaction],
  tag: 'other',
  element: 'physical',
  label: reaction,
})
const normal: KitHit = {
  path: ['normal', '0'],
  tag: 'normal',
  element: 'physical',
  label: 'Normal',
}

/** A team of members holding these weapons (level 90, no artifacts) */
function team(weapons: Partial<Record<CharacterKey, string>>) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData = (Object.keys(weapons) as CharacterKey[]).map((key) => {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    })
    db.weapons.new({
      key: weapons[key]!,
      level: 90,
      ascension: 6,
      refinement: 1,
      location: key,
      lock: false,
    } as never)
    return { teamCharId: db.teamChars.new(key) }
  })
  const teamId = db.teams.new({ loadoutData } as never)
  return { db, teamId }
}
/** A member's total stat during an attack (on the field: `onField`; with these states) */
function statDuring(
  t: ReturnType<typeof team>,
  characterKey: CharacterKey,
  stat: 'atk' | 'atk_' | 'eleMas',
  onField: CharacterKey,
  states: TeamOptBuffState[] = []
) {
  const attack: TeamOptAttack = {
    path: ['skill', 'press'],
    hits: 1,
    hitMode: 'avgHit',
    onField,
    states,
  }
  return attackHitData(t.db, t.teamId, 'F', {
    attack,
    characterKey,
  })!.target.get(input.total[stat]).value
}

describe('Blade of Atonement', () => {
  const gear = { Kaveh: { weapon: 'BladeOfAtonement', refinement: 1 } }
  it('EM 12 s after any of the wielder’s reactions, ATK after its Stellar ones, from the next hit', () => {
    const sim = play(
      'Kaveh E',
      {
        Kaveh: testKit('Kaveh', 'dendro', () => ({
          frames: 2400,
          hits: [
            [0, mark('bloom')],
            [100, mark('stellarConduct')],
            [1500, mark('moondrift')], // (not a reaction event: nothing)
          ],
        })),
      },
      gear
    )
    expect(on(sim, 'BladeOfAtonement.react')).toEqual([
      [1, 721, 'on'],
      [101, 821, 'on'],
    ])
    expect(on(sim, 'BladeOfAtonement.stellar')).toEqual([[101, 821, 'on']])
  })
  it('off the field too, and not from a teammate’s reaction', () => {
    const sim = play(
      'Kaveh E Bennett E',
      {
        Kaveh: testKit('Kaveh', 'dendro', () => ({
          frames: 100,
          hits: [[400, mark('stellarSwirl')]],
        })),
        Bennett: testKit('Bennett', 'pyro', () => ({
          frames: 900,
          hits: [[0, mark('stellarConduct')]],
        })),
      },
      gear
    )
    expect(on(sim, 'BladeOfAtonement.stellar')).toEqual([[401, 1121, 'on']])
  })
  it('its Stellar switch gives the ATK, its reaction switch the EM only (sheet)', () => {
    const t = team({ Kaveh: 'BladeOfAtonement' })
    const state = (cond: string): TeamOptBuffState[] => [
      { owner: 'Kaveh', path: ['BladeOfAtonement', cond], value: 'on' },
    ]
    const atk = statDuring(t, 'Kaveh', 'atk_', 'Kaveh')
    const em = statDuring(t, 'Kaveh', 'eleMas', 'Kaveh')
    expect(
      statDuring(t, 'Kaveh', 'atk_', 'Kaveh', state('stellar')) - atk
    ).toBeCloseTo(0.16)
    expect(statDuring(t, 'Kaveh', 'atk_', 'Kaveh', state('react'))).toBeCloseTo(
      atk
    )
    expect(
      statDuring(t, 'Kaveh', 'eleMas', 'Kaveh', state('react')) - em
    ).toBeCloseTo(64)
  })
})

describe('Forged by the Golden Melody', () => {
  it('ATK, EM, Stellar DMG in turn every 10 s; a Contrapuntal copy per Stellar reaction, once per 12 s', () => {
    const sim = play(
      'Kaveh E',
      {
        Kaveh: testKit('Kaveh', 'dendro', () => ({
          frames: 2000,
          hits: [
            [700, mark('stellarConduct')], // (EM playing)
            [900, mark('stellarSwirl')], // (within 12 s: none)
            [1500, mark('stellarSwirl')], // (Stellar DMG playing)
          ],
        })),
      },
      { Kaveh: { weapon: 'ForgedByTheGoldenMelody', refinement: 1 } }
    )
    const movement = on(sim, 'ForgedByTheGoldenMelody.movement')
    expect(movement.slice(0, 3)).toEqual([
      [0, 600, '1'],
      [600, 1200, '2'],
      [1200, 1800, '3'],
    ])
    expect([movement[3][0], movement[3][2]]).toEqual([1800, '1'])
    expect(on(sim, 'ForgedByTheGoldenMelody.contra')).toEqual([
      [701, 1421, '2'],
      [1501, 2221, '3'],
    ])
  })
})

describe('Prototype Archaic: Crush', () => {
  const hits = Array.from({ length: 50 }, (_, i): [number, KitHit] => [
    i * 30,
    normal,
  ])
  const play1 = (weapon: string) =>
    play(
      'Kaveh N1',
      { Kaveh: testKit('Kaveh', 'dendro', () => ({ frames: 1500, hits })) },
      { Kaveh: { weapon, refinement: 1 } }
    )
  it('50% credit per Normal hit on the field, 15 s from a proc, 1 frame later', () => {
    const sim = play1('PrototypeArchaic')
    expect(
      sim.hits
        .filter((h) => h.path[0] === 'weapon:PrototypeArchaic')
        .map((h) => [h.t, h.path[1]])
    ).toEqual([
      [31, 'dmg'],
      [961, 'dmg'],
    ])
    expect(
      play1('Rainslasher').hits.some((h) => h.path[0].startsWith('weapon:'))
    ).toBe(false)
  })
  it('is an attack Team optimize counts, for the build holding it only', () => {
    const attack = rotationAttacks(
      play1('PrototypeArchaic'),
      () => undefined
    ).Kaveh!.find((a) => a.path[0] === 'weapon:PrototypeArchaic')!
    expect(attack.hits).toBe(2)
    const total = (weapon: string) => {
      const t = team({ Kaveh: weapon })
      return (
        evaluateTeamRotation(t.db, t.teamId, 'F', {
          arts: {},
          attacks: { Kaveh: [attack] },
        })?.total ?? 0
      )
    }
    expect(total('PrototypeArchaic')).toBeGreaterThan(0)
    expect(total('Rainslasher')).toBe(0)
  })
})

describe('Makhaira Aquamarine: the party’s share (sheet)', () => {
  it('every other member gets 30% of it whoever is on the field; the wielder never does', () => {
    const t = team({ Kaveh: 'MakhairaAquamarine', Bennett: 'AquilaFavonia' })
    const without = team({ Kaveh: 'Rainslasher', Bennett: 'AquilaFavonia' })
    const base = statDuring(without, 'Bennett', 'atk', 'Bennett')
    const withField = statDuring(t, 'Bennett', 'atk', 'Bennett')
    expect(withField).toBeGreaterThan(base)
    // (Bennett's off-field hit while Kaveh is on the field: the same share)
    expect(statDuring(t, 'Bennett', 'atk', 'Kaveh')).toBeCloseTo(withField)
    // (Kaveh's own off-field hit: no share for himself on top of his 24%)
    expect(statDuring(t, 'Kaveh', 'atk', 'Bennett')).toBeCloseTo(
      statDuring(t, 'Kaveh', 'atk', 'Kaveh')
    )
  })
})
