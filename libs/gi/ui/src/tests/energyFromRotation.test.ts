/**
 * The ER calculator's inputs from a played rotation: field time, skill uses (a cooldown start each,
 * so Durin's recast is not one), the particle catcher (who is on the field when the particles
 * arrive, 100 frames after the hit), Burst cadence and Durin's bonus energy; and filling them in
 * where they were not set by hand.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import {
  attackEnergyFromRotation,
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  energyCalcData,
  energyFromRotation,
  withRotationEnergy,
} from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Emilie', 'Nicole', 'Durin', 'Kinich']
// (a Discord report's team and rotation: the in-game ER need for Durin was about 130%)
const text =
  'Emilie N1 E -> Nicole N2 E -> Durin E E Q -> Kinich E N2 hE N2 hE N2 hE N2 hE N2 hE Q'
const play = (rotation = text) =>
  simulateRotation({
    rotation: parseRotation(
      rotation,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: {},
    repeats: 4,
    keep: 'last2',
  })

describe('energy inputs from the rotation', () => {
  const sim = play()
  const energy = energyFromRotation(sim, members, 2)
  it('counts skill uses by cooldown (Durin E E is one), and Durin’s bonus energy', () => {
    expect(energy.members.Durin!.skillUses).toBe(1)
    // (30 from his Skill, plus his Normal and Charged Attacks' random Energy)
    expect(energy.members.Durin!.flatEnergy).toBeCloseTo(
      30 + (attackEnergyFromRotation(sim, members, 2).Durin ?? 0),
      1
    )
    expect(energy.members.Nicole!.skillUses).toBe(1)
    expect(energy.members.Emilie!.skillUses).toBe(1)
  })
  it('shares field time out as played (adding up to 100%)', () => {
    const total = members.reduce((n, k) => n + energy.members[k]!.fieldTime!, 0)
    expect(total).toBeCloseTo(100, 0)
    // (Kinich holds the field for most of it)
    for (const k of ['Emilie', 'Nicole', 'Durin'] as const)
      expect(energy.members.Kinich!.fieldTime!).toBeGreaterThan(
        energy.members[k]!.fieldTime!
      )
  })
  it('gives particles to whoever is on the field when they arrive', () => {
    // (Nicole's E then the swap to Durin: her particles reach Durin)
    expect(energy.members.Nicole!.catchBy).toBe('Durin')
    expect(energy.members.Nicole!.funnelShare).toBe(100)
  })
  it('turns a member without a Burst in the rotation off', () => {
    expect(energy.members.Emilie!.burstEvery).toBe(0)
    expect(energy.members.Durin!.burstEvery).toBe(1)
    expect(energy.members.Kinich!.burstEvery).toBe(1)
  })
  it('fills the calculator in, except what was set by hand', () => {
    const settings = defaultEnergyCalculator(members, 18)
    settings.members.Durin = {
      ...settings.members.Durin!,
      skillUses: 2,
      edited: ['skillUses'],
    }
    const filled = withRotationEnergy(settings, members, energy)
    expect(filled.members.Durin!.skillUses).toBe(2)
    expect(filled.members.Nicole!.catchBy).toBe('Durin')
    const fieldTotal = members.reduce(
      (n, k) => n + filled.members[k]!.fieldTime,
      0
    )
    expect(fieldTotal).toBeCloseTo(100, 0)
    // (Durin, with Nicole's particles and his own 30, needs far less than the 194% reported)
    const result = calculateEnergyRecharge(
      members,
      withRotationEnergy(defaultEnergyCalculator(members, 18), members, energy)
    )
    expect(result.targets.Durin!).toBeLessThan(150)
  })
})

describe('energy inputs: Varesa Overload (KQM quick guide)', () => {
  const team: CharacterKey[] = ['Varesa', 'Chevreuse', 'Iansan', 'Bennett']
  const rotation = parseRotation(
    'Chevreuse Q hE -> Iansan E Q -> Bennett E Q -> Varesa E CA P Q E CA P E CA P Q -> Bennett E N1 -> Varesa E CA P E CA P Q CA P CA P',
    team.map((characterKey) => ({ characterKey, name: characterKey }))
  )
  const sim = simulateRotation({
    rotation: {
      ...rotation,
      opener: parseRotation('Varesa E CA P', [
        { characterKey: 'Varesa', name: 'Varesa' },
      ]).steps,
    },
    members: team,
    elements: Object.fromEntries(team.map((m) => [m, getCharEle(m)])) as never,
    constellations: { Varesa: 0, Chevreuse: 6, Iansan: 6, Bennett: 6 },
    repeats: 4,
    keep: 'last2',
  })
  const energy = energyFromRotation(sim, team, 2)
  it('counts the Rushes that make particles (not the free ones) and the free C4 Hold', () => {
    // (kqmsim: 2 particle drops by Varesa, 1 by Chevreuse a rotation)
    expect(energy.members.Varesa!.skillUses).toBe(2)
    expect(energy.members.Chevreuse!.skillUses).toBe(1)
    expect(energy.members.Bennett!.skillUses).toBe(2)
  })
  it('times Electro resonance from its Electro reactions (kqmsim: 3 particles a rotation)', () => {
    expect(energy.electroInterval!).toBeGreaterThan(6)
    expect(energy.electroInterval!).toBeLessThan(8)
  })
  it('counts Volcanic Kablams as the sheet’s Kablam option, her 70-cost Burst unused', () => {
    expect(energy.members.Varesa!.burstEvery).toBe(0)
    expect(energy.members.Varesa!.secondaryUses).toBe(3)
    const result = calculateEnergyRecharge(
      team,
      withRotationEnergy(defaultEnergyCalculator(team, 21.3), team, energy)
    )
    // (3 Kablams, 30 each, from her particle energy: well above 100%)
    expect(result.members.Varesa!.flatEnergy).toBeCloseTo(
      -90 + (attackEnergyFromRotation(sim, team, 2).Varesa ?? 0),
      1
    )
    expect(result.targets.Varesa!).toBeGreaterThan(200)
  })
})

describe('energy inputs: Sandrone', () => {
  const team: CharacterKey[] = ['Sandrone', 'Odette', 'Mitya', 'Danica']
  it('starts at 5 Hit On-Field uses and 5 bonus energy (a rotation of 3 Charged Attacks)', () => {
    const settings = defaultEnergyCalculator(team, 21)
    expect(settings.members.Sandrone!.skillUses).toBe(5)
    expect(settings.members.Sandrone!.flatEnergy).toBe(5)
  })
  it('counts her particles as played (2.5 s apart) and the 5 with 3 Charged Attacks', () => {
    const sim = simulateRotation({
      rotation: parseRotation(
        'Mitya E -> Odette E E -> Danica E Q -> Sandrone E CA Q E CA E CA',
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: { Sandrone: 0, Odette: 0, Mitya: 0, Danica: 6 },
      repeats: 4,
      keep: 'last2',
    })
    const energy = energyFromRotation(sim, team, 2)
    expect(energy.members.Sandrone!.skillUses).toBe(5)
    // (her Charged Attacks' random Energy, as played: about the ERC sheet's 5 for 3 of them)
    const attack = attackEnergyFromRotation(sim, team, 2).Sandrone ?? 0
    expect(energy.members.Sandrone!.flatEnergy).toBeCloseTo(attack, 1)
    expect(attack).toBeGreaterThan(3)
    expect(attack).toBeLessThan(8)
  })
})

describe('energy inputs: Flins (two Bursts)', () => {
  const team: CharacterKey[] = ['Flins', 'Ineffa', 'Columbina', 'Sucrose']
  // (his full Burst, then Manifest Flame: Northland Spearstorm makes his next Q a Thunderous
  // Symphony, 30 Energy)
  const sim = simulateRotation({
    rotation: parseRotation(
      'Flins Q -> Ineffa E Q -> Columbina E -> Sucrose E -> Flins E N2 E Q N2 W2',
      team.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: team,
    elements: Object.fromEntries(team.map((m) => [m, getCharEle(m)])) as never,
    constellations: {},
    repeats: 4,
    keep: 'last2',
  })
  const energy = energyFromRotation(sim, team, 2)
  it('counts Thunderous Symphony as its own option (30 Energy), apart from the 80-Energy Burst', () => {
    expect(energy.members.Flins!.burstEvery).toBe(1)
    expect(energy.members.Flins!.secondaryUses).toBe(1)
    // (his particles: 1 per Manifest Flame normal hit, 2 s apart at least, as kqmsim; each a use
    // of the sheet's "Manifest Flame hit" option, 1 particle)
    const markers = sim.hits.filter(
      (h) =>
        h.characterKey === 'Flins' &&
        h.path.join('.') === '_marker.particles' &&
        h.t >= sim.start &&
        h.t < sim.start + sim.frames
    )
    expect(markers.length).toBeGreaterThan(0)
    for (let i = 1; i < markers.length; i++)
      expect(markers[i].t - markers[i - 1].t).toBeGreaterThanOrEqual(120)
    expect(energy.members.Flins!.skillUses).toBe(markers.length / 2)
    const data = energyCalcData.Flins!
    expect(data.skills[energy.members.Flins!.skillMode!].label).toBe(
      'Manifest Flame hit'
    )
    const settings = withRotationEnergy(
      defaultEnergyCalculator(team, 20),
      team,
      energy
    )
    const result = calculateEnergyRecharge(team, settings)
    const flinsAttack = attackEnergyFromRotation(sim, team, 2).Flins ?? 0
    expect(result.members.Flins!.flatEnergy).toBeCloseTo(-30 + flinsAttack, 1)
    // 80 for the Burst plus 30 for the Symphony, from his particles
    const without = calculateEnergyRecharge(team, {
      ...settings,
      members: {
        ...settings.members,
        Flins: { ...settings.members.Flins!, secondaryUses: 0 },
      },
    })
    expect(result.targets.Flins!).toBeGreaterThan(without.targets.Flins!)
  })
  it('a Burst cadence set by hand keeps the Thunderous Symphonies out too (no double count)', () => {
    const settings = defaultEnergyCalculator(team, 20)
    settings.members.Flins = {
      ...settings.members.Flins!,
      burstEvery: 1,
      edited: ['burstEvery'],
    }
    const filled = withRotationEnergy(settings, team, energy)
    expect(filled.members.Flins!.burstEvery).toBe(1)
    expect(filled.members.Flins!.secondaryUses).toBe(
      settings.members.Flins!.secondaryUses
    )
    expect(
      calculateEnergyRecharge(team, filled).members.Flins!.flatEnergy
    ).toBeGreaterThanOrEqual(0)
  })
  it('C1: 8 Energy on the party’s Lunar-Charged, once per 5.5 s (kqmsim), as bonus energy', () => {
    const lunarCharged = sim.hits.filter(
      (h) =>
        h.path.join('.') === '_reaction.lunarCharged' &&
        h.t >= sim.start &&
        h.t < sim.start + sim.frames
    )
    expect(lunarCharged.length).toBeGreaterThan(0)
    let last = Number.NEGATIVE_INFINITY
    let procs = 0
    for (const h of lunarCharged)
      if (h.t > last + 330) {
        procs++
        last = h.t
      }
    const c1 = energyFromRotation(sim, team, 2, { Flins: 1 })
    const attack = attackEnergyFromRotation(sim, team, 2).Flins ?? 0
    expect(c1.members.Flins!.flatEnergy).toBeCloseTo(
      (8 * procs) / 2 + attack,
      1
    )
    // (C0: none from C1)
    expect(energy.members.Flins!.flatEnergy ?? 0).toBeCloseTo(attack, 1)
  })
})

describe('Normal and Charged Attack energy (random, as gcsim/kqmsim)', () => {
  const hit = (t: number, characterKey: CharacterKey, tag = 'normal') =>
    ({ t, characterKey, tag, path: ['normal', '0'] }) as never
  it('matches the expected value of the chance that grows with each miss (a catalyst: +10%)', () => {
    // ten hits 30 frames apart: no 12-frame pause in the way. The exact expectation, by the
    // chance after each miss (0, 10%, 20%… reset to 0 by a success)
    const hits = Array.from({ length: 10 }, (_, i) => hit(i * 30, 'Mona'))
    let states = new Map<number, number>([[0, 1]])
    let expected = 0
    for (let i = 0; i < 10; i++) {
      const next = new Map<number, number>()
      for (const [misses, p] of states) {
        const chance = Math.min(1, misses * 0.1)
        expected += p * chance
        next.set(0, (next.get(0) ?? 0) + p * chance)
        next.set(misses + 1, (next.get(misses + 1) ?? 0) + p * (1 - chance))
      }
      states = next
    }
    const got = attackEnergyFromRotation(
      { start: 0, frames: 600, hits, swaps: [] },
      ['Mona']
    ).Mona!
    expect(got).toBeCloseTo(expected, 1)
  })
  it('a success pauses the whole party for 12 frames; a swap resets every chance', () => {
    // two members hitting at the same frames: the second hit of a pair cannot restore Energy
    // right after the first did
    const paired = attackEnergyFromRotation(
      {
        start: 0,
        frames: 3000,
        hits: Array.from({ length: 60 }, (_, i) => [
          hit(i * 40, 'Mona'),
          hit(i * 40 + 1, 'Fischl', 'charged'),
        ]).flat(),
        swaps: [],
      },
      ['Mona', 'Fischl']
    )
    const alone = attackEnergyFromRotation(
      {
        start: 0,
        frames: 3000,
        hits: Array.from({ length: 60 }, (_, i) =>
          hit(i * 40 + 1, 'Fischl', 'charged')
        ),
        swaps: [],
      },
      ['Fischl']
    )
    expect(paired.Fischl!).toBeLessThan(alone.Fischl!)
    // swaps before every hit: the chance never grows past its start (0 for a catalyst)
    const reset = attackEnergyFromRotation(
      {
        start: 0,
        frames: 600,
        hits: Array.from({ length: 10 }, (_, i) => hit(i * 30 + 5, 'Mona')),
        swaps: Array.from(
          { length: 10 },
          (_, i) => ({ start: i * 30 }) as never
        ),
      },
      ['Mona']
    )
    expect(reset.Mona ?? 0).toBe(0)
  })
  it('plunges and the simulation’s markers do not count', () => {
    const got = attackEnergyFromRotation(
      {
        start: 0,
        frames: 600,
        hits: Array.from({ length: 10 }, (_, i) =>
          hit(i * 30, 'Mona', 'plunge')
        ),
        swaps: [],
      },
      ['Mona']
    )
    expect(got.Mona ?? 0).toBe(0)
  })
})
