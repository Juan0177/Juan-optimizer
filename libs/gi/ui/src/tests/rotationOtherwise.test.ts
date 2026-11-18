/**
 * An optional action's alternative: "Q?/N3" plays the Burst when it is ready, otherwise N3 (then
 * what follows), as a sim's "if .burst.ready … else …".
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const team: CharacterKey[] = ['Bennett', 'Xiangling']
const names = team.map((characterKey) => ({ characterKey, name: characterKey }))

describe('an optional action’s alternative', () => {
  it('is parsed after "/" (no spaces inside)', () => {
    const [step] = parseRotation('Bennett E Q?/N3', names).steps
    expect(step.actions[1]).toMatchObject({
      kind: 'burst',
      optional: true,
      otherwise: [{ kind: 'normal', count: 3 }],
    })
    const [skill] = parseRotation('Bennett E?/N2CA', names).steps[0].actions
    expect(skill.otherwise?.map((a) => a.kind)).toEqual(['normal', 'charged'])
    // (a plain alternative still keeps only its first one)
    expect(parseRotation('Bennett N2/N3', names).steps[0].actions).toEqual([
      expect.objectContaining({ kind: 'normal', count: 2 }),
    ])
  })
  it('plays the alternative when the action is not ready, and the action when it is', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Bennett E Q?/N3 -> Xiangling N1', names),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: {},
      repeats: 4,
      keep: 'all',
    })
    const bennett = sim.actions.filter((a) => a.characterKey === 'Bennett')
    const bursts = bennett.filter((a) => a.text.startsWith('Q')).length
    const normals = bennett.filter((a) => a.text === 'N3').length
    // (Bennett's Burst: 15 s; a loop of a few seconds: one Burst, the other loops N3)
    expect(bursts).toBeGreaterThanOrEqual(1)
    expect(normals).toBeGreaterThanOrEqual(1)
    expect(
      sim.notes.some((n) => /N3 was played when it was not ready/.test(n))
    ).toBe(true)
  })
  it('works for a Skill on cooldown too', () => {
    // Bennett's Skill: 5 s cooldown; the second E right after the first is not ready, so N2 plays
    const sim = simulateRotation({
      rotation: parseRotation('Bennett E E?/N2 -> Xiangling N1', names),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: {},
      repeats: 1,
      keep: 'all',
    })
    const texts = sim.actions
      .filter((a) => a.characterKey === 'Bennett')
      .map((a) => a.text)
    expect(texts.filter((t) => t.startsWith('E')).length).toBe(1)
    expect(texts).toContain('N2')
  })
})
