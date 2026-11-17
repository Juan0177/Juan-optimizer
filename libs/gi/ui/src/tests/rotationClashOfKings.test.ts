/**
 * Clash of Kings (gcsim/kqmsim): the wielder's Elemental Skill on the field grants Laws of the
 * Board for 6 s, once per 12 s; one Charged Attack hit while it is up (within those 12 s) extends
 * it by 6 s. Declared off outside its windows, so no rule or saved switch keeps it on all rotation.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** A Catalyst user whose Skill and Charged Attack each take 60 frames (the CA hits at 10) */
const probe: KitModel = {
  characterKey: 'Klee',
  element: 'pyro',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'charged')
      ctx.hit(10, {
        path: ['charged', 'dmg'],
        tag: 'charged',
        element: 'pyro',
        label: 'CA',
      })
    return { frames: 60 }
  },
}

const play = (text: string) => {
  const members: CharacterKey[] = ['Klee', 'Bennett']
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Klee: 'pyro', Bennett: 'pyro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    kits: { Klee: probe, Bennett: probe },
    reactions: { onHit() {} },
    gear: { Klee: { weapon: 'ClashOfKings' } },
  })
  const start = sim.actions[0].start
  const windows = sim.buffWindows.filter((w) => w.path[0] === 'ClashOfKings')
  return {
    declared: windows.some((w) => w.end === w.start),
    on: windows
      .filter((w) => w.end > w.start)
      .map((w) => [w.start - start, w.end - start]),
  }
}

describe('Clash of Kings', () => {
  it('6 s after the Skill; declared off', () => {
    expect(play('Klee E W10')).toEqual({ declared: true, on: [[0, 360]] })
  })

  it('a Charged Attack hit while it is up extends it by 6 s, once', () => {
    const { on } = play('Klee E CA CA W15')
    // the CA at 60 hits at 70: the buff then runs to 360 + 360 from the Skill
    expect(on).toEqual([
      [0, 360],
      [70, 720],
    ])
  })

  it('once per 12 s: a second Skill within it grants nothing', () => {
    expect(play('Klee E W5 E W10').on).toEqual([[0, 360]])
    // after 12 s, again
    expect(play('Klee E W12 E W10').on).toEqual([
      [0, 360],
      [780, 1140],
    ])
  })

  it('no extension once the buff has run out', () => {
    // the CA hits at 7 s: Laws of the Board ended at 6 s
    expect(play('Klee E W6 CA W10').on).toEqual([[0, 360]])
  })
})
