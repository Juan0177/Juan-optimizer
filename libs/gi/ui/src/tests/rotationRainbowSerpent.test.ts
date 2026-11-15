/**
 * Rainbow Serpent's Rainbow (kqmsim): ATK for 8 s after the wielder's attack hits while it is off
 * the field, from the next hit on; never from hits while it holds the field.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** Every action takes 120 frames; a Skill hits at once and again 300 frames later */
const kit = (characterKey: CharacterKey): KitModel => ({
  characterKey,
  element: 'electro',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill')
      for (const at of [1, 300])
        ctx.hit(at, {
          path: ['skill', 'oz'],
          tag: 'skill',
          element: 'electro',
          label: 'Oz',
        })
    return { frames: 120 }
  },
})
const members: CharacterKey[] = ['Fischl', 'Bennett']
const run = (text: string) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Fischl: 'electro', Bennett: 'pyro' },
    repeats: 1,
    kits: { Fischl: kit('Fischl'), Bennett: kit('Bennett') },
    reactions: { onHit() {} },
    gear: { Fischl: { weapon: 'RainbowSerpentsRainBow', refinement: 5 } },
  })
  const oz = sim.hits.filter((h) => h.path.join('.') === 'skill.oz')
  const windows = sim.buffWindows
    .filter(
      (w) =>
        w.path.join('.') === 'RainbowSerpentsRainBow.passive' && w.end > w.start
    )
    .map((w) => [w.start, w.end])
  return { oz, windows }
}

describe("Rainbow Serpent's Rainbow", () => {
  it('turns on after an off-field hit, not after one on the field', () => {
    const { oz, windows } = run('Fischl E -> Bennett N1 N1 N1 N1')
    // (the first Oz hit lands with Fischl on the field, the second after the swap)
    expect(oz[0].onField).toBe('Fischl')
    expect(oz[1].onField).toBe('Bennett')
    expect(windows).toEqual([[oz[1].t + 1, oz[1].t + 481]])
  })
  it('stays off when the wielder never hits off the field', () => {
    expect(run('Fischl E N1 N1 N1').windows).toEqual([])
  })
})
