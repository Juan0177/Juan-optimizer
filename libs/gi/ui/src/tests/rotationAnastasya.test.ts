import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}
const windowAt = (
  sim: ReturnType<typeof run>,
  name: string,
  t: number
): string =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === 'Anastasya' &&
        w.path[1] === name &&
        w.start <= t &&
        t < w.end
    )
    .reduce<{ start: number; value: string } | undefined>(
      (latest, w) => (!latest || w.start >= latest.start ? w : latest),
      undefined
    )?.value ?? ''

describe('Anastasya', () => {
  it('cancels a normal attack into the aimed shot at its last release (gcsim)', () => {
    const sim = run('Anastasya N1 CA', ['Anastasya'])
    const ca = sim.actions.find((a) => a.text === 'CA')!
    expect(ca.start).toBe(17)
  })

  it('the Love burst freezes the Palestar Crown for its 20 s', () => {
    const plain = run('Anastasya E W40', ['Anastasya'])
    const frozen = run('Anastasya E Q W40', ['Anastasya'])
    const crowns = (sim: ReturnType<typeof run>) =>
      sim.hits.filter((h) => h.path.join('.') === 'skill.crownDmg')
    // 20 s crown: first attack 139 frames in, then every 118
    const last = crowns(plain).at(-1)!.t
    expect(last).toBeLessThan(1200 + 17)
    expect(crowns(frozen).at(-1)!.t).toBeGreaterThan(last + 1000)
  })

  it('holds the Skill for the Blessing of Honor: Blessed Spear normals, no charged attacks', () => {
    const sim = run('Anastasya hE N5 CA', ['Anastasya'])
    expect(sim.hits.some((h) => h.path.join('.') === 'skill.holdDmg')).toBe(
      true
    )
    const spear = sim.hits.filter((h) => h.label.startsWith('Blessed Spear'))
    expect(spear).toHaveLength(1 + 2 + 1 + 3 + 3)
    expect(spear.every((h) => h.element === 'cryo')).toBe(true)
    expect(sim.warnings.some((w) => w.includes('Charged Attacks'))).toBe(true)
    expect(windowAt(sim, 'blessing', 100)).toBe('honor')
  })

  it('Evernight Seals the others, Blessed Spear hits shorten it, then Doom runs its three stages', () => {
    const sim = run('Anastasya hE Q N5 N5 N5 N5 W3 E E E W2', ['Anastasya'])
    const evernight = sim.hits.find((h) =>
      h.label.startsWith('The Evernight Yields to Dawn')
    )!
    expect(evernight.tag).toBe('directStellarConduct')
    const doom = sim.hits.filter((h) => h.label.startsWith('Palestar Edict'))
    expect(
      doom.filter((h) => h.path.join('.') === 'burst.doom1Dmg')
    ).toHaveLength(5)
    for (const stage of ['doom0Sc', 'doom1Sc', 'doom2Sc'])
      expect(doom.some((h) => h.path[1] === stage)).toBe(true)
    // Honor Sealing ended (Doom available): Accolades were shared with her meanwhile
    expect(windowAt(sim, 'accolades', evernight.t + 1)).toBe('honorSeal')
  })

  it('C2 Love lasts 30 s after the tap, independent of the crown', () => {
    const sim = run('Anastasya E W35', ['Anastasya'], { Anastasya: 2 })
    expect(windowAt(sim, 'c2LoveWindow', 1700)).toBe('on')
    expect(windowAt(sim, 'c2LoveWindow', 1900)).toBe('off')
  })

  it('C6 Love triggers a 200% Triumph on the next switch to another member', () => {
    const sim = run('Anastasya E -> Bennett E', ['Anastasya', 'Bennett'], {
      Anastasya: 6,
    })
    const triumph = sim.hits.filter((h) => h.label.startsWith('Triumph (C6)'))
    expect(triumph).toHaveLength(1)
    expect(triumph[0].path.join('.')).toBe('constellation6.triumphSc')
    const attack = rotationAttacks(sim).Anastasya!.find(
      (a) => a.path.join('.') === 'constellation6.triumphSc'
    )!
    expect(attack.states).toContainEqual({
      owner: 'Anastasya',
      path: ['Anastasya', 'blessing'],
      value: 'love',
    })
  })

  it('C6 Honor adds Doom’s third attack to the next tapped Skill', () => {
    const sim = run('Anastasya hE W15 E', ['Anastasya'], { Anastasya: 6 })
    const doom = sim.hits.find((h) => h.label.startsWith('Doom 3-Hit (C6)'))!
    expect(doom.path.join('.')).toBe('constellation6.doom3Sc')
    expect(doom.states).toContainEqual({
      owner: 'Anastasya',
      path: ['Anastasya', 'accolades'],
      value: 'honorSeal',
    })
  })

  it('uses 18 s Burst CD in both Blessings; at C6 Honor’s strike is Doom’s third stage, after the others unseal', () => {
    for (const rot of ['Anastasya E Q Q', 'Anastasya hE Q Q']) {
      const sim = run(rot, ['Anastasya'])
      const qs = sim.actions.filter(
        (a) => a.characterKey === 'Anastasya' && a.text === 'Q'
      )
      expect(qs[1].start - qs[0].start).toBeGreaterThanOrEqual(1080)
    }

    const c6 = run('Anastasya hE Q N5 N5 N5 N5 E E E E', ['Anastasya'], {
      Anastasya: 6,
    })
    // (the dump's Breaking_Descender: with the C6 flag from the hold Skill, the third stage deals
    // the C6 version, 250% with every member's Accolades, instead of its own DMG, once)
    const strikes = c6.hits.filter(
      (h) => h.path.join('.') === 'constellation6.doom3Sc'
    )
    expect(strikes).toHaveLength(1)
    expect(c6.hits.some((h) => h.path.join('.') === 'burst.doom2Sc')).toBe(
      false
    )
    expect(
      strikes[0].states?.find((x) => x.path.join('.') === 'Anastasya.accolades')
        ?.value
    ).toBe('honorSeal')
    // (its 20% Elevation window is on then)
    expect(windowAt(c6, 'c6HonorWindow', strikes[0].t)).toBe('on')
    // (below C6, the third stage is Doom's own)
    const c0 = run('Anastasya hE Q N5 N5 N5 N5 E E E E', ['Anastasya'])
    expect(c0.hits.some((h) => h.path.join('.') === 'burst.doom2Sc')).toBe(true)
    expect(c0.hits.some((h) => h.path[0] === 'constellation6')).toBe(false)
  })

  it('sheet reflects 7.2.52 CRIT DMG ascension, A4 10% Swirl coeff, C2 50% CRIT DMG, and C6 200%/250% multipliers', () => {
    const db = new ArtCharDatabase(1, new SandboxStorage({}))
    db.chars.set('Anastasya', {
      key: 'Anastasya',
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 6,
    })
    db.weapons.new({
      key: 'HuntersBow',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: 'Anastasya',
      lock: false,
    })
    const loveId = db.teamChars.new('Anastasya', {
      conditional: {
        Anastasya: {
          blessing: 'love',
          a0StellarRadianceSc: 'on',
        },
      },
    })
    const loveTeamId = db.teams.new({
      loadoutData: [{ teamCharId: loveId }] as LoadoutDatum[],
    })
    const loveAna = uiDataForTeam(
      getTeamDataWith(db, loveTeamId, {})! as never,
      'F',
      'Anastasya'
    ).Anastasya!.target
    expect(loveAna.getDisplay()['basic']['critDMG_'].value).toBeCloseTo(
      0.884,
      5
    )
    expect(loveAna.getDisplay()['basic']['critRate_'].value).toBeCloseTo(
      0.05,
      5
    )
    expect(loveAna.get(input.total.stellarswirl_mult_).value).toBeCloseTo(
      0.1,
      6
    )
    expect(loveAna.get(input.total.stellarconduct_critDMG_).value).toBeCloseTo(
      0.5,
      6
    )
    expect(
      loveAna.getDisplay()['constellation6']['triumphSc'].value /
        loveAna.getDisplay()['burst']['triumphSc'].value
    ).toBeCloseTo(2.0, 5)

    const honorId = db.teamChars.new('Anastasya', {
      conditional: {
        Anastasya: {
          blessing: 'honor',
          a0StellarRadianceSc: 'on',
        },
      },
    })
    const honorTeamId = db.teams.new({
      loadoutData: [{ teamCharId: honorId }] as LoadoutDatum[],
    })
    const honorAna = uiDataForTeam(
      getTeamDataWith(db, honorTeamId, {})! as never,
      'F',
      'Anastasya'
    ).Anastasya!.target
    expect(
      honorAna.getDisplay()['constellation6']['doom3Sc'].value /
        honorAna.getDisplay()['burst']['doom2Sc'].value
    ).toBeCloseTo(2.5, 5)
  })
})
