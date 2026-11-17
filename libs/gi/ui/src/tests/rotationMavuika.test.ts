import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

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
  it('spins 45 frames apart, then the finisher, and the dash comes at the finisher', () => {
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
    expect(dashes[0].start).toBe(final[0].t)
  })
})
