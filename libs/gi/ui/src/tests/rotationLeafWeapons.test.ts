/**
 * Sapwood Blade and Forest Regalia (gcsim): a Leaf of Consciousness only from the wielder's own
 * Burning, Quicken, Aggravate, Spread, Bloom, Lunar-Bloom, Hyperbloom or Burgeon, one per 20 s,
 * its EM for 12 s; never in a team where the wielder can't trigger one.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** A kit that lands `reaction` markers and Skill hits at the given frames */
const kit = (
  characterKey: CharacterKey,
  element: string,
  reactions: [number, string][],
  hits: number[],
  frames: number
): KitModel => ({
  characterKey,
  element: element as never,
  source: 'test',
  act(ctx) {
    for (const [t, reaction] of reactions)
      ctx.hit(t, {
        path: ['_reaction', reaction],
        tag: 'other',
        element: element as never,
        label: reaction,
      })
    for (const t of hits)
      ctx.hit(t, {
        path: ['skill', 'press'],
        tag: 'skill',
        element: element as never,
        label: 'Skill',
      })
    return { frames }
  },
})
const leafWindows = (
  sim: ReturnType<typeof simulateRotation>,
  weapon = 'SapwoodBlade'
) =>
  sim.buffWindows
    .filter((w) => w.path.join('.') === `${weapon}.passive` && w.end > w.start)
    .map((w) => [w.start, w.end])

describe('Leaf of Consciousness weapons', () => {
  it('a Leaf from the wielder’s own Quicken, 12 s of EM, one per 20 s', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Nahida E', [
        { characterKey: 'Nahida', name: 'Nahida' },
      ]),
      members: ['Nahida'],
      constellations: {},
      elements: { Nahida: 'dendro' },
      repeats: 1,
      kits: {
        Nahida: kit(
          'Nahida',
          'dendro',
          [
            [0, 'quicken'],
            [900, 'spread'],
            [1300, 'aggravate'],
          ],
          [20, 700, 800, 950, 1320],
          2400
        ),
      },
      reactions: { onHit() {} },
      gear: { Nahida: { weapon: 'SapwoodBlade', refinement: 1 } },
    })
    // (the Spread at 15 s comes within 20 s of the first Leaf: none)
    expect(leafWindows(sim)).toEqual([
      [0, 720],
      [1300, 2020],
    ])
  })
  it('no Leaf from a teammate’s reaction, nor without a Dendro reaction', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Fischl E', [
        { characterKey: 'Nahida', name: 'Nahida' },
        { characterKey: 'Fischl', name: 'Fischl' },
      ]),
      members: ['Nahida', 'Fischl'],
      constellations: {},
      elements: { Nahida: 'dendro', Fischl: 'electro' },
      repeats: 1,
      kits: {
        Fischl: kit(
          'Fischl',
          'electro',
          [
            [0, 'aggravate'],
            [300, 'overloaded'],
          ],
          [20, 320],
          600
        ),
      },
      reactions: { onHit() {} },
      gear: {
        Nahida: { weapon: 'ForestRegalia', refinement: 1 },
        Fischl: { weapon: 'SapwoodBlade', refinement: 1 },
      },
    })
    expect(leafWindows(sim, 'ForestRegalia')).toEqual([])
    // (Fischl's own Aggravate: its Sapwood Blade's Leaf)
    expect(leafWindows(sim, 'SapwoodBlade')).toEqual([[0, 720]])
    // (declared for both: off wherever no Leaf is held, whatever the saved state)
    expect(
      sim.buffWindows.some(
        (w) =>
          w.owner === 'Nahida' && w.path.join('.') === 'ForestRegalia.passive'
      )
    ).toBe(true)
  })
  it('by rule, only for a wielder that can trigger a Dendro reaction itself', () => {
    const on = (element: string, auras: string[], weapon: string) =>
      (
        itemConditionals(
          { attacks: ['skill', 'normal'], auras, element, otherElements: 3 },
          { weapons: [weapon as never] }
        ).conditional as Record<string, Record<string, string>>
      )[weapon]?.passive
    // a Hydro wielder in a Cryo team (no Dendro): no Leaf
    expect(on('hydro', ['hydro', 'cryo'], 'SapwoodBlade')).toBeUndefined()
    expect(
      on('cryo', ['cryo', 'hydro', 'dendro'], 'SapwoodBlade')
    ).toBeUndefined()
    expect(on('dendro', ['dendro', 'cryo'], 'ForestRegalia')).toBeUndefined()
    expect(on('hydro', ['hydro', 'dendro'], 'SapwoodBlade')).toBe('on')
    expect(on('dendro', ['dendro', 'electro'], 'ForestRegalia')).toBe('on')
  })
})
