import type { RotationMember } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { cut, memberTurn } from './rotationTurns'

const names: RotationMember[] = [
  { characterKey: 'Anastasya', name: 'Anastasya' },
  { characterKey: 'Mitya', name: 'Mitya' },
  { characterKey: 'Odette', name: 'Odette' },
  { characterKey: 'Danica', name: 'Danica' },
]

describe('cut', () => {
  it('joins back to the rotation, its steps at separators and bare names', () => {
    const text = 'Danica E Odette E -> Mitya E Q, Danica Q'
    const c = cut(text, names)
    expect(c.parts.join('')).toBe(text)
    expect(c.steps.map((i) => c.parts[i].trim())).toEqual([
      'Danica E',
      'Odette E',
      'Mitya E Q',
      'Danica Q',
    ])
  })
})

describe('memberTurn', () => {
  it('is the member’s first turn, cut as the parser cuts it', () => {
    expect(
      memberTurn(
        'Danica E -> Odette E E -> Mitya E Q -> Danica Q',
        names,
        'Mitya'
      )
    ).toBe(2)
    // (a rotation Optimize rotation reordered)
    expect(
      memberTurn(
        'Odette E E -> Danica E Q -> Mitya N1 E Q -> Anastasya hE N2',
        names,
        'Mitya'
      )
    ).toBe(2)
    expect(memberTurn('Danica E Odette E Mitya E', names, 'Mitya')).toBe(2)
    expect(memberTurn('Mitya E -> Danica Q -> Mitya Q', names, 'Mitya')).toBe(0)
  })
  it('has none when the member does not act there', () => {
    expect(memberTurn('Danica E -> Odette E E', names, 'Mitya')).toBeUndefined()
    // (a trailing name alone: the loop back, not a turn)
    expect(memberTurn('Danica E -> Mitya', names, 'Mitya')).toBeUndefined()
  })
})
