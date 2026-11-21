import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { RotationCalculation } from '../util/teamOpt/rotation/types'

const calculate: RotationCalculation = (_character, path) => {
  if (path.join('.') === 'total.hp') return 20000
  if (path[0] === 'total') return 0
  return 3000
}

function run(text: string, members: CharacterKey[], cons = 6) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: { Wriothesley: cons },
    repeats: 1,
    keep: 'all',
    calculate,
  })
}

describe('Wriothesley C6 in Radiance: Stellar-Conduct', () => {
  it('Repelling Fist 3 gets the C6 CRIT like 5 (dump: SSC_ATK03 is in its tags)', () => {
    const fist = (constellation: number) => {
      const db = new ArtCharDatabase(1, new SandboxStorage({}))
      db.chars.set('Wriothesley', {
        key: 'Wriothesley',
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation,
      })
      db.weapons.new({
        key: 'ApprenticesNotes',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Wriothesley',
        lock: false,
      })
      const id = db.teamChars.new('Wriothesley', {
        conditional: {
          Wriothesley: { lockRevelation: 'on', lockStellarRadianceSc: 'on' },
        },
      })
      const teamId = db.teams.new({
        loadoutData: [{ teamCharId: id }] as LoadoutDatum[],
      })
      const display = uiDataForTeam(
        getTeamDataWith(db, teamId, {})! as never,
        'F',
        'Wriothesley'
      ).Wriothesley!.target.getDisplay()['passive1']
      return { hit3: display['hit3'].value, hit5: display['hit5'].value }
    }
    const c5 = fist(5)
    const c6 = fist(6)
    expect(c6.hit5 / c5.hit5).toBeGreaterThan(1.05)
    expect(c6.hit3 / c5.hit3).toBeCloseTo(c6.hit5 / c5.hit5, 9)
  })

  it('C4 in radiance: his normal attacks 20% faster with no heal needed (dump: _Is_In_StarSCMode)', () => {
    const n5Starts = (cons: number) =>
      run('Mitya E -> Wriothesley E N5 N5 N5', ['Mitya', 'Wriothesley'], cons)
        .actions.filter((a) => a.characterKey === 'Wriothesley' && a.text === 'N5')
        .map((a) => a.start)
    const c3 = n5Starts(3)
    const c4 = n5Starts(4)
    expect(c4[2] - c4[1]).toBeLessThan(c3[2] - c3[1])
    expect((c3[2] - c3[1]) / (c4[2] - c4[1])).toBeGreaterThan(1.08)
  })

  it('every Luster makes its C6 icicle, after Icefang Rush ends too (dump: no Chilling Penalty check)', () => {
    const sim = run(
      'Mitya E -> Wriothesley E N5 N5 N5 W420 -> Mitya E -> Wriothesley N1 CA',
      ['Mitya', 'Wriothesley']
    )
    const lusters = sim.hits.filter(
      (h) => h.path.join('.') === 'passive1.lusterDmg'
    )
    const icicles = sim.hits.filter(
      (h) => h.path.join('.') === 'constellation6.lusterDmg'
    )
    expect(lusters.length).toBeGreaterThan(0)
    expect(icicles.map((h) => h.t)).toEqual(lusters.map((h) => h.t))
    expect(
      run(
        'Mitya E -> Wriothesley E N5 N5 N5 W420 -> Mitya E -> Wriothesley N1 CA',
        ['Mitya', 'Wriothesley'],
        5
      ).hits.some((h) => h.path[0] === 'constellation6')
    ).toBe(false)
  })
})
