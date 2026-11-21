/**
 * A written rotation with members swapped (KQM versions): the replacement plays its part at the
 * first step of the member it replaces; the other steps stay as written.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import {
  memberSteps,
  parseRotation,
  swapRotationMembers,
} from '../util/teamOpt/rotation/parse'
import { supportPart } from '../util/teamOpt/rotation/templates'

const team = (keys: CharacterKey[], names: Record<string, string> = {}) =>
  keys.map((characterKey) => ({
    characterKey,
    name: names[characterKey] ?? characterKey,
  }))
const members = team(['Sandrone', 'Anastasya', 'Odette', 'Mitya'], {
  Anastasya: 'Tsaritsa',
})

describe('swapRotationMembers', () => {
  it("puts the replacement's part at the member's first step and leaves out its later ones", () => {
    expect(
      swapRotationMembers(
        'Odette E E -> Mitya E N1 -> Sandrone E N3 -> Mitya N2 CA W8f -> Odette',
        members,
        [{ from: 'Mitya', name: 'Bennett', part: 'E Q' }]
      )
    ).toBe('Odette E E -> Bennett E Q -> Sandrone E N3 -> Odette')
  })
  it('loops back to the replacement, and reads nicknames and steps without arrows', () => {
    expect(
      swapRotationMembers(
        'Ana E Q Odette E E -> Sandrone E N5 -> Ana',
        members,
        [{ from: 'Anastasya', name: 'Furina', part: 'E Q' }]
      )
    ).toBe('Furina E Q -> Odette E E -> Sandrone E N5 -> Furina')
  })
  it('plays the part last, before the loop back, for a member without a step', () => {
    expect(
      swapRotationMembers('Sandrone E N5 -> Odette E -> Sandrone', members, [
        { from: 'Mitya', name: 'Xilonen', part: 'E N2' },
      ])
    ).toBe('Sandrone E N5 -> Odette E -> Xilonen E N2 -> Sandrone')
  })
  it("puts a main DPS's replacement at its longest step, and loops back to the first member", () => {
    expect(
      swapRotationMembers(
        'Sandrone E -> Odette E E -> Mitya E -> Sandrone Q 3[N2 CA] -> Sandrone',
        members,
        [{ from: 'Sandrone', name: 'Varesa', part: 'E Q N1 P', longest: true }]
      )
    ).toBe('Odette E E -> Mitya E -> Varesa E Q N1 P -> Odette')
  })
  it("only leaves out the member's steps without a part (an opener's setup)", () => {
    expect(
      swapRotationMembers('Mitya E -> Odette E', members, [
        { from: 'Mitya', name: 'Bennett' },
      ])
    ).toBe('Odette E')
  })
  it('swaps two members at once, and the result parses with the new team', () => {
    const text = swapRotationMembers(
      'Odette E E -> Mitya E N1 -> Tsaritsa hE Q N3 -> Sandrone E N3 CA -> Odette',
      members,
      [
        { from: 'Mitya', name: 'Bennett', part: 'E Q' },
        { from: 'Odette', name: 'Kazuha', part: 'hE Q' },
      ]
    )
    expect(text).toBe(
      'Kazuha hE Q -> Bennett E Q -> Tsaritsa hE Q N3 -> Sandrone E N3 CA -> Kazuha'
    )
    const parsed = parseRotation(
      text,
      team(['Sandrone', 'Anastasya', 'KaedeharaKazuha', 'Bennett'], {
        Anastasya: 'Tsaritsa',
        KaedeharaKazuha: 'Kazuha',
      })
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.steps.map((s) => s.characterKey)).toEqual([
      'KaedeharaKazuha',
      'Bennett',
      'Anastasya',
      'Sandrone',
    ])
    expect(parsed.loopsTo).toBe('KaedeharaKazuha')
  })
})

describe('supportPart', () => {
  it("is a character's most common step as a support in the templates", () => {
    const part = supportPart('Bennett')
    expect(part).not.toBe('')
    expect(
      memberSteps(`Bennett ${part}`, team(['Bennett']), 'Bennett')
    ).toEqual([part])
  })
  it('is E Q for one no template has as a support', () => {
    expect(supportPart('Ifa')).toBe('E Q')
  })
})
