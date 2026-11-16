/**
 * Weapon damage procs end to end: the rotation simulation emits the weapon's own hit (Skyward
 * Harp, kqmsim), it becomes an attack on the weapon's damage node, and Team optimize counts it,
 * for a build holding that weapon only.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

function fischl(weapon: string) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Fischl', {
    key: 'Fischl',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Fischl', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Fischl',
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

const play = (weapon: string) =>
  simulateRotation({
    rotation: parseRotation('Fischl N5 N5 N5 N5', [
      { characterKey: 'Fischl', name: 'Fischl' },
    ]),
    members: ['Fischl'],
    constellations: {},
    elements: { Fischl: 'electro' },
    gear: { Fischl: { weapon, refinement: 1 } },
    repeats: 1,
    keep: 'all',
  })

describe('Skyward Harp’s proc', () => {
  const sim = play('SkywardHarp')
  const procs = sim.hits.filter((h) => h.path[0] === 'weapon:SkywardHarp')
  it('procs from the wielder’s hits, about once per cooldown at 60%', () => {
    // (20 Normal hits over about 7 s at R1: 60% credit per hit, a 4 s cooldown from each proc)
    expect(procs.length).toBeGreaterThanOrEqual(2)
    expect(procs.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < procs.length; i++)
      expect(procs[i].t - procs[i - 1].t).toBeGreaterThanOrEqual(240)
  })
  it('is an attack Team optimize counts, for the build holding it only', () => {
    const attack = rotationAttacks(sim, () => undefined).Fischl!.find(
      (a) => a.path[0] === 'weapon:SkywardHarp'
    )!
    expect(attack.path).toEqual(['weapon:SkywardHarp', 'dmg'])
    expect(attack.hits).toBe(procs.length)
    const harp = fischl('SkywardHarp')
    const withHarp = evaluateTeamRotation(harp.db, harp.teamId, 'F', {
      arts: {},
      attacks: { Fischl: [attack] },
    })!.total
    expect(withHarp).toBeGreaterThan(0)
    const other = fischl('Slingshot')
    const without = evaluateTeamRotation(other.db, other.teamId, 'F', {
      arts: {},
      attacks: { Fischl: [attack] },
    })?.total
    expect(without ?? 0).toBe(0)
  })
  it('is not played for another bow', () => {
    expect(
      play('Slingshot').hits.some((h) => h.path[0].startsWith('weapon:'))
    ).toBe(false)
  })
})
