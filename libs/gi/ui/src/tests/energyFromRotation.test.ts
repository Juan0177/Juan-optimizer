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
  type RotationEnergy,
  withRotationEnergy,
} from '../util/teamOpt/energyCalc'
import { everyNthBursts, parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

/** A team's rotation, played 4 times (the last 2 kept: 2 rotations) */
const playTeam = (
  team: CharacterKey[],
  rotation: string,
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      rotation,
      team.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: team,
    elements: Object.fromEntries(team.map((m) => [m, getCharEle(m)])) as never,
    constellations,
    repeats: 4,
    keep: 'last2',
  })
/** A member's filled-in skill uses a rotation, by the sheet option (its two options) */
const usesByOption = (energy: RotationEnergy, key: CharacterKey) => {
  const member = energy.members[key]!
  const skills = energyCalcData[key]!.skills
  const out: Record<string, number> = {}
  if (member.skillUses) out[skills[member.skillMode!].label] = member.skillUses
  if (member.secondaryUses)
    out[skills[member.secondaryMode!].label] =
      (out[skills[member.secondaryMode!].label] ?? 0) + member.secondaryUses
  return out
}
/** A member's particle markers in the kept span */
const particleMarkers = (
  sim: ReturnType<typeof simulateRotation>,
  key: CharacterKey
) =>
  sim.hits.filter(
    (h) =>
      h.characterKey === key &&
      h.path[0] === '_marker' &&
      h.path[1] === 'particles' &&
      h.t >= sim.start &&
      h.t < sim.start + sim.frames
  )

const members: CharacterKey[] = ['Emilie', 'Nicole', 'Durin', 'Kinich']
// (a user report's team and rotation: the in-game ER need for Durin was about 130%)
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
  it('rounds field times to a tenth that still add up to 100%, so a run is not stopped', () => {
    // (three equal shares, rounded one by one, made 33.3% each: 99.9%)
    const team: CharacterKey[] = ['Bennett', 'Xingqiu', 'Xiangling']
    const thirds = {
      members: Object.fromEntries(team.map((k) => [k, { fieldTime: 1 }])),
    } as unknown as RotationEnergy
    const filled = withRotationEnergy(
      defaultEnergyCalculator(team, 20),
      team,
      thirds
    )
    const fields = team.map((k) => filled.members[k]!.fieldTime)
    expect(fields.map((f) => Math.round(f * 10)).sort()).toEqual([
      333, 333, 334,
    ])
    expect(fields.reduce((n, f) => n + f, 0)).toBeCloseTo(100, 6)
    expect(calculateEnergyRecharge(team, filled).errors).toEqual([])
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
    // (no weapons held: the Favonius triggers filled in count only with one)
    const result = calculateEnergyRecharge(
      team,
      withRotationEnergy(defaultEnergyCalculator(team, 21.3), team, energy),
      {}
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
  it('Ineffa C4: 5 Energy on the party’s Lunar-Charged, once per 4 s, as bonus energy', () => {
    let last = Number.NEGATIVE_INFINITY
    let procs = 0
    for (const h of sim.hits)
      if (
        h.path.join('.') === '_reaction.lunarCharged' &&
        h.t >= sim.start &&
        h.t < sim.start + sim.frames &&
        h.t > last + 240
      ) {
        procs++
        last = h.t
      }
    expect(procs).toBeGreaterThan(0)
    const at = (cons: number) =>
      energyFromRotation(sim, team, 2, { Ineffa: cons }).members.Ineffa!
        .flatEnergy ?? 0
    expect(at(4) - at(3)).toBeCloseTo((5 * procs) / 2, 2)
    expect(at(6) - at(3)).toBeCloseTo((5 * procs) / 2, 2)
  })
  it('Bloodsoaked Ruins played as a KQM candidate: its Energy counts for the build that holds it', () => {
    const rotation =
      'Columbina E -> Ineffa E Q -> Sucrose E -> Flins E N4 N2 E Q N4 E Q'
    const candidate = simulateRotation({
      rotation: parseRotation(
        rotation,
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: {},
      gear: {
        Flins: { candidates: { weapons: ['BloodsoakedRuins', 'Deathmatch'] } },
      },
      repeats: 4,
      keep: 'last2',
    })
    const filled = withRotationEnergy(
      defaultEnergyCalculator(team, candidate.frames / 120),
      team,
      energyFromRotation(candidate, team, 2)
    )
    expect(filled.members.Flins!.weaponTriggers?.BloodsoakedRuins).toBe(1)
    const target = (weapon: 'BloodsoakedRuins' | 'Deathmatch') =>
      calculateEnergyRecharge(team, filled, { Flins: weapon }, { Flins: 1 })
        .targets.Flins!
    expect(target('BloodsoakedRuins')).toBeLessThan(target('Deathmatch') - 20)
  })
})

describe('energy inputs: Danica C1 and C4 (dump ConfigTalent_Danica)', () => {
  const team: CharacterKey[] = ['Danica', 'Mitya', 'Odette', 'Anastasya']
  const sc = (t: number, characterKey: CharacterKey, onField = characterKey) =>
    ({
      t,
      characterKey,
      onField,
      tag: 'directStellarConduct',
      element: 'electro',
      path: ['skill', 'sc'],
    }) as never
  const aegis = (t: number, frames: number) =>
    ({
      t,
      characterKey: 'Danica',
      onField: 'Danica',
      tag: 'other',
      element: 'physical',
      path: ['_marker', 'shield', `${frames}`, '', ''],
    }) as never
  const act = (start: number, text: string, variant?: string) =>
    ({
      characterKey: 'Danica',
      text,
      start,
      frames: 60,
      ...(variant ? { variant: { key: variant, label: '', mode: '' } } : {}),
    }) as never
  const sim = {
    start: 0,
    frames: 1200,
    swaps: [],
    skillUses: [],
    // Will to Protect (Entry) at 0 and 900, a Will to Purge at 300 (inside C1's 14 s), a plain E
    actions: [
      act(0, 'Entry'),
      act(300, 'E', 'battleMaid'),
      act(900, 'Entry'),
      act(1000, 'E'),
    ],
    // the Royal Aegis from 0, ended at 600 by a 0-frame one, a new one from 900
    hits: [
      aegis(0, 1500),
      sc(42, 'Danica'), // (her own: no C4 Energy since beta 7.2.54)
      sc(100, 'Mitya'),
      sc(300, 'Mitya'), // (inside C4's 3.5 s)
      sc(350, 'Odette', 'Mitya'), // (off the field)
      aegis(600, 0),
      sc(700, 'Mitya'), // (no Aegis)
      aegis(900, 1500),
      sc(950, 'Anastasya'),
    ],
  }
  it('C1: 20 to herself per Will to Protect or Will to Purge, once per 14 s', () => {
    const c1 = energyFromRotation(sim as never, team, 1, { Danica: 1 })
    expect(c1.members.Danica!.flatEnergy).toBe(40)
    expect(c1.members.Mitya!.flatEnergy ?? 0).toBe(0)
    const c0 = energyFromRotation(sim as never, team, 1, { Danica: 0 })
    expect(c0.members.Danica!.flatEnergy).toBe(0)
  })
  it('below C1 the calculator loses the Energy a C1 rotation filled in', () => {
    const atC1 = withRotationEnergy(
      defaultEnergyCalculator(team),
      team,
      energyFromRotation(sim as never, team, 1, { Danica: 1 })
    )
    expect(atC1.members.Danica!.flatEnergy).toBe(40)
    const atC0 = withRotationEnergy(
      atC1,
      team,
      energyFromRotation(sim as never, team, 1, { Danica: 0 })
    )
    expect(atC0.members.Danica!.flatEnergy).toBe(0)
    // (so do the Favonius triggers and energy weapon triggers of a rotation where she does nothing)
    expect(atC1.members.Danica!.favoniusProcs).toBeGreaterThan(0)
    const idle = withRotationEnergy(
      atC1,
      team,
      energyFromRotation({ ...sim, hits: [], actions: [] } as never, team, 1, {
        Danica: 1,
      })
    )
    expect(idle.members.Danica!.flatEnergy).toBe(0)
    expect(idle.members.Danica!.favoniusProcs).toBe(0)
    expect(idle.members.Danica!.weaponTriggers).toEqual({})
  })
  it('C4: 3 to each other member when another Aegis-protected member on the field deals Stellar-Conduct DMG, once per 3.5 s', () => {
    const c4 = energyFromRotation(sim as never, team, 1, { Danica: 4 })
    // (procs at 100 and 950)
    for (const k of ['Mitya', 'Odette', 'Anastasya'] as const)
      expect(c4.members[k]!.flatEnergy).toBe(6)
    expect(c4.members.Danica!.flatEnergy).toBe(40)
    const c3 = energyFromRotation(sim as never, team, 1, { Danica: 3 })
    expect(c3.members.Mitya!.flatEnergy).toBe(0)
  })
  it('as the kit plays them: each Entry gives C1, and its own Stellar-Conduct hit under the Aegis no C4', () => {
    const played = simulateRotation({
      rotation: parseRotation(
        'Danica E Q -> Odette E Q -> Mitya hE Q CA -> Tsaritsa hE Q N5 D N5 E E E',
        team.map((characterKey) => ({
          characterKey,
          name: characterKey === 'Anastasya' ? 'Tsaritsa' : characterKey,
        }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: { Danica: 6, Mitya: 6, Odette: 6, Anastasya: 6 },
      repeats: 4,
      keep: 'last2',
    })
    const entries = played.actions.filter(
      (a) =>
        a.characterKey === 'Danica' &&
        a.text === 'Entry' &&
        a.start >= played.start &&
        a.start < played.start + played.frames
    ).length
    // (since beta 7.2.53 her E doesn't refresh a Storm Anchor already out: the one Will to Protect
    // refreshed runs out before the next rotation's swap-in, so one Entry in the two counted)
    expect(entries).toBe(1)
    const at = (cons: number) =>
      energyFromRotation(played, team, 2, { Danica: cons })
    expect(
      at(1).members.Danica!.flatEnergy! -
        (at(0).members.Danica!.flatEnergy ?? 0)
    ).toBeCloseTo((20 * entries) / 2, 2)
    // (the Aegis lasts from the Entry to her E: only her own Entry hit falls inside it, and since
    // beta 7.2.54 her own hits give no C4 Energy)
    expect(
      (at(4).members.Mitya!.flatEnergy ?? 0) -
        (at(3).members.Mitya!.flatEnergy ?? 0)
    ).toBeCloseTo(0, 2)
    // (her particles: the Entry's hit drops them, the Anchor Skill 2 s later is inside their 16 s)
    expect(at(6).members.Danica!.skillUses).toBe(1)
  })
  it('particles: her Anchor Skill’s and her Entry Skill’s hits drop 5, once per 16 s (dump DropBall, beta 7.2.53)', () => {
    const played = simulateRotation({
      rotation: parseRotation(
        'Danica E Q -> Odette E Q -> Mitya hE Q CA -> Tsaritsa hE Q N5 E E E -> Danica N1 -> Odette N3 N3 N3 -> Tsaritsa N5 N5 N5 N5 N5',
        team.map((characterKey) => ({
          characterKey,
          name: characterKey === 'Anastasya' ? 'Tsaritsa' : characterKey,
        }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: { Danica: 6, Mitya: 6, Odette: 6, Anastasya: 6 },
      repeats: 4,
      keep: 'last2',
    })
    const drops = played.hits
      .filter(
        (h) =>
          h.characterKey === 'Danica' &&
          ['skill.dmg', 'skill.entryDmg'].includes(h.path.join('.')) &&
          h.t >= played.start &&
          h.t < played.start + played.frames
      )
      .sort((a, b) => a.t - b.t)
    // (an Anchor Skill and an Entry, 16 s apart at least: both drop. The second rotation's E
    // doesn't refresh the Storm Anchor Will to Protect refreshed (beta 7.2.53): it runs out
    // before the swap-in, and that rotation has no Entry)
    expect(drops.map((h) => h.path[1])).toEqual(['dmg', 'entryDmg', 'dmg'])
    for (let i = 1; i < drops.length; i++)
      expect(drops[i].t - drops[i - 1].t).toBeGreaterThanOrEqual(960)
    expect(particleMarkers(played, 'Danica').map((m) => m.t)).toEqual(
      drops.map((h) => h.t)
    )
    expect(energyFromRotation(played, team, 2).members.Danica!.skillUses).toBe(
      1.5
    )
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

describe('Favonius from the rotation', () => {
  const sim = play()
  const energy = energyFromRotation(sim, members, 2)
  it('fills in what each member’s hits would trigger with a Favonius (R5, CRIT half the time)', () => {
    for (const k of members)
      expect(energy.members[k]!.favoniusProcs ?? 0).toBeGreaterThanOrEqual(0)
    // (Kinich hits all rotation: at least one trigger, at most one per 6 s)
    const kinich = energy.members.Kinich!.favoniusProcs!
    expect(kinich).toBeGreaterThan(0.5)
    expect(kinich).toBeLessThanOrEqual(sim.frames / 2 / 360 + 1)
  })
  it('lowers the ER targets only for a member that holds a Favonius', () => {
    const settings = withRotationEnergy(
      defaultEnergyCalculator(members, sim.frames / 60 / 2),
      members,
      energy
    )
    const without = calculateEnergyRecharge(members, settings, {})
    const withFav = calculateEnergyRecharge(
      members,
      settings,
      { Kinich: 'FavoniusGreatsword' },
      { Kinich: 5 }
    )
    expect(withFav.targets.Kinich!).toBeLessThan(without.targets.Kinich!)
    // (its particles go to the team too)
    expect(
      members.some((k) => withFav.targets[k]! < without.targets[k]!) &&
        withFav.members.Emilie!.particleEnergy >=
          without.members.Emilie!.particleEnergy
    ).toBe(true)
  })
  it('a count typed by hand is kept (edited)', () => {
    const settings = defaultEnergyCalculator(members, 20)
    settings.members.Kinich = {
      ...settings.members.Kinich!,
      favoniusProcs: 1,
      edited: ['favoniusProcs'],
    }
    expect(
      withRotationEnergy(settings, members, energy).members.Kinich!
        .favoniusProcs
    ).toBe(1)
  })
})

describe('Frostbreath from the rotation', () => {
  // (Xiangling's Pyronado on Xingqiu's Hydro: her own Vaporizes, a Hydro-related reaction)
  const team: CharacterKey[] = ['Xiangling', 'Xingqiu', 'Bennett', 'Sucrose']
  const playTeam = (gear = {}) =>
    simulateRotation({
      rotation: parseRotation(
        'Bennett Q E -> Xingqiu Q E -> Sucrose E -> Xiangling Q E N1 -> Bennett E -> Xingqiu E N3 -> Sucrose N3 -> Xiangling',
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: {},
      gear,
      repeats: 4,
      keep: 'last2',
    })
  const sim = playTeam()
  const energy = energyFromRotation(sim, team, 2)
  it('fills in the triggers a Frostbreath would have: its own Cryo- or Hydro-related reactions, once per 16 s', () => {
    const xiangling = energy.members.Xiangling!.weaponTriggers!.Frostbreath!
    expect(xiangling).toBeGreaterThan(0)
    expect(xiangling).toBeLessThanOrEqual(sim.frames / 2 / 960 + 1)
    // (everyone's own reactions count, each at most once per 16 s: Bennett's Pyro on Xingqiu's
    // Hydro is a Vaporize of his)
    for (const k of team)
      expect(
        energy.members[k]!.weaponTriggers?.Frostbreath ?? 0
      ).toBeLessThanOrEqual(sim.frames / 2 / 960 + 1)
  })
  it('gives the other members its energy only when the member holds a Frostbreath', () => {
    const settings = withRotationEnergy(
      defaultEnergyCalculator(team, sim.frames / 60 / 2),
      team,
      energy
    )
    const without = calculateEnergyRecharge(team, settings, {
      Xiangling: 'TheCatch',
    })
    const withFrost = calculateEnergyRecharge(
      team,
      settings,
      { Xiangling: 'Frostbreath' },
      { Xiangling: 5 }
    )
    const triggers = Math.min(
      energy.members.Xiangling!.weaponTriggers!.Frostbreath!,
      settings.rotationTime / 16
    )
    // (12 Energy each at R5, the others only)
    for (const k of ['Xingqiu', 'Bennett', 'Sucrose'] as const)
      expect(
        withFrost.members[k]!.flatEnergy - without.members[k]!.flatEnergy
      ).toBeCloseTo(12 * triggers, 5)
    expect(withFrost.members.Xiangling!.flatEnergy).toBeCloseTo(
      without.members.Xiangling!.flatEnergy,
      5
    )
    // (a count typed by hand wins)
    const typed = {
      ...settings,
      members: {
        ...settings.members,
        Xiangling: {
          ...settings.members.Xiangling!,
          weaponEnergyTriggers: 0.5,
        },
      },
    }
    expect(
      calculateEnergyRecharge(
        team,
        typed,
        { Xiangling: 'Frostbreath' },
        { Xiangling: 5 }
      ).members.Xingqiu!.flatEnergy - without.members.Xingqiu!.flatEnergy
    ).toBeCloseTo(6, 5)
  })
  it('times its ATK buff for the wielder: 15 s after its own reaction, once per 16 s', () => {
    const played = playTeam({ Xiangling: { weapon: 'Frostbreath' } })
    const on = played.buffWindows
      .filter(
        (w) =>
          w.path.join('.') === 'Frostbreath.react' &&
          w.value === 'on' &&
          w.end > w.start
      )
      .sort((a, b) => a.start - b.start)
    expect(on.length).toBeGreaterThan(0)
    for (const w of on) expect(w.end - w.start).toBe(900)
    for (let i = 1; i < on.length; i++)
      expect(on[i].start - on[i - 1].start).toBeGreaterThanOrEqual(960)
  })
})

describe('energy inputs: Skill uses whose cooldown has its own key or starts late', () => {
  it('Kazuha’s and Arlecchino’s Skill cooldowns (skill<n>, a new one after a Burst resets it) are uses', () => {
    const team: CharacterKey[] = [
      'KaedeharaKazuha',
      'Arlecchino',
      'Bennett',
      'Xingqiu',
    ]
    const energy = energyFromRotation(
      playTeam(
        team,
        'Xingqiu E Q -> Bennett E Q -> KaedeharaKazuha hE P -> Arlecchino E N4 Q N4 N4'
      ),
      team,
      2
    )
    expect(usesByOption(energy, 'KaedeharaKazuha')).toEqual({ Hold: 1 })
    expect(usesByOption(energy, 'Arlecchino')).toEqual({ Press: 1 })
    // (C1: his Burst resets the cooldown, a new key: E Q E is two uses)
    const duo: CharacterKey[] = ['KaedeharaKazuha', 'Bennett']
    const c1 = energyFromRotation(
      playTeam(duo, 'KaedeharaKazuha E Q E -> Bennett E Q', {
        KaedeharaKazuha: 1,
      }),
      duo,
      2,
      { KaedeharaKazuha: 1 }
    )
    expect(usesByOption(c1, 'KaedeharaKazuha')).toEqual({ Press: 2 })
  })
  it('Cyno, Jahoda, Xilonen and Wanderer (cooldowns their kits set when a mode ends): a use per cast, where its particles are made', () => {
    const team: CharacterKey[] = ['Cyno', 'Jahoda', 'Xilonen', 'Wanderer']
    const sim = playTeam(
      team,
      'Xilonen E N2 E -> Jahoda E E -> Wanderer E N3 N3 E -> Cyno E Q E N2 E N2'
    )
    const energy = energyFromRotation(sim, team, 2)
    // (Cyno: Secret Rite 3 particles, each Mortuary Rite in Pactsworn 1.33)
    expect(usesByOption(energy, 'Cyno')).toEqual({
      'Press (no burst)': 1,
      'Press (in burst)': 2,
    })
    expect(usesByOption(energy, 'Jahoda')).toEqual({ Press: 1 })
    expect(usesByOption(energy, 'Xilonen')).toEqual({ Press: 1 })
    expect(
      energy.members.Wanderer!.skillUses +
        energy.members.Wanderer!.secondaryUses!
    ).toBe(1)
    // (Jahoda's particles come with the flask, at the drain: E E drains it early)
    const flask = sim.hits.find(
      (h) =>
        h.characterKey === 'Jahoda' &&
        ['skill.filledDmg', 'skill.unfilledDmg'].includes(h.path.join('.')) &&
        h.t >= sim.start
    )
    expect(flask).toBeDefined()
    expect(particleMarkers(sim, 'Jahoda').map((m) => m.t)).toContain(flask!.t)
  })
  it('Skirk’s flash (its cooldown starts when it ends): her Cryo DMG’s particles, once per 15 s', () => {
    const team: CharacterKey[] = ['Skirk', 'Furina', 'Escoffier', 'Shenhe']
    const energy = energyFromRotation(
      playTeam(
        team,
        'Furina E Q -> Escoffier E Q -> Shenhe E -> Skirk E N5 N5 N5 Q N5'
      ),
      team,
      2
    )
    expect(usesByOption(energy, 'Skirk')).toEqual({ Attack: 1 })
  })
  it('Wanderer: Windfavored’s option by its Kuugo hits’ particles (once per 2 s)', () => {
    const duo: CharacterKey[] = ['Wanderer', 'Bennett']
    const long = energyFromRotation(
      playTeam(duo, 'Bennett E Q -> Wanderer E N3 N3 N3 N3 N3 N3 N3'),
      duo,
      2
    )
    expect(usesByOption(long, 'Wanderer')).toEqual({ '8-10s uptime': 1 })
    const short = energyFromRotation(
      playTeam(duo, 'Bennett E Q -> Wanderer E N3 N3 E'),
      duo,
      2
    )
    expect(usesByOption(short, 'Wanderer')).toEqual({ '6-8s uptime': 1 })
  })
})

describe('energy inputs: Tartaglia’s stance', () => {
  const team: CharacterKey[] = [
    'Tartaglia',
    'Bennett',
    'Xiangling',
    'KaedeharaKazuha',
  ]
  it('entering and leaving the Melee Stance is one use; its option by the stance’s Riptide Slash particles (once per 3 s)', () => {
    const left = energyFromRotation(
      playTeam(
        team,
        'Bennett E Q -> KaedeharaKazuha E -> Tartaglia Q E N3 N3 N3 N3 E -> Xiangling Q E'
      ),
      team,
      2
    )
    expect(usesByOption(left, 'Tartaglia')).toEqual({ '7-9s melee': 1 })
    // (a longer stance, left by the swap: 4 particles)
    const sim = playTeam(
      team,
      'Bennett E Q -> KaedeharaKazuha E -> Tartaglia Q E N3 N3 N3 N3 N3 N3 N3 -> Xiangling Q E'
    )
    const slashes = sim.hits
      .filter((h) => h.path.join('.') === 'skill.riptideSlash')
      .map((h) => h.t)
    let ready = Number.NEGATIVE_INFINITY
    let particles = 0
    for (const t of slashes)
      if (t >= ready) {
        particles++
        ready = t + 180
      }
    expect(particles).toBeGreaterThanOrEqual(8)
    expect(usesByOption(energyFromRotation(sim, team, 2), 'Tartaglia')).toEqual(
      { '11s melee': 1 }
    )
  })
})

describe('energy inputs: Amber C4+ (two charges)', () => {
  it('every cast is a use, its particles at the Baron Bunny’s explosion', () => {
    const team: CharacterKey[] = ['Amber', 'Bennett']
    const sim = playTeam(team, 'Amber E N1 E Q -> Bennett E Q', { Amber: 6 })
    const energy = energyFromRotation(sim, team, 2, { Amber: 6 })
    expect(usesByOption(energy, 'Amber')).toEqual({ Press: 2 })
    const explosions = sim.hits
      .filter(
        (h) =>
          h.characterKey === 'Amber' &&
          h.path.join('.') === 'skill.dmg' &&
          h.t >= sim.start &&
          h.t < sim.start + sim.frames
      )
      .map((h) => h.t)
    expect(particleMarkers(sim, 'Amber').map((m) => m.t)).toEqual(explosions)
  })
})

describe('energy inputs: particles made per hit (Alhaitham, Wriothesley, Traveler Pyro)', () => {
  const team: CharacterKey[] = [
    'Alhaitham',
    'Wriothesley',
    'TravelerPyro',
    'Bennett',
  ]
  const sim = playTeam(
    team,
    'Bennett E Q -> Alhaitham E N4 N4 Q -> Wriothesley E N5 N5 N5 -> TravelerPyro E N5 N5'
  )
  const energy = energyFromRotation(sim, team, 2)
  it.each([
    ['Alhaitham', 91],
    ['Wriothesley', 121],
    ['TravelerPyro', 175],
  ] as const)('%s: a use per particle, once per its ICD', (key, icd) => {
    const markers = particleMarkers(sim, key)
    // (more than one a cast: 2 casts in the span)
    expect(markers.length).toBeGreaterThan(2)
    for (let i = 1; i < markers.length; i++)
      expect(markers[i].t - markers[i - 1].t).toBeGreaterThanOrEqual(icd)
    const uses = usesByOption(energy, key)
    expect(Object.values(uses).reduce((n, u) => n + u, 0)).toBe(
      markers.length / 2
    )
  })
  it('the uses are the sheet’s per-particle options', () => {
    expect(Object.keys(usesByOption(energy, 'Alhaitham'))).toEqual([
      'Projection Attack',
    ])
    expect(Object.keys(usesByOption(energy, 'Wriothesley'))).toEqual([
      'NA during skill',
    ])
    expect(Object.keys(usesByOption(energy, 'TravelerPyro'))).toEqual([
      'Blazing Threshold',
    ])
  })
})

describe('energy inputs: the option the rotation played', () => {
  it('Beidou’s hold (2 hits absorbed), Kaeya’s Frostgnaw freezing, Yun Jin’s Charge Level 1', () => {
    const team: CharacterKey[] = ['Beidou', 'Kaeya', 'Xingqiu', 'YunJin']
    const energy = energyFromRotation(
      playTeam(team, 'Xingqiu E Q -> Kaeya E -> Beidou hE Q -> YunJin hE Q'),
      team,
      2
    )
    expect(usesByOption(energy, 'Beidou')).toEqual({ Perfect: 1 })
    // (Frostgnaw on Xingqiu's Hydro: Frozen, A4's extra particle)
    expect(usesByOption(energy, 'Kaeya')).toEqual({ '1 freeze': 1 })
    expect(usesByOption(energy, 'YunJin')).toEqual({ 'Level 1': 1 })
    const plain: CharacterKey[] = ['Kaeya', 'Beidou', 'ShikanoinHeizou']
    const taps = energyFromRotation(
      playTeam(plain, 'Kaeya E -> Beidou E Q -> ShikanoinHeizou E'),
      plain,
      2
    )
    expect(usesByOption(taps, 'Kaeya')).toEqual({ '0 freezes': 1 })
    expect(usesByOption(taps, 'Beidou')).toEqual({ '0 stacks': 1 })
    expect(usesByOption(taps, 'ShikanoinHeizou')).toEqual({ '0-1 stacks': 1 })
  })
  it('Heizou’s stacks, Layla’s volleys, Freminet’s Burst and Level 4, Kirara’s collisions', () => {
    const team: CharacterKey[] = [
      'ShikanoinHeizou',
      'Layla',
      'Freminet',
      'Kirara',
    ]
    const sim = playTeam(
      team,
      'Layla E Q -> Kirara hE -> ShikanoinHeizou hE -> Freminet Q E N3 N3'
    )
    const energy = energyFromRotation(sim, team, 2)
    expect(usesByOption(energy, 'ShikanoinHeizou')).toEqual({
      'Full stacks': 1,
    })
    // (her Burst's stars make a second volley in the Curtain)
    expect(usesByOption(energy, 'Layla')).toEqual({ '2 volleys': 1 })
    // (the Upward Thrust in Stalking, then the Level 4 Shattering Pressure)
    expect(usesByOption(energy, 'Freminet')).toEqual({
      'Level 0 (burst)': 1,
      'Level 4': 1,
    })
    // (the hold's rolling parcel: a particle per 4 s, then the Flipclaw Strike's 3)
    expect(usesByOption(energy, 'Kirara')).toEqual({
      Collision: 3,
      'Final Kick': 1,
    })
  })
})

describe('energy inputs: Mona', () => {
  it('her particles come with her Phantom’s explosion, not its first tick: their catcher is who is on the field then', () => {
    const team: CharacterKey[] = ['Mona', 'Bennett', 'Xiangling', 'Xingqiu']
    const sim = playTeam(
      team,
      'Mona E -> Bennett E Q N4 -> Xiangling N4 N4 N4 N4 -> Xingqiu E'
    )
    const onFieldAt = (t: number) =>
      (sim.swaps ?? [])
        .filter((w) => w.start + w.frames <= t)
        .sort((a, b) => a.start - b.start)
        .pop()?.to
    const monaHit = (node: string) =>
      sim.hits.find(
        (h) =>
          h.characterKey === 'Mona' &&
          h.path.join('.') === node &&
          h.t >= sim.start
      )!.t
    // (100 frames of travel)
    expect(onFieldAt(monaHit('skill.dot') + 100)).toBe('Bennett')
    expect(onFieldAt(monaHit('skill.dmg') + 100)).toBe('Xiangling')
    expect(energyFromRotation(sim, team, 2).members.Mona!.catchBy).toBe(
      'Xiangling'
    )
  })
})

describe('energy inputs: the Traveler’s Exaiphanes Blade', () => {
  it('fills the energy weapon triggers field with the triggers the calculator counts', () => {
    const team: CharacterKey[] = ['TravelerAnemo', 'Bennett']
    const sim = playTeam(team, 'TravelerAnemo E N5 N5 Q -> Bennett E Q')
    const energy = energyFromRotation(sim, team, 2)
    const counted =
      energy.members.TravelerAnemo!.weaponTriggers!.ExaiphanesBlade!
    expect(counted).toBeGreaterThan(0)
    const settings = withRotationEnergy(
      defaultEnergyCalculator(team, sim.frames / 120),
      team,
      energy
    )
    expect(settings.members.TravelerAnemo!.weaponEnergyTriggers).toBe(counted)
    // (the energy it gives at R1, 3 a trigger: the field's triggers)
    const held = calculateEnergyRecharge(team, settings, {
      TravelerAnemo: 'ExaiphanesBlade',
    })
    const none = calculateEnergyRecharge(team, settings, {})
    expect(
      held.members.TravelerAnemo!.flatEnergy -
        none.members.TravelerAnemo!.flatEnergy
    ).toBeCloseTo(3 * Math.min(counted, settings.rotationTime / 5), 5)
    // (a member who would trigger none, or several energy weapons of its type, keeps 0)
    expect(settings.members.Bennett!.weaponEnergyTriggers).toBe(0)
    // (a count set by hand is kept; the rotation's own count is refilled)
    const typed = withRotationEnergy(
      {
        ...settings,
        members: {
          ...settings.members,
          TravelerAnemo: {
            ...settings.members.TravelerAnemo!,
            weaponEnergyTriggers: counted + 1,
          },
        },
      },
      team,
      energy
    )
    expect(typed.members.TravelerAnemo!.weaponEnergyTriggers).toBe(counted + 1)
    expect(
      withRotationEnergy(settings, team, energy).members.TravelerAnemo!
        .weaponEnergyTriggers
    ).toBe(counted)
  })
})

describe('energy inputs: optional and alternative Bursts auto-default to every 2nd burst', () => {
  const zibaiTeam: CharacterKey[] = ['Columbina', 'Illuga', 'Linnea', 'Zibai']

  it('defaults Q? to every 2nd burst in ER calc while keeping mandatory Q as every rotation', () => {
    const sim = playTeam(
      zibaiTeam,
      'Columbina E Q? -> Illuga E Q -> Linnea E -> Zibai E N1 E N4 E N4 E Q E N2 E'
    )
    const energy = energyFromRotation(sim, zibaiTeam, 2)
    expect(energy.members.Columbina!.burstEvery).toBe(2)
    expect(energy.members.Illuga!.burstEvery).toBe(1)
    expect(energy.members.Linnea!.burstEvery).toBe(0)
    expect(energy.members.Zibai!.burstEvery).toBe(1)
  })

  it('defaults Q?/alt, Q/alt, EQ/E, E/EQ, QE/E, and E/QE to every 2nd burst', () => {
    for (const part of [
      'Columbina E Q?/N1',
      'Columbina E Q/N1',
      'Columbina EQ/E',
      'Columbina E/EQ',
      'Columbina QE/E',
      'Columbina E/QE',
    ]) {
      const sim = playTeam(
        zibaiTeam,
        `${part} -> Illuga E Q -> Linnea E -> Zibai E N1 E N4 E N4 E Q E N2 E`
      )
      const energy = energyFromRotation(sim, zibaiTeam, 2)
      expect(energy.members.Columbina!.burstEvery, part).toBe(2)
      expect(energy.members.Illuga!.burstEvery, part).toBe(1)
    }
  })

  it('stays at every 2nd (fixed point) when KQM replays with everyNthBursts, including burst-only steps', () => {
    const names = zibaiTeam.map((characterKey) => ({
      characterKey,
      name: characterKey,
    }))
    const parsed = parseRotation(
      'Columbina E Q? -> Illuga E Q -> Linnea E -> Zibai E N1 E N4 E N4 E Q E N2 E',
      names
    )
    const nth = everyNthBursts(parsed, { Columbina: 2 })!
    const sim = simulateRotation({
      rotation: nth.rotation,
      members: zibaiTeam,
      elements: Object.fromEntries(
        zibaiTeam.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: {},
      repeats: 4,
      keep: 'last2',
    })
    const energy = energyFromRotation(sim, zibaiTeam, 2 * nth.loops)
    expect(energy.members.Columbina!.burstEvery).toBe(2)

    // Burst-only step ("Ineffa Q?") omitted by everyNthBursts in the off-copy
    const flinsTeam: CharacterKey[] = [
      'Ineffa',
      'Columbina',
      'Sucrose',
      'Flins',
    ]
    const burstOnly = parseRotation(
      'Ineffa E -> Columbina E Q -> Sucrose E -> Flins E E N4 Q N4 -> Ineffa Q?',
      flinsTeam.map((characterKey) => ({ characterKey, name: characterKey }))
    )
    const nthOnly = everyNthBursts(burstOnly, { Ineffa: 2 })!
    const simOnly = simulateRotation({
      rotation: nthOnly.rotation,
      members: flinsTeam,
      elements: Object.fromEntries(
        flinsTeam.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: {},
      repeats: 4,
      keep: 'last2',
    })
    expect(
      energyFromRotation(simOnly, flinsTeam, 2 * nthOnly.loops).members.Ineffa!
        .burstEvery
    ).toBe(2)
  })

  it('does not double-halve Q? that was already skipped on cooldown in a 2-rotation text', () => {
    const team: CharacterKey[] = ['Ineffa', 'Columbina', 'Sucrose', 'Flins']
    // Two ~17s halves in one 34s written rotation: Sucrose's 2nd Q? is skipped on 20s CD, so
    // she already bursts once per 34s written rotation (burstEvery = 1, i.e. every 2nd Flins half).
    const sim = playTeam(
      team,
      'Ineffa Q -> Columbina E N1 -> Sucrose E N2 Q? -> Flins E E N4 D N3 Q N4 E Q N4 D N4 -> Sucrose N2 CA W8f -> Ineffa E N1 -> Columbina E Q -> Sucrose E N2 Q? -> Flins E E N4 D N3 Q N4 E Q N4 D N4 -> Sucrose N2 CA W8f -> Ineffa'
    )
    const energy = energyFromRotation(sim, team, 2)
    expect(energy.members.Sucrose!.burstEvery).toBe(1)
  })

  it('respects a manual burstEvery override over the Q? default', () => {
    const sim = playTeam(
      zibaiTeam,
      'Columbina E Q? -> Illuga E Q -> Linnea E -> Zibai E N1 E N4 E N4 E Q E N2 E'
    )
    const energy = energyFromRotation(sim, zibaiTeam, 2)
    const settings = defaultEnergyCalculator(zibaiTeam, 20)
    settings.members.Columbina = {
      ...settings.members.Columbina!,
      burstEvery: 1,
      edited: ['burstEvery'],
    }
    const filled = withRotationEnergy(settings, zibaiTeam, energy)
    expect(filled.members.Columbina!.burstEvery).toBe(1)
  })
})

describe('energy inputs: Faruzan Pressurized Collapse particles (5.5 s ICD) and C6 catching', () => {
  it('counts C6 off-field Pressurized Collapse drops even when Faruzan only casts Q, crediting each drop to the on-fielder', () => {
    const team: CharacterKey[] = ['Faruzan', 'Durin', 'Nicole', 'Xiao']
    const sim = playTeam(
      team,
      'Faruzan Q -> Durin E E Q -> Nicole E N1 -> Xiao E E Q 12[J HP[collision]] -> Faruzan',
      { Faruzan: 6 }
    )
    const energy = energyFromRotation(sim, team, 2, { Faruzan: 6 })
    const f = energy.members.Faruzan!
    expect(usesByOption(energy, 'Faruzan')).toEqual({ 'Aimed Shot': 3 })
    expect(f.catchBy).toBe('Xiao')
    expect(f.catchShares?.Xiao).toBeGreaterThan(50)
    // Every particle marker is >= 5.5 s (331 f) apart
    const markers = particleMarkers(sim, 'Faruzan')
    expect(markers).toHaveLength(6)
    for (let i = 1; i < markers.length; i++)
      expect(markers[i].t - markers[i - 1].t).toBeGreaterThanOrEqual(331)
  })

  it('splits catching between Faruzan (first drop) and the on-field DPS (C6 drops) in Wanderer teams', () => {
    const team: CharacterKey[] = ['Furina', 'Bennett', 'Faruzan', 'Wanderer']
    const sim = playTeam(
      team,
      'Furina E D Q -> Bennett Q E -> Faruzan Q E -> Wanderer N2 Q N1 E N1 CA 4[N2 D N2 CA] E? -> Furina',
      { Faruzan: 6, Bennett: 6 }
    )
    const energy = energyFromRotation(sim, team, 2, {
      Faruzan: 6,
      Bennett: 6,
    })
    const f = energy.members.Faruzan!
    expect(usesByOption(energy, 'Faruzan')).toEqual({ 'Aimed Shot': 3 })
    expect(f.catchBy).toBe('Wanderer')
    expect(f.catchShares).toEqual({ Faruzan: 33.3, Wanderer: 66.7 })
    expect(f.funnelShare).toBe(67)
  })

  it('gives 0 particles at C0 when E is cast without a Hurricane Arrow CA, and 1 Aimed Shot when E CA is used', () => {
    const team: CharacterKey[] = ['Faruzan', 'Bennett', 'Wanderer']
    const noCa = energyFromRotation(
      playTeam(
        team,
        'Faruzan E Q -> Bennett E Q -> Wanderer E N3 N3 N3 -> Faruzan',
        { Faruzan: 0 }
      ),
      team,
      2,
      { Faruzan: 0 }
    )
    expect(usesByOption(noCa, 'Faruzan')).toEqual({})
    expect(noCa.members.Faruzan!.skillUses).toBe(0)

    const withCa = energyFromRotation(
      playTeam(
        team,
        'Faruzan E CA Q -> Bennett E Q -> Wanderer E N3 N3 N3 -> Faruzan',
        { Faruzan: 0 }
      ),
      team,
      2,
      { Faruzan: 0 }
    )
    expect(usesByOption(withCa, 'Faruzan')).toEqual({ 'Aimed Shot': 1 })
    expect(withCa.members.Faruzan!.catchBy).toBe('Faruzan')
    expect(withCa.members.Faruzan!.catchShares).toEqual({ Faruzan: 100 })
  })
})

describe('energy inputs: Skill options that hold a constellation’s Energy', () => {
  const team: CharacterKey[] = ['Mavuika', 'Citlali', 'Iansan', 'Durin']
  const targets = (cons: number) => {
    const constellations = {
      Mavuika: 0,
      Citlali: cons,
      Iansan: cons,
      Durin: cons,
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Citlali E Q -> Iansan E Q -> Durin E E Q -> Mavuika E Q N4 N4 N4 CA',
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations,
      repeats: 4,
      keep: 'last2',
    })
    const filled = withRotationEnergy(
      defaultEnergyCalculator(team),
      team,
      energyFromRotation(sim, team, 2, constellations)
    )
    return calculateEnergyRecharge(team, filled, {}, constellations).targets
  }
  it('Citlali C4 and Iansan C1 lower their ER needs; Durin’s Skill Energy is counted once', () => {
    const c0 = targets(0)
    const c6 = targets(6)
    expect(c6.Citlali!).toBeLessThan(c0.Citlali! - 40)
    expect(c6.Iansan!).toBeLessThan(c0.Iansan! - 40)
    expect(c6.Durin!).toBeCloseTo(c0.Durin!, 1)
    expect(c0.Durin!).toBeLessThan(160)
  })
})
