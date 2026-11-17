/**
 * Instructor 4pc (gcsim): the party's EM +120 for 8 s when the wearer triggers a reaction while it
 * is on the field; its reactions off the field do not count.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** A kit that lands `reaction` markers at the given frames of its Skill, each action 60 frames */
const kit = (characterKey: CharacterKey, reactions: number[]): KitModel => ({
  characterKey,
  element: 'electro',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill')
      for (const t of reactions)
        ctx.hit(t, {
          path: ['_reaction', 'overloaded'],
          tag: 'other',
          element: 'electro',
          label: 'Overloaded',
        })
    return { frames: 60 }
  },
})
const members: CharacterKey[] = ['Fischl', 'Bennett']
const instructor = (text: string, reactions: number[], candidate = false) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Fischl: 'electro', Bennett: 'pyro' },
    repeats: 1,
    kits: { Fischl: kit('Fischl', reactions), Bennett: kit('Bennett', []) },
    reactions: { onHit() {} },
    gear: {
      Fischl: candidate
        ? { candidates: { sets: ['Instructor'] } }
        : { sets: { Instructor: 4 } },
    },
  })
  const fischl = sim.actions.find((a) => a.characterKey === 'Fischl')!.start
  const windows = sim.buffWindows
    .filter((w) => w.path.join('.') === 'Instructor.set4' && w.end > w.start)
    .map((w) => [w.start - fischl, w.end - w.start])
  return windows
}

describe('Instructor', () => {
  it('8 s for the party from the wearer’s reaction on the field', () => {
    expect(instructor('Fischl E -> Bennett E', [10])).toEqual([[10, 480]])
  })
  it('not from the wearer’s reactions while it is off the field', () => {
    // (Fischl leaves at 60 frames, plus the swap: her reaction at 200 comes off the field)
    expect(instructor('Fischl E -> Bennett E N1 N1', [200])).toEqual([])
  })
  it('only the on-field one, when both happen', () => {
    expect(
      instructor('Fischl E -> Bennett E N1 N1', [10, 200]).map(([s]) => s)
    ).toEqual([10])
  })
  it('the same for a KQM candidate set', () => {
    expect(instructor('Fischl E -> Bennett E N1 N1', [200], true)).toEqual([])
    expect(instructor('Fischl E -> Bennett E', [10], true)).toEqual([[10, 480]])
  })
})
