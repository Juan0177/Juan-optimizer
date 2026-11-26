import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { energyFromRotation } from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  simulateRotation,
  simulateRotationSamples,
} from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Mavuika', 'Bennett']
const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Mavuika: 'pyro', Bennett: 'pyro' },
    constellations: { Mavuika: cons },
    repeats: 1,
    keep: 'all',
  })

/** The state of one of Mavuika's conditionals at frame t */
const stateAt = (
  sim: ReturnType<typeof run>,
  cond: string,
  t: number
): string =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === 'Mavuika' &&
        w.path.join('.') === `Mavuika.${cond}` &&
        w.start <= t &&
        t < w.end
    )
    .map((w) => w.value)
    .at(-1) ?? ''

describe('Mavuika', () => {
  it('deals C6’s 200% Flamestrider crash in Ring form and the 500% Scorching Ring in Flamestrider form', () => {
    const ring = run('Mavuika E W5', 6).hits.filter(
      (h) => h.path[0] === 'constellation6'
    )
    expect(ring.length).toBeGreaterThan(0)
    expect(ring.every((h) => h.path[1] === 'flamestriderDmg')).toBe(true)
    const bike = run('Mavuika hE W5', 6).hits.filter(
      (h) => h.path[0] === 'constellation6'
    )
    expect(bike.length).toBeGreaterThan(0)
    expect(bike.every((h) => h.path[1] === 'ringDmg')).toBe(true)
  })

  it('keeps C1’s ATK on while she gains Fighting Spirit, and C2’s Ring shred only in Ring form', () => {
    const sim = run('Mavuika E W3', 2)
    const tick = sim.hits.find((h) => h.label === 'Rings of Searing Radiance')!
    expect(stateAt(sim, 'c1GainSpirit', tick.t)).toBe('on')
    expect(stateAt(sim, 'c2RingForm', tick.t)).toBe('on')
    const bike = run('Mavuika hE N2 W1', 2)
    const hit = bike.hits.find((h) => h.label === 'Flamestrider N1')!
    expect(stateAt(bike, 'c2RingForm', hit.t)).toBe('')
  })

  it('turns the Flamestrider back into the Ring when she leaves the field', () => {
    const sim = run('Mavuika hE N1 -> Bennett E W4', 0)
    const swap = sim.actions.find((a) => a.characterKey === 'Bennett')!.start
    expect(
      sim.hits.some(
        (h) => h.label === 'Rings of Searing Radiance' && h.t > swap
      )
    ).toBe(true)
  })
})

describe('Mavuika against kqmsim (Mavuika / Citlali / Iansan / Nicole, 2026-11-16)', () => {
  const team: CharacterKey[] = ['Mavuika', 'Citlali', 'Iansan', 'Nicole']
  const play = (gear = {}) =>
    simulateRotation({
      rotation: parseRotation(
        'Citlali E Q -> Iansan E Q -> Nicole E Q -> Mavuika E Q N4 N4 N4 N4 N4 -> Citlali',
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      elements: {
        Mavuika: 'pyro',
        Citlali: 'cryo',
        Iansan: 'electro',
        Nicole: 'pyro',
      },
      constellations: {},
      gear,
      repeats: 4,
      keep: 'all',
    })
  it('keeps the Crucible on her own clock: her hitlag lengthens it, so the Ring she leaves behind still hits', () => {
    // (kqmsim: the Ring's hit 2 s after each swap out of the Flamestrider, frames 1446, 2771, 4096)
    const rings = play()
      .hits.filter((h) => h.label === 'Rings of Searing Radiance')
      .map((h) => h.t)
    expect(rings.length).toBe(3)
    for (const [i, t] of [1446, 2771, 4096].entries())
      expect(Math.abs(rings[i] - t)).toBeLessThanOrEqual(2)
  })
  it('A Thousand Blazing Suns: its Nightsoul boost is on for her hits in the blessing only', () => {
    const sim = play({ Mavuika: { weapon: 'AThousandBlazingSuns' } })
    const boosted = sim.buffWindows.filter(
      (w) =>
        w.path.join('.') === 'AThousandBlazingSuns.nightsoul' &&
        w.value === 'on' &&
        w.end > w.start &&
        // (not a hit on the run's last frame: outside the counted span)
        w.start < sim.start + sim.frames
    )
    expect(boosted.length).toBeGreaterThan(10)
    // (each on the frame of one of her own hits)
    for (const w of boosted)
      expect(
        sim.hits.some(
          (h) =>
            h.characterKey === 'Mavuika' &&
            h.t === w.start &&
            !h.path[0].startsWith('_')
        )
      ).toBe(true)
    // (off the field too: the Ring left behind hits while she is still in the blessing)
    const rings = sim.hits.filter(
      (h) => h.label === 'Rings of Searing Radiance'
    )
    expect(rings.length).toBeGreaterThan(0)
    for (const h of rings)
      expect(boosted.some((w) => w.start === h.t)).toBe(true)
  })
})

describe("Mavuika's held Flamestrider Charged Attack in KQM's notation (C3FD C3FD CF)", () => {
  const team: CharacterKey[] = ['Mavuika', 'Citlali', 'Iansan', 'Nicole']
  const names = team.map((characterKey) => ({
    characterKey,
    name: characterKey,
  }))
  const text =
    'Nicole E -> Iansan E CA Q -> Citlali E Q -> Mavuika E CA Q C3FD C3FD CF -> Nicole'
  it('reads C<n> as spins and F as the finisher, for Mavuika only', () => {
    const parsed = parseRotation(text, names)
    expect(parsed.warnings).toEqual([])
    const mavuika = parsed.steps.find((s) => s.characterKey === 'Mavuika')!
    expect(
      mavuika.actions.map((a) => [a.kind, a.spins, a.final ?? false])
    ).toEqual([
      ['skill', undefined, false],
      ['charged', undefined, false],
      ['burst', undefined, false],
      ['charged', 3, true],
      ['dash', undefined, false],
      ['charged', 3, true],
      ['dash', undefined, false],
      ['charged', 1, true],
    ])
    const other = parseRotation('Iansan C3F', names)
    expect(other.warnings[0]).toMatch(
      /Mavuika's Flamestrider Charged Attack only/
    )
    expect(other.steps[0].actions[0].spins).toBeUndefined()
  })
  it('spins 45 frames apart and dashes after the finisher hitlag', () => {
    const sim = simulateRotation({
      rotation: parseRotation(text, names),
      members: team,
      elements: {
        Mavuika: 'pyro',
        Citlali: 'cryo',
        Iansan: 'electro',
        Nicole: 'pyro',
      },
      constellations: {},
      repeats: 2,
      keep: 'all',
    })
    const charged = sim.hits
      .filter(
        (h) =>
          h.characterKey === 'Mavuika' &&
          h.label?.startsWith('Flamestrider Charged Attack') &&
          h.t < 1150
      )
      .sort((a, b) => a.t - b.t)
    const cyclic = charged.filter((h) => h.label!.endsWith('(Cyclic)'))
    const final = charged.filter((h) => h.label!.endsWith('(Final)'))
    // (3 + 3 + 1 spins, 3 finishers: none cancelled)
    expect(cyclic.length).toBe(7)
    expect(final.length).toBe(3)
    expect(cyclic[1].t - cyclic[0].t).toBe(45)
    expect(cyclic[2].t - cyclic[1].t).toBe(45)
    const dashes = (sim.actions ?? []).filter(
      (a) => a.characterKey === 'Mavuika' && a.text === 'D'
    )
    expect(dashes[0].start - final[0].t).toBe(3)
  })

  it('counts an ending finisher inside its own rotation on the opener and repeat', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Mavuika hE C3F', [
        { characterKey: 'Mavuika', name: 'Mavuika' },
      ]),
      members: ['Mavuika'],
      elements: { Mavuika: 'pyro' },
      constellations: {},
      repeats: 2,
      keep: 'all',
    })
    const finals = sim.hits.filter(
      (h) => h.label === 'Flamestrider Charged Attack (Final)'
    )
    expect(finals).toHaveLength(2)
    for (const [i, start] of sim.rotationStarts!.entries()) {
      expect(finals[i].t).toBeGreaterThanOrEqual(start)
      expect(finals[i].t).toBeLessThan(start + sim.rotationFrames![i])
    }
  })

  it('uses full finisher recovery before starting another Charged Attack', () => {
    const sim = run('Mavuika hE CF C', 0)
    const final = sim.hits.find(
      (h) => h.label === 'Flamestrider Charged Attack (Final)'
    )!
    const next = sim.actions.find((a) => a.text === 'C')!
    expect(next.start - final.t).toBe(32)
  })
})

describe('Mavuika Skill recast (form switch), cancelled CA finishers, and Citlali Melt combos', () => {
  it('recasts E during Nightsoul’s Blessing while E is on CD to switch Ring <-> Flamestrider without damage, particles, or a 15 s stall', () => {
    // E enters Ring (15 s CD); E at frame 19 recasts to Flamestrider (13 f into CA, 60 f recast CD);
    // C -> Q cancels the unreached Finisher; second recast switches back to Ring.
    const sim = run('Mavuika E E C Q W2 E W3', 2)
    const skills = sim.actions.filter(
      (a) => a.characterKey === 'Mavuika' && a.text === 'E'
    )
    expect(skills.length).toBe(3)
    expect(skills[0].variant).toBeUndefined()
    expect(skills[1].variant?.key).toBe('recastBike')
    expect(skills[1].frames).toBe(13)
    expect(skills[2].variant?.key).toBe('recastRing')
    // No 15 s cooldown stall on either recast
    expect(sim.stalls).toEqual({})
    // Only the initial E deals skill damage and produces particles (5 Pyro, 1 use)
    const skillDmg = sim.hits.filter(
      (h) =>
        h.characterKey === 'Mavuika' && h.path.join('.') === 'skill.skillDmg'
    )
    expect(skillDmg).toHaveLength(1)
    const energy = energyFromRotation(sim, members, 1, { Mavuika: 2 })
    expect(energy.members.Mavuika!.skillUses).toBe(1)
    // C2 Ring shred turns off when switching to Bike and turns back on when switching to Ring
    expect(stateAt(sim, 'c2RingForm', skills[1].start - 1)).toBe('on')
    expect(stateAt(sim, 'c2RingForm', skills[1].start + 1)).toBe('')
    expect(stateAt(sim, 'c2RingForm', skills[2].start + 1)).toBe('on')
    // Cancelled C before Q must NOT fire a phantom Finisher during Q
    const finals = sim.hits.filter(
      (h) => h.label === 'Flamestrider Charged Attack (Final)'
    )
    expect(finals).toHaveLength(0)
  })

  it('respects the 60-frame skillRecast cooldown between consecutive form switches', () => {
    const sim = run('Mavuika E E E', 0)
    const skills = sim.actions.filter(
      (a) => a.characterKey === 'Mavuika' && a.text === 'E'
    )
    expect(skills).toHaveLength(3)
    expect(skills[1].variant?.key).toBe('recastBike')
    expect(skills[2].variant?.key).toBe('recastRing')
    expect(skills[2].start - skills[1].start).toBe(60)
  })

  it('uses 6 f dash charge-cancel after CD/C3F/CF and 20 f inside CDC lockout (C2D)', () => {
    const cdc = run('Mavuika hE C D C', 0)
    const cdcDash = cdc.actions.find((a) => a.text === 'D')!
    expect(cdcDash.frames).toBe(6)
    const c2d = run('Mavuika hE C2 D C2', 0)
    const c2dDash = c2d.actions.find((a) => a.text === 'D')!
    expect(c2dDash.frames).toBe(20)
  })

  it('Melts Sunfell Slice and 5 Flamestrider Charged Attacks in Citlali Melt teams with Skill recast', () => {
    const team: CharacterKey[] = ['Mavuika', 'Citlali', 'Xilonen', 'Bennett']
    const names = team.map((characterKey) => ({
      characterKey,
      name: characterKey,
    }))
    const text =
      'Mavuika E -> Bennett E -> Xilonen E N2 -> Bennett Q -> Citlali E Q N1 -> Mavuika E C Q CD C3F D CF D CF D CD C2 D -> Mavuika'
    const sim = simulateRotationSamples({
      rotation: parseRotation(text, names),
      members: team,
      elements: {
        Mavuika: 'pyro',
        Citlali: 'cryo',
        Xilonen: 'geo',
        Bennett: 'pyro',
      },
      constellations: { Mavuika: 2, Bennett: 6 },
      repeats: 4,
      keep: 'last2',
    })
    const samples = sim.samples ?? [{ probability: 1, result: sim }]
    const avg = (fn: (r: typeof sim) => number) =>
      samples.reduce((sum, s) => sum + s.probability * fn(s.result), 0) / 2
    // ~18.2 s with no cooldown stalls (previously stretched to 30.6 s without recast)
    expect(sim.frames / 120).toBeLessThan(18.5)
    expect(sim.stalls).toEqual({})
    // Sunfell Slice + 2 Cyclic + 3 Final Charged Attacks Melt across all Citlali Skull samples
    expect(
      avg(
        (r) =>
          r.hits.filter(
            (h) =>
              h.characterKey === 'Mavuika' &&
              h.label === 'Sunfell Slice' &&
              h.reaction === 'melt'
          ).length
      )
    ).toBeCloseTo(1, 2)
    expect(
      avg(
        (r) =>
          r.hits.filter(
            (h) =>
              h.characterKey === 'Mavuika' &&
              h.label?.startsWith('Flamestrider Charged Attack') &&
              h.reaction === 'melt'
          ).length
      )
    ).toBeCloseTo(5, 2)
  })
})

describe('Mavuika Skill recast (form switch), cancelled CA finishers, and Citlali Melt combos', () => {
  it('recasts E during Nightsoul’s Blessing while E is on CD to switch Ring <-> Flamestrider without damage, particles, or a 15 s stall', () => {
    // E enters Ring (15 s CD); E at frame 19 recasts to Flamestrider (13 f into CA, 60 f recast CD);
    // C -> Q cancels the unreached Finisher; second recast switches back to Ring.
    const sim = run('Mavuika E E C Q W2 E W3', 2)
    const skills = sim.actions.filter(
      (a) => a.characterKey === 'Mavuika' && a.text === 'E'
    )
    expect(skills.length).toBe(3)
    expect(skills[0].variant).toBeUndefined()
    expect(skills[1].variant?.key).toBe('recastBike')
    expect(skills[1].frames).toBe(13)
    expect(skills[2].variant?.key).toBe('recastRing')
    // No 15 s cooldown stall on either recast
    expect(sim.stalls).toEqual({})
    // Only the initial E deals skill damage and produces particles (5 Pyro, 1 use)
    const skillDmg = sim.hits.filter(
      (h) =>
        h.characterKey === 'Mavuika' && h.path.join('.') === 'skill.skillDmg'
    )
    expect(skillDmg).toHaveLength(1)
    const energy = energyFromRotation(sim, members, 1, { Mavuika: 2 })
    expect(energy.members.Mavuika!.skillUses).toBe(1)
    // C2 Ring shred turns off when switching to Bike and turns back on when switching to Ring
    expect(stateAt(sim, 'c2RingForm', skills[1].start - 1)).toBe('on')
    expect(stateAt(sim, 'c2RingForm', skills[1].start + 1)).toBe('')
    expect(stateAt(sim, 'c2RingForm', skills[2].start + 1)).toBe('on')
    // Cancelled C before Q must NOT fire a phantom Finisher during Q
    const finals = sim.hits.filter(
      (h) => h.label === 'Flamestrider Charged Attack (Final)'
    )
    expect(finals).toHaveLength(0)
  })

  it('respects the 60-frame skillRecast cooldown between consecutive form switches', () => {
    const sim = run('Mavuika E E E', 0)
    const skills = sim.actions.filter(
      (a) => a.characterKey === 'Mavuika' && a.text === 'E'
    )
    expect(skills).toHaveLength(3)
    expect(skills[1].variant?.key).toBe('recastBike')
    expect(skills[2].variant?.key).toBe('recastRing')
    expect(skills[2].start - skills[1].start).toBe(60)
  })

  it('uses 6 f dash charge-cancel after CD/C3F/CF and 20 f inside CDC lockout (C2D)', () => {
    const cdc = run('Mavuika hE C D C', 0)
    const cdcDash = cdc.actions.find((a) => a.text === 'D')!
    expect(cdcDash.frames).toBe(6)
    const c2d = run('Mavuika hE C2 D C2', 0)
    const c2dDash = c2d.actions.find((a) => a.text === 'D')!
    expect(c2dDash.frames).toBe(20)
  })

  it('Melts Sunfell Slice and 5 Flamestrider Charged Attacks in Citlali Melt teams with Skill recast', () => {
    const team: CharacterKey[] = ['Mavuika', 'Citlali', 'Xilonen', 'Bennett']
    const names = team.map((characterKey) => ({
      characterKey,
      name: characterKey,
    }))
    const text =
      'Mavuika E -> Bennett E -> Xilonen E N2 -> Bennett Q -> Citlali E Q N1 -> Mavuika E C Q CD C3F D CF D CF D CD C2 D -> Mavuika'
    const sim = simulateRotationSamples({
      rotation: parseRotation(text, names),
      members: team,
      elements: {
        Mavuika: 'pyro',
        Citlali: 'cryo',
        Xilonen: 'geo',
        Bennett: 'pyro',
      },
      constellations: { Mavuika: 2, Bennett: 6 },
      repeats: 4,
      keep: 'last2',
    })
    const samples = sim.samples ?? [{ probability: 1, result: sim }]
    const avg = (fn: (r: typeof sim) => number) =>
      samples.reduce((sum, s) => sum + s.probability * fn(s.result), 0) / 2
    // ~18.2 s with no cooldown stalls (previously stretched to 30.6 s without recast)
    expect(sim.frames / 120).toBeLessThan(18.5)
    expect(sim.stalls).toEqual({})
    // Sunfell Slice + 2 Cyclic + 3 Final Charged Attacks Melt across all Citlali Skull samples
    expect(
      avg(
        (r) =>
          r.hits.filter(
            (h) =>
              h.characterKey === 'Mavuika' &&
              h.label === 'Sunfell Slice' &&
              h.reaction === 'melt'
          ).length
      )
    ).toBeCloseTo(1, 2)
    expect(
      avg(
        (r) =>
          r.hits.filter(
            (h) =>
              h.characterKey === 'Mavuika' &&
              h.label?.startsWith('Flamestrider Charged Attack') &&
              h.reaction === 'melt'
          ).length
      )
    ).toBeCloseTo(5, 2)
  })
})
