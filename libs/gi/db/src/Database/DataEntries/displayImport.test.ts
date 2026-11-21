import { createTestDBStorage } from '@genshin-optimizer/common/database'
import {
  allCharacterRarityKeys,
  allElementKeys,
  allWeaponTypeKeys,
} from '@genshin-optimizer/gi/consts'
import { initialFilterOption } from '@genshin-optimizer/gi/schema'
import { ArtCharDatabase } from '../ArtCharDatabase'

const exported = require('../Van_2025-07-16_19-59-13.json')

describe('an import keeps the pages’ sort, not their filters', () => {
  it('a GO export’s +20-only artifact filter no longer hides its other artifacts', () => {
    const good = structuredClone(exported)
    good.display_artifact.filterOption.levelLow = 20
    good.display_artifact.filterOption.artSetKeys = ['GoldenTroupe']
    good.display_weapon.rarity = [5]
    good.display_character.element = ['pyro']
    const database = new ArtCharDatabase(1, createTestDBStorage('go'))
    database.importGOOD(good, false, false, false)

    const artifact = database.displayArtifact.get()
    expect(artifact.filterOption).toEqual(initialFilterOption())
    expect(artifact.sortType).toBe(good.display_artifact.sortType)
    expect(artifact.effFilter).toEqual(good.display_artifact.effFilter)
    expect(database.displayWeapon.get().rarity).toEqual(
      database.displayWeapon.validate({})?.rarity
    )
    expect(database.displayWeapon.get().sortType).toBe(
      good.display_weapon.sortType
    )
    const character = database.displayCharacter.get()
    expect(character.element).toEqual([...allElementKeys])
    expect(character.weaponType).toEqual([...allWeaponTypeKeys])
    expect(character.rarity).toEqual([...allCharacterRarityKeys])
    expect(character.sortType).toBe(good.display_character.sortType)
  })
})
