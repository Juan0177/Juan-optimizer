import { describe, expect, it } from 'vitest'
import { attackHitGroup, attackHitLabel } from './hitLabel'

describe('attackHitLabel', () => {
  it('keeps the reaction the simulation already put in the description', () => {
    // rotationAttacks writes "Frostfall Storm (Melt)" for a melting hit: no second "(Melt)"
    expect(
      attackHitLabel({
        path: ['skill', 'frostfallDmg'],
        description: 'Frostfall Storm (Melt)',
        reaction: 'melt',
      })
    ).toBe('Frostfall Storm (Melt)')
  })
  it('adds the reaction when the description does not carry it', () => {
    expect(
      attackHitLabel({
        path: ['skill', 'frostfallDmg'],
        description: 'Frostfall Storm',
        reaction: 'melt',
      })
    ).toBe('Frostfall Storm (Melt)')
  })
  it('falls back to the path, and leaves hits without a reaction alone', () => {
    expect(attackHitLabel({ path: ['skill', 'frostfallDmg'] })).toBe(
      'skill.frostfallDmg'
    )
    expect(
      attackHitLabel({ path: ['skill', 'x'], description: 'Frostfall Storm' })
    ).toBe('Frostfall Storm')
  })
  it('unknown reactions keep their key', () => {
    expect(
      attackHitLabel({ path: ['a'], description: 'Hit', reaction: 'odd' })
    ).toBe('Hit (odd)')
  })
})

describe('attackHitGroup', () => {
  it('puts every trailing kind of hit in the part, the reaction last', () => {
    const cyclic = {
      path: ['skill', 'chargedCyclicDmg'],
      description: 'Flamestrider Charged Attack (Cyclic)',
    }
    expect(attackHitGroup(cyclic)).toEqual({
      name: 'Flamestrider Charged Attack',
      tags: ['Cyclic'],
    })
    expect(
      attackHitGroup({
        ...cyclic,
        description: 'Flamestrider Charged Attack (Cyclic) (Melt)',
        reaction: 'melt',
      })
    ).toEqual({ name: 'Flamestrider Charged Attack', tags: ['Cyclic', 'Melt'] })
  })
  it('an attack without kinds is its own name', () => {
    expect(
      attackHitGroup({ path: ['skill', 'x'], description: 'Frostfall Storm' })
    ).toEqual({ name: 'Frostfall Storm', tags: [] })
    expect(
      attackHitGroup({
        path: ['skill', 'x'],
        description: 'Frostfall Storm (Melt)',
        reaction: 'melt',
      })
    ).toEqual({ name: 'Frostfall Storm', tags: ['Melt'] })
  })
})
