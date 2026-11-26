import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { kqmLockedWeapon } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { lockWeapon, setLockedRefinement } from './KqmWeaponLock'

const settings = (extra: Partial<TeamOptKqm>): TeamOptKqm => ({
  ...structuredClone(defaultTeamOptKqm),
  ...extra,
})

describe('a member’s locked weapon, set in Choose weapons', () => {
  it('Any unlocks a member a team variant locked to its signature', () => {
    const kqm = settings({ signature: { Mitya: 1, Odette: 2 } })
    expect(kqmLockedWeapon('Mitya', kqm)?.key).toBe('StarsealedEdict')
    lockWeapon(kqm, 'Mitya', undefined)
    expect(kqmLockedWeapon('Mitya', kqm)).toBeUndefined()
    // (only that member's: the others keep theirs)
    expect(kqm.signature).toEqual({ Odette: 2 })
  })
  it('another weapon replaces the signature lock', () => {
    const kqm = settings({ signature: { Mitya: 1 } })
    lockWeapon(kqm, 'Mitya', 'SacrificialFragments')
    expect(kqmLockedWeapon('Mitya', kqm)?.key).toBe('SacrificialFragments')
    expect(kqm.signature).toBeUndefined()
  })
  it('the signature chosen here keeps its refinement, and its refinement changes', () => {
    const kqm = settings({ signature: { Mitya: 3 } })
    setLockedRefinement(kqm, 'Mitya', 'StarsealedEdict', 5)
    expect(kqmLockedWeapon('Mitya', kqm)).toEqual({
      key: 'StarsealedEdict',
      refinement: 5,
    })
    lockWeapon(kqm, 'Mitya', 'StarsealedEdict')
    expect(kqmLockedWeapon('Mitya', kqm)).toEqual({
      key: 'StarsealedEdict',
      refinement: 5,
    })
  })
  it('a signature left out (0) is no lock, and stays', () => {
    const kqm = settings({ signature: { Mitya: 0 } })
    lockWeapon(kqm, 'Mitya', undefined)
    expect(kqm.signature).toEqual({ Mitya: 0 })
    expect(kqmLockedWeapon('Mitya', kqm)).toBeUndefined()
  })
})
