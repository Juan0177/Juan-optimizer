/**
 * KQM rules that follow Energy (weapon audit 2026-11-16): the Watatsumi weapons (Wavebreaker's
 * Fin, Mouun's Moon, Akuoumaru) from the party's combined maximum Energy, as kqmsim counts it;
 * Moonweaver's Dawn's extra bonus from its wielder's own Energy capacity.
 */
import { describe, expect, it } from 'vitest'
import {
  type ItemConditionalCtx,
  itemConditionals,
} from '../util/teamOpt/itemConditionals'

const ctx = (more: Partial<ItemConditionalCtx>): ItemConditionalCtx => ({
  attacks: ['normal', 'skill', 'burst'],
  auras: ['hydro'],
  ...more,
})
const picked = (c: ItemConditionalCtx, weapon: string) =>
  itemConditionals(c, { sets: [], weapons: [weapon as never] }).picked.find(
    (p) => p.path[0] === weapon
  )?.value

describe('the Watatsumi weapons', () => {
  it('count the party’s Burst costs, in steps of 10 (40 to 350)', () => {
    for (const w of ['WavebreakersFin', 'MouunsMoon', 'Akuoumaru']) {
      expect(picked(ctx({ teamEnergy: 260 }), w)).toBe('260')
      expect(picked(ctx({ teamEnergy: 255 }), w)).toBe('250')
      expect(picked(ctx({ teamEnergy: 30 }), w)).toBe('40')
      expect(picked(ctx({ teamEnergy: 400 }), w)).toBe('350')
    }
  })
  it('stay off when the party is unknown', () => {
    expect(picked(ctx({}), 'WavebreakersFin')).toBeUndefined()
  })
})

describe('Moonweaver’s Dawn', () => {
  it('adds its bonus for an Energy capacity of at most 40, or 60', () => {
    expect(picked(ctx({ burstCost: 40 }), 'MoonweaversDawn')).toBe('40')
    expect(picked(ctx({ burstCost: 60 }), 'MoonweaversDawn')).toBe('60')
    expect(picked(ctx({ burstCost: 80 }), 'MoonweaversDawn')).toBeUndefined()
    // (no Energy at all: the 40 tier, as kqmsim)
    expect(picked(ctx({ burstCost: 0 }), 'MoonweaversDawn')).toBe('40')
  })
})

describe('sword rules (weapon audit, sword4)', () => {
  it('Azurelight’s 0-Energy bonus only for a Burst that costs none', () => {
    const value = (zeroEnergy: boolean) =>
      itemConditionals(ctx({ zeroEnergy }), {
        sets: [],
        weapons: ['Azurelight' as never],
      }).picked.find((p) => p.path.join('.') === 'Azurelight.noEnergy')?.value
    expect(value(true)).toBe('on')
    expect(value(false)).toBeUndefined()
  })
  it('Mistsplitter counts a stack per source the member uses', () => {
    expect(picked(ctx({}), 'MistsplitterReforged')).toBe('3')
    expect(picked(ctx({ attacks: ['skill'] }), 'MistsplitterReforged')).toBe(
      '1'
    )
  })
  it('Haran Geppaku Futsu needs a Skill and Normal Attacks', () => {
    expect(picked(ctx({}), 'HaranGeppakuFutsu')).toBe('2')
    expect(
      picked(ctx({ attacks: ['burst'] }), 'HaranGeppakuFutsu')
    ).toBeUndefined()
  })
})
