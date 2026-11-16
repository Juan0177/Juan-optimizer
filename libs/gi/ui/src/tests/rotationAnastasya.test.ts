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
    const sim = run('Anastasya hE Q N5 N5 W3 E E E W2', ['Anastasya'])
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

  it('one N5 string ends the Honor Sealing (the dump: 120, time 1 per 12 frames, the attacks 10/20/20/30/30)', () => {
    const sim = run('Anastasya hE Q N5 E E E W1', ['Anastasya'])
    const n5 = sim.actions.find((a) => a.text === 'N5')!
    const es = sim.actions.filter((a) => a.text === 'E')
    expect(es.map((a) => a.variant?.key)).toEqual(['doom1', 'doom2', 'doom3'])
    // the Sealing ends within the string's fifth attack (its 30 lands 0.65 s in, after its last
    // hit), the Accolades share then lasting 8 s more
    const share = sim.buffWindows.find(
      (w) =>
        w.owner === 'Anastasya' &&
        w.path[1] === 'accolades' &&
        w.value === 'honorSeal'
    )!
    const sealEnd = share.end - 480
    const fifth = n5.start + 26 + 33 + 37 + 30
    expect(sealEnd).toBeGreaterThan(fifth)
    expect(sealEnd).toBeLessThanOrEqual(fifth + 55)
    // Doom's first stage follows at once (no wait for the Skill CD)
    expect(es[0].start).toBe(Math.max(n5.start + n5.frames, sealEnd))
    for (const stage of ['doom0Sc', 'doom1Sc', 'doom2Sc'])
      expect(sim.hits.some((h) => h.path[1] === stage)).toBe(true)
  })

  it('without Blessed Spear attacks the 14 s run out: the others unseal without Doom', () => {
    const sim = run('Anastasya hE Q W15 E W1', ['Anastasya'])
    expect(sim.hits.some((h) => h.path[1]?.startsWith('doom'))).toBe(false)
    expect(sim.actions.find((a) => a.text === 'E')!.variant).toBeUndefined()
    const evernight = sim.hits.find((h) => h.path[1] === 'evernightSc')!
    expect(windowAt(sim, 'accolades', evernight.t + 840 + 481)).not.toBe(
      'honorSeal'
    )
  })

  it('leaving the field ends the Blessing of Honor; the hold Skill ends the crown and To the New World', () => {
    const sim = run('Anastasya hE Q N5 E E E -> Bennett E W2', [
      'Anastasya',
      'Bennett',
    ])
    const bennett = sim.actions.find((a) => a.characterKey === 'Bennett')!
    expect(windowAt(sim, 'blessing', bennett.start - 1)).toBe('honor')
    expect(windowAt(sim, 'blessing', bennett.start)).toBe('love')

    const love = run('Anastasya E Q hE W10', ['Anastasya'])
    const hold = love.actions.find((a) => a.text === 'hE')!
    expect(windowAt(love, 'burstActive', hold.start - 1)).toBe('on')
    expect(windowAt(love, 'burstActive', hold.start)).toBe('')
    expect(
      love.hits.some(
        (h) => h.path.join('.') === 'skill.crownDmg' && h.t > hold.start
      )
    ).toBe(false)
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

  it('C6 Honor: the Skill right after the hold Skill is Doom’s third attack, with no cooldown wait', () => {
    const sim = run('Anastasya hE E W1', ['Anastasya'], { Anastasya: 6 })
    const [hold, strike] = sim.actions.filter(
      (a) => a.characterKey === 'Anastasya'
    )
    expect(strike.start).toBe(hold.start + hold.frames)
    expect(strike.variant?.label).toBe('Palestar Edict: Doom 3-Hit (C6)')
    const doom = sim.hits.find((h) => h.path[0] === 'constellation6')!
    expect(doom.path.join('.')).toBe('constellation6.doom3Sc')
    // (nobody Sealed: C6_VirtualSealed_Bonus, every member's Accolades)
    expect(doom.states).toContainEqual({
      owner: 'Anastasya',
      path: ['Anastasya', 'accolades'],
      value: 'honorSeal',
    })
  })

  it('uses 18 s Burst CD in both Blessings', () => {
    for (const rot of ['Anastasya E Q Q', 'Anastasya hE Q Q']) {
      const sim = run(rot, ['Anastasya'])
      const qs = sim.actions.filter(
        (a) => a.characterKey === 'Anastasya' && a.text === 'Q'
      )
      expect(qs[1].start - qs[0].start).toBeGreaterThanOrEqual(1080)
    }
  })

  it('C6 hE Q N5D N5D E E E: the Sealing’s end removes the unused C6 strike, Doom’s third stage is its own', () => {
    // (the dump's Frozen_SwitchSkill_Prepare removes Constellation_6_Descender_Ready)
    const c6 = run('Anastasya hE Q N5 D N5 D E E E W1', ['Anastasya'], {
      Anastasya: 6,
    })
    expect(c6.hits.some((h) => h.path[0] === 'constellation6')).toBe(false)
    expect(
      c6.hits.filter((h) => h.path.join('.') === 'burst.doom2Sc')
    ).toHaveLength(1)
    expect(
      c6.actions.filter((a) => a.text === 'E').map((a) => a.variant?.key)
    ).toEqual(['doom1', 'doom2', 'doom3'])
  })

  it('C6 hE Q E N5D N5D E E E: the strike once, at once, with every member’s Accolades, then all of Doom', () => {
    const sim = run('Anastasya hE Q E N5 D N5 D E E E W1', ['Anastasya'], {
      Anastasya: 6,
    })
    const q = sim.actions.find((a) => a.text === 'Q')!
    const es = sim.actions.filter((a) => a.text === 'E')
    expect(es[0].start).toBe(q.start + q.frames)
    expect(es.map((a) => a.variant?.key)).toEqual([
      'c6doom',
      'doom1',
      'doom2',
      'doom3',
    ])
    expect(sim.notes.some((n) => n.includes('Waited'))).toBe(false)
    const strikes = sim.hits.filter(
      (h) => h.path.join('.') === 'constellation6.doom3Sc'
    )
    expect(strikes).toHaveLength(1)
    expect(strikes[0].states).toContainEqual({
      owner: 'Anastasya',
      path: ['Anastasya', 'accolades'],
      value: 'honorSeal',
    })
    expect(windowAt(sim, 'accolades', strikes[0].t)).toBe('honorSeal')
    // (its 20% Elevation window is on then)
    expect(windowAt(sim, 'c6HonorWindow', strikes[0].t)).toBe('on')
    for (const stage of ['doom0Sc', 'doom1Sc', 'doom2Sc'])
      expect(sim.hits.filter((h) => h.path[1] === stage)).toHaveLength(1)
    // (below C6 the E waits for the Skill CD instead)
    const c0 = run('Anastasya hE Q E W1', ['Anastasya'])
    expect(c0.hits.some((h) => h.path[0] === 'constellation6')).toBe(false)
    expect(c0.actions.filter((a) => a.text === 'E')[0].start).toBeGreaterThan(
      q.start + q.frames
    )
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

    // the C6 strike's 'honorSeal' Accolades: every member's 12% (x1.3 at C4), 4 units against 1
    const critDMG = (accolades: string) => {
      const id = db.teamChars.new('Anastasya', {
        conditional: { Anastasya: { blessing: 'honor', accolades } },
      })
      const teamId = db.teams.new({
        loadoutData: [{ teamCharId: id }] as LoadoutDatum[],
      })
      return uiDataForTeam(
        getTeamDataWith(db, teamId, {})! as never,
        'F',
        'Anastasya'
      ).Anastasya!.target.getDisplay()['basic']['critDMG_'].value
    }
    expect(critDMG('honorSeal') - critDMG('on')).toBeCloseTo(3 * 0.12 * 1.3, 5)
  })
})
