import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

function playOnce(
  text: string,
  members: CharacterKey[],
  gear: Partial<Record<CharacterKey, SimGear>>
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: Object.fromEntries(members.map((m) => [m, 0])),
    gear,
    repeats: 1,
    keep: 'all',
  })
}

describe('Lyney kit', () => {
  it("gets Prototype Crescent's Unreturning only from a CA[weakspot] hit", () => {
    const sim = playOnce('Lyney CA CA[weakspot] CA W1', ['Lyney'], {
      Lyney: { sets: {}, weapon: 'PrototypeCrescent', refinement: 5 },
    })
    const arrows = sim.hits.filter(
      (h) => h.label === 'Fully-Charged Aimed Shot (Prop Arrow)'
    )
    expect(arrows.map((h) => [h.t, !!h.weakspot])).toEqual([
      [113, false],
      [224, true],
      [335, false],
    ])
    const windows = sim.buffWindows.filter(
      (w) =>
        w.path[0] === 'PrototypeCrescent' &&
        w.path[1] === 'Unreturning' &&
        w.value === 'on' &&
        w.end > w.start
    )
    expect(windows.length).toBeGreaterThan(0)
    expect(Math.min(...windows.map((w) => w.start))).toBeGreaterThanOrEqual(224)
  })
  it("stacks Marechaussee Hunter from his Prop Arrows' HP drain without HP tracking", () => {
    const sim = playOnce('Lyney 3[CA]', ['Lyney'], {
      Lyney: { sets: { MarechausseeHunter: 4 } },
    })
    const stacks = sim.buffWindows
      .filter((w) => w.path[0] === 'MarechausseeHunter')
      .map((w) => w.value)
    // (the first two drain 20% each; the third finds him at 60%)
    expect(stacks).toEqual(['1', '2'])
  })
})
