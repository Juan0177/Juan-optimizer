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

describe('Danica', () => {
  it('her third normal hits twice (game data: ×2)', () => {
    const sim = run('Danica N3 W1', ['Danica'])
    const third = sim.hits.filter((h) => h.path.join('.') === 'normal.2')
    expect(third).toHaveLength(2)
    expect(third[0].t).toBe(third[1].t)
  })

  it('uses Anchor normals on-field, builds Excitement, then On-Field Skill E2 enters Battle Maid and skips a stage', () => {
    const sim = run('Danica E N4 E N1 W1', ['Danica'])
    expect(sim.warnings).toEqual([])
    const anchor = sim.hits.filter((h) => h.path[1]?.startsWith('anchor'))
    expect(anchor.map((h) => h.path[1])).toEqual([
      'anchor0',
      'anchor1',
      'anchor2',
      'anchor2',
      'anchor3',
      // after one On-Field Skill E2 the next round starts at the second stage
      'anchor1',
    ])
    expect(anchor.every((h) => h.element === 'electro')).toBe(true)
    const e2 = sim.hits.find((h) => h.path.join('.') === 'skill.onFieldDmg')!
    expect(e2.tag).toBe('directStellarConduct')
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Danica.maidForm' && w.value === 'battle'
      )
    ).toBe(true)
    // the second E is On-Field Skill E2, not a cooldown wait
    expect(sim.notes.some((n) => n.includes('Waited'))).toBe(false)
  })

  it('C2 Toast: Stellar-Conduct damage consumes stacks for its +ATK damage', () => {
    const sim = run(
      'Kaeya E -> Danica E -> Mitya E -> Danica Q W3',
      ['Danica', 'Mitya', 'Kaeya', 'Bennett'],
      { Danica: 2 }
    )
    const sc = rotationAttacks(sim).Danica!.filter((a) =>
      a.path[1]?.endsWith('ScDmg')
    )
    expect(sc.length).toBeGreaterThan(0)
    expect(
      sc.every((a) =>
        a.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
      )
    ).toBe(true)
    const none = run('Kaeya E -> Danica E -> Mitya E -> Danica Q W3', [
      'Danica',
      'Mitya',
      'Kaeya',
      'Bennett',
    ])
    expect(
      rotationAttacks(none).Danica!.some((a) =>
        a.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
      )
    ).toBe(false)
  })

  it('C2 Toast in Battle Maid consumes up to 2 stacks per Stellar-Conduct hit and has no 6-stack refund', () => {
    const sim = run('Danica E N4 E W1', ['Danica'], { Danica: 2 })
    const e2 = rotationAttacks(sim).Danica!.find(
      (a) => a.path.join('.') === 'skill.onFieldDmg'
    )!
    expect(e2.states).toContainEqual({
      owner: 'Danica',
      path: ['Danica', 'c2SelfToast'],
      value: '2',
    })
    expect(
      e2.states?.some((s) => s.path[1] === 'c2Toast' && s.value === 'on')
    ).toBe(false)
  })

  it('uses 18 s Burst CD and 16 s Will to Protect CD', () => {
    const burst = run('Danica Q Q', ['Danica'])
    const qs = burst.actions.filter(
      (a) => a.characterKey === 'Danica' && a.text === 'Q'
    )
    expect(qs[1].start - qs[0].start).toBeGreaterThanOrEqual(1080)

    const early = run(
      'Danica E -> Kaeya E -> Lisa E -> Danica N1 W6 -> Kaeya E -> Lisa E -> Danica N1',
      ['Danica', 'Kaeya', 'Lisa']
    )
    expect(
      early.actions.filter(
        (a) => a.characterKey === 'Danica' && a.text === 'Entry'
      )
    ).toHaveLength(1)

    const ready = run(
      'Danica E -> Kaeya E -> Lisa E -> Danica N1 W16 -> Kaeya E -> Lisa E -> Danica N1',
      ['Danica', 'Kaeya', 'Lisa']
    )
    const entries = ready.actions.filter(
      (a) => a.characterKey === 'Danica' && a.text === 'Entry'
    )
    expect(entries).toHaveLength(2)
    expect(entries[1].start - entries[0].start).toBeGreaterThanOrEqual(960)
  })

  it('sheet reflects 7.2.52 Burst ATK ratio/cap, C1 100%, C2 Cleaning Decree 150% without double-counting Toast, and C6 15% Elevation', () => {
    const setup = (
      constellation: number,
      cond: Record<string, string>,
      atkBonus = 0
    ) => {
      const db = new ArtCharDatabase(1, new SandboxStorage({}))
      db.chars.set('Danica', {
        key: 'Danica',
        level: 90,
        ascension: 6,
        talent: { auto: 10, skill: 10, burst: 10 },
        constellation,
      })
      db.chars.set('Bennett', {
        key: 'Bennett',
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
      db.weapons.new({
        key: 'WasterGreatsword',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Danica',
        lock: false,
      })
      db.weapons.new({
        key: 'DullBlade',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Bennett',
        lock: false,
      })
      const dId = db.teamChars.new('Danica', {
        conditional: { Danica: cond },
        bonusStats: atkBonus ? { atk: atkBonus } : {},
      })
      const bId = db.teamChars.new('Bennett', {})
      const teamId = db.teams.new({
        loadoutData: [
          { teamCharId: dId },
          { teamCharId: bId },
        ] as LoadoutDatum[],
      })
      const ui = uiDataForTeam(
        getTeamDataWith(db, teamId, {})! as never,
        'F',
        'Danica'
      )
      return { danica: ui.Danica!.target, bennett: ui.Bennett!.target }
    }

    // Lv10 Royal Guard Burst ATK: 10% capped at 400 at C0; doubled (+100%) to 20% / 800 at C1
    const c0 = setup(
      0,
      { maidForm: 'defense', burstEnhanced: 'on', anchor: 'on' },
      5000
    )
    const baseAtk = setup(0, {}, 0).bennett.getDisplay()['basic']['atk'].value
    expect(c0.bennett.getDisplay()['basic']['atk'].value - baseAtk).toBeCloseTo(
      400,
      1
    )

    const c1 = setup(
      1,
      { maidForm: 'defense', burstEnhanced: 'on', anchor: 'on' },
      5000
    )
    expect(c1.bennett.getDisplay()['basic']['atk'].value - baseAtk).toBeCloseTo(
      800,
      1
    )

    // C6 Elevation = 15% when Storm Anchor is present
    const c6 = setup(6, { anchor: 'on' })
    expect(
      c6.bennett.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0.15, 6)

    // C2 Cleaning Decree = 1.5 * base onFieldDmg; c2Toast + c2SelfToast does not double-count +80% ATK
    const baseSelf = setup(2, {
      maidForm: 'battle',
      a0StellarRadianceSc: 'on',
    }).danica.getDisplay()
    expect(
      baseSelf['skill']['decreeDmg'].value /
        baseSelf['skill']['onFieldDmg'].value
    ).toBeCloseTo(1.5, 5)

    const both = setup(2, {
      maidForm: 'battle',
      c2Toast: 'on',
      c2SelfToast: '2',
      a0StellarRadianceSc: 'on',
    })
    const selfOnly = setup(2, {
      maidForm: 'battle',
      c2SelfToast: '2',
      a0StellarRadianceSc: 'on',
    })
    const dBoth = both.danica.getDisplay()
    const dSelf = selfOnly.danica.getDisplay()
    expect(dBoth['skill']['onFieldDmg'].value).toBeCloseTo(
      dSelf['skill']['onFieldDmg'].value,
      4
    )
    expect(dBoth['burst']['hit1ScDmg'].value).toBeCloseTo(
      dSelf['burst']['hit1ScDmg'].value,
      4
    )
    expect(
      dBoth['skill']['decreeDmg'].value - dBoth['skill']['onFieldDmg'].value
    ).toBeCloseTo(0.5 * baseSelf['skill']['onFieldDmg'].value, 4)
  })
})
