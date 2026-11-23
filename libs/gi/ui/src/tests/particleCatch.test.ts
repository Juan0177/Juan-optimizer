/**
 * Who catches a member's particles (gcsim/kqmsim: they give energy when they arrive,
 * ParticleDelay after the hit that makes them, 100 frames or Bennett's 80; the member on the
 * field then gets all of it, the others 60% in a party of four). One E then a quick swap feeds the
 * member swapped in. The ER calculator counts each catcher's share as the rotation played them,
 * not only the main catcher: a member whose particles go to two others caught none of them.
 */
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
} from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  energyFromRotation,
  favoniusFromRotation,
  withRotationEnergy,
} from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import type { SimulationResult } from '../util/teamOpt/rotation/simulate'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const team: CharacterKey[] = ['Xiangling', 'Bennett', 'Xingqiu', 'Sucrose']
const constellations = { Xiangling: 6, Bennett: 6, Xingqiu: 6, Sucrose: 6 }
const weapons: Partial<Record<CharacterKey, WeaponKey>> = {
  Xiangling: 'TheCatch',
  Bennett: 'MistsplitterReforged',
  Xingqiu: 'HarbingerOfDawn',
  Sucrose: 'ThrillingTalesOfDragonSlayers',
}
/** Played 4 times, the last 2 kept (the steady pace) */
const play = (
  text: string,
  options: { repeats?: number; keep?: 'last2' | 'all' } = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      team.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: team,
    elements: Object.fromEntries(team.map((m) => [m, getCharEle(m)])) as never,
    constellations,
    gear: Object.fromEntries(
      team.map((k) => [k, { weapon: weapons[k] }])
    ) as never,
    swapFrames: 12,
    repeats: options.repeats ?? 4,
    keep: options.keep ?? 'last2',
  })
/** The calculator filled in from a played rotation (`rotations` kept), no enemy particles */
const filled = (sim: SimulationResult, rotations = 2) =>
  withRotationEnergy(
    {
      ...defaultEnergyCalculator(
        team,
        sim.frames / 60 / rotations,
        'Bennett',
        constellations
      ),
      rng: 'average',
      enemyParticles: 0,
    },
    team,
    energyFromRotation(sim, team, rotations, constellations)
  )
/** Each member's energy a rotation from the members' Skill particles, at 100% ER */
const skillEnergy = (settings: TeamOptEnergyCalculator) => {
  const result = calculateEnergyRecharge(team, settings, weapons)
  expect(result.errors).toEqual([])
  return Object.fromEntries(
    team.map((k) => {
      const { own, team: others } = result.members[k]!.sources
      return [k, own + others]
    })
  ) as Record<CharacterKey, number>
}

// kqmsim: fixtures/particle-catch/quick.txt and split.txt (the four at C6, talents 9, these
// weapons, `options swap_delay=12`, the loop below in gcsim's words, 6 times); the particle energy
// that arrived in loops 3 and 4, per loop, the mean of 20 runs (Bennett's 2 or 3 particles a use):
// fixtures/particle-catch/steady-energy.mjs
const QUICK =
  'Bennett Q E -> Xingqiu E Q -> Sucrose E -> Xiangling Q E N3 -> Bennett E -> Xingqiu N2'
// (bennett burst, skill; xingqiu skill, burst; sucrose skill; xiangling burst, skill, attack:3;
// bennett skill; xingqiu attack:2)
const QUICK_KQMSIM = {
  Xiangling: 22.35,
  Bennett: 23.14,
  Xingqiu: 25.13,
  Sucrose: 15.31,
}
const SPLIT =
  'Bennett E -> Xingqiu E Q -> Bennett E -> Xiangling Q E N3 -> Bennett Q -> Sucrose E -> Xingqiu N2'
// (bennett skill; xingqiu skill, burst; bennett skill; xiangling burst, skill, attack:3; bennett
// burst; sucrose skill; xingqiu attack:2): kqmsim gives Bennett's to Xingqiu 2.2, Xiangling 2.2
const SPLIT_KQMSIM = {
  Xiangling: 23.16,
  Bennett: 20.52,
  Xingqiu: 26.12,
  Sucrose: 15.64,
}

describe('particle catchers as the rotation plays (kqmsim)', () => {
  it('one E then a quick swap: the member swapped in catches them all', () => {
    const settings = filled(play(QUICK))
    const m = settings.members
    expect(m.Bennett!.catchShares).toEqual({ Xingqiu: 100 })
    expect(m.Sucrose!.catchShares).toEqual({ Xiangling: 100 })
    // (Xingqiu stays on the field for his: his own)
    expect(m.Xingqiu!.catchShares).toEqual({ Xingqiu: 100 })
    // (the single catcher as before)
    expect(m.Bennett!.catchBy).toBe('Xingqiu')
    expect(m.Bennett!.funnelShare).toBe(100)
  })

  it('a member whose uses feed two others: each gets its share, it gets none on the field', () => {
    const m = filled(play(SPLIT)).members
    expect(m.Bennett!.catchShares).toEqual({ Xingqiu: 50, Xiangling: 50 })
    // (still filled in for the calculator's one-catcher view)
    expect(['Xingqiu', 'Xiangling']).toContain(m.Bennett!.catchBy)
    expect(m.Bennett!.funnelShare).toBe(50)
  })

  it('each member’s energy from Skill particles matches kqmsim within 5%', () => {
    for (const [text, kqmsim] of [
      [QUICK, QUICK_KQMSIM],
      [SPLIT, SPLIT_KQMSIM],
    ] as const) {
      const energy = skillEnergy(filled(play(text)))
      for (const k of team)
        expect(
          Math.abs(energy[k] / kqmsim[k] - 1),
          `${k}: ${text}`
        ).toBeLessThan(0.05)
    }
  })

  it('Guoba’s particles go to whoever is on the field as they land (kqmsim: none to Xiangling)', () => {
    const m = filled(play(QUICK)).members
    const guoba = m.Xiangling!.turretCatchShares!
    expect(guoba).toBeDefined()
    expect(guoba.Xiangling ?? 0).toBeLessThan(10)
    expect((guoba.Bennett ?? 0) + (guoba.Xingqiu ?? 0)).toBeGreaterThan(80)
  })

  it('particles that land after the rotation ends go to who starts the next one', () => {
    // (Sucrose's E last: the loop opens with a swap to Xiangling before they land)
    const text =
      'Xiangling Q E N3 -> Bennett Q E -> Xingqiu E Q N2 -> Sucrose E'
    expect(filled(play(text)).members.Sucrose!.catchShares).toEqual({
      Xiangling: 100,
    })
    // (the first rotation alone: the next one starts as it did)
    const first = play(text, { repeats: 1, keep: 'all' })
    expect(
      energyFromRotation(first, team, 1, constellations).members.Sucrose!
        .catchShares
    ).toEqual({ Xiangling: 100 })
  })
})

/** A calculator of the four with set inputs, no enemy particles, at the average */
const calculator = (
  members: Partial<Record<CharacterKey, Partial<TeamOptEnergyMember>>>
): TeamOptEnergyCalculator => {
  const base = defaultEnergyCalculator(team, 20, 'Bennett', constellations)
  return {
    ...base,
    rng: 'average',
    enemyParticles: 0,
    members: Object.fromEntries(
      team.map((k) => [
        k,
        {
          ...base.members[k]!,
          fieldTime: 25,
          favoniusProcs: 0,
          flatEnergy: 0,
          catchBy: k,
          funnelShare: 100,
          ...members[k],
        },
      ])
    ),
  }
}
/** What Bennett's own Skill particles give each member */
const fromBennett = (settings: TeamOptEnergyCalculator) => {
  const without = {
    ...settings,
    members: {
      ...settings.members,
      Bennett: { ...settings.members.Bennett!, skillUses: 0, secondaryUses: 0 },
    },
  }
  const all = skillEnergy(settings)
  const rest = skillEnergy(without)
  return Object.fromEntries(team.map((k) => [k, all[k] - rest[k]])) as Record<
    CharacterKey,
    number
  >
}

describe('the calculator counts each catcher’s share', () => {
  // (Bennett's Pyro particles: 3 energy each to a Pyro member, 1 to the others; all of them
  // caught by Sucrose on the field give her 1 each)
  const particles = fromBennett(
    calculator({ Bennett: { catchBy: 'Sucrose', funnelShare: 100 } })
  ).Sucrose
  it('caught on the field by each in its share, by nobody else', () => {
    const got = fromBennett(
      calculator({ Bennett: { catchShares: { Xingqiu: 50, Xiangling: 50 } } })
    )
    expect(got.Xingqiu).toBeCloseTo(particles * 1 * (0.6 + 0.4 * 0.5), 6)
    expect(got.Xiangling).toBeCloseTo(particles * 3 * (0.6 + 0.4 * 0.5), 6)
    // (Bennett caught none of his own: off the field for all of them)
    expect(got.Bennett).toBeCloseTo(particles * 3 * 0.6, 6)
    expect(got.Sucrose).toBeCloseTo(particles * 1 * 0.6, 6)
  })

  it('the same as one catcher and the share fed when that says it all', () => {
    const shares = fromBennett(
      calculator({ Bennett: { catchShares: { Xingqiu: 70, Bennett: 30 } } })
    )
    const single = fromBennett(
      calculator({ Bennett: { catchBy: 'Xingqiu', funnelShare: 70 } })
    )
    for (const k of team) expect(shares[k]).toBeCloseTo(single[k], 6)
  })

  it('shares that don’t add up to 100 are taken as parts of the whole', () => {
    const rounded = fromBennett(
      calculator({
        Bennett: {
          catchShares: { Xingqiu: 33.3, Xiangling: 33.3, Sucrose: 33.3 },
        },
      })
    )
    for (const k of ['Xingqiu', 'Sucrose'] as const)
      expect(rounded[k]).toBeCloseTo(particles * (0.6 + 0.4 / 3), 6)
  })

  it('a catcher no longer in the team is left out; no share in the team: one catcher again', () => {
    const left = fromBennett(
      calculator({
        Bennett: { catchShares: { Xingqiu: 50, Nahida: 50 } as never },
      })
    )
    expect(left.Xingqiu).toBeCloseTo(particles * 1, 6)
    const none = fromBennett(
      calculator({
        Bennett: {
          catchShares: { Nahida: 100 } as never,
          catchBy: 'Sucrose',
          funnelShare: 100,
        },
      })
    )
    expect(none.Sucrose).toBeCloseTo(particles * 1, 6)
    expect(
      fromBennett(
        calculator({ Bennett: { catchShares: {}, catchBy: 'Sucrose' } })
      ).Sucrose
    ).toBeCloseTo(particles * 1, 6)
  })

  it('a catcher or share set by hand is used instead', () => {
    for (const field of ['catchBy', 'funnelShare'] as const) {
      const got = fromBennett(
        calculator({
          Bennett: {
            catchShares: { Xingqiu: 50, Xiangling: 50 },
            catchBy: 'Sucrose',
            funnelShare: 100,
            edited: [field],
          },
        })
      )
      expect(got.Sucrose).toBeCloseTo(particles * 1, 6)
      expect(got.Xingqiu).toBeCloseTo(particles * 0.6, 6)
    }
  })

  it('a marked turret: shared by who caught them, unless its Skill is set by hand', () => {
    const turret = (member: Partial<TeamOptEnergyMember>) =>
      calculateEnergyRecharge(
        team,
        calculator({
          Xiangling: {
            turretParticles: 4,
            turretCatchShares: { Xingqiu: 100 },
            fieldTime: 40,
            ...member,
          },
          Bennett: { fieldTime: 20, skillUses: 0, secondaryUses: 0 },
          Xingqiu: { fieldTime: 20, skillUses: 0, secondaryUses: 0 },
          Sucrose: { fieldTime: 20, skillUses: 0, secondaryUses: 0 },
        }),
        weapons
      ).members
    const caught = turret({})
    expect(caught.Xingqiu!.sources.team).toBeCloseTo(4 * 1, 6)
    // (Xiangling off the field for all of them, though on it 40% of the time)
    expect(caught.Xiangling!.sources.own).toBeCloseTo(4 * 3 * 0.6, 6)
    // (no shares: by field time, as before)
    const byField = turret({ turretCatchShares: undefined })
    expect(byField.Xiangling!.sources.own).toBeCloseTo(
      4 * 3 * (0.6 + 0.4 * 0.4),
      6
    )
    // (its uses typed by hand: the sheet's rate, by field time)
    const typed = turret({ skillUses: 1, edited: ['skillUses'] })
    expect(typed.Xiangling!.sources.own).not.toBeCloseTo(
      caught.Xiangling!.sources.own,
      3
    )
  })

  it('Favonius particles: by who caught them, unless the catcher is set by hand', () => {
    const fav = (member: Partial<TeamOptEnergyMember>) =>
      calculateEnergyRecharge(
        team,
        calculator({
          Xingqiu: {
            favoniusProcs: 2,
            favoniusCatchBy: 'Xingqiu',
            favoniusCatchShares: { Xingqiu: 50, Xiangling: 50 },
            ...member,
          },
        })
      ).members
    // (no weapons given: the triggers count as entered; 3 clear particles of 2 each)
    expect(fav({}).Xiangling!.sources.favonius).toBeCloseTo(
      2 * 3 * 2 * (0.6 + 0.4 * 0.5),
      6
    )
    expect(
      fav({ edited: ['favoniusCatchBy'] }).Xiangling!.sources.favonius
    ).toBeCloseTo(2 * 3 * 2 * 0.6, 6)
  })
})

describe('filling the shares in', () => {
  it('Favonius: each catcher’s share of the triggers’ particles', () => {
    const hits = Array.from({ length: 40 }, (_, i) => ({
      t: i * 30,
      characterKey: 'Xingqiu' as CharacterKey,
      onField: 'Xingqiu' as CharacterKey,
      path: ['normal', 'dmg'],
    }))
    const out = favoniusFromRotation(
      { start: 0, frames: 1200, hits: hits as never },
      team,
      1,
      (t) => (t < 600 ? 'Xingqiu' : 'Bennett')
    ).Xingqiu!
    expect(out.shares!.Xingqiu! + out.shares!.Bennett!).toBeCloseTo(100, 0)
    expect(out.shares!.Bennett).toBeGreaterThan(0)
    expect(out.shares!.Xingqiu).toBeGreaterThan(0)
  })

  it('kept up to date; set by hand, kept but not counted until "Use rotation"', () => {
    const sim = play(SPLIT)
    const energy = energyFromRotation(sim, team, 2, constellations)
    const base = filled(sim)
    const typed = withRotationEnergy(
      {
        ...base,
        members: {
          ...base.members,
          Bennett: {
            ...base.members.Bennett!,
            catchBy: 'Sucrose',
            edited: ['catchBy'],
          },
        },
      },
      team,
      energy
    )
    expect(typed.members.Bennett!.catchBy).toBe('Sucrose')
    expect(typed.members.Bennett!.catchShares).toEqual({
      Xingqiu: 50,
      Xiangling: 50,
    })
    expect(skillEnergy(typed).Sucrose).toBeGreaterThan(
      skillEnergy(base).Sucrose
    )
    // (a rotation without Bennett's Skill: no stale shares left)
    const none = withRotationEnergy(
      base,
      team,
      energyFromRotation(
        play('Xingqiu E Q -> Xiangling Q E N3 -> Bennett Q -> Sucrose E'),
        team,
        2,
        constellations
      )
    )
    expect(none.members.Bennett!.catchShares).toBeUndefined()
  })
})
