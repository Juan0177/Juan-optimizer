/**
 * Diona's C1: 15 flat Energy when Signature Mix ends (kqmsim/gcsim burst.go, 58 + 750 frames), as
 * the ER calculator's bonus energy. (Revelation's paws follow kqmsim, the reference for the
 * Stellar kits: rotationCynoDionaYae.test.ts.)
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { energyFromRotation } from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {},
  options: { repeats?: number; keep?: 'all' | 'last2' } = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations,
    repeats: options.repeats ?? 1,
    keep: options.keep ?? 'all',
  })
describe('Diona', () => {
  it('C1: 15 flat Energy when Signature Mix ends, in the ER calculator', () => {
    const c1 = run('Diona Q W14', ['Diona'], { Diona: 1 })
    expect(
      c1.hits
        .filter((h) => h.path[0] === '_marker' && h.path[1] === 'flatEnergy')
        .map((h) => [h.t, h.path[2]])
    ).toEqual([[808, '15']])
    const team: CharacterKey[] = ['Diona', 'Fischl']
    const flat = (cons: number) =>
      energyFromRotation(
        run(
          'Diona hE Q -> Fischl E W15',
          team,
          { Diona: cons },
          {
            repeats: 4,
            keep: 'last2',
          }
        ),
        team,
        2,
        { Diona: cons }
      ).members.Diona!.flatEnergy ?? 0
    expect(flat(0)).toBe(0)
    expect(flat(1)).toBe(15)
  })
})
