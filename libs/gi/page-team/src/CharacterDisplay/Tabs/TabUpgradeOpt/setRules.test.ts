import type {
  ArtifactSetKey,
  ArtifactSlotKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion, ICachedArtifact } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { setRulesPredicate } from './setRules'

const slots = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const
/** The equipped build of these sets, and whether swapping a piece of `set` into `slot` is allowed */
const swap = (
  sets: string[],
  slot: ArtifactSlotKey,
  set: string,
  exclusion: ArtSetExclusion
) =>
  setRulesPredicate(
    Object.fromEntries(
      slots.map((s, i) => [
        s,
        sets[i] && ({ setKey: sets[i] } as ICachedArtifact),
      ])
    ) as Record<ArtifactSlotKey, ICachedArtifact | undefined>,
    exclusion
  )({ slotKey: slot, setKey: set as ArtifactSetKey })

describe('the Improve tab keeps swaps within the build shapes allowed', () => {
  const [A, B, C, D] = [
    'GladiatorsFinale',
    'NoblesseOblige',
    'WanderersTroupe',
    'Instructor',
  ]
  const twoTwo: ArtSetExclusion = { twoTwo: [2, 4] }
  it('no two 2-piece bonuses: a swap making 2+2+1 or 3+2 is refused', () => {
    // A A B B D, a C in D's place: A A B B C (2+2+1)
    expect(swap([A, A, B, B, D], 'circlet', C, twoTwo)).toBe(false)
    // A A A B C, a B in C's place: A A A B B (3+2)
    expect(swap([A, A, A, B, C], 'circlet', B, twoTwo)).toBe(false)
  })
  it('allows 4-piece builds and mixed pieces', () => {
    // A A A A C (4+1), B A B C D (2+1+1+1)
    expect(swap([A, A, A, B, C], 'goblet', A, twoTwo)).toBe(true)
    expect(swap([A, A, B, C, D], 'flower', B, twoTwo)).toBe(true)
  })
  it('a build missing pieces is held to its sets only', () => {
    expect(swap([A, A, B, '', ''], 'sands', B, twoTwo)).toBe(true)
  })
  it('both shapes allowed: no limit', () => {
    expect(swap([A, A, B, B, D], 'circlet', C, {})).toBe(true)
  })
})
