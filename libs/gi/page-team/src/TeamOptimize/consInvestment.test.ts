import { describe, expect, it } from 'vitest'
import { bestInvestments, spreads } from './consInvestment'

describe('constellation investment', () => {
  it('lists every way to spend a cost within each member’s room', () => {
    expect(spreads([2, 0, 1], 2)).toEqual([
      [1, 0, 1],
      [2, 0, 0],
    ])
    expect(spreads([6, 6, 6, 6], 12)).toHaveLength(231)
    expect(spreads([1, 1], 3)).toEqual([])
  })

  it('finds each cost’s best from the members alone, playing only the close ones', async () => {
    // four members from C0: each constellation's gain alone, and a team where two members'
    // constellations do more together than apart (a buffer's and a carry's)
    const gain = [
      [0, 0.02, 0.15, 0.16, 0.2, 0.21, 0.4],
      [0, 0.08, 0.1, 0.11, 0.12, 0.13, 0.14],
      [0, 0.01, 0.01, 0.02, 0.02, 0.03, 0.05],
      [0, 0.05, 0.06, 0.07, 0.15, 0.16, 0.3],
    ]
    const BASE = 1000
    const truth = (cons: number[]) =>
      BASE *
      cons.reduce((p, c, i) => p * (1 + gain[i][c]), 1) *
      (cons[0] >= 2 && cons[1] >= 1 ? 1.03 : 1)
    const evaluated: string[] = []
    const found = await bestInvestments({
      base: [0, 0, 0, 0],
      baseDps: BASE,
      single: (i, c) => truth([0, 1, 2, 3].map((k) => (k === i ? c : 0))),
      evaluate: async (cons) => {
        evaluated.push(cons.join())
        return truth(cons)
      },
    })
    expect(found).toHaveLength(25)
    for (const best of found!) {
      const all = spreads([6, 6, 6, 6], best.cost).map(truth)
      expect(best.dps).toBeCloseTo(Math.max(...all), 6)
      expect(best.cons.reduce((a, b) => a + b, 0)).toBe(best.cost)
    }
    // (far fewer played than the 2401 there are)
    expect(evaluated.length).toBeLessThan(100)
    expect(new Set(evaluated).size).toBe(evaluated.length)
  })

  it('starts from the run’s constellations and stops at C6 for everyone', async () => {
    const found = await bestInvestments({
      base: [6, 5, 6, 4],
      baseDps: 100,
      single: (i, c) => 100 + (i + 1) * c,
      evaluate: async (cons) => 100 + cons[1] * 2 + cons[3] * 4 - 30,
    })
    expect(found?.map((x) => x.cost)).toEqual([0, 1, 2, 3])
    expect(found?.[0].cons).toEqual([6, 5, 6, 4])
    expect(found?.[3].cons).toEqual([6, 6, 6, 6])
  })
})
