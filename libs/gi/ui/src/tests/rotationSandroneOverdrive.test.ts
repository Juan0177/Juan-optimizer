import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Sandrone']
const run = (text: string) =>
  simulateRotation({
    rotation: parseRotation(text, [
      { characterKey: 'Sandrone', name: 'Sandrone' },
    ]),
    members,
    constellations: { Sandrone: 0 },
    elements: { Sandrone: 'cryo' },
    repeats: 1,
    keep: 'all',
  })

describe('Sandrone Power Overdrive', () => {
  it('fires every 24 frames after a full Decoding charge, until Decoding Power is under 50', () => {
    // (Power Overdrive begins 19 frames after Decoding Power is full: the 3rd beam's charge
    // fills it, so the next charge waits for it)
    const sim = run('Sandrone CA W4 CA W5')
    const shots = sim.hits.filter((h) => h.label === 'Power Overdrive')
    expect(sim.warnings).toEqual([])
    expect(shots.length).toBeGreaterThan(5)
    expect(shots[1].t - shots[0].t).toBe(24)
    // Decoding Power decays from 100 to under 50 in about 10 s on field
    expect(shots.at(-1)!.t - shots[0].t).toBeLessThanOrEqual(600)
  })
  it('is not available before Decoding Power reaches its maximum', () => {
    const sim = run('Sandrone CA W5')
    expect(sim.hits.filter((h) => h.label === 'Power Overdrive')).toHaveLength(
      0
    )
  })
})

describe('Sandrone Decoding charges (gcsim b107b5d)', () => {
  it('releases each charge after 3 beams: CA E Q CA E CA E keeps gcsim’s timeline', () => {
    const sim = run('Sandrone CA E Q CA E CA E')
    expect(sim.warnings).toEqual([])
    // gcsim: charge@1 skill@225 burst@231 charge@359 skill@558 charge@604 skill@803
    expect(sim.actions.map((a) => a.start)).toEqual([
      0, 224, 230, 358, 557, 603, 802,
    ])
    expect(
      sim.hits.filter((h) => h.label.startsWith('Condensed Beam'))
    ).toHaveLength(9)
    expect(sim.hits.filter((h) => h.label === 'Sweeping Fire')).toHaveLength(27)
  })
  it('repairs Fagio while she hovers: a Skill cancelled at once leaves Decoding Power', () => {
    // E Q cancels the Skill at 6 frames: 70 + 10 repaired. The Burst's 128 frames of decay
    // (25 every 30 on field) bring a full Fagio from 100 to under 21.2: the next charge fires 3.
    const sim = run('Sandrone CA E Q CA')
    expect(
      sim.hits.filter((h) => h.label.startsWith('Condensed Beam'))
    ).toHaveLength(6)
  })
  it('normal attacks into a charge take their whole animation (53, 46, 87 frames)', () => {
    // gcsim: attack@1 charge@64 (53 + 10 hitlag)
    const sim = run('Sandrone N1 CA')
    expect(sim.actions[1].start - sim.actions[0].start).toBe(63)
  })
})
