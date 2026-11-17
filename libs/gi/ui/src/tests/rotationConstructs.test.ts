/**
 * Geo constructs (kqmsim's Constructs.New): one of a kind replaces the newest standing one of that
 * kind (refresh), and every creation counts as a spawn (OnConstructSpawned), replacements too.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const seen: { constructs: number; spawned: number }[] = []
/** A Skill creates a 30 s construct (`kind` if given); a Normal Attack records the counts */
const kit = (kind?: string, replace?: boolean): KitModel => ({
  characterKey: 'Albedo',
  element: 'geo',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill') ctx.construct(1800, { kind, replace })
    if (action.kind === 'normal')
      seen.push({ constructs: ctx.constructs, spawned: ctx.constructsSpawned })
    return { frames: 60 }
  },
})
const run = (kind?: string, replace?: boolean) => {
  seen.length = 0
  const members: CharacterKey[] = ['Albedo']
  simulateRotation({
    rotation: parseRotation('Albedo E N1 E N1', [
      { characterKey: 'Albedo', name: 'Albedo' },
    ]),
    members,
    constellations: {},
    elements: { Albedo: 'geo' },
    repeats: 1,
    kits: { Albedo: kit(kind, replace) },
    reactions: { onHit() {} },
  })
  return seen.map((x) => [x.constructs, x.spawned])
}

describe('Geo constructs', () => {
  it('a recast of a kind replaces the standing one, and still counts as a spawn', () => {
    expect(run('SolarIsotoma')).toEqual([
      [1, 1],
      [1, 2],
    ])
  })
  it('without a kind (or with replace off) both stand', () => {
    expect(run()).toEqual([
      [1, 1],
      [2, 2],
    ])
    expect(run('stele', false)).toEqual([
      [1, 1],
      [2, 2],
    ])
  })
})
