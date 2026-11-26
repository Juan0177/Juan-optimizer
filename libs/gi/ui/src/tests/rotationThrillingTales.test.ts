/**
 * Thrilling Tales of Dragon Slayers (gcsim/kqmsim): when the wielder leaves the field, the member
 * taking it gets its ATK for 10 s, once per 20 s. Declared off outside its windows, so no saved
 * switch keeps it on all rotation (a wielder that never leaves the field gives nothing).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
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

describe('Thrilling Tales of Dragon Slayers a build tries (Team optimize)', () => {
  const HERITAGE = ['ThrillingTalesOfDragonSlayers', 'Heritage']
  const members: CharacterKey[] = ['Sucrose', 'Mona', 'Xiangling']
  const sim = simulateRotation({
    rotation: parseRotation(
      'Sucrose E -> Mona E -> Xiangling E W5',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Sucrose: 'anemo', Mona: 'hydro', Xiangling: 'pyro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    kits: {
      Sucrose: probe('Sucrose'),
      Mona: probe('Mona'),
      Xiangling: probe('Xiangling'),
    },
    reactions: { onHit() {} },
    // (Mona holds it; Sucrose, another Catalyst user, could)
    gear: {
      Sucrose: { weapon: 'FavoniusCodex' },
      Mona: { weapon: 'ThrillingTalesOfDragonSlayers' },
    },
  })
  const sucroses = sim.buffWindows.filter(
    (w) => w.owner === 'Sucrose' && w.path.join('.') === HERITAGE.join('.')
  )
  const limited = (
    attacks: ReturnType<typeof rotationAttacks>,
    member: CharacterKey
  ) =>
    attacks[member]!.every((a) =>
      a.limits?.some(
        (l) => l.owner === 'Sucrose' && l.path.join('.') === HERITAGE.join('.')
      )
    )

  it('times the one its member does not hold, only where its switch is saved', () => {
    expect(sucroses.length).toBeGreaterThan(0)
    expect(sucroses.every((w) => w.offOnly)).toBe(true)
    expect(
      sucroses.filter((w) => w.end > w.start).map((w) => w.recipient)
    ).toEqual(['Mona'])
  })

  it('a saved switch counts only for the member taking the field when it leaves', () => {
    const attacks = rotationAttacks(sim, (owner, path) =>
      owner === 'Sucrose' && path.join('.') === HERITAGE.join('.')
        ? 'on'
        : undefined
    )
    expect(limited(attacks, 'Xiangling')).toBe(true)
    expect(limited(attacks, 'Sucrose')).toBe(true)
    expect(attacks.Mona!.some((a) => a.limits?.length)).toBe(false)
  })

  it('without a saved switch, it adds nothing', () => {
    const attacks = rotationAttacks(sim)
    const sucrose = (s: { owner: string; path: string[] }) =>
      s.owner === 'Sucrose' && s.path.join('.') === HERITAGE.join('.')
    for (const member of members)
      expect(
        attacks[member]!.some(
          (a) => a.limits?.some(sucrose) || a.states?.some(sucrose)
        )
      ).toBe(false)
  })
})

describe('Thrilling Tales on short rotations (< 20 s)', () => {
  it('triggers only every other rotation in steady-state when rotation length is under 20 s', () => {
    const members: CharacterKey[] = ['Sucrose', 'Xiangling']
    // ~15 s loop (each action 60f + 12f swap + 13 s wait)
    const sim = simulateRotation({
      rotation: parseRotation(
        'Sucrose E -> Xiangling E W13',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Sucrose: 'anemo', Xiangling: 'pyro' },
      constellations: {},
      repeats: 4,
      keep: 'last2',
      kits: { Sucrose: probe('Sucrose'), Xiangling: probe('Xiangling') },
      reactions: { onHit() {} },
      gear: { Sucrose: { weapon: 'ThrillingTalesOfDragonSlayers' } },
    })
    const attacks = rotationAttacks(sim, (owner, path) =>
      owner === 'Sucrose' && path[0] === 'ThrillingTalesOfDragonSlayers'
        ? 'on'
        : undefined
    )
    const xl = attacks.Xiangling ?? []
    const on = xl
      .filter(
        (a) =>
          !a.limits?.some((l) => l.path[0] === 'ThrillingTalesOfDragonSlayers')
      )
      .reduce((s, a) => s + a.hits, 0)
    const off = xl
      .filter((a) =>
        a.limits?.some((l) => l.path[0] === 'ThrillingTalesOfDragonSlayers')
      )
      .reduce((s, a) => s + a.hits, 0)
    expect(on).toBe(1)
    expect(off).toBe(1)
  })

  it('scales rule conditional uptime when manual rotationTime is under 20 s', () => {
    const pick = (rotationTime?: number) =>
      itemConditionals(
        { attacks: ['skill'], auras: ['anemo'], rotationTime },
        { sets: [], weapons: ['ThrillingTalesOfDragonSlayers'] }
      ).conditional?.ThrillingTalesOfDragonSlayers?.Heritage
    expect(pick(undefined)).toBe('on')
    expect(pick(20)).toBe('on')
    expect(pick(18)).toBe('50')
    expect(pick(15)).toBe('50')
    expect(pick(9)).toBe('35')
  })
})
