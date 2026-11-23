/**
 * KQM's artifact standard: KQM Standards place 20 rolls for damage on top of 2 fixed of every
 * substat, at most 2 per piece whose main stat is not that stat. The tiers (Good, Great, Top,
 * Perfect) build each piece as the game makes one: 4 lines and 4 or 5 upgrades, more of them on
 * wanted stats at each step, Perfect at the highest roll values.
 */
import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import {
  KQM_STANDARDS,
  KQM_TIERS,
  type KqmMains,
  type KqmMainValues,
  type KqmProblem,
  type KqmStandard,
  kqmRarity,
  kqmRollCaps,
  kqmStandardOf,
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
const problem = (standard: KqmStandard = 'kqms'): KqmProblem => {
  const out = new Float64Array(1)
  const columns = ['atk_', 'critRate_', 'critDMG_']
  const valuesAt = (V: Float64Array) => {
    out[0] = (1 + V[0]) * (1 + Math.min(1, 0.05 + V[1]) * (0.5 + V[2]))
    return out
  }
  const statsOf = (v: Record<string, number>) =>
    new Float64Array(columns.map((k) => v[k] ?? 0))
  const values = (v: Record<string, number>) => valuesAt(statsOf(v))
  return {
    run: (v) => ({ total: values(v)[0], cons: [] }),
    values,
    valuesAt,
    columns,
    columnOf: (key) => columns.indexOf(key),
    statsOf,
    nTerms: 1,
    mins: [],
    scales: new Set(columns),
    standard,
  }
}
const count = (rolls: Partial<Record<SubstatKey, number>>) =>
  Object.values(rolls).reduce((n, r) => n + (r ?? 0), 0)

describe('the artifact standard', () => {
  it('KQM Standards by default: 20 rolls, at most 2 a piece', () => {
    expect(kqmStandardOf(undefined)).toBe('kqms')
    expect(kqmStandardOf('best')).toBe('kqms')
    expect(kqmStandardOf('top')).toBe('top')
    // (CRIT Rate on 4 pieces: the circlet is CRIT Rate; ATK% on 4: the sands)
    const caps = kqmRollCaps(mains)
    expect(caps.critRate_).toBe(8)
    expect(caps.critDMG_).toBe(10)
    expect(caps.atk_).toBe(8)
    const placed = placeRolls(problem(), {}, mains, mainValues)
    expect(count(placed.rolls)).toBe(20)
    for (const [k, n] of Object.entries(placed.rolls))
      expect(n).toBeLessThanOrEqual(caps[k as SubstatKey])
  })
  it('a tier’s caps: what its pieces can hold of a stat (a line and every upgrade)', () => {
    expect(kqmRollCaps(mains, 'top').critDMG_).toBe(30)
    expect(kqmRollCaps(mains, 'top').critRate_).toBe(24)
    expect(kqmRollCaps(mains, 'good').critDMG_).toBe(25)
  })
  it('4★ pieces: 2 rolls fewer each in KQM Standards', () => {
    const sets = { Instructor: 4 }
    const values = { ...mainValues, fourStarSets: ['Instructor'] }
    expect(kqmRarity(sets, values).rolls).toBe(20 - 2 * 4)
  })
  it('each tier places the rolls its pieces have, and does more damage than the one before', () => {
    let last = 0
    for (const standard of KQM_STANDARDS) {
      const placed = placeRolls(problem(standard), {}, mains, mainValues)
      if (standard !== 'kqms')
        expect(count(placed.rolls)).toBeCloseTo(
          5 * KQM_TIERS[standard].pieceRolls,
          9
        )
      expect(placed.score.total).toBeGreaterThan(last)
      last = placed.score.total
    }
  })
})
