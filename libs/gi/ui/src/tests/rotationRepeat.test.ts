import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation, rotationSpans } from '../util/teamOpt/rotation/parse'

const names = (keys: CharacterKey[]) =>
  keys.map((characterKey) => ({ characterKey, name: characterKey }))
const actions = (text: string, keys: CharacterKey[]) => {
  const parsed = parseRotation(text, names(keys))
  return {
    words: parsed.steps.flatMap((s) =>
      s.actions.map(
        (a) =>
          `${a.kind}${a.count ?? ''}${a.spins ? `x${a.spins}` : ''}${a.beams ? `b${a.beams}` : ''}`
      )
    ),
    warnings: parsed.warnings,
  }
}

describe('a group written once with how many times (a player request)', () => {
  it('reads "4N5CD" as N5CD four times', () => {
    const { words, warnings } = actions('Wriothesley 4N5CD', ['Wriothesley'])
    expect(warnings).toEqual([])
    expect(words).toEqual(Array(4).fill(['normal5', 'charged', 'dash']).flat())
  })
  it('reads KQM\'s "4[C2D]" and a group with spaces, "2[N5 CD]"', () => {
    expect(actions('Mavuika E Q 4[C2D] C', ['Mavuika']).words).toEqual([
      'skill',
      'burst',
      ...Array(4).fill(['chargedx2', 'dash']).flat(),
      'charged',
    ])
    expect(actions('Wriothesley 2[N5 CD] N3', ['Wriothesley']).words).toEqual([
      ...Array(2).fill(['normal5', 'charged', 'dash']).flat(),
      'normal3',
    ])
  })
  it("leaves Sandrone's CA[beams=2] and a wait as they are, and caps the count at 20", () => {
    // (its 2 beams kept: not "2 times")
    expect(actions('Sandrone CA[beams=2] W1.5', ['Sandrone']).words).toEqual([
      'chargedb2',
      'wait1.5',
    ])
    const big = actions('Wriothesley 99N5', ['Wriothesley'])
    expect(big.words).toEqual(['normal5'])
    expect(big.warnings.join(' ')).toContain('1 to 20 times')
  })
  it('colours a repeated group as actions, spaces or not', () => {
    const text = 'Wriothesley 4N5CD 2[N5 CD]'
    const kinds = rotationSpans(text, names(['Wriothesley'])).map(
      (s) => `${s.kind}:${text.slice(s.from, s.to)}`
    )
    expect(kinds).toEqual([
      'member:Wriothesley',
      'action:4N5CD',
      'action:2[N5',
      'action:CD]',
    ])
  })
})
