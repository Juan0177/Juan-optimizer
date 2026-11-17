import type { SimHit } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { applicationsOf, electroStellarAttack } from './fightTeam'

const hit = (t: number, over: Partial<SimHit>): SimHit => ({
  t,
  characterKey: 'Mitya' as never,
  path: ['skill', 'dmg'],
  tag: 'skill',
  element: 'electro',
  ...over,
})

describe('a played rotation’s hits, per second', () => {
  it('sorts its Electro hits by what they take off Wavebinder’s Courage', () => {
    const hits: SimHit[] = [
      // Stellar Glimmer Electro DMG (Mitya's Prism Shatter, 2 prisms)
      hit(0, { tag: 'directStellarConduct', weight: 2 }),
      // a 2U Electro hit with no ICD: 2 units; a 1.5U one counts as 2U (whole steps)
      hit(10, { applies: true, durability: 50, icd: 'none' }),
      hit(20, { applies: true, durability: 37.5, icd: 'none' }),
      // an Electro hit applying nothing
      hit(30, {}),
      // Cryo Stellar-Conduct DMG (Odette's): no Courage
      hit(40, { element: 'cryo', tag: 'directStellarConduct' }),
      // a marker: not a hit
      hit(50, { path: ['_marker', 'hpLoss'] }),
    ]
    const { gauge, electroHits } = applicationsOf(hits, 120)
    // (over 2 s)
    expect(electroHits).toEqual({ stellar: 1, units: 2, plain: 0.5 })
    expect(gauge.electro).toBeCloseTo((2 + 1.5) / 2, 9)
  })
  it('counts a hit its ICD keeps from applying as one without', () => {
    // the standard ICD: the 1st and 4th of a tag's hits apply (in 2.5 s)
    const hits = [0, 6, 12, 18].map((t) =>
      hit(t, { applies: true, durability: 25, icd: 'skill' })
    )
    const { electroHits } = applicationsOf(hits, 60)
    expect(electroHits.units).toBe(2)
    expect(electroHits.plain).toBe(2)
  })
})

describe('attacks entered by hand', () => {
  it('are Stellar Glimmer Electro DMG as the kits deal it', () => {
    const attack = (path: string[]) =>
      ({ path, hits: 1, hitMode: 'avgHit' }) as never
    expect(
      electroStellarAttack(
        'Mitya' as never,
        attack(['skill', 'steadyDetonateDmg'])
      )
    ).toBe(true)
    expect(
      electroStellarAttack('Mitya' as never, attack(['burst', 'dmg']))
    ).toBe(false)
    expect(
      electroStellarAttack('YaeMiko', attack(['passive1', 'stellarDmg']))
    ).toBe(true)
    expect(electroStellarAttack('Fischl', attack(['skill', 'press']))).toBe(
      false
    )
  })
})
