import {
  constant,
  customRead,
  frac,
  max,
  min,
  optimize,
  precomputeSource,
  prod,
  res,
  sum,
  threshold,
} from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import {
  type KqmMains,
  kqmProblem,
  placeRolls,
  scoreAt,
  scoreOf,
} from './search'

const read = (key: string) => customRead(['dyn', key])
/**
 * A problem compiled as KQM compiles one (`precomputeSource`, one slot, no initial values): an ATK ×
 * CRIT hit against resistance, an EM hit with a set threshold, and an Energy Recharge requirement
 */
function compiled() {
  const formulas = optimize(
    [
      prod(
        sum(constant(1), read('atk_')),
        sum(
          constant(1),
          prod(
            min(constant(1), sum(constant(0.05), read('critRate_'))),
            sum(constant(0.5), read('critDMG_'))
          )
        ),
        res(sum(constant(0.1), prod(constant(-1), read('hydro_res_'))))
      ),
      prod(
        threshold(
          read('GildedDreams'),
          constant(4),
          constant(1.5),
          constant(1)
        ),
        frac(read('eleMas'), constant(2000)),
        max(read('atk'), constant(100))
      ),
      sum(constant(1), read('enerRech_')),
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
  return { source, scales: [...scales] }
}
/** The compiled source as `precompute` runs it: stats read by name from an object */
const byName = (source: string) =>
  new Function('b', source) as (
    b: { values: Record<string, number> }[]
  ) => number[]

// deterministic random stats, with the cases that read differently: missing, NaN, -0, negative
let seed = 7
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const keys = [
  'atk_',
  'critRate_',
  'critDMG_',
  'hydro_res_',
  'GildedDreams',
  'eleMas',
  'atk',
  'enerRech_',
  'pyro_dmg_',
  'NoblesseOblige',
]
function stats(): Record<string, number> {
  const v: Record<string, number> = {}
  for (const k of keys) {
    const x = rand()
    if (x < 0.1) continue
    v[k] =
      x < 0.13
        ? Number.NaN
        : x < 0.16
          ? -0
          : x < 0.3
            ? -rand() * 3
            : k === 'GildedDreams'
              ? Math.floor(rand() * 5)
              : rand() * (k === 'eleMas' || k === 'atk' ? 900 : 2)
  }
  return v
}
const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]))

describe('KQM problems read their stats from an array', () => {
  const { source, scales } = compiled()
  const spec = { source, nTerms: 2, mins: [1.2], scales }

  it('with the same values as the stats read by name', () => {
    const ref = byName(source)
    const problem = kqmProblem(spec)
    for (let i = 0; i < 500; i++) {
      const v = stats()
      const want = ref([{ values: v }])
      expect(same(problem.values(v), want)).toBe(true)
      expect(same(problem.valuesAt(problem.statsOf(v)), want)).toBe(true)
      expect(scoreAt(problem, problem.statsOf(v))).toEqual(scoreOf(problem, v))
    }
  })

  it('one column per stat read, in the order read; other stats -1', () => {
    const problem = kqmProblem(spec)
    expect([...problem.columns].sort()).toEqual([...scales].sort())
    expect(problem.columns.map((k) => problem.columnOf(k))).toEqual(
      problem.columns.map((_, j) => j)
    )
    expect(problem.columnOf('pyro_dmg_')).toBe(-1)
    expect(problem.statsOf({ atk_: 0.5 })[problem.columnOf('atk_')]).toBe(0.5)
    expect(problem.statsOf({})[problem.columnOf('eleMas')]).toBe(0)
  })

  it('reads in another form go by name, as compiled', () => {
    // (should `precompute` write its reads differently, nothing is rewritten)
    const other = source.replaceAll(' ?? 0)', ' || 0)')
    expect(other).not.toBe(source)
    const ref = byName(other)
    const problem = kqmProblem({ ...spec, source: other })
    expect([...problem.columns].sort()).toEqual([...scales].sort())
    for (let i = 0; i < 200; i++) {
      const v = stats()
      const want = ref([{ values: v }])
      expect(same(problem.values(v), want)).toBe(true)
      expect(same(problem.valuesAt(problem.statsOf(v)), want)).toBe(true)
    }
  })

  it('places the same rolls either way', () => {
    // the array kernel against the same formulas read by name (the fallback compiles them as is)
    const viaArray = kqmProblem(spec)
    const viaName = kqmProblem({
      ...spec,
      source: source.replace('"use strict";', '"use strict";const b0_=b[0];'),
    })
    // (`b[0]` left in the source: the by-name path)
    expect(viaName.columns.length).toBe(viaArray.columns.length)
    const mainValues = {
      atk_: 0.466,
      critRate_: 0.311,
      critDMG_: 0.622,
      eleMas: 186.5,
      enerRech_: 0.518,
      hp: 4780,
      atk: 311,
    }
    const choices: KqmMains[] = [
      { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
      { sands: 'enerRech_', goblet: 'atk_', circlet: 'critDMG_' },
      { sands: 'eleMas', goblet: 'eleMas', circlet: 'eleMas' },
    ]
    for (const mains of choices)
      for (const sets of [{}, { GildedDreams: 4 }, { NoblesseOblige: 2 }]) {
        const a = placeRolls(viaArray, sets, mains, mainValues)
        const b = placeRolls(viaName, sets, mains, mainValues)
        expect(a).toEqual(b)
        expect(Object.is(a.score.total, b.score.total)).toBe(true)
      }
  })
})
