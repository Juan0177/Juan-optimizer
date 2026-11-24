import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { parseRotation, simulateRotation } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { reactionCounts, reactionEvents, reactionKind } from './reactionEvents'

const members: CharacterKey[] = ['Mavuika', 'Bennett', 'Xilonen', 'Citlali']
const sim = simulateRotation({
  rotation: parseRotation(
    'Mavuika E C -> Bennett E -> Xilonen E N2 -> Bennett Q -> Citlali E Q N1 -> Mavuika E C Q CD C3F D CF D CF D CD C2',
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  ),
  members,
  constellations: { Mavuika: 2, Bennett: 5, Xilonen: 0, Citlali: 0 },
  elements: Object.fromEntries(members.map((m) => [m, getCharEle(m)])) as never,
})

describe('reactionEvents', () => {
  it('lists the on-field member’s reactions with their hit and direction', () => {
    const events = reactionEvents(sim, { onFieldOnly: true })
    expect(
      events.every((e) => !e.onField || e.onField === e.characterKey)
    ).toBe(true)
    const mavuika = events.filter((e) => e.characterKey === 'Mavuika')
    // her 5 melting charged attacks and Sunfell Slice: Pyro on Citlali's Cryo
    expect(mavuika).toHaveLength(6)
    expect(
      mavuika.every(
        (e) =>
          e.reaction === 'melt' &&
          e.direction === 'forward' &&
          e.element === 'pyro'
      )
    ).toBe(true)
    expect(
      mavuika.filter((e) => e.label?.startsWith('Flamestrider Charged Attack'))
    ).toHaveLength(5)
    // in order, inside the kept rotation
    for (let i = 1; i < events.length; i++)
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t)
    expect(
      events.every((e) => e.t >= sim.start && e.t < sim.start + sim.frames)
    ).toBe(true)
  })
  it('off-field triggers count when asked for every reaction', () => {
    const all = reactionEvents(sim)
    const citlali = all.filter((e) => e.characterKey === 'Citlali')
    expect(citlali.length).toBeGreaterThan(0)
    // her Ice Storm on Mavuika's Pyro: reverse Melt
    expect(
      citlali.some((e) => e.reaction === 'melt' && e.direction === 'reverse')
    ).toBe(true)
    expect(all.length).toBeGreaterThan(
      reactionEvents(sim, { onFieldOnly: true }).length
    )
  })
  it('names the hit that triggers a reaction of its own (Crystallize)', () => {
    const crystallize = reactionEvents(sim).filter(
      (e) => e.reaction === 'crystallize'
    )
    expect(crystallize.length).toBeGreaterThan(0)
    expect(crystallize.every((e) => e.label && e.element === 'geo')).toBe(true)
  })
  it('counts forward and reverse apart', () => {
    const counts = reactionCounts(reactionEvents(sim))
    expect(counts.get('Mavuika')?.get('melt.forward')).toBe(6)
    expect(counts.get('Citlali')?.get('melt.reverse')).toBeGreaterThan(0)
  })
  it('names and colours', () => {
    expect(reactionKind('pyroSwirl')).toEqual({
      key: 'swirl',
      palette: 'swirl',
    })
    expect(reactionKind('electroCharged').palette).toBe('electrocharged')
    expect(reactionKind('melt')).toEqual({ key: 'melt', palette: 'melt' })
  })
})
