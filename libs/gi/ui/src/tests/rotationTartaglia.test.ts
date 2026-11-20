import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function playOnce(text: string, members: CharacterKey[]) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: Object.fromEntries(members.map((m) => [m, 0])),
    repeats: 1,
    keep: 'all',
  })
}

const startOf = (
  sim: ReturnType<typeof simulateRotation>,
  text: string,
  n = 0
) => sim.actions.filter((a) => a.text === text)[n].start

describe('Tartaglia kit', () => {
  it('casts his walking Skill after a walk (WK), his standing one after a wait', () => {
    const walk = playOnce('Tartaglia WK E N1 W1', ['Tartaglia'])
    const wait = playOnce('Tartaglia W1f E N1 W1', ['Tartaglia'])
    const tide = (sim: ReturnType<typeof simulateRotation>) =>
      sim.hits.find((h) => h.label === 'Foul Legacy: Raging Tide')!.t -
      startOf(sim, 'E')
    // gcsim skillRangedWalkFrames: the hit at 3, a normal attack at 5 (16 and 19 standing)
    expect([tide(walk), startOf(walk, 'N1') - startOf(walk, 'E')]).toEqual([
      3, 5,
    ])
    expect([tide(wait), startOf(wait, 'N1') - startOf(wait, 'E')]).toEqual([
      16, 19,
    ])
  })
  it('leaves the Melee Stance with the walking frames after a walk', () => {
    const sim = playOnce('Tartaglia E N1 WK E N1 W1', ['Tartaglia'])
    expect(startOf(sim, 'N1', 1) - startOf(sim, 'E', 1)).toBe(5)
  })
})

describe("Bennett's Inspiration Field", () => {
  it("gives Kazuha's Skill Pyro to absorb from the player while the enemy has only Hydro", () => {
    const sim = playOnce('Tartaglia E -> Bennett Q -> Kazuha E P', [
      'Tartaglia',
      'Bennett',
      'KaedeharaKazuha',
    ])
    expect(
      sim.hits.find((h) => h.label === 'Soumon Swordsmanship (A1)')?.element
    ).toBe('pyro')
  })
})
