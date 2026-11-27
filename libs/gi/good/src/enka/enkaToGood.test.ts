import {
  allArtifactSetKeys,
  allTravelerKeys,
  allWeaponKeys,
  nonTravelerCharacterKeys,
} from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import * as enkaData from './enkaData_gen.json'
import type { EnkaAvatar, EnkaShowcase } from './enkaToGood'
import { enkaToGood } from './enkaToGood'
import * as fixture from './fixtures/showcase.json'

const showcase = fixture as unknown as EnkaShowcase

describe('enkaToGood', () => {
  it('reads each shown character with its weapon and artifacts', () => {
    const { good, characters, skipped, gender } = enkaToGood(showcase)
    expect(characters).toEqual(['Amber', 'Bennett', 'Ganyu', 'Xingqiu'])
    expect(skipped).toEqual([])
    expect(gender).toBeUndefined()
    expect(good).toMatchObject({ format: 'GOOD', source: 'Enka.Network' })
    expect(good.characters?.[0]).toEqual({
      key: 'Amber',
      level: 90,
      ascension: 6,
      constellation: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    expect(good.characters?.find((c) => c.key === 'Bennett')?.talent).toEqual({
      auto: 6,
      skill: 8,
      burst: 10,
    })
    expect(good.characters?.find((c) => c.key === 'Xingqiu')).toMatchObject({
      level: 80,
      ascension: 5,
      talent: { auto: 2, skill: 8, burst: 8 },
    })
    expect(good.weapons).toEqual([
      {
        key: 'SkywardHarp',
        level: 90,
        ascension: 6,
        refinement: 2,
        location: 'Amber',
        lock: false,
      },
      expect.objectContaining({ key: 'FreedomSworn', refinement: 1 }),
      expect.objectContaining({ key: 'AmosBow', refinement: 3 }),
      expect.objectContaining({
        key: 'SacrificialSword',
        level: 80,
        ascension: 5,
        refinement: 5,
        location: 'Xingqiu',
      }),
    ])
    expect(good.artifacts).toHaveLength(20)
    expect(good.artifacts?.[0]).toEqual({
      setKey: 'BloodstainedChivalry',
      slotKey: 'flower',
      level: 20,
      rarity: 5,
      mainStatKey: 'hp',
      location: 'Amber',
      lock: false,
      substats: [
        { key: 'def', value: 37 },
        { key: 'atk_', value: 11.1 },
        { key: 'critDMG_', value: 18.7 },
        { key: 'eleMas', value: 19 },
      ],
    })
  })

  it('reads the Traveler by the element it has on, and its gender', () => {
    const traveler: EnkaAvatar = {
      avatarId: 10000007,
      skillDepotId: 704,
      propMap: { 4001: { val: '70' }, 1002: { val: '4' } },
      talentIdList: [1, 2],
      skillLevelMap: { 100553: 9, 10067: 8, 10068: 7 },
    }
    const { good, characters, gender } = enkaToGood({
      avatarInfoList: [traveler],
    })
    expect(characters).toEqual(['TravelerAnemo'])
    expect(gender).toBe('F')
    expect(good.characters?.[0]).toEqual({
      key: 'TravelerAnemo',
      level: 70,
      ascension: 4,
      constellation: 2,
      talent: { auto: 9, skill: 8, burst: 7 },
    })
  })

  it('leaves out what this app does not have yet, and says so', () => {
    const [amber] = showcase.avatarInfoList ?? []
    const equips = amber.equipList ?? []
    const { characters, good, skipped } = enkaToGood({
      avatarInfoList: [
        { ...amber, avatarId: 99999999 },
        {
          ...amber,
          equipList: equips.map((e, i) =>
            e.weapon
              ? { ...e, itemId: 1 }
              : i === 0
                ? { ...e, flat: { ...e.flat, setId: 1 } }
                : e
          ),
        },
      ],
    })
    expect(characters).toEqual(['Amber'])
    expect(good.weapons).toEqual([])
    expect(good.artifacts).toHaveLength(4)
    expect(skipped).toEqual([
      { avatarId: 99999999, item: 'character' },
      { avatarId: 10000021, item: 'artifact' },
      { avatarId: 10000021, item: 'weapon' },
    ])
  })

  it('knows every character, Traveler element, weapon and set of this app', () => {
    const data = enkaData as unknown as {
      characters: Record<string, unknown>
      travelers: Record<string, unknown>
      weapons: Record<string, unknown>
      artifactSets: Record<string, unknown>
    }
    // (Somnia and its Quantum Catalyst are the app's own, not the game's)
    expect(
      nonTravelerCharacterKeys.filter(
        (k) => k !== 'Somnia' && !data.characters[k]
      )
    ).toEqual([])
    expect(allTravelerKeys.filter((k) => !data.travelers[k])).toEqual([])
    expect(
      allWeaponKeys.filter((k) => k !== 'QuantumCatalyst' && !data.weapons[k])
    ).toEqual([])
    expect(allArtifactSetKeys.filter((k) => !data.artifactSets[k])).toEqual([])
  })
})
