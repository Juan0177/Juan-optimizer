import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { groupAttacks, holdsItem, totalHits } from './attackGroups'

const attack = (
  path: string,
  extra: Partial<TeamOptAttack> = {}
): TeamOptAttack => ({
  path: path.split('.'),
  hits: 1,
  hitMode: 'avgHit',
  ...extra,
})

describe('groupAttacks', () => {
  it('groups parts of the same attack in first-seen order', () => {
    const attacks = [
      attack('a.ec', { onField: 'Bennett' }),
      attack('a.skill'),
      attack('a.ec', { onField: 'Xingqiu', hits: 0.5 }),
      attack('a.ec', { limits: [{ owner: 'Bennett', path: ['x'], hits: 0 }] }),
    ]
    expect(groupAttacks(attacks).map((g) => g.indices)).toEqual([
      [0, 2, 3],
      [1],
    ])
  })

  it('keeps a different reaction, infusion or hit mode apart', () => {
    const attacks = [
      attack('a.n1'),
      attack('a.n1', { reaction: 'vaporize' }),
      attack('a.n1', { infusionAura: 'pyro' }),
      attack('a.n1', { hitMode: 'critHit' }),
    ]
    expect(groupAttacks(attacks).map((g) => g.indices)).toEqual([
      [0],
      [1],
      [2],
      [3],
    ])
  })

  it('counts hits per rotation', () => {
    expect(
      totalHits([attack('a', { hits: 2 }), attack('b', { hits: 0.5 })])
    ).toBe(2.5)
  })
})

describe('holdsItem', () => {
  const gear = {
    Sandrone: { weapon: 'WolfsGravestone', sets: { LongNightsOath: 4 } },
    Mitya: { weapon: 'TheWidsith', sets: { GoldenTroupe: 2, Instructor: 2 } },
  }
  it('a weapon or set buff counts only for the build that holds it', () => {
    expect(holdsItem(gear, 'Sandrone', 'WolfsGravestone')).toBe(true)
    expect(holdsItem(gear, 'Sandrone', 'Deathmatch')).toBe(false)
    expect(holdsItem(gear, 'Sandrone', 'LongNightsOath')).toBe(true)
    expect(holdsItem(gear, 'Sandrone', 'CrimsonWitchOfFlames')).toBe(false)
    expect(holdsItem(gear, 'Mitya', 'GoldenTroupe')).toBe(true)
  })
  it('other buffs, the team’s and members without a build always count', () => {
    expect(holdsItem(gear, 'Sandrone', 'Sandrone')).toBe(true)
    expect(holdsItem(gear, 'team', 'CrimsonWitchOfFlames')).toBe(true)
    expect(holdsItem(gear, 'Odette', 'Deathmatch')).toBe(true)
  })
})
