/**
 * Mavuika with Citlali: whether her Flamestrider charged attacks Melt depends on which aura the
 * enemy is left with when her burst combo starts (gcsim's reactable, as ours: a Cryo trigger on
 * Pyro reverse-melts and leaves no Cryo behind).
 *
 * - "Citlali E Q N1": Ice Storm (2U Cryo) clears the Pyro aura, N1 lays Cryo, so each Pyro hit
 *   Mavuika applies melts and the next Frostfall Storm tick lays Cryo again. 5 of her 14 charged
 *   attacks melt (the ones that apply Pyro through the ICD): 5 of the 13 in the burst combo, as
 *   Prydwen counts.
 * - Without the N1 (or with "E N1 Q"), her first applying hit lays Pyro on a clean enemy: from
 *   there each Frostfall Storm tick only reverse-melts and Mavuika refreshes the Pyro, so none
 *   of her hits melt.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Mavuika', 'Bennett', 'Xilonen', 'Citlali']
const combo = 'Mavuika E C Q CD C3F D CF D CF D CD C2'
const charged = (citlali: string) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      `Mavuika E C -> Bennett E -> Xilonen E N2 -> Bennett Q -> ${citlali} -> ${combo}`,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Mavuika: 2, Bennett: 5, Xilonen: 0, Citlali: 0 },
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
  })
  const hits = sim.hits.filter(
    (h) =>
      h.characterKey === 'Mavuika' &&
      h.path[0] === 'skill' &&
      ['chargedCyclicDmg', 'chargedFinalDmg'].includes(h.path[1])
  )
  return {
    hits: hits.length,
    melt: hits.filter((h) => h.reaction === 'melt').length,
  }
}

describe('Mavuika charged attacks melting with Citlali', () => {
  it('melt when Citlali lays Cryo after her burst (E Q N1)', () => {
    expect(charged('Citlali E Q N1')).toEqual({ hits: 14, melt: 5 })
  })
  it('never melt when Pyro is on the enemy first (no N1, or E N1 Q)', () => {
    expect(charged('Citlali E Q')).toEqual({ hits: 14, melt: 0 })
    expect(charged('Citlali E N1 Q')).toEqual({ hits: 14, melt: 0 })
  })
})
