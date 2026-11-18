import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Mavuika', 'Citlali', 'Xilonen']
const play = (text: string) => {
  const rotation = parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )
  const sim = simulateRotation({
    rotation,
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: 4,
    keep: 'last2',
  })
  return { rotation, sim }
}

describe('a wait typed halfway (a player report: the tab froze while adding a wait)', () => {
  it('skips a wait without a length ("W.", "W..", "W.f") with a warning, and the play ends', () => {
    for (const w of ['W.', 'w.', 'W..', 'W.f', 'w.0.']) {
      const { rotation, sim } = play(
        `Xilonen E N2 -> Citlali E Q ${w} -> Mavuika Q`
      )
      expect(
        rotation.steps.flatMap((s) => s.actions).some((a) => a.kind === 'wait')
      ).toBe(false)
      expect(rotation.warnings.join(' ')).toContain('is not a wait')
      expect(Number.isFinite(sim.frames)).toBe(true)
    }
  })
  it('still reads real waits: W1.5, W.5, W0., W90f', () => {
    const counts = parseRotation('Citlali W1.5 W.5 W0. W90f', [
      { characterKey: 'Citlali', name: 'Citlali' },
    ]).steps[0].actions.map((a) => a.count)
    expect(counts).toEqual([1.5, 0.5, 0, 1.5])
  })
})
