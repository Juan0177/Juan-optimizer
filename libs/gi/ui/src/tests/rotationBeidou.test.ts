/**
 * Beidou's Tidecaller with Polaris (the game files' Charge_Timer: a stack every 0.8 s of holding):
 * "hE[stacks=1]" holds for 1 stack, "hE" for 2; each stack held is the hit's DMG Bonus, a particle,
 * 4 s off the Skill CD and 8 Energy (once per 15 s); A4 from a release at 2 stacks
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { energyCalcData, energyFromRotation } from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[] = ['Beidou'],
  options: { repeats?: number; keep?: 'all' | 'last2' } = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: options.repeats ?? 1,
    keep: options.keep ?? 'all',
  })
const skillHits = (sim: ReturnType<typeof run>) =>
  sim.hits
    .filter((h) => h.characterKey === 'Beidou' && h.path[0] === 'skill')
    .map((h) => [h.path[1], h.t])
const starts = (sim: ReturnType<typeof run>) =>
  sim.actions.map((a) => [a.text, a.start])
const a4 = (sim: ReturnType<typeof run>) =>
  sim.buffWindows
    .filter((b) => b.path[0] === 'Beidou' && b.path[1] === 'Ascension4')
    .map((b) => b.start)

describe('Beidou: Polaris stacks', () => {
  it('reads hE[stacks=N] for her held Skill only, 1 to 2', () => {
    const beidou = [{ characterKey: 'Beidou' as const, name: 'Beidou' }]
    const actions = (text: string) =>
      parseRotation(text, beidou).steps[0].actions
    expect(actions('Beidou hE[stacks=1] hE hE[stacks=2]?/N2')).toEqual([
      { kind: 'skill', hold: true, stacks: 1, text: 'hE[stacks=1]' },
      { kind: 'skill', hold: true, text: 'hE' },
      {
        kind: 'skill',
        hold: true,
        stacks: 2,
        text: 'hE[stacks=2]?/N2',
        optional: true,
        otherwise: [{ kind: 'normal', count: 2, text: 'N2' }],
      },
    ])
    const warned = (text: string, members = beidou) =>
      parseRotation(text, members).warnings
    expect(warned('Beidou E[stacks=1]')).toEqual([
      'Beidou: "E[stacks=1]": stacks come from holding, write hE[stacks=1] (played as a tap)',
    ])
    expect(warned('Beidou hE[stacks=3]')).toEqual([
      'Beidou: "hE[stacks=3]": 1 to 2 stacks (played as hE, 2 stacks)',
    ])
    expect(
      warned('Fischl hE[stacks=1]', [
        { characterKey: 'Fischl', name: 'Fischl' },
      ])
    ).toEqual([
      'Fischl: "hE[stacks=1]": only Beidou\'s held Skill has stacks (played without them)',
    ])
  })

  it('holds 0.8 s a stack: the hit, its DMG Bonus and the Skill CD Polaris cuts', () => {
    // (tap: the base hit at 23 frames, the next Skill after the 7.5 s CD from frame 4)
    const tap = run('Beidou E E')
    expect(skillHits(tap)).toEqual([
      ['baseDmg', 23],
      ['baseDmg', 477],
    ])
    expect(starts(tap)).toEqual([
      ['E', 0],
      ['E', 454],
    ])
    // (1 stack: released at 48 frames; 4 s off the CD)
    const one = run('Beidou hE[stacks=1] E')
    expect(skillHits(one)).toEqual([
      ['dmgOneHit', 71],
      ['baseDmg', 285],
    ])
    expect(starts(one)[1]).toEqual(['E', 48 + 4 + 450 - 240])
    // (2 stacks: released at 96 frames; 8 s off a 7.5 s CD, so it is ready at once)
    const two = run('Beidou hE E')
    expect(skillHits(two)[0]).toEqual(['dmgTwoHits', 119])
    expect(starts(two)[1]).toEqual(['E', 96 + 45 + 13])
  })

  it('A4 only at the maximum bonus, from the release', () => {
    expect(a4(run('Beidou hE'))).toEqual([96])
    expect(a4(run('Beidou hE[stacks=1]'))).toEqual([])
    expect(a4(run('Beidou E'))).toEqual([])
  })

  it('Polaris once per 15 s: a second hold within it keeps its CD', () => {
    const sim = run('Beidou hE E hE[stacks=1] E')
    const polaris = sim.hits.filter((h) => h.path[1] === 'flatEnergy')
    expect(polaris.map((h) => [h.t, h.path[2]])).toEqual([[119, '16']])
    const [, , third, fourth] = starts(sim)
    expect((fourth[1] as number) - (third[1] as number)).toBe(48 + 4 + 450)
  })

  it('the ER calculator: particles by stacks, Polaris Energy as bonus energy', () => {
    const team: CharacterKey[] = ['Beidou', 'Fischl']
    const energyOf = (skill: string) => {
      const energy = energyFromRotation(
        run(`Beidou ${skill} Q -> Fischl E W15`, team, {
          repeats: 4,
          keep: 'last2',
        }),
        team,
        2
      ).members.Beidou!
      return {
        option: energyCalcData.Beidou!.skills[energy.skillMode!].label,
        flat: energy.flatEnergy ?? 0,
      }
    }
    expect(energyOf('E')).toEqual({ option: '0 stacks', flat: 0 })
    expect(energyOf('hE[stacks=1]')).toEqual({ option: '1 stack', flat: 8 })
    expect(energyOf('hE')).toEqual({ option: 'Perfect', flat: 16 })
  })
})
