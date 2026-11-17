/**
 * KQM's artifact standard: KQM Standards place 20 rolls for damage, at most 2 per piece whose
 * main stat is not that stat; a higher standard (25, 30, 40 or a custom number) places more, its
 * per-piece cap one higher per 10 rolls (rounded up), at most the game's 5 upgrades a piece.
 */
import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import {
  KQM_ROLLS,
  type KqmMains,
  type KqmMainValues,
  type KqmProblem,
  kqmPieceCap,
  kqmRarity,
  kqmRollBudget,
  kqmRollCaps,
  placeRolls,
} from '@genshin-optimizer/gi/solver'
import { describe, expect, it } from 'vitest'

const mainValues: KqmMainValues = {
  hp: 4780,
  atk: 311,
  atk_: 0.466,
  critRate_: 0.311,
  critDMG_: 0.622,
  pyro_dmg_: 0.466,
}
const mains: KqmMains = {
  sands: 'atk_',
  goblet: 'pyro_dmg_',
  circlet: 'critRate_',
}
/** Damage from ATK% and CRIT (capped at 100% CRIT Rate), no requirements */
const problem = (rolls?: number): KqmProblem => {
  const out = new Float64Array(1)
  const values = (v: Record<string, number>) => {
    out[0] =
      (1 + (v['atk_'] ?? 0)) *
      (1 +
        Math.min(1, 0.05 + (v['critRate_'] ?? 0)) *
          (0.5 + (v['critDMG_'] ?? 0)))
    return out
  }
  return {
    run: (v) => ({ total: values(v)[0], cons: [] }),
    values,
    nTerms: 1,
    mins: [],
    scales: new Set(['atk_', 'critRate_', 'critDMG_']),
    rolls,
  }
}
const count = (rolls: Partial<Record<SubstatKey, number>>) =>
  Object.values(rolls).reduce((n, r) => n + (r ?? 0), 0)

describe('the artifact standard', () => {
  it('KQM Standards by default: 20 rolls, at most 2 a piece', () => {
    expect(kqmRollBudget(undefined)).toBe(KQM_ROLLS)
    expect(kqmRollBudget(Number.NaN)).toBe(KQM_ROLLS)
    expect(kqmRollBudget(25.4)).toBe(25)
    expect(kqmPieceCap()).toBe(2)
    // (CRIT Rate on 4 pieces: the circlet is CRIT Rate; ATK% on 4: the sands)
    const caps = kqmRollCaps(mains)
    expect(caps.critRate_).toBe(8)
    expect(caps.critDMG_).toBe(10)
    expect(caps.atk_).toBe(8)
  })
  it('a higher standard’s per-piece cap: one more per 10 rolls, at most 5', () => {
    expect([10, 20, 25, 30, 40, 45, 60].map(kqmPieceCap)).toEqual([
      1, 2, 3, 3, 4, 5, 5,
    ])
    expect(kqmRollCaps(mains, 40).critDMG_).toBe(20)
    expect(kqmRollCaps(mains, 25).critRate_).toBe(12)
  })
  it('4★ pieces: 2 rolls fewer each, whatever the standard', () => {
    const sets = { Instructor: 4 }
    const values = { ...mainValues, fourStarSets: ['Instructor'] }
    expect(kqmRarity(sets, values).rolls).toBe(20 - 2 * 4)
    expect(kqmRarity(sets, values, 30).rolls).toBe(30 - 2 * 4)
  })
  it('places every roll of the budget within its caps, and more rolls do more damage', () => {
    let last = 0
    for (const budget of [20, 25, 30, 40]) {
      const placed = placeRolls(problem(budget), {}, mains, mainValues)
      expect(count(placed.rolls)).toBe(budget)
      const caps = kqmRollCaps(placed.mains, budget)
      for (const [k, n] of Object.entries(placed.rolls))
        expect(n).toBeLessThanOrEqual(caps[k as SubstatKey])
      expect(placed.score.total).toBeGreaterThan(last)
      last = placed.score.total
    }
    // (absent: as KQM Standards)
    expect(placeRolls(problem(), {}, mains, mainValues).score.total).toBe(
      placeRolls(problem(20), {}, mains, mainValues).score.total
    )
  })
})
