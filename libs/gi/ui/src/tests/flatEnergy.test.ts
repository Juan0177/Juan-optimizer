import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  energyFromRotation,
} from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {},
  options: { repeats?: number; keep?: 'all' | 'last2' } = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations,
    repeats: options.repeats ?? 1,
    keep: options.keep ?? 'all',
  })
/** The flat Energy markers: [frame, member, amount, recipient] */
const marks = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  run(text, members, constellations)
    .hits.filter((h) => h.path[0] === '_marker' && h.path[1] === 'flatEnergy')
    .map((h) => [h.t, h.characterKey, Number(h.path[2]), h.path[3] ?? ''])
/** Each member's flat Energy a rotation in the ER calculator (2 kept of 4) */
const flat = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) => {
  const members_ = energyFromRotation(
    run(text, members, constellations, { repeats: 4, keep: 'last2' }),
    members,
    2,
    constellations
  ).members
  return Object.fromEntries(
    members.map((k) => [k, members_[k]?.flatEnergy ?? 0])
  )
}
const sum = (m: ReturnType<typeof marks>) =>
  m.reduce((n, [, , amount]) => n + (amount as number), 0)

describe('flat Energy from constellations and passives', () => {
  it('Mitya C1: 10 as a Gradient Beacon is created, once per 8 s', () => {
    const members: CharacterKey[] = ['Mitya']
    expect(marks('Mitya E W10', members, { Mitya: 0 })).toEqual([])
    const c1 = marks('Mitya E W3 E W3 E W10', members, { Mitya: 1 })
    expect(c1.length).toBeGreaterThan(0)
    expect(c1.every(([, k, amount]) => k === 'Mitya' && amount === 10)).toBe(
      true
    )
    const at = c1.map(([t]) => t as number)
    expect(at.every((t, i) => i === 0 || t - at[i - 1] >= 480)).toBe(true)
  })

  it('Yae Miko C1: 8 per Tenko Thunderbolt; C4: 8 per lightning hit, once per 5 s', () => {
    const members: CharacterKey[] = ['YaeMiko']
    const text = 'YaeMiko E E E W6 Q W10'
    const c1 = marks(text, members, { YaeMiko: 1 })
    expect(c1.map(([, , amount]) => amount)).toEqual([8, 8, 8])
    expect(marks(text, members, { YaeMiko: 0 })).toEqual([])
    const c4 = marks('YaeMiko E E E W20', members, { YaeMiko: 4 })
    const at = c4.map(([t]) => t as number)
    expect(at.length).toBeGreaterThanOrEqual(4)
    expect(at.every((t, i) => i === 0 || t - at[i - 1] >= 300)).toBe(true)
  })

  it('Venti A4: 15 to the party’s members of the absorbed element as the Burst ends', () => {
    const members: CharacterKey[] = ['Venti', 'Xiangling', 'Bennett', 'Fischl']
    const m = marks('Xiangling E -> Venti Q W12', members)
    expect(m.map(([, k, amount, to]) => [k, amount, to])).toEqual([
      ['Venti', 15, 'Xiangling'],
      ['Venti', 15, 'Bennett'],
    ])
    expect(m[0][0]).toBeGreaterThanOrEqual(573)
    const energy = flat(
      'Xiangling E -> Venti Q -> Xiangling Q -> Bennett E W8',
      members
    )
    expect(energy.Xiangling).toBeCloseTo(15)
    expect(energy.Bennett).toBeCloseTo(15)
    expect(energy.Fischl).toBe(0)
  })

  it('Furina C4: 4 as the Salon hits, once per 5 s', () => {
    const m = marks('Furina E W20', ['Furina'], { Furina: 4 })
    const at = m.map(([t]) => t as number)
    expect(m.every(([, , amount]) => amount === 4)).toBe(true)
    expect(at.length).toBeGreaterThanOrEqual(3)
    expect(at.every((t, i) => i === 0 || t - at[i - 1] >= 300)).toBe(true)
    expect(marks('Furina E W20', ['Furina'], { Furina: 3 })).toEqual([])
  })

  it('Xingqiu C6: 3 with each 5-sword wave', () => {
    const members: CharacterKey[] = ['Xingqiu', 'Xiangling']
    const text =
      'Xingqiu Q -> Xiangling N1 W1.1 N1 W1.1 N1 W1.1 N1 W1.1 N1 W1.1 N1'
    expect(sum(marks(text, members, { Xingqiu: 6 }))).toBe(6)
    expect(marks(text, members, { Xingqiu: 5 })).toEqual([])
  })

  it('Kaeya C6 and Thoma C4: 15 back with each Burst', () => {
    expect(marks('Kaeya Q W3', ['Kaeya'], { Kaeya: 6 })).toEqual([
      [52, 'Kaeya', 15, ''],
    ])
    expect(marks('Kaeya Q W3', ['Kaeya'], { Kaeya: 5 })).toEqual([])
    expect(marks('Thoma Q W3', ['Thoma'], { Thoma: 4 })).toEqual([
      [8, 'Thoma', 15, ''],
    ])
  })

  it('Klee A4: 2 to the party by a charged attack’s CRIT chance; C6: 3 to the others every 3 s', () => {
    const members: CharacterKey[] = ['Klee', 'Bennett']
    const a4 = marks('Klee CA W1 CA W2', members, { Klee: 0 })
    expect(a4.map(([, , amount, to]) => [amount, to])).toEqual([
      [1.2, 'team'],
      [1.2, 'team'],
    ])
    const c6 = marks('Klee Q W12', members, { Klee: 6 }).filter(
      ([, , , to]) => to === 'others'
    )
    expect(c6.map(([, , amount]) => amount)).toEqual([3, 3, 3])
    expect(marks('Klee Q W2 -> Bennett E W10', members, { Klee: 6 })).toEqual(
      []
    )
  })

  it('Columbina C1: 6 to the active member on a Lunar-Charged Gravity Interference; C4: 4 on each', () => {
    const at = (cons: number) =>
      marks('Columbina E W2', ['Columbina'], { Columbina: cons }).map(
        ([, , amount, to]) => [amount, to]
      )
    expect(at(0)).toEqual([])
    expect(at(1)).toEqual([[6, 'active']])
    expect(at(4)).toEqual([
      [6, 'active'],
      [4, ''],
    ])
  })

  it('Chevreuse C1: 6 to the active member on its Overloaded, Pyro and Electro only, once per 10 s', () => {
    const members: CharacterKey[] = ['Chevreuse', 'Fischl', 'Xiangling']
    const text = 'Fischl E -> Xiangling E W1 N1 W1 N1 W1 N1 W12 N1'
    const m = marks(text, members, { Chevreuse: 1 })
    expect(m.length).toBeGreaterThan(0)
    expect(
      m.every(([, , amount, to]) => amount === 6 && to !== 'Chevreuse')
    ).toBe(true)
    expect(
      marks(text, ['Chevreuse', 'Fischl', 'Xiangling', 'Furina'], {
        Chevreuse: 1,
      })
    ).toEqual([])
  })

  it('Ororon A4: 3 to the active member’s normal attacks after the Spirit Orb hits; C4: 8 with the Burst', () => {
    const members: CharacterKey[] = ['Ororon', 'Fischl']
    const m = marks(
      'Ororon E -> Fischl N1 W1.1 N1 W1.1 N1 W1.1 N1 W1.1 N1',
      members
    )
    expect(m.map(([, , amount, to]) => [amount, to])).toEqual([
      [3, 'Fischl'],
      [3, 'Fischl'],
      [3, 'Fischl'],
    ])
    expect(
      marks('Ororon Q W3', ['Ororon'], { Ororon: 4 }).map(([, , a]) => a)
    ).toEqual([8])
  })

  it('Escoffier C4: up to 7 Rehab Diet triggers a Burst, by CRIT chance', () => {
    const m = marks('Escoffier Q W16', ['Escoffier'], { Escoffier: 4 })
    expect(sum(m)).toBeCloseTo(2 * 7)
    expect(marks('Escoffier Q W16', ['Escoffier'], { Escoffier: 3 })).toEqual(
      []
    )
  })

  it('Lauma C4: 4 as the Sanctuary hits, once per 5 s', () => {
    const m = marks('Lauma E W16', ['Lauma'], { Lauma: 4 })
    expect(m.every(([, , amount]) => amount === 4)).toBe(true)
    expect(m.length).toBe(3)
  })

  it('Kachina C1: 3 on the party’s Crystallize, once per 5 s', () => {
    const members: CharacterKey[] = ['Kachina', 'Xiangling']
    const m = marks('Xiangling E -> Kachina E W3 Q W8', members, { Kachina: 1 })
    expect(m.length).toBeGreaterThan(0)
    expect(m.every(([, , amount]) => amount === 3)).toBe(true)
  })

  it('Tartaglia: 20 back with a ranged Burst only', () => {
    expect(marks('Tartaglia Q W3', ['Tartaglia'])).toEqual([
      [4, 'Tartaglia', 20, ''],
    ])
    expect(marks('Tartaglia E Q W3', ['Tartaglia'])).toEqual([])
  })

  // [label, members, rotation, constellations, the markers' amounts]
  const cases: [
    string,
    CharacterKey[],
    string,
    Partial<Record<CharacterKey, number>>,
    number[],
  ][] = [
    [
      'Arlecchino C4',
      ['Arlecchino'],
      'Arlecchino E W2 CA W1',
      { Arlecchino: 4 },
      [15],
    ],
    ['Navia C1', ['Navia'], 'Navia E W1', { Navia: 1 }, []],
    [
      'Arataki Itto C2',
      ['AratakiItto', 'Zhongli'],
      'AratakiItto Q W2',
      { AratakiItto: 2 },
      [12],
    ],
    ['Ganyu C1', ['Ganyu'], 'Ganyu CA W1', { Ganyu: 1 }, [2]],
    ['Faruzan C4', ['Faruzan'], 'Faruzan E CA W2', { Faruzan: 4 }, [2]],
    [
      'Chasca C4',
      ['Chasca', 'Bennett', 'Furina'],
      'Chasca Q W3',
      { Chasca: 4 },
      [1.5, 1.5, 1.5, 1.5],
    ],
    ['Varesa C6', ['Varesa'], 'Varesa E W1 P W2', { Varesa: 6 }, [30, 11.5]],
    ['Varesa C2 Kablam', ['Varesa'], 'Varesa E W1 P Q W2', { Varesa: 2 }, [11.5, 11.5]],
    ['Lyney A1', ['Lyney'], 'Lyney CA W8', {}, [3]],
    [
      'Albedo C1',
      ['Albedo'],
      'Albedo E N1 W2.1 N1 W1',
      { Albedo: 1 },
      [1.2, 1.2],
    ],
    ['Lisa C1', ['Lisa'], 'Lisa hE W3', { Lisa: 1 }, [2]],
    ['Layla C2', ['Layla'], 'Layla E W12', { Layla: 2 }, [1, 1, 1, 1]],
    ['Gaming C4', ['Gaming'], 'Gaming E P W1', { Gaming: 4 }, [2]],
    ['Barbara C4', ['Barbara'], 'Barbara CA W1', { Barbara: 4 }, [1]],
    ['Thoma C4 needs C4', ['Thoma'], 'Thoma Q W3', { Thoma: 3 }, []],
    ['Nilou C4', ['Nilou'], 'Nilou E N3 W1', { Nilou: 4 }, [15]],
    ['Ifa C1', ['Ifa'], 'Ifa N1 W1 N1 W1', { Ifa: 1 }, [6]],
    ['Sethos', ['Sethos', 'Xingqiu'], 'Xingqiu E -> Sethos E W1', {}, [12]],
    [
      'Dori Burst',
      ['Dori', 'Fischl'],
      'Dori Q -> Fischl W13',
      {},
      [2.5, 2.5, 2.5, 2.5, 2.5, 2.5],
    ],
    [
      'Traveler (Dendro) C1',
      ['TravelerDendro'],
      'TravelerDendro E W1',
      { TravelerDendro: 1 },
      [3.5],
    ],
    [
      'Traveler (Geo) C4',
      ['TravelerGeo'],
      'TravelerGeo Q W3',
      { TravelerGeo: 4 },
      [5],
    ],
  ]
  it.each(cases)('%s', (_, members, text, constellations, amounts) => {
    expect(marks(text, members, constellations).map(([, , a]) => a)).toEqual(
      amounts
    )
  })

  it('Traveler (Electro): the Amulet and each Falling Thunder restore Energy to the active member', () => {
    const members: CharacterKey[] = ['TravelerElectro', 'Fischl']
    const amulet = marks('TravelerElectro E W3', members)
    expect(amulet.map(([, , a, to]) => [a, to])).toEqual([[4, 'active']])
    const thunder = marks(
      'TravelerElectro Q -> Fischl N1 W0.6 N1 W0.6 N1 W0.6 N1',
      members
    )
    expect(thunder.length).toBeGreaterThan(0)
    expect(thunder.every(([, , a, to]) => a === 1 && to === 'active')).toBe(
      true
    )
  })

  it('Scroll of the Hero of Cinder City (2 pieces): 6 Energy on each Nightsoul Burst', () => {
    const members: CharacterKey[] = ['Mavuika', 'Citlali']
    const energy = energyFromRotation(
      run(
        'Citlali E -> Mavuika E W10',
        members,
        {},
        { repeats: 4, keep: 'last2' }
      ),
      members,
      2
    )
    expect(energy.nightsoulBursts).toBeGreaterThan(0)
  })

  it('Raiden: Musou Isshin restores Energy to the whole party, 5 times, growing with her ER', () => {
    const members: CharacterKey[] = ['RaidenShogun', 'Bennett']
    const m = marks(
      'RaidenShogun Q N1 W1 N1 W1 N1 W1 N1 W1 N1 W1 N1 W1 N1',
      members
    )
    expect(m.map(([, k, a, to]) => [k, a, to])).toEqual(
      Array(5).fill(['RaidenShogun', 2.5, 'team'])
    )
    const filled = energyFromRotation(
      run(
        'RaidenShogun Q N1 W1 N1 W1 N1 W1 N1 W1 N1 W5',
        members,
        {},
        {
          repeats: 4,
          keep: 'last2',
        }
      ),
      members,
      2
    ).members
    expect(filled.Bennett?.scaledEnergy).toEqual({ RaidenShogun: 12.5 })
    expect(filled.RaidenShogun?.scaledEnergy).toEqual({ RaidenShogun: 12.5 })
  })

  it('Kujou Sara A4: 1.2 to the party per Ambush, once per 3 s, growing with her ER', () => {
    const members: CharacterKey[] = ['KujouSara', 'RaidenShogun']
    const m = marks('KujouSara E CA W4', members)
    expect(m.map(([, k, a, to]) => [k, a, to])).toEqual([
      ['KujouSara', 1.2, 'team'],
    ])
  })

  it('the calculator: Raiden’s own refund grows with her ER, a teammate’s at the ER she needs', () => {
    const keys: CharacterKey[] = ['RaidenShogun', 'Bennett']
    const settings = defaultEnergyCalculator(keys, 20)
    const without = calculateEnergyRecharge(keys, settings)
    const refund = { RaidenShogun: 12.5 }
    const withRefund = calculateEnergyRecharge(keys, {
      ...settings,
      members: {
        RaidenShogun: {
          ...settings.members.RaidenShogun!,
          scaledEnergy: refund,
        },
        Bennett: { ...settings.members.Bennett!, scaledEnergy: refund },
      },
    })
    const raiden = withRefund.members.RaidenShogun!
    // her own: 0.4 of it flat, 0.6 in step with her ER (with the particles)
    expect(raiden.sources.skills).toBeCloseTo(5)
    expect(raiden.particleEnergy).toBeCloseTo(
      without.members.RaidenShogun!.particleEnergy + 7.5
    )
    expect(withRefund.targets.RaidenShogun!).toBeLessThan(
      without.targets.RaidenShogun!
    )
    // Bennett's: at the ER Raiden needs
    const er = Math.max(1, withRefund.targets.RaidenShogun! / 100)
    expect(withRefund.members.Bennett!.sources.skills).toBeCloseTo(
      12.5 * (0.4 + 0.6 * er),
      1
    )
  })

  it('the calculator: Scroll of the Hero of Cinder City’s 2 pieces give 6 per Nightsoul Burst', () => {
    const keys: CharacterKey[] = ['Mavuika', 'Citlali']
    const settings = {
      ...defaultEnergyCalculator(keys, 20),
      nightsoulBursts: 1,
    }
    const sets = { Citlali: { ScrollOfTheHeroOfCinderCity: 4 } }
    const worn = calculateEnergyRecharge(keys, settings, {}, {}, sets)
    const not = calculateEnergyRecharge(keys, settings, {}, {}, {})
    expect(
      worn.members.Citlali!.sources.gear - not.members.Citlali!.sources.gear
    ).toBe(6)
    expect(worn.members.Mavuika!.sources.gear).toBe(
      not.members.Mavuika!.sources.gear
    )
  })

  it('energy weapons: Beyond the Chrysalis, The Dockhand’s Assistant and Portable Power Saw triggers come from the rotation', () => {
    const triggers = (
      members: CharacterKey[],
      text: string,
      gear: Partial<Record<CharacterKey, { weapon: string }>>
    ) =>
      energyFromRotation(
        simulateRotation({
          rotation: parseRotation(
            text,
            members.map((characterKey) => ({
              characterKey,
              name: characterKey,
            }))
          ),
          members,
          elements: Object.fromEntries(
            members.map((k) => [k, getCharEle(k)])
          ) as never,
          constellations: {},
          gear: gear as never,
          repeats: 4,
          keep: 'last2',
        }),
        members,
        2
      ).members
    // the third of each Skill or Burst use (Winds of Plenty)
    const chrysalis = triggers(['Bennett'], 'Bennett E W5 E W5 E W5', {
      Bennett: { weapon: 'BeyondTheChrysalis' },
    })
    expect(chrysalis.Bennett?.weaponTriggers?.BeyondTheChrysalis).toBe(1)
    // healed three times, then a Skill: one trigger
    const members: CharacterKey[] = ['Xingqiu', 'Bennett']
    const dockhand = triggers(members, 'Bennett Q W3 -> Xingqiu E W14', {
      Xingqiu: { weapon: 'TheDockhandsAssistant' },
    })
    expect(dockhand.Xingqiu?.weaponTriggers?.TheDockhandsAssistant).toBe(1)
  })
})
