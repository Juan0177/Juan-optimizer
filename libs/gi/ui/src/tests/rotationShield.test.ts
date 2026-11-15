/**
 * Shields (kqmsim's Shields.Add / OnShielded / CharacterIsShielded): kits mark the shields they
 * create, and the shield gear times itself from those markers.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { shieldMarker } from '../util/teamOpt/rotation/kits/common'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
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
