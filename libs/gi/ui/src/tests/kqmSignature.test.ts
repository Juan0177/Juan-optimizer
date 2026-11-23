import { signatureWeapons } from '@genshin-optimizer/gi/consts'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { getWeaponStat } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { kqmLockedWeapon, kqmWeapons } from '../util/teamOpt/kqm'

describe('signature weapons in KQM', () => {
  it('each one is a 5★ of its character’s weapon type, none twice', () => {
    const keys = Object.values(signatureWeapons)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(getWeaponStat(key!).rarity).toBe(5)
  })
  it('a member locked to its signature at the chosen refinement, or never given it', () => {
    // (every weapon on: the default list leaves the 5★ event wish ones out)
    const all = { ...defaultTeamOptKqm, excludedWeapons: [], weaponList: 2 }
    const kqm = { ...all, signature: { Furina: 3, Nahida: 0 } }
    expect(kqmLockedWeapon('Furina', kqm)).toEqual({
      key: 'SplendorOfTranquilWaters',
      refinement: 3,
    })
    expect(kqmWeapons('Furina', kqm)).toEqual([
      { key: 'SplendorOfTranquilWaters', refinement: 3 },
    ])
    expect(kqmLockedWeapon('Nahida', kqm)).toBeUndefined()
    expect(kqmWeapons('Nahida', kqm).map((w) => w.key)).not.toContain(
      'AThousandFloatingDreams'
    )
    expect(kqmWeapons('Nahida', all).map((w) => w.key)).toContain(
      'AThousandFloatingDreams'
    )
    // (over a weapon locked for the family)
    expect(
      kqmLockedWeapon('Furina', {
        ...kqm,
        lockedWeapons: { Furina: 'FavoniusSword' },
      })
    ).toEqual({ key: 'SplendorOfTranquilWaters', refinement: 3 })
  })
})
