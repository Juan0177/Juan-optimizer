import { KEEP_BASE_ROTATION } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { comboRotationOf, consRotationOf } from './ConsRotations'

describe('rotations per constellation', () => {
  it('plays its own, else the nearest lower one’s, else the team’s; the run’s plays the team’s', () => {
    const rotations = { 2: 'Flins E Q', 5: 'Flins E E Q' }
    expect(consRotationOf(rotations, 1, 0)).toEqual({})
    expect(consRotationOf(rotations, 2, 0)).toEqual({
      text: 'Flins E Q',
      from: 2,
    })
    expect(consRotationOf(rotations, 4, 0)).toEqual({
      text: 'Flins E Q',
      from: 2,
    })
    expect(consRotationOf(rotations, 6, 0)).toEqual({
      text: 'Flins E E Q',
      from: 5,
    })
    // (run at C3: the chain starts again above it)
    expect(consRotationOf(rotations, 4, 3)).toEqual({})
    expect(consRotationOf(rotations, 3, 3)).toEqual({})
    expect(consRotationOf(rotations, 2, 3)).toEqual({
      text: 'Flins E Q',
      from: 2,
    })
  })

  it('respects KEEP_BASE_ROTATION pins so a higher constellation can revert back to the team rotation', () => {
    const rotations = {
      1: 'Vesna E E E Q E E N6 E N6 E',
      3: KEEP_BASE_ROTATION,
    }
    expect(consRotationOf(rotations, 1, 0)).toEqual({
      text: 'Vesna E E E Q E E N6 E N6 E',
      from: 1,
    })
    expect(consRotationOf(rotations, 3, 0)).toEqual({
      from: 3,
      pinnedBase: true,
    })
    expect(consRotationOf(rotations, 4, 0)).toEqual({
      from: 3,
      pinnedBase: true,
    })
  })

  it('uses a combination’s rotation for it and higher ones, the most specific first', () => {
    const base = { Flins: 0, Danica: 0, Ineffa: 6 }
    const combos = [
      { cons: { Flins: 2, Danica: 1 }, text: 'both' },
      { cons: { Flins: 4, Danica: 1 }, text: 'flins4' },
      // (one member raised: not a combination)
      { cons: { Flins: 1 }, text: 'alone' },
    ]
    expect(comboRotationOf(combos, { Flins: 2, Danica: 1 }, base)).toBe('both')
    expect(comboRotationOf(combos, { Flins: 3, Danica: 2 }, base)).toBe('both')
    expect(comboRotationOf(combos, { Flins: 6, Danica: 1 }, base)).toBe(
      'flins4'
    )
    expect(
      comboRotationOf(combos, { Flins: 2, Danica: 0 }, base)
    ).toBeUndefined()
    expect(
      comboRotationOf(combos, { Flins: 1, Danica: 1 }, base)
    ).toBeUndefined()
  })
})
