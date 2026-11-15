/**
 * The pace a rotation keeps played over and over (4 in a row, the last 2 counted, as KQM and the
 * writer count it): a cooldown not ready again in time makes it wait, which its first time
 * through does not show; and the last counted rotation alone (`lastRotation`), what a timeline
 * shows.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  lastRotation,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Sucrose', 'Bennett']
const play = (text: string, constellation: number) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Sucrose: constellation, Bennett: 6 },
    elements: { Sucrose: 'anemo', Bennett: 'pyro' },
    repeats: 4,
    keep: 'last2',
  })

describe('the pace a rotation keeps', () => {
  // Sucrose C1: two charges of her Skill, each back 15 s after use, one at a time
  const text = 'Sucrose E -> Bennett N1 N1 -> Sucrose E -> Bennett N1'
  it('two Skills a rotation run freely the first time, then wait for the charges', () => {
    const sim = play(text, 1)
    const [first] = sim.rotationFrames!
    const perRotation = sim.frames / 2
    // (a 15 s charge for each of the two uses: about 30 s a rotation once they are spent)
    expect(first / 60).toBeLessThan(10)
    expect(perRotation / 60).toBeGreaterThan(25)
    expect(
      Object.keys(sim.stalls ?? {}).some((k) => k.startsWith('Sucrose'))
    ).toBe(true)
  })
  it('the last counted rotation alone: its hits, actions and counted-buff indices', () => {
    const sim = play(text, 1)
    const last = lastRotation(sim)
    const [, lastStart] = sim.rotationStarts!
    expect(last.start).toBe(lastStart)
    expect(last.start + last.frames).toBe(sim.start + sim.frames)
    expect(last.hits.length).toBeGreaterThan(0)
    expect(last.hits.every((h) => h.t >= lastStart)).toBe(true)
    expect(last.actions.every((a) => a.start >= lastStart)).toBe(true)
    expect(last.hits.length).toBeLessThan(sim.hits.length)
    for (const b of last.countedBuffs)
      for (const i of b.hits) expect(i).toBeLessThan(last.hits.length)
  })
  it('a rotation that keeps its pace: every rotation as long as the first', () => {
    // (16 s between her Skills: longer than its 15 s cooldown)
    const sim = play('Sucrose E -> Bennett N1 W16', 0)
    const [first] = sim.rotationFrames!
    expect(Math.abs(sim.frames / 2 - first)).toBeLessThan(30)
  })
})
