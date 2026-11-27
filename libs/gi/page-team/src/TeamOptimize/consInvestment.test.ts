import { describe, expect, it } from 'vitest'
import {
  bestInvestments,
  investmentAllocations,
  investmentStateKey,
  planInvestments,
  spreads,
} from './consInvestment'

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

  it('enumerates allocations across both constellations and R1 signature weapons', () => {
    const allocs = investmentAllocations([2, 1], [true, false], 2)
    const keys = allocs
      .map((a) => `${a.consDelta.join(',')}|${a.sigDelta.map(Number).join('')}`)
      .sort()
    expect(keys).toEqual([
      '0,1|10', // M0 R1 + M1 C+1
      '1,0|10', // M0 C+1 + M0 R1
      '1,1|00', // M0 C+1 + M1 C+1
      '2,0|00', // M0 C+2
    ])
  })

  it('ranks top-K paths per budget X across constellations, R1 signatures, and synergy while reusing cache', async () => {
    const consGain = [
      [0, 0.12, 0.3, 0.34, 0.4, 0.44, 0.7], // Carry
      [0, 0.14, 0.2, 0.22, 0.25, 0.27, 0.35], // Support
      [0, 0.02, 0.04, 0.05, 0.06, 0.07, 0.1], // Locked/excluded
    ]
    const sigGain = [0.18, 0.08, 0]
    const BASE = 100_000
    const truth = (cons: number[], sig: boolean[]) =>
      BASE *
      cons.reduce(
        (p, c, i) => p * (1 + consGain[i][c]) * (sig[i] ? 1 + sigGain[i] : 1),
        1
      ) *
      (cons[0] >= 1 && sig[0] ? 1.02 : 1)

    const baseDps = truth([0, 0, 6], [false, false, false])
    const cache = new Map<string, { dps: number }>()
    let calls = 0
    const plan = await planInvestments({
      baseCons: [0, 0, 6],
      maxCons: [6, 6, 6], // member 2 already C6 (0 room)
      canAddSig: [true, true, false],
      baseDps,
      maxBudget: 3,
      topK: 4,
      cache,
      evaluate: async (state) => {
        calls++
        return { dps: truth(state.cons, state.sig) }
      },
    })

    expect(plan).toBeTruthy()
    expect(plan!.maxBudget).toBe(3)
    expect(plan!.bestByCost.map((p) => p.cost)).toEqual([0, 1, 2, 3])

    // At +1 pull: Carry R1 (+18%) beats Support C1 (+14%) beats Carry C1 (+12%) beats Support R1 (+8%)
    const at1 = plan!.byBudget[1]
    expect(at1).toHaveLength(4)
    expect(at1[0].sig).toEqual([true, false, false])
    expect(at1[0].gainPct).toBeCloseTo(0.18, 4)
    expect(at1[1].cons).toEqual([0, 1, 6])
    expect(at1[2].cons).toEqual([1, 0, 6])
    expect(at1[3].sig).toEqual([false, true, false])

    // At +2 pulls: Carry R1 + Support C1 (1.18 * 1.14 = 1.3452) vs Carry C1+R1 (1.12 * 1.18 * 1.02 = 1.3480)
    const at2 = plan!.byBudget[2]
    expect(at2[0].cons).toEqual([1, 0, 6])
    expect(at2[0].sig).toEqual([true, false, false])
    expect(at2[0].gainPerPull).toBeCloseTo(at2[0].gainPct / 2, 6)

    // At +3 pulls: Carry C2 + Carry R1 (1.30 * 1.18 * 1.02 = 1.56468)
    const at3 = plan!.byBudget[3]
    expect(at3[0].cons).toEqual([2, 0, 6])
    expect(at3[0].sig).toEqual([true, false, false])
    expect(at3[0].dps).toBeCloseTo(truth([2, 0, 6], [true, false, false]), 4)

    // Re-running with the same cache & budget does 0 new evaluations!
    const callsBefore = calls
    const cachedPlan = await planInvestments({
      baseCons: [0, 0, 6],
      maxCons: [6, 6, 6],
      canAddSig: [true, true, false],
      baseDps,
      maxBudget: 3,
      topK: 4,
      cache,
      evaluate: async (state) => {
        calls++
        return { dps: truth(state.cons, state.sig) }
      },
    })
    expect(calls).toBe(callsBefore)
    expect(investmentStateKey(cachedPlan!.byBudget[3][0])).toBe(
      investmentStateKey(at3[0])
    )
  })

  it('executes single upgrades and combination waves in parallel when concurrency > 1', async () => {
    const consGain = [
      [0, 0.14, 0.28, 0.35],
      [0, 0.11, 0.22, 0.27],
      [0, 0.08, 0.15, 0.2],
    ]
    const BASE = 100_000
    const truth = (cons: number[], sig: boolean[]) =>
      BASE *
      cons.reduce(
        (p, c, i) => p * (1 + consGain[i][c]) * (sig[i] ? 1.12 : 1),
        1
      )

    let inFlight = 0
    let maxInFlight = 0
    const plan = await planInvestments({
      baseCons: [0, 0, 0],
      maxCons: [3, 3, 3],
      canAddSig: [true, true, false],
      baseDps: BASE,
      maxBudget: 3,
      topK: 4,
      concurrency: 4,
      evaluate: async (state) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return { dps: truth(state.cons, state.sig) }
      },
    })

    expect(maxInFlight).toBeGreaterThanOrEqual(3)
    expect(plan?.byBudget[3][0].dps).toBeCloseTo(
      truth([2, 0, 0], [true, false, false]),
      4
    )
  })
})
