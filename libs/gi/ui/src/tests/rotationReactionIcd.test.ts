/**
 * Bloom, Hyperbloom and Burgeon damage (gcsim's ICDGroupReactionA): per attacker and reaction,
 * only 2 hits deal damage within 0.5 s of the window's first; the reactions themselves all happen.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../util/teamOpt/rotation/types'

/** A kit whose Skill lands `marks` ([frame, element]) as aura-applying hits; 120 frames long */
const probe = (
  characterKey: CharacterKey,
  marks: [number, SimHit['element']][]
): KitModel => ({
  characterKey,
  element: marks[0][1] as never,
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill')
      for (const [t, element] of marks)
        ctx.hit(t, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element,
          applies: true,
          durability: 25,
          icd: 'none',
          label: `${element} hit`,
        })
    return { frames: 120 }
  },
})

it('gives 2 Hyperbloom damage hits when one Electro hit meets four cores at once', () => {
  const members: CharacterKey[] = ['Nahida', 'KukiShinobu']
  // Dendro then Hydro, four times: four Blooms, so four Dendro Cores (each 30 frames later)
  const cores: [number, SimHit['element']][] = [0, 10, 20, 30].flatMap(
    (t): [number, SimHit['element']][] => [
      [t, 'dendro'],
      [t + 5, 'hydro'],
    ]
  )
  const sim = simulateRotation({
    rotation: parseRotation(
      'Nahida E -> KukiShinobu E',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Nahida: 'dendro', KukiShinobu: 'electro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    kits: {
      Nahida: probe('Nahida', cores),
      KukiShinobu: probe('KukiShinobu', [[0, 'electro']]),
    },
  })
  const hits = (node: string) =>
    sim.hits.filter((h) => h.path[0] === 'reaction' && h.path[1] === node)
  // (no core burst on its own: the Electro hit took all four)
  expect(hits('bloom')).toHaveLength(0)
  const hyperblooms = hits('hyperbloom')
  expect(hyperblooms).toHaveLength(2)
  expect(new Set(hyperblooms.map((h) => h.characterKey))).toEqual(
    new Set(['KukiShinobu'])
  )
})
