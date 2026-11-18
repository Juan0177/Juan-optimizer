import type { SimHit } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import {
  applicationsOf,
  fightTeamOf,
  PARTY_HEALERS,
  resFromRatio,
  stellarAttack,
  wardTimeOf,
} from './fightTeam'

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
      // a 2U Electro hit with no ICD, and a 1.5U one (2U: whole units)
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
  it('are Stellar Glimmer DMG as the kits deal it, of any element', () => {
    const attack = (path: string[]) =>
      ({ path, hits: 1, hitMode: 'avgHit' }) as never
    const yes = [
      ['Mitya', ['skill', 'steadyDetonateDmg']],
      ['YaeMiko', ['passive1', 'stellarDmg']],
      ['Cyno', ['passive1', 'boltStellarDmg']],
      ['Odette', ['skill', 'plumeStellarconductDmg']],
      ['Wriothesley', ['passive1', 'hit3']],
    ] as const
    for (const [ck, path] of yes)
      expect(stellarAttack(ck as never, attack([...path]))).toBe(true)
    expect(stellarAttack('Mitya' as never, attack(['burst', 'dmg']))).toBe(
      false
    )
    expect(stellarAttack('Fischl', attack(['skill', 'press']))).toBe(false)
  })
})

describe('the Moongecko’s Anchor ward (9 layers of 100 durability)', () => {
  it('falls to Blunt hits’ poise (0.35 of it), at most a layer a hit, none in the 0.1 s after each layer', () => {
    // Navia's claymore hits, 100 poise each (35 durability): 3 a layer, every 0.2 s
    const navia = (t: number) =>
      hit(t, {
        characterKey: 'Navia' as never,
        tag: 'normal',
        element: 'physical',
        poiseDamage: 100,
      })
    const hits = Array.from({ length: 40 }, (_, i) => navia(i * 12))
    // 27 hits: the last at 26 × 0.2 s (none lost: each comes 0.2 s after the one before)
    expect(wardTimeOf(hits, 40 * 12)).toBeCloseTo(26 * 0.2, 9)
    // one huge hit takes a layer, not more (its excess is lost)
    const big = [
      hit(0, {
        characterKey: 'Zhongli' as never,
        element: 'geo',
        poiseDamage: 2000,
      }),
    ]
    // (looped every 1 s: the 9th layer on the 9th loop)
    expect(wardTimeOf(big, 60)).toBeCloseTo(8, 9)
  })
  it('counts other melee hits at 0.05 of their poise, and nothing else: a catalyst’s hits never break it', () => {
    const sword = (t: number) =>
      hit(t, {
        characterKey: 'Furina' as never,
        tag: 'normal',
        element: 'physical',
      })
    // (Furina's normal attacks: 50 poise assumed, 2.5 durability each: 360 for the ward)
    const t = wardTimeOf(
      Array.from({ length: 10 }, (_, i) => sword(i * 6)),
      60
    )
    expect(t).toBeGreaterThan(30)
    // (a catalyst's Electro skill hits)
    expect(wardTimeOf([hit(0, {}), hit(30, {})], 60)).toBe(
      Number.POSITIVE_INFINITY
    )
  })
  it('times the kept rotation from its own start (its hits’ times are the whole play’s)', () => {
    const navia = (t: number) =>
      hit(t, {
        characterKey: 'Navia' as never,
        tag: 'normal',
        element: 'physical',
        poiseDamage: 1000,
      })
    // (the kept rotation: frames 600–660, after warm-up rotations)
    expect(wardTimeOf([navia(600)], 60, 600)).toBeCloseTo(8, 9)
  })
  it('comes with the written rotation’s applications', () => {
    const hits = [
      hit(0, {
        characterKey: 'Navia' as never,
        tag: 'normal',
        element: 'physical',
        poiseDamage: 1000,
      }),
    ]
    // (a layer a loop of 1 s)
    expect(applicationsOf(hits, 60).wardSeconds).toBeCloseTo(8, 9)
  })
})

describe('the team in the Moongecko’s fight', () => {
  const base = {
    members: ['Bennett', 'Navia'] as never[],
    attacks: {
      Bennett: [{ path: ['burst', 'dmg'], hits: 1 }],
      Navia: [{ path: ['skill', 'dmg'], hits: 1 }],
    } as never,
    teamData: {} as never,
    rotationTime: 10,
    enemyOverride: {},
  }
  it('has a healer when a member’s kit heals the party', () => {
    expect(PARTY_HEALERS.has('Bennett')).toBe(true)
    expect(PARTY_HEALERS.has('HuTao')).toBe(false)
  })
  it('takes its DPS in the cocoon and Disentangled as their evaluations change it, element by element', () => {
    const evaluation = (bennett: number, navia: number) =>
      ({
        total: bennett + navia,
        members: {},
        unmet: {},
        attacks: { Bennett: [bennett], Navia: [navia] },
      }) as never
    const team = fightTeamOf({
      ...base,
      // (the damage shown: a run's, 1000 + 3000 a rotation)
      evaluation: evaluation(1000, 3000),
      cocoon: {
        // (evaluated again with the page's settings: other figures, same changes)
        base: evaluation(2000, 2000),
        cocooned: evaluation(1000, 1000),
        disentangled: evaluation(3000, 4000),
      },
    })!
    expect(team.healer).toBe(true)
    const total = (d: Partial<Record<string, number>> | undefined) =>
      Object.values(d ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0)
    // (Bennett's and Navia's attacks: their elements unknown here, physical)
    expect(total(team.dps)).toBeCloseTo(400, 9)
    expect(total(team.cocooned)).toBeCloseTo(400 * 0.5, 9)
    expect(total(team.disentangled)).toBeCloseTo(400 * 1.75, 9)
  })
})

describe('the enemy’s RES under the rotation’s own shred', () => {
  it('is solved from how much the damage rises with every RES 60% lower', () => {
    // (70% RES, 50% shred from the rotation's buffs: 20% effective; 60% lower, -40%: 1.2 / 0.8)
    expect(resFromRatio(1.2 / 0.8, 0.7)).toBeCloseTo(0.2, 2)
    // (no shred: 70% to 10%, 0.9 / 0.3)
    expect(resFromRatio(0.9 / 0.3, 0.7)).toBeCloseTo(0.7, 2)
    // (a shielded boss's 135% RES with no shred: the bent side, its own)
    expect(
      resFromRatio(1 / (4 * 0.75 + 1) / (1 / (4 * 1.35 + 1)), 1.35)
    ).toBeCloseTo(1.35, 2)
  })
})
