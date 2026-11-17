/**
 * Tidal Shadow, Song of Stillness (kqmsim): on for 8 s after a heal reaches the wielder, on or off
 * the field; off when no heal reaches it.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** Every action takes 120 frames; the healer's Skill heals `targets` at once */
const kit = (
  characterKey: CharacterKey,
  targets?: CharacterKey[]
): KitModel => ({
  characterKey,
  element: 'hydro',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill' && targets)
      ctx.hit(0, {
        path: ['_heal', 'skill', 'heal'],
        tag: 'other',
        element: 'physical',
        label: 'Heal',
        healTargets: targets,
      })
    return { frames: 120 }
  },
})
const members: CharacterKey[] = ['Freminet', 'Bennett']
const run = (text: string, targets: CharacterKey[]) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Freminet: 'cryo', Bennett: 'pyro' },
    repeats: 1,
    kits: { Freminet: kit('Freminet'), Bennett: kit('Bennett', targets) },
    reactions: { onHit() {} },
    gear: { Freminet: { weapon: 'TidalShadow', refinement: 5 } },
  })
  const heal = sim.hits.find((h) => h.path[0] === '_heal')
  const windows = sim.buffWindows
    .filter(
      (w) => w.path.join('.') === 'TidalShadow.afterHeal' && w.end > w.start
    )
    .map((w) => [w.start, w.end])
  return { heal, windows }
}

describe('weapons on after the wielder is healed', () => {
  it('Tidal Shadow: 8 s from a heal that reaches its wielder off the field', () => {
    const { heal, windows } = run('Freminet N1 -> Bennett E', ['Freminet'])
    expect(heal?.onField).toBe('Bennett')
    expect(windows).toEqual([[heal!.t, heal!.t + 480]])
  })
  it('stays off when the heal reaches only others', () => {
    expect(run('Freminet N1 -> Bennett E', ['Bennett']).windows).toEqual([])
  })
})
