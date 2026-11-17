/**
 * Thrilling Tales of Dragon Slayers (gcsim/kqmsim): when the wielder leaves the field, the member
 * taking it gets its ATK for 10 s, once per 20 s. Declared off outside its windows, so no saved
 * switch keeps it on all rotation (a wielder that never leaves the field gives nothing).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** A member whose every action takes 60 frames and hits at 10 */
const probe = (characterKey: CharacterKey): KitModel => ({
  characterKey,
  element: 'anemo',
  source: 'test',
  act(ctx) {
    ctx.hit(10, {
      path: ['skill', 'dmg'],
      tag: 'skill',
      element: 'anemo',
      label: 'E',
    })
    return { frames: 60 }
  },
})

const play = (text: string) => {
  const members: CharacterKey[] = ['Sucrose', 'Xiangling']
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Sucrose: 'anemo', Xiangling: 'pyro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    kits: { Sucrose: probe('Sucrose'), Xiangling: probe('Xiangling') },
    reactions: { onHit() {} },
    gear: { Sucrose: { weapon: 'ThrillingTalesOfDragonSlayers' } },
  })
  const windows = sim.buffWindows.filter(
    (w) => w.path[0] === 'ThrillingTalesOfDragonSlayers'
  )
  // (each swap into Xiangling: when her action starts)
  const arrivals = sim.actions
    .filter(
      (a, i) =>
        a.characterKey === 'Xiangling' &&
        sim.actions[i - 1]?.characterKey === 'Sucrose'
    )
    .map((a) => a.start)
  return {
    declared: windows.some((w) => w.end === w.start),
    on: windows
      .filter((w) => w.end > w.start)
      .map((w) => ({ recipient: w.recipient, frames: w.end - w.start })),
    starts: windows.filter((w) => w.end > w.start).map((w) => w.start),
    arrivals,
  }
}

describe('Thrilling Tales of Dragon Slayers', () => {
  it('declared off: nothing while the wielder never leaves the field', () => {
    expect(play('Sucrose E W5')).toMatchObject({ declared: true, on: [] })
  })

  it('the member taking the field gets it for 10 s when the wielder leaves', () => {
    const { declared, on, starts, arrivals } = play(
      'Sucrose E -> Xiangling E W5'
    )
    expect(declared).toBe(true)
    expect(on).toEqual([{ recipient: 'Xiangling', frames: 600 }])
    // (from the swap, before Xiangling's first action)
    expect(starts[0]).toBeLessThanOrEqual(arrivals[0])
    expect(arrivals[0] - starts[0]).toBeLessThan(30)
  })

  it('once per 20 s: a second swap-out within it gives nothing; after it, again', () => {
    // (the second swap about 3 s after the first: nothing)
    expect(
      play('Sucrose E -> Xiangling E -> Sucrose E -> Xiangling E W5').on
    ).toHaveLength(1)
    // (the second swap after 20 s: again)
    expect(
      play('Sucrose E -> Xiangling E W20 -> Sucrose E -> Xiangling E W5').on
    ).toEqual([
      { recipient: 'Xiangling', frames: 600 },
      { recipient: 'Xiangling', frames: 600 },
    ])
  })
})
