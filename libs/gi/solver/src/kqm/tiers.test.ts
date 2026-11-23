import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import {
  constant,
  customRead,
  optimize,
  precomputeSource,
  prod,
  sum,
} from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import {
  KQM_CUSTOM_ROLLS,
  KQM_FIXED_ROLLS,
  KQM_TIERS,
  type KqmMains,
  type KqmStandard,
  kqmProblem,
  kqmRollValue,
  kqmStandardOf,
  kqmTierRolls,
  placeRolls,
} from './search'

const read = (key: string) => customRead(['dyn', key])
/** A problem whose damage is a weighted sum of these stats */
function linear(weights: Record<string, number>, standard: KqmStandard) {
  const formulas = optimize(
    [
      sum(
        ...Object.entries(weights).map(([k, w]) => prod(constant(w), read(k)))
      ),
    ],
    {},
    () => false
  )
  const scales = new Set<string>()
  const source = precomputeSource(
    formulas,
    {},
    (n) => {
      scales.add(n.path[1] as string)
      return n.path[1] as string
    },
    1
  )
  return kqmProblem({
    source,
    nTerms: 1,
    mins: [],
    scales: [...scales],
    standard,
  })
}
const mainsWith = (circlet: KqmMains['circlet']): KqmMains => ({
  sands: 'atk_',
  goblet: 'pyro_dmg_',
  circlet,
})
/** Crit value from the substats alone (the circlet's main stat not counted) */
function critValue(standard: KqmStandard, circlet: KqmMains['circlet']) {
  const problem = linear({ critRate_: 2, critDMG_: 1 }, standard)
  const { rolls } = placeRolls(problem, {}, mainsWith(circlet), {})
  const fixed = standard === 'kqms' ? KQM_FIXED_ROLLS : 0
  return (
    100 *
    (2 *
      (fixed + (rolls.critRate_ ?? 0)) *
      kqmRollValue('critRate_', standard) +
      (fixed + (rolls.critDMG_ ?? 0)) * kqmRollValue('critDMG_', standard))
  )
}

describe('KQM artifact tiers', () => {
  it('reach the crit value each tier allows, up to the game’s best', () => {
    const table: [KqmStandard, number, number][] = [
      ['kqms', 145.6, 158.9],
      ['good', 173.8, 182.1],
      ['great', 206.9, 215.2],
      ['top', 225.1, 231.7],
      ['perfect', 264.4, 272.2],
    ]
    for (const [standard, critCirclet, otherCirclet] of table) {
      expect(critValue(standard, 'critRate_')).toBeCloseTo(critCirclet, 0)
      expect(critValue(standard, 'critDMG_')).toBeCloseTo(critCirclet, 0)
      expect(critValue(standard, 'atk_')).toBeCloseTo(otherCirclet, 0)
    }
  })

  it('builds every piece as the game can make it', () => {
    const mains: KqmMains[] = [
      mainsWith('critRate_'),
      { sands: 'enerRech_', goblet: 'eleMas', circlet: 'critDMG_' },
      { sands: 'hp_', goblet: 'hp_', circlet: 'hp_' },
    ]
    const objectives = [
      { critRate_: 2, critDMG_: 1 },
      { critRate_: 2, critDMG_: 1, atk_: 1.2, enerRech_: 0.4 },
      { eleMas: 0.01, enerRech_: 1, hp_: 1 },
      { def: 0.001 },
    ]
    for (const standard of ['good', 'great', 'top', 'perfect'] as const) {
      const tier = KQM_TIERS[standard]
      for (const m of mains)
        for (const weights of objectives) {
          const problem = linear(weights, standard)
          const { rolls, layout } = placeRolls(problem, {}, m, {})
          expect(layout).toHaveLength(5)
          const slotMain = ['hp', 'atk', m.sands, m.goblet, m.circlet]
          layout!.forEach((piece, i) => {
            expect(new Set(piece.lines).size).toBe(piece.lines.length)
            expect(piece.lines.length).toBeLessThanOrEqual(tier.lines)
            expect(piece.lines).not.toContain(slotMain[i])
            const ups = Object.entries(piece.ups)
            for (const [k] of ups) expect(piece.lines).toContain(k)
            expect(
              ups.reduce((a, [, n]) => a + (n ?? 0), 0)
            ).toBeLessThanOrEqual(tier.ups)
          })
          // the set's rolls: 4 lines and the upgrades a piece, never more than the game allows
          const total = Object.values(rolls).reduce((a, n) => a + (n ?? 0), 0)
          expect(total).toBeCloseTo(5 * tier.pieceRolls, 6)
          expect(total).toBeLessThanOrEqual(45 + 1e-9)
          // no stat over what its pieces can hold (a line and every upgrade each)
          for (const k of allSubstatKeys) {
            const pieces = slotMain.filter((s) => s !== k).length
            expect(rolls[k] ?? 0).toBeLessThanOrEqual(
              pieces * (tier.pieceRolls - 3) + 1e-9
            )
          }
          // the rolls are what the pieces give
          const again = kqmTierRolls(layout!, {}, m, {}, standard)
          for (const k of allSubstatKeys)
            expect(again[k] ?? 0).toBeCloseTo(rolls[k] ?? 0, 9)
        }
    }
  })

  it('counts a 4★ piece’s rolls at 0.8, with 2 fewer upgrades', () => {
    const problem = linear({ critRate_: 2, critDMG_: 1 }, 'top')
    const four = { fourStarSets: ['Instructor'] }
    const { rolls, layout } = placeRolls(
      problem,
      { Instructor: 4 },
      { ...mainsWith('critRate_'), off: 'circlet' },
      four
    )
    // four 4★ pieces (7 rolls each, at 0.8) and the 5★ circlet (9)
    const total = Object.values(rolls).reduce((a, n) => a + (n ?? 0), 0)
    expect(total).toBeCloseTo(4 * 7 * 0.8 + 9, 6)
    layout!.slice(0, 4).forEach((piece) => {
      expect(
        Object.values(piece.ups).reduce((a, n) => a + (n ?? 0), 0)
      ).toBeLessThanOrEqual(3)
    })
  })

  it('Custom: the wanted rolls typed in, an even share a piece, as the tiers split theirs', () => {
    // 35 is Great's split on 9-roll pieces, 45 is Top
    for (const circlet of ['critRate_', 'atk_'] as const) {
      expect(critValue(35, circlet)).toBeCloseTo(critValue('great', circlet), 6)
      expect(critValue(45, circlet)).toBeCloseTo(critValue('top', circlet), 6)
      expect(critValue(25, circlet)).toBeGreaterThanOrEqual(
        critValue('good', circlet) - 1e-9
      )
      let last = 0
      for (let n = KQM_CUSTOM_ROLLS.min; n <= KQM_CUSTOM_ROLLS.max; n++) {
        const cv = critValue(n, circlet)
        expect(cv).toBeGreaterThanOrEqual(last - 1e-9)
        last = cv
      }
    }
    expect(kqmStandardOf(60)).toBe(45)
    expect(kqmStandardOf(3)).toBe(10)
    expect(kqmStandardOf(23.4)).toBe(23)
    for (const n of [10, 13, 23, 37, 44, 45]) {
      const mains = mainsWith('critRate_')
      const { rolls, layout } = placeRolls(
        linear(
          {
            critRate_: 2,
            critDMG_: 1,
            atk_: 1,
            enerRech_: 0.3,
            eleMas: 0.0001,
            hp_: 0.01,
          },
          n
        ),
        {},
        mains,
        {}
      )
      const slotMain = ['hp', 'atk', mains.sands, mains.goblet, mains.circlet]
      let wanted = 0
      layout!.forEach((piece, i) => {
        expect(new Set(piece.lines).size).toBe(piece.lines.length)
        expect(piece.lines).not.toContain(slotMain[i])
        const ups = Object.values(piece.ups).reduce((a, x) => a + (x ?? 0), 0)
        expect(piece.lines.length + ups).toBeLessThanOrEqual(9)
        wanted += piece.lines.length + ups
      })
      expect(wanted).toBe(n)
      const total = Object.values(rolls).reduce((a, x) => a + (x ?? 0), 0)
      expect(total).toBeCloseTo(45, 6)
    }
  })
})
