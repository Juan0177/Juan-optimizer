/**
 * Turrets' particles as the rotation plays them: kits mark their drops with kqmsim's chances and
 * ICDs (`turretParticles`), and the ER calculator counts those in place of the option's rate
 * for its uses. The counts are kqmsim's (60-run means, 2026-11-21).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  energyFromRotation,
  withRotationEnergy,
} from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const N8 = 'N5 N5 N5 N5 N5 N5 N5 N5'
const play = (
  text: string,
  members: CharacterKey[],
  options: { repeats?: number; keep?: 'all' | 'last2' } = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: { Bennett: 6 },
    repeats: options.repeats ?? 1,
    keep: options.keep ?? 'all',
  })
const made = (sim: ReturnType<typeof play>, owner: CharacterKey) =>
  sim.hits
    .filter(
      (h) =>
        h.characterKey === owner &&
        h.path[0] === '_marker' &&
        h.path[1] === 'turretParticles'
    )
    .reduce((n, h) => n + Number(h.path[2]), 0)

describe('turret particles as played', () => {
  it('match kqmsim where a fixed rate would not', () => {
    // (kqmsim 6.5; the rate gives the same)
    expect(
      made(play(`Fischl E -> Bennett ${N8}`, ['Fischl', 'Bennett']), 'Fischl')
    ).toBeCloseTo(6.7)
    // (her Burst's Oz replaces the Skill's: kqmsim 5.98, the rate counted both, 13.4)
    expect(
      made(play(`Fischl E Q -> Bennett ${N8}`, ['Fischl', 'Bennett']), 'Fischl')
    ).toBeCloseTo(6.03)
    // (the Eye needs the party's hits: kqmsim 7.92 with them, 0 without; the rate 11.25 either way)
    expect(
      made(
        play(`RaidenShogun E -> Bennett ${N8}`, ['RaidenShogun', 'Bennett']),
        'RaidenShogun'
      )
    ).toBeCloseTo(8)
    expect(
      made(
        play('RaidenShogun E W25', ['RaidenShogun', 'Bennett']),
        'RaidenShogun'
      )
    ).toBe(0)
    expect(
      made(
        play('Xiangling E -> Bennett N5 N5 N5 N5 N5 N5', [
          'Xiangling',
          'Bennett',
        ]),
        'Xiangling'
      )
    ).toBe(4)
    expect(
      made(
        play(`YaeMiko E E E -> Bennett ${N8} ${N8} N5 N5 N5 N5`, [
          'YaeMiko',
          'Bennett',
        ]),
        'YaeMiko'
      )
    ).toBe(8)
  })

  it('the Eye lasts longer by the hitter’s hitlag (kqmsim NewBaseWithHitlag)', () => {
    const sim = play(`RaidenShogun E -> Bennett ${N8}`, [
      'RaidenShogun',
      'Bennett',
    ])
    const strikes = sim.hits.filter((h) => h.path[1] === 'coorDmg')
    // (kqmsim: 16; a fixed 25 s window gave 14)
    expect(strikes).toHaveLength(16)
  })

  it('the calculator counts them, unless the Skill is set by hand', () => {
    const team: CharacterKey[] = ['Fischl', 'Bennett']
    const sim = play(`Fischl E Q -> Bennett ${N8} N5 N5 N5`, team, {
      repeats: 4,
      keep: 'last2',
    })
    const energy = energyFromRotation(sim, team, 2)
    const turret = energy.members.Fischl!.turretParticles!
    expect(turret).toBeGreaterThan(5)
    expect(turret).toBeLessThan(7)
    const settings = withRotationEnergy(
      { ...defaultEnergyCalculator(team, sim.frames / 60 / 2), rng: 'average' },
      team,
      energy
    )
    const own = (s: typeof settings) =>
      calculateEnergyRecharge(team, s).members.Fischl!.sources.own
    // (all of Oz's particles to Fischl: 3 each, 80% off the field in a party of two)
    const counted = own(settings)
    expect(counted).toBeCloseTo(
      turret * 3 * (0.8 + (0.2 * settings.members.Fischl!.fieldTime) / 100),
      1
    )
    // (uses typed by hand: the option's rate for them, the Burst's Oz added)
    const typed = {
      ...settings,
      members: {
        ...settings.members,
        Fischl: {
          ...settings.members.Fischl!,
          skillUses: 1,
          edited: ['skillUses' as const],
        },
      },
    }
    expect(own(typed)).toBeGreaterThan(counted * 1.5)
  })
})
