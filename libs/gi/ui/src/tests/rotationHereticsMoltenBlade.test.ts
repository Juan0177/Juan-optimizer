/**
 * Heretic's Molten Blade (gcsim): Gleam of First Light after the wielder's Elemental Skill while
 * it is on the field, 14 s, once per 14 s, removed when it leaves the field. Its ATK bonus follows
 * the distance travelled, which is not modelled: counted at its most while it is up.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** A kit whose every action takes `frames` (its Skill hits once, right away) */
const kit = (characterKey: CharacterKey, frames: number): KitModel => ({
  characterKey,
  element: 'cryo',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill')
      ctx.hit(1, {
        path: ['skill', 'press'],
        tag: 'skill',
        element: 'cryo',
        label: 'Skill',
      })
    return { frames }
  },
})
const members: CharacterKey[] = ['Odette', 'Bennett']
const gleam = (text: string) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Odette: 'cryo', Bennett: 'pyro' },
    repeats: 1,
    kits: { Odette: kit('Odette', 120), Bennett: kit('Bennett', 120) },
    reactions: { onHit() {} },
    gear: { Odette: { weapon: 'HereticsMoltenBlade', refinement: 1 } },
  })
  const start = (who: CharacterKey, nth = 0) =>
    sim.actions.filter((a) => a.characterKey === who)[nth].start
  const windows = sim.buffWindows
    .filter(
      (w) =>
        w.path.join('.') === 'HereticsMoltenBlade.passive' &&
        w.end > w.start &&
        !!w.value
    )
    .map((w) => [w.value, w.start, Math.min(w.end, sim.start + sim.frames)])
  return { sim, start, windows }
}

describe('Heretic’s Molten Blade', () => {
  it('is up from the wielder’s Skill until it leaves the field', () => {
    const { start, windows, sim } = gleam('Odette E N1 -> Bennett E N1 N1')
    const left = sim.swaps!.find((w) => w.from === 'Odette')!
    expect(windows).toEqual([['18', start('Odette'), left.start + left.frames]])
  })
  it('lasts 14 s on the field, and comes again only 14 s after it began', () => {
    // (eight 2 s actions: Skills at 0, 4, 8, 12 and 14 s)
    const { start, windows } = gleam('Odette E N1 E N1 E N1 E E N1')
    const first = start('Odette')
    expect(windows).toEqual([
      ['18', first, first + 840],
      // (the Skill at 14 s: the first one off cooldown)
      ['18', first + 840, expect.any(Number)],
    ])
  })
  it('is not up without a Skill, nor from a Skill used off the field', () => {
    expect(gleam('Odette N1 N1 -> Bennett E').windows).toEqual([])
  })
})
