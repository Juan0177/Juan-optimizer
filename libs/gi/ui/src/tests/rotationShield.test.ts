/**
 * Shields (kqmsim's Shields.Add / OnShielded / CharacterIsShielded): kits mark the shields they
 * create, and the shield gear times itself from those markers.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { shieldMarker } from '../util/teamOpt/rotation/kits/common'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimGear } from '../util/teamOpt/rotation/types'

/**
 * Every action takes 120 frames; a Skill creates a party shield (or one on `target`) at once,
 * lasting `shield` frames (the nth Skill: the nth of a list, the last one after)
 */
const kit = (
  characterKey: CharacterKey,
  shield?: number | number[],
  target?: CharacterKey
): KitModel => {
  let skills = 0
  return {
    characterKey,
    element: 'geo',
    source: 'test',
    act(ctx, _state, action) {
      if (action.kind === 'skill' && shield) {
        const list = [shield].flat()
        const frames = list[Math.min(skills++, list.length - 1)]
        shieldMarker(ctx, 0, frames, 'Shield', { target })
      }
      return { frames: 120 }
    },
  }
}
const members: CharacterKey[] = ['Nicole', 'Flins']
const run = (
  text: string,
  gear: Partial<Record<CharacterKey, SimGear>>,
  shield: number | number[] = 600,
  target?: CharacterKey
) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Nicole: 'geo', Flins: 'electro' },
    repeats: 1,
    kits: { Nicole: kit('Nicole', shield, target), Flins: kit('Flins') },
    reactions: { onHit() {} },
    gear,
  })
  const start = (who: CharacterKey, nth = 0) =>
    sim.actions.filter((a) => a.characterKey === who)[nth].start
  const windows = (path: string) =>
    sim.buffWindows
      .filter((w) => w.path.join('.') === path && w.end > w.start && !!w.value)
      .map((w) => [w.start, Math.min(w.end, sim.start + sim.frames)])
  return { sim, start, windows }
}

describe('shield gear', () => {
  it("Angelos Heptades: Pathfinder's Light for 20 s after its wielder creates a shield", () => {
    const { start, windows } = run('Nicole E -> Flins N1 N1', {
      Nicole: { weapon: 'AngelosHeptades', refinement: 5 },
    })
    const at = start('Nicole')
    expect(windows('AngelosHeptades.shield')).toEqual([
      [at, expect.any(Number)],
    ])
    expect(
      run('Nicole N1 -> Flins N1', {
        Nicole: { weapon: 'AngelosHeptades', refinement: 5 },
      }).windows('AngelosHeptades.shield')
    ).toEqual([])
  })
  it('"while protected by a shield": only while the wielder is on the field under a party shield', () => {
    const { sim, start, windows } = run(
      'Nicole E -> Flins N1 N1 -> Nicole N1 -> Flins N1',
      {
        Flins: { weapon: 'VortexVanquisher', refinement: 1 },
      }
    )
    const shieldAt = start('Nicole')
    const swaps = sim.swaps!
    const into = (who: CharacterKey, nth = 0) =>
      swaps.filter((s) => s.to === who)[nth]
    const on1 = into('Flins', 0)
    const off1 = into('Nicole', 0)
    // (the shield lasts 600 frames from the Skill)
    const end = shieldAt + 600
    const spans = windows('VortexVanquisher.WithShield')
    expect(spans[0][0]).toBeGreaterThanOrEqual(on1.start)
    expect(spans[0][1]).toBeLessThanOrEqual(
      Math.min(off1.start + off1.frames, end)
    )
    for (const [from, to] of spans) {
      expect(from).toBeGreaterThanOrEqual(shieldAt)
      expect(to).toBeLessThanOrEqual(end)
    }
    // never while Nicole holds the field
    const nicoleOn = swaps
      .filter((s) => s.to === 'Nicole')
      .map((s) => s.start + s.frames)
    for (const t of nicoleOn)
      for (const [from, to] of spans) expect(t < from || t >= to).toBe(true)
  })
  it('a shield targeted at a member protects it off the field too', () => {
    const { start, windows } = run(
      'Nicole E -> Flins N1 -> Nicole N1 N1 N1 N1 N1',
      { Flins: { weapon: 'VortexVanquisher', refinement: 1 } },
      600,
      'Flins'
    )
    const at = start('Nicole')
    expect(windows('VortexVanquisher.WithShield')).toEqual([[at, at + 600]])
  })
  it("Beacon of the Reed Sea's HP bonus is on exactly while its wielder is not shielded", () => {
    const { sim, windows } = run(
      'Nicole E -> Flins N1 N1 -> Nicole N1 -> Flins N1 N1 N1 N1',
      {
        Flins: {
          weapon: 'BeaconOfTheReedSea',
          refinement: 1,
          candidates: { weapons: ['VortexVanquisher'] },
        },
      }
    )
    const shielded = windows('VortexVanquisher.WithShield')
    expect(shielded.length).toBeGreaterThan(0)
    // (its complement over the run)
    const complement: number[][] = []
    let from = 0
    for (const [start, to] of shielded) {
      if (start > from) complement.push([from, start])
      from = to
    }
    complement.push([from, sim.start + sim.frames])
    expect(windows('BeaconOfTheReedSea.noShield')).toEqual(complement)
  })
  it("Starcaller's Watch: only for a shield created on the field, once per 14 s", () => {
    const gear = { Nicole: { weapon: 'StarcallersWatch', refinement: 1 } }
    const { sim, start, windows } = run('Nicole E N1 N1 N1 N1 N1 N1 E E', gear)
    const first = start('Nicole')
    // (Skills at 0, 14 and 16 s: the first, and the one after its 14 s)
    const end = sim.start + sim.frames
    expect(windows('StarcallersWatch.shield')).toEqual([
      [first, first + 900],
      [start('Nicole', 7), Math.min(end, start('Nicole', 7) + 900)],
    ])
    // (none from a shield created off the field)
    expect(
      run('Flins N1 -> Nicole E', {
        Flins: { weapon: 'StarcallersWatch', refinement: 1 },
      }).windows('StarcallersWatch.shield')
    ).toEqual([])
  })
  it("a new shield replaces the creator's earlier one of the same kind", () => {
    const { start, windows } = run(
      'Nicole E -> Flins N1 -> Nicole E -> Flins N1 N1 N1 N1 N1 N1 N1 N1',
      { Flins: { weapon: 'TheUnforged', refinement: 1 } },
      [1200, 240]
    )
    const second = start('Nicole', 1)
    const spans = windows('TheUnforged.WithShield')
    // (protected until the second shield's own 240 frames end, not the first's 1200)
    expect(Math.max(...spans.map((w) => w[1]))).toBe(second + 240)
  })
  it("times the shield effects of a weapon of the member's type it doesn't hold (one a build tries)", () => {
    const of = (sim: ReturnType<typeof run>['sim'], path: string) =>
      sim.buffWindows.filter(
        (w) => w.owner === 'Flins' && w.path.join('.') === path
      )
    const gear = { Flins: { weapon: 'StaffOfHoma', refinement: 1 } }
    // (no shield: declared off, so a saved switch never turns it on)
    const none = run('Nicole N1 -> Flins N1 N1', gear).sim
    expect(of(none, 'VortexVanquisher.WithShield').length).toBeGreaterThan(0)
    expect(
      of(none, 'VortexVanquisher.WithShield').every(
        (w) => w.end === w.start && w.offOnly
      )
    ).toBe(true)
    // (a claymore: never Flins's)
    expect(of(none, 'TheBell.WithShield')).toEqual([])
    // (under Nicole's shield: on while she is on the field and protected, as for its holder)
    const { start, windows } = run('Nicole E -> Flins N1 N1', gear)
    const at = start('Nicole')
    const spans = windows('VortexVanquisher.WithShield')
    expect(spans.length).toBeGreaterThan(0)
    for (const [from, to] of spans) {
      expect(from).toBeGreaterThanOrEqual(at)
      expect(to).toBeLessThanOrEqual(at + 600)
    }
  })
  it("turns off a saved shield switch for a weapon the member's attacks don't hold, without a shield", () => {
    const play = (team: CharacterKey[], text: string, saved = 'on') =>
      rotationAttacks(
        simulateRotation({
          rotation: parseRotation(
            text,
            team.map((characterKey) => ({ characterKey, name: characterKey }))
          ),
          members: team,
          elements: Object.fromEntries(team.map((k) => [k, getCharEle(k)])),
          constellations: {},
          repeats: 1,
          gear: { Skirk: { weapon: 'FinaleOfTheDeep', refinement: 5 } },
        }),
        (owner, path) =>
          owner === 'Skirk' && path.join('.') === 'CalamityOfEshu.passive'
            ? saved
            : undefined
      ).Skirk!
    const off = (attack: { limits?: { path: string[]; hits: number }[] }) =>
      !!attack.limits?.some(
        (l) => l.path.join('.') === 'CalamityOfEshu.passive' && l.hits === 0
      )
    const unshielded = play(
      ['Skirk', 'Furina', 'Mona', 'Escoffier'],
      'Furina E N1 Q -> Escoffier E Q -> Mona E Q -> Skirk E N2 Q 3[N5 D] N2'
    )
    expect(unshielded.length).toBeGreaterThan(0)
    expect(unshielded.every(off)).toBe(true)
    // (under Zhongli's shield her switch stands)
    const shielded = play(['Skirk', 'Zhongli'], 'Zhongli hE -> Skirk E N5')
    expect(shielded.some((a) => !off(a))).toBe(true)
    // (none saved: nothing of a weapon she doesn't hold, so no attack is split by it)
    const unsaved = play(['Skirk', 'Zhongli'], 'Zhongli hE -> Skirk E N5', '')
    expect(
      unsaved.every(
        (a) =>
          ![...(a.states ?? []), ...(a.limits ?? [])].some(
            (s) => s.path[0] === 'CalamityOfEshu'
          )
      )
    ).toBe(true)
  })
  it('declares the conditionals off when no shield is ever created', () => {
    const { sim } = run('Nicole N1 -> Flins N1', {
      Nicole: { weapon: 'AngelosHeptades', refinement: 1 },
      Flins: { weapon: 'CalamityOfEshu', refinement: 1 },
    })
    const declared = sim.buffWindows
      .filter((w) => ['AngelosHeptades', 'CalamityOfEshu'].includes(w.path[0]))
      .map((w) => [w.path.join('.'), w.end - w.start])
    expect(declared).toEqual(
      expect.arrayContaining([
        ['AngelosHeptades.shield', 0],
        ['CalamityOfEshu.passive', 0],
      ])
    )
    expect(declared.every(([, length]) => length === 0)).toBe(true)
  })
})
