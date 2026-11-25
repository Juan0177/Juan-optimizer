import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  energyFromRotation,
  withRotationEnergy,
} from '../util/teamOpt/energyCalc'
import { everyNthBursts, parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import {
  buildRotationScenarios,
  detectBurstMembers,
  rankScenarioResults,
  rewriteBurstRotation,
  validateInsteadAction,
  withScenarioBurstEvery,
} from '../util/teamOpt/rotationScenarios'

const team: CharacterKey[] = ['Columbina', 'Illuga', 'Linnea', 'Zibai']
const names = team.map((characterKey) => ({ characterKey, name: characterKey }))
const example =
  'Columbina E Q -> Illuga E Q -> Linnea E -> Zibai E N1 Q N4 E N4 E N4 E N4 E'

describe('rotationScenarios', () => {
  it('detects only members who burst, preserving order and existing /alt fallbacks', () => {
    const detected = detectBurstMembers(example, names)
    expect(detected.map((d) => d.characterKey)).toEqual([
      'Columbina',
      'Illuga',
      'Zibai',
    ])
    expect(detected.every((d) => d.baselineCadence === 1)).toBe(true)

    const withAlt = detectBurstMembers(
      'Columbina E Q? -> Illuga E Q -> Linnea E -> Zibai E N1 Q/N4 N4 E N4 E N4 E N4 E',
      names
    )
    expect(withAlt.find((d) => d.characterKey === 'Columbina')).toMatchObject({
      optionalInText: true,
      baselineCadence: 2,
      defaultCadences: [1, 2],
    })
    expect(withAlt.find((d) => d.characterKey === 'Zibai')).toMatchObject({
      optionalInText: true,
      defaultInstead: 'N4',
      defaultCadences: [1, 2],
    })
  })

  it('rewrites rotations cleanly for Every, Every 2nd (with or without fallback), Skip, and compact EQ', () => {
    // Zibai Every 2nd with N4 fallback, Columbina Every 2nd with no fallback
    expect(
      rewriteBurstRotation(example, names, {
        Columbina: { cadence: 2 },
        Illuga: { cadence: 1 },
        Zibai: { cadence: 2, instead: 'N4' },
      })
    ).toBe(
      'Columbina E Q -> Illuga E Q -> Linnea E -> Zibai E N1 Q/N4 N4 E N4 E N4 E N4 E'
    )

    // Multi-action fallback collapses whitespace inside Q/... so parser reads all actions
    expect(
      rewriteBurstRotation(example, names, {
        Zibai: { cadence: 2, instead: 'N2 CA' },
      })
    ).toContain('Zibai E N1 Q/N2CA N4 E')

    // Skip replaces Q directly with fallback (or removes Q / empty step cleanly)
    expect(
      rewriteBurstRotation(example, names, {
        Columbina: { cadence: 0 },
        Zibai: { cadence: 0, instead: 'N4' },
      })
    ).toBe(
      'Columbina E -> Illuga E Q -> Linnea E -> Zibai E N1 N4 N4 E N4 E N4 E N4 E'
    )

    // Compact EQ splits cleanly when skipping Q
    expect(
      rewriteBurstRotation(
        'Columbina EQ -> Illuga Q -> Linnea E -> Columbina',
        names,
        {
          Columbina: { cadence: 0 },
          Illuga: { cadence: 0 },
        }
      )
    ).toBe('Columbina E -> Linnea E -> Columbina')

    // Every (1) clears Q? / Q/N4 back to mandatory Q
    expect(
      rewriteBurstRotation('Columbina E Q? -> Zibai E N1 Q/N4 N4 E', names, {
        Columbina: { cadence: 1 },
        Zibai: { cadence: 1, instead: 'N4' },
      })
    ).toBe('Columbina E Q -> Zibai E N1 Q N4 E')
  })

  it('validates fallback actions accurately', () => {
    expect(validateInsteadAction('Zibai', 'Zibai', '').valid).toBe(true)
    expect(validateInsteadAction('Zibai', 'Zibai', 'N4').valid).toBe(true)
    expect(validateInsteadAction('Zibai', 'Zibai', 'N2 CA').valid).toBe(true)
    expect(validateInsteadAction('Zibai', 'Zibai', 'banana').valid).toBe(false)
  })

  it('builds Cartesian scenarios with distinct ER requirements for Columbina & Zibai cadences', () => {
    const { scenarios, totalCount, truncated } = buildRotationScenarios({
      baseText: example,
      names,
      configs: [
        { characterKey: 'Columbina', cadences: [1, 2], instead: '' },
        { characterKey: 'Illuga', cadences: [1], instead: '' },
        { characterKey: 'Zibai', cadences: [1, 2], instead: 'N4' },
      ],
      baselineBurstEvery: { Columbina: 1, Illuga: 1, Zibai: 1 },
    })

    expect(totalCount).toBe(4)
    expect(truncated).toBe(false)
    expect(scenarios).toHaveLength(4)
    expect(scenarios[0].isBaseline).toBe(true)

    // Simulate all 4 scenarios and confirm ER drops significantly when bursting every 2nd rotation
    const erByScenario = scenarios.map((sc) => {
      const parsed = parseRotation(sc.text, names)
      const nth = everyNthBursts(parsed, sc.burstEvery)
      const loops = nth?.loops ?? 1
      const sim = simulateRotation({
        rotation: nth?.rotation ?? parsed,
        members: team,
        elements: Object.fromEntries(
          team.map((m) => [m, getCharEle(m)])
        ) as never,
        constellations: {},
        repeats: 4,
        keep: 'last2',
      })
      const counted = 2 * loops
      const rotTime = sim.frames / 60 / counted
      const energy = energyFromRotation(sim, team, counted, {})
      const calc = withScenarioBurstEvery(
        withRotationEnergy(
          defaultEnergyCalculator(team, rotTime),
          team,
          energy
        ),
        sc.burstEvery,
        true
      )
      const targets = calculateEnergyRecharge(team, calc).targets
      const zibaiNormals =
        sim.hits.filter((h) => h.characterKey === 'Zibai' && h.tag === 'normal')
          .length / counted
      const zibaiBursts =
        sim.hits.filter((h) => h.characterKey === 'Zibai' && h.tag === 'burst')
          .length / counted
      return {
        id: sc.id,
        rotTime,
        targets,
        zibaiNormals,
        zibaiBursts,
      }
    })

    const bothEvery = erByScenario.find(
      (x) => x.id.includes('Columbina:1') && x.id.includes('Zibai:1')
    )!
    const both2nd = erByScenario.find(
      (x) => x.id.includes('Columbina:2') && x.id.includes('Zibai:2')
    )!
    // Off-field solo-Hydro Columbina's ER drops sharply on Every 2nd rotation
    expect(both2nd.targets.Columbina!).toBeLessThan(
      bothEvery.targets.Columbina!
    )
    // Zibai's ER never increases, every 2nd Burst is skipped, and N4 fallback adds Normal hits
    expect(both2nd.targets.Zibai!).toBeLessThanOrEqual(bothEvery.targets.Zibai!)
    expect(both2nd.zibaiBursts).toBeLessThan(bothEvery.zibaiBursts)
    expect(both2nd.zibaiNormals).toBeGreaterThan(bothEvery.zibaiNormals)
  })

  it('ranks feasible scenarios strictly above unmet ones and by descending DPS', () => {
    const ranked = rankScenarioResults([
      { id: 'unmet-high', dps: 150000, unmetCount: 1 },
      { id: 'ok-low', dps: 110000, unmetCount: 0 },
      { id: 'ok-best', dps: 125000, unmetCount: 0 },
      { id: 'errored', dps: 0, unmetCount: 0, error: 'failed' },
    ])
    expect(ranked.map((r) => r.id)).toEqual([
      'ok-best',
      'ok-low',
      'unmet-high',
      'errored',
    ])
  })
})
