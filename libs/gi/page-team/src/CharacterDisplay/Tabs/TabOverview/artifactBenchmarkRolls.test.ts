import { describe, expect, it } from 'vitest'
import { artifactBenchmarks } from './artifactBenchmarkRolls'

describe('equipped artifact benchmarks', () => {
  it('counts normalized active useful substats against a full five-piece budget', () => {
    const result = artifactBenchmarks(
      {
        flower: {
          rarity: 5,
          mainStatKey: 'hp',
          substats: [
            { key: 'critRate_', accurateValue: 9.93 },
            { key: 'eleMas', accurateValue: 19.82 },
            { key: 'def_', accurateValue: 17 },
          ],
        },
        plume: undefined,
        sands: undefined,
        goblet: undefined,
        circlet: undefined,
      },
      new Set(['critRate_', 'critDMG_', 'eleMas', 'pyro_dmg_'])
    )
    expect(result.rolls).toBeCloseTo(4)
    expect(result.equipped).toBe(1)
    expect(result.benchmarks.map(({ baseline }) => baseline)).toEqual([
      26, 35, 40,
    ])
  })

  it('adjusts for 4★ pieces and a useful stat that appears as the main stat', () => {
    const result = artifactBenchmarks(
      {
        flower: undefined,
        plume: undefined,
        sands: {
          rarity: 4,
          mainStatKey: 'eleMas',
          substats: [],
        },
        goblet: undefined,
        circlet: undefined,
      },
      new Set(['eleMas'])
    )
    expect(result.benchmarks[0].baseline).toBeCloseTo(9.6)
    expect(result.benchmarks.slice(1).map(({ baseline }) => baseline)).toEqual([
      20, 24,
    ])
  })
})
