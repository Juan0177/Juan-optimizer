import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const names = (keys: CharacterKey[]) =>
  keys.map((characterKey) => ({ characterKey, name: characterKey }))

function run(text: string, members: CharacterKey[]) {
  return simulateRotation({
    rotation: parseRotation(text, names(members)),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: 1,
    keep: 'all',
  })
}

describe('high and low plunges, and the collision hit (gcsim’s high_plunge / low_plunge)', () => {
  it('reads HP, LP and their collision share, inside a repeated group too', () => {
    const parsed = parseRotation(
      'Xiao E Q 2[J HP[collision]] J LP J HP[collision=0.5] J P',
      names(['Xiao'])
    )
    expect(parsed.warnings).toEqual([])
    const plunges = parsed.steps[0].actions.filter((a) => a.kind === 'plunge')
    expect(plunges.map((p) => [p.height ?? '', p.collision ?? 0])).toEqual([
      ['high', 1],
      ['high', 1],
      ['low', 0],
      ['high', 0.5],
      ['', 0],
    ])
  })

  it('Xiao’s high plunge in Bane of All Evil: lands at 46 frames, the collision hit at 38; 65 frames into a jump', () => {
    const sim = run('Xiao E Q J HP[collision] J P', ['Xiao'])
    const high = sim.actions.find((a) => a.text === 'HP[collision]')!
    expect(high.frames).toBe(65)
    const hit = (label: string, after: number) =>
      sim.hits.find((h) => h.label === label && h.t >= after)!.t - after
    expect(hit('High Plunge', high.start)).toBe(46)
    expect(hit('Plunge Collision', high.start)).toBe(38)
    const collision = sim.hits.find((h) => h.label === 'Plunge Collision')!
    expect(collision.path).toEqual(['plunging', 'dmg'])
    expect(collision.applies).toBeFalsy()
    // a plain P is the low plunge, without the collision hit
    expect(sim.hits.filter((h) => h.label === 'Plunge Collision')).toHaveLength(
      1
    )
    expect(sim.hits.some((h) => h.label === 'Low Plunge')).toBe(true)
  })

  it('says so for a character whose kit has no high or low plunge', () => {
    const sim = run('Bennett J HP', ['Bennett'])
    expect(sim.notes.join(' ')).toContain('high and low plunges')
  })
})
