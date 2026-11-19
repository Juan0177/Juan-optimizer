import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

describe('Yoimiya kit', () => {
  it("doesn't count her Physical arrows before Niwabi Fire-Dance toward its Pyro ICD", () => {
    const applied: string[] = []
    simulateRotation({
      rotation: parseRotation('Yoimiya N1 E N5 W2', [
        { characterKey: 'Yoimiya', name: 'Yoimiya' },
      ]),
      members: ['Yoimiya'],
      elements: { Yoimiya: 'pyro' } as never,
      constellations: { Yoimiya: 0 },
      repeats: 1,
      keep: 'all',
      auraTrace: (e) => {
        if (e.characterKey === 'Yoimiya') applied.push(e.label)
      },
    })
    // gcsim: hits 1, 4 and 7 of the Pyro string apply (N1's first arrow, N3, N5)
    expect(applied).toEqual(['N1', 'N3', 'N5'])
  })
})
