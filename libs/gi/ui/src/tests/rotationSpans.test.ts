import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { rotationSpans } from '../util/teamOpt/rotation/parse'

const members = (
  [
    ['Mitya', 'Mitya'],
    ['Odette', 'Odette'],
    ['KaedeharaKazuha', 'Kaedehara Kazuha'],
  ] as [CharacterKey, string][]
).map(([characterKey, name]) => ({ characterKey, name }))

/** Each piece as `kind:text` (members with their key) */
const pieces = (text: string) =>
  rotationSpans(text, members).map(
    (s) =>
      `${s.kind}${s.characterKey ? `(${s.characterKey})` : ''}:${text.slice(s.from, s.to)}`
  )

describe('rotationSpans (the writer’s colours)', () => {
  it('reads steps as the parser does: names, actions, waits, separators', () => {
    expect(pieces('Mitya tE W1.5 -> Odette E Q')).toEqual([
      'member(Mitya):Mitya',
      'action:tE',
      'wait:W1.5',
      'separator:->',
      'member(Odette):Odette',
      'action:E',
      'action:Q',
    ])
  })
  it('marks what the parser skips, and notes', () => {
    expect(pieces('Odette E Xx (refresh) -> Nobody E')).toEqual([
      'member(Odette):Odette',
      'action:E',
      'unknown:Xx',
      'note:(refresh)',
      'separator:->',
      'unknown:Nobody',
      'unknown:E',
    ])
  })
  it('takes a name of several words, a later exact name as a new step, and "A/B"', () => {
    expect(pieces('Kaedehara Kazuha E Mitya CA/N1')).toEqual([
      'member(KaedeharaKazuha):Kaedehara',
      'member(KaedeharaKazuha):Kazuha',
      'action:E',
      'member(Mitya):Mitya',
      'action:CA',
      'note:/N1',
    ])
  })
  it('covers the text exactly: every piece where the text has it', () => {
    const text = 'mit E\nOdette  E   E,Mitya Q'
    // (no piece takes the spaces around it: words only, and the separators)
    for (const s of rotationSpans(text, members))
      if (s.kind !== 'separator')
        expect(text.slice(s.from, s.to).trim()).toBe(text.slice(s.from, s.to))
    expect(pieces(text).filter((p) => p.startsWith('separator'))).toEqual([
      'separator:\n',
      'separator:,',
    ])
  })
})
